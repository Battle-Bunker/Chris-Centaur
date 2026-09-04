/**
 * Fixtures for the decision-lens boundary suite (05-BUILD-ORDER §b).
 *
 * TWO RULES GOVERN THIS FILE.
 *
 * 1. BOARDS ARE REAL. Every fixture board is built through `local-game.ts`'s
 *    own `UnitSpec` / `buildBoard` and settled through the real
 *    `EngineSubstrate`, so a test about the cluster law is a test about the
 *    grammar's actual `influenceOf` and not about a hand-drawn picture of it.
 *
 * 2. ROWS AND FRAMES ARE LITERALS. A `Moveset` or a `LensFrame` handed to the
 *    reservoir, the reducer or the cursor machine is an INPUT to the thing
 *    under test, so it is written out rather than produced by another
 *    unimplemented module. That keeps each boundary test's failure about its
 *    own subject.
 *
 * Nothing here asserts. It is a builder library, and it is deliberately outside
 * `__tests__/` so jest does not collect it as a suite.
 */

import type { Board, BoardSnapshot, Game } from '../types/battlesnake';
import { EngineSubstrate, makeSubstrate } from '../lobster/substrate';
import { buildBoard, type GameSpec } from './local-game';
import type {
  Actor,
  ClusterView,
  DepthColumn,
  DecisionInput,
  FrameProvenance,
  GameId,
  LensAt,
  LensCursor,
  LensFrame,
  Moveset,
  MovesetKey,
  Reading,
  TurnEvent,
  TurnEventKind,
  UnitKey,
} from '../lens/types';

export const FIXTURE_GAME: GameId = 'lens-fixture';
export const OURS = 'A';
export const THEIRS = 'B';

// ---------------------------------------------------------------- boards

/**
 * TWO ISLANDS. Four of our units on a 15×15 board, in two pairs at opposite
 * corners: within a pair the occupancy-reach sets meet, across the gap they
 * cannot. The plain connected component must give exactly two clusters, and a
 * slider fiat would give one — which is the falsifier T2 names.
 */
export const TWO_ISLANDS: GameSpec = {
  width: 15,
  height: 15,
  teams: [
    {
      id: OURS,
      units: [
        { kind: 'pawn', x: 1, y: 1 },
        { kind: 'pawn', x: 2, y: 1 },
        { kind: 'pawn', x: 13, y: 13 },
        { kind: 'pawn', x: 12, y: 13 },
      ],
    },
    { id: THEIRS, units: [{ kind: 'pawn', x: 7, y: 0 }] },
  ],
  food: [],
  nodeBudget: 550,
  seed: 1,
};

/**
 * A ROOK ACROSS THE GAP. The same two islands with a rook on the rank that
 * joins them: its ray IS an occupancy-reach set spanning both, so the geometry
 * already couples them and the component merges without any fiat.
 */
export const COUPLED_BY_RAY: GameSpec = {
  width: 15,
  height: 15,
  teams: [
    {
      id: OURS,
      units: [
        { kind: 'pawn', x: 1, y: 7 },
        { kind: 'rook', x: 7, y: 7 },
        { kind: 'pawn', x: 13, y: 7 },
      ],
    },
    { id: THEIRS, units: [{ kind: 'pawn', x: 7, y: 0 }] },
  ],
  food: [],
  nodeBudget: 550,
  seed: 1,
};

/** Three snakes far enough apart to be singletons — the 88.7% case (T3). */
export const SINGLETONS: GameSpec = {
  width: 19,
  height: 19,
  teams: [
    {
      id: OURS,
      units: [
        { kind: 'snake', x: 1, y: 3 },
        { kind: 'snake', x: 9, y: 12 },
        { kind: 'snake', x: 17, y: 3 },
      ],
    },
    { id: THEIRS, units: [{ kind: 'snake', x: 9, y: 17 }] },
  ],
  food: [],
  nodeBudget: 550,
  seed: 1,
};

/**
 * THE FOG CASE (Finding D-5′, 03 §7.7). A held enemy last seen at `x: 7` whose
 * cloud, once it is stale, spans both islands while its last-seen cell does
 * not. `staleness` is what makes the two readings differ, so the fixture is
 * the board plus an `observedTurns` entry that is older than the turn.
 */
export const FOG_SPAN: GameSpec = {
  width: 15,
  height: 15,
  teams: [
    {
      id: OURS,
      units: [
        { kind: 'pawn', x: 2, y: 7 },
        { kind: 'pawn', x: 12, y: 7 },
      ],
    },
    { id: THEIRS, units: [{ kind: 'queen', x: 7, y: 7 }] },
  ],
  food: [],
  nodeBudget: 550,
  seed: 1,
};

export const FOG_SUBJECT_STALENESS = 4;

export function boardOf(spec: GameSpec): Board {
  return buildBoard(spec);
}

const FIXTURE_META: Game = {
  id: FIXTURE_GAME,
  ruleset: { name: 'standard', version: 'v1', settings: {} },
  map: 'standard',
  timeout: 500,
  source: 'lens-fixture',
};

export function snapshotOf(spec: GameSpec, turn = 1): BoardSnapshot {
  return { game: FIXTURE_META, turn, board: boardOf(spec) };
}

/** A REAL substrate over a real board — the grammar the cluster law is a
 *  predicate on. Callers must `release()`. */
export function substrateOf(
  spec: GameSpec,
  opts: { turn?: number; teamId?: string; observedTurns?: ReadonlyMap<string, number> } = {}
): EngineSubstrate {
  const teamId = opts.teamId ?? OURS;
  const turn = opts.turn ?? 1;
  const board = boardOf(spec);
  const ours = (board.snakes ?? []).filter((s) => s.teamID === teamId).map((s) => s.id);
  return makeSubstrate({
    gameId: FIXTURE_GAME,
    board,
    turn,
    asTeam: teamId,
    modeled: ours,
    ...(opts.observedTurns === undefined ? {} : { observedTurns: opts.observedTurns }),
  });
}

/** The wire ids `buildBoard` assigns, in board order, for one team. */
export function unitKeysOf(spec: GameSpec, teamId = OURS): ReadonlyArray<UnitKey> {
  return (boardOf(spec).snakes ?? []).filter((s) => s.teamID === teamId).map((s) => s.id);
}

// ---------------------------------------------------------------- builders

export function reading(over: Partial<Reading> = {}): Reading {
  return {
    horizon: 1,
    lo: 0,
    est: 0,
    hi: 0,
    exact: false,
    ledgerSize: 0,
    basis: 'basis:[]',
    citedUnits: [],
    atMs: 0,
    quanta: 0,
    ...over,
  };
}

export function depthColumn(over: Partial<DepthColumn> = {}): DepthColumn {
  const h1 = over.h1 ?? reading();
  const deepest = over.deepest ?? h1;
  return {
    h1,
    deepest,
    derived: true,
    line: [],
    lineTruncated: false,
    rankAtH1: 1,
    confidence: 'equal',
    terminal: 'none',
    ply: null,
    delta: {
      lo: deepest.lo - h1.lo,
      hi: deepest.hi - h1.hi,
      width: deepest.hi - deepest.lo - (h1.hi - h1.lo),
      rank: 0,
      attribution: { width: 0, terminal: 0, residual: 0 },
      voided: false,
    },
    ...over,
  };
}

export interface MovesetSeed {
  readonly key?: MovesetKey;
  readonly cluster?: number;
  readonly rank?: number;
  readonly lo?: number;
  readonly est?: number;
  readonly hi?: number;
  readonly tie?: number;
  readonly complementKey?: string;
  readonly complement?: 'live' | 'stale';
  readonly staged?: boolean;
  readonly units?: ReadonlyArray<UnitKey>;
  readonly generation?: number;
}

export function moveset(seed: MovesetSeed = {}): Moveset {
  const lo = seed.lo ?? 0;
  const est = seed.est ?? lo;
  const hi = seed.hi ?? lo;
  const units = seed.units ?? ['A-A'];
  const h1 = reading({ lo, est, hi });
  return {
    cluster: seed.cluster ?? 0,
    clusterKey: `c${seed.cluster ?? 0}#${seed.generation ?? 0}`,
    generation: seed.generation ?? 0,
    key: seed.key ?? `m:${lo}/${est}/${hi}/${seed.tie ?? 0}`,
    rank: seed.rank ?? 1,
    moves: units.map((unit, i) => ({ unit, to: 10 + i, path: [10 + i] })),
    basis: 'basis:[]',
    complementKey: seed.complementKey ?? 'comp:live',
    complement: seed.complement ?? 'live',
    witness: 'plan:witness',
    lo,
    est,
    hi,
    channel: 'lo',
    exact: false,
    ledgerSize: 0,
    citedUnits: [],
    assumptions: [],
    vacuity: 'alive',
    seenIn: 1,
    rung: 'sweep',
    at: 0,
    tie: seed.tie ?? 0,
    staged: seed.staged ?? false,
    dominance: null,
    depth: depthColumn({ h1, deepest: h1 }),
  };
}

export function clusterView(over: Partial<ClusterView> = {}): ClusterView {
  const members = over.members ?? ['A-A'];
  return {
    id: over.id ?? 0,
    key: over.key ?? `k:${[...members].join('+')}`,
    generation: 0,
    members,
    boundedBy: [],
    lineage: [],
    epoch: 0,
    posture: 'SIGHTED',
    basis: 'basis:[]',
    ...over,
  };
}

export const BOT_ACTOR: Actor = { kind: 'bot', id: null, name: 'lobster', color: null };

export function operatorActor(id: string, color = '#7c4dff'): Actor {
  return { kind: 'operator', id, name: id, color };
}

export interface EventSeed {
  readonly kind: TurnEventKind;
  readonly seq: number;
  readonly payload: unknown;
  readonly actor?: Actor;
  readonly unit?: UnitKey | null;
  readonly atWall?: number;
  readonly atWorkMs?: number | null;
  readonly causedBy?: string | null;
  readonly answers?: string | null;
  readonly turn?: number;
}

export function turnEvent(seed: EventSeed): TurnEvent {
  const turn = seed.turn ?? 1;
  return {
    id: `${FIXTURE_GAME}:${turn}:${seed.seq}`,
    gameId: FIXTURE_GAME,
    turn,
    seq: seed.seq,
    atWall: seed.atWall ?? 1_700_000_000_000 + seed.seq,
    atWorkMs: seed.atWorkMs === undefined ? null : seed.atWorkMs,
    kind: seed.kind,
    actor: seed.actor ?? BOT_ACTOR,
    unit: seed.unit ?? null,
    causedBy: seed.causedBy ?? null,
    answers: seed.answers ?? null,
    payload: seed.payload,
  };
}

/** The turn's t0 anchor: the fold begins here and never crosses a boundary. */
export function anchorEvent(spec: GameSpec = SINGLETONS, turn = 1): TurnEvent {
  return turnEvent({
    kind: 'board.arrived',
    seq: 0,
    turn,
    actor: { kind: 'server', id: null, name: null, color: null },
    payload: {
      boardHash: 'hash:fixture',
      deadlineMs: 150,
      turnExpiryTime: 1_700_000_000_500,
      roster: unitKeysOf(spec),
      alive: unitKeysOf(spec),
    },
  });
}

export function decisionInput(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    boardHash: 'hash:fixture',
    asTeam: 0,
    seed: 1,
    assumptions: [{ kind: 'posture', posture: 'SIGHTED' }],
    initialPins: [],
    modelled: unitKeysOf(SINGLETONS),
    botId: 'bot:lens-fixture',
    behaviourId: 'behaviour:lens-fixture',
    nodeBudget: 550,
    liveBudgetMs: 150,
    kernelOptions: { speculativePeriod: 4, reserveMs: 1 },
    ...over,
  };
}

// ----------------------------------------------------------------- frames

export const FIXTURE_PROVENANCE: FrameProvenance = {
  botId: 'bot:lens-fixture',
  behaviourId: 'behaviour:lens-fixture',
  evalVersion: 'eval:1',
  guidanceId: null,
  emissionSeq: 3,
  quantaSpent: 12,
  premise: null,
  kind: 'observed',
};

export function lensAt(over: Partial<LensAt> = {}): LensAt {
  return {
    gameId: FIXTURE_GAME,
    turn: 1,
    seq: 3,
    tMono: 40,
    tWall: 1_700_000_000_040,
    mode: 'live-head',
    isHead: true,
    ...over,
  };
}

/**
 * A whole frame, written out. Frames are the INPUT to the cursor machine and
 * to the renderer, so a boundary test that builds one is not leaning on the
 * reducer it is not testing.
 */
export function lensFrame(over: Partial<LensFrame> = {}): LensFrame {
  const units = unitKeysOf(SINGLETONS);
  const cluster = clusterView({ id: 0, members: [units[0] as UnitKey] });
  const rows = [
    moveset({ rank: 1, lo: 12.4, est: 12.9, hi: 15.3, units: [units[0] as UnitKey], staged: true }),
    moveset({ rank: 2, lo: 11.7, est: 12.0, hi: 15.8, units: [units[0] as UnitKey], tie: 1 }),
  ];
  return {
    at: lensAt(),
    board: snapshotOf(SINGLETONS),
    units: units.map((unit, i) => ({
      unit,
      kind: 'snake',
      letter: String.fromCharCode(65 + i),
      weight: 1,
      health: 100,
      orientation: { dx: 0, dy: 1 },
      fixity: 'free' as const,
      owner: null,
      operator: null,
    })),
    partition: [cluster],
    candidates: {
      [units[0] as UnitKey]: [
        { key: 'c10', to: 10, path: [10], legal: true, conditionalBest: null, disposition: null },
        { key: 'c11', to: 11, path: [11], legal: true, conditionalBest: null, disposition: null },
      ],
    },
    movesets: { [`0|${units[0]}|10`]: rows },
    breakdown: {},
    staged: {},
    routes: {},
    waypoints: {},
    advice: [],
    events: [anchorEvent()],
    provenance: FIXTURE_PROVENANCE,
    ...over,
  };
}

export function cursor(over: Partial<LensCursor> = {}): LensCursor {
  return {
    unit: null,
    candidate: null,
    moveset: null,
    drill: null,
    foil: 'off',
    explicit: { candidate: false, moveset: false, drill: false },
    ...over,
  };
}
