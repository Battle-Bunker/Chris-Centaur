/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/risk.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// THE RISK LAYER — deliberation delta §1–§3.
//
// The COMMIT layer is the resolver (engine.ts): rules adjudicate asserted
// material only, and `resolve(state) = resolve(state with all clouds erased)`
// stands. This layer NEVER WRITES STATE. It models the things the resolver
// provably will not commit: role-tagged possible presence, three-axis Kleene
// encounter verdicts by endpoint evaluation, edge-indexed encounters against
// maybe-heads with origin-cell death geometry, traversal folds with
// reach-gating, and MAYBE-CREATED DURABLE MATERIAL — a possible fatal contest
// at cell c at sub-step j makes c carry possible-durable-material for every
// j' > j, else a second modelled unit crossing later the same turn gets a
// false certainSurvive.
//
// Every exactness gap here over-approximates in one direction — deflate the
// mover's worst, inflate its best, never the reverse — which is what keeps
// the bounds layer's dominance sound (delta §3: box⊋set, cross-role
// correlation, cross-unit factorization, role/strength coupling).
//
// EXTREMIZATION TRAP for ∀-claims (measured by the heuristics workstream):
// "assume every maybe present at its earliest arrival" is UNSOUND for
// territory-like universally-quantified claims, two ways — two maybes can
// ANNIHILATE each other (leaving a cell neutral where either alone flips
// it), and `earliest` is a LOWER bound, so a later real arrival can
// annihilate with the asker's own unit where the earliest one could not. A
// sound extremization quantifies over presence × effective-arrival (the
// finite turn set), never over presence at one pinned turn. This layer's
// per-cell verdicts are per-encounter and unaffected; consumers building
// whole-board ∀-claims from them must extremize jointly.

import type { Board } from "./bitgrid.js";
import { bbTest } from "./bitgrid.js";
import type { StrengthBounds } from "./cloud.js";
import { headSubStepLBOf } from "./cloud.js";
import type { Scalar } from "./contest.js";
import { cmpLex, cornerForEndpointEvaluation } from "./contest.js";
import type { CloudField, FieldSlot } from "./field.js";
import type { Terrain, UnitKind } from "./grammar.js";
import { profileOf } from "./grammar.js";

// ---------------------------------------------------------------------------
// Kleene trits
// ---------------------------------------------------------------------------

export type Trit = "yes" | "maybe" | "no";

export const kAnd = (a: Trit, b: Trit): Trit =>
  a === "no" || b === "no" ? "no" : a === "maybe" || b === "maybe" ? "maybe" : "yes";
export const kOr = (a: Trit, b: Trit): Trit =>
  a === "yes" || b === "yes" ? "yes" : a === "maybe" || b === "maybe" ? "maybe" : "no";
export const kNot = (a: Trit): Trit => (a === "yes" ? "no" : a === "no" ? "yes" : "maybe");

/** Exact three-valued bracket over enumerated alternatives. */
export function bracket(holds: ReadonlyArray<boolean>): Trit {
  if (holds.length === 0) return "yes";
  let all = true;
  let some = false;
  for (const h of holds) {
    all = all && h;
    some = some || h;
  }
  return all ? "yes" : some ? "maybe" : "no";
}

// ---------------------------------------------------------------------------
// Role-tagged maybe entries — delta §2, verbatim shapes
// ---------------------------------------------------------------------------

export interface TierBox {
  readonly tierMin: number;
  readonly tierMax: number;
}
export interface StrengthBox extends TierBox {
  readonly weightMin: number;
  readonly weightMax: number;
}

export type SubStep = number;

/** A whole-turn question: no sub-step gate applies. */
export const WHOLE_TURN: SubStep = Number.MAX_SAFE_INTEGER;

/**
 * One way the unit might stand at a cell. A BODY ROLE HAS NO WEIGHT FIELD:
 * body contests are tier-gated only, and encoding body as weight:∞ poisons
 * the durable pile — a dead owner's segment contests at its FROZEN weight,
 * and ∞ would kill every arriver (delta §2).
 */
export type MaybeRole =
  | { readonly role: "possible-head"; readonly strength: StrengthBox }
  | {
      readonly role: "possible-body-segment";
      readonly gate: TierBox;
      readonly mayBeSevered: boolean;
      readonly mayHaveDragged: boolean;
    }
  | {
      readonly role: "possible-durable-material";
      readonly strength: StrengthBox;
      readonly sinceSubStep: SubStep;
    };

export interface MaybeEntry {
  readonly unitId: number;
  readonly team: number;
  /** Back-pointer to the claim this entry is a reading of. */
  readonly claim: FieldSlot;
  /**
   * A NON-EMPTY SET of alternatives. The encounter verdict is the exact
   * three-valued bracket over the alternatives (the MEET over roles) — never
   * an if/else priority. Property: a head∧body cell's verdict is no better
   * for the mover than the body-only one.
   */
  readonly roles: ReadonlyArray<MaybeRole>;
  readonly alive: Trit;
  readonly basis: "complete" | "narrowed";
  readonly frozenAt: number;
  readonly staleness: number;
}

// ---------------------------------------------------------------------------
// Encounter verdicts — delta §3
// ---------------------------------------------------------------------------

export type RiskAxis = "survival" | "defeat" | "halt";

export interface RiskCause {
  readonly unitId: number;
  readonly role: MaybeRole["role"] | "certain-material" | "maybe-durable" | "edge";
  readonly axis: RiskAxis;
  readonly cell: number;
  /**
   * TRUE when the cause rests on a CLOUD (the unit merely might be there, or
   * might have died there); FALSE when it rests on certain material. A
   * consumer must be able to tell a cloud-contingent DEAD from a material
   * one: the first is a demand pending refinement, not a collapse —
   * vacuity-detection (sticky staging) reads exactly this bit.
   */
  readonly contingent: boolean;
}

export type Polarity = "if_present" | "if_absent";
export type Grade = "fatal" | "blocking" | "advantageous" | "contested" | "assumed";

export interface ContingencyEntry {
  readonly subStep: SubStep;
  readonly cell: number;
  /** The frozen unit implicated; -1 for overlay (maybe-durable) material. */
  readonly unitId: number;
  readonly polarity: Polarity;
  readonly grade: Grade;
  readonly role: RiskCause["role"];
}

export interface EncounterVerdict {
  /** Does the mover survive this cell? (quantified over every world) */
  readonly survival: Trit;
  /** Is the encountered unit defeated here? */
  readonly defeat: Trit;
  /** Does the mover's movement END here (capture-stop, block, or death)? */
  readonly halt: Trit;
  readonly causes: ReadonlyArray<RiskCause>;
  /**
   * Where the mover could DIE from this encounter. For a cell encounter that
   * is the cell itself; for an edge encounter it is the mover's OWN ORIGIN
   * cell — the loser of an exchange is squashed against its own neck, and its
   * death square is the cell its head held, never the one it tried to enter.
   */
  readonly deathCells: ReadonlyArray<number>;
  readonly ledger: ReadonlyArray<ContingencyEntry>;
}

/** The owner's four names, as a projection of the three axes (delta §3). */
export function ownerLabel(
  v: Pick<EncounterVerdict, "survival" | "defeat">,
): "certainDeath" | "atRisk" | "certainWin" | "certainSurvive" {
  if (v.survival === "no") return "certainDeath";
  if (v.survival === "maybe") return "atRisk";
  return v.defeat === "yes" ? "certainWin" : "certainSurvive";
}

const NO_RISK: EncounterVerdict = {
  survival: "yes",
  defeat: "no",
  halt: "no",
  causes: [],
  deathCells: [],
  ledger: [],
};

export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

export interface TraversalVerdict {
  /** One verdict per sub-step cell, reach-gated. */
  readonly perCell: ReadonlyArray<EncounterVerdict>;
  /** Whole-path survival: ⋀ᵢ (¬reachᵢ ∨ surviveᵢ). */
  readonly survival: Trit;
  /** Does the mover complete its staged path? */
  readonly completesPath: Trit;
  /**
   * Where the mover could come to rest. `certain` is set only when the
   * landing is one cell in every world; otherwise `cells` is the landing SET
   * (halt=maybe forbids truncation — delta §3).
   */
  readonly landing: { readonly certain: number | null; readonly cells: ReadonlyArray<number> };
  /** Health spent, as an interval over the worlds (cost + hazards). */
  readonly healthSpent: Interval;
  /**
   * Upper bound on movement health SAVED by a possible non-fatal truncation
   * (healthSpent.hi − healthSpent.lo). A mover stopped early is HEALTHIER
   * than its staged path priced — an unaccounted saving is optimistic in the
   * wrong direction for the halted unit's opponents (Bot B's health debit).
   */
  readonly savedByTruncation: number;
  /**
   * Would exhaustion prove FATAL? Graded after the health phase against
   * post-resolution health: food on a possible landing cell can flip it, and
   * a CONTESTED item on the halt cell of a subject at ≤0 health is
   * fatal-grade, not contested-grade (delta §7).
   */
  readonly exhaustionFatal: Trit;
  readonly deathCells: ReadonlyArray<number>;
  readonly ledger: ReadonlyArray<ContingencyEntry>;
}

// ---------------------------------------------------------------------------
// Endpoint evaluation — exact on the box, two corners per role, reusing the
// resolver's own comparator (contest.ts). Never restates the contest.
// ---------------------------------------------------------------------------

const cornerMax = (b: StrengthBox): Scalar => cornerForEndpointEvaluation(b.tierMax, b.weightMax);
const cornerMin = (b: StrengthBox): Scalar => cornerForEndpointEvaluation(b.tierMin, b.weightMin);

/** If the unit is present in this role, does the mover survive / defeat / halt? */
interface RoleOutcome {
  readonly surviveAll: boolean; // mover survives against every box world
  readonly surviveSome: boolean;
  readonly defeatAll: boolean; // the unit is defeated in every box world
  readonly defeatSome: boolean;
  readonly haltAll: boolean; // the mover halts in every box world
  readonly haltSome: boolean;
}

function headOutcome(m: Scalar, strength: StrengthBox): RoleOutcome {
  // Cell contest: unique strict maximum survives; a tie kills everyone; the
  // winner capture-stops. Antitone in the defender, so the two corners are
  // exact on the box.
  const vsStrongest = cmpLex(m, cornerMax(strength));
  const vsWeakest = cmpLex(m, cornerMin(strength));
  return {
    surviveAll: vsStrongest > 0,
    surviveSome: vsWeakest > 0,
    defeatAll: vsStrongest >= 0, // a tie kills the defender too
    defeatSome: vsWeakest >= 0,
    haltAll: true, // win → capture-stop; lose or tie → die: every present world halts
    haltSome: true,
  };
}

function bodyOutcome(m: Scalar, gate: TierBox): RoleOutcome {
  // Living body: tier ≤ owner's dies (bodyBlock); strictly higher SEVERS and
  // capture-stops. A sever is non-fatal — the owner is not defeated.
  return {
    surviveAll: m.tier > gate.tierMax,
    surviveSome: m.tier > gate.tierMin,
    defeatAll: false,
    defeatSome: false,
    haltAll: true, // block kills, sever capture-stops
    haltSome: true,
  };
}

function durableOutcome(m: Scalar, strength: StrengthBox): RoleOutcome {
  // The wrestling rule: arriving at a durable cell joins its cumulative
  // contest; unique strict maximum survives and capture-stops, else dies.
  // Nothing in a pile can be "defeated" — it is already dead.
  const vsStrongest = cmpLex(m, cornerMax(strength));
  const vsWeakest = cmpLex(m, cornerMin(strength));
  return {
    surviveAll: vsStrongest > 0,
    surviveSome: vsWeakest > 0,
    defeatAll: false,
    defeatSome: false,
    haltAll: true,
    haltSome: true,
  };
}

function roleOutcome(m: Scalar, role: MaybeRole): RoleOutcome {
  switch (role.role) {
    case "possible-head":
      return headOutcome(m, role.strength);
    case "possible-body-segment":
      return bodyOutcome(m, role.gate);
    case "possible-durable-material":
      return durableOutcome(m, role.strength);
  }
}

// ---------------------------------------------------------------------------
// The assessor
// ---------------------------------------------------------------------------

export interface Mover {
  readonly unitId: number;
  readonly kind: UnitKind;
  /** SCALAR strength — the mover is modelled, so its strength is a fact. */
  readonly strength: Scalar;
  readonly health: number;
  /** Cells entered, one per sub-step. Origin excluded. */
  readonly path: ReadonlyArray<number>;
  /** The head cell at turn start — edge encounters are indexed off it. */
  readonly origin: number;
}

interface OverlayPile {
  sinceSubStep: SubStep;
  tierMax: number;
  weightMax: number;
  tierMin: number;
  weightMin: number;
}

/**
 * One resolution's risk pass. Construct per (state, joint assignment); the
 * within-turn maybe-durable overlay accretes monotonically across the movers
 * assessed through it (delta §2: within a turn head/body roles are constant —
 * projections don't move — and only possible-durable-material accretes).
 *
 * `field` is the POST-MOVE claim (the turn being produced); `startField` is
 * the start-of-turn claim, needed only by edge encounters.
 */
export class RiskAssessor {
  readonly field: CloudField;
  readonly startField: CloudField;
  private readonly terrain: Terrain;
  private readonly hazardDamage: number;
  private readonly maxHealth: number;
  private readonly food: Board | null;
  private readonly overlay = new Map<number, OverlayPile>();

  constructor(opts: {
    field: CloudField;
    startField: CloudField;
    terrain: Terrain;
    hazardDamage: number;
    maxHealth: number;
    /** Food at turn start, for the exhaustion flip; null = no food anywhere. */
    food?: Board | null;
  }) {
    // BOTH NAMES READ LIKE "the current claim", and passing one field twice is
    // the obvious first guess. It is also silently UNSOUND: with
    // startField === field the frozen units are assumed not to have moved
    // during the turn you are moving in, and the arena traced 10 of its 12
    // false-safe verdicts to exactly that. A claim is a function of its turn,
    // so the relationship is checkable, and checked.
    if (!opts.field.isEmpty && !opts.startField.isEmpty && opts.field.turn !== opts.startField.turn + 1) {
      throw new Error(
        `RiskAssessor: field must be the POST-MOVE claim and startField the start-of-turn one, so field.turn (${opts.field.turn}) must be startField.turn + 1 (${opts.startField.turn + 1}) — passing the same field for both assumes the frozen units stood still`,
      );
    }
    this.field = opts.field;
    this.startField = opts.startField;
    this.terrain = opts.terrain;
    this.hazardDamage = opts.hazardDamage;
    this.maxHealth = opts.maxHealth;
    this.food = opts.food ?? null;
  }

  /**
   * The role-tagged entries at one cell — the per-cell reading of the claims,
   * with the alive trit gating what a "certain" cell may be read as: a
   * certain-conditional-on-alive cell whose owner might be dead is a maybe,
   * never a presence "yes" (delta §2).
   */
  entriesAt(cell: number, subStep: SubStep = 1): MaybeEntry[] {
    const out: MaybeEntry[] = [];
    for (const slot of this.field.slots) {
      const roles = this.rolesFor(slot, cell, subStep);
      if (roles.length === 0) continue;
      const cloud = slot.cloud;
      out.push({
        unitId: slot.record.unitId,
        team: slot.record.team,
        claim: slot,
        roles,
        alive: cloud.certainlyGone ? "no" : cloud.deathPossible ? "maybe" : "yes",
        basis: cloud.basis,
        frozenAt: slot.record.heldAtTurn,
        staleness: this.field.turn - slot.record.heldAtTurn,
      });
    }
    return out;
  }

  private rolesFor(slot: FieldSlot, cell: number, subStep: SubStep): MaybeRole[] {
    const cloud = slot.cloud;
    const roles: MaybeRole[] = [];
    const gone = cloud.certainlyGone;
    // SUB-STEP GATING (Bot A): the head role applies at sub-step s only if
    // the unit could have ENTERED enough cells by s to stand here — a mover
    // passing at sub-step 2 cannot be hit by a front that cannot arrive
    // before sub-step 3. Whole-turn questions pass WHOLE_TURN and skip the
    // gate. Holds stay turn-granular; this is within-turn resolution only.
    if (
      !gone &&
      bbTest(cloud.headPossible, cell) &&
      (!cloud.subStepBoundsApply ||
        subStep >= 1e15 ||
        (headSubStepLBOf(cloud, this.field.grid)[cell] as number) <= subStep)
    ) {
      roles.push({ role: "possible-head", strength: boxOf(slot.bounds) });
    }
    // ROLES ARE A SET OF ALTERNATIVES, not a partition: a cell may hold the
    // unit's head in one world and a body segment in another, and the verdict
    // is the meet over BOTH — but the SET must be arithmetically TIGHT
    // (Bot B): head iff reachable-as-head at exactly this turn (the
    // parity-exact front), body iff some body index's arithmetic reaches the
    // cell (cloud.bodyPossible). Tagging every cloud cell head-and-body is
    // sound but ruinous: it converts every contest a heavy unit could win
    // into an impassable wall.
    if (!gone && bbTest(cloud.bodyPossible, cell)) {
      roles.push({
        role: "possible-body-segment",
        gate: { tierMin: slot.bounds.tierMin, tierMax: slot.bounds.tierMax },
        mayBeSevered: slot.bounds.weightMin < slot.record.weight,
        mayHaveDragged: this.field.turn - slot.record.heldAtTurn > 0,
      });
    }
    // Durable material: the unit may have DIED somewhere it has been — its
    // whole remaining occupancy became a pile, which keeps fighting at its
    // FROZEN strength for the rest of the game's turn. Cross-turn corpses are
    // present from sub-step 0.
    if (cloud.deathPossible && bbTest(cloud.everPossible, cell)) {
      roles.push({
        role: "possible-durable-material",
        strength: boxOf(slot.bounds),
        sinceSubStep: 0,
      });
    }
    return roles;
  }

  /**
   * The standing question, NAMED as such: could a unit with this strength
   * survive standing at this cell, against everything that might be or arrive
   * there? Deliberately not a traversal — a standalone cell query must not
   * impersonate one (delta §3: a health-3 slider never reaches cell 4 of its
   * ray, and a maybe there must not be cited against it).
   */
  survivesStandingAt(mover: Scalar, cell: number): EncounterVerdict {
    return this.encounterAt(mover, cell, WHOLE_TURN, "yes", -1);
  }

  /**
   * PASSABILITY: can the mover traverse THROUGH this cell — entering it
   * without its movement ending there? A capture-stop ends the move even on a
   * WIN, so any possible contest makes passability at best maybe. Split from
   * REACHABILITY (can it end up there) because one query answering both
   * depresses the best case (delta §3).
   */
  passability(mover: Scalar, cell: number): Trit {
    const v = this.encounterAt(mover, cell, WHOLE_TURN, "yes", -1);
    return kNot(v.halt);
  }

  /** REACHABILITY: could the mover come to rest at this cell and survive? */
  reachability(mover: Scalar, cell: number): Trit {
    const v = this.encounterAt(mover, cell, WHOLE_TURN, "yes", -1);
    return v.survival;
  }

  /**
   * The encounter verdict for a mover arriving at `cell` at `subStep`, with
   * `reach` gating how certainly it gets here at all. The verdict is the
   * exact three-valued bracket over the role ALTERNATIVES of every implicated
   * entry — the meet over roles, never an if/else priority — with each role
   * evaluated at its box's two exact corners through the resolver's own
   * comparator.
   */
  encounterAt(
    mover: Scalar,
    cell: number,
    subStep: SubStep,
    reach: Trit,
    moverId: number,
  ): EncounterVerdict {
    if (reach === "no") return NO_RISK;
    const entries = this.entriesAt(cell, subStep);
    const pile = this.overlay.get(cell);
    if (entries.length === 0 && pile === undefined) return NO_RISK;

    let survival: Trit = "yes";
    let defeat: Trit = "no";
    let halt: Trit = "no";
    const causes: RiskCause[] = [];
    const deathCells: number[] = [];
    const ledger: ContingencyEntry[] = [];

    for (const entry of entries) {
      if (entry.alive === "no" && !entry.roles.some((r) => r.role === "possible-durable-material"))
        continue;
      // Presence certainty: a cell in the claim's CERTAIN board with a
      // definitely-alive owner is present in every world; everything else has
      // an absent alternative.
      const certainHere =
        entry.alive === "yes" &&
        bbTest(entry.claim.cloud.certain, cell) &&
        !entry.claim.cloud.deathPossible;

      const outcomes = entry.roles.map((r) => roleOutcome(mover, r));
      const roleSurviveAll = outcomes.every((o) => o.surviveAll);
      const roleSurviveSome = outcomes.some((o) => o.surviveSome);
      const roleDefeatAll = outcomes.every((o) => o.defeatAll);
      const roleDefeatSome = outcomes.some((o) => o.defeatSome);
      const roleHaltAll = outcomes.every((o) => o.haltAll);
      const roleHaltSome = outcomes.some((o) => o.haltSome);

      // Bracket in the absent world unless presence is certain.
      const eSurvival: Trit = certainHere
        ? roleSurviveAll
          ? "yes"
          : roleSurviveSome
            ? "maybe"
            : "no"
        : roleSurviveAll
          ? "yes"
          : "maybe";
      const eDefeat: Trit = certainHere
        ? roleDefeatAll
          ? "yes"
          : roleDefeatSome
            ? "maybe"
            : "no"
        : roleDefeatSome
          ? "maybe"
          : "no";
      const eHalt: Trit = certainHere
        ? roleHaltAll
          ? "yes"
          : roleHaltSome
            ? "maybe"
            : "no"
        : roleHaltSome
          ? "maybe"
          : "no";

      // Reach-gating: a cell the mover only maybe reaches can only maybe
      // hurt it (and can never certainly halt it).
      const gate = (t: Trit): Trit => (reach === "maybe" && t !== "no" ? "maybe" : t);
      const gSurvival = reach === "maybe" && eSurvival !== "yes" ? "maybe" : eSurvival;
      const gDefeat = gate(eDefeat);
      const gHalt = gate(eHalt);

      if (gSurvival !== "yes") {
        causes.push({
          unitId: entry.unitId,
          role: certainHere ? "certain-material" : (entry.roles[0]?.role ?? "certain-material"),
          axis: "survival",
          cell,
          contingent: !certainHere,
        });
        deathCells.push(cell);
      }
      if (gHalt !== "no" && gSurvival === "yes") {
        causes.push({
          unitId: entry.unitId,
          role: certainHere ? "certain-material" : (entry.roles[0]?.role ?? "certain-material"),
          axis: "halt",
          cell,
          contingent: !certainHere,
        });
      }
      const polarity: Polarity =
        certainHere || bbTest(entry.claim.cloud.certain, cell) ? "if_absent" : "if_present";
      const grade: Grade =
        gSurvival !== "yes"
          ? "fatal"
          : gDefeat !== "no"
            ? "advantageous"
            : entry.basis === "narrowed"
              ? "assumed"
              : "blocking";
      ledger.push({
        subStep,
        cell,
        unitId: entry.unitId,
        polarity,
        grade,
        role: entry.roles[0]?.role ?? "certain-material",
      });

      survival = kAnd(survival, gSurvival);
      defeat = kOr(defeat, gDefeat);
      halt = kOr(halt, gHalt);
    }

    // The within-turn maybe-durable overlay: someone might already have died
    // here THIS turn, at or before this sub-step.
    if (pile !== undefined && pile.sinceSubStep < subStep) {
      const o = durableOutcome(mover, {
        tierMin: pile.tierMin,
        tierMax: pile.tierMax,
        weightMin: pile.weightMin,
        weightMax: pile.weightMax,
      });
      const s: Trit = o.surviveAll ? "yes" : "maybe";
      const gS = reach === "maybe" && s !== "yes" ? "maybe" : s;
      const h: Trit = "maybe"; // pile presence is never certain
      if (gS !== "yes") {
        causes.push({
          unitId: -1,
          role: "maybe-durable",
          axis: "survival",
          cell,
          contingent: true,
        });
        deathCells.push(cell);
      }
      ledger.push({
        subStep,
        cell,
        unitId: -1,
        polarity: "if_present",
        grade: gS !== "yes" ? "fatal" : "blocking",
        role: "maybe-durable",
      });
      survival = kAnd(survival, gS);
      halt = kOr(halt, h);
    }

    void moverId;
    return { survival, defeat, halt, causes, deathCells: dedupe(deathCells), ledger };
  }

  /**
   * EDGE ENCOUNTER against a maybe-head — the survival math coincides with
   * the arrival contest, but the geometry is EDGE-INDEXED: the loser's death
   * cell is its OWN ORIGIN (the death-square guarantee — an exchange loser is
   * squashed against its own neck), and the winner capture-stops on the
   * loser's start cell. A purely cell-indexed maybe layer cannot express this
   * death, so encounters carry an edge-indexed kind (delta §3).
   *
   * The exchange needs both claims: the frozen unit must have STOOD at `to`
   * when the turn began (start field) and CROSSED to `from` during it (post
   * field), through an edge — jumps are exempt.
   */
  edgeEncounter(mover: Mover, subStep: SubStep, reach: Trit): EncounterVerdict {
    if (reach === "no" || !profileOf(mover.kind).traversesEdges) return NO_RISK;
    const from = subStep === 1 ? mover.origin : (mover.path[subStep - 2] as number);
    const to = mover.path[subStep - 1] as number;
    if (from === to) return NO_RISK;
    let survival: Trit = "yes";
    let halt: Trit = "no";
    let defeat: Trit = "no";
    const causes: RiskCause[] = [];
    const deathCells: number[] = [];
    const ledger: ContingencyEntry[] = [];
    for (const slot of this.field.slots) {
      if (!profileOf(slot.record.kind).traversesEdges) continue;
      if (slot.cloud.certainlyGone) continue;
      const startSlot = this.startField.bySlot(slot.slot);
      if (startSlot === undefined) continue;
      // Could it have been at `to` at turn start, and crossed to `from`?
      if (!bbTest(startSlot.cloud.headPossible, to)) continue;
      if (!bbTest(slot.cloud.headPossible, from)) continue;
      const o = headOutcome(mover.strength, boxOf(slot.bounds));
      const eSurvival: Trit = o.surviveAll ? "yes" : "maybe";
      const gS = reach === "maybe" && eSurvival !== "yes" ? "maybe" : eSurvival;
      if (gS !== "yes") {
        causes.push({
          unitId: slot.record.unitId,
          role: "edge",
          axis: "survival",
          cell: from,
          contingent: true,
        });
        // ORIGIN-CELL DEATH GEOMETRY: the mover would die at `from`, never at
        // the cell it tried to swap into.
        deathCells.push(from);
      }
      // If present and crossing: win → capture-stop INTO `to` (the loser's
      // start cell, tail pop applied); lose or tie → squashed at `from`.
      // Either way the mover's movement ends: halt is maybe whenever the
      // crossing is possible at all.
      halt = kOr(halt, reach === "maybe" ? "maybe" : "maybe");
      defeat = kOr(defeat, o.defeatSome ? "maybe" : "no");
      survival = kAnd(survival, gS);
      ledger.push({
        subStep,
        cell: from,
        unitId: slot.record.unitId,
        polarity: "if_present",
        grade: gS !== "yes" ? "fatal" : "blocking",
        role: "edge",
      });
    }
    return { survival, defeat, halt, causes, deathCells: dedupe(deathCells), ledger };
  }

  /**
   * The traversal fold — delta §3. Encounters fold in the engine's own
   * adjudication tier order (edge → wall → self → arrival → body — walls and
   * self-collisions are the mover's own deterministic facts and are assumed
   * pre-filtered by the caller's path legality; what folds here is the risk
   * overlay). Downstream risk is gated on reachability:
   *
   *   reach_{i+1} = and(reach_i, survive_i, not(halt_i))
   *   survival    = ⋀ᵢ or(not(reach_i), survive_i)
   *
   * certainSurvive ≠ path-completes: halt=maybe forbids truncation, so
   * downstream cells still evaluate (under reach=maybe) and the landing is a
   * SET; halt=yes truncates the ray — a certain kill makes the branch MORE
   * exact.
   */
  assessPath(mover: Mover): TraversalVerdict {
    const perCell: EncounterVerdict[] = [];
    const ledger: ContingencyEntry[] = [];
    const deathCells: number[] = [];
    const landing: number[] = [];
    let reach: Trit = "yes";
    /** Reach at the moment the FINAL cell was evaluated — completesPath reads it. */
    let reachAtLast: Trit = "yes";
    let survival: Trit = "yes";
    let spentLo = 0;
    let spentHi = 0;
    let truncatedAt = -1;

    const costPerCell = profileOf(mover.kind).costPerCell;

    for (let i = 0; i < mover.path.length; i++) {
      const s = i + 1;
      const cell = mover.path[i] as number;
      if (reach === "no") break;
      if (i === mover.path.length - 1) reachAtLast = reach;

      // Tier order: the edge exchange settles who completed a crossing before
      // anything looks at the far cell.
      const edge = this.edgeEncounter(mover, s, reach);
      const arrival = this.encounterAt(
        mover.strength,
        cell,
        s,
        kAnd(reach, edge.survival),
        mover.unitId,
      );

      // Health: cost is charged per cell actually entered. A cell is entered
      // in EVERY world only while reach is certain and no edge loss could
      // have squashed the mover short of it (an edge loser is never charged
      // for the cell it did not enter). Charged HERE, before the landing test
      // below, because running out of health is one of the ways a cell
      // becomes the cell the mover stays on.
      const cellCost = costPerCell + (bbTest(this.terrain.hazard, cell) ? this.hazardDamage : 0);
      if (reach === "yes" && edge.survival === "yes") spentLo += cellCost;
      spentHi += cellCost;

      // THE LANDING IS NOT A MOMENT, IT IS THE REST OF THE TURN.
      //
      // A mover that arrives at cell c at sub-step s and STAYS there — its
      // final cell, a possible capture-stop, an exhaustion halt — is standing
      // on c for sub-steps s+1, s+2 … as well, and anything that can arrive
      // there at ANY of them contests it. Asking the point question alone
      // ("could something be here at the instant I arrive?") turns arriving
      // EARLY into safety, when arriving early only means standing there
      // longer: a mover landing at sub-step 1 read a frozen unit whose
      // earliest arrival is sub-step 2 as no risk at all, and reported
      // `survival: yes` with an EMPTY LEDGER while the real resolver killed
      // it. That is the forbidden direction — a false proof — and it is the
      // dual of the maybe-durable rule this file already applies to OTHER
      // movers' possible kills.
      //
      // So a resting cell is met against the OPEN-ENDED question as well.
      // Halt is deliberately not merged from it: a later arrival contests a
      // mover that has already stopped, it does not stop it again.
      const pointHalt = kOr(edge.halt, arrival.halt);
      const rests =
        i === mover.path.length - 1 || pointHalt !== "no" || mover.health - spentHi <= 0;
      const standing = rests
        ? this.encounterAt(
            mover.strength,
            cell,
            WHOLE_TURN,
            kAnd(reach, edge.survival),
            mover.unitId,
          )
        : NO_RISK;

      const stepSurvival = kAnd(kAnd(edge.survival, arrival.survival), standing.survival);
      const stepHalt = pointHalt;
      const merged: EncounterVerdict = {
        survival: stepSurvival,
        defeat: kOr(kOr(edge.defeat, arrival.defeat), standing.defeat),
        halt: stepHalt,
        causes: [...edge.causes, ...arrival.causes, ...standing.causes],
        deathCells: dedupe([...edge.deathCells, ...arrival.deathCells, ...standing.deathCells]),
        ledger: mergeLedger([...edge.ledger, ...arrival.ledger], standing.ledger, s),
      };
      perCell.push(merged);
      ledger.push(...merged.ledger);
      deathCells.push(...merged.deathCells);

      // A possible fatal contest here makes the cell carry maybe-durable
      // material for every LATER sub-step — of this mover and of every other
      // mover assessed through this assessor (delta §1).
      if (stepSurvival !== "yes" || merged.defeat !== "no") {
        this.accrete(cell, s, mover.strength);
      }

      survival = kAnd(survival, kOr(kNot(reach), stepSurvival));

      if (stepHalt !== "no") landing.push(cell);
      if (stepHalt === "yes" && stepSurvival === "yes") {
        truncatedAt = i;
        break; // a CERTAIN capture-stop truncates: more exact, not less
      }
      // EXHAUSTION GATES REACH (delta §3): the spend to stand at cell i is
      // Σ enter costs — deterministic given arrival — so a mover whose health
      // cannot afford it has HALTED at or before this cell in every world
      // that reaches it. A health-3 slider never reaches cell 4 of its ray,
      // and a maybe there must not be cited against it.
      if (mover.health - spentHi <= 0) {
        truncatedAt = i;
        landing.push(cell);
        break;
      }
      reach = kAnd(reach, kAnd(stepSurvival, kNot(stepHalt)));
    }

    const last = mover.path.length - 1;
    // Completing the path means coming to rest ALIVE on its final cell: a
    // certain truncation short of it is "no"; otherwise it is reaching the
    // final cell and surviving it (a capture-stop AT the destination still
    // completes — the stop and the landing coincide).
    const completesPath: Trit =
      mover.path.length === 0
        ? "yes"
        : truncatedAt >= 0 && truncatedAt < last
          ? "no"
          : perCell.length <= last
            ? "no"
            : kAnd(reachAtLast, (perCell[last] as EncounterVerdict).survival);
    if (truncatedAt === -1 && mover.path.length > 0 && reach !== "no") {
      landing.push(mover.path[last] as number);
    }
    const landingCells = dedupe(landing);
    const certainLanding = landingCells.length === 1 ? (landingCells[0] as number) : null;

    // Exhaustion, graded AFTER the health phase against post-resolution
    // health (delta §7). Interval endpoints; food on a possible landing can
    // flip it — and a contested item (inside any cloud) is fatal-grade.
    const healthLoAfter = mover.health - spentHi;
    const healthHiAfter = mover.health - spentLo;
    let exhaustionFatal: Trit = healthHiAfter <= 0 ? "yes" : healthLoAfter <= 0 ? "maybe" : "no";
    if (exhaustionFatal !== "no" && this.food !== null) {
      for (const c of landingCells) {
        if (!bbTest(this.food, c)) continue;
        const contested = this.field.anyUncertaintyAt(c);
        if (contested) {
          // The rescue exists but a frozen unit might have eaten it first:
          // FATAL-grade contingency, not contested-grade (delta §7).
          ledger.push({
            subStep: mover.path.length,
            cell: c,
            unitId: -1,
            polarity: "if_present",
            grade: "fatal",
            role: "maybe-durable",
          });
          exhaustionFatal = "maybe";
        } else {
          // Uncontested food on a possible halt cell: the food phase precedes
          // exhaustion settlement, so the unit could recover.
          exhaustionFatal = exhaustionFatal === "yes" && certainLanding === c ? "no" : "maybe";
        }
      }
    }

    return {
      perCell,
      survival,
      completesPath,
      landing: { certain: certainLanding, cells: landingCells },
      healthSpent: { lo: spentLo, hi: spentHi },
      savedByTruncation: spentHi - spentLo,
      exhaustionFatal,
      deathCells: dedupe(deathCells),
      ledger,
    };
  }

  /**
   * Assess several movers through ONE overlay, in global sub-step order, so a
   * possible kill by one mover at sub-step j is durable material for another
   * mover's crossing at j' > j. (Approximation: each mover's fold is computed
   * in the order given, which matches the engine's snapshot discipline for
   * accretions — an entry never affects its own sub-step.)
   */
  assessJoint(movers: ReadonlyArray<Mover>): TraversalVerdict[] {
    return movers.map((m) => this.assessPath(m));
  }

  /** The within-turn overlay accretion — monotone, never removed. */
  private accrete(cell: number, subStep: SubStep, participant: Scalar): void {
    const prior = this.overlay.get(cell);
    if (prior === undefined) {
      this.overlay.set(cell, {
        sinceSubStep: subStep,
        tierMax: participant.tier,
        tierMin: participant.tier,
        weightMax: participant.weight,
        weightMin: 0,
      });
      return;
    }
    prior.sinceSubStep = Math.min(prior.sinceSubStep, subStep);
    prior.tierMax = Math.max(prior.tierMax, participant.tier);
    prior.tierMin = Math.min(prior.tierMin, participant.tier);
    prior.weightMax = Math.max(prior.weightMax, participant.weight);
  }
}

function boxOf(b: StrengthBounds): StrengthBox {
  return { tierMin: b.tierMin, tierMax: b.tierMax, weightMin: b.weightMin, weightMax: b.weightMax };
}

function dedupe(xs: number[]): number[] {
  return [...new Set(xs)];
}

/**
 * The point verdict's ledger plus whatever the OPEN-ENDED reading of the same
 * cell adds. The two overlap by construction — the same frozen unit is usually
 * named by both — so the standing entries are restamped to the sub-step the
 * mover actually arrived at (a contingency is about a turn, and WHOLE_TURN is a
 * sentinel, not a time) and folded in only where they say something new.
 */
function mergeLedger(
  point: ContingencyEntry[],
  standing: ReadonlyArray<ContingencyEntry>,
  subStep: SubStep,
): ContingencyEntry[] {
  if (standing.length === 0) return point;
  const key = (e: ContingencyEntry): string =>
    `${e.cell}:${e.unitId}:${e.polarity}:${e.grade}:${e.role}`;
  const seen = new Set(point.map(key));
  const out = [...point];
  for (const entry of standing) {
    const restamped = { ...entry, subStep };
    if (seen.has(key(restamped))) continue;
    seen.add(key(restamped));
    out.push(restamped);
  }
  return out;
}
