/**
 * `potionDefense` — WHAT AN ENEMY'S POTION DOES TO US, AND THE ONE MOVE THAT
 * UNDOES IT.
 *
 * ── THE HALF OF THE POTION STORY NOTHING ON THIS BRANCH PRICED ─────────────
 *
 * The four seated potion terms are, every one of them, about OUR pickup:
 * `potion-seek` prices one we have not made, `attack-window` prices one we are
 * holding, `potion-control` prices the ground we would collect from, and
 * `dodge-discount` prices what our own collector is running from. Not one of
 * them reads a tier on an enemy unit. A bot carrying the whole lineup plays a
 * potion board as though only its own team could ever drink.
 *
 * That is not a gap in emphasis, it is a gap in the mechanism. `turnEngine.ts`
 * ranks tier STRICTLY before weight, so for the three turns after an enemy
 * pickup every untouched unit of theirs beats every unit of ours at every
 * weight. Our floor cannot see it: the floor is a bound on THIS turn's
 * resolution and the cut lands one to three turns out, so every plan's floor
 * ties and the choice falls through to `est` — where, until this module, there
 * was nothing to say.
 *
 * ── THE THREE FACTS THIS MODULE IS BUILT OUT OF ────────────────────────────
 *
 *   1. AN ENEMY WINDOW IS A THREAT WITH AN EXPIRY. `tierAt` already answers
 *      "what tier does this unit carry into a contest resolved at turn t", so
 *      the threat is `teamAttackWindow` run for THEM, at `tierDelta: 0`,
 *      filtered to the cuts and contests whose victim is ours. Everything
 *      needed was already here and pointed the other way.
 *
 *   2. THE COLLECTOR IS FREE. It sits at −1 for the same three turns, which is
 *      the strict minimum of every contest it can enter: any unit of ours takes
 *      it at any weight. Nothing else on a potion board is ever this cheap.
 *
 *   3. TAKING IT COLLAPSES THE WINDOW. `scheduleVulnerableCollisionBuffExpiry`
 *      (`TeamSnekProcessor.ts:531-556`): when a unit whose tier was below zero
 *      dies OR SURVIVES A SEVER, every teammate's buff is rescheduled to end
 *      THAT TURN. So a collector taken on turn `k` leaves their allies at tier
 *      0 from `k + 1`, and every cut their window was going to land after `k`
 *      is cancelled. The counter-attack is not merely a kill — it is the kill
 *      plus the whole remainder of the threat.
 *
 * Together those three make the enemy-window position a genuinely computable
 * TRIAGE rather than a mood: run from their buffed units, or run at their
 * collector, and the choice is decided by which number is bigger.
 *
 * ── WHAT IT DELIBERATELY DOES NOT COUNT ────────────────────────────────────
 *
 * THREATS THAT NEED NO POTION. A unit only enters the threat sum when its own
 * live tier is strictly positive at the window's first turn. An enemy that
 * could already take our head by out-weighing it could do so with no potion on
 * the board, that danger is already in the floor and in `material`, and
 * counting it here would make every enemy on a potion board look like a window.
 * The same test is why the counter-attack half reads `tier < 0` and not "a unit
 * we out-weigh".
 *
 * THIRD PARTIES. A cut of theirs that lands on a THIRD team is not our loss —
 * on the share metric it is close to our gain — so the victim filter is on our
 * own team and the sum is a statement about our own weight. That filter is the
 * reason this module cannot be `teamAttackWindow` called with the arguments
 * swapped.
 *
 * DEFENCE AGAINST OUR OWN COLLECTOR. Ours is `potion-seek`'s `exposure`, priced
 * there with the dodge discount, and adding it here would charge one collector
 * twice.
 *
 * ── THE CURRENCY, AND WHY IT IS RETURNED SPLIT ─────────────────────────────
 *
 * `threat` and `cancelled` are OUR weight. `counterWeight` is THEIR weight, and
 * one unit of theirs is worth `severExchangeRate` of ours on the share metric.
 * The fold is the caller's (`potionDefenseNet`) for exactly the reason
 * `potionSeek` splits gain from exposure: a caller pricing the worst case has
 * to be able to zero one side without arithmetic on the other.
 */

import { tierAt } from './ray-crossing';
import type { OccupancyIndex, RayBoard, RayUnit } from './ray-crossing';
import { NO_REACH, POTION_WINDOW_TURNS, UNREACHABLE, attackWindow } from './attack-window';
import type { ArrivalReach, AttackWindowValue } from './attack-window';
import { indexOccupancy } from './ray-crossing';
import type { StrategyEntry } from '../registry';

/** One enemy unit that is dangerous BECAUSE of a potion, and what it threatens. */
export interface WindowThreat {
  readonly attackerId: string;
  readonly team: number;
  /** The live tier it carries into the window's first turn. Always > 0 here. */
  readonly tier: number;
  /** Our body weight it could sever inside the window. */
  readonly body: number;
  /** Absolute turn of that cut, or null. */
  readonly bodyAt: number | null;
  /** Our unit weight it could take in a head-class contest it wins on tier. */
  readonly head: number;
  readonly headAt: number | null;
  readonly victimId: string | null;
}

/** One enemy collector — a unit sitting under the whole board — and our answer. */
export interface CollectorTarget {
  readonly collectorId: string;
  readonly team: number;
  /** The weight we take by taking it. */
  readonly weight: number;
  /** The earliest absolute turn one of our units can be on its head cell, or
   *  `UNREACHABLE`. */
  readonly reachAt: number;
  /** Which of ours gets there first. Null when nothing does. */
  readonly byUnitId: string | null;
  /**
   * The part of that team's threat this kill CANCELS: every cut of theirs whose
   * turn is strictly after `reachAt`, because the buff is rescheduled to end on
   * the turn the vulnerable unit collides.
   */
  readonly cancels: number;
}

export interface PotionDefenseValue {
  readonly fromTurn: number;
  readonly toTurn: number;
  /** Our weight at risk from every enemy window on the board. */
  readonly threat: number;
  readonly threats: ReadonlyArray<WindowThreat>;
  /** The best collector answer available to us, or null. */
  readonly best: CollectorTarget | null;
  readonly targets: ReadonlyArray<CollectorTarget>;
  /** True when some enemy holds a live positive tier — the whole gate. */
  readonly underWindow: boolean;
}

export interface PotionDefenseOptions {
  readonly turn?: number;
  readonly reach?: ArrivalReach | null;
  readonly windowTurns?: number;
  readonly fromTurn?: number;
  readonly toTurn?: number;
  /**
   * Count the head channel as well as the body channel.
   *
   * Default true, and it is the half that matters on a mostly-snake board: a
   * buffed enemy head-on kills our snake outright whatever it weighs, which is
   * a whole unit rather than a slice of trail. It is safe to count here — and
   * not in `potion-seek` — precisely because the attacker is filtered to units
   * whose tier is potion-given, so what is summed is the danger the potion
   * ADDED and never the danger that was there anyway.
   */
  readonly countHeads?: boolean;
}

const EMPTY: Omit<PotionDefenseValue, 'fromTurn' | 'toTurn'> = {
  threat: 0,
  threats: [],
  best: null,
  targets: [],
  underWindow: false,
};

/** Does any unit not on `asTeam` carry a live positive tier at `turn`? The
 *  cheapest possible gate, and the only thing a quiet board pays. */
export function anyEnemyWindow(board: RayBoard, asTeam: number, turn: number): boolean {
  for (const u of board.units) {
    if (u.team === asTeam) continue;
    if (tierAt(u, turn) > 0) return true;
  }
  return false;
}

/** Any enemy unit sitting at a negative live tier — a collector we could take. */
export function anyEnemyCollector(board: RayBoard, asTeam: number, turn: number): boolean {
  for (const u of board.units) {
    if (u.team === asTeam) continue;
    if (tierAt(u, turn) < 0) return true;
  }
  return false;
}

/**
 * Price the enemy's windows against us, and our answer to them.
 *
 * COST CLASS: one `attackWindow` per BUFFED enemy unit — never per enemy — plus
 * one reach lookup per enemy collector per unit of ours. On a board with no
 * enemy tier standing the gate returns having read one integer per unit.
 */
export function potionDefense(
  board: RayBoard,
  asTeam: number,
  options: PotionDefenseOptions = {},
  index?: OccupancyIndex
): PotionDefenseValue {
  const turn = options.turn ?? board.turn ?? 0;
  const windowTurns = options.windowTurns ?? POTION_WINDOW_TURNS;
  const fromTurn = options.fromTurn ?? turn + 1;
  const toTurn = options.toTurn ?? fromTurn + windowTurns - 1;
  const reach = options.reach ?? NO_REACH;
  const countHeads = options.countHeads !== false;

  const buffed: RayUnit[] = [];
  const collectors: RayUnit[] = [];
  for (const u of board.units) {
    if (u.team === asTeam) continue;
    const t = tierAt(u, fromTurn);
    if (t > 0) buffed.push(u);
    else if (t < 0) collectors.push(u);
  }
  if (buffed.length === 0 && collectors.length === 0) {
    return { fromTurn, toTurn, ...EMPTY };
  }

  const occ = index ?? indexOccupancy(board, fromTurn);
  const teamOf = new Map<string, number>();
  const headOf = new Map<string, number>();
  for (const u of board.units) {
    teamOf.set(u.unitId, u.team);
    const head = u.occupancy[0];
    if (head !== undefined) headOf.set(u.unitId, head);
  }
  const oursId: string[] = [];
  for (const u of board.units) if (u.team === asTeam) oursId.push(u.unitId);

  // ---- the threat ------------------------------------------------------
  //
  // One window per buffed enemy, and the victim filter is what makes the sum
  // ours rather than the board's.
  const threats: WindowThreat[] = [];
  let threat = 0;
  /** Per enemy team, the cuts it threatens, by absolute turn — the input the
   *  cancellation arithmetic needs. */
  const byTeam = new Map<number, Array<{ at: number; weight: number }>>();
  for (const u of buffed) {
    const v: AttackWindowValue = attackWindow(
      board,
      u,
      { turn, fromTurn, toTurn, tierDelta: 0, reach },
      occ
    );
    const bodyMine = v.bodyVictim !== null && teamOf.get(v.bodyVictim) === asTeam;
    const headMine = v.headVictim !== null && teamOf.get(v.headVictim) === asTeam;
    const body = bodyMine ? v.body.est : 0;
    const head = countHeads && headMine ? v.head.est : 0;
    if (body === 0 && head === 0) continue;
    threats.push({
      attackerId: u.unitId,
      team: u.team,
      tier: tierAt(u, fromTurn),
      body,
      bodyAt: bodyMine ? v.bodyAt : null,
      head,
      headAt: headMine ? v.headAt : null,
      victimId: body >= head ? v.bodyVictim : v.headVictim,
    });
    threat += body + head;
    const rows = byTeam.get(u.team) ?? [];
    if (body > 0) rows.push({ at: v.bodyAt ?? toTurn, weight: body });
    if (head > 0) rows.push({ at: v.headAt ?? toTurn, weight: head });
    byTeam.set(u.team, rows);
  }

  // ---- the answer ------------------------------------------------------
  //
  // A collector is taken by standing on its head cell. `reach` is the same
  // absolute-turn grid every other potion term reads, so this is a lookup per
  // (our unit, collector) and no flood.
  const targets: CollectorTarget[] = [];
  let best: CollectorTarget | null = null;
  for (const c of collectors) {
    const cell = headOf.get(c.unitId);
    if (cell === undefined) continue;
    let reachAt = UNREACHABLE;
    let by: string | null = null;
    for (const id of oursId) {
      const t = reach.earliestAt(id, cell);
      if (t < reachAt) {
        reachAt = t;
        by = id;
      }
    }
    if (reachAt > toTurn || by === null) {
      targets.push({
        collectorId: c.unitId,
        team: c.team,
        weight: c.weight,
        reachAt,
        byUnitId: null,
        cancels: 0,
      });
      continue;
    }
    // Everything that team's window was going to land AFTER the collision it is
    // about to have. The buff is rescheduled to end on the turn of the
    // collision, so a cut at `reachAt` itself still resolves and is not
    // cancelled — the pessimistic reading, and the one the engine's own
    // ordering supports.
    let cancels = 0;
    for (const row of byTeam.get(c.team) ?? []) if (row.at > reachAt) cancels += row.weight;
    const target: CollectorTarget = {
      collectorId: c.unitId,
      team: c.team,
      weight: c.weight,
      reachAt,
      byUnitId: by,
      cancels,
    };
    targets.push(target);
    if (best === null || target.weight + target.cancels > best.weight + best.cancels) best = target;
  }

  return {
    fromTurn,
    toTurn,
    threat,
    threats,
    best,
    targets,
    underWindow: buffed.length > 0,
  };
}

/**
 * THE FOLD, in our-weight units.
 *
 * `exchangeRate` is `severExchangeRate` off the live board — what one unit of
 * enemy weight removed is worth in units of our own on the share metric. The
 * kill is denominated in theirs; the threat and the cancellation are ours.
 *
 * Signed so that MORE IS BETTER, like every other advisory term: a board where
 * they hold a window and we cannot answer it reads negative, and the plans that
 * read least negative are the ones that got our bodies out of the way.
 */
export function potionDefenseNet(value: PotionDefenseValue, exchangeRate: number): number {
  if (!Number.isFinite(exchangeRate)) return 0;
  const counter = value.best === null ? 0 : exchangeRate * value.best.weight + value.best.cancels;
  return counter - value.threat;
}

/**
 * A registry entry, and NOT a registered one — the same discipline every other
 * candidate in this directory follows. It becomes live by a slate naming it.
 */
export const POTION_DEFENSE_ENTRY: StrategyEntry = {
  id: 'eval/potion-defense@1',
  slot: 'evaluator',
  primitive: 'ray-crossing+arrival-shells',
  soundness: 'advisory',
  params: {
    windowTurns: POTION_WINDOW_TURNS,
    /** Only units whose tier is potion-given threaten here. */
    attackerGate: 'live-tier > 0',
    /** Only units the potion put underneath the board are free targets. */
    targetGate: 'live-tier < 0',
    victims: 'subject-team only',
    countHeads: true,
    cancellation: 'vulnerable-collision buff expiry (TeamSnekProcessor.ts:531-556)',
    currency: 'kill at sever-exchange-rate, threat and cancellation in our weight',
    weight: 0,
  },
  priors: {
    fitted: false,
    strata: ['potions-on'],
    note:
      'Nothing here is fitted. The three quantities are read off the engine rules — ' +
      'tier ordering, the three-turn effect, and the vulnerable-collision expiry.',
  },
  cost: {
    fitted: false,
    features: ['buffed enemy count', 'enemy collector count', 'our unit count'],
    note: 'One attack window per BUFFED enemy plus one reach lookup per (our unit, collector).',
  },
  record: {
    status: 'candidate',
    ledgerRows: [],
    note:
      'The defensive half of the potion doctrine: the enemy window priced against us, ' +
      'and the collector-kill that collapses it.',
  },
};
