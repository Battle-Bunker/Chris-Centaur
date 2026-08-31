'use strict';
/*
 * THE PROMOTION LEDGER — schema, invariants, and the rules by which a
 * measurement is allowed to move a flag's status.
 *
 * ── ONE ARTIFACT, TWO CONSUMERS ────────────────────────────────────────────
 *
 * arch-synthesis Stage 5: *"the A/B harness output IS the production predicate
 * table — one artifact, two consumers."* This file is that artifact's schema.
 * The cloud coordinator reads it to decide what has been settled; the local sim
 * session reads it to know what to run next; `bin/make-promotion-batch.js`
 * turns it into the next batch's specs, so "what should the PC run next?" is a
 * command rather than a judgement call.
 *
 * ── THE SEVEN STATUSES, AND THE LADDER BETWEEN THEM ────────────────────────
 *
 *   dark          the flag exists, ships off, and has no measurement at all.
 *   probe-passed  a DETERMINISTIC probe (replay, fixture, counting budget)
 *                 cleared its gate. NECESSARY, NEVER SUFFICIENT — see below.
 *   live-null     a live paired sweep with a valid concurrent null found no
 *                 effect it could resolve. NOT "no effect": read the power row.
 *   live-failed   a live paired sweep found a cost outside its own null band.
 *   supported     a live paired sweep supports the default flip and the flip
 *                 has NOT been made. The distinction from `promoted` is the
 *                 ledger's action list: a supported flag is work owed.
 *   promoted      supported, and the default was actually flipped, with the
 *                 commit that did it named.
 *   frozen        conditioned to null and CLOSED. Re-opened only by a MECHANISM
 *                 CLAIM — a statement about how the thing works that predicts a
 *                 different answer — never by a p-value. (A3 §4.2 item 3.)
 *
 * ── WHY A DETERMINISTIC PROBE CAN NEVER PROMOTE ────────────────────────────
 *
 * This is not a methodological preference; it is a finding, and it is the most
 * expensive one this program has bought. CENTAUR_CLUSTER_SEED passed CL1's
 * deterministic ship gate outright — fatal stagings 41 -> 0, teammate kills
 * 25 -> 4 — and then FAILED live: snake6 win rate 1.00 -> 0.15, exhaustion
 * deaths x1.9. The collapse arrived through travel economy, a channel the probe
 * does not measure and could not have measured, because the probe scores
 * positions and the failure is about the shape of a whole game.
 *
 * So the ladder is one-directional and the gate is hard:
 *
 *   a deterministic probe may raise `dark` -> `probe-passed` AND NOTHING MORE;
 *   only a LIVE PAIRED SWEEP with a concurrent, verified null may write
 *   `live-null`, `live-failed`, `supported` or `promoted`.
 *
 * `applyMeasurement` enforces it. A probe measurement that arrives claiming a
 * live status is rejected, not downgraded quietly.
 *
 * ── THE POWER ROW IS PART OF EVERY VERDICT ─────────────────────────────────
 *
 * A3 §4.1: block dispersion of the placement metric puts 80% power at MDE 0.25
 * around 58 blocks on the pooled stratum and 8 on the tightest, while MDE 0.10
 * needs 362 — 1,000+ games per cell per arm. Mechanism metrics move at n≈8.
 * Every measurement therefore carries `blocksHad` and `blocksNeeded`, and a
 * PLACEMENT verdict from a cell with `blocksHad < blocksNeeded` is recorded as
 * `underpowered: true` and may not move the status. The loop refuses to learn
 * from cells that cannot teach it.
 *
 * ── THE EXPLORATION SLICE ──────────────────────────────────────────────────
 *
 * A3 §4.2 item 6: the policy decides which games get played with which
 * features, so tomorrow's corpus is selected by today's policy. A PROMOTED flag
 * therefore keeps a ~10% slice running its opposite branch, forever, or the
 * cell that turned it on will never generate the data by which it could be
 * turned back off. `explorationSlice` is that share, and the batch generator
 * emits the cells for it.
 */

const fs = require('fs');
const path = require('path');
const { blocksForPower, mdeAtBlocks, round } = require('./stats');

const SCHEMA_VERSION = 1;

const STATUSES = [
  'dark',
  'probe-passed',
  'live-null',
  'live-failed',
  'supported',
  'promoted',
  'frozen',
];

/** Statuses only a live paired sweep with a verified null may write. */
const LIVE_ONLY = new Set(['live-null', 'live-failed', 'supported', 'promoted']);

/**
 * THE FOUR KINDS OF MEASUREMENT.
 *
 *   probe       a deterministic gate. Raises `dark` -> `probe-passed`, nothing more.
 *   live        a paired sweep with a concurrent null. The only kind that may
 *               write a live status.
 *   historical  an older sweep with no bundle stamp. Informs; never promotes.
 *   control     A CELL THAT IS NULL BY DESIGN — see below.
 *
 * ── WHY `control` IS A KIND AND NOT A VERDICT (`CONTROL-CELLS-DEMOTE`) ─────
 *
 * A control cell is a provably-inert path run precisely to prove the
 * instrument reports zero when zero is the truth. Before this kind existed,
 * `applyMeasurement` could not tell such a cell apart from a treatment cell
 * that failed to show an effect: both took the `live-null` branch, and a
 * control that came back perfect demoted the flag it was vouching for.
 *
 * This is not hypothetical. TERRITORY_SLIDER_PROFILE's `null-snake6` control
 * sat at EXACTLY 0 against a measured +/-0.0324 floor — the strongest single
 * row in the ledger, because a measurement that does not manufacture effects
 * on an inert path is the precondition for believing any effect it does
 * report — and filing it as `placement` demoted the flag `supported` ->
 * `live-null`. THE BETTER THE CONTROL, THE HARDER IT DEMOTED. A rule that
 * punishes the practice it exists to encourage.
 *
 * So a control row enters a different channel entirely. It never scores an
 * effect and never moves a status in either direction; it accumulates on
 * `f.controlEvidence`, where it is what it actually is — evidence about the
 * INSTRUMENT rather than a claim about the treatment. And it is not merely
 * inert: a control that MOVES is a loud instrument failure, recorded under
 * `controlEvidence.violated`, because a path the design requires to read zero
 * reading nonzero makes every treatment row measured beside it provisional.
 */
const MEASUREMENT_KINDS = ['probe', 'live', 'historical', 'control'];

/**
 * THE METRIC FAMILIES THAT MAY MOVE A STATUS.
 *
 *   placement  who won. The thing the flag is ultimately for.
 *   mechanism  what the engine did. Moves at n~8 and is what the loop refits on.
 *   soundness  a law the layer owes. A nonzero here is a failure at any n.
 *
 * Everything else is recorded and reads into the narrative without moving
 * anything:
 *
 *   engagement DID THE ARM RUN. It is not evidence that the treatment helped —
 *              it is the precondition for reading any other row at all, and it
 *              is consumed through `armEngagementVerified`, not as a verdict.
 *              `wasmRuns: 0 -> 812` says the arm engaged; it says nothing
 *              whatever about whether engaging was a good idea.
 *   audit      which arm actually ran (the resolved flag stamp).
 *   cost       microseconds and wall time. A cost is one side of a trade and
 *              never a verdict on its own; the ledger's `nextExperiment` rows
 *              are where a cost is weighed against what it bought.
 *   shape      cap rate, turn counts. Real, and a drift signal, but a shape
 *              change with null placement is a finding to investigate rather
 *              than a promotion or a failure.
 */
const STATUS_MOVING_FAMILIES = new Set(['placement', 'mechanism', 'soundness']);

/** The share of a promoted flag's cells that keep running the opposite branch. */
const EXPLORATION_SLICE = 0.1;

const LEDGER_PATH = path.join(__dirname, '..', 'promotion-ledger.json');

function load(file = LEDGER_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  validate(raw);
  return raw;
}

function save(ledger, file = LEDGER_PATH) {
  validate(ledger);
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + '\n');
}

function validate(ledger) {
  const errs = [];
  if (ledger.schemaVersion !== SCHEMA_VERSION) {
    errs.push(`schemaVersion ${ledger.schemaVersion} != ${SCHEMA_VERSION}`);
  }
  if (!Array.isArray(ledger.flags)) errs.push('flags is not an array');
  for (const f of ledger.flags ?? []) {
    if (!f.flag) errs.push('a flag row has no `flag`');
    if (!STATUSES.includes(f.status)) errs.push(`${f.flag}: bad status ${f.status}`);
    if (!Array.isArray(f.measurements)) errs.push(`${f.flag}: measurements is not an array`);
    if (!f.promotionMetrics || !Array.isArray(f.promotionMetrics)) {
      errs.push(`${f.flag}: no promotionMetrics — a gate nobody named is a gate nobody can run`);
    }
    if (f.status === 'frozen' && !f.reopenOn) {
      errs.push(`${f.flag}: frozen with no reopenOn — a frozen cell must name the mechanism claim that reopens it`);
    }
    if (f.status === 'promoted' && !f.promotedBy) {
      errs.push(
        `${f.flag}: status promoted with no promotedBy — a promotion whose commit nobody named ` +
          'is a claim, not a change'
      );
    }
    if (LIVE_ONLY.has(f.status)) {
      const live = (f.measurements ?? []).some((m) => m.kind === 'live' && m.nullVerified);
      if (!live) errs.push(`${f.flag}: status ${f.status} with no live measurement carrying a verified null`);
    }
    for (const m of f.measurements ?? []) {
      if (!m.batch) errs.push(`${f.flag}: a measurement has no batch id`);
      if (!MEASUREMENT_KINDS.includes(m.kind)) {
        errs.push(`${f.flag}/${m.batch}: bad measurement kind ${m.kind}`);
      }
    }
  }
  if (errs.length > 0) {
    const e = new Error(`promotion ledger is invalid:\n  - ${errs.join('\n  - ')}`);
    e.errors = errs;
    throw e;
  }
  return true;
}

function flagOf(ledger, name) {
  return ledger.flags.find((f) => f.flag === name) ?? null;
}

/**
 * The power row for one measurement: what the cell HAD, what a placement claim
 * at the given MDE NEEDS, and what the blocks it had can actually resolve.
 */
function powerRow({ blocksHad, blockSd, mde = 0.25 }) {
  return {
    blocksHad: blocksHad ?? null,
    blockSd: blockSd === undefined || blockSd === null ? null : round(blockSd),
    mdeTarget: mde,
    blocksNeeded: blockSd ? blocksForPower(blockSd, mde) : null,
    mdeResolvable: blockSd ? mdeAtBlocks(blockSd, blocksHad) : null,
    underpowered:
      blockSd && blocksHad ? blocksHad < blocksForPower(blockSd, mde) : null,
  };
}

/**
 * APPLY ONE MEASUREMENT TO ONE FLAG, and return what changed and why.
 *
 * The rules, all of them refusals:
 *
 *  1. A `probe` measurement may raise `dark` -> `probe-passed` and may write no
 *     other status. (The CENTAUR_CLUSTER_SEED lesson, in code.)
 *  2. A `live` measurement without `nullVerified` may not move the status at
 *     all: a treatment delta with no concurrent null is unreadable, whatever
 *     its size. Historical baselines do not substitute — A3 §4.2 item 2.
 *  3. A placement verdict from an underpowered cell is recorded and may not
 *     move the status. Mechanism verdicts still may: they resolve at n≈8.
 *  4. A `frozen` flag is not moved by any measurement. It is re-opened by
 *     `reopen(flag, claim)` and by nothing else.
 *  5. Every measurement is APPENDED. The ledger is a record, not a current
 *     value; a status without the measurements that produced it is an opinion.
 */
function applyMeasurement(ledger, flagName, m) {
  const f = flagOf(ledger, flagName);
  if (f === null) throw new Error(`no such flag in the ledger: ${flagName}`);
  const notes = [];

  if (!m.batch) throw new Error(`${flagName}: a measurement must name its batch`);
  if (!MEASUREMENT_KINDS.includes(m.kind)) {
    throw new Error(`${flagName}: unknown measurement kind ${m.kind}`);
  }
  if (f.measurements.some((x) => x.batch === m.batch && x.cell === m.cell && x.metric === m.metric)) {
    return { changed: false, notes: [`${flagName}: ${m.batch}/${m.cell}/${m.metric} already recorded`] };
  }

  f.measurements.push(m);
  const before = f.status;

  if (f.status === 'frozen') {
    notes.push(
      `${flagName}: frozen — measurement recorded, status untouched. A frozen cell is ` +
        're-opened by a mechanism claim, never by a p-value (A3 §4.2 item 3).'
    );
    return { changed: false, before, after: f.status, notes };
  }

  if (m.kind === 'control') {
    // A CONTROL ENTERS NO EFFECT CHANNEL. It cannot promote and it cannot
    // demote; it strengthens or impeaches the INSTRUMENT. `inert` is the row
    // doing its job — the design required zero and zero is what came back.
    const inert = m.verdict !== 'control-violated';
    if (!f.controlEvidence) f.controlEvidence = { inert: [], violated: [] };
    const where = `${m.batch}/${m.cell}/${m.metric}`;
    (inert ? f.controlEvidence.inert : f.controlEvidence.violated).push(where);
    notes.push(
      inert
        ? `${flagName}: CONTROL PASSED at ${where} — the cell the design requires to read zero ` +
          'read zero. Recorded as instrument evidence; status untouched, in either direction. ' +
          'A control that comes back perfect is the strongest row a batch can carry and it must ' +
          'not be able to demote the flag it vouches for (CONTROL-CELLS-DEMOTE).'
        : `${flagName}: ** CONTROL VIOLATED ** at ${where} (${m.value ?? m.verdict}). A path the ` +
          'design requires to read ZERO did not. This is an INSTRUMENT FAILURE, not a treatment ' +
          'effect: every treatment row measured beside it is provisional until the control is ' +
          'explained. Status untouched — a broken instrument does not get to write a verdict.'
    );
    return { changed: false, before, after: f.status, notes };
  }

  if (m.kind === 'probe') {
    if (m.verdict === 'passed' && f.status === 'dark') {
      f.status = 'probe-passed';
      notes.push(
        `${flagName}: dark -> probe-passed. A deterministic probe is NECESSARY AND NEVER ` +
          'SUFFICIENT: CENTAUR_CLUSTER_SEED passed exactly this gate and then lost snake6 ' +
          '1.00 -> 0.15 live.'
      );
      return { changed: true, before, after: f.status, notes };
    }
    notes.push(`${flagName}: probe recorded; a probe may not write a live status.`);
    return { changed: false, before, after: f.status, notes };
  }

  if (m.kind === 'historical') {
    notes.push(
      `${flagName}: historical measurement recorded. Historical rows inform the next ` +
        'experiment and never move a status — they carry no bundle stamp and no concurrent null.'
    );
    return { changed: false, before, after: f.status, notes };
  }

  // kind === 'live'
  if (!m.nullVerified) {
    notes.push(
      m.verdict === 'unreadable'
        ? `${flagName}: ${m.cell}/${m.metric} is UNREADABLE — the A/A cell carried no floor for ` +
          'this metric, so its delta has nothing to be read against. Recorded; status untouched. ' +
          'An absent instrument is not a null result.'
        : `${flagName}: live measurement recorded WITHOUT a verified null — status untouched. ` +
          'A treatment delta read against no null is unreadable at any size.'
    );
    return { changed: false, before, after: f.status, notes };
  }
  // ENGAGEMENT IS A TRI-STATE AND THE RULE IS "SHOWN", NOT "NOT DISPROVED".
  //
  //   true   a counter was read and was nonzero. The arm demonstrably ran.
  //   false  a counter was read and was ZERO. The arm demonstrably did not.
  //   null   CANNOT SAY — an old bundle with no mechanism report at all.
  //
  // This used to refuse only on `=== false`, so `null` sailed through and could
  // write a live status — and `null` is not the edge case, it is every batch
  // that predates the CL7 mechanism report. The seeded ledger papered over the
  // gap by marking CENTAUR_WASM's rows `false`, a value the vocabulary reserves
  // for a counter that was READ: the datum was bent to fit the code. Refusing
  // on anything that is not `true` un-bends it (`ENGAGEMENT-TRISTATE`).
  if (m.armEngagementVerified !== true) {
    const zero = m.armEngagementVerified === false;
    notes.push(
      `${flagName}: live measurement recorded, status untouched — THE TREATMENT ARM'S ` +
        'ENGAGEMENT WAS NOT SHOWN' +
        (zero
          ? ' (a counter was read and was ZERO: the arm did not run).'
          : ' (no engagement counter was read at all — `null` is CANNOT SAY, and cannot say ' +
            'is not the same as said yes). Re-run against a bundle carrying the mechanism ' +
            'report, or name the counter with --engagement.') +
        ' A null from an arm that never ran is a different finding from a null from an arm ' +
        'that ran and did not help, and only the mechanism rows tell them apart. This is the ' +
        'P5 wasm cell verbatim: `on` is refused per partition, silently, whenever an input is ' +
        'not resident.'
    );
    return { changed: false, before, after: f.status, notes };
  }
  if (m.family && !STATUS_MOVING_FAMILIES.has(m.family)) {
    notes.push(
      `${flagName}: ${m.family} row recorded (${m.cell}/${m.metric} = ${m.value}); a ` +
        `${m.family} metric does not move a status.`
    );
    return { changed: false, before, after: f.status, notes };
  }
  if (m.family === 'placement' && m.power && m.power.underpowered) {
    notes.push(
      `${flagName}: placement verdict from an underpowered cell (${m.power.blocksHad} blocks, ` +
        `${m.power.blocksNeeded} needed for MDE ${m.power.mdeTarget}) — recorded, status ` +
        'untouched. The loop does not learn placement from cells that cannot teach it.'
    );
    return { changed: false, before, after: f.status, notes };
  }

  // A REAL EFFECT WHOSE DIRECTION IS NOT A VERDICT. The delta cleared the
  // batch's own floor, so it is not null and must not be recorded as one — but
  // the metric has no good direction (`turns`, `wasmRuns`, an audit stamp), so
  // there is nothing to score. Recorded loudly, moves nothing. See
  // lib/polarity.js: the loop would rather say it cannot score a row than
  // score it backwards.
  if (m.verdict === 'outside-null-unscored') {
    notes.push(
      `${flagName}: ${m.cell}/${m.metric} moved OUTSIDE the null floor (${m.value}) on a metric ` +
        'with no good direction — recorded, status untouched. This is a real effect and a ' +
        'finding to investigate; it is not a win and it is not a loss. Declare a polarity on ' +
        'the gate if this metric does have one.'
    );
    return { changed: false, before, after: f.status, notes };
  }

  const next =
    m.verdict === 'failed'
      ? 'live-failed'
      : m.verdict === 'supports-promotion'
        ? 'supported'
        : 'live-null';
  if (next === 'live-null' && f.status === 'live-failed') {
    notes.push(
      `${flagName}: a null row does not undo a demonstrated cost. Status stays live-failed. ` +
        'A flag that lost a cell is not rehabilitated by other cells declining to reproduce ' +
        'the loss — it is rehabilitated by a root cause and a repaired arm.'
    );
    return { changed: false, before, after: f.status, notes };
  }
  if (next === 'supported' && f.status === 'live-failed') {
    notes.push(
      `${flagName}: a supporting cell does not overturn a live FAILURE on its own. Status stays ` +
        'live-failed; the failure needs a root cause and a repaired arm, not a second opinion.'
    );
    return { changed: false, before, after: f.status, notes };
  }
  /*
   * A PROMOTED DEFAULT IS NOT UNSHIPPED BY A CELL THAT COULD NOT SEE IT
   * (`PROMOTED-DEMOTED-BY-NULL`).
   *
   * `promoted` means raced, shipped, and the commit that flipped the default
   * named. `supported` is the rung BELOW it — "selection change owed" — and
   * `live-null` is "a cell found no effect it could resolve". Neither is
   * evidence to take a shipped default back out, and the loop was applying
   * both: on 20260831-batch2, X9's exploration slice carried one row SUPPORTING
   * CENTAUR_STAGING_SAFETY (`deathsSelf` +0.5 with the guard off) and four
   * cells that could not resolve anything at four blocks, and the four nulls
   * walked the flag from `promoted` down to `live-null` — unshipping a guard on
   * the strength of small cells declining to reproduce its effect.
   *
   * This is the CONTROL-CELLS-DEMOTE lesson at the top of the ladder rather
   * than the bottom: a rule that punishes the practice it exists to encourage.
   * The exploration slice is REQUIRED to keep running against every promoted
   * default forever, so a promoted flag accumulates null rows by design, and
   * under the old rule every batch that ran the slice properly demoted it.
   *
   * A promotion IS revisable — that is what the slice is for — but only by the
   * same kind of evidence that would have made it in the first place: a `failed`
   * row that clears its own floor. `live-failed` below still applies.
   */
  if (f.status === 'promoted' && next !== 'live-failed') {
    notes.push(
      `${flagName}: ${next === 'supported' ? 'a supporting' : 'a null'} row does not move a ` +
        'PROMOTED default. Status stays promoted — the default is already flipped and the commit ' +
        'that flipped it is named. A promotion is revised by a demonstrated cost that clears its ' +
        'own floor, never by a cell that could not resolve the effect. The exploration slice runs ' +
        'against every promoted default forever and therefore accumulates null rows by design; ' +
        'demoting on them would make keeping the slice worse than dropping it.'
    );
    return { changed: false, before, after: f.status, notes };
  }
  f.status = next;
  notes.push(`${flagName}: ${before} -> ${next} on ${m.batch}/${m.cell} (${m.metric}).`);
  return { changed: true, before, after: f.status, notes };
}

/** Re-open a frozen cell. Requires a MECHANISM CLAIM, in words. */
function reopen(ledger, flagName, claim) {
  const f = flagOf(ledger, flagName);
  if (f === null) throw new Error(`no such flag: ${flagName}`);
  if (f.status !== 'frozen') throw new Error(`${flagName} is not frozen`);
  if (!claim || claim.trim().length < 20) {
    throw new Error(
      `${flagName}: re-opening a frozen cell needs a MECHANISM CLAIM — a statement about how ` +
        'the thing works that predicts a different answer. A p-value is not one.'
    );
  }
  f.status = 'dark';
  f.reopenedBy = claim;
  return f;
}

/**
 * IS THIS FLAG'S `live-null` A DECISION, OR JUST A CELL THAT COULD NOT SEE?
 *
 * The ledger's own definition of `live-null` is *"found no effect IT COULD
 * RESOLVE"*, and it says in the same breath: NOT "no effect" — read the power
 * row. A null from a cell the ledger itself stamped `underpowered` has settled
 * precisely nothing, and treating it as settled is how CENTAUR_UNIT_FATALITY's
 * P7F came to be written out in full and then silently never scheduled: its
 * null is 16 blocks against the 58 its own dispersion demands.
 *
 * So a `live-null` flag is UNRESOLVED — and therefore schedulable — unless the
 * MOST RECENT BATCH that measured it could resolve the effect on EVERY cell it
 * used. A flag whose null really did come from cells that could have seen the
 * effect is settled, and drops out of the batch on the evidence rather than on
 * the status name.
 *
 * BATCH-SCOPED AND ALL-ROWS, NOT "the last row appended", AND THE FIRST REAL
 * INGEST RUN IS WHY. That version asked only about `placement[length - 1]`,
 * which is an artifact of the order rows happen to be written. When the machine
 * ingest ran on 20260827-overnight it appended per-cell rows AFTER the fold's
 * sweep-level row, and those per-cell rows carry each cell's OWN measured block
 * SD instead of the program's pooled-stratum prior — so `blocksNeeded` fell
 * from 58 to between 1 and 11 and every live-null flag's null became "resolved"
 * on the strength of whichever row was written last. P7F, written out in full
 * and already once rescued from exactly this, silently left batch 2 again.
 *
 * Both power numbers are honest and they answer different questions. The
 * per-cell one is right that 16 blocks resolves an effect of 0.25 on these
 * cells. Nobody is looking for 0.25: CENTAUR_UNIT_FATALITY's question is
 * whether the classifier costs two or three points of placement. The MDE the
 * ingest used is a program default, not this flag's question — see
 * MDE-HARDCODED — so the rule is kept conservative: one cell in the batch that
 * could not resolve the effect leaves the null unsettled.
 */
function nullIsUnresolved(f) {
  const placement = (f.measurements ?? []).filter((m) => m.kind === 'live' && m.family === 'placement');
  if (placement.length === 0) return true;
  const lastBatch = placement[placement.length - 1].batch;
  const rows = placement.filter((m) => m.batch === lastBatch);
  return !rows.every((m) => m.power && m.power.underpowered === false);
}

/**
 * Flags whose next experiment the batch generator must schedule.
 *
 * `live-null` is here, not because a null is a failure, but because a null is
 * not automatically an answer — see `nullIsUnresolved` (`LIVE-NULL-IS-TERMINAL`).
 * A flag with nothing left to run names no `nextExperiment` and is skipped.
 */
function undecided(ledger) {
  return ledger.flags.filter((f) => {
    if (['dark', 'probe-passed', 'live-failed'].includes(f.status)) return true;
    if (f.status === 'live-null') return Boolean(f.nextExperiment) && nullIsUnresolved(f);
    return false;
  });
}

/** Flags that owe an exploration slice (the ratchet guard). */
function needsExploration(ledger) {
  return ledger.flags.filter((f) => f.status === 'promoted' || f.status === 'supported');
}

module.exports = {
  SCHEMA_VERSION,
  STATUSES,
  LIVE_ONLY,
  MEASUREMENT_KINDS,
  STATUS_MOVING_FAMILIES,
  nullIsUnresolved,
  EXPLORATION_SLICE,
  LEDGER_PATH,
  load,
  save,
  validate,
  flagOf,
  powerRow,
  applyMeasurement,
  reopen,
  undecided,
  needsExploration,
};
