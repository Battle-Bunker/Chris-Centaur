/**
 * ACUTENESS — the reading that buys depth by giving up breadth.
 *
 * ── THE PROBLEM THIS IS THE ANSWER TO ─────────────────────────────────────
 *
 * The scout's ration is a tithe of the decision and its threads are spread
 * EVENLY: `deepenNext` deepens the shallowest live cluster, which is the right
 * rule when every cluster's marginal ply is worth the same and is exactly the
 * wrong rule when it is not. On most boards it is not. A team of six with two
 * enemies converging on one snake has one question that decides the game and
 * five that decide nothing, and a scheduler that spends a sixth of its plies on
 * each answers the deciding question at depth one.
 *
 * A human does not do this. A human identifies the branches that matter,
 * discards the rest without apology, and spends everything on the few. What
 * makes that safe is not that the discarded branches are worthless — it is that
 * they are DECIDED: nothing happening on them changes hands inside the horizon.
 *
 * ── WHAT "ACUTE" IS, AS A MEASUREMENT ─────────────────────────────────────
 *
 * A situation is acute when a SMALL set of units' interaction dominates the
 * value landscape over a BOUNDED horizon. Three readings, all off the board:
 *
 *   IRREVERSIBILITY HORIZON — how many turns until something happens that
 *   cannot be taken back. A unit dying. A tier expiring. A rank settling at the
 *   turn limit. Short horizons are acute because there is no later in which to
 *   fix them.
 *
 *   MAGNITUDE — how much weight changes hands when it does, in the same units
 *   the game is scored in. A snake's whole body, a king's team, three turns of
 *   a window.
 *
 *   INVOLVED-SET SIZE — how many units decide it. This is the one that makes
 *   narrowing PAY rather than merely be possible: culling to twelve units frees
 *   nothing, culling to three frees almost everything.
 *
 * and the trigger is `magnitude / (horizon + 1)` against a threshold, gated on
 * the involved set being small. That is the whole detector. It is a RATE — value
 * per turn of grace — and it is scale-free in exactly the way it needs to be: a
 * king three turns out and a snake's body next turn can both fire, and a heavy
 * exchange eight turns away does not.
 *
 * ── FIVE FAMILIES, FOUR READINGS, NO PATTERNS ─────────────────────────────
 *
 * The families this was built against — corridor entrapment, the turn-limit
 * razor, the regicide window, sever-defence triage, mutual-annihilation
 * brinkmanship — are NOT five detectors. They are what four generic readings
 * find:
 *
 *   `contest`  a contest reachable inside the horizon, magnitude decided by who
 *              wins it under the engine's own tier-then-weight ordering. Finds
 *              regicide (the king's magnitude is its whole team), finds
 *              brinkmanship (nobody wins the tie, so BOTH weights are at
 *              stake), finds any converging kill.
 *   `expiry`   a modifier with a clock on it. A tier is the only one the game
 *              has, so this is where potion windows enter — as "a large effect
 *              with a known end", which is what they are, and not as a special
 *              case. Ours expiring is an opportunity closing; theirs expiring is
 *              a danger passing; a collector at −1 is a unit whose own
 *              vulnerability has a deadline.
 *   `enclosure` a unit whose escape fan is nearly closed. Magnitude is its whole
 *              weight, horizon is how many exits are left to close. Finds
 *              corridor entrapment from BOTH sides — ours about to be trapped,
 *              theirs about to be trappable.
 *   `razor`    the game's own clock. Horizon is turns to the limit and the
 *              magnitude is our whole standing, because at the limit what
 *              changes hands is a RANK — gated on the margin to the team next
 *              to us being smaller than an exchange still reachable, which is
 *              what makes one contested cluster settle it.
 *
 * A sixth family would be a fifth reading or nothing. There is no table of
 * shapes in this file and adding one would be the bug.
 *
 * ── WHAT IT MAY AND MAY NOT DO ────────────────────────────────────────────
 *
 * `la-outside` L8: *the scheduler may be wrong; the bounds may not be.* This is
 * a scheduler input and nothing else. Every number here is an APPROXIMATION —
 * distances are geometric rather than flooded, magnitudes are weights rather
 * than priced outcomes — and that is allowed precisely because the worst a
 * wrong reading can do is spend the tithe in the wrong place. No bound, no
 * refusal and no staged move is reachable from this file, and it imports
 * nothing that could construct one.
 *
 * ── AND THE BREADTH RESERVE ───────────────────────────────────────────────
 *
 * A trigger that captured the whole budget would be a bot any opponent could
 * lead by the nose: manufacture something acute-looking on one wing and the
 * search stops looking at the other. So the focus never gets everything.
 * `AcuteTuning.breadthReserve` is the share of the scout's plies that keeps
 * exploring the unfocused board no matter how acute the reading, and it is a
 * configured number rather than a constant because how much a feint is worth
 * defending against is an empirical question and not a taste.
 */

import { profileOf } from '../../partial-engine/index';
import type { EngineSubstrate, SubstrateUnit } from '../substrate';
import type { UnitId } from '../contracts';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface AcuteTuning {
  /**
   * THE TRIGGER. Weight-per-turn-of-grace a situation must reach before the
   * search narrows around it. In the same units the board is scored in — a
   * snake's body is its cell count — so `3` means "a whole nine-cell snake,
   * two turns out" or "a six-cell trade next turn" and reads as what it is.
   */
  readonly threshold: number;
  /**
   * THE LARGEST INVOLVED SET WORTH NARROWING TO. A situation naming more units
   * than this is not focusable: culling to it frees no budget, so firing on it
   * would trade breadth for nothing.
   */
  readonly maxInvolved: number;
  /** Turns past which nothing counts as acute, whatever it is worth. */
  readonly horizonMax: number;
  /**
   * THE FEINT DEFENCE. Share of the scout's plies reserved for threads OUTSIDE
   * the focus, however acute the reading. Zero is a bot that can be led away
   * from anything; one is a bot that never narrows.
   */
  readonly breadthReserve: number;
  /** Ply ceiling for a FOCUSED thread. The depth the narrowing buys. */
  readonly focusDepthMax: number;
  /** Options per unit inside a focused deep node — the breadth spent on depth. */
  readonly focusOptionCap: number;
  /** Our joint plans enumerated per focused node. */
  readonly focusJoints: number;
  /** Enemy replies enumerated per focused node. */
  readonly focusReplies: number;
  /**
   * Free neighbours at or below which a unit counts as nearly enclosed. Four is
   * a snake with one way out on an open board.
   */
  readonly enclosureExits: number;
  /**
   * THE GAME'S TURN LIMIT, or 0 for "not stated". The razor reading is the one
   * family that cannot be derived from the position, because the position does
   * not carry the rule. Zero disables it rather than guessing a limit.
   */
  readonly turnLimit: number;
}

export const DEFAULT_ACUTE_TUNING: AcuteTuning = {
  // Three cells of weight per turn of grace. Calibrated against the shipped
  // shape rather than chosen: on a 3×6 roster a snake runs eight to twelve
  // cells, so `3` fires on a whole snake three turns out, on a king exchange at
  // almost any range, and on a mutual trade next turn — and stays quiet on two
  // units drifting past each other, which is most of most boards.
  threshold: 3,
  maxInvolved: 4,
  horizonMax: 4,
  breadthReserve: 0.35,
  focusDepthMax: 6,
  focusOptionCap: 5,
  focusJoints: 12,
  focusReplies: 6,
  enclosureExits: 2,
  turnLimit: 0,
};

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

/** Which of the four readings found this. Provenance, never a dispatch key. */
export type AcuteKind = 'contest' | 'expiry' | 'enclosure' | 'razor';

export interface AcuteSituation {
  readonly kind: AcuteKind;
  /** OUR units whose lines decide it — the set the search narrows to. */
  readonly ours: ReadonlySet<UnitId>;
  /** Everyone involved, ours and theirs, for the operator's record. */
  readonly involved: number;
  /** Turns until the irreversible event. */
  readonly horizon: number;
  /** Weight that changes hands when it happens, in board units. */
  readonly magnitude: number;
  /** `magnitude / (horizon + 1)`. */
  readonly acuteness: number;
  readonly note: string;
}

export interface AcuteFocus {
  /** True when at least one situation cleared the threshold and the size gate. */
  readonly fired: boolean;
  /** The union of the firing situations' own units, capped at `maxInvolved`. */
  readonly units: ReadonlySet<UnitId>;
  /** Every situation that fired, most acute first. */
  readonly situations: ReadonlyArray<AcuteSituation>;
  /** The most acute reading on the board, fired or not — telemetry. */
  readonly acuteness: number;
  /** The shortest horizon among the firing situations, or 0. */
  readonly horizon: number;
}

export const NO_FOCUS: AcuteFocus = {
  fired: false,
  units: new Set(),
  situations: [],
  acuteness: 0,
  horizon: 0,
};

// ---------------------------------------------------------------------------
// Geometry — approximate on purpose
// ---------------------------------------------------------------------------

/**
 * TURNS FOR THIS KIND TO CROSS `d` CELLS, geometrically.
 *
 * A slider crosses any distance along a line in one move and is charged one
 * turn for the whole gap; a stepper is charged one turn per cell; a jumper
 * covers its own offsets. Nothing here consults occupancy, and it must not: a
 * flooded reach is what the evaluator's arrival shells are for, this is a
 * TRIGGER, and a trigger that cost a flood per pair would spend the budget it
 * exists to allocate.
 *
 * The error is in the optimistic direction — a blocked slider is charged one
 * turn for a gap it cannot cross — which makes the detector fire on situations
 * that turn out quiet. That is the safe direction: a false fire costs plies
 * spent on a decided question, a false quiet costs the game.
 */
function turnsToCross(kind: number, dx: number, dy: number): number {
  const profile = profileOf(kind);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return 0;
  if (profile.rays.length > 0) {
    // Along one of its own rays, one move. Off them, one move to the line and
    // one along it — two, and that is the whole of what a slider's geometry
    // buys it here.
    for (const [rx, ry] of profile.rays) {
      if (rx === 0 && dx === 0) return 1;
      if (ry === 0 && dy === 0) return 1;
      if (rx !== 0 && ry !== 0 && ax === ay) return 1;
    }
    return 2;
  }
  // A STEPPER'S REACH IS ITS WHOLE OFFSET SET, not one offset repeated. Two
  // numbers say it: how far the set reaches per axis, and whether any single
  // offset moves in BOTH axes at once.
  //
  //   diagonal-capable (king, knight, pawn) — the axes are covered together, so
  //   the crossing is the LARGER of the two per-axis counts;
  //   orthogonal-only (a snake) — every move spends itself on one axis, so the
  //   crossing is their SUM.
  //
  // Reading it as "repeat one offset" is how a snake ends up unable to reach
  // anything off its own file, and a detector whose distance is infinite for
  // every diagonal pair finds no contests at all.
  let sx = 0;
  let sy = 0;
  let both = false;
  for (const [ox, oy] of profile.steps) {
    const px = Math.abs(ox);
    const py = Math.abs(oy);
    if (px === 0 && py === 0) continue;
    if (px > sx) sx = px;
    if (py > sy) sy = py;
    if (px > 0 && py > 0) both = true;
  }
  if (sx === 0 && sy === 0) return Number.POSITIVE_INFINITY;
  const nx = ax === 0 ? 0 : sx === 0 ? Number.POSITIVE_INFINITY : Math.ceil(ax / sx);
  const ny = ay === 0 ? 0 : sy === 0 ? Number.POSITIVE_INFINITY : Math.ceil(ay / sy);
  const n = both ? Math.max(nx, ny) : nx + ny;
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
  return Math.max(1, n);
}

/** Turns until these two units' heads could be on the same cell. */
function contactTurns(
  a: SubstrateUnit,
  b: SubstrateUnit,
  width: number
): number {
  const ha = a.cells[0];
  const hb = b.cells[0];
  if (ha === undefined || hb === undefined) return Number.POSITIVE_INFINITY;
  const dx = (hb % width) - (ha % width);
  const dy = Math.floor(hb / width) - Math.floor(ha / width);
  // Either may close the gap, and they close it together — so the meeting is at
  // the smaller of the two crossings over the halved gap, floored at one turn.
  const ta = turnsToCross(a.kind, dx, dy);
  const tb = turnsToCross(b.kind, dx, dy);
  const joint = Math.max(1, Math.ceil(Math.min(ta, tb) / 2));
  return Math.min(joint, Math.min(ta, tb));
}

/** The tier this unit carries into a contest resolved at `turn`. */
function tierAtTurn(u: SubstrateUnit, turn: number): number {
  const expiry = u.tierExpiresAtTurn;
  // The wire convention is "at this turn the tier has already reverted".
  if (expiry === null || expiry === undefined) return u.tier;
  return turn < expiry ? u.tier : 0;
}

/**
 * WHO WINS, AND WHAT IS AT STAKE — the engine's own ordering, applied to two
 * units meeting head-on: tier strictly first, then weight, and nobody wins a
 * tie so everybody in it dies (`turnEngine.ts:182-188`).
 */
function stake(a: SubstrateUnit, b: SubstrateUnit, turn: number): number {
  const ta = tierAtTurn(a, turn);
  const tb = tierAtTurn(b, turn);
  if (ta !== tb) return ta > tb ? b.weight : a.weight;
  if (a.weight !== b.weight) return a.weight > b.weight ? b.weight : a.weight;
  // The mutual-annihilation case: no strict maximum, so both are on the table.
  return a.weight + b.weight;
}

/** A king's magnitude is its whole team: losing it is the team's elimination. */
function magnitudeOf(u: SubstrateUnit, teamWeight: ReadonlyMap<number, number>): number {
  if (u.isKing) return teamWeight.get(u.team) ?? u.weight;
  return u.weight;
}

// ---------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------

/**
 * Read the board for acute situations.
 *
 * COST CLASS: O(units²) integer arithmetic plus one candidate enumeration per
 * unit of ours for the enclosure reading. On the shipped 3×6 roster that is
 * ~324 pairs of three multiplies — orders of magnitude under the single
 * resolution the cheapest thread ply costs, which is the only budget it has to
 * be cheap against.
 */
export function detectAcute(
  sub: EngineSubstrate,
  asTeam: number,
  tuning: AcuteTuning = DEFAULT_ACUTE_TUNING
): AcuteFocus {
  const turn = sub.turn;
  const width = sub.grid.width;
  const roster = sub.roster();
  const ours: SubstrateUnit[] = [];
  const theirs: SubstrateUnit[] = [];
  const teamWeight = new Map<number, number>();
  for (const u of roster) {
    teamWeight.set(u.team, (teamWeight.get(u.team) ?? 0) + u.weight);
    if (u.team === asTeam) ours.push(u);
    else theirs.push(u);
  }
  if (ours.length === 0) return NO_FOCUS;

  const found: AcuteSituation[] = [];
  const push = (s: Omit<AcuteSituation, 'acuteness'>): void => {
    if (s.horizon > tuning.horizonMax) return;
    const acuteness = s.magnitude / (s.horizon + 1);
    found.push({ ...s, acuteness });
  };

  // ---- READING 1: a contest reachable inside the horizon ----------------
  for (const o of ours) {
    for (const e of theirs) {
      const h = contactTurns(o, e, width);
      if (!Number.isFinite(h) || h > tuning.horizonMax) continue;
      const at = turn + h;
      const loser = stake(o, e, at);
      // A king in it raises the magnitude to the team, whichever side it is on:
      // a regicide window and a regicide danger are the same reading.
      const magnitude = Math.max(
        loser,
        o.isKing || e.isKing
          ? Math.max(
              o.isKing ? magnitudeOf(o, teamWeight) : 0,
              e.isKing ? magnitudeOf(e, teamWeight) : 0
            )
          : 0
      );
      // Everyone of ours who could also be there — the coordinating set, and
      // the reason a two-unit close is focusable and a six-unit scramble is not.
      const set = new Set<UnitId>([o.unitId]);
      for (const other of ours) {
        if (other.unitId === o.unitId) continue;
        if (contactTurns(other, e, width) <= h + 1) set.add(other.unitId);
      }
      push({
        kind: 'contest',
        ours: set,
        involved: set.size + 1,
        horizon: h,
        magnitude,
        note: `unit ${o.unitId} vs ${e.unitId} in ${h}: ${magnitude.toFixed(1)} at stake`,
      });
    }
  }

  // ---- READING 2: a modifier with a clock on it -------------------------
  //
  // The only modifier the game has is a tier, so this reading is where potion
  // windows enter — as an effect with a deadline, which is what they are.
  for (const u of roster) {
    const tier = tierAtTurn(u, turn);
    if (tier === 0) continue;
    const expiry = u.tierExpiresAtTurn;
    const left = expiry === null || expiry === undefined ? tuning.horizonMax : Math.max(0, expiry - turn);
    const mine = u.team === asTeam;
    if (tier > 0) {
      // A window: whoever holds it can take bodies for `left` turns. What is at
      // stake is the weight standing inside the holder's reach — approximated
      // by the heaviest unit on the other side it can meet in time.
      let magnitude = 0;
      // THE HORIZON IS WHEN THE CUT LANDS, NOT WHEN THE WINDOW CLOSES. A window
      // with three turns left whose first cut is available NEXT TURN is acute
      // now; reading the expiry as the horizon would divide by the grace the
      // holder has rather than by the grace the victim has, which is the wrong
      // one of the two. The expiry is the GATE — past it there is no window at
      // all — and `left` is used as exactly that.
      let horizon = Number.POSITIVE_INFINITY;
      const set = new Set<UnitId>();
      const targets = mine ? theirs : ours;
      for (const t of targets) {
        const h = contactTurns(u, t, width);
        if (h > left) continue;
        if (t.weight > magnitude) magnitude = t.weight;
        if (h < horizon) horizon = h;
        if (!mine) set.add(t.unitId);
      }
      if (mine) set.add(u.unitId);
      if (magnitude === 0 || set.size === 0 || !Number.isFinite(horizon)) continue;
      push({
        kind: 'expiry',
        ours: set,
        involved: set.size + 1,
        horizon,
        magnitude,
        note: mine
          ? `our window on unit ${u.unitId} cuts in ${horizon}, closes in ${left}`
          : `their window on unit ${u.unitId} cuts in ${horizon}, closes in ${left}`,
      });
    } else {
      // A collector — the unit that paid for the window, sitting under the whole
      // board. Ours is a unit we must keep alive for `left` turns; theirs is a
      // unit anything of ours takes, and taking it collapses their window.
      const set = new Set<UnitId>();
      if (mine) set.add(u.unitId);
      else {
        for (const o of ours) if (contactTurns(o, u, width) <= left) set.add(o.unitId);
      }
      if (set.size === 0) continue;
      push({
        kind: 'expiry',
        ours: set,
        involved: set.size + 1,
        horizon: mine ? 1 : Math.min(left, tuning.horizonMax),
        // Their collector is worth its own weight PLUS the window that dies
        // with it, which is the heaviest thing its allies threaten.
        magnitude: mine ? u.weight : u.weight + (teamWeight.get(u.team) ?? 0) * 0.25,
        note: mine
          ? `our collector ${u.unitId} is vulnerable for ${left}`
          : `their collector ${u.unitId} is takeable for ${left}`,
      });
    }
  }

  // ---- READING 3: a unit whose escape fan is nearly closed ---------------
  //
  // Ours about to be trapped and theirs about to be trappable are one reading.
  // Only our own units can be enumerated cheaply (the generator is ours), so
  // the enemy side is read from free NEIGHBOURS rather than from legal moves —
  // a coarser count, and coarse is what a trigger is allowed to be.
  for (const o of ours) {
    let exits = 0;
    try {
      for (const c of sub.actionsOf(o.unitId)) {
        if (!sub.hazardAt(c.to)) exits++;
      }
    } catch {
      continue;
    }
    if (exits > tuning.enclosureExits) continue;
    push({
      kind: 'enclosure',
      ours: new Set([o.unitId]),
      involved: 1,
      horizon: exits,
      magnitude: magnitudeOf(o, teamWeight),
      note: `unit ${o.unitId} has ${exits} way(s) out`,
    });
  }
  for (const e of theirs) {
    const head = e.cells[0];
    if (head === undefined) continue;
    let exits = 0;
    const x = head % width;
    const y = Math.floor(head / width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as ReadonlyArray<readonly [number, number]>) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= sub.grid.height) continue;
      const cell = ny * width + nx;
      if (sub.hazardAt(cell)) continue;
      exits++;
    }
    if (exits > tuning.enclosureExits) continue;
    // Who of ours could help close it. That set IS the corridor's participants,
    // and its size is exactly the reason this family is focusable.
    const set = new Set<UnitId>();
    for (const o of ours) if (contactTurns(o, e, width) <= tuning.horizonMax) set.add(o.unitId);
    if (set.size === 0) continue;
    push({
      kind: 'enclosure',
      ours: set,
      involved: set.size + 1,
      horizon: Math.max(1, exits),
      magnitude: magnitudeOf(e, teamWeight),
      note: `enemy ${e.unitId} has ${exits} way(s) out; ${set.size} of ours can close`,
    });
  }

  // ---- READING 4: the game's own clock -----------------------------------
  if (tuning.turnLimit > 0) {
    const left = tuning.turnLimit - turn;
    if (left >= 0 && left <= tuning.horizonMax) {
      const mine = teamWeight.get(asTeam) ?? 0;
      let gap = Number.POSITIVE_INFINITY;
      for (const [team, w] of teamWeight) {
        if (team === asTeam) continue;
        const d = Math.abs(w - mine);
        if (d < gap) gap = d;
      }
      if (Number.isFinite(gap)) {
        // THE RAZOR IS A COMPARISON, NOT A DISTANCE. What makes the clock acute
        // is not that it is running out — it always is — but that the MARGIN
        // deciding our rank is smaller than a single exchange still available.
        // So the reading finds the biggest swing reachable in the turns left and
        // fires only when the gap is inside it: one contest settles the order,
        // which is exactly the family this is.
        let bestId: UnitId | null = null;
        let swing = 0;
        for (const o of ours) {
          for (const e of theirs) {
            const h = contactTurns(o, e, width);
            if (h > left + 1) continue;
            const w = stake(o, e, turn + h);
            if (w > swing) {
              swing = w;
              bestId = o.unitId;
            }
          }
        }
        if (bestId !== null && gap <= swing) {
          push({
            kind: 'razor',
            ours: new Set([bestId]),
            involved: 2,
            horizon: left,
            // Our whole standing is what the rank moves, and the exchange is
            // what moves it — so the magnitude is the standing, gated on the
            // exchange being big enough to reach across the gap.
            magnitude: teamWeight.get(asTeam) ?? swing,
            note: `${left} turn(s) to the limit, gap ${gap.toFixed(1)} inside a ${swing.toFixed(1)} swing`,
          });
        }
      }
    }
  }

  // ---- the gate ----------------------------------------------------------
  found.sort((a, b) => b.acuteness - a.acuteness);
  const peak = found.length === 0 ? 0 : (found[0] as AcuteSituation).acuteness;
  const firing = found.filter(
    (s) => s.acuteness >= tuning.threshold && s.ours.size > 0 && s.ours.size <= tuning.maxInvolved
  );
  if (firing.length === 0) {
    return { ...NO_FOCUS, acuteness: peak };
  }
  // The union, capped. Taking the most acute situations first is what keeps the
  // cap from being an arbitrary truncation: what is dropped is always the least
  // acute thing that asked.
  const units = new Set<UnitId>();
  const kept: AcuteSituation[] = [];
  let horizon = Number.POSITIVE_INFINITY;
  for (const s of firing) {
    const merged = new Set(units);
    for (const id of s.ours) merged.add(id);
    if (merged.size > tuning.maxInvolved && units.size > 0) continue;
    for (const id of merged) units.add(id);
    kept.push(s);
    if (s.horizon < horizon) horizon = s.horizon;
    if (units.size >= tuning.maxInvolved) break;
  }
  return {
    fired: units.size > 0,
    units,
    situations: kept,
    acuteness: peak,
    horizon: Number.isFinite(horizon) ? horizon : 0,
  };
}
