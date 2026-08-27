/**
 * THE REPLAY FORMAT — one gzipped JSONL file per game, kept forever.
 *
 * A replay is a stream of newline-delimited JSON objects, gzipped. Every object
 * carries a `kind`, and the file is exactly:
 *
 *     {"kind":"header", ...}          exactly one, first line
 *     {"kind":"turn",   ...}          one per turn PLAYED, in order
 *     {"kind":"result", ...}          exactly one, last line
 *
 * JSONL rather than one JSON blob so a miner can stream a large replay without
 * holding it in memory, and so a game that crashed mid-match still leaves a
 * readable prefix. Gzip because a 23x23 3-team board is ~12 KB of JSON a turn
 * and compresses about 12:1.
 *
 * WHAT A TURN ROW CARRIES (the contract stage-2 mining depends on):
 *   turn        absolute turn number, 1-based, the number the decision saw
 *   board       the FULL api Board at the START of the turn — width, height,
 *               food, hazards, fertileTiles, invulnerabilityPotions,
 *               hazardDamage, maxHealthPerUnit, and every unit with its body,
 *               head, health, length, unitType, teamID, orientation and
 *               invulnerability fields
 *   tiers       resolved invulnerability tier per unit AS THE RESOLVER SAW IT
 *               (`tierAtArrival`), because tier is a frozen input and cannot be
 *               recomputed from the board alone without knowing the convention
 *   staged      per unit: the move staged, which SEAT staged it, and which BOT
 *               that seat was — plus a `spoken` flag that is false for a unit
 *               its bot does not speak for (legacy's pieces)
 *   telemetry   per seat: the `DecisionTelemetry` for that seat this turn
 *   events      the resolver's own output in api coords — deaths (with cause),
 *               clashes (contest / edge / bodyBlock / sever / hazard /
 *               exhaustion / wall / self / regicide), severed cells,
 *               exhaustions, eliminated teams, rotations, promotions
 *   world       the game-level step: food and potions spawned, potions
 *               collected, effects expired
 *   standings   per team after resolution: units, material, health, hasKing
 *
 * NOTHING IS EVER DELETED. The writer refuses to overwrite an existing path.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as readline from 'readline';
import { createHash } from 'crypto';
import type { Board } from '../src/types/battlesnake';
import type { BotName, DecisionTelemetry } from './bots';
import type { MatchConfig } from './config';
import type { TeamEvents, TeamStandingRow } from './match-types';

export const REPLAY_FORMAT_VERSION = 1;

export interface ReplayHeader {
  readonly kind: 'header';
  readonly version: number;
  readonly sweepId: string;
  readonly gameId: string;
  readonly configHash: string;
  readonly boardHash: string;
  /** The whole normalized config — a replay is self-describing. */
  readonly config: MatchConfig;
  /** Seat index -> team id. Seat order is `config.teams` order. */
  readonly seats: ReadonlyArray<{ seat: number; teamID: string; bot: BotName }>;
  readonly startedAt: string;
  readonly node: string;
  readonly harness: string;
}

export interface ReplayStagedMove {
  readonly move: string | number;
  readonly seat: number;
  readonly bot: BotName;
  /** False when the unit's own bot does not speak for it (legacy's pieces). */
  readonly spoken: boolean;
}

export interface ReplayTurn {
  readonly kind: 'turn';
  readonly turn: number;
  readonly board: Board;
  readonly tiers: Record<string, number>;
  readonly staged: Record<string, ReplayStagedMove>;
  readonly telemetry: Record<string, DecisionTelemetry & { seat: number; bot: BotName }>;
  readonly events: TeamEvents;
  readonly world: {
    readonly foodSpawned: ReadonlyArray<{ x: number; y: number }>;
    readonly potionsSpawned: ReadonlyArray<{ x: number; y: number }>;
    readonly potionsCollected: ReadonlyArray<{ unitID: string; cell: { x: number; y: number } }>;
    readonly effectsExpired: number;
  };
  readonly standings: ReadonlyArray<TeamStandingRow>;
}

export interface ReplayResult {
  readonly kind: 'result';
  readonly turns: number;
  readonly reason: string;
  /** Placement 1..N per team; ties share a placement. */
  readonly placements: ReadonlyArray<{
    readonly teamID: string;
    readonly seat: number;
    readonly bot: BotName;
    readonly place: number;
    /** Turn the team was eliminated on; null when it survived to the cap. */
    readonly eliminatedOnTurn: number | null;
    readonly finalUnits: number;
    readonly finalMaterial: number;
    /** Normalized score in [0,1]: 1 for a clear first, 0 for a clear last. */
    readonly score: number;
  }>;
  /** Per team, material after every turn — index 0 is after turn 1. */
  readonly materialTrajectory: Record<string, number[]>;
  /** Per team, unit count after every turn. */
  readonly unitTrajectory: Record<string, number[]>;
  readonly wallMs: number;
  readonly finishedAt: string;
  /** Decisions that threw, by seat. Zero on a healthy game. */
  readonly errors: ReadonlyArray<{ seat: number; turn: number; error: string }>;
}

export type ReplayRow = ReplayHeader | ReplayTurn | ReplayResult;

// ------------------------------------------------------------------- writing

export class ReplayWriter {
  private readonly gzip: zlib.Gzip;
  private readonly out: fs.WriteStream;
  private readonly done: Promise<void>;
  private closed = false;

  constructor(readonly filePath: string) {
    if (fs.existsSync(filePath)) {
      throw new Error(`replay ${filePath} already exists — replays are never overwritten`);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Level 6 is the sweet spot here: level 9 costs ~3x the CPU for under 4%
    // more compression on this shape of JSON, and CPU is the sweep's budget.
    this.gzip = zlib.createGzip({ level: 6 });
    this.out = fs.createWriteStream(filePath);
    this.gzip.pipe(this.out);
    this.done = new Promise<void>((resolve, reject) => {
      this.out.on('finish', resolve);
      this.out.on('error', reject);
      this.gzip.on('error', reject);
    });
  }

  write(row: ReplayRow): void {
    if (this.closed) throw new Error('replay writer already closed');
    this.gzip.write(`${JSON.stringify(row)}\n`);
  }

  async close(): Promise<void> {
    if (this.closed) return this.done;
    this.closed = true;
    this.gzip.end();
    return this.done;
  }
}

// ------------------------------------------------------------------- reading

export interface LoadedReplay {
  readonly header: ReplayHeader;
  readonly turns: ReplayTurn[];
  readonly result: ReplayResult | null;
  readonly path: string;
}

/**
 * Read a whole replay into memory. Convenient for one game; for a sweep of
 * hundreds, prefer `iterateTurns`, which streams.
 *
 * A replay whose `result` row is missing loads fine with `result: null` — that
 * is a game that crashed, and being able to read its prefix is the point of
 * the line-oriented format.
 */
export async function loadReplay(filePath: string): Promise<LoadedReplay> {
  let header: ReplayHeader | null = null;
  const turns: ReplayTurn[] = [];
  let result: ReplayResult | null = null;

  for await (const row of iterateRows(filePath)) {
    if (row.kind === 'header') header = row;
    else if (row.kind === 'turn') turns.push(row);
    else result = row;
  }
  if (header === null) throw new Error(`replay ${filePath} has no header row`);
  return { header, turns, result, path: filePath };
}

/** Just the header — one gunzip of the first line, for a cheap index scan. */
export async function loadHeader(filePath: string): Promise<ReplayHeader> {
  for await (const row of iterateRows(filePath)) {
    if (row.kind === 'header') return row;
    break;
  }
  throw new Error(`replay ${filePath} has no header row`);
}

/** Stream every row in file order. */
export async function* iterateRows(filePath: string): AsyncGenerator<ReplayRow> {
  const stream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.length === 0) continue;
      yield JSON.parse(line) as ReplayRow;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

/** Stream the turn rows alone — the miners' main entry point. */
export async function* iterateTurns(filePath: string): AsyncGenerator<ReplayTurn> {
  for await (const row of iterateRows(filePath)) {
    if (row.kind === 'turn') yield row;
  }
}

/** A content digest of a replay file, for integrity checks in a manifest. */
export function replayDigest(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16);
}
