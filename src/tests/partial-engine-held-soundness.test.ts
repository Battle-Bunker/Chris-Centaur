/**
 * THE UNCERTAINTY LAYER, AGAINST EVERY WORLD IT CLAIMS TO COVER.
 *
 * The standing differential runs boards on which every unit is modelled, so
 * the possibility machinery — clouds, the entanglement ledger, the optimistic
 * timeline, the bounds fold — never ran in it at all. That machinery carries
 * the load-bearing claim of the whole design (partial-engine/index.ts):
 *
 *     "a resolution's state is the OPTIMISTIC timeline and its ledger names
 *      every point where that timeline could differ from the truth, so an
 *      empty ledger is a proof and a non-empty one is a work list"
 *
 * and the pricing half (exact.ts `resolveBounded`, bounds.ts
 * `scopedTeamValueBounds`) turns that into an interval a searcher discards
 * branches on. Neither half had a differential. A too-wide interval costs a
 * wasted branch; a too-narrow one is a FALSE PROOF, and the bot filters on
 * proofs — `src/lobster/bounds/soundness.test.ts` says so in its first
 * paragraph, and pins the property one layer up, at the bound bank, against
 * its own testkit substrate. This suite pins it at the layer underneath,
 * against the VENDORED RESOLVER: hold one to three units, price the turn once
 * with `resolveBounded`, then enumerate every legal thing the held units could
 * have done and settle each of those concrete worlds through `settleTurn`.
 *
 * Four laws, all of them the code's own words rather than mine:
 *
 *   1. THE BRACKET.        bounds.worst ≤ every concrete world's subject-frame
 *                          score ≤ bounds.best. The score is the same fold
 *                          `resolveBounded` publishes — own material minus
 *                          everyone else's — evaluated where every unit's fate
 *                          is known, which is what a concrete world is.
 *   2. THE FATES.          `Fate.Alive` is "alive, and no unknown could have
 *                          changed that"; `Fate.Dead` is "dead however the
 *                          unknowns fall" (engine.ts). Both are claims about
 *                          EVERY world, so both are falsifiable by one.
 *   3. HELD SURVIVAL.      The trit `resolveBounded` folds a held unit in at —
 *                          certainlyGone ? "no" : deathPossible || mayHaveDied
 *                          ? "maybe" : "yes" — must not say "yes" about a unit
 *                          some world kills, nor "no" about one some world
 *                          spares. This is the exact false-proof the
 *                          `mayHaveDied` doc-comment describes being added to
 *                          close, so it is the one most worth re-checking here.
 *   4. THE LEDGER.         An EMPTY ledger is a proof: every concrete world
 *                          then agrees with the optimistic timeline, unit for
 *                          unit. And where a world does differ on a live unit,
 *                          the ledger names that unit.
 *
 * The held set is enumerated, never sampled: `enumerateActions` is the engine's
 * OWN enumerator (the one `projectExact` branches over), so the world set is
 * exactly the world set the engine says exists. Products past `WORLD_CAP` are
 * skipped and counted rather than truncated — a partial enumeration would
 * weaken law 1 into something that cannot fail.
 *
 * ── WHAT IT FOUND (and why parts of it are quarantined, never weakened) ────
 *
 * Two mechanisms make the current vendored uncertainty layer report a FALSE
 * PROOF. Both are pinned below as minimal `test.failing` repros stating the
 * sound property exactly; the sweeps count worlds that exhibit them instead of
 * asserting on them, and a violation in a world that exhibits NEITHER is a
 * hard failure, which is what keeps the laws live.
 *
 *   H1. THE HAZARD IS READ A TURN LATE. `Cloud.deathPossible` tests
 *       `bbIntersects(prev.everPossible, terrain.hazard)` (cloud.ts:718-723,
 *       and again in the saturation short-circuit at :582) — the cumulative
 *       reach as of the PREVIOUS turn. Its sibling term two lines up,
 *       `couldHitWall`, dilates from `prev.headPossible` and so covers the
 *       turn being resolved. A hazard a held unit can first ENTER this turn
 *       is therefore invisible for exactly one turn, the claim comes back
 *       `deathPossible: false`, and `resolveBounded` folds the unit in as
 *       survival "yes" — the certainly-alive reading whose own doc-comment
 *       (engine.ts, `mayHaveDied`) calls it "a FALSE PROOF in a CEILING".
 *
 *   H2. THE FOOTPRINT ONLY LOOKS ONE WAY. `mayHaveDied`'s footprint half is
 *       `slot.cloud.possible ∩ touched`, and `touched` is what the LIVE movers
 *       touched — origin heads and landings. A frozen unit that walks into a
 *       live unit's STATIONARY BODY is not covered by either side: the live
 *       unit never touched the cell, and a cloud is branch-independent by
 *       construction so it cannot know another unit's body is there. Both
 *       outcomes of that contact are unaccounted — the frozen unit dying to a
 *       bodyBlock (priced "yes", killed), and the frozen unit SEVERING the
 *       live one (the live unit's material changes with an EMPTY LEDGER,
 *       against the discharge theorem in as many words). The head counts as
 *       body here: a trail unit's head cell is still occupied after it steps.
 *
 * `npx jest src/tests/partial-engine-held-soundness.test.ts`
 */

import {
  Fate,
  NO_ORDER,
  PartialEngine,
  bbSet,
  makeGrid,
  makeTerrain,
  newBoard,
  enumerateActions,
  pawnTargetsInto,
  resolveBounded,
} from '../partial-engine/index';
import type { Candidate, StateHandle } from '../partial-engine/index';
import { HAZARD_DAMAGE, MAX_HEALTH, W, buildCase, buildPotionCase, mulberry32 } from './partial-engine-boards';
import type { OracleCase, Outcome } from './partial-engine-oracle';
import { engineSpecs, oracleSettlement, perimeter } from './partial-engine-oracle';

const GRID = makeGrid(W, W);
const SUBJECT_TEAM = 0;
/** Worlds one board may enumerate before it is skipped and counted. */
const WORLD_CAP = 200;
const CONFIG = { maxUnits: 8, maxTrail: 16, hazardDamage: HAZARD_DAMAGE, maxHealth: MAX_HEALTH };

interface Violation {
  seed: number;
  law: string;
  detail: string;
}

interface Stats {
  boards: number;
  worlds: number;
  skipped: number;
  heldUnits: number;
  emptyLedger: number;
  ledgerEntries: number;
  contingent: number;
  contingentRealised: number;
  heldMaybe: number;
  heldMaybeRealised: number;
  gapZero: number;
  gapTotal: number;
  spanned: number;
  differing: number;
  namedByLedger: number;
  /** Worlds exhibiting H1 / H2 — counted, so a fix upstream flips this suite. */
  hazardLate: number;
  frozenIntoBody: number;
  violations: Violation[];
}

const freshStats = (): Stats => ({
  boards: 0,
  worlds: 0,
  skipped: 0,
  heldUnits: 0,
  emptyLedger: 0,
  ledgerEntries: 0,
  contingent: 0,
  contingentRealised: 0,
  heldMaybe: 0,
  heldMaybeRealised: 0,
  gapZero: 0,
  gapTotal: 0,
  spanned: 0,
  differing: 0,
  namedByLedger: 0,
  hazardLate: 0,
  frozenIntoBody: 0,
  violations: [],
});

/** The subject-frame score of a world where every fate is known. */
function concreteScore(out: Outcome, teamOf: ReadonlyMap<number, number>): number {
  let score = 0;
  for (const [id, v] of out.survivors) {
    score += teamOf.get(id) === SUBJECT_TEAM ? v.weight : -v.weight;
  }
  return score;
}

/**
 * Every cell a LIVE unit's material stands on at turn start — H2's blind spot.
 * The head is IN: a trail unit's head cell is still occupied after it steps
 * (it becomes body index 1), so a frozen unit arriving there severs exactly as
 * it would deeper down the body, and the live unit's own origin being in
 * `touched` does nothing for it — `touched` is consulted to widen the FROZEN
 * unit's survival, never to name the live unit's material as at risk.
 */
function liveOccupancy(tc: OracleCase, heldIds: ReadonlyArray<number>): Set<number> {
  const held = new Set(heldIds);
  const out = new Set<number>();
  for (const u of tc.units) {
    if (held.has(u.unitId)) continue;
    for (const c of u.cells) out.add(c);
  }
  return out;
}

/**
 * Does this world turn on one of the two mechanisms the vendored uncertainty
 * layer does not account for? Narrow ON PURPOSE — a world that violates a law
 * for any OTHER reason is a hard failure, which is the only thing that keeps
 * these laws worth stating.
 */
function knownGapOf(
  out: Outcome,
  heldIds: ReadonlyArray<number>,
  body: ReadonlySet<number>
): { hazardLate: boolean; frozenIntoBody: boolean } {
  let hazardLate = false;
  for (const id of heldIds) {
    if (out.deaths.get(id)?.cause === 'hazard') hazardLate = true;
  }
  let frozenIntoBody = false;
  for (const clash of out.clashes) {
    // A frozen unit named in an event AT A CELL a live unit's material stands
    // on: the contact `touched` cannot see. The clash KIND is deliberately not
    // filtered — the same contact reads as a bodyBlock (the frozen unit dies),
    // a sever (the live unit is cut), or a contest (the frozen unit joins a
    // pile the live unit's body was already part of, and the pile turns fatal).
    if (!clash.playerIDs.some((p) => heldIds.includes(p))) continue;
    if (body.has(clash.index)) frozenIntoBody = true;
  }
  return { hazardLate, frozenIntoBody };
}

/** One live unit's outcome, in the one shape both timelines are read into. */
type Fingerprint = string;
const printOf = (out: Outcome, id: number): Fingerprint => {
  const v = out.survivors.get(id);
  return v === undefined ? 'dead' : `${v.cells.join('/')}@${v.health}w${v.weight}`;
};

function sweep(tc: OracleCase, seed: number, holdCount: number, stats: Stats): void {
  const specs = engineSpecs(tc);
  if (specs.length < 2) return;
  const teamOf = new Map(tc.units.map((u) => [u.unitId, u.team]));
  const potions = tc.potions ?? [];

  const foodPremise = newBoard(GRID);
  for (const c of tc.food) bbSet(foodPremise, c);
  const potionPremise = newBoard(GRID);
  for (const c of potions) bbSet(potionPremise, c);
  const engine = new PartialEngine(
    makeTerrain(GRID, perimeter(W, W), tc.hazards),
    { food: foodPremise, potions: potionPremise },
    CONFIG
  );

  // Hold the LAST `holdCount` slots: slot order is roster order, teams
  // alternate, so this takes a mixed set rather than one whole side.
  const holdSlots: number[] = [];
  for (let i = specs.length - holdCount; i < specs.length; i++) holdSlots.push(i);
  const heldIds = holdSlots.map((slot) => (specs[slot] as { unitId: number }).unitId);

  let state: StateHandle = engine.create(specs, tc.food, potions, tc.turn ?? 0);
  state = engine.holdMany(state, holdSlots);

  const liveIds = engine.units(state).map((u) => u.unitId);
  if (liveIds.length === 0) return;
  const assignment = new Map<number, number>();
  for (const id of liveIds) assignment.set(id, tc.orders.get(id) ?? NO_ORDER);

  // Every held unit's option list, through the engine's own enumerator and the
  // canonical pawn-target set (grammar.ts pawnTargetsInto: food ∪ every unit's
  // turn-start occupancy, frozen records included — exact.ts builds it the
  // same way, and a transcription here would be the second encoding again).
  const foodBoard = newBoard(GRID);
  engine.foodBoard(state, foodBoard);
  const targets = pawnTargetsInto(GRID, newBoard(GRID), foodBoard, [
    ...engine.units(state).map((u) => u.cells),
    ...state.field.slots.map((s) => s.record.occupancy),
  ]);
  const optionLists: Candidate[][] = state.field.slots.map((slot) =>
    enumerateActions(
      engine.terrain,
      slot.record.kind,
      slot.record.occupancy[0] as number,
      slot.record.orientation,
      targets
    )
  );
  const slotIds = state.field.slots.map((s) => s.record.unitId);
  let worlds = 1;
  for (const list of optionLists) worlds *= Math.max(1, list.length);
  if (worlds > WORLD_CAP) {
    stats.skipped++;
    engine.release(state);
    return;
  }

  const { resolution, bounds } = resolveBounded(engine, state, assignment, SUBJECT_TEAM);

  // The optimistic timeline, as fingerprints, plus the fates and the held
  // units' survival trits — every claim about to be checked against a world.
  const optimistic = new Map<number, Fingerprint>();
  const alive = new Map(engine.units(resolution.state).map((u) => [u.unitId, u]));
  for (const id of liveIds) {
    const v = alive.get(id);
    optimistic.set(
      id,
      v === undefined ? 'dead' : `${v.cells.join('/')}@${v.health}w${v.weight}`
    );
  }
  const fateOf = new Map(resolution.fates.map((f) => [f.unitId, f.fate]));
  const heldSurvival = new Map<number, 'yes' | 'no' | 'maybe'>();
  for (const slot of resolution.state.field.slots) {
    const reached = (resolution.mayHaveDied & (1 << slot.slot)) !== 0;
    heldSurvival.set(
      slot.record.unitId,
      slot.cloud.certainlyGone ? 'no' : slot.cloud.deathPossible || reached ? 'maybe' : 'yes'
    );
  }
  const ledgerLive = new Set(resolution.ledger.map((e) => e.liveId));

  stats.boards++;
  stats.heldUnits += heldIds.length;
  stats.ledgerEntries += resolution.ledger.length;
  if (resolution.ledger.length === 0) stats.emptyLedger++;
  stats.gapTotal += bounds.best - bounds.worst;
  if (bounds.best === bounds.worst) stats.gapZero++;
  for (const id of liveIds) if (fateOf.get(id) === Fate.Contingent) stats.contingent++;
  for (const id of heldIds) if (heldSurvival.get(id) === 'maybe') stats.heldMaybe++;

  const note = (law: string, detail: string): void => {
    if (stats.violations.length < 12) stats.violations.push({ seed, law, detail });
  };

  const seenScores = new Set<number>();
  const contingentDiffered = new Set<number>();
  const heldDied = new Set<number>();
  const heldLived = new Set<number>();

  const body = liveOccupancy(tc, heldIds);
  let hazardWorlds = 0;
  let bodyWorlds = 0;
  const picks = new Array<number>(optionLists.length).fill(0);
  for (;;) {
    // One concrete world: the live units keep their staged moves, each held
    // unit takes one of its own enumerated options, and the vendored engine
    // settles the lot.
    const orders = new Map(tc.orders);
    for (let i = 0; i < picks.length; i++) {
      const id = slotIds[i] as number;
      const list = optionLists[i] as Candidate[];
      const candidate = list[picks[i] as number];
      if (candidate === undefined) orders.delete(id);
      else orders.set(id, candidate.dest);
    }
    const world = { ...tc, orders };
    const { outcome } = oracleSettlement(world);
    stats.worlds++;
    const known = knownGapOf(outcome, heldIds, body);
    if (known.hazardLate) hazardWorlds++;
    if (known.frozenIntoBody) bodyWorlds++;
    const quarantined = known.hazardLate || known.frozenIntoBody;

    // 1. THE BRACKET.
    const score = concreteScore(outcome, teamOf);
    seenScores.add(score);
    if ((score < bounds.worst || score > bounds.best) && !quarantined) {
      note(
        'bracket',
        `world score ${score} outside [${bounds.worst}, ${bounds.best}] ` +
          `(held ${heldIds.join(',')} -> ${picks.map((p, i) => (optionLists[i] as Candidate[])[p]?.dest).join(',')})`
      );
    }

    for (const id of liveIds) {
      const fate = fateOf.get(id);
      const survived = outcome.survivors.has(id);
      // 2. THE FATES.
      if (fate === Fate.Alive && !survived && !quarantined) {
        note('fate', `unit ${id} is Fate.Alive, world killed it`);
      }
      if (fate === Fate.Dead && survived && !quarantined) {
        note('fate', `unit ${id} is Fate.Dead, world spared it`);
      }
      // 4. THE LEDGER.
      const differs = printOf(outcome, id) !== optimistic.get(id);
      if (differs) {
        stats.differing++;
        if (fate === Fate.Contingent) contingentDiffered.add(id);
        if (ledgerLive.has(id)) stats.namedByLedger++;
        else if (!quarantined) {
          note(
            'ledger',
            `unit ${id}: world ${printOf(outcome, id)} vs optimistic ${optimistic.get(id)}, ` +
              `not named in a ledger of ${resolution.ledger.length}`
          );
        }
      }
    }

    // 3. HELD SURVIVAL.
    for (const id of heldIds) {
      const survived = outcome.survivors.has(id);
      if (survived) heldLived.add(id);
      else heldDied.add(id);
      const trit = heldSurvival.get(id);
      if (trit === 'yes' && !survived && !quarantined) {
        note('held', `held unit ${id} priced "yes", world killed it (${outcome.deaths.get(id)?.cause})`);
      }
      if (trit === 'no' && survived) note('held', `held unit ${id} priced "no", world spared it`);
    }

    let i = picks.length - 1;
    for (; i >= 0; i--) {
      const next = (picks[i] as number) + 1;
      if (next < (optionLists[i] as Candidate[]).length) {
        picks[i] = next;
        for (let j = i + 1; j < picks.length; j++) picks[j] = 0;
        break;
      }
    }
    if (i < 0) break;
  }

  stats.hazardLate += hazardWorlds;
  stats.frozenIntoBody += bodyWorlds;
  stats.contingentRealised += contingentDiffered.size;
  for (const id of heldIds) {
    if (heldDied.has(id) && heldLived.has(id)) stats.heldMaybeRealised++;
  }
  // The bracket is only worth asserting where the worlds actually spread.
  if (seenScores.size > 1) stats.spanned++;

  engine.release(resolution.state);
  engine.release(state);
}

function report(label: string, stats: Stats): void {
  console.log(
    `  [${label}] boards=${stats.boards} worlds=${stats.worlds} skipped=${stats.skipped} ` +
      `held=${stats.heldUnits} ledgerEntries=${stats.ledgerEntries} emptyLedger=${stats.emptyLedger} ` +
      `contingent=${stats.contingent} (realised ${stats.contingentRealised}) ` +
      `heldMaybe=${stats.heldMaybe} (realised ${stats.heldMaybeRealised}) ` +
      `meanGap=${(stats.gapTotal / Math.max(1, stats.boards)).toFixed(2)} tight=${stats.gapZero} ` +
      `spannedBoards=${stats.spanned} differingUnitWorlds=${stats.differing} ` +
      `namedByLedger=${stats.namedByLedger} H1worlds=${stats.hazardLate} ` +
      `H2worlds=${stats.frozenIntoBody} violations=${stats.violations.length}`
  );
}

describe('a held unit: every concrete world lies inside what was reported', () => {
  test('pieces, snakes, food and hazards — 1 to 3 units held', () => {
    const stats = freshStats();
    for (let seed = 1; seed <= 260; seed++) {
      const tc = buildCase(seed);
      if (tc.units.length < 3) continue;
      const holdCount = 1 + (((mulberry32(seed * 31 + 7)() * 3) | 0) % 3);
      sweep(tc, seed, Math.min(holdCount, tc.units.length - 1), stats);
    }
    report('held/plain', stats);
    expect(stats.violations).toEqual([]);
    // Anti-vacuity: worlds that actually diverge, ledgers that actually fill,
    // and contingencies that some world actually realises.
    expect(stats.boards).toBeGreaterThan(120);
    expect(stats.worlds).toBeGreaterThan(3000);
    expect(stats.spanned).toBeGreaterThan(60);
    expect(stats.ledgerEntries).toBeGreaterThan(50);
    expect(stats.differing).toBeGreaterThan(100);
    expect(stats.heldMaybeRealised).toBeGreaterThan(5);
    // The quarantine is not allowed to be silent: these are the worlds the two
    // known gaps are counted in, and the day either is fixed upstream these
    // drop to zero and this suite says so rather than passing quietly.
    expect(stats.hazardLate).toBeGreaterThan(0);
    expect(stats.frozenIntoBody).toBeGreaterThan(0);
  }, 300_000);

  test('and again with potions, effects and non-zero tiers on the board', () => {
    const stats = freshStats();
    for (let seed = 1; seed <= 200; seed++) {
      const tc = buildPotionCase(seed);
      if (tc.units.length < 3) continue;
      const holdCount = 1 + (((mulberry32(seed * 131 + 11)() * 3) | 0) % 3);
      sweep(tc, seed, Math.min(holdCount, tc.units.length - 1), stats);
    }
    report('held/potions', stats);
    expect(stats.violations).toEqual([]);
    expect(stats.boards).toBeGreaterThan(90);
    expect(stats.worlds).toBeGreaterThan(2000);
    expect(stats.spanned).toBeGreaterThan(40);
    expect(stats.frozenIntoBody).toBeGreaterThan(0);
  }, 300_000);

  test('an empty ledger is a proof: no world moves anything', () => {
    // The discharge theorem on its own, isolated from the sweep counters —
    // this is the reading the bot's candidate filter is built on, so it gets
    // its own assertion rather than riding inside a loop of others.
    let proofs = 0;
    let checked = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const tc = buildCase(seed);
      if (tc.units.length < 3) continue;
      const stats = freshStats();
      sweep(tc, seed, 1, stats);
      if (stats.boards === 0) continue;
      checked++;
      if (stats.emptyLedger === 1 && stats.frozenIntoBody === 0) {
        proofs++;
        // Every ledger-empty board must have produced no differing unit at
        // all. H2 boards are excluded here and asserted on their own, minimal,
        // in the `test.failing` below — that is the quarantine, not a weaker
        // law: any OTHER board that differs on an empty ledger fails here.
        expect([`seed ${seed}`, stats.differing]).toEqual([`seed ${seed}`, 0]);
      }
      expect(stats.violations).toEqual([]);
    }
    console.log(`  [discharge] ${proofs} of ${checked} boards proved by an empty ledger`);
    expect(proofs).toBeGreaterThan(20);
  }, 300_000);
});


// ---------------------------------------------------------------------------
// The two findings, minimal. `test.failing` states the SOUND property: it
// reports green while the property is violated and turns red the day it holds,
// which is exactly what a quarantined bug wants — the day either mechanism is
// fixed upstream, this file says so twice (here, and in the sweep counters).
// ---------------------------------------------------------------------------

const at = (x: number, y: number): number => y * W + x;

interface Scenario {
  trits: Map<number, 'yes' | 'no' | 'maybe'>;
  ledger: number;
  bounds: { worst: number; best: number };
  optimistic: Map<number, string>;
  world: (dests: ReadonlyMap<number, number>) => {
    outcome: Outcome;
    score: number;
    print: (id: number) => string;
  };
}

/** One tiny board, held, priced, and ready to be asked about a named world. */
function scenario(
  units: OracleCase['units'],
  heldIds: ReadonlyArray<number>,
  orders: Array<[number, number]>,
  hazards: number[] = [],
  hazardDamage = HAZARD_DAMAGE
): Scenario {
  const tc: OracleCase = {
    width: W,
    height: W,
    units,
    food: [],
    hazards,
    hazardDamage,
    maxHealth: MAX_HEALTH,
    orders: new Map(orders),
  };
  const specs = engineSpecs(tc);
  const engine = new PartialEngine(
    makeTerrain(GRID, perimeter(W, W), hazards),
    { food: newBoard(GRID), potions: newBoard(GRID) },
    { ...CONFIG, hazardDamage }
  );
  let state = engine.create(specs, [], [], 0);
  state = engine.holdMany(
    state,
    heldIds.map((id) => specs.findIndex((sp) => sp.unitId === id))
  );
  const assignment = new Map<number, number>();
  for (const u of engine.units(state)) assignment.set(u.unitId, tc.orders.get(u.unitId) ?? NO_ORDER);
  const { resolution, bounds } = resolveBounded(engine, state, assignment, SUBJECT_TEAM);
  const trits = new Map<number, 'yes' | 'no' | 'maybe'>();
  for (const slot of resolution.state.field.slots) {
    const reached = (resolution.mayHaveDied & (1 << slot.slot)) !== 0;
    trits.set(
      slot.record.unitId,
      slot.cloud.certainlyGone ? 'no' : slot.cloud.deathPossible || reached ? 'maybe' : 'yes'
    );
  }
  const optimistic = new Map<number, string>();
  for (const v of engine.units(resolution.state)) {
    optimistic.set(v.unitId, `${v.cells.join('/')}w${v.weight}`);
  }
  const teamOf = new Map(units.map((u) => [u.unitId, u.team]));
  return {
    trits,
    ledger: resolution.ledger.length,
    bounds: { worst: bounds.worst, best: bounds.best },
    optimistic,
    world: (dests) => {
      const worldOrders = new Map(tc.orders);
      for (const [id, dest] of dests) worldOrders.set(id, dest);
      const { outcome } = oracleSettlement({ ...tc, orders: worldOrders });
      return {
        outcome,
        score: concreteScore(outcome, teamOf),
        print: (id: number) => {
          const v = outcome.survivors.get(id);
          return v === undefined ? 'dead' : `${v.cells.join('/')}w${v.weight}`;
        },
      };
    },
  };
}

describe('H1: a hazard the held unit can first enter THIS turn', () => {
  // cloud.ts:718-723. `deathPossible` asks whether the hazard board intersects
  // `prev.everPossible` — where the unit could have been as of LAST turn — while
  // its sibling `couldHitWall`, three lines above, dilates from
  // `prev.headPossible` and so covers the turn being resolved. The knight below
  // is held at (7,2) with the hazard at (5,3), one L-jump away and lethal
  // (hazardDamage 100 against health 99). Nothing else is on the board within
  // reach of anything.
  const board = (): Scenario =>
    scenario(
      [
        { unitId: 0, kind: 2, team: 0, cells: [at(1, 7)], weight: 1, health: 100, tier: 0, orientation: 0 },
        { unitId: 1, kind: 1, team: 1, cells: [at(7, 2)], weight: 1, health: 99, tier: 0, orientation: 1 },
      ],
      [1],
      [],
      [at(5, 3)],
      100
    );

  test('the world is real: the jump onto the hazard kills it', () => {
    const s = board();
    const w = s.world(new Map([[1, at(5, 3)]]));
    expect(w.outcome.deaths.get(1)?.cause).toBe('hazard');
    expect(w.print(1)).toBe('dead');
  });

  test.failing('and the held unit is therefore not certainly alive', () => {
    // THE SOUND PROPERTY: a unit some legal world kills may not be priced
    // "yes". Reported: "yes".
    expect(board().trits.get(1)).toBe('maybe');
  });

  test.failing('and the bracket contains the world where it dies', () => {
    // The consequence, in the number a searcher actually discards branches on:
    // the enemy knight's death is the subject's BEST world, so pricing it
    // certainly-alive puts a real world above the ceiling.
    const s = board();
    const w = s.world(new Map([[1, at(5, 3)]]));
    expect(w.score).toBeLessThanOrEqual(s.bounds.best);
  });
});

describe('H2: a frozen unit walking into a live unit\'s standing body', () => {
  // engine.ts, `mayHaveDied`: the footprint half is `cloud.possible ∩ touched`,
  // and `touched` holds the LIVE movers' origins and landings. A live trail
  // unit's body is neither. The snake below steps west and keeps two of its
  // three cells exactly where they were; the held knight jumps onto one of
  // them. A KNIGHT because its claim is a scattered set: from (6,4) none of
  // its eight landings is the snake's origin (3,3) or its landing (2,3), so
  // `possible ∩ touched` really is empty and the blind spot is isolated. (A
  // bishop on the same board contests the snake's landing square by accident
  // and is priced "maybe" for the wrong reason — which is how narrow the gap
  // is, not how rare: the sweep above meets it on 504 worlds.)
  const snakeAndKnight = (knightTier: number, snakeTier: number): Scenario =>
    scenario(
      [
        {
          unitId: 0,
          kind: 0,
          team: 0,
          cells: [at(3, 3), at(4, 3), at(5, 3)],
          weight: 3,
          health: 100,
          tier: snakeTier,
          orientation: 3,
        },
        {
          unitId: 1,
          kind: 1,
          team: 1,
          cells: [at(6, 4)],
          weight: 1,
          health: 100,
          tier: knightTier,
          orientation: 1,
        },
      ],
      [1],
      [],
      []
    );

  test('the world is real: the snake keeps the cell and the knight dies on it', () => {
    const s = snakeAndKnight(0, 0);
    const w = s.world(new Map([[1, at(4, 3)]]));
    expect(w.outcome.deaths.get(1)?.cause).toBe('bodyBlock');
    // The snake stepped west and cell (4,3) is now its body index 1.
    expect(w.print(0)).toBe(`${at(2, 3)}/${at(3, 3)}/${at(4, 3)}w3`);
  });

  test.failing('and the held knight is therefore not certainly alive', () => {
    // THE SOUND PROPERTY, again: some legal world kills it. Reported: "yes".
    expect(snakeAndKnight(0, 0).trits.get(1)).toBe('maybe');
  });

  test('the world is real the other way too: a higher tier SEVERS the snake', () => {
    const s = snakeAndKnight(1, 0);
    const w = s.world(new Map([[1, at(4, 3)]]));
    expect(w.outcome.clashes.some((c) => c.kind === 'sever')).toBe(true);
    expect(w.print(0)).toBe(`${at(2, 3)}/${at(3, 3)}w2`);
  });

  test.failing('and an empty ledger then claims a proof it does not have', () => {
    // THE DISCHARGE THEOREM, stated as the engine states it (index.ts): "an
    // empty ledger is a proof". Here the ledger is empty and a legal world
    // takes a third of the live snake off the board.
    const s = snakeAndKnight(1, 0);
    const w = s.world(new Map([[1, at(4, 3)]]));
    expect([s.ledger, w.print(0)]).toEqual([s.ledger, s.optimistic.get(0)]);
  });
});
