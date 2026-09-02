/**
 * PATH RISK — what one staged ray costs and risks, folded out of ONE partial
 * settlement of that ray.
 *
 * ── WHY THIS IS A FOLD AND NOT A LAYER ─────────────────────────────────────
 *
 * The question the candidate layer asks is "if this unit walks these cells,
 * where does it get to, what does it take, what could take it, and what does
 * it spend". That is not a new question about the rules — it is the turn,
 * settled, with exactly one mover known. So this file stages the ray and asks
 * `settlePartial`, and everything below is a READING of the answer: the
 * settlement says where the mover actually got to (`traversed`), what died
 * (`deaths`), what it met (`clashes`), what it spent (`exhaustions`), and the
 * ledger names every cell at which a unit nobody modelled could have made it
 * come out differently.
 *
 * The 966-line risk engine this replaces graded each cell against a cloud of
 * its own. It was a second reading of the same units, and a second reading
 * drifts. There is one reading now, and it is the settlement's.
 *
 * ── THE THREE AXES, AND WHERE EACH COMES FROM ──────────────────────────────
 *
 *   survival  no    the settlement kills the mover here.
 *             maybe a ledger entry at this cell could beat it.
 *             yes   neither.
 *   defeat    yes   the settlement records the mover as the survivor of a
 *                   clash here in which somebody died.
 *             maybe a claim could be standing here and the mover would win —
 *                   `couldBeat: false` on a contact is exactly that.
 *   halt      yes   the settlement's own traversal stopped here short of the
 *                   staged ray. A certain stop, and the reason the suffix of
 *                   the ray collapses onto it.
 *             maybe something could have stopped it here.
 *
 * ── THE OPTIMISTIC TIMELINE IS THE FURTHEST THE MOVER EVER GETS ────────────
 *
 * `settlePartial` reads a merely-possible occupant as empty ground, so the
 * mover in the optimistic timeline walks as far as anything could let it and
 * spends as much energy as any world could charge it. That is what makes
 * `traversed.length - 1` a REACH HORIZON — no world takes the mover further —
 * and it is what makes `energySpent.hi` the top of the interval and the
 * earliest possible halt its floor.
 *
 * The one thing it is NOT is a proof that the mover gets that far: everything
 * that could stop it earlier is a ledger entry, and the halt trit carries it.
 */

import { COST_PER_CELL } from '../engine-vendor/engine/turnEngine';
import type { Divergence, PartialSettlement } from '../engine-vendor/engine/settlePartial';
import type { EngineSubstrate, SubstrateUnit } from './substrate';
import type {
  CellIndex,
  EncounterVerdict,
  RiskCause,
  TraversalVerdict,
  Trit,
} from './contracts';

/** The weakest of two trits, in the order no < maybe < yes. */
const meet = (a: Trit, b: Trit): Trit =>
  a === 'no' || b === 'no' ? 'no' : a === 'maybe' || b === 'maybe' ? 'maybe' : 'yes';

/** Which role a divergence puts the unknown unit in, for the ledger's prose. */
const ROLE: Readonly<Record<Divergence['kind'], RiskCause['role']>> = {
  contest: 'head',
  edge: 'edge',
  bodyBlock: 'body',
  sever: 'body',
  durable: 'pile',
  food: 'item',
  potion: 'item',
  exhaustion: 'terrain',
  promotion: 'item',
};

/** Divergence kinds that can END a mover's movement at the cell they name. */
const HALTING: ReadonlySet<Divergence['kind']> = new Set<Divergence['kind']>([
  'contest',
  'bodyBlock',
  'durable',
  'edge',
]);

/**
 * Assess one staged action for one unit.
 *
 * `path` is the cells the unit would ENTER, origin excluded — the array
 * `queries.pathOf` hands back. An EMPTY path is a hold or a rotation, and it
 * is assessed exactly like any other action: the unit stands on its own square
 * for the whole turn, which is a square other units can arrive at. Reading a
 * hold as free is the asymmetry that makes standing still look safe on a board
 * where every step is contested, and it puts the hold first in an ordering
 * that sorts safety before everything else.
 */
export function assessPath(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  path: ReadonlyArray<CellIndex>
): TraversalVerdict {
  const settlement = sub.settleMover(unit.unitId, path);
  return foldSettlement(sub, unit, path, settlement);
}

/**
 * What STANDING costs and risks: the same divergences, read at one cell over
 * the whole turn rather than cell by cell along a ray.
 *
 * The energy is the settlement's own arithmetic — a unit that stands on a
 * hazard pays a whole dose, and one that stands on food eats — so it is read
 * as the difference the settlement produced rather than priced here.
 */
function restingVerdict(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  settlement: PartialSettlement,
  bySubStep: Map<number, Divergence[]>
): TraversalVerdict {
  const id = unit.wireId;
  const cell = unit.cells[0] as number;
  const death = settlement.deaths[id];
  const causes: RiskCause[] = [];
  let survival: Trit = 'yes';
  let defeat: Trit = 'no';

  if (death !== undefined) {
    survival = 'no';
    causes.push({
      role: death.cause === 'hazard' || death.cause === 'exhaustion' ? 'terrain' : 'head',
      axis: 'survival',
      heldId: null,
      contingent: false,
      note: `settled ${death.cause}`,
    });
  }
  for (const clash of settlement.clashes) {
    if (clash.index !== cell) continue;
    if (!clash.playerIDs.includes(id) || clash.victimIDs.includes(id)) continue;
    if (clash.victimIDs.length > 0) defeat = 'yes';
  }
  for (const entries of bySubStep.values()) {
    for (const entry of entries) {
      if (entry.cell !== cell) continue;
      causes.push({
        role: ROLE[entry.kind],
        axis: entry.couldBeat ? 'survival' : 'defeat',
        heldId: sub.unitOfWireId(entry.heldId)?.unitId ?? null,
        contingent: true,
        note: `${entry.kind}${entry.narrowed ? ' (narrowed)' : ''} with ${entry.heldId}`,
      });
      if (entry.couldBeat && survival === 'yes') survival = 'maybe';
      else if (!entry.couldBeat && defeat === 'no') defeat = 'maybe';
    }
  }

  const settled = settlement.board[id];
  const spent = Math.max(0, unit.energy - (settled?.energy ?? 0));
  const exhausted = settlement.exhaustions.some((e) => e.unitID === id);
  const fatalByExhaustion =
    death !== undefined && (death.cause === 'exhaustion' || death.cause === 'hazard');

  return {
    perCell: [
      {
        survival,
        defeat,
        halt: 'yes',
        causes,
        deathCells: survival === 'yes' ? [] : [cell],
      },
    ],
    survival,
    completesPath: 'yes',
    landing: { certain: cell, cells: [cell] },
    // Standing still is a point charge: nothing anyone else chooses adds to it.
    energySpent: { lo: spent, hi: spent },
    savedByTruncation: 0,
    exhaustionFatal: fatalByExhaustion ? 'yes' : exhausted ? 'maybe' : 'no',
    deathCells: survival === 'yes' ? [] : [cell],
  };
}

/** The reading itself, split out so a test can hand it a settlement directly. */
export function foldSettlement(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  path: ReadonlyArray<CellIndex>,
  settlement: PartialSettlement
): TraversalVerdict {
  const id = unit.wireId;
  const traversed = settlement.traversed[id] ?? [];
  const death = settlement.deaths[id];

  // Ledger entries about THIS mover, by the sub-step they bite at. Sub-step k
  // is path index k - 1: the board as the turn opened is sub-step 0.
  //
  // ONE FILTER, AND IT IS NOT A RULE. A divergence names the cell it is about,
  // and some of them are about a cell the unknown unit cannot be anywhere near:
  // regicide is a TEAM verdict off one unit's death, so a held king puts every
  // one of its team-mates in doubt at whatever cell that team-mate happens to
  // end on. That is true, it is priced where it belongs — the material fold
  // reads `fates`, and a king's survival is exactly what it reads — and it says
  // nothing whatever about WHERE this unit should walk: it lands on every
  // candidate equally and grades them all `atRisk`, which is a tiering that has
  // stopped discriminating. So the per-cell axes read only the entries whose
  // unknown could actually hold the cell, asked of the CLAIM (`everPossible`)
  // rather than of a rule restated here. Nothing is dropped from the ledger,
  // the bounds, or the fates; this is what the CELL grades are folded from.
  const claimById = new Map(settlement.claims.map((c) => [c.id, c]));
  const bySubStep = new Map<number, Divergence[]>();
  for (const entry of settlement.ledger) {
    if (entry.unitId !== id) continue;
    const claim = claimById.get(entry.heldId);
    if (claim !== undefined && !claim.everPossible.includes(entry.cell)) continue;
    const list = bySubStep.get(entry.subStep);
    if (list === undefined) bySubStep.set(entry.subStep, [entry]);
    else list.push(entry);
  }

  // What the mover defeated, per cell: the settlement's own clash records.
  const defeatedAt = new Map<number, boolean>();
  for (const clash of settlement.clashes) {
    if (!clash.playerIDs.includes(id)) continue;
    if (clash.victimIDs.includes(id)) continue;
    if (clash.victimIDs.length === 0) continue;
    defeatedAt.set(clash.index, true);
  }

  // The sub-steps at which the mover's own budget stopped it. An exhaustion is
  // reported rather than acted on by the collision engine, so this is where the
  // halt came from even when the food phase went on to save its life.
  const haltedByBudget = new Set<number>(
    settlement.exhaustions.filter((e) => e.unitID === id).map((e) => e.subStep)
  );

  const perCell: EncounterVerdict[] = [];
  const deathCells = new Set<number>();
  const haltCells: number[] = [];
  let sawMaybeHalt = false;

  // A HOLD is one cell for the whole turn. It enters nothing, so it has no
  // traversal to walk; what it has is a square, and everything that could
  // arrive at that square is a contest it takes part in.
  if (path.length === 0) return restingVerdict(sub, unit, settlement, bySubStep);

  for (let i = 0; i < traversed.length; i++) {
    const cell = traversed[i] as number;
    const subStep = i + 1;
    const entries = (bySubStep.get(subStep) ?? []).filter(
      (e) => e.cell === cell || e.kind === 'exhaustion'
    );

    let survival: Trit = 'yes';
    let defeat: Trit = defeatedAt.get(cell) === true ? 'yes' : 'no';
    let halt: Trit = 'no';
    const causes: RiskCause[] = [];

    if (death !== undefined && death.subStep === subStep && death.cell === cell) {
      survival = 'no';
      deathCells.add(cell);
      causes.push({
        role: death.cause === 'bodyBlock' || death.cause === 'self' ? 'body' : 'head',
        axis: 'survival',
        heldId: null,
        contingent: false,
        note: `settled ${death.cause}`,
      });
    }

    for (const entry of entries) {
      const contingent = true;
      causes.push({
        role: ROLE[entry.kind],
        axis: entry.couldBeat ? 'survival' : HALTING.has(entry.kind) ? 'halt' : 'defeat',
        heldId: sub.unitOfWireId(entry.heldId)?.unitId ?? null,
        contingent,
        note: `${entry.kind}${entry.narrowed ? ' (narrowed)' : ''} with ${entry.heldId}`,
      });
      if (entry.couldBeat && survival === 'yes') survival = 'maybe';
      if (entry.couldBeat) deathCells.add(cell);
      if (HALTING.has(entry.kind)) {
        if (halt === 'no') halt = 'maybe';
        // A contact the mover wins is a capture-stop it might make.
        if (!entry.couldBeat && defeat === 'no') defeat = 'maybe';
      }
    }

    // THE CERTAIN HALT. The optimistic timeline is the furthest the mover ever
    // gets, so a traversal that stopped short of the staged ray stopped for a
    // reason nothing can lift.
    const last = i === traversed.length - 1;
    if (last && traversed.length < path.length) halt = 'yes';
    if (last && survival === 'no') halt = 'yes';
    // WHY it stopped, when the reason is the mover's own budget: energy is
    // spent per cell entered and per dose taken, and nothing anyone else does
    // adds to it — an unknown can only halt the mover EARLIER and save it. So
    // a stop the mover paid for is a stop in every world, and the candidate
    // layer is entitled to collapse the ray's suffix onto it exactly.
    if (halt === 'yes' && haltedByBudget.has(subStep)) {
      causes.push({
        role: 'terrain',
        axis: 'halt',
        heldId: null,
        contingent: false,
        note: 'ran out of energy',
      });
    }
    if (halt !== 'no') {
      haltCells.push(cell);
      if (halt === 'maybe') sawMaybeHalt = true;
    }

    perCell.push({
      survival,
      defeat,
      halt,
      causes,
      deathCells: survival === 'yes' ? [] : [cell],
    });
  }

  // ---- whole-path readings ------------------------------------------------

  let survival: Trit = 'yes';
  for (const cell of perCell) survival = meet(survival, cell.survival);

  const completesPath: Trit =
    traversed.length < path.length ? 'no' : sawMaybeHalt || survival !== 'yes' ? 'maybe' : 'yes';

  // Where it could come to rest: the settled final cell, plus every cell a
  // possible halt could have stopped it on. `certain` only when there is one.
  const restCells = new Set<number>(haltCells);
  const finalCell = settlement.finalCell[id];
  if (finalCell !== undefined) restCells.add(finalCell);
  if (restCells.size === 0 && traversed.length > 0) {
    restCells.add(traversed[traversed.length - 1] as number);
  }
  const landing = {
    certain: restCells.size === 1 ? ([...restCells][0] as number) : null,
    cells: [...restCells].sort((a, b) => a - b),
  };

  // ---- energy -------------------------------------------------------------
  //
  // A cell entered costs `COST_PER_CELL` and a hazard cell entered costs a
  // whole dose on top; the engine exports the constant precisely so a caller
  // bracketing a halted unit's energy prices the difference with the rule
  // rather than with a number of its own. `hi` is the whole traversal (the
  // optimistic timeline walks furthest and so spends most); `lo` is the walk
  // to the earliest cell anything could have stopped it on.
  const dose = sub.hazardDamage;
  const chargeTo = (upto: number): number => {
    let spent = 0;
    for (let i = 0; i < upto && i < traversed.length; i++) {
      spent += COST_PER_CELL + (sub.hazardAt(traversed[i] as number) ? dose : 0);
    }
    return spent;
  };
  const firstHalt = perCell.findIndex((c) => c.halt !== 'no');
  const energySpent = {
    lo: chargeTo(firstHalt < 0 ? traversed.length : firstHalt + 1),
    hi: chargeTo(traversed.length),
  };

  // ---- exhaustion ---------------------------------------------------------
  //
  // The settlement charged the mover for the WHOLE traversal, so an exhaustion
  // it reports is the worst world; a halt one cell earlier would have saved a
  // cell's worth. So it is only certain when nothing could have halted it.
  const exhausted = settlement.exhaustions.filter((e) => e.unitID === id);
  const fatalByExhaustion =
    death !== undefined && (death.cause === 'exhaustion' || death.cause === 'hazard');
  // A halt LIFTS an exhaustion only if it could have happened before the cell
  // whose entry made the mover pay: energy already spent is not given back, and
  // an unknown that could only have stopped the mover later saved it nothing.
  const spentAt = fatalByExhaustion
    ? (death as { subStep: number }).subStep
    : (exhausted[0]?.subStep ?? Number.MAX_SAFE_INTEGER);
  const liftable = perCell.some(
    (cell, i) => i + 1 < spentAt && cell.halt !== 'no' && cell.causes.some((c) => c.contingent)
  );
  let exhaustionFatal: Trit = 'no';
  if (fatalByExhaustion) exhaustionFatal = liftable ? 'maybe' : 'yes';
  else if (exhausted.length > 0) exhaustionFatal = 'maybe';

  return {
    perCell,
    survival,
    completesPath,
    landing,
    energySpent,
    savedByTruncation: energySpent.hi - energySpent.lo,
    exhaustionFatal,
    deathCells: [...deathCells].sort((a, b) => a - b),
  };
}
