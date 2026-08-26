/**
 * THE PER-TEAM ADVERSARY WORLD — a DECLARED relaxation of the one-coalition
 * worst case, and nothing else.
 *
 * ── what the strict bank actually assumes ─────────────────────────────────
 *
 * Every rung of the bank prices a branch in which every uncontrolled unit that
 * is not enumerated stays HELD, and a held unit's cloud is read at the endpoint
 * that hurts the subject most. On a three-team board that means both rival
 * teams realise worst-for-us AT THE SAME TIME, in the same world, on every
 * branch of every rung. The bank never writes that assumption down anywhere,
 * because it is not a narrowing: it is the SOUND direction, the whole point of
 * a floor. It is also, on a three-team board, a fiction — a rival unit that
 * spends its turn contesting a cell with the OTHER rival cannot spend the same
 * turn contesting a cell with us — and the fiction is measured: `est − lo` is
 * 1.84x wider in three-team play than in exactly-matched two-team play WHILE
 * THE ACTOR IS CLEAR OF EVERY ENEMY, and it does not narrow when the two rivals
 * are locked together (M4 O2).
 *
 * ── what this module declares ─────────────────────────────────────────────
 *
 * Let R be the rival teams and O_r the joint reply set of team r. The strict
 * security value is
 *
 *     SV(a) = min over (o_1, ..., o_k) in O_1 x ... x O_k  of  V(a, o).
 *
 * The PER-TEAM world set restricts that product to
 *
 *     W = union over r in R of W_r,
 *     W_r = { o : team r plays anything in O_r, every OTHER rival team plays
 *             its DECLARED REFERENCE ACTION }.
 *
 * W is a SUBSET of the full product (a reference action is a legal action), so
 *
 *     SV(a)  <=  min over W of V(a, .)  =:  SV_W(a),
 *
 * i.e. SV_W is an OVER-estimate of the true security value. It is NOT a floor
 * on the game. It is a floor on a DIFFERENT, NAMED game, and every number it
 * touches carries the name. That is the only form this relaxation is allowed
 * to take (build contract non-negotiable 5): capping WHO is modelled is free;
 * this caps neither WHO nor WHICH replies of any one unit — it caps the
 * COORDINATION between two rival teams — and a coordination cap is a min-side
 * restriction like any other, so it rides `withNarrowing` and refuses
 * comparison with an unconditional bound.
 *
 * ── the combination, which is where the coalition actually lives ──────────
 *
 * B1 already enumerates per enemy. That is not the relaxation and never was:
 * inside a B1 branch for enemy e, every OTHER rival is still held at its worst.
 * The coalition enters through how the per-enemy minima COMBINE — the bank
 * takes a max over members, and each member's own branches are priced against
 * the un-relaxed remainder. So the relaxation has to change the REMAINDER, not
 * the enumeration:
 *
 *     F_r(a) = the bank's ordinary floor with every OTHER rival team's engaged
 *              units FIXED to a declared reference action rather than held,
 *     floor_W(a) = max( strict floor(a),  min over r of F_r(a) ),
 *     ceiling_W(a) = min over r of C_r(a).
 *
 * `min over r`, not max: we do not know which rival is the one free to come at
 * us, so the floor must hold in every W_r. `max` against the strict floor
 * because a floor on the full game is also a floor on a subset of it — the one
 * direction in which a strict bound may legally strengthen a relaxed one.
 *
 * THE CEILING IS NOT ALLOWED TO COME FROM THE STRICT SIDE. Restricting the
 * reply set RAISES the min, so an unconditional ceiling can sit BELOW SV_W and
 * is not an upper bound on it. `bank.ts` already knows this shape ("each bound
 * its own game") and applies it here too.
 *
 * ── admissibility: where the relaxation is even arguable ──────────────────
 *
 * Two conditions, both structural, both computed ONCE PER DECISION so that the
 * narrowing is plan-invariant (a narrowing discovered on one plan and not on
 * another gives two plans two bases, `compareFloors` refuses, and the ascent
 * silently freezes — B2's standing warning about `declareTruncatedFloor`):
 *
 *  1. AT LEAST TWO RIVAL TEAMS. With one rival there is no cross-team
 *     coordination to relax, and the relaxation is a no-op BY CONSTRUCTION,
 *     not by tuning. This is what makes the two-team arm a structural
 *     no-regression rather than an empirical hope.
 *  2. A CROSS-RIVAL ENGAGEMENT (optional, on by default). Some unit of rival A
 *     and some unit of rival B can reach a common cell this turn. This is the
 *     evidence for the claim being made: units committed to each other cannot
 *     also be committed to us. Without it the relaxation would be asserting
 *     something about rivals that are nowhere near each other.
 *
 * ── the honesty notes, stated rather than buried ──────────────────────────
 *
 * - `influenceOf` is an OVER-approximation (the union over a unit's whole
 *   option set), and for a stale unit it is computed from its last observed
 *   cells. So engagement can be claimed where there is none. That does not
 *   make a bound wrong; it makes the DECLARED WORLD less well motivated, and
 *   the declaration says exactly which units it fixed so a reader can check.
 * - the reference action is `NO_ORDER_MOVE`, the KIND's own default — a rule
 *   of the game, not a guess about an agent. It is a weak model of a
 *   self-interested rival and deliberately so: the alternative (search the
 *   rival's own best reply in its own frame) prices agency we cannot observe,
 *   and would cost a resolution sweep per rival unit per decision.
 */

import { NO_ORDER_MOVE } from "../contracts";
import type { Assumption, Candidate, Substrate, UnitId } from "../contracts";

/** Which adversary world the bank prices in. */
export type CoalitionMode = "strict" | "per-team";

/**
 * A substrate that can name a unit's team. Feature-detected, in the honest
 * posture `substrate-ext.ts` sets: a substrate that cannot answer this cannot
 * be relaxed, and the bank stays strict — under-promising, never wrong.
 */
export interface TeamAwareSubstrate extends Substrate {
  teamOf(unitId: UnitId): number | undefined;
}

export function isTeamAware(sub: Substrate): sub is TeamAwareSubstrate {
  return typeof (sub as Partial<TeamAwareSubstrate>).teamOf === "function";
}

/** One member of the declared world set: team `hostile` free, the rest fixed. */
export interface RivalWorld {
  /** The rival team left HELD (or enumerated) — free to be worst-for-us. */
  readonly hostile: number;
  /** Engaged rival units on the OTHER rival teams, fixed by reference. */
  readonly fixes: ReadonlyArray<Candidate>;
}

export interface PerTeamWorlds {
  readonly admissible: boolean;
  /** Empty when inadmissible. */
  readonly worlds: ReadonlyArray<RivalWorld>;
  /** The one narrowing every relaxed bound rides. Null when inadmissible. */
  readonly narrowing: Assumption | null;
  readonly rivalTeams: ReadonlyArray<number>;
  /** Units the engagement test named, ascending. */
  readonly engaged: ReadonlyArray<UnitId>;
  /** Why the relaxation is (not) available — reported, never inferred. */
  readonly reason: string;
}

export const INADMISSIBLE = (reason: string): PerTeamWorlds => ({
  admissible: false,
  worlds: [],
  narrowing: null,
  rivalTeams: [],
  engaged: [],
  reason,
});

export interface WorldOptions {
  /** Require a cross-rival engagement before relaxing. Default true. */
  readonly requireEngagement?: boolean;
  /** Cap on how many rival units may be fixed in one world. A cap here only
   * makes the world LARGER (fewer fixes = closer to strict), so it needs no
   * declaration of its own beyond the narrowing already carried. */
  readonly maxFixes?: number;
}

const noOrder = (unitId: UnitId): Candidate => ({
  unitId,
  from: NO_ORDER_MOVE,
  to: NO_ORDER_MOVE,
  path: [],
});

function intersects(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const cell of small) if (large.has(cell)) return true;
  return false;
}

/**
 * Which uncontrolled units are ENGAGED WITH A DIFFERENT RIVAL TEAM: their
 * one-turn reach meets. Pairwise and symmetric — both sides of a meeting are
 * engaged, which is what makes every world's fix set non-empty.
 */
export function engagedRivals(
  sub: Substrate,
  byTeam: ReadonlyMap<number, ReadonlyArray<UnitId>>,
): ReadonlySet<UnitId> {
  const out = new Set<UnitId>();
  const teams = [...byTeam.keys()].sort((a, b) => a - b);
  if (teams.length < 2) return out;
  const reach = new Map<UnitId, ReadonlySet<number>>();
  const reachOf = (id: UnitId): ReadonlySet<number> => {
    const hit = reach.get(id);
    if (hit !== undefined) return hit;
    let cells: ReadonlySet<number>;
    try {
      cells = sub.influenceOf(id);
    } catch {
      // A substrate that refuses the question (a narrower modelled sibling)
      // cannot be asked about engagement. An empty reach never engages, so the
      // relaxation simply does not fire — the safe direction.
      cells = new Set<number>();
    }
    reach.set(id, cells);
    return cells;
  };
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const left = byTeam.get(teams[i] as number) as ReadonlyArray<UnitId>;
      const right = byTeam.get(teams[j] as number) as ReadonlyArray<UnitId>;
      for (const u of left) {
        for (const v of right) {
          if (!intersects(reachOf(u), reachOf(v))) continue;
          out.add(u);
          out.add(v);
        }
      }
    }
  }
  return out;
}

/**
 * The decision-level world set. Computed once; the note it produces is the
 * bound's basis for the whole decision, which is what keeps plan-to-plan
 * comparison legal inside the ascent.
 */
export function planPerTeamWorlds(
  sub: Substrate,
  uncontrolled: ReadonlyArray<UnitId>,
  ourTeam: number,
  options: WorldOptions = {},
): PerTeamWorlds {
  if (!isTeamAware(sub)) {
    return INADMISSIBLE("substrate cannot name a unit's team");
  }
  const byTeam = new Map<number, UnitId[]>();
  for (const id of uncontrolled) {
    const team = sub.teamOf(id);
    // A unit whose team we cannot name is left strictly held: it belongs to no
    // world's fix set and to no world's hostile team, so it is worst-cased in
    // every relaxed branch exactly as it is today.
    if (team === undefined || team === ourTeam) continue;
    const list = byTeam.get(team);
    if (list === undefined) byTeam.set(team, [id]);
    else list.push(id);
  }
  const rivalTeams = [...byTeam.keys()].sort((a, b) => a - b);
  if (rivalTeams.length < 2) {
    return INADMISSIBLE(`only ${rivalTeams.length} rival team(s): nothing to de-coordinate`);
  }

  const requireEngagement = options.requireEngagement ?? true;
  const engagedSet = requireEngagement
    ? engagedRivals(sub, byTeam)
    : new Set<UnitId>(uncontrolled.filter((id) => byTeam.has(sub.teamOf(id) as number)));
  const engaged = [...engagedSet].sort((a, b) => a - b);
  if (engaged.length === 0) {
    return INADMISSIBLE("no cross-rival engagement: the rivals are not committed to each other");
  }

  const cap = options.maxFixes ?? Number.MAX_SAFE_INTEGER;
  const worlds: RivalWorld[] = [];
  for (const hostile of rivalTeams) {
    const fixes = engaged
      .filter((id) => (sub.teamOf(id) as number) !== hostile)
      .slice(0, cap)
      .map(noOrder);
    // A world with nothing fixed IS the strict world. Keeping it would make
    // `min over r` collapse to the strict floor and the relaxation a no-op
    // with a narrowing attached — the worst of both. Drop it, and say so by
    // simply not offering that world; the remaining worlds still cover every
    // reply in which at most one team deviates from the reference, because a
    // team with no engaged rivals to fix cannot be the one that de-coordinates.
    if (fixes.length === 0) continue;
    worlds.push({ hostile, fixes });
  }
  if (worlds.length === 0) {
    return INADMISSIBLE("every rival world would fix nothing");
  }

  return {
    admissible: true,
    worlds,
    narrowing: narrowingFor(worlds, engaged, requireEngagement),
    rivalTeams,
    engaged,
    reason: `per-team world set over rival teams [${rivalTeams.join(",")}]`,
  };
}

/**
 * THE DECLARATION. One assumption, canonical, decision-level, naming the
 * restricted world set precisely enough that a reader can reconstruct it: the
 * hostile teams it ranges over, the units it fixed, and what it fixed them to.
 *
 * `unitId` is the ledger's "no single unit" sentinel because this narrowing is
 * about a RELATION between units, not about one unit's option list. The note
 * carries the identity, and `assumptionKey` keys on the note — so two
 * decisions with different fix sets are two different bases, and a bound from
 * one never compares with a bound from the other.
 */
export function narrowingFor(
  worlds: ReadonlyArray<RivalWorld>,
  engaged: ReadonlyArray<UnitId>,
  requireEngagement: boolean,
): Assumption {
  const hostiles = worlds.map((w) => w.hostile).join(",");
  return {
    kind: "narrowing",
    unitId: -1 as UnitId,
    note:
      "per-team adversary (C5): rival joint replies restricted to those in which at most one " +
      `rival team deviates from its declared reference action; hostile-team worlds [${hostiles}]; ` +
      `units fixed to NO_ORDER [${engaged.join(",")}]; ` +
      `engagement-gated=${requireEngagement ? "yes" : "no"}. ` +
      "CONDITIONAL: not comparable with an unconditional floor.",
  };
}
