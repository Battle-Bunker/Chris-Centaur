/**
 * THE RUNG-1/2 EDGE-EV PASS — the mechanisms, the laws, the budget, the probe.
 *
 * Four parts, and the second is the one that lets the layer ship:
 *
 *   MECHANISM  each term does the thing it claims, on a fixture built for it.
 *   LAWS       the slot is a no-op when the terms are zero (so the flags-off
 *              order is the shipped order by construction and not by luck);
 *              EV-CLIFF holds at the position's own roster; and every term
 *              sourced from enemy geometry has the one polarity rule 21 allows.
 *   BUDGET     the shipped pass (two race floods + φ_u) priced at 24 units,
 *              with the LAZY pair layer priced separately because nothing in
 *              this stage consumes it.
 *   PROBE      the mechanism metrics, off against on, over generated boards:
 *              uncontested capture up, the trade at least even, no new deaths.
 *
 * No live games: every board here is a fixture, every board is generated from
 * a fixed seed, and every verdict comes from the real resolver.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { EngineSubstrate, SubstrateUnit } from '../substrate';
import { GrammarCandidateGenerator, orderingComparator } from '../candidates';
import { defaultEvaluator } from '../evaluate';
import { makeSearchCore } from '../search';
import { unboundedBudget } from '../bounds/testkit';
import type { AssessedCandidate } from '../candidates';
import {
  DecisionEconomy,
  EdgeEvStore,
  LAT,
  MEAL_MATERIAL_LAT,
  ZERO_PARTS,
  nonMaterialSpan,
  pairTable,
  unaryParts,
} from '../search/edge-ev';
import type { PairInput, UnaryParts } from '../search/edge-ev';
import type { CellIndex, UnitId } from '../contracts';

// --------------------------------------------------------------------- fixtures

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

const TURN = 30;

afterEach(() => clearGeometryCache());

/**
 * `(x, y)` in API coordinates, as the engine's flat cell index.
 *
 * Two transforms, and getting either wrong silently addresses a different
 * square: the engine board carries a WALL RING, so every api coordinate is
 * offset by one, and api `y` grows UPWARD while the engine's grows downward.
 * This is `apiCoordToIndex` written out for a fixture whose board size is
 * known — not a second convention.
 */
const at = (x: number, y: number, width = 11, height = 11): CellIndex =>
  ((height - y) * (width + 2) + x + 1) as CellIndex;

interface Rig {
  sub: EngineSubstrate;
  economy: DecisionEconomy;
  unit: SubstrateUnit;
  close(): void;
}

function rig(
  board: Board,
  wireId: string,
  team = 'red',
  tuning: ConstructorParameters<typeof DecisionEconomy>[2] = {}
): Rig {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: team });
  const unit = sub.unitOfWireId(wireId);
  if (unit === undefined) throw new Error(`no unit ${wireId} on the fixture`);
  const economy = new DecisionEconomy(sub, sub.teamNumber(team), tuning);
  return { sub, economy, unit, close: () => sub.release() };
}

/** φ_u for one destination of one unit, through the real assessment. */
function partsFor(r: Rig, gen: GrammarCandidateGenerator, to: CellIndex): UnaryParts {
  const assessed = gen.assess(r.sub, r.unit.unitId);
  const one = assessed.find((a) => a.candidate.to === (to as number));
  if (one === undefined) {
    throw new Error(
      `no candidate to ${to}; the unit offers ${assessed.map((a) => a.candidate.to).join(',')}`
    );
  }
  return unaryParts(r.economy, r.sub, r.unit, {
    candidate: one.candidate,
    landing: one.landing,
    healthSpent: one.healthSpent,
    tier: one.tier,
    capture: one.capture,
    survivalPrior: one.survivalPrior,
  });
}

// ---------------------------------------------------------------------------

describe('the configuration', () => {
  test('with it off no candidate carries an EV at all', () => {
    const board = foodBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator({ edgeEv: false });
    for (const id of sub.commandable(sub.teamNumber('red'))) {
      for (const a of gen.assess(sub, id)) expect(a.edgeEv).toBe(0);
    }
    sub.release();
  });
});

// ---------------------------------------------------------------------------

/**
 * THE LAW THE SLOT OWES.
 *
 * A pass that is supposed to change the order through exactly one field has to
 * be checked on exactly that field. Zero it and the order must collapse to the
 * one the same board produces with the pass off — for every unit, every
 * candidate, in position.
 */
describe('the ordering slot', () => {
  test('orderKey is unchanged when every term is zero', () => {
    for (const gainOrdering of [true, false]) {
      const board = foodBoard();
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const off = new GrammarCandidateGenerator({ edgeEv: false, gainOrdering });
      const on = new GrammarCandidateGenerator({ edgeEv: true, gainOrdering });
      const cmp = orderingComparator(gainOrdering);
      let sawNonZero = false;
      for (const id of sub.commandable(sub.teamNumber('red'))) {
        const shipped = off.assess(sub, id).map((a) => a.candidate.to);
        const priced = on.assess(sub, id);
        if (priced.some((a) => a.edgeEv !== 0)) sawNonZero = true;
        const zeroed = priced
          .map((a): AssessedCandidate => ({ ...a, edgeEv: 0 }))
          .sort(cmp)
          .map((a) => a.candidate.to);
        expect(zeroed).toEqual(shipped);
      }
      // Non-vacuity: the fixture must actually price something, or the
      // assertion above is true of an empty change.
      expect(sawNonZero).toBe(true);
      sub.release();
    }
  });

  test('the EV never outranks a tier, a capture, or a meal', () => {
    // The slot placement IS the soundness argument at this seam, so it is
    // asserted against a synthetic pair rather than hoped for: a candidate
    // whose EV is the largest the terms can produce still sorts behind one
    // that beats it on any of the three material-class keys above the slot.
    const base: AssessedCandidate = {
      candidate: { unitId: 1 as UnitId, from: 0 as CellIndex, to: 1 as CellIndex, path: [] },
      tier: 'safe',
      capture: 'no',
      healthSpent: { lo: 0, hi: 0 },
      exhaustionFatal: 'no',
      landing: [1 as CellIndex],
      tierGrade: 'clear',
      selfDebuff: 'none',
      contingencies: 0,
      potionGain: 0,
      shadowBonus: 0,
      foodGain: 0,
      regicideShot: 0,
      survivorsAfter: -1,
      survivalPrior: 1,
      edgeEv: 0,
    };
    const rich = { ...base, edgeEv: 1000, candidate: { ...base.candidate, to: 2 as CellIndex } };
    for (const gainOrdering of [true, false]) {
      const cmp = orderingComparator(gainOrdering);
      expect(cmp(rich, { ...base, tier: 'safe' })).toBeLessThan(0); // nothing above it: EV wins
      expect(cmp({ ...rich, tier: 'atRisk' }, base)).toBeGreaterThan(0); // tier wins
      expect(cmp(rich, { ...base, capture: 'yes' })).toBeGreaterThan(0); // capture wins
    }
    // The meal slot exists only in the gain order, which is the shipped one.
    expect(orderingComparator(true)(rich, { ...base, foodGain: 1 })).toBeGreaterThan(0);
  });

  test('THE PICKUP SLOT: below the meal, above the quiet, inert when unset', () => {
    /*
     * The slot placement is the argument, so it is asserted rather than
     * described. A collection is a GAIN — it opens a three-turn window the
     * whole team can cut inside — but it is not a meal: food is the resource a
     * unit dies without. So the slot sits under `foodGain` and over everything
     * quiet, and a tier or a capture still outranks it, because ordering never
     * licenses a move.
     *
     * The last assertion is the one that keeps the shipped comparator honest:
     * `potionGain` is written zero at assessment time unless `potionOrdering`
     * is set, so this line is inert in every bot that does not name the knob.
     */
    const base: AssessedCandidate = {
      candidate: { unitId: 1 as UnitId, from: 0 as CellIndex, to: 1 as CellIndex, path: [] },
      tier: 'safe',
      capture: 'no',
      healthSpent: { lo: 0, hi: 0 },
      exhaustionFatal: 'no',
      landing: [1 as CellIndex],
      tierGrade: 'clear',
      selfDebuff: 'none',
      contingencies: 0,
      potionGain: 0,
      shadowBonus: 0,
      foodGain: 0,
      regicideShot: 0,
      survivorsAfter: -1,
      survivalPrior: 1,
      edgeEv: 0,
    };
    const cmp = orderingComparator(true);
    const pickup = { ...base, potionGain: 1, candidate: { ...base.candidate, to: 2 as CellIndex } };
    // Above the quiet move it is being compared with.
    expect(cmp(pickup, base)).toBeLessThan(0);
    // Below a meal, and below everything the material class already ranked.
    expect(cmp(pickup, { ...base, foodGain: 1 })).toBeGreaterThan(0);
    expect(cmp(pickup, { ...base, capture: 'yes' })).toBeGreaterThan(0);
    expect(cmp({ ...pickup, tier: 'atRisk' }, base)).toBeGreaterThan(0);
    // A pickup that outranks the quiet move on the shadow slot below it still
    // wins on the pickup slot, which is what "above the quiet" means.
    expect(cmp(pickup, { ...base, shadowBonus: 1 })).toBeLessThan(0);
    // INERT WHEN UNSET: two candidates that differ in nothing else sort by the
    // keys they always did.
    expect(cmp({ ...pickup, potionGain: 0 }, base)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('the meal refund magnitude (E2)', () => {
  test('a longer approach to food refunds more, because the spend comes back', () => {
    // One queen, two foods: one a single step away, one four cells down the
    // same ray. The eater's health goes to its kind's maximum on arrival, so
    // the far meal both costs nothing AND tops up more — and until this term
    // existed the order could not tell the two apart at all.
    const board = {
      width: 11,
      height: 11,
      food: [
        { x: 5, y: 4 },
        { x: 9, y: 4 },
      ],
      hazards: [],
      snakes: [
        makeSnake('Q', [{ x: 4, y: 4 }], { teamID: 'red', health: 60 }),
      ],
    } as unknown as Board;
    const r = rig(withKinds(board, { Q: 'queen' }), 'Q');
    const gen = new GrammarCandidateGenerator({ edgeEv: true });
    const near = partsFor(r, gen, at(5, 4));
    const far = partsFor(r, gen, at(9, 4));
    expect(near.meal).toBeGreaterThan(0);
    expect(far.meal).toBeGreaterThan(near.meal);
    // And both are above the material step, which is what keeps a meal ahead
    // of every quiet move once the two are compared in the same currency.
    expect(near.meal).toBeGreaterThanOrEqual(MEAL_MATERIAL_LAT);
    r.close();
  });

  test('a meal is worth more to a hungry unit than to a full one', () => {
    // The same move, the same cell, two different healths — E2 stated at its
    // source: "a queen at h=8 gains 92 cells of future travel; the same queen
    // at h=95 gains 5."
    const make = (health: number): UnaryParts => {
      const board = {
        width: 11,
        height: 11,
        food: [{ x: 5, y: 4 }],
        hazards: [],
        snakes: [makeSnake('Q', [{ x: 4, y: 4 }], { teamID: 'red', health })],
      } as unknown as Board;
      const r = rig(withKinds(board, { Q: 'queen' }), 'Q');
      const gen = new GrammarCandidateGenerator({ edgeEv: true });
      const parts = partsFor(r, gen, at(5, 4));
      r.close();
      clearGeometryCache();
      return parts;
    };
    expect(make(8).meal).toBeGreaterThan(make(95).meal);
  });

  test('the health currency is ORDERING-INERT within a unit, and is kept anyway', () => {
    // Within one unit `maxHealth` is a constant, so φ_health is a strictly
    // decreasing function of `healthSpent.hi` — the key one slot BELOW it. It
    // therefore induces the identical order and can never move a comparison
    // the shipped key would not have moved. Pinned here because the fact is
    // load-bearing twice over: it is why this term is safe, and it is why
    // i2's "fix the ordering and the 1 s gain appears at 150 ms" falsifier
    // cannot be run by adding a health term to a comparator that already sorts
    // on the same quantity. The cap has to become a sample, which is CL4.
    const board = {
      width: 11,
      height: 11,
      food: [],
      hazards: [],
      snakes: [makeSnake('Q', [{ x: 4, y: 4 }], { teamID: 'red', health: 60 })],
    } as unknown as Board;
    const r = rig(withKinds(board, { Q: 'queen' }), 'Q');
    const gen = new GrammarCandidateGenerator({ edgeEv: true });
    const rows = gen
      .assess(r.sub, r.unit.unitId)
      .map((a) => ({ spent: a.healthSpent.hi, health: partsFor(r, gen, a.candidate.to as CellIndex).health }));
    expect(rows.length).toBeGreaterThan(4);
    let sawSpread = false;
    for (const a of rows) {
      for (const b of rows) {
        if (a.spent === b.spent) {
          expect(a.health).toBeCloseTo(b.health, 12);
          continue;
        }
        sawSpread = true;
        // Strictly decreasing in the same quantity, so the induced order is
        // the shipped one.
        expect(a.spent < b.spent).toBe(a.health > b.health);
      }
    }
    expect(sawSpread).toBe(true);
    r.close();
  });

  test('the health currency is charged at zero when the move eats', () => {
    const board = {
      width: 11,
      height: 11,
      food: [{ x: 5, y: 4 }],
      hazards: [],
      snakes: [makeSnake('Q', [{ x: 4, y: 4 }], { teamID: 'red', health: 60 })],
    } as unknown as Board;
    const r = rig(withKinds(board, { Q: 'queen' }), 'Q');
    const gen = new GrammarCandidateGenerator({ edgeEv: true });
    expect(partsFor(r, gen, at(5, 4)).health).toBe(0);
    // A move of the same length that does not eat is charged.
    expect(partsFor(r, gen, at(3, 4)).health).toBeLessThan(0);
    r.close();
  });
});

// ---------------------------------------------------------------------------

describe('the turn-cap horizon gate (E9)', () => {
  test('with no cap configured, nothing is zeroed — production has no cap', () => {
    const board = farFoodBoard();
    const r = rig(board, 'A');
    expect(r.economy.turnsRemaining).toBe(Number.POSITIVE_INFINITY);
    expect(r.economy.withinHorizon(at(9, 9))).toBe(true);
    r.close();
  });

  test('a cap already past zeroes a meal the clock cannot reach', () => {
    // The cell is chosen from the flood's OWN answer rather than counted by
    // hand, so the assertion is about the gate and not about a fixture's
    // geometry: whatever depth our side reads at this cell, a cap one turn
    // short of it must close and a cap past it must not.
    const board = farFoodBoard();
    const probe = rig(board, 'A');
    const cell = at(4, 1);
    const depth = probe.economy.fronts.ourDepthAt(cell);
    probe.close();
    clearGeometryCache();
    expect(depth).toBeGreaterThan(0);

    const tight = rig(board, 'A', 'red', { turnCap: TURN + depth - 1 });
    expect(tight.economy.turnsRemaining).toBe(depth - 1);
    expect(tight.economy.withinHorizon(cell)).toBe(false);
    tight.close();
    clearGeometryCache();

    const roomy = rig(board, 'A', 'red', { turnCap: TURN + depth });
    expect(roomy.economy.withinHorizon(cell)).toBe(true);
    roomy.close();
  });

  test('a cell the flood never reached is NOT zeroed', () => {
    // Unreached says nothing about the clock. Only a KNOWN depth past the cap
    // is a proof of worthlessness, and zeroing real food on a silence would be
    // exactly the failure E9 names for reading a cap that does not exist.
    const board = farFoodBoard();
    const r = rig(board, 'A', 'red', { turnCap: TURN + 1, raceHorizon: 0 });
    expect(r.economy.fronts.ourDepthAt(at(9, 9))).toBe(-1);
    expect(r.economy.withinHorizon(at(9, 9))).toBe(true);
    r.close();
  });
});

// ---------------------------------------------------------------------------

describe('the race margin (E8), and its polarity', () => {
  test('the fronts settle the FOOD, and a foodless board does not flood at all', () => {
    // The floods exist to answer one question, so they are terminated at the
    // cells that asked it. A depth at a non-food cell is best-effort and
    // generally absent — that is the contract, and reading it as "nobody is
    // racing for this" is the only answer a down-only term may give.
    const r = rig(raceBoard(), 'A');
    expect(r.economy.fronts.ourDepthAt(at(3, 5))).toBe(1);
    // The far food is five steps away and the flood horizon is four, so our
    // side never settles it — and that silence reads, correctly, as theirs.
    expect(r.economy.fronts.ourDepthAt(at(7, 5))).toBe(-1);
    expect(r.economy.fronts.lossFractionAt(at(7, 5))).toBe(1);
    r.close();
    clearGeometryCache();

    const bare = rig(bareRaceBoard(), 'A');
    expect(bare.economy.fronts.ourDepthAt(at(3, 5))).toBe(-1);
    // And nothing is charged for the silence.
    expect(bare.economy.fronts.lossFractionAt(at(3, 5))).toBe(0);
    bare.close();
  });

  test('a cell we own by two turns forfeits nothing; one they own forfeits all', () => {
    const r = rig(raceBoard(), 'A');
    // (3,5) is one step from our head and five from theirs.
    expect(r.economy.fronts.lossFractionAt(at(3, 5))).toBe(0);
    // (7,5) is one step from theirs and five from ours.
    expect(r.economy.fronts.lossFractionAt(at(7, 5))).toBe(1);
    r.close();
  });

  test('RULE 21: the race term is bounded above by zero everywhere', () => {
    // The one term here that reads `dist(theirs)`. Enemy geometry may withdraw
    // a penalty and may never grant a bonus, so this is not "usually negative"
    // — it is negative-or-zero at every cell of every candidate on the board.
    const board = contestedFoodBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const economy = new DecisionEconomy(sub, sub.teamNumber('red'));
    const gen = new GrammarCandidateGenerator({ edgeEv: true });
    let sawPenalty = false;
    for (const id of sub.commandable(sub.teamNumber('red'))) {
      const unit = sub.unitOf(id);
      if (unit === undefined) continue;
      for (const a of gen.assess(sub, id)) {
        const parts = unaryParts(economy, sub, unit, {
          candidate: a.candidate,
          landing: a.landing,
          healthSpent: a.healthSpent,
          tier: a.tier,
          capture: a.capture,
          survivalPrior: a.survivalPrior,
        });
        expect(parts.race).toBeLessThanOrEqual(0);
        if (parts.race < 0) sawPenalty = true;
      }
    }
    expect(sawPenalty).toBe(true);
    sub.release();
  });

  test('the race is read at FOOD and nowhere else — it is not a repulsion field', () => {
    // A quiet cell the enemy is nearer to costs nothing. A term that charged
    // for that would be a "stay away from them" map, which is the passivity
    // attractor in its purest form and is not what E8 measured.
    const board = raceBoard();
    const r = rig(board, 'A');
    const gen = new GrammarCandidateGenerator({ edgeEv: true });
    expect(partsFor(r, gen, at(3, 5)).race).toBe(0);
    r.close();
  });
});

// ---------------------------------------------------------------------------

describe('the potion terms (E3d, F7), and their polarity', () => {
  test('every collector is charged its own −1, buffed or not', () => {
    const board = potionBoard(0);
    const r = rig(board, 'A');
    const gen = new GrammarCandidateGenerator({ edgeEv: true });
    const onPotion = partsFor(r, gen, at(3, 5));
    const elsewhere = partsFor(r, gen, at(2, 6));
    expect(onPotion.potion).toBeLessThan(0);
    expect(elsewhere.potion).toBe(0);
    r.close();
  });

  test('an ALREADY-BUFFED collector is charged twice — the wasted pickup', () => {
    const clean = potionParts(0);
    const buffed = potionParts(2);
    expect(buffed).toBeLessThan(clean);
    expect(clean).toBeLessThan(0);
  });

  test('RULE 21: the potion channel over unary + pair stays bounded by zero', () => {
    // The pair edge reads ENEMY WEIGHTS. It may therefore only give back what
    // the unary already charged, and the suite checks the sum rather than the
    // sign of either half — which is where a future edge that ADDED for an
    // enemy would break while looking exactly like this one.
    const board = windowBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator({ edgeEv: true });
    const economy = new DecisionEconomy(sub, sub.teamNumber('red'));
    const collector = sub.unitOfWireId('A') as SubstrateUnit;
    const ally = sub.unitOfWireId('B') as SubstrateUnit;
    const inputs = [collector, ally].map((u) => pairInputFor(sub, gen, economy, u));
    const table = pairTable(sub, inputs[0] as PairInput, inputs[1] as PairInput);
    expect(table).not.toBeNull();
    const window = (table as NonNullable<typeof table>).cells.filter(
      (c) => c.family === 'potionWindow'
    );
    expect(window.length).toBeGreaterThan(0);
    for (const cell of window) {
      const unary = (inputs[0] as PairInput).options[cell.ia];
      const own = unaryPotionOf(sub, gen, economy, collector, cell.ia);
      expect(unary).toBeDefined();
      // The withdrawal never exceeds what was charged.
      expect(own + cell.ev).toBeLessThanOrEqual(0);
    }
    sub.release();
  });
});

// ---------------------------------------------------------------------------

describe('the fatal term (rank 7)', () => {
  test('is exactly zero unless the rung-0 classifier ran', () => {
    // What makes this flag compose with `unitFatality` instead of being a
    // paired experiment with it: with the classifier off the prior is 1 and
    // the term is identically zero, so the EV measured here is the economy
    // terms alone.
    const board = pocketBoard();
    const r = rig(board, 'A');
    const gen = new GrammarCandidateGenerator({ edgeEv: true, unitFatality: false });
    const assessed = gen.assess(r.sub, r.unit.unitId);
    expect(assessed.length).toBeGreaterThan(0);
    for (const a of assessed) {
      expect(a.survivalPrior).toBe(1);
      expect(partsFor(r, gen, a.candidate.to as CellIndex).fatal).toBe(0);
    }
    r.close();
  });

  test('prices a sealed move as expected material lost, in lat', () => {
    const board = pocketBoard();
    const r = rig(board, 'A');
    const gen = new GrammarCandidateGenerator({
      edgeEv: true,
      unitFatality: true,
      pruneCertainSelfFatal: false,
    });
    const assessed = gen.assess(r.sub, r.unit.unitId);
    const scored = assessed.filter((a) => a.survivorsAfter >= 0);
    expect(scored.length).toBeGreaterThan(0);
    for (const a of scored) {
      const parts = unaryParts(r.economy, r.sub, r.unit, {
        candidate: a.candidate,
        landing: a.landing,
        healthSpent: a.healthSpent,
        tier: a.tier,
        capture: a.capture,
        survivalPrior: a.survivalPrior,
      });
      expect(parts.fatal).toBeCloseTo(-(1 - a.survivalPrior) * r.unit.weight, 10);
      expect(parts.fatal).toBeLessThanOrEqual(0);
    }
    r.close();
  });
});

// ---------------------------------------------------------------------------

describe('the pairwise tables', () => {
  test('sharedPrize is exactly the double count, and vanishes when it is not shared', () => {
    const board = sharedFoodBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator({ edgeEv: true });
    const economy = new DecisionEconomy(sub, sub.teamNumber('red'));
    const a = pairInputFor(sub, gen, economy, sub.unitOfWireId('A') as SubstrateUnit);
    const b = pairInputFor(sub, gen, economy, sub.unitOfWireId('B') as SubstrateUnit);
    const table = pairTable(sub, a, b);
    expect(table).not.toBeNull();
    const shared = (table as NonNullable<typeof table>).cells.filter(
      (c) => c.family === 'sharedPrize'
    );
    expect(shared.length).toBeGreaterThan(0);
    for (const cell of shared) {
      const ea = (a.options[cell.ia] as PairInput['options'][number]).mealEv;
      const eb = (b.options[cell.ib] as PairInput['options'][number]).mealEv;
      // INCLUSION-EXCLUSION, exactly: one meal exists, two were credited.
      expect(cell.ev).toBeCloseTo(-Math.min(ea, eb), 12);
      // And the pair only fires where the two really do land together.
      const la = (a.options[cell.ia] as PairInput['options'][number]).landing;
      const lb = (b.options[cell.ib] as PairInput['options'][number]).landing;
      expect(la.some((c) => lb.includes(c) && sub.foodAt(c))).toBe(true);
    }
    sub.release();
  });

  test('a unit is never paired with itself, and an empty edge is null', () => {
    const board = raceBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator({ edgeEv: true });
    const economy = new DecisionEconomy(sub, sub.teamNumber('red'));
    const a = pairInputFor(sub, gen, economy, sub.unitOfWireId('A') as SubstrateUnit);
    expect(pairTable(sub, a, a)).toBeNull();
    sub.release();
  });

  test('the store keys an edge once, whichever way round it is asked for', () => {
    const store = new EdgeEvStore();
    store.setPair({ a: 7 as UnitId, b: 3 as UnitId, cells: [], mass: 2 });
    expect(store.pairOf(3 as UnitId, 7 as UnitId)?.mass).toBe(2);
    expect(store.pairOf(7 as UnitId, 3 as UnitId)?.mass).toBe(2);
    expect(store.pairCount).toBe(1);
    // And an unset unary reads as the zero row rather than as undefined: a
    // consumer that has to null-check a potential will eventually forget to.
    expect(store.unaryAt(1 as UnitId, 4 as CellIndex)).toBe(ZERO_PARTS);
  });

  test('edges come back heaviest first — the repair and sampling order', () => {
    const store = new EdgeEvStore();
    store.setPair({ a: 1 as UnitId, b: 2 as UnitId, cells: [], mass: 0.1 });
    store.setPair({ a: 3 as UnitId, b: 4 as UnitId, cells: [], mass: 0.9 });
    expect(store.edgesByMass().map((e) => e.mass)).toEqual([0.9, 0.1]);
  });
});

// ---------------------------------------------------------------------------

describe('EV-CLIFF, at the position own roster', () => {
  test('the non-material families span under one lat on a real board', () => {
    // The shipped invariant is that a feature may not outbid one unit's life.
    // Its edge analogue is the same statement one level down, and it is
    // measured ACROSS CANDIDATES because comparisons are always between plans
    // of the same position — a fixture's roster is not the position's, which
    // is why this walks the board's real units.
    for (const make of [foodBoard, contestedFoodBoard, potionBoard.bind(null, 2)]) {
      const board = make();
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const gen = new GrammarCandidateGenerator({ edgeEv: true, unitFatality: true });
      const economy = new DecisionEconomy(sub, sub.teamNumber('red'));
      for (const id of sub.commandable(sub.teamNumber('red'))) {
        const unit = sub.unitOf(id);
        if (unit === undefined) continue;
        const parts = gen.assess(sub, id).map((a) =>
          unaryParts(economy, sub, unit, {
            candidate: a.candidate,
            landing: a.landing,
            healthSpent: a.healthSpent,
            tier: a.tier,
            capture: a.capture,
            survivalPrior: a.survivalPrior,
          })
        );
        expect(nonMaterialSpan(parts)).toBeLessThan(1);
      }
      sub.release();
      clearGeometryCache();
    }
  });

  test('one lat is ten score units, and nothing here quietly redefines it', () => {
    expect(LAT).toBe(10);
    expect(MEAL_MATERIAL_LAT).toBe(1);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE BUDGET.
 *
 * The costed slice is ~50 µs per decision for the whole rung-1/2 pass at 24
 * units: the two race floods, φ_u for every candidate of every unit, and the
 * pair tables over every commandable pair. What is timed is all three.
 *
 * The ceiling is set against the IN-HARNESS number. ts-jest runs this class of
 * code about 6× slower than a compiled standalone — measured on the conflict
 * index in its own suite, whose empty-body floor is 18× higher — so 50 µs
 * compiled is ~300 µs here, and the assertion carries room for a loaded box on
 * top of that. The raw number is printed rather than hidden so a regression
 * shows up as a number and not as a pass.
 */
describe('the pass stays inside its budget', () => {
  test('the whole rung-1/2 pass at 24 units', () => {
    const board = benchBoard(24);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const asTeam = sub.teamNumber('red');
    const gen = new GrammarCandidateGenerator({ edgeEv: true, unitFatality: true });
    const ours = [...sub.commandable(asTeam)];
    expect(ours.length).toBe(24);
    // The assessment itself is NOT in the timed region: it is the candidate
    // layer's own cost and it is paid whether or not this pass runs. What is
    // timed is what this stage ADDS.
    const assessed = new Map(ours.map((id) => [id, gen.assess(sub, id)]));

    /** The floods, once per decision. */
    const fronts = (): DecisionEconomy => new DecisionEconomy(sub, asTeam);

    /** φ_u for every candidate of every unit — the pass the ordering runs. */
    const unaries = (economy: DecisionEconomy, store: EdgeEvStore): PairInput[] => {
      const inputs: PairInput[] = [];
      for (const id of ours) {
        const unit = sub.unitOf(id);
        const set = assessed.get(id);
        if (unit === undefined || set === undefined) continue;
        const options: Array<{ landing: ReadonlyArray<CellIndex>; mealEv: number }> = [];
        for (const a of set) {
          const parts = unaryParts(economy, sub, unit, {
            candidate: a.candidate,
            landing: a.landing,
            healthSpent: a.healthSpent,
            tier: a.tier,
            capture: a.capture,
            survivalPrior: a.survivalPrior,
          });
          store.setUnary(id, a.candidate.to, parts);
          options.push({ landing: a.landing, mealEv: parts.meal });
        }
        inputs.push({ unitId: id, unit, options });
      }
      return inputs;
    };

    /** φ_uv over every commandable pair — LAZY, and nothing in CL2 asks. */
    const pairs = (inputs: PairInput[], store: EdgeEvStore): void => {
      for (let i = 0; i < inputs.length; i++) {
        for (let j = i + 1; j < inputs.length; j++) {
          const table = pairTable(sub, inputs[i] as PairInput, inputs[j] as PairInput);
          if (table !== null) store.setPair(table);
        }
      }
    };

    const time = (run: () => void): number => {
      for (let i = 0; i < 20; i++) run();
      let best = Number.POSITIVE_INFINITY;
      for (let r = 0; r < 5; r++) {
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < 40; i++) run();
        const us = Number(process.hrtime.bigint() - t0) / 1000 / 40;
        if (us < best) best = us;
      }
      return best;
    };

    const shipped = time(() => {
      const store = new EdgeEvStore();
      unaries(fronts(), store);
    });
    const warm = fronts();
    const inputs = unaries(warm, new EdgeEvStore());
    const pairCost = time(() => pairs(inputs, new EdgeEvStore()));

    const compiled = (us: number): string => (us / HARNESS_FACTOR).toFixed(1);
    process.stdout.write(
      `edge-ev at ${ours.length} units — SHIPPED PASS (fronts + φ_u): ` +
        `${shipped.toFixed(1)} µs in-harness (~${compiled(shipped)} µs compiled); ` +
        `LAZY pair layer (φ_uv over ${(ours.length * (ours.length - 1)) / 2} pairs): ` +
        `${pairCost.toFixed(1)} µs in-harness (~${compiled(pairCost)} µs compiled)\n`
    );

    // THE BUDGET, and what it is a budget FOR. The costed slice is ~50 µs per
    // decision for what the ordering layer runs — the two floods plus φ_u over
    // every candidate. The pair layer is NOT in it, because nothing in this
    // stage consumes it: it is built only when a caller asks, exactly as CL1
    // built the conflict index only inside the seed that reads it. When CL3
    // and CL4 start asking, they pay for it against their own rung-3 budget
    // (~0.3–1.0 ms), where it is a rounding error rather than a doubling.
    expect(shipped).toBeLessThan(50 * HARNESS_FACTOR * 1.5);
    // And the lazy layer is still costed, so a future consumer inherits a
    // number rather than a surprise.
    expect(pairCost).toBeLessThan(400 * HARNESS_FACTOR);
    sub.release();
  });
});

/**
 * WHAT THE HARNESS COSTS, AND WHERE THE NUMBER COMES FROM.
 *
 * ts-jest runs this class of code about 6× slower than a compiled standalone —
 * measured on the conflict index in `conflict-index.test.ts`, whose empty-body
 * floor is 18× higher than a compiled build's. Every ceiling in this file is
 * set against the in-harness number with the factor applied and room for a
 * loaded box on top, and the raw figure is printed so a regression shows up as
 * a number rather than as a pass.
 */
const HARNESS_FACTOR = 6;

// ---------------------------------------------------------------------------

/**
 * THE MECHANISM PROBE.
 *
 * The gate this stage owes is not a placement claim — the memos are unanimous
 * that placement is not claimable at these n, and there are no games here. It
 * is that the MECHANISM the terms were written for actually moves, in the
 * direction they were written to move it, and that the thing they could most
 * plausibly break does not break.
 *
 * ── ON PIECE BOARDS, AND WHY THAT IS NOT CHERRY-PICKING ────────────────────
 *
 * The first version of this probe ran on snake boards and moved NOTHING: sixty
 * boards, zero plans different. The reason is structural and worth recording
 * rather than working around, because it is also the layer's honest scope.
 *
 * A trail unit's options are all one step, so they cost identical health and
 * the health currency cannot tell them apart; `foodGain` already promotes the
 * eats above everything else; and the race term is read at food only. On a
 * snake board the whole pass is therefore a tie almost everywhere, and a tie
 * changes no order. That is exactly what the source measurement says — the
 * 47–195× spread that motivates the meal magnitude was measured over ONE
 * PIECE'S own option set, and "healthEconomy is the only feature with real
 * spread in a piece's option set" is a sentence about pieces.
 *
 * So the probe runs where the mechanism exists. What it costs to say that
 * plainly is a smaller claim; what it buys is a true one.
 *
 * ── THE METRICS, AND WHY "EATS" IS A GUARD AND NOT A CLAIM ─────────────────
 *
 * `foodGain` already sorts every eat above every non-eat, so the COUNT of eats
 * is not this layer's to move and a probe that claimed it would be measuring
 * I3's promotion over again. What this layer decides is WHICH meal and WHETHER
 * WE OWN IT:
 *
 *   ATE          resolver-verified: our surviving units whose WEIGHT went up,
 *                which is what a meal is (F4, +1 for every kind). Counting
 *                staged landings instead would count the intent.
 *   UNCONTESTED  staged eats at a margin we own outright — E8's whole target.
 *   ATE, again   as a GUARD: sharpening which meal must not cost meals, and
 *                the trade must come out at least even.
 *   FATAL        as a GUARD: the meal magnitude promotes longer approaches,
 *                and it must not buy them with deaths.
 *
 * ── BOTH SEEDS, BECAUSE THE INTERACTION IS THE FINDING ─────────────────────
 *
 * The arm that is ASSERTED is the shipped one: the blunt de-confliction pass,
 * which is what a decision runs today. The graded seed (CL1, flag off) is run
 * alongside and PRINTED, because the two layers turn out to interact in a way
 * neither's own gate can see — the blunt pass reserves every cell of a staged
 * path, so promoting a longer meal starves the units that pick after it, and
 * the graded seed does not have that property. Printing both is how the next
 * builder finds that out without re-deriving it.
 *
 * Rung 0 only, and the repair held off: what is measured is the ORDER, not a
 * search that had time to recover from one.
 */
describe('the mechanism probe', () => {
  test('the meal we own, without buying it with deaths', () => {
    const shipped = probeArms(false);
    const graded = probeArms(true);
    for (const [label, arm] of [
      ['shipped seed', shipped],
      ['graded seed', graded],
    ] as const) {
      process.stdout.write(
        `edge-ev probe, ${label}, ${arm.boards} piece boards — ` +
          `plans differ on ${arm.differed}/${arm.boards}; ` +
          `ATE ${arm.off.ate} -> ${arm.on.ate}; ` +
          `uncontested ${arm.off.freeEats} -> ${arm.on.freeEats}; ` +
          `contested ${arm.off.contestedEats} -> ${arm.on.contestedEats}; ` +
          `fatal stagings ${arm.off.dead} -> ${arm.on.dead}\n`
      );
    }
    const { off, on, differed, boards } = shipped;
    // NON-VACUITY FIRST. A probe whose two arms stage the same plan everywhere
    // is a probe that measured nothing, and it would pass every assertion
    // below by doing so.
    expect(differed).toBeGreaterThan(boards / 8);
    // THE CLAIM: E8's target moves, and moves up.
    expect(on.freeEats).toBeGreaterThan(off.freeEats);
    expect(on.contestedEats).toBeLessThanOrEqual(off.contestedEats);
    // THE TRADE, STATED AS THE INEQUALITY IT IS. This layer buys uncontested
    // meals and it is not free — reordering the eat block has consequences at
    // the seed. What must hold is that the trade comes out at least even: the
    // uncontested meals gained cover the meals lost. An eat is worth +0.060
    // placement and an UNCONTESTED eat +0.120, so one-for-one is already
    // positive; anything worse than one-for-one is not a trade worth making
    // and fails here rather than in a game.
    expect(on.freeEats - off.freeEats).toBeGreaterThanOrEqual(off.ate - on.ate);
    // THE GUARD.
    expect(on.dead).toBeLessThanOrEqual(off.dead);
  });
});

interface ProbeTotals {
  ate: number;
  eats: number;
  freeEats: number;
  contestedEats: number;
  dead: number;
}

interface ProbeArms {
  readonly boards: number;
  readonly differed: number;
  readonly off: ProbeTotals;
  readonly on: ProbeTotals;
}

function probeArms(graded: boolean): ProbeArms {
  const boards = 60;
  const zero = (): ProbeTotals => ({ ate: 0, eats: 0, freeEats: 0, contestedEats: 0, dead: 0 });
  const off = zero();
  const on = zero();
  let differed = 0;
  const add = (into: ProbeTotals, run: ProbeRun): void => {
    into.ate += run.ate;
    into.eats += run.eats;
    into.freeEats += run.freeEats;
    into.contestedEats += run.contestedEats;
    into.dead += run.dead;
  };
  for (let seed = 0; seed < boards; seed++) {
    const board = probeBoard(seed);
    const a = probeRun(board, false, graded);
    const b = probeRun(board, true, graded);
    add(off, a);
    add(on, b);
    if (a.key !== b.key) differed++;
  }
  return { boards, differed, off, on };
}

interface ProbeRun {
  /** Resolver-verified: our surviving units whose weight went up. */
  readonly ate: number;
  readonly eats: number;
  readonly freeEats: number;
  readonly contestedEats: number;
  readonly dead: number;
  readonly key: string;
}

/**
 * ONE RUNG-0 DECISION, through the real seam.
 *
 * `conform` with an empty incumbent IS rung 0: it seeds, pays one price, and
 * returns the seed whatever that price said. `rungZeroRepair` is held off so
 * that what is measured is the ORDER and not a repair cleaning up after it —
 * the same discipline CL1's seed probe runs under, and for the same reason.
 */
function probeRun(board: Board, edgeEv: boolean, graded: boolean): ProbeRun {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  const asTeam = sub.teamNumber('red');
  const gen = new GrammarCandidateGenerator({ edgeEv });
  const core = makeSearchCore({
    seedDeconflict: !graded,
    rungZeroRepair: false,
  });
  const fronts = new DecisionEconomy(sub, asTeam);
  const plan = core.conform(
    {
      sub,
      gen,
      evaluate: defaultEvaluator,
      asTeam,
      pins: [],
      assumptions: [],
      incumbent: null,
      witnesses: [],
      budget: unboundedBudget(),
    },
    new Map()
  );
  const ours = new Set<UnitId>(sub.commandable(asTeam));
  // WHAT A MEAL IS, read off the resolver rather than off the plan: +1 weight
  // for every kind (F4). A staged landing on food is an intention; a weight
  // that went up is a meal.
  const before = new Map<UnitId, number>();
  for (const id of ours) {
    const u = sub.unitOf(id);
    if (u !== undefined) before.set(id, u.weight);
  }
  const out = sub.withResolution(plan, asTeam, ({ resolution }) => {
    let ate = 0;
    for (const id of ours) {
      const slot = sub.engine.slotOfUnit(resolution.state, id as number);
      if (slot < 0) continue;
      const view = sub.engine.unitAt(resolution.state, slot);
      if (view === null || !view.alive) continue;
      if (view.weight > (before.get(id) ?? 0)) ate++;
    }
    return {
      ate,
      dead: resolution.deaths.filter((d) => ours.has(d.unitId as UnitId)).length,
    };
  });
  let eats = 0;
  let freeEats = 0;
  let contestedEats = 0;
  const parts: string[] = [];
  for (const [unitId, candidate] of plan) {
    parts.push(`${unitId}:${candidate.to}`);
    const cell = candidate.to as CellIndex;
    if (!sub.foodAt(cell)) continue;
    eats++;
    const loss = fronts.fronts.lossFractionAt(cell);
    if (loss === 0) freeEats++;
    else if (loss === 1) contestedEats++;
  }
  parts.sort();
  const key = parts.join('|');
  core.release?.();
  sub.release();
  clearGeometryCache();
  return { ate: out.ate, eats, freeEats, contestedEats, dead: out.dead, key };
}

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * A FOOD-BEARING PIECE BOARD: two teams of three pieces at mixed healths, with
 * food scattered where both sides can want it, plus one trail unit a side so
 * the board is not a shape the production configuration never sees.
 *
 * Three properties, all load-bearing:
 *
 *   PIECES     a slider's options span real travel, which is the only place
 *              the health currency and the refund magnitude have anything to
 *              discriminate with. See the probe's header.
 *   FOOD       three of the five terms are identically zero without it.
 *   MIXED HEALTH  a board where every unit is at full health gives the refund
 *              magnitude nothing to tell two meals apart with — the deficit is
 *              zero everywhere and the term is a tie.
 */
function probeBoard(seed: number): Board {
  const r = rng(seed);
  const size = 11;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const take = (x: number, y: number): boolean => {
    if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2 || used.has(`${x},${y}`)) return false;
    used.add(`${x},${y}`);
    return true;
  };
  const kinds = ['queen', 'rook', 'bishop', 'knight'];
  for (let i = 0; i < 6; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 2 + Math.floor(r() * (size - 4));
      const y = 2 + Math.floor(r() * (size - 4));
      if (!take(x, y)) continue;
      snakes.push(
        makeSnake(`p${i}`, [{ x, y }], {
          teamID: i % 2 === 0 ? 'red' : 'blue',
          unitType: kinds[i % kinds.length] as string,
          // A piece's `length` IS its weight (stack size), not a body count.
          length: 2 + Math.floor(r() * 3),
          health: 15 + Math.floor(r() * 70),
        })
      );
      break;
    }
  }
  // One trail unit a side, so the board is not all-pieces and the pair terms
  // and the tail rules still have something to see.
  for (const team of ['red', 'blue']) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 2 + Math.floor(r() * (size - 4));
      const y = 2 + Math.floor(r() * (size - 4));
      const body: Coord[] = [];
      const claimed: string[] = [];
      const push = (cx: number, cy: number): boolean => {
        if (!take(cx, cy)) return false;
        body.push({ x: cx, y: cy });
        claimed.push(`${cx},${cy}`);
        return true;
      };
      if (!push(x, y)) continue;
      let d = Math.floor(r() * 4);
      for (let j = 1; j < 3; j++) {
        if (r() < 0.4) d = (d + (r() < 0.5 ? 1 : 3)) % 4;
        const prev = body[body.length - 1] as Coord;
        const step = DIRS[d] as readonly [number, number];
        if (!push(prev.x + step[0], prev.y + step[1])) break;
      }
      if (body.length < 3) {
        for (const key of claimed) used.delete(key);
        continue;
      }
      snakes.push(
        makeSnake(`s${team}`, body, { teamID: team, health: 20 + Math.floor(r() * 60) })
      );
      break;
    }
  }
  const food: Coord[] = [];
  for (let i = 0; i < 10; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = 1 + Math.floor(r() * (size - 2));
      const y = 1 + Math.floor(r() * (size - 2));
      if (used.has(`${x},${y}`)) continue;
      used.add(`${x},${y}`);
      food.push({ x, y });
      break;
    }
  }
  return { width: size, height: size, food, hazards: [], snakes } as unknown as Board;
}

// --------------------------------------------------------------------- helpers

/** The potion part of one landing, for a unit at a given tier. */
function potionParts(tier: number): number {
  const board = potionBoard(tier);
  const r = rig(board, 'A');
  const gen = new GrammarCandidateGenerator({ edgeEv: true });
  const parts = partsFor(r, gen, at(3, 5));
  r.close();
  clearGeometryCache();
  return parts.potion;
}

function unaryPotionOf(
  sub: EngineSubstrate,
  gen: GrammarCandidateGenerator,
  economy: DecisionEconomy,
  unit: SubstrateUnit,
  index: number
): number {
  const a = gen.assess(sub, unit.unitId)[index];
  if (a === undefined) throw new Error(`no candidate at index ${index}`);
  return unaryParts(economy, sub, unit, {
    candidate: a.candidate,
    landing: a.landing,
    healthSpent: a.healthSpent,
    tier: a.tier,
    capture: a.capture,
    survivalPrior: a.survivalPrior,
  }).potion;
}

function pairInputFor(
  sub: EngineSubstrate,
  gen: GrammarCandidateGenerator,
  economy: DecisionEconomy,
  unit: SubstrateUnit
): PairInput {
  const options = gen.assess(sub, unit.unitId).map((a) => ({
    landing: a.landing,
    mealEv: unaryParts(economy, sub, unit, {
      candidate: a.candidate,
      landing: a.landing,
      healthSpent: a.healthSpent,
      tier: a.tier,
      capture: a.capture,
      survivalPrior: a.survivalPrior,
    }).meal,
  }));
  return { unitId: unit.unitId, unit, options };
}

/** Give named snakes a piece kind, through the wire field the adapter reads. */
function withKinds(board: Board, kinds: Record<string, string>): Board {
  return {
    ...board,
    snakes: board.snakes.map((s) =>
      kinds[s.id] === undefined ? s : ({ ...s, unitType: kinds[s.id] } as Snake)
    ),
  };
}

/** Two of ours and one enemy, with food scattered where both can reach it. */
function foodBoard(): Board {
  return {
    width: 11,
    height: 11,
    food: [
      { x: 4, y: 6 },
      { x: 6, y: 4 },
      { x: 8, y: 8 },
    ],
    hazards: [],
    snakes: [
      makeSnake('A', [{ x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 }], {
        teamID: 'red',
        health: 45,
      }),
      makeSnake('B', [{ x: 5, y: 7 }, { x: 5, y: 8 }, { x: 5, y: 9 }], {
        teamID: 'red',
        health: 70,
      }),
      makeSnake('E', [{ x: 8, y: 3 }, { x: 9, y: 3 }, { x: 9, y: 2 }], {
        teamID: 'blue',
        health: 90,
      }),
    ],
  } as unknown as Board;
}

/**
 * Ours on the left, theirs on the right, one food between them that BOTH are
 * one step from — the margin-0 case, where the race term is at half weight and
 * therefore genuinely firing. A food only we can reach would satisfy the
 * bound-by-zero assertion vacuously.
 */
function contestedFoodBoard(): Board {
  return {
    width: 11,
    height: 11,
    food: [
      { x: 5, y: 5 },
      { x: 2, y: 2 },
    ],
    hazards: [],
    snakes: [
      makeSnake('A', [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], {
        teamID: 'red',
        health: 55,
      }),
      makeSnake('E', [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], {
        teamID: 'blue',
        health: 80,
      }),
    ],
  } as unknown as Board;
}

/**
 * One of ours on the left, one enemy on the right, and one food a step from
 * each of them — a clean win and a clean loss on the same board.
 */
function raceBoard(): Board {
  return {
    width: 11,
    height: 11,
    food: [
      { x: 3, y: 5 },
      { x: 7, y: 5 },
    ],
    hazards: [],
    snakes: [
      makeSnake('A', [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 1, y: 4 }], { teamID: 'red' }),
      makeSnake('E', [{ x: 8, y: 5 }, { x: 9, y: 5 }, { x: 9, y: 4 }], { teamID: 'blue' }),
    ],
  } as unknown as Board;
}

/** The same geometry with no food on it: the floods have nothing to answer. */
function bareRaceBoard(): Board {
  return { ...raceBoard(), food: [] } as unknown as Board;
}

/**
 * Ours in one corner, with food a few steps along the wall AND food in the far
 * corner the flood horizon cannot see at all. The two are different cases and
 * the gate must answer them differently.
 */
function farFoodBoard(): Board {
  return {
    width: 11,
    height: 11,
    food: [
      { x: 4, y: 1 },
      { x: 9, y: 9 },
    ],
    hazards: [],
    snakes: [
      makeSnake('A', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], {
        teamID: 'red',
        health: 90,
      }),
    ],
  } as unknown as Board;
}

/** One of ours one step from a potion, at a chosen tier. */
function potionBoard(tier: number): Board {
  return {
    width: 11,
    height: 11,
    food: [],
    hazards: [],
    invulnerabilityPotions: [{ x: 3, y: 5 }],
    snakes: [
      makeSnake('A', [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 1, y: 4 }], {
        teamID: 'red',
        invulnerabilityLevel: tier,
        invulnerabilityExpiryTurn: tier > 0 ? TURN + 5 : undefined,
      } as Partial<Snake>),
      makeSnake('E', [{ x: 8, y: 5 }, { x: 9, y: 5 }, { x: 9, y: 4 }], { teamID: 'blue' }),
    ],
  } as unknown as Board;
}

/** A collector beside a potion, an ally that loses to a heavier enemy. */
function windowBoard(): Board {
  return {
    width: 11,
    height: 11,
    food: [],
    hazards: [],
    invulnerabilityPotions: [{ x: 3, y: 5 }],
    snakes: [
      makeSnake('A', [{ x: 2, y: 5 }, { x: 1, y: 5 }, { x: 1, y: 4 }], { teamID: 'red' }),
      makeSnake('B', [{ x: 5, y: 2 }, { x: 5, y: 1 }], { teamID: 'red' }),
      makeSnake('E', [
        { x: 8, y: 2 },
        { x: 9, y: 2 },
        { x: 9, y: 1 },
        { x: 8, y: 1 },
        { x: 7, y: 1 },
      ], { teamID: 'blue' }),
    ],
  } as unknown as Board;
}

/** Two of ours both one step from the same food. */
function sharedFoodBoard(): Board {
  return {
    width: 11,
    height: 11,
    food: [{ x: 5, y: 5 }],
    hazards: [],
    snakes: [
      makeSnake('A', [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }], {
        teamID: 'red',
        health: 40,
      }),
      makeSnake('B', [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], {
        teamID: 'red',
        health: 40,
      }),
    ],
  } as unknown as Board;
}

/** A unit folded into a corner, so its own body seals most of its options. */
function pocketBoard(): Board {
  return {
    width: 11,
    height: 11,
    food: [],
    hazards: [],
    snakes: [
      makeSnake('A', [
        { x: 1, y: 5 },
        { x: 2, y: 5 },
        { x: 2, y: 6 },
        { x: 1, y: 6 },
        { x: 1, y: 7 },
        { x: 2, y: 7 },
      ], { teamID: 'red' }),
      makeSnake('E', [{ x: 8, y: 2 }, { x: 9, y: 2 }, { x: 9, y: 1 }], { teamID: 'blue' }),
    ],
  } as unknown as Board;
}

/**
 * `n` short trail units OF OURS, plus a quarter as many enemies for the race
 * fronts to have a second side to flood.
 *
 * `n` counts OUR commandable units, which is what the pass iterates and what
 * the pair loop is quadratic in — a board of `n` units split across two teams
 * would price half the work and report it as the whole.
 */
function benchBoard(n: number): Board {
  const size = 19;
  const snakes: Snake[] = [];
  const enemies = Math.max(1, Math.floor(n / 4));
  let placed = 0;
  for (let row = 1; row < size - 1 && placed < n + enemies; row += 2) {
    for (let col = 1; col + 2 < size - 1 && placed < n + enemies; col += 4) {
      snakes.push(
        makeSnake(`u${placed}`, [
          { x: col, y: row },
          { x: col + 1, y: row },
          { x: col + 2, y: row },
        ], {
          teamID: placed < n ? 'red' : 'blue',
          health: 30 + ((placed * 7) % 60),
        })
      );
      placed++;
    }
  }
  const food: Coord[] = [];
  for (let i = 0; i < 10; i++) food.push({ x: 2 + ((i * 3) % 15), y: 2 + ((i * 5) % 15) });
  return { width: size, height: size, food, hazards: [], snakes } as unknown as Board;
}
