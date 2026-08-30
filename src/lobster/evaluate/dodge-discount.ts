/**
 * `dodgeDiscount` — HOW MUCH OF A BAD OUTCOME'S COST SURVIVES THE FACT THAT WE
 * GET TO CHOOSE.
 *
 * ── THE RULE (owner ruling 23, sixth message 2026-08-30) ───────────────────
 *
 * The cost of a class of bad outcome — our vulnerable unit being hit — is
 * discounted by its improbability under a UNIFORM PRIOR over that unit's
 * plausible moves, with the enemy pessimistically best-responding to the
 * uniform mixture.
 *
 * Our unit has moves `M`, `n = |M|`. Each enemy move `r` covers a subset
 * `C(r) ⊆ M` — the moves of ours it would collide with. With
 * `S = Σ_r |C(r)|`:
 *
 *     w(r) = |C(r)| / S          the enemy's move distribution
 *     d(m) = Σ_{r ∋ m} w(r)      our risk if we actually play m
 *
 * `w(r) ∝ |C(r)|` IS the pushforward of our uniform through the enemy's
 * best-response map wherever the covers are disjoint, and it is written this
 * way because the pushforward form needs an arbitrary tie-break when two enemy
 * moves cover the same square of ours and this form needs none. Determinism is
 * a requirement, and a formula with no tie-break in it cannot break ties
 * differently after a refactor.
 *
 * Overlap is not a special case: a move covered by several enemy replies takes
 * the SUM of their masses, so a square every reply covers scores exactly 1 and
 * the discount cannot talk a unit out of a square it cannot survive.
 *
 * The owner's numeric illustrations are INDICATIVE and are not test targets;
 * the tests exercise the properties against boards whose real move sets supply
 * the expected values.
 *
 * ── COVER IS A RULE LOOKUP, NOT A MODEL ────────────────────────────────────
 *
 * A mover advances one cell per sub-step and every cell it ENTERS is
 * adjudicated before the next (`turnEngine.ts:316-320`), so an enemy move whose
 * path crosses our square hits us there without ending there. Hence the
 * collapse that makes this affordable:
 *
 *   - a SLIDER's maximal cover move along each ray is the furthest destination
 *     on it, covering every one of our cells on that ray up to the first
 *     blocker — so a slider contributes ONE cover move PER RAY, not one per
 *     destination, and the whole computation is ONE RAY FAN;
 *   - a STEPPER's cover moves are its step destinations, each covering the one
 *     of our cells equal to it.
 *
 * And for the unit this term is about, cover needs no weight comparison at all.
 * A potion collector sits at −1 tier; contests rank tier strictly before weight
 * (`turnEngine.ts:182-188`) so it loses every head contest, and a body crossing
 * kills the mover unless the mover's tier is strictly higher, which is the
 * enemy's problem. ANY enemy arrival on a −1 unit's square is fatal. That
 * exactness is why the collector is the right first customer; a general
 * (non-vulnerable) unit would need the per-cell `adjudicate` comparison and is
 * not in this increment.
 *
 * ── THE STALENESS THE GATE DOES NOT COVER ──────────────────────────────────
 *
 * The reach gate asks the arrival map "could this enemy be on one of our
 * squares", which is a question about the FUTURE. The cover fan is then walked
 * from the attacker's CURRENT head, which is a fact about NOW. Those agree
 * when the priced turn is the next one and drift apart as it recedes — and
 * `potion-seek.ts` prices collections up to three turns of travel away, so on
 * a distant pickup the covers are computed from where the attacker stands
 * today rather than where it will stand when the collector arrives.
 *
 * Not repaired here, because repairing it means predicting the attacker's
 * position, which is the opponent-model socket's own job and not a side effect
 * of a discount. Two consequences instead, both binding on the caller: the
 * term is at its most trustworthy at `travelTurns === 1`, and any measurement
 * of it MUST stratify by `travelTurns` rather than pooling, or a
 * distant-pickup artefact will be read as a result.
 *
 * ── ADVISORY, AND ONLY ADVISORY ────────────────────────────────────────────
 *
 * This multiplies an advisory cost by a number in [0,1]. It has no write path
 * to `lo`/`hi`, it removes no candidate from any set, and it is upstream of
 * nothing: the rules-certain fatality exclusions, the staging-safety refusals,
 * the royal margin and the never-empty candidate guard are not consulted for
 * permission and are not affected. The registry's seam rule
 * (`../registry.ts`) puts it in a slot and not in the kernel: it can only ever
 * change order or spend.
 *
 * ── SELECTABLE, AND SELECTED BY NO DEFAULT ─────────────────────────────────
 *
 * `DODGE_DISCOUNT_ENTRY` (`@1`) is the candidate as a registry value, carrying
 * `weight: 0` and named by no slate. `eval/dodge-discount@2` is the seated
 * successor and it is a MODIFIER rather than a summand: it carries weight zero
 * there too, and everything it does happens by being present in
 * `SLATE_POTION_AWARE`, which switches `eval/potion-seek@3`'s exposure from the
 * undiscounted window endpoint to the near endpoint priced through this file.
 * Its only consumer is still `CollectorExposure.weightAtRiskNear` in
 * `potion-seek.ts`, and still only when that module is handed a `dodge` option
 * it does not default to.
 *
 * Design and its arguments, including the BUILD NOTE recording where
 * compilation moved this file away from the draft:
 * `$SP/dodge-discount-design.md`.
 */

import { indexOccupancy, rayCrossings } from './ray-crossing';
import type { OccupancyIndex, RayBoard, RayUnit } from './ray-crossing';
import { NO_REACH, UNREACHABLE } from './attack-window';
import type { ArrivalReach } from './attack-window';
import {
  bbTest,
  legalMoves,
  makeGrid,
  makeTerrain,
  orientedStepsOf,
  profileOf,
} from '../../partial-engine/index';
import type { Terrain } from '../../partial-engine/index';
import type { StrategyEntry } from '../registry';

// ---------------------------------------------------------------------------
// The published value
// ---------------------------------------------------------------------------

/**
 * The three endpoints, published together in the house style of
 * `attack-window.ts`'s `WindowInterval` and `potion-seek.ts`'s near/window
 * bracket. A multiplier in [0,1]: 1 charges the whole cost, 0 charges none.
 */
export interface DodgeInterval {
  /** `min_m d(m)` — we dodge as well as the board allows. */
  readonly best: number;
  /**
   * `mean_m d(m)` — we play the uniform the model assumes, and THE ONLY
   * ENDPOINT A FOLD MAY CHARGE.
   *
   * It is the model's own self-consistent collision probability: the enemy is
   * assumed to be best-responding to a uniform us, so the chance its reply
   * lands is computed under a uniform us. Reading `best` would assume we play
   * optimally against an enemy assumed to be answering a uniform-random us,
   * which is not a discount but a second free lunch — the exact mirror of the
   * over-pessimism this file repairs. It is also the endpoint least sensitive
   * to the arbitrary parts of the construction: when the cover sets are
   * equal-sized it is `|C|/n` however enemy mass is distributed among them.
   */
  readonly mean: number;
  /** `max_m d(m)` — we walk into the most-covered square. */
  readonly worst: number;
}

/** No softening at all. The value every refusal path returns. */
export const NO_DISCOUNT: DodgeInterval = { best: 1, mean: 1, worst: 1 };

export interface DodgeDiscountValue {
  readonly unitId: string;
  readonly team: number;
  /** The turn the dodge is priced for. */
  readonly turn: number;
  /** The square the unit is dodging FROM. */
  readonly origin: number;
  /** `M`, in the generator's own order. `perMove` is aligned with it. */
  readonly moves: ReadonlyArray<number>;
  /** `n = |M|`. */
  readonly branching: number;
  /** Enemy units that survived the reach gate and were actually walked. */
  readonly attackers: ReadonlyArray<string>;
  /** `d(m)` per move, aligned with `moves`. */
  readonly perMove: ReadonlyArray<number>;
  readonly discount: DodgeInterval;
  /**
   * False when the model declined to speak, in which case `discount` is
   * `NO_DISCOUNT` and the caller charges the undiscounted cost. See
   * `refusal` for which of the reasons applied.
   */
  readonly applicable: boolean;
  readonly refusal: DodgeRefusal | null;
}

export type DodgeRefusal =
  /** The unit's move set is empty — nothing to be uniform over. */
  | 'no-moves'
  /**
   * The unit's kind is orientation-dependent (pawn) and no orientation is on
   * the wire, so its legal move set is not generable here. Refusing is the
   * conservative branch: an invented pawn move set would inflate `n` and
   * therefore shrink the risk.
   */
  | 'oriented-unit'
  /**
   * The reach gate admitted no enemy at all. This is a refusal rather than a
   * zero because an empty gate can mean an ABSENT REACH MAP (`NO_REACH`
   * answers `UNREACHABLE` to everything) as easily as a safe board, and a
   * caller with no map must not have every cost zeroed for it. A gated
   * attacker that covers nothing is a different thing and scores zero — see
   * `dodgeDiscount`.
   */
  | 'unreachable';

export interface DodgeDiscountOptions {
  readonly turn?: number;
  /**
   * The reach gate. Only enemies whose arrival map puts them on some cell of
   * `M` inside the turn are walked at all. Absent means nothing is reachable,
   * which refuses rather than assumes.
   */
  readonly reach?: ArrivalReach | null;
  /** The square to dodge from. Defaults to the unit's own head. */
  readonly origin?: number;
  /**
   * THE PRIOR'S SUPPORT, INJECTED — and the production wiring.
   *
   * A caller inside the decision loop passes the safety floor's own surviving
   * candidate set, after `staging-safety.ts` and `fatality.ts` have made their
   * rules-certain refusals. That set IS "the moves we would actually
   * consider", which is the honest reading of *plausible*, and passing it
   * makes the prior's support the floor's support by construction.
   *
   * Absent, the local generator below is used: a conservative
   * under-approximation of the floor's set, never a superset.
   */
  readonly moves?: ReadonlyArray<number> | null;
  /**
   * HAZARD CELLS, AND THE TERM'S LARGEST SOURCE OF OPTIMISM.
   *
   * `RayBoard` carries no hazard board and the engine kills a unit entering a
   * hazard cell, so the local generator without this list counts hazards as
   * escapes, over-states `n` and OVER-DISCOUNTS. Owner ruling 22 says typical
   * games are high-hazard, so a measurement taken without this is not a
   * measurement of this term.
   *
   * NOTE (and this is the first BUILD NOTE deviation from the draft): the
   * engine's own `legalMoves` does NOT consult `Terrain.hazard` — its
   * predicate is `standableFor`, which is `open`/`pieceOpen`, i.e. terrain
   * minus WALL only. Handing the hazard list to `makeTerrain` therefore
   * excludes nothing. The exclusion below is explicit, against
   * `Terrain.hazard` itself.
   */
  readonly hazardCells?: Iterable<number> | null;
  /** Extra wall cells beyond the perimeter, if the board has any. */
  readonly wallCells?: Iterable<number> | null;
  /**
   * TERRAIN, BORROWED RATHER THAN REBUILT — the same discipline this module
   * already applies to reach (`ArrivalReach`) and to occupancy
   * (`OccupancyIndex`), and for the same reason.
   *
   * `makeTerrain` stamps the perimeter by walking EVERY CELL of the board, so
   * building it per call costs more than the ray fan the term exists to walk
   * (measured: 11 µs of a 31 µs call on a 13×13, and it grows with area while
   * the fan grows with the dimension). A caller pricing several units, or
   * several (collector, potion) pairs, on one board builds it once and hands
   * it in here. When it is absent one is built from `wallCells`/`hazardCells`,
   * which keeps an unconfigured caller and the tests a one-liner.
   *
   * It must be the terrain of THIS board: same width, same height, and the
   * hazards actually standing on it.
   */
  readonly terrain?: Terrain | null;
}

/**
 * The terrain this module reads, built once for a board so a caller can pass
 * it back in through `DodgeDiscountOptions.terrain`.
 */
export function dodgeTerrain(
  board: RayBoard,
  wallCells: Iterable<number> = [],
  hazardCells: Iterable<number> = []
): Terrain {
  return makeTerrain(makeGrid(board.width, board.height), wallCells, hazardCells);
}

// ---------------------------------------------------------------------------
// The prior's support
// ---------------------------------------------------------------------------

const terrainFor = (board: RayBoard, options: DodgeDiscountOptions): Terrain =>
  options.terrain ??
  dodgeTerrain(board, options.wallCells ?? [], options.hazardCells ?? []);

/**
 * `M` — the plausible moves of a VULNERABLE unit, as destination cells.
 *
 * `legalMoves` is the engine's own generator and is the right starting point
 * for exactly that reason, but it is a TERRAIN-ONLY predicate: it tests
 * `standableFor` and nothing else, so it enumerates cells other units are
 * standing on, it enumerates HAZARD cells (which kill), and for a trail unit it
 * enumerates perimeter cells too (`mayEnterWall`). Every one of those is a move
 * that kills a −1 unit, and counting a suicide as an escape inflates `n` —
 * which makes the bot LESS afraid. A term whose whole job is to reduce fear
 * must not be sloppy in the direction of reducing it further, so the fatal ones
 * come out.
 *
 * For a −1 unit the subtraction is exact rather than chosen: it loses every
 * head contest on tier and dies on every body cell, so OCCUPANCY IS FATALITY
 * with no comparison to make. The one exception is the ORIGIN itself, which a
 * `stayLegal` kind may hold and which the unit is standing on rather than
 * arriving at.
 */
export function plausibleMoves(
  board: RayBoard,
  unit: RayUnit,
  options: DodgeDiscountOptions = {},
  index?: OccupancyIndex
): ReadonlyArray<number> {
  if (options.moves != null) return options.moves;
  const profile = profileOf(unit.kind);
  // An oriented kind's legal set depends on an orientation `RayUnit` does not
  // carry. Refuse rather than invent one — see `DodgeRefusal`.
  if (profile.oriented) return [];

  const origin = options.origin ?? (unit.occupancy[0] as number);
  const terrain = terrainFor(board, options);
  const occ = index ?? indexOccupancy(board, options.turn ?? board.turn ?? 0);

  const out: number[] = [];
  for (const cell of legalMoves(terrain, unit.kind, origin)) {
    // A trail unit's `legalMoves` emits wall cells unconditionally
    // (`mayEnterWall`), and NO kind's generator consults the hazard board.
    // Both kill on entry, so both come out here.
    if (bbTest(terrain.wall, cell)) continue;
    if (bbTest(terrain.hazard, cell)) continue;
    if (cell !== origin && occ.get(cell) !== undefined) continue;
    out.push(cell);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

/**
 * The cover sets of ONE attacker over our move set, as index lists into
 * `moves`. One entry per distinct maximal cover move.
 *
 * The board is read AS GIVEN, which is `ray-crossing.ts`'s own convention: a
 * ray stops at the first current occupant, so an attacker's path is truncated
 * by blockers that may themselves move. That under-counts cover and is
 * therefore optimistic — recorded here rather than hidden, and it is the
 * reason the caller removes OUR unit from the occupancy first (our unit is
 * about to be somewhere in `M`, not standing where it blocks the ray).
 */
export function coverSetsFor(
  board: RayBoard,
  attacker: RayUnit,
  moves: ReadonlyArray<number>,
  occ: OccupancyIndex
): ReadonlyArray<ReadonlyArray<number>> {
  const want = new Map<number, number>();
  for (let i = 0; i < moves.length; i++) want.set(moves[i] as number, i);
  const out: number[][] = [];

  // Sliders: one cover move per ray, covering every one of our cells on it.
  for (const walk of rayCrossings(board, attacker, {}, occ)) {
    const set: number[] = [];
    for (const cell of walk.cells) {
      const at = want.get(cell);
      if (at !== undefined) set.push(at);
    }
    if (set.length > 0) out.push(set);
  }

  const profile = profileOf(attacker.kind);
  const head = attacker.occupancy[0] as number;
  const ox = head % board.width;
  const oy = (head / board.width) | 0;
  const push = (set: number[], dx: number, dy: number): void => {
    const x = ox + dx;
    const y = oy + dy;
    if (x < 0 || y < 0 || x >= board.width || y >= board.height) return;
    const at = want.get(y * board.width + x);
    if (at !== undefined && !set.includes(at)) set.push(at);
  };

  if (profile.oriented) {
    // An oriented attacker's orientation is not on the wire here, and its
    // `steps` field is EMPTY by design — the pawn's steps are
    // orientation-relative and live in `orientedStepsOf`. (Second BUILD NOTE
    // deviation: the draft rotated `profile.steps`, which for the only
    // oriented kind is the empty list, so a pawn attacker would have covered
    // nothing at all and scored the collector perfectly safe.)
    //
    // Rather than model four poses as four cover moves — which would inflate
    // the cover count and dilute every mass — the union of the entered cells
    // over all four orientations is taken as ONE maximal cover move. That is
    // the conservative branch: one large cover set carries a large mass onto
    // the cells it holds. Side cells stage ROTATIONS and are never entered
    // (`grammar.ts`), so they are not cover.
    const set: number[] = [];
    for (let o = 0; o < 4; o++) {
      const { forward, diagonals } = orientedStepsOf(o);
      push(set, forward[0], forward[1]);
      for (const [gx, gy] of diagonals) push(set, gx, gy);
    }
    if (set.length > 0) out.push(set);
    return out;
  }

  // Steppers: one cover move per step destination, covering the one cell.
  for (const [dx, dy] of profile.steps) {
    const x = ox + dx;
    const y = oy + dy;
    if (x < 0 || y < 0 || x >= board.width || y >= board.height) continue;
    const cell = y * board.width + x;
    const at = want.get(cell);
    if (at !== undefined) out.push([at]);
  }
  return out;
}

/** `d(m)` for one attacker: `w(r) = |C(r)|/S`, `d(m) = Σ_{r ∋ m} w(r)`. */
function perMoveRisk(
  covers: ReadonlyArray<ReadonlyArray<number>>,
  n: number
): Float64Array {
  const d = new Float64Array(n);
  let s = 0;
  for (const c of covers) s += c.length;
  if (s === 0) return d;
  for (const c of covers) {
    const w = c.length / s;
    for (const i of c) d[i] = (d[i] as number) + w;
  }
  return d;
}

// ---------------------------------------------------------------------------
// The term
// ---------------------------------------------------------------------------

/**
 * The dodge discount for one unit on one turn.
 *
 * COST CLASS: per-unit-action, comparable to `attackWindow`. One `legalMoves`
 * for `M`; one reach lookup per enemy per cell of `M` as the gate; ONE RAY FAN
 * per surviving slider attacker or `steps.length` cells per stepper; one
 * membership test per fan cell. The gate is total and free in the case that
 * dominates — a unit no enemy can reach walks nothing — and on the
 * `potion-seek` wiring path the term runs only where that module's existing
 * `contestedNear` boolean is already true, so it costs nothing on the boards
 * where it would change nothing.
 *
 * MULTIPLE ATTACKERS combine as independent survival,
 * `d(m) = 1 − Π_a (1 − d_a(m))`. That cannot represent coordination and is
 * therefore OPTIMISTIC against a deliberate pincer — the honest statement of
 * its worst case. Two things bound the damage: the product form carries the
 * free floor `d(m) ≥ max_a d_a(m)`, so no amount of attacker-counting calls a
 * square safe that one enemy alone covers heavily; and the error vanishes with
 * one attacker and is small when covers overlap, which is the common case of
 * two enemies converging on the same corridor.
 */
export function dodgeDiscount(
  board: RayBoard,
  unit: RayUnit,
  options: DodgeDiscountOptions = {},
  index?: OccupancyIndex
): DodgeDiscountValue {
  const turn = options.turn ?? board.turn ?? 0;
  const origin = options.origin ?? (unit.occupancy[0] as number);
  const reach = options.reach ?? NO_REACH;
  const occ = index ?? indexOccupancy(board, turn);

  const refuse = (
    refusal: DodgeRefusal,
    moves: ReadonlyArray<number>
  ): DodgeDiscountValue => ({
    unitId: unit.unitId,
    team: unit.team,
    turn,
    origin,
    moves,
    branching: moves.length,
    attackers: [],
    perMove: [],
    discount: NO_DISCOUNT,
    applicable: false,
    refusal,
  });

  if (profileOf(unit.kind).oriented && options.moves == null) {
    return refuse('oriented-unit', []);
  }
  const moves = plausibleMoves(board, unit, { ...options, origin, turn }, occ);
  const n = moves.length;
  if (n === 0) return refuse('no-moves', moves);

  // The attacker gate: one arrival lookup per enemy per cell of M.
  const candidates: RayUnit[] = [];
  for (const other of board.units) {
    if (other.team === unit.team) continue;
    for (const cell of moves) {
      const a = reach.earliestAt(other.unitId, cell);
      if (a < UNREACHABLE && a <= turn + 1) {
        candidates.push(other);
        break;
      }
    }
  }
  if (candidates.length === 0) return refuse('unreachable', moves);

  // Our unit is about to be SOMEWHERE IN M, not standing where it blocks a
  // ray, so the attackers' fans are walked against a board without it.
  const walkBoard: RayBoard = {
    ...board,
    units: board.units.filter((u) => u.unitId !== unit.unitId),
  };
  const walkOcc = indexOccupancy(walkBoard, turn);

  // survive[i] = Π_a (1 − d_a(m_i)).
  //
  // Every gated candidate is WALKED, and a candidate whose own move set covers
  // none of `M` contributes a factor of exactly 1 — which is `S = 0` for that
  // attacker, and §1's `d ≡ 0`. It is NOT a refusal. (Third BUILD NOTE
  // deviation: the draft refused with `NO_DISCOUNT` when no attacker covered
  // anything, i.e. it charged the whole cost precisely in the case its own
  // rule scores at zero — which would have left the 99.6% false alarm exactly
  // where it was. The refusal is kept only for the empty GATE, because an
  // empty gate can mean an absent reach map rather than a safe board, and
  // `NO_REACH` must not zero every cost.)
  const survive = new Float64Array(n).fill(1);
  const attackers: string[] = [];
  for (const a of candidates) {
    attackers.push(a.unitId);
    const covers = coverSetsFor(walkBoard, a, moves, walkOcc);
    if (covers.length === 0) continue;
    const d = perMoveRisk(covers, n);
    for (let i = 0; i < n; i++) {
      survive[i] = (survive[i] as number) * (1 - (d[i] as number));
    }
  }

  const perMove: number[] = [];
  let sum = 0;
  let best = Number.POSITIVE_INFINITY;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const risk = 1 - (survive[i] as number);
    perMove.push(risk);
    sum += risk;
    if (risk < best) best = risk;
    if (risk > worst) worst = risk;
  }

  return {
    unitId: unit.unitId,
    team: unit.team,
    turn,
    origin,
    moves,
    branching: n,
    attackers,
    perMove,
    discount: { best, mean: sum / n, worst },
    applicable: true,
    refusal: null,
  };
}

/**
 * THE MULTI-TURN CHAIN, with the factors supplied honestly rather than
 * invented: `1 − Π_t (1 − d_t)`.
 *
 * A single path-cover computation over the whole window is the correct object
 * and is not affordable — our paths number `n^k`, the enemy's `|R|^k`, cover is
 * over path pairs, and it needs a board-evolution model this module does not
 * have. So the chain is the shape, and the terms are what the model can stand
 * behind:
 *
 *   - `d₁` is COMPUTED. At the first step we know the unit's square exactly, so
 *     `M` is generated from a known origin and nothing is assumed.
 *   - `d_t = 1` for `t ≥ 2` BY DEFAULT. Past the first step the unit has moved
 *     and the model does not know from where, so its move set is not generable
 *     and the discount is not earned. A factor of 1 is the worst case, which is
 *     what the endpoint already was.
 *
 * So the default window discount is 1: the window endpoint of
 * `potion-seek.ts`'s exposure bracket keeps exactly the meaning and the value
 * it has today, and only the near endpoint becomes graded. Extending the
 * product is a caller's business and no path does it, because no measurement
 * supports a second factor — the same refusal `potion-seek.ts` already makes
 * when it declines to apply the corpus's collector-death rate as a survival
 * coefficient.
 */
export function chainedDiscount(
  perTurn: ReadonlyArray<number>,
  windowTurns: number
): number {
  let survive = 1;
  for (let t = 0; t < windowTurns; t++) {
    survive *= 1 - (t < perTurn.length ? (perTurn[t] as number) : 1);
  }
  return 1 - survive;
}

// ---------------------------------------------------------------------------
// The candidate, as data
// ---------------------------------------------------------------------------

export const DODGE_DISCOUNT_ENTRY: StrategyEntry = {
  id: 'eval/dodge-discount@1',
  slot: 'evaluator',
  primitive: 'ray-crossing+arrival-shells',
  params: {
    /** `w(r) ∝ |C(r)|` — the pushforward of our uniform, written tie-break-free. */
    enemyResponse: 'cover-proportional-to-our-uniform',
    /** The only endpoint a fold may charge; `best`/`worst` are the bracket. */
    reading: 'mean',
    /** Independent survival across attackers, floored at the worst single one. */
    attackerJoin: 'independent',
    /** Only the first factor is computed; later turns default to worst case. */
    windowChainTurns: 1,
    /** Legal moves minus rules-certain fatal ones; injectable from the floor. */
    support: 'legal-minus-rules-certain-fatal',
    weight: 0,
  },
  soundness: 'advisory',
  priors: {
    fitted: false,
    strata: [
      "the priced unit's kind and branching",
      'enemy slider count within reach',
      'hazard density',
      'open interior fraction',
    ],
    note:
      'A multiplier in [0,1] whose mass sits near 1/n for a high-branching piece ' +
      'in open space and near 1 for a cornered trail unit. Nothing is fitted: the ' +
      'distribution is measured in sweeps/dodge-discount-retrodiction.md against ' +
      'the committed batch-1 replays, stratified by the collecting unit\'s travel ' +
      'distance because the cover fan is walked from where the attacker stands today.',
  },
  cost: {
    fitted: false,
    features: ['our branching', 'enemy units within reach', 'board dimension'],
    note:
      'One ray fan per surviving attacker — the collapse to one cover move per ray ' +
      'is what holds it there — plus one arrival lookup per enemy per candidate ' +
      'cell as the gate. Reach is borrowed from the arrival shells and never ' +
      'rebuilt. On the potion-seek path it runs only where that module already ' +
      'computes a true contest boolean.',
  },
  record: {
    status: 'candidate',
    ledgerRows: [],
    note:
      'Design evidence only, from tools/retrodiction/potion-terms-retrodiction.js ' +
      '--dodge on the committed batch-1 replays. Written against owner ruling 23 to ' +
      'repair the 99.6% exposure false-alarm in sweeps/potion-terms-retrodiction.md ' +
      '§3. No arm has been run and no game has been played with this term.',
  },
};
