/**
 * THE GAME-LEVEL LAYER — everything `resolveTurn` deliberately does not carry.
 *
 * The vendored resolver's own header names the exclusions verbatim
 * (`resolveTurn.ts:35-39`): "spawning food, hazards or potions; invulnerability
 * potions, effects and the tier changes they cause (tier is an INPUT, which
 * already captures their effect at adjudication time); the orientation rewrite;
 * pawn promotion; scoring, winners and MMR; anything Firestore."
 *
 * Promotion is handled in `sim.ts` (mirrored from `Simulator.promoteIfDue`) and
 * the orientation rewrite comes back out of the resolver in `rotations`. What
 * is left — food spawning, potion spawning, potion COLLECTION and the buff /
 * debuff effects it creates — lives here, ported from
 * `TeamSnekProcessor` in the upstream TacticToes repo:
 *
 *   generateNewFood                 -> spawnFood
 *   generateNewInvulnerabilityPotions -> spawnPotions
 *   processInvulnerabilityPotionCollection -> collectPotions
 *   expireEffects (inline)          -> expireEffects
 *
 * The one deviation is the RNG: upstream calls `Math.random()`, this draws from
 * the game's seeded item stream so a replay is reproducible.
 *
 * HOW TIER REACHES THE RESOLVER. It does not reach it from here directly. A
 * unit's `invulnerabilityLevel` and `invulnerabilityExpiryTurn` live on the
 * `Snake`; `marshalBoard` calls `tierAtArrival(snake, turn)` — which is
 * `turn + 1 <= expiry ? level : 0` (`simulator.ts:19-22`) — and passes the
 * result as the resolver's frozen `tier` input. So writing the two fields here
 * IS how a potion changes adjudication, and it is why effects are applied after
 * resolution and before the next turn's marshalling.
 */

import type { Board, Coord, Snake } from '../src/types/battlesnake';
import type { MatchConfig } from './config';
import type { Rng } from './rng';

const KEY = (c: Coord): string => `${c.x},${c.y}`;

export interface ActiveEffect {
  readonly playerID: string;
  readonly type: 'invulnerability_buff' | 'invulnerability_debuff';
  readonly level: number;
  /**
   * The LAST turn this effect governs adjudication on. Collected on turn N with
   * `effectTurns: 3`, this is `N + 3` and the effect prices contests on turns
   * N+1, N+2 and N+3.
   *
   * WHY NOT THE WIRE'S `expiryTurn`. Upstream stores `currentTurnNumber + 3`
   * and drops effects with `expiryTurn <= currentTurnNumber` AFTER the
   * collision phase, so its stored number is also "the last turn governed".
   * But the BOT reads a different field with a different convention:
   * `tierAtArrival` (simulator.ts:19-22) applies the level only when
   * `currentTurn + 1 <= snake.invulnerabilityExpiryTurn`. Writing the same
   * number into both would shorten the window by one turn on the bot's side.
   * `applyLevels` therefore writes `lastTurn + 1` into the snake, so the tier
   * the resolver is handed is live on exactly the turns the server's would be.
   * One convention lives here; the seam is crossed in one place.
   */
  readonly lastTurn: number;
  readonly sourcePlayerID: string;
}

export interface WorldState {
  /** Effects still in force, oldest first. */
  effects: ActiveEffect[];
  /** Running per-unit invulnerability level, the sum of its live effects. */
  level: Record<string, number>;
}

export function emptyWorld(): WorldState {
  return { effects: [], level: {} };
}

export interface WorldStep {
  readonly foodSpawned: Coord[];
  readonly potionsSpawned: Coord[];
  readonly potionsCollected: Array<{ unitID: string; cell: Coord }>;
  readonly effectsExpired: number;
  /** Buffs cut short by the vulnerable-collision rule this turn. */
  readonly effectsCutShort: number;
}

/**
 * Cells nothing occupies — the server's `getFreePositions`, in api coords.
 * Occupied means: any unit's body cell, any food, any potion, any hazard.
 * (The server also excludes walls; api coords have no walls to exclude.)
 */
export function freeCells(board: Board, extra: ReadonlyArray<Coord> = []): Coord[] {
  const occupied = new Set<string>();
  for (const s of board.snakes ?? []) for (const c of s.body) occupied.add(KEY(c));
  for (const f of board.food ?? []) occupied.add(KEY(f));
  for (const p of board.invulnerabilityPotions ?? []) occupied.add(KEY(p));
  for (const h of board.hazards ?? []) occupied.add(KEY(h));
  for (const e of extra) occupied.add(KEY(e));

  const out: Coord[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (!occupied.has(KEY({ x, y }))) out.push({ x, y });
    }
  }
  return out;
}

/**
 * How many items spawn this turn at an expected rate. From
 * `TeamSnekProcessor.generateNewFood`: floor(rate) guaranteed, plus one more
 * with probability frac(rate).
 */
function drawCount(rate: number, rng: Rng): number {
  const guaranteed = Math.floor(rate);
  return guaranteed + (rng.next() < rate - guaranteed ? 1 : 0);
}

/**
 * The whole game-level step, applied to the board the resolver just settled.
 * Mutates `board` (which is already a fresh object from `resolveFullTurn`) and
 * `world`, and reports what it did so the replay can carry it.
 *
 * ORDER follows `TeamSnekProcessor.processTurn`: collection, then effect
 * expiry, then potion spawn, then food spawn — so a potion collected this turn
 * is gone before this turn's spawn looks for a free cell, and an effect that
 * expires this turn is off the books before the next turn adjudicates.
 */
export function stepWorld(
  board: Board,
  world: WorldState,
  config: MatchConfig,
  turn: number,
  rng: Rng,
  vulnerableCollided: ReadonlyArray<string> = [],
  /**
   * Unit id -> team, taken from the board BEFORE resolution. It has to be the
   * pre-resolution map: a vulnerable unit that DIED is the common case, and by
   * the time this runs it is no longer on the board to be looked up.
   */
  teamOf: ReadonlyMap<string, string> = new Map()
): WorldStep {
  const effectsCutShort = cutShortVulnerableBuffs(world, turn, vulnerableCollided, teamOf);
  const potionsCollected = config.potions.enabled ? collectPotions(board, world, config, turn) : [];
  const effectsExpired = expireEffects(board, world, turn);
  const potionsSpawned = config.potions.enabled ? spawnPotions(board, config, rng) : [];
  const foodSpawned = spawnFood(board, config, rng);
  applyLevels(board, world, turn);
  return { foodSpawned, potionsSpawned, potionsCollected, effectsExpired, effectsCutShort };
}

/**
 * `scheduleVulnerableCollisionBuffExpiry` (TeamSnekProcessor.ts:531-556).
 *
 * When a unit whose frozen tier was BELOW ZERO dies for any cause or survives a
 * sever, every teammate's `invulnerability_buff` is rescheduled to end this
 * turn. The rule is what stops a team from parking a debuffed sacrifice in
 * front of a contest and keeping the buff its pickup bought — the buff dies
 * with the unit that paid for it.
 *
 * The resolver hands the list over as `vulnerableCollided`, so no tier
 * bookkeeping is repeated here.
 */
export function cutShortVulnerableBuffs(
  world: WorldState,
  turn: number,
  vulnerableCollided: ReadonlyArray<string>,
  teamOf: ReadonlyMap<string, string>
): number {
  if (vulnerableCollided.length === 0) return 0;
  const hitTeams = new Set<string>();
  for (const id of vulnerableCollided) {
    const team = teamOf.get(id);
    if (team !== undefined) hitTeams.add(team);
  }
  if (hitTeams.size === 0) return 0;

  let cut = 0;
  world.effects = world.effects.map((e) => {
    if (e.type !== 'invulnerability_buff') return e;
    const team = teamOf.get(e.playerID);
    if (team === undefined || !hitTeams.has(team)) return e;
    if (e.lastTurn <= turn) return e;
    cut++;
    return { ...e, lastTurn: turn };
  });
  return cut;
}

/** `TeamSnekProcessor.generateNewFood`, seeded. */
export function spawnFood(board: Board, config: MatchConfig, rng: Rng): Coord[] {
  const total = drawCount(config.food.spawnRate, rng);
  const spawned: Coord[] = [];
  const fertileSet =
    config.fertile.enabled && config.food.restrictToFertile !== false
      ? new Set((board.fertileTiles ?? []).map(KEY))
      : null;

  for (let i = 0; i < total; i++) {
    let free = freeCells(board, spawned);
    if (fertileSet !== null && fertileSet.size > 0) free = free.filter((c) => fertileSet.has(KEY(c)));
    if (free.length === 0) continue;
    const pick = free[rng.int(free.length)] as Coord;
    spawned.push(pick);
    board.food = [...(board.food ?? []), { ...pick }];
  }
  return spawned;
}

/** `TeamSnekProcessor.generateNewInvulnerabilityPotions`, seeded. */
export function spawnPotions(board: Board, config: MatchConfig, rng: Rng): Coord[] {
  const total = drawCount(config.potions.spawnRate, rng);
  const spawned: Coord[] = [];
  for (let i = 0; i < total; i++) {
    const free = freeCells(board, spawned);
    if (free.length === 0) continue;
    const pick = free[rng.int(free.length)] as Coord;
    spawned.push(pick);
    board.invulnerabilityPotions = [...(board.invulnerabilityPotions ?? []), { ...pick }];
  }
  return spawned;
}

/**
 * `TeamSnekProcessor.processInvulnerabilityPotionCollection`.
 *
 * A unit whose HEAD ends the turn on a potion collects it. The rule is
 * deliberately counter-intuitive and is reproduced as written: the collector
 * takes a level -1 DEBUFF, and every living ALLY takes a level +1 buff, both
 * expiring `effectTurns` turns later. The potion is a team play, not a
 * personal power-up.
 */
export function collectPotions(
  board: Board,
  world: WorldState,
  config: MatchConfig,
  turn: number
): Array<{ unitID: string; cell: Coord }> {
  const potions = board.invulnerabilityPotions ?? [];
  if (potions.length === 0) return [];

  const potionAt = new Map(potions.map((p, i) => [KEY(p), i]));
  const taken = new Set<number>();
  const collected: Array<{ unitID: string; cell: Coord }> = [];

  for (const snake of board.snakes ?? []) {
    if (snake.health <= 0 || snake.body.length === 0) continue;
    const idx = potionAt.get(KEY(snake.head));
    if (idx === undefined || taken.has(idx)) continue;
    taken.add(idx);
    collected.push({ unitID: snake.id, cell: { ...snake.head } });

    // Collection runs AFTER resolution, so a potion taken on turn N first
    // bites on turn N+1 and governs through N + effectTurns.
    const lastTurn = turn + config.potions.effectTurns;
    world.effects.push({
      playerID: snake.id,
      type: 'invulnerability_debuff',
      level: -1,
      lastTurn,
      sourcePlayerID: snake.id,
    });
    const teamID = snake.teamID;
    for (const ally of board.snakes ?? []) {
      if (ally.id === snake.id) continue;
      if (ally.health <= 0 || ally.body.length === 0) continue;
      if (ally.teamID !== teamID) continue;
      world.effects.push({
        playerID: ally.id,
        type: 'invulnerability_buff',
        level: 1,
        lastTurn,
        sourcePlayerID: snake.id,
      });
    }
  }

  board.invulnerabilityPotions = potions.filter((_, i) => !taken.has(i));
  return collected;
}

/**
 * Drop effects that have run out and effects belonging to units that are gone
 * — both halves of the server's expiry step. Expiry runs AFTER the collision
 * phase, so an effect whose last governed turn is E is still on the books while
 * turn E is adjudicated and is dropped here, at the end of E.
 */
export function expireEffects(board: Board, world: WorldState, turn: number): number {
  const alive = new Set(
    (board.snakes ?? []).filter((s) => s.health > 0 && s.body.length > 0).map((s) => s.id)
  );
  const before = world.effects.length;
  world.effects = world.effects.filter((e) => e.lastTurn > turn && alive.has(e.playerID));
  return before - world.effects.length;
}

/**
 * Write the live effect sum onto every unit, as `invulnerabilityLevel` plus the
 * `invulnerabilityExpiryTurn` those levels run to. This is the ONLY channel by
 * which a potion reaches adjudication: `marshalBoard` reads the pair through
 * `tierAtArrival` and hands the resolver a frozen `tier`.
 *
 * TWO CONVENTIONS MEET HERE, and both are the bot's rather than this
 * harness's:
 *
 *  - the expiry written is the EARLIEST component expiry, not the latest.
 *    `translate.ts:259-269` computes it that way because the aggregate level
 *    only holds until its first component lapses; taking the max would keep a
 *    stale sum alive past the turn one of its parts died on.
 *  - the number written is `lastTurn + 1`, because `tierAtArrival` applies the
 *    level only while `currentTurn + 1 <= invulnerabilityExpiryTurn`
 *    (simulator.ts:19-22). Writing `lastTurn` itself would silently shorten
 *    every effect window by one turn.
 */
export function applyLevels(board: Board, world: WorldState, turn: number): void {
  const sum: Record<string, number> = {};
  const earliest: Record<string, number> = {};
  for (const e of world.effects) {
    sum[e.playerID] = (sum[e.playerID] ?? 0) + e.level;
    earliest[e.playerID] = Math.min(earliest[e.playerID] ?? Infinity, e.lastTurn);
  }
  world.level = sum;

  for (const snake of board.snakes ?? []) {
    const level = sum[snake.id];
    if (level === undefined || level === 0) {
      delete (snake as Partial<Snake>).invulnerabilityLevel;
      delete (snake as Partial<Snake>).invulnerabilityExpiryTurn;
      continue;
    }
    const last = earliest[snake.id];
    snake.invulnerabilityLevel = level;
    snake.invulnerabilityExpiryTurn = (last === undefined || last === Infinity ? turn : last) + 1;
  }
}
