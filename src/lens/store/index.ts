/**
 * THE DECISION LENS' STORE — the pure reducer, the one `seq` writer, the row
 * codecs, the `movesets` projection and the retention fold.
 *
 * THE REDUCER LIVES HERE, and it is the one module in the system that must be
 * a pure function of `(anchor, events≤seq)`: no wall clock, no randomness, no
 * `this`, no branch on which side of the seam handed the events over.
 * `lens-reducer.test.ts` asserts that STRUCTURALLY, against this file's own
 * source, because a behavioural assertion cannot distinguish "pure" from
 * "impure but not exercised yet" — and a reducer that reads the wall clock
 * folds correctly today, in front of the operator, and wrongly tomorrow, in
 * front of whoever is auditing the turn.
 *
 * Consequences you will notice while reading:
 *   - every function is a function; there are no classes and no methods;
 *   - `makeSeqWriter` holds its counter in a closure, not on an object;
 *   - anything that needs a clock takes the reading as an argument, so the
 *     caller's clock is visible in the caller and never hidden in here;
 *   - the two sources (`./sources`) and the database plumbing
 *     (`./persistence`) are separate files, because both of them legitimately
 *     do things this file must not.
 *
 * THE FRAME IS WHOLE, NEVER A DELTA. `partition` carries the entire
 * partition and `movesets` the entire reservoir. A delta folds correctly live,
 * where the consumer saw the predecessor, and wrongly in replay, where it did
 * not (03 §5.1).
 */

import type { BoardSnapshot, Snake } from '../../types/battlesnake';
import type {
  Actor,
  AdviceItem,
  AdvicePayload,
  BoardArrivedPayload,
  CandidateRow,
  CellIndex,
  ClusterId,
  ClusterView,
  ConditionalPayload,
  DecisionBeginPayload,
  DecisionInput,
  EmissionPayload,
  EventId,
  Fixity,
  FrameProvenance,
  FrameStore,
  GameId,
  KernelOptionsDigest,
  LensAt,
  LensEvent,
  LensFrame,
  Moveset,
  MovesetProjectionRow,
  MovesetsPayload,
  OperatorId,
  PartitionPayload,
  PinPayload,
  RetentionFold,
  RouteView,
  SelectionPayload,
  StagePayload,
  StagedMoveView,
  StageConfirmedPayload,
  StoredAssumption,
  StoredPin,
  Turn,
  TurnEvent,
  TurnEventKind,
  TurnEventRow,
  TurnResolvedPayload,
  UnitKey,
  UnitOutcomeRow,
  UnitRow,
  WaypointView,
} from '../types';

// ===========================================================================
// The fold
// ===========================================================================

/**
 * The fold's t0: a turn's `board.arrived` event and nothing before it. A
 * turn's fold never crosses a turn boundary, so there is nothing to seek past
 * and no game-length fold to avoid (04 §2.7) — which is exactly why
 * `command_turn_states` was not the checkpoint anybody needed.
 */
export function emptyStore(anchor: TurnEvent): FrameStore {
  return { turn: anchor.turn, anchor, events: [] };
}

/**
 * PURE. Never mutates its input store and never mutates the event.
 *
 * Two events are refused rather than appended: one belonging to another turn
 * (the fold does not cross a boundary) and one whose `seq` has already been
 * folded (live and replay may both deliver a `seq`, and folding it twice must
 * not double it). Both refusals return the store unchanged, which keeps
 * `applyEvent` idempotent per `seq` and therefore safe to drive from either
 * source with no de-duplication above it.
 */
export function applyEvent(store: FrameStore, event: TurnEvent): FrameStore {
  if (event.turn !== store.turn) return store;
  for (const held of store.events) {
    if (held.seq === event.seq) return store;
  }
  return { turn: store.turn, anchor: store.anchor, events: [...store.events, event] };
}

function bySeq(a: TurnEvent, b: TurnEvent): number {
  return a.seq - b.seq;
}

function upTo(store: FrameStore, seq: number): ReadonlyArray<TurnEvent> {
  return [store.anchor, ...store.events].filter((e) => e.seq <= seq).sort(bySeq);
}

function payloadOf<T>(event: TurnEvent): T {
  return event.payload as T;
}

/** The board the turn opened on. The anchor announces it; `turn_boards` stores
 *  it under its own key so the replay source can rebuild the same anchor. A
 *  turn whose board never reached the log still folds — to an empty board,
 *  which is honest emptiness rather than a throw. */
function boardOf(anchor: TurnEvent): BoardSnapshot {
  const carried = (anchor as unknown as { payload?: { settlement?: BoardSnapshot } }).payload;
  const settlement = carried?.settlement;
  if (settlement && settlement.board) return settlement;
  return {
    game: { id: anchor.gameId, ruleset: { name: '', version: '', settings: {} }, map: '', timeout: 0, source: '' },
    turn: anchor.turn,
    board: { width: 0, height: 0, food: [], hazards: [], snakes: [] },
  };
}

interface UnitFixity {
  readonly fixity: Fixity;
  readonly owner: OperatorId | null;
  readonly operator: string | null;
}

function unitRowsOf(
  board: BoardSnapshot,
  roster: ReadonlyArray<UnitKey>,
  fixities: ReadonlyMap<UnitKey, UnitFixity>,
  dead: ReadonlySet<UnitKey>
): ReadonlyArray<UnitRow> {
  const snakes: ReadonlyArray<Snake> = board.board.snakes ?? [];
  const keys = snakes.length > 0 ? snakes.map((s) => s.id) : [...roster];
  return keys.map((unit) => {
    const snake = snakes.find((s) => s.id === unit);
    const fixed = fixities.get(unit);
    return {
      unit,
      kind: snake?.unitType ?? 'snake',
      letter: snake?.letter ?? '',
      weight: snake?.length ?? 0,
      health: snake?.health ?? 0,
      orientation: snake?.orientation ?? { dx: 0, dy: 0 },
      fixity: dead.has(unit) ? 'dead' : (fixed?.fixity ?? 'free'),
      owner: fixed?.owner ?? null,
      operator: fixed?.operator ?? null,
    };
  });
}

/** The reservoir for a cluster, and the conditional lists hung off a lock.
 *  One keyspace, two shapes of key, so a consumer that has a cluster and a
 *  consumer that has a lock both index the same record (`LensFrame.movesets`). */
function reservoirKey(cluster: ClusterId): string {
  return String(cluster);
}

function conditionalKey(cluster: ClusterId, unit: UnitKey, to: CellIndex): string {
  return `${cluster}|${unit}|${to}`;
}

/**
 * The candidates a frame can honestly draw: the destinations THIS DECISION
 * priced, as they appear in the rows it retained. Nothing else in the event
 * stream enumerates a unit's options, and inventing an enumeration here would
 * be a computation nobody performed (04 §2.5). `conditionalBest` is filled
 * only where a conditional ranking answered for that destination — every
 * other candidate renders as `·`, never as a bare number (04 §3 D-c).
 */
function candidatesOf(
  priced: ReadonlyMap<UnitKey, Map<CellIndex, CandidateRow>>
): Readonly<Record<UnitKey, ReadonlyArray<CandidateRow>>> {
  const out: Record<UnitKey, ReadonlyArray<CandidateRow>> = {};
  for (const [unit, rows] of priced) {
    out[unit] = [...rows.values()].sort((a, b) => a.to - b.to);
  }
  return out;
}

function noteCandidates(
  priced: Map<UnitKey, Map<CellIndex, CandidateRow>>,
  rows: ReadonlyArray<Moveset>,
  best: boolean
): void {
  for (const row of rows) {
    for (const move of row.moves) {
      let perUnit = priced.get(move.unit);
      if (!perUnit) {
        perUnit = new Map<CellIndex, CandidateRow>();
        priced.set(move.unit, perUnit);
      }
      const existing = perUnit.get(move.to);
      const aggregate = best && row.rank === 1
        ? { aggregate: row.lo, grade: (row.exact ? 'exact' : 'provisional') as 'exact' | 'provisional' }
        : (existing?.conditionalBest ?? null);
      perUnit.set(move.to, {
        key: `${move.unit}:${move.to}`,
        to: move.to,
        path: move.path,
        legal: true,
        conditionalBest: aggregate,
        disposition: existing?.disposition ?? null,
      });
    }
  }
}

/**
 * PURE. A function of `(anchor, events ≤ seq)` and of nothing else.
 *
 * `at.mode` and `at.isHead` are the two fields the fold cannot know — whether
 * the caller is at the head of a live turn is a property of the caller, not of
 * the events. They default to the CLOSED reading (`replay`, not head), so a
 * determination is illegal until a source asserts otherwise; the sources stamp
 * them, and no renderer branches on either (Law C).
 */
export function frameAt(store: FrameStore, seq: number): LensFrame {
  const events = upTo(store, seq);
  const anchor = store.anchor;
  const board = boardOf(anchor);
  const arrival = payloadOf<BoardArrivedPayload>(anchor);

  let partition: ReadonlyArray<ClusterView> = [];
  const movesets: Record<string, ReadonlyArray<Moveset>> = {};
  const priced = new Map<UnitKey, Map<CellIndex, CandidateRow>>();
  const staged: Record<UnitKey, StagedMoveView> = {};
  const routes: Record<UnitKey, RouteView> = {};
  const waypoints: Record<UnitKey, WaypointView> = {};
  const advice: AdviceItem[] = [];
  const fixities = new Map<UnitKey, UnitFixity>();
  const dead = new Set<UnitKey>();

  let input: DecisionInput | null = null;
  let emissionSeq = anchor.seq;
  let quantaSpent = 0;
  let last: TurnEvent = anchor;

  for (const event of events) {
    last = event;
    switch (event.kind) {
      case 'partition': {
        partition = payloadOf<PartitionPayload>(event).clusters;
        break;
      }
      case 'movesets': {
        const p = payloadOf<MovesetsPayload>(event);
        movesets[reservoirKey(p.cluster)] = p.rows;
        noteCandidates(priced, p.rows, true);
        break;
      }
      case 'conditional': {
        const p = payloadOf<ConditionalPayload>(event);
        for (const lock of p.locks) {
          movesets[conditionalKey(p.cluster, lock.unit, lock.to)] = p.rows;
        }
        noteCandidates(priced, p.rows, true);
        break;
      }
      case 'emission': {
        emissionSeq = event.seq;
        quantaSpent += 1;
        break;
      }
      case 'decision.begin': {
        input = payloadOf<DecisionBeginPayload>(event).input ?? null;
        break;
      }
      case 'pin': {
        const p = payloadOf<PinPayload>(event);
        fixities.set(p.unit, {
          fixity: p.tentative ? 'free' : 'pinned',
          owner: event.actor.id,
          operator: event.actor.name,
        });
        break;
      }
      case 'unpin': {
        fixities.delete(payloadOf<PinPayload>(event).unit);
        break;
      }
      case 'commit': {
        const p = payloadOf<PinPayload>(event);
        fixities.set(p.unit, {
          fixity: 'committed',
          owner: event.actor.id,
          operator: event.actor.name,
        });
        break;
      }
      case 'commit.observed': {
        const unit = event.unit;
        if (unit !== null) {
          const held = fixities.get(unit);
          fixities.set(unit, {
            fixity: 'committed',
            owner: held?.owner ?? event.actor.id,
            operator: held?.operator ?? event.actor.name,
          });
          staged[unit] = { ...(staged[unit] ?? {}), committed: true };
        }
        break;
      }
      case 'stage.fastpass':
      case 'stage.requested': {
        const p = payloadOf<StagePayload>(event);
        staged[p.unit] = { ...(staged[p.unit] ?? {}), unit: p.unit, to: p.to, source: p.source };
        break;
      }
      case 'stage.confirmed': {
        const p = payloadOf<StageConfirmedPayload>(event);
        staged[p.unit] = { ...(staged[p.unit] ?? {}), unit: p.unit, confirmed: p.to, serverTs: p.serverTs };
        break;
      }
      case 'stage.retry': {
        const p = payloadOf<StagePayload & { why: string }>(event);
        staged[p.unit] = { ...(staged[p.unit] ?? {}), unit: p.unit, retryWhy: p.why };
        break;
      }
      case 'operator.command': {
        applyCommand(event, routes, waypoints);
        break;
      }
      case 'advice': {
        const p = payloadOf<AdvicePayload>(event);
        advice.push({ ...p, by: event.actor.id });
        break;
      }
      case 'turn.resolved': {
        const p = payloadOf<TurnResolvedPayload>(event);
        for (const death of p.deaths) dead.add(death);
        for (const move of p.moves) {
          staged[move.unit] = { ...(staged[move.unit] ?? {}), unit: move.unit, resolved: move.to };
        }
        break;
      }
      default:
        break;
    }
  }

  const at: LensAt = {
    gameId: anchor.gameId,
    turn: store.turn,
    seq,
    tMono: last.atWall - anchor.atWall,
    tWall: last.atWall,
    mode: 'replay',
    isHead: false,
  };

  return {
    at,
    board,
    units: unitRowsOf(board, arrival?.roster ?? [], fixities, dead),
    partition,
    candidates: candidatesOf(priced),
    movesets,
    breakdown: {},
    staged,
    routes,
    waypoints,
    advice,
    events,
    provenance: provenanceOf(input, emissionSeq, quantaSpent),
  };
}

/**
 * The operator's standing inputs, folded from the command log rather than
 * snapshotted beside it. These are the shapes `active-game-manager` already
 * broadcasts — the lens carries them and does not re-declare their interiors
 * (02 §2.3): rewriting a working dual-source contract to prove a point would
 * be exactly the junk the exercise is supposed to throw away.
 */
function applyCommand(
  event: TurnEvent,
  routes: Record<UnitKey, RouteView>,
  waypoints: Record<UnitKey, WaypointView>
): void {
  const p = payloadOf<{ verb: string; target: UnitKey | null; detail: Record<string, unknown> }>(event);
  const unit = p.target ?? event.unit;
  if (unit === null) return;
  switch (p.verb) {
    case 'goto-set':
    case 'goto-append':
    case 'goto-remove':
    case 'goto-target-reached':
      routes[unit] = { kind: 'goto', ...p.detail, by: event.actor.id };
      break;
    case 'near-set':
      waypoints[unit] = { kind: 'near', ...p.detail, by: event.actor.id };
      break;
    case 'waypoint-clear':
      delete waypoints[unit];
      break;
    case 'input-clear':
    case 'command-cleared-on-death':
      delete routes[unit];
      delete waypoints[unit];
      break;
    default:
      break;
  }
}

function digestString(digest: KernelOptionsDigest | undefined, key: string): string | null {
  const value = digest?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * MANDATORY on every frame: a number without its `evalVersion` / `guidanceId`
 * is a cross-fiber comparison waiting to happen. `kind` is always `observed`
 * here — the fold reports what was recorded; a re-derivation badges itself
 * `rerun` where it is produced, which is content and never a refusal (04 §2.6).
 */
function provenanceOf(
  input: DecisionInput | null,
  emissionSeq: number,
  quantaSpent: number
): FrameProvenance {
  return {
    botId: input?.botId ?? '',
    behaviourId: input?.behaviourId ?? '',
    evalVersion: digestString(input?.kernelOptions, 'evalVersion') ?? '',
    guidanceId: digestString(input?.kernelOptions, 'guidanceId'),
    emissionSeq,
    quantaSpent,
    premise: null,
    kind: 'observed',
  };
}

// ===========================================================================
// The log — one writer per (gameId, turn)
// ===========================================================================

/**
 * ONE writer per `(gameId, turn)` assigns `seq`: gapless, monotone, and the
 * only sort key the UI ever uses (04 §3 O6). The active game manager owns it,
 * because the writer is a storage concern even though the UI reads what it
 * broadcasts, and because the manager is the one component every producer —
 * the kernel's sink, the operator's commands, Firebase's confirmations and the
 * turn resolution — already passes through.
 */
export interface SeqWriter {
  readonly gameId: GameId;
  readonly turn: Turn;
  /** Stamps `seq` and `id`, and returns the event as it will be stored. */
  write(draft: Omit<TurnEvent, 'id' | 'seq'>): TurnEvent;
  readonly written: ReadonlyArray<TurnEvent>;
}

export function makeSeqWriter(gameId: GameId, turn: Turn): SeqWriter {
  const written: TurnEvent[] = [];
  const ids = new Set<EventId>();

  function write(draft: Omit<TurnEvent, 'id' | 'seq'>): TurnEvent {
    if (draft.gameId !== gameId || draft.turn !== turn) {
      throw new Error(
        `[lens] writer for ${gameId}:${turn} refused an event for ${draft.gameId}:${draft.turn} — ` +
          'one writer per (gameId, turn), and a writer that accepted a foreign turn would break the only sort key there is'
      );
    }
    if (draft.answers !== null && !ids.has(draft.answers)) {
      throw new Error(
        `[lens] event answers ${draft.answers}, which has not been written — ` +
          'an answer cannot precede its question in a total order'
      );
    }
    if (draft.causedBy !== null && draft.causedBy.startsWith(`${gameId}:${turn}:`) && !ids.has(draft.causedBy)) {
      throw new Error(
        `[lens] event is causedBy ${draft.causedBy}, which the turn's writer has not written`
      );
    }
    const seq = written.length;
    const event: TurnEvent = { ...draft, id: `${gameId}:${turn}:${seq}`, seq };
    written.push(event);
    ids.add(event.id);
    return event;
  }

  return {
    gameId,
    turn,
    write,
    get written(): ReadonlyArray<TurnEvent> {
      return written;
    },
  };
}

/** What `ingestLensEvents` cannot derive from a `LensEvent` alone. */
export interface IngestContext {
  /**
   * The wall reading `atWorkMs = 0` corresponds to — the decision's t0 on the
   * wall clock. Defaults to the writer's first written event, so a turn whose
   * `board.arrived` is already in the log needs no argument. NO CLOCK IS READ
   * HERE: the caller's reading is passed in, so it is visible in the caller.
   */
  readonly t0AtWall?: number;
  /**
   * The one translation the sink still owes: `EmitRecord.plan` is keyed by
   * SUBSTRATE unit number, and a stored record carrying a substrate number is
   * a stored record that cannot be read one turn later (04 §2.2). Absent ⇒ the
   * emission's `moves` are left empty and the staged assignment is read off
   * the `movesets` frame beside it, which already carries `UnitKey`s.
   */
  readonly unitKeyOf?: (unitId: number) => UnitKey | null;
  /** Who to attribute a kernel frame to. Defaults to the bot. */
  readonly botActor?: Actor;
}

const BOT: Actor = { kind: 'bot', id: null, name: 'lobster', color: null };

/**
 * The kernel's `LensEvent`s, stamped with `seq` by the one writer and
 * translated into the stored vocabulary.
 *
 * Emission order within one epoch change is FIXED by the sink —
 * `operator` → `partition` → `emission` → `movesets` — so a consumer folding
 * them in order is never in a state where a moveset names a cluster that does
 * not exist yet. Nothing here reorders them.
 */
export function ingestLensEvents(
  writer: SeqWriter,
  events: ReadonlyArray<LensEvent>,
  context: IngestContext = {}
): ReadonlyArray<TurnEvent> {
  const base = context.t0AtWall ?? writer.written[0]?.atWall ?? 0;
  const actor = context.botActor ?? BOT;
  const out: TurnEvent[] = [];
  let lastEmissionSeq = -1;

  for (const event of events) {
    const common = {
      gameId: writer.gameId,
      turn: writer.turn,
      atWall: base + event.at,
      atWorkMs: event.at,
      actor,
      unit: null as UnitKey | null,
      causedBy: null as EventId | null,
      answers: null as EventId | null,
    };

    let kind: TurnEventKind = event.kind;
    let payload: unknown;
    let unit: UnitKey | null = null;
    let answers: EventId | null = null;

    switch (event.kind) {
      case 'partition': {
        const generation = event.clusters.reduce((g, c) => Math.max(g, c.generation), 0);
        const p: PartitionPayload = {
          generation,
          epoch: event.epoch,
          posture: event.posture,
          clusters: event.clusters,
          changes: event.changes,
        };
        payload = p;
        break;
      }
      case 'movesets': {
        const p: MovesetsPayload = {
          cluster: event.clusterId,
          generation: event.rows[0]?.generation ?? 0,
          emissionSeq: lastEmissionSeq,
          complementKey: event.complementKey,
          rows: event.rows,
        };
        payload = p;
        break;
      }
      case 'emission': {
        const record = event.record;
        const moves = context.unitKeyOf
          ? [...record.plan.entries()].flatMap(([unitId, candidate]) => {
              const key = context.unitKeyOf ? context.unitKeyOf(unitId) : null;
              return key === null ? [] : [{ unit: key, to: candidate.to, path: candidate.path }];
            })
          : [];
        const p: EmissionPayload = {
          planKey: `plan:${record.epoch}:${record.horizon}`,
          lo: record.lo,
          est: record.est,
          hi: record.hi,
          slack: record.slack,
          horizon: record.horizon,
          epoch: record.epoch,
          posture: record.posture,
          assumptions: record.assumptions,
          moves,
        };
        payload = p;
        break;
      }
      case 'operator': {
        const verb = event.event.kind;
        const key = verb === 'pin'
          ? (context.unitKeyOf ? context.unitKeyOf(event.event.pin.unitId) : null)
          : (context.unitKeyOf ? context.unitKeyOf(event.event.unitId) : null);
        unit = key;
        answers = event.answers;
        payload = {
          verb,
          arrivedAtWorkMs: event.arrivedAt,
          epoch: event.epoch,
          latencyMs: event.latencyMs,
          slicesBefore: event.slicesBefore,
        };
        break;
      }
      case 'posture': {
        payload = { from: event.from, to: event.to, channel: event.channel };
        break;
      }
      case 'conditional': {
        const r = event.ranking;
        const p: ConditionalPayload = {
          requestId: `${r.cluster}:${r.contextKey}`,
          cluster: r.cluster,
          generation: r.clusterAfter.generation,
          locks: r.locks,
          rows: r.rows,
          source: r.source,
          cursor: r.cursor,
          final: r.final,
        };
        payload = p;
        break;
      }
      case 'refusal': {
        payload = { refusal: event.refusal, planKey: event.planKey };
        break;
      }
      default:
        payload = {};
        break;
    }

    const written = writer.write({ ...common, kind, unit, answers, payload });
    if (kind === 'emission') lastEmissionSeq = written.seq;
    out.push(written);
  }

  return out;
}

// ===========================================================================
// Row codecs
// ===========================================================================

/**
 * `payload` holds the `TurnEvent` VERBATIM, so live and replay fold identical
 * bytes; the columns beside it exist because they are INDEXED, not because
 * they are different data. Anything read out of a column could be read out of
 * the payload, and nothing may be read out of a column that is not.
 */
export function encodeEventRow(event: TurnEvent): TurnEventRow {
  return {
    gameId: event.gameId,
    turn: event.turn,
    seq: event.seq,
    kind: event.kind,
    atWall: event.atWall,
    atWorkMs: event.atWorkMs,
    actorKind: event.actor.kind,
    actorId: event.actor.id,
    actorName: event.actor.name,
    actorColor: event.actor.color,
    unitKey: event.unit,
    causedBy: event.causedBy,
    answers: event.answers,
    payload: event,
  };
}

export function decodeEventRow(row: TurnEventRow): TurnEvent {
  return row.payload;
}

/**
 * The audit seed and the lazy-derivation seed (01 §8.2). Rebuilt field by
 * field rather than passed through: a seed that survives storage only because
 * nothing looked at it is not a seed, and an explicit encode is what makes a
 * missing field a compile error instead of a silent null one release later.
 */
export function encodeDecisionInput(input: DecisionInput): unknown {
  return {
    boardHash: input.boardHash,
    asTeam: input.asTeam,
    seed: input.seed,
    assumptions: input.assumptions.map((a) => ({ ...a })),
    initialPins: input.initialPins.map((p) => ({ unit: p.unit, to: p.to })),
    modelled: [...input.modelled],
    botId: input.botId,
    behaviourId: input.behaviourId,
    nodeBudget: input.nodeBudget,
    liveBudgetMs: input.liveBudgetMs,
    kernelOptions: { ...input.kernelOptions },
  };
}

export function decodeDecisionInput(raw: unknown): DecisionInput {
  const r = (raw ?? {}) as Partial<DecisionInput>;
  return {
    boardHash: r.boardHash ?? '',
    asTeam: r.asTeam ?? 0,
    seed: r.seed ?? 0,
    assumptions: (r.assumptions ?? []).map((a) => ({ ...a })) as ReadonlyArray<StoredAssumption>,
    initialPins: (r.initialPins ?? []).map((p) => ({ unit: p.unit, to: p.to })) as ReadonlyArray<StoredPin>,
    modelled: [...(r.modelled ?? [])],
    botId: r.botId ?? '',
    behaviourId: r.behaviourId ?? '',
    nodeBudget: r.nodeBudget ?? 0,
    liveBudgetMs: r.liveBudgetMs ?? 0,
    kernelOptions: { ...(r.kernelOptions ?? {}) },
  };
}

// ===========================================================================
// The projection
// ===========================================================================

/**
 * The `movesets` table AS A FOLD of the `movesets` frames. Its whole licence
 * to exist is that this equals `rebuildMovesets` (04 §2.7): a materialised
 * table drifting from its source is the exact defect that killed
 * `command_turn_states`, and the difference between the two tables is that a
 * rebuild command exists for this one.
 */
export function projectMovesets(
  decisionId: string,
  events: ReadonlyArray<TurnEvent>
): ReadonlyArray<MovesetProjectionRow> {
  const out: MovesetProjectionRow[] = [];
  for (const event of [...events].sort(bySeq)) {
    if (event.kind !== 'movesets') continue;
    const p = payloadOf<MovesetsPayload>(event);
    for (const row of p.rows) {
      out.push(projectionRowOf(decisionId, p, row));
    }
  }
  return out;
}

function projectionRowOf(
  decisionId: string,
  frame: MovesetsPayload,
  row: Moveset
): MovesetProjectionRow {
  return {
    decisionId,
    emissionSeq: frame.emissionSeq,
    clusterId: frame.cluster,
    clusterKey: row.clusterKey,
    clusterGen: row.generation,
    rank: row.rank,
    movesetKey: row.key,
    moves: row.moves,
    witnessPlanKey: row.witness,
    seenIn: row.seenIn,
    lo: row.lo,
    est: row.est,
    hi: row.hi,
    channel: row.channel,
    exact: row.exact,
    ledgerSize: row.ledgerSize,
    vacuity: row.vacuity,
    complementKey: row.complementKey,
    complementStale: row.complement !== 'live',
    cited: row.citedUnits,
    basisKey: row.basis,
    staged: row.staged,
    dominanceKind: row.dominance === null ? null : row.dominance.kind,
    dominance: row.dominance,
    h1Lo: row.depth.h1.lo,
    h1Hi: row.depth.h1.hi,
    deepHorizon: row.depth.deepest.horizon,
    deepLo: row.depth.deepest.lo,
    deepHi: row.depth.deepest.hi,
    derived: row.depth.derived,
    line: row.staged ? row.depth.line : null,
  };
}

/**
 * The rebuild command's engine: regenerate the table from `turn_events` after
 * a `DELETE`. Byte-identical to `projectMovesets`, or the table goes the way
 * of `command_turn_states`. It is the same fold over the same bytes precisely
 * so that there is no second implementation to drift.
 */
export function rebuildMovesets(
  decisionId: string,
  rows: ReadonlyArray<TurnEventRow>
): ReadonlyArray<MovesetProjectionRow> {
  return projectMovesets(decisionId, rows.map(decodeEventRow));
}

// ===========================================================================
// Per-unit outcomes
// ===========================================================================

/** Operator events that DETERMINE a unit's move. `selection` is deliberately
 *  absent: attention funds compute, but looking at a unit is not commanding it,
 *  and an outcome row that credited a hover would misattribute the turn. */
const DETERMINING: ReadonlySet<TurnEventKind> = new Set<TurnEventKind>([
  'pin',
  'unpin',
  'commit',
  'operator.command',
]);

/**
 * `unit_outcomes` — the request → confirm → commit → resolve lifecycle, per
 * unit per turn, reconstructed from the event log. Replaces `decision_logs`'
 * back-filled move columns without the blob: what a result IS, stored once.
 */
export function reconstructUnitOutcomes(
  gameId: GameId,
  turn: Turn,
  events: ReadonlyArray<TurnEvent>
): ReadonlyArray<UnitOutcomeRow> {
  const rows = new Map<UnitKey, {
    unitName: string | null;
    clusterId: ClusterId | null;
    stagedMove: CellIndex | null;
    stagedSource: string | null;
    confirmedMove: CellIndex | null;
    committed: boolean;
    resolvedMove: CellIndex | null;
    fatalConsent: boolean | null;
    operatorId: OperatorId | null;
  }>();

  function seat(unit: UnitKey) {
    let row = rows.get(unit);
    if (!row) {
      row = {
        unitName: null,
        clusterId: null,
        stagedMove: null,
        stagedSource: null,
        confirmedMove: null,
        committed: false,
        resolvedMove: null,
        fatalConsent: null,
        operatorId: null,
      };
      rows.set(unit, row);
    }
    return row;
  }

  for (const event of [...events].sort(bySeq)) {
    if (event.kind === 'partition') {
      for (const cluster of payloadOf<PartitionPayload>(event).clusters) {
        for (const member of cluster.members) seat(member).clusterId = cluster.id;
        for (const bound of cluster.boundedBy) seat(bound.unit).clusterId = cluster.id;
      }
      continue;
    }
    if (event.kind === 'stage.fastpass' || event.kind === 'stage.requested') {
      const p = payloadOf<StagePayload>(event);
      const row = seat(p.unit);
      row.stagedMove = p.to;
      row.stagedSource = p.source;
      continue;
    }
    if (event.kind === 'stage.confirmed') {
      const p = payloadOf<StageConfirmedPayload>(event);
      seat(p.unit).confirmedMove = p.to;
      continue;
    }
    if (event.kind === 'commit.observed' || event.kind === 'commit') {
      const unit = event.unit ?? (event.payload as { unit?: UnitKey }).unit ?? null;
      if (unit !== null) seat(unit).committed = true;
    }
    if (event.kind === 'turn.resolved') {
      for (const move of payloadOf<TurnResolvedPayload>(event).moves) {
        seat(move.unit).resolvedMove = move.to;
      }
      continue;
    }
    if (event.kind === 'operator.command') {
      const p = payloadOf<{ verb: string; detail: Record<string, unknown> }>(event);
      const unit = event.unit;
      if (unit !== null && p.verb === 'fatal-move-confirmed') {
        seat(unit).fatalConsent = true;
      }
    }
    if (DETERMINING.has(event.kind) && event.actor.kind === 'operator' && event.unit !== null) {
      seat(event.unit).operatorId = event.actor.id;
    }
  }

  return [...rows.entries()].map(([unitKey, row]) => ({
    gameId,
    turn,
    unitKey,
    unitName: row.unitName,
    clusterId: row.clusterId,
    stagedMove: row.stagedMove,
    stagedSource: row.stagedSource,
    confirmedMove: row.confirmedMove,
    committed: row.committed,
    resolvedMove: row.resolvedMove,
    fatalConsent: row.fatalConsent,
    operatorId: row.operatorId,
  }));
}

// ===========================================================================
// Retention
// ===========================================================================

/** Kinds a folded turn keeps unconditionally: what the operator did, what was
 *  staged, and where the decision began and ended. */
const KEPT_ALWAYS: ReadonlySet<TurnEventKind> = new Set<TurnEventKind>([
  'board.arrived',
  'decision.begin',
  'decision.end',
  'operator.command',
  'pin',
  'unpin',
  'commit',
  'pin.refused',
  'stage.fastpass',
  'stage.requested',
  'stage.confirmed',
  'stage.retry',
  'commit.observed',
  'advice',
  'turn.resolved',
]);

function stagingFollows(events: ReadonlyArray<TurnEvent>, from: number): boolean {
  for (const event of events) {
    if (event.seq <= from) continue;
    if (event.kind === 'emission') return false;
    if (
      event.kind === 'stage.requested' ||
      event.kind === 'stage.fastpass' ||
      event.kind === 'stage.confirmed'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The 30-day fold (04 §4.3, 01 §6.4). A folded turn is STILL INSPECTABLE: the
 * board (`turn_boards`) and the basis (`decisions`) survive untouched and the
 * re-derivation path is unchanged, so retention becomes a LATENCY decision
 * rather than a loss. That is the payoff of storing the inputs.
 *
 * Dropped: refusals, the partition and reservoir frames, conditional rankings,
 * posture flips, every attention tick, and every emission that neither changed
 * the staged plan nor answered an operator (01 §6.3's frame-keeping rule, and
 * 04 §3 Q9 for attention).
 */
export function foldForRetention(
  gameId: GameId,
  turn: Turn,
  events: ReadonlyArray<TurnEvent>,
  rows: ReadonlyArray<MovesetProjectionRow>
): RetentionFold {
  const ordered = [...events].sort(bySeq);
  const kept: TurnEvent[] = [];

  for (const event of ordered) {
    if (KEPT_ALWAYS.has(event.kind)) {
      kept.push(event);
      continue;
    }
    if (event.kind === 'selection') {
      if (!payloadOf<SelectionPayload>(event).hover) kept.push(event);
      continue;
    }
    if (event.kind === 'emission') {
      if (event.answers !== null || stagingFollows(ordered, event.seq)) kept.push(event);
      continue;
    }
  }

  const stagedRows = rows.filter((r) => r.staged);
  const finalSeq = stagedRows.reduce((seq, r) => Math.max(seq, r.emissionSeq), -1);

  return {
    gameId,
    turn,
    kept,
    dropped: ordered.length - kept.length,
    stagedRows: stagedRows.filter((r) => r.emissionSeq === finalSeq),
  };
}
