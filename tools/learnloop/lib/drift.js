'use strict';
/*
 * DETECTOR DRIFT AND INSTRUMENT HYGIENE — re-emitted per batch.
 *
 * arch-synthesis Stage 5, from A3 §4.4: *"the nightly job should re-emit the
 * flip-rate table on the new replays. A detector whose flip rate rises by an
 * order of magnitude is a signal to add hysteresis — and that signal arrives
 * long before any outcome effect is measurable."*
 *
 * The rule that follows from it, and the reason this module exists at all: an
 * instrument event is a FINDING, not a nuisance. A batch whose null band widened
 * or whose flip rate rose has told you something about the box, the build or
 * the detector, and every treatment verdict in it is provisional until that is
 * explained. So these tables are emitted whether or not anything looks wrong,
 * and the flags they raise ride on the batch's own record.
 *
 * ── WHAT IS MEASURED HERE, AND WHAT IS NOT ─────────────────────────────────
 *
 * MEASURED, from committed manifest rows alone:
 *
 *   nullBandHalfWidth   the A/A cell's own 95% half-width, per metric. This is
 *                       the yardstick every treatment delta in the batch is
 *                       read against, and its WIDTH over time is the drift
 *                       signal: a floor that widens between batches means the
 *                       box resolves less than it used to.
 *   pairedFlipRate      the share of paired games whose subject placed
 *                       differently in the two arms. In an A/A cell this is
 *                       pure run-to-run nondeterminism; a rise in the A/A cell
 *                       is an instrument event, and a treatment cell's rate is
 *                       only readable against it.
 *   overrunRate         per-decision deadline overruns, per arm. An arm that
 *                       overruns more is an arm playing a different game.
 *   capRate             games that ended on the turn cap. THE P5 ANOMALY WAS
 *                       THIS ROW: cap rate doubled under wasm-on (0.458 vs
 *                       0.229) while placement read null — a shape change with
 *                       no outcome effect, which is precisely what a mechanism
 *                       table is for.
 *   integrity           illegal moves and thrown decisions. Must be zero. A
 *                       nonzero here voids the batch, not the arm.
 *
 * NOT MEASURED, and named so nobody mistakes its absence for a null:
 *
 *   A3 §4.2 item 5 asks every emission to carry
 *   `{policy, detectors:{sliderPresent, ownTrail, promotionImminent}, profile}`.
 *   No production producer emits that today, so the DETECTOR flip rate — the
 *   one A3's hysteresis signal is actually about — cannot be computed from a
 *   committed batch. `pairedFlipRate` is an outcome-level proxy and is labelled
 *   as one. Closing it is a ledger item, not a silent substitution.
 */

const { blockCI, mean, round } = require('./stats');

/** Half-width of a CI, or null when the interval could not be computed. */
function halfWidth(ci) {
  if (ci.lo === null || ci.hi === null) return null;
  return round((ci.hi - ci.lo) / 2);
}

/**
 * The null band for one A/A pairing: per cell, per metric, the paired mean and
 * its half-width. Anything in the batch not comfortably larger than the
 * half-width of its own cell's band is a null result.
 */
function nullBand(paired, metrics = ['score', 'win', 'turns']) {
  const out = {};
  for (const [cellKey, byBlock] of paired.cells) {
    const row = {};
    for (const metric of metrics) {
      const blockMeans = [...byBlock.values()]
        .map((acc) => (acc[metric] ? mean(acc[metric]) : null))
        .filter((x) => x !== null);
      const ci = blockCI(blockMeans);
      row[metric] = {
        mean: ci.mean,
        lo: ci.lo,
        hi: ci.hi,
        blocks: ci.n,
        halfWidth: halfWidth(ci),
        excludesZero: ci.lo !== null && (ci.lo > 0 || ci.hi < 0),
      };
    }
    out[cellKey] = row;
  }
  return out;
}

/**
 * PAIRED OUTCOME FLIP RATE — the share of paired games whose subject seat
 * placed differently across the two arms.
 *
 * Not A3's detector flip rate (see the header). It is the coarsest honest
 * measure of how much the same board moves between two runs, and its value in
 * the A/A cell is the instrument's own jitter.
 */
function flipRate(base, treat, { subjectMap = {}, subject = null } = {}) {
  const { subjectOf } = require('./extract');
  const out = {};
  for (const [sweepId, aRows] of base.sweeps) {
    const bRows = treat.sweeps.get(sweepId);
    if (!bRows) continue;
    const byId = new Map(bRows.map((r) => [r.gameId, r]));
    const subjA = subjectMap[base.name] ?? subjectOf(aRows, subject);
    const subjB = subjectMap[treat.name] ?? subjectOf(bRows, subject);
    for (const ra of aRows) {
      const rb = byId.get(ra.gameId);
      if (rb === undefined) continue;
      const pa = (ra.results ?? []).find((r) => r.bot === subjA);
      const pb = (rb.results ?? []).find((r) => r.bot === subjB);
      if (!pa || !pb) continue;
      const key = `${sweepId}::${ra.cell}`;
      if (!out[key]) out[key] = { games: 0, flips: 0 };
      out[key].games++;
      if (pa.place !== pb.place) out[key].flips++;
    }
  }
  for (const k of Object.keys(out)) {
    out[k].rate = out[k].games > 0 ? round(out[k].flips / out[k].games, 4) : null;
  }
  return out;
}

/**
 * PER-ARM INSTRUMENT HYGIENE. One row per (arm, cell): overrun rate, cap rate,
 * worst wall time, and the integrity counters that must be zero.
 *
 * Computed per arm rather than paired on purpose. An overrun rate is a property
 * of one arm on one box; differencing it hides the case where BOTH arms
 * overran, which is a batch-level event and the one that most often explains a
 * strange result.
 */
function hygiene(arms) {
  const rows = [];
  for (const [armName, arm] of arms) {
    for (const [sweepId, sweepRows] of arm.sweeps) {
      const byCell = new Map();
      for (const r of sweepRows) {
        if (!byCell.has(r.cell)) {
          byCell.set(r.cell, {
            arm: armName,
            sweepId,
            cell: r.cell,
            games: 0,
            capped: 0,
            decisions: 0,
            overruns: 0,
            unstaged: 0,
            illegal: 0,
            errors: 0,
            worstWallMs: 0,
          });
        }
        const c = byCell.get(r.cell);
        c.games++;
        if (r.terminal === 'cap') c.capped++;
        for (const h of r.health ?? []) {
          c.decisions += h.decisions ?? 0;
          c.overruns += h.overruns ?? 0;
          c.unstaged += h.unstaged ?? 0;
          c.illegal += h.illegal ?? 0;
          c.errors += h.errors ?? 0;
          c.worstWallMs = Math.max(c.worstWallMs, h.worstWallMs ?? 0);
        }
      }
      for (const c of byCell.values()) {
        rows.push({
          ...c,
          capRate: c.games > 0 ? round(c.capped / c.games, 4) : null,
          overrunRate: c.decisions > 0 ? round(c.overruns / c.decisions, 4) : null,
          unstagedRate: c.decisions > 0 ? round(c.unstaged / c.decisions, 4) : null,
        });
      }
    }
  }
  return rows;
}

/**
 * INSTRUMENT EVENTS — the flagged rows, with the reason spelled out.
 *
 * Each is a claim about the INSTRUMENT and not about any treatment, and each
 * one makes every treatment verdict in the batch provisional until it is
 * explained. `previous` is the last batch's drift block when the ledger has
 * one; without it the width and flip comparisons are skipped rather than
 * guessed at.
 */
function instrumentEvents({ band, flips, hygieneRows, previous = null }) {
  const events = [];

  for (const [cellKey, row] of Object.entries(band)) {
    for (const [metric, r] of Object.entries(row)) {
      if (r.excludesZero) {
        events.push({
          kind: 'null-excludes-zero',
          cell: cellKey,
          metric,
          detail:
            `the A/A null itself reports ${r.mean} [${r.lo}, ${r.hi}] over ${r.blocks} blocks. ` +
            'This box, at this load and this block count, cannot resolve an effect of that ' +
            'size; no treatment delta of comparable magnitude from this batch is reportable.',
        });
      }
      if (previous && previous.band && previous.band[cellKey] && previous.band[cellKey][metric]) {
        const was = previous.band[cellKey][metric].halfWidth;
        const now = r.halfWidth;
        if (was !== null && now !== null && was > 0 && now > was * 1.5) {
          events.push({
            kind: 'null-band-widened',
            cell: cellKey,
            metric,
            detail:
              `null half-width ${was} -> ${now} (x${round(now / was, 2)}). The instrument ` +
              'resolves less than it did; treat every delta in this cell as provisional and ' +
              'look at the box before the build.',
          });
        }
      }
    }
  }

  for (const [cellKey, f] of Object.entries(flips)) {
    if (previous && previous.flips && previous.flips[cellKey]) {
      const was = previous.flips[cellKey].rate;
      if (was !== null && was > 0 && f.rate !== null && f.rate > was * 3) {
        events.push({
          kind: 'flip-rate-rose',
          cell: cellKey,
          detail:
            `paired outcome flip rate ${was} -> ${f.rate}. A3 §4.4's hysteresis signal ` +
            'arrives here, long before any outcome effect is measurable.',
        });
      }
    }
  }

  for (const r of hygieneRows) {
    if (r.illegal > 0 || r.errors > 0) {
      events.push({
        kind: 'integrity',
        cell: `${r.sweepId}::${r.cell}`,
        arm: r.arm,
        detail: `illegal=${r.illegal} errors=${r.errors}. This voids the BATCH, not the arm.`,
      });
    }
    if (r.overrunRate !== null && r.overrunRate > 0.05) {
      events.push({
        kind: 'overrun',
        cell: `${r.sweepId}::${r.cell}`,
        arm: r.arm,
        detail:
          `${(r.overrunRate * 100).toFixed(1)}% of decisions overran the deadline. An arm that ` +
          'overruns is an arm playing a different game from its pair.',
      });
    }
  }

  // Cap rate is compared BETWEEN arms within a cell: that asymmetry is the
  // signal, and it is the shape the P5 wasm anomaly took.
  const byCell = new Map();
  for (const r of hygieneRows) {
    const key = `${r.sweepId}::${r.cell}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(r);
  }
  for (const [key, rows] of byCell) {
    const rates = rows.filter((r) => r.capRate !== null);
    if (rates.length < 2) continue;
    const lo = Math.min(...rates.map((r) => r.capRate));
    const hi = Math.max(...rates.map((r) => r.capRate));
    if (lo > 0 && hi > lo * 1.5) {
      events.push({
        kind: 'cap-rate-asymmetry',
        cell: key,
        detail:
          `cap rate ranges ${lo} to ${hi} across arms (x${round(hi / lo, 2)}). Games ending on ` +
          'the turn cap rather than decisively is a SHAPE change; it can be large while ' +
          'placement reads null, and P5 (wasm 0.229 -> 0.458) is the standing exhibit.',
      });
    }
  }

  return events;
}

module.exports = { nullBand, flipRate, hygiene, instrumentEvents, halfWidth };
