/**
 * V3 SOAK SCENARIO — a scripted long game the LOBSTER path can be driven
 * through end to end, with a fake Firestore port capturing every wire write.
 *
 * Nothing here is under `src/`: this is verification scaffolding, added, never
 * a change to anything the build ships. It builds only on the public surfaces
 * the integrator's report documents (`TeamDecisionEngine`, `TeamBatchSubmitter`,
 * `StageThrottle`, `makeSubstrate`) and never reaches into a private.
 */

import type { Board, CentaurMove, Coord, GameState, Snake } from '../../src/types/battlesnake';
import { toApiCoord, apiCoordToIndex } from '../../src/firebase/translate';
import type { TeamStagedUnit, TeamBatchDoc, TeamSubmitterPort } from '../../src/wire/team-submitter';

// ------------------------------------------------------------------- rng

/** Deterministic, seedable, and cheap. Every soak run is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ board

export const KINDS = ['rook', 'knight', 'bishop', 'queen', 'pawn'] as const;

function makeUnit(
  id: string,
  at: Coord,
  unitType: string,
  weight: number,
  teamID: string
): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body: [at],
    head: at,
    length: weight,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    unitType,
    teamID,
  } as unknown as Snake;
}

export interface TeamBoardSpec {
  readonly size: number;
  readonly ours: number;
  readonly theirs: number;
  readonly seed?: number;
}

/**
 * Two facing armies of pieces. Our team is `red` on the low rows, theirs is
 * `blue` on the high ones; each team fields exactly one king so both play
 * under regicide (the production shape).
 */
export function makeTeamBoard(spec: TeamBoardSpec): Board {
  const { size, ours, theirs } = spec;
  const r = rng(spec.seed ?? 1);
  const snakes: Snake[] = [];
  const place = (n: number, team: string, prefix: string, baseY: number, dir: 1 | -1): void => {
    let placed = 0;
    for (let row = 0; placed < n; row++) {
      const y = baseY + dir * row;
      for (let x = 0; x < size && placed < n; x++) {
        const kind = placed === 0 ? 'king' : (KINDS[(placed + row) % KINDS.length] as string);
        const weight = kind === 'king' ? 1 : kind === 'queen' ? 3 : kind === 'pawn' ? 1 : 2;
        snakes.push(makeUnit(`${prefix}${placed}`, { x, y }, kind, weight, team));
        placed++;
      }
    }
  };
  place(ours, 'red', 'r', 0, 1);
  place(theirs, 'blue', 'b', size - 1, -1);
  // A little jitter in health so successive boards are not literally identical.
  for (const s of snakes) (s as { health: number }).health = 80 + Math.floor(r() * 21);
  return { width: size, height: size, food: [], hazards: [], snakes } as unknown as Board;
}

export function viewFor(board: Board, snakeId: string, turn: number): GameState {
  const you = board.snakes.find((s) => s.id === snakeId) as Snake;
  return {
    game: {
      id: 'soak',
      ruleset: { name: 't', version: 'v', settings: {} },
      map: 'm',
      timeout: 10_000,
      source: 't',
    },
    turn,
    board,
    you,
  } as unknown as GameState;
}

// --------------------------------------------------------------- evolution

/**
 * Apply one turn's staged destinations and give the enemy a deterministic
 * shuffle, keeping the board LEGAL: no two units ever share a cell (the
 * substrate refuses such a board with OverlappingUnitsError, and B2 measured
 * why). A unit whose destination is contested simply holds.
 */
export function advanceBoard(
  board: Board,
  staged: ReadonlyMap<string, CentaurMove>,
  turn: number,
  r: () => number
): Board {
  const fullWidth = board.width + 2;
  const fullHeight = board.height + 2;
  const occupied = new Set<string>();
  const at = (c: Coord): string => `${c.x},${c.y}`;
  const next = new Map<string, Coord>();

  for (const s of board.snakes) next.set(s.id, { ...(s.body[0] as Coord) });

  const inBounds = (c: Coord): boolean =>
    c.x >= 0 && c.y >= 0 && c.x < board.width && c.y < board.height;

  // Ours first, in board order: the staged destination when it is free.
  for (const s of board.snakes) {
    const move = staged.get(s.id);
    if (move === undefined || typeof move !== 'number') continue;
    const dest = toApiCoord(move, fullWidth, fullHeight);
    if (!inBounds(dest)) continue;
    next.set(s.id, dest);
  }
  // Enemies: one orthogonal step for a quarter of them each turn.
  for (const s of board.snakes) {
    if (staged.has(s.id)) continue;
    if (r() > 0.25) continue;
    const from = next.get(s.id) as Coord;
    const d = Math.floor(r() * 4);
    const cand = {
      x: from.x + (d === 0 ? 1 : d === 1 ? -1 : 0),
      y: from.y + (d === 2 ? 1 : d === 3 ? -1 : 0),
    };
    if (inBounds(cand)) next.set(s.id, cand);
  }

  // Conflict resolution: first writer wins, everyone else holds their origin.
  const resolved = new Map<string, Coord>();
  for (const s of board.snakes) {
    const want = next.get(s.id) as Coord;
    const home = s.body[0] as Coord;
    if (!occupied.has(at(want))) {
      occupied.add(at(want));
      resolved.set(s.id, want);
    } else if (!occupied.has(at(home))) {
      occupied.add(at(home));
      resolved.set(s.id, home);
    } else {
      // Both taken (only possible when someone already moved onto our home):
      // find any free neighbour, else stay and let the next pass fix it.
      let placedHere = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as ReadonlyArray<readonly [number, number]>) {
        const c = { x: home.x + dx, y: home.y + dy };
        if (inBounds(c) && !occupied.has(at(c))) {
          occupied.add(at(c));
          resolved.set(s.id, c);
          placedHere = true;
          break;
        }
      }
      if (!placedHere) {
        occupied.add(at(home));
        resolved.set(s.id, home);
      }
    }
  }

  const snakes = board.snakes.map((s) => {
    const cell = resolved.get(s.id) as Coord;
    const health = Math.max(1, ((s.health + turn) % 40) + 60);
    return { ...s, body: [cell], head: cell, health } as Snake;
  });
  return { ...board, snakes } as Board;
}

export const indexOf = (board: Board, c: Coord): number =>
  apiCoordToIndex(c, board.width + 2, board.height + 2);

// ------------------------------------------------------- fake firestore port

export interface CapturedWrite {
  readonly seq: number;
  readonly gameId: string;
  readonly turn: number;
  readonly at: number;
  readonly commitAt: number;
  readonly docs: ReadonlyArray<TeamBatchDoc>;
  readonly final: boolean;
}

export interface FakePortOptions {
  /** Simulated round trip for one chunk commit, in ms of fake or real time. */
  readonly commitLatencyMs?: number;
  readonly now?: () => number;
  /** Fail this chunk index once, to exercise the backstop. */
  readonly failChunkOnce?: number;
  /** Kill the submitter after this many chunk commits (torn-set probe). */
  readonly dieAfterChunks?: number;
  /** False simulates a write whose read-back never arrives (a lost ack). */
  readonly ackWrites?: boolean;
  /** Deliver the read-back ack as a MACROTASK after this delay — what a real
   * Firestore snapshot listener does. 0/undefined acks synchronously. */
  readonly ackDelayMs?: number;
}

export class SubmitterDied extends Error {
  constructor(readonly afterChunks: number) {
    super(`submitter died after ${afterChunks} chunk commits`);
    this.name = 'SubmitterDied';
  }
}

/**
 * The fake Firestore. It records every batch as the server would see it and
 * answers the read-back the way an append-only `privateMoves` collection plus
 * the server's per-player latest-wins reduce does.
 */
export class FakeFirestore implements TeamSubmitterPort {
  readonly writes: CapturedWrite[] = [];
  /** Per `gameId:turn:playerID`, the latest wire index the server holds. */
  readonly latest = new Map<string, number>();
  /** Read-back visibility: what the client's listener has actually seen. */
  private readonly acked = new Map<string, number>();
  readonly committed = new Set<string>();
  /** Set once the turn has resolved: writes after it are accepted-then-discarded. */
  endTimeMs = Number.POSITIVE_INFINITY;
  resolvedAtMs = Number.POSITIVE_INFINITY;
  wastedWrites = 0;
  wastedDocs = 0;
  chunkCommits = 0;
  private seq = 0;
  private failed = false;

  constructor(
    private readonly board: () => Board,
    private readonly opts: FakePortOptions = {}
  ) {}

  private clock(): number {
    return (this.opts.now ?? Date.now)();
  }

  now(): number {
    return this.clock();
  }

  encode(_gameId: string, _turn: number, unit: TeamStagedUnit): number | null {
    // Pieces stage the destination index verbatim; that is the whole encoding
    // for this scenario (every unit here is a piece).
    if (typeof unit.move !== 'number') return null;
    return unit.move;
  }

  async commitChunk(
    gameId: string,
    turn: number,
    docs: ReadonlyArray<TeamBatchDoc>
  ): Promise<void> {
    const at = this.clock();
    if (this.opts.dieAfterChunks !== undefined && this.chunkCommits >= this.opts.dieAfterChunks) {
      throw new SubmitterDied(this.chunkCommits);
    }
    if (this.opts.failChunkOnce !== undefined && !this.failed) {
      const idx = this.writes.filter((w) => w.turn === turn).length;
      if (idx === this.opts.failChunkOnce) {
        this.failed = true;
        throw new Error('simulated chunk failure');
      }
    }
    if (this.opts.commitLatencyMs) await sleep(this.opts.commitLatencyMs);
    const commitAt = this.clock();
    this.chunkCommits++;
    const wasted = commitAt > this.endTimeMs;
    if (wasted) {
      this.wastedWrites++;
      this.wastedDocs += docs.length;
    }
    this.writes.push({
      seq: this.seq++,
      gameId,
      turn,
      at,
      commitAt,
      docs: docs.map((d) => ({ ...d })),
      final: false,
    });
    for (const d of docs) {
      const key = `${gameId}:${turn}:${d.playerID}`;
      // Writes landing after the turn resolved are accepted then discarded.
      if (!wasted) this.latest.set(key, d.move);
      if (this.opts.ackWrites === false) continue;
      if (this.opts.ackDelayMs === undefined) this.acked.set(key, d.move);
      else globalThis.setTimeout(() => this.acked.set(key, d.move), this.opts.ackDelayMs);
    }
  }

  isCommitted(gameId: string, snakeId: string, turn: number): boolean {
    return this.committed.has(`${gameId}:${turn}:${snakeId}`);
  }

  confirmed(gameId: string, snakeId: string, turn: number): CentaurMove | null {
    const v = this.acked.get(`${gameId}:${turn}:${snakeId}`);
    return v === undefined ? null : v;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    // NOT unref'd: the confirm backstop and the deferred flush are behaviours
    // under test, and an unref'd timer would let the process exit past them.
    return globalThis.setTimeout(fn, ms);
  }

  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as NodeJS.Timeout);
  }

  /** The resolved set for a turn, exactly as the server's reduce would build it. */
  resolvedSet(gameId: string, turn: number): Map<string, number> {
    const out = new Map<string, number>();
    const prefix = `${gameId}:${turn}:`;
    for (const [key, move] of this.latest) {
      if (key.startsWith(prefix)) out.set(key.slice(prefix.length), move);
    }
    return out;
  }

  boardNow(): Board {
    return this.board();
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((res) => {
    globalThis.setTimeout(res, ms);
  });
