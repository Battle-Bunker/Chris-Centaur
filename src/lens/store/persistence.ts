/**
 * The lens store's database plumbing: the SQL, and nothing else.
 *
 * Kept OUT of `./index.ts` on purpose. The reducer there is asserted pure
 * against its own source, and a module that reaches for a connection pool
 * cannot be. Everything here is a statement or a read; every decision about
 * WHAT to store was made by the fold next door.
 *
 * Nothing here queues, retries or drops — `DecisionLogger` and `CommandLogger`
 * own that discipline, and they own it for both of us so the retry policy has
 * one home rather than two that drift.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../database/db';
import {
  decisions,
  movesets as movesetsTable,
  turnBoards,
  turnEvents,
  unitOutcomes,
} from '../../database/schema';
import { applyEvent, decodeDecisionInput, emptyStore, encodeDecisionInput } from './index';
import type {
  DecisionRow,
  FrameStore,
  GameId,
  MovesetProjectionRow,
  Turn,
  TurnBoardRow,
  TurnEvent,
  TurnEventRow,
  UnitKey,
  UnitOutcomeRow,
} from '../types';

/** The identity strip a games listing groups on, stored beside the settlement
 *  so a listing never has to detoast a board to learn who played. */
export interface RosterEntry {
  readonly unit: UnitKey;
  readonly name: string | null;
  readonly letter: string | null;
  readonly color: string | null;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly squad: string | null;
  readonly length: number | null;
}

// ------------------------------------------------------------- turn_boards

/**
 * The re-run input AND the fold's t0 anchor. First write wins per column, so
 * a re-delivered Firebase snapshot can never regress a filled row, and the
 * final board of a game (which no decision ever covered) lands the same way
 * every other one does.
 */
export async function writeTurnBoard(row: {
  gameId: GameId;
  turn: Turn;
  settlementJson: string;
  boardHash: string | null;
  deadlineMs: number | null;
  rosterJson: string | null;
}): Promise<void> {
  const roster = row.rosterJson === null ? sql`NULL` : sql`${row.rosterJson}::jsonb`;
  await db.execute(sql`
    INSERT INTO turn_boards (game_id, turn, settlement, board_hash, deadline_ms, roster)
    VALUES (${row.gameId}, ${row.turn}, ${row.settlementJson}::jsonb,
            ${row.boardHash}, ${row.deadlineMs}, ${roster})
    ON CONFLICT (game_id, turn) DO UPDATE SET
      settlement = COALESCE(turn_boards.settlement, EXCLUDED.settlement),
      board_hash = COALESCE(turn_boards.board_hash, EXCLUDED.board_hash),
      deadline_ms = COALESCE(turn_boards.deadline_ms, EXCLUDED.deadline_ms),
      roster = COALESCE(turn_boards.roster, EXCLUDED.roster)
  `);
}

export async function readTurnBoard(
  gameId: GameId,
  turn: Turn
): Promise<TurnBoardRow | null> {
  const rows = await db
    .select()
    .from(turnBoards)
    .where(and(eq(turnBoards.gameId, gameId), eq(turnBoards.turn, turn)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    gameId: row.gameId,
    turn: row.turn,
    settlement: row.settlement,
    boardHash: row.boardHash ?? '',
    deadlineMs: row.deadlineMs ?? 0,
    roster: ((row.roster ?? []) as RosterEntry[]).map((r) => r.unit),
  };
}

// ------------------------------------------------------------- turn_events

/**
 * `payload` is the `TurnEvent` verbatim. `ON CONFLICT DO NOTHING` because
 * `(game_id, turn, seq)` is assigned by ONE writer: a conflict is a
 * re-delivery of a row already stored, never a second opinion about what
 * happened at that `seq`.
 */
export async function writeEventRows(rows: ReadonlyArray<TurnEventRow>): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(turnEvents)
    .values(
      rows.map((r) => ({
        gameId: r.gameId,
        turn: r.turn,
        seq: r.seq,
        kind: r.kind,
        atWall: r.atWall,
        atWorkMs: r.atWorkMs,
        actorKind: r.actorKind,
        actorId: r.actorId,
        actorName: r.actorName,
        actorColor: r.actorColor,
        unitKey: r.unitKey,
        causedBy: r.causedBy,
        answers: r.answers,
        payload: sql`${JSON.stringify(r.payload)}::jsonb`,
      }))
    )
    .onConflictDoNothing();
}

/** One turn's events, in `seq` order — the only order there is. */
export async function readTurnEvents(
  gameId: GameId,
  turn: Turn
): Promise<ReadonlyArray<TurnEvent>> {
  const rows = await db
    .select({ payload: turnEvents.payload })
    .from(turnEvents)
    .where(and(eq(turnEvents.gameId, gameId), eq(turnEvents.turn, turn)))
    .orderBy(turnEvents.seq);
  return rows.map((r) => r.payload as TurnEvent);
}

/** Every event of a game, for the timeline lane and the command history. */
export async function readGameEvents(gameId: GameId): Promise<ReadonlyArray<TurnEvent>> {
  const rows = await db
    .select({ payload: turnEvents.payload })
    .from(turnEvents)
    .where(eq(turnEvents.gameId, gameId))
    .orderBy(turnEvents.turn, turnEvents.seq);
  return rows.map((r) => r.payload as TurnEvent);
}

// --------------------------------------------------------------- decisions

export async function writeDecision(row: DecisionRow): Promise<void> {
  await db
    .insert(decisions)
    .values({
      id: row.id,
      gameId: row.gameId,
      turn: row.turn,
      botId: row.botId,
      behaviourId: row.behaviourId,
      engine: row.engine,
      profile: row.profile,
      basis: sql`${JSON.stringify(encodeDecisionInput(row.input))}::jsonb`,
      seed: row.input.seed,
      budgetMs: row.input.liveBudgetMs,
      nodeBudget: row.input.nodeBudget,
      assumptions: sql`${JSON.stringify(row.input.assumptions)}::jsonb`,
      initialPins: sql`${JSON.stringify(row.input.initialPins)}::jsonb`,
      modelled: sql`${JSON.stringify(row.input.modelled)}::jsonb`,
      kernelOptions: sql`${JSON.stringify(row.input.kernelOptions)}::jsonb`,
      summary: sql`${JSON.stringify(row.summary)}::jsonb`,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    })
    .onConflictDoUpdate({
      target: decisions.id,
      set: {
        summary: sql`EXCLUDED.summary`,
        endedAt: sql`EXCLUDED.ended_at`,
      },
    });
}

export async function readDecision(
  gameId: GameId,
  turn: Turn
): Promise<DecisionRow | null> {
  const rows = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.gameId, gameId), eq(decisions.turn, turn)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    gameId: row.gameId,
    turn: row.turn,
    botId: row.botId,
    behaviourId: row.behaviourId ?? '',
    engine: row.engine ?? '',
    profile: row.profile ?? '',
    input: decodeDecisionInput(row.basis),
    summary: (row.summary ?? {}) as Readonly<Record<string, number>>,
    startedAt: row.startedAt ?? 0,
    endedAt: row.endedAt,
  };
}

// ---------------------------------------------------------------- movesets

/**
 * The projection. `DELETE` then re-insert is the ONLY write path, because the
 * table's licence to exist is that `scripts/lens-rebuild.js` reproduces it
 * exactly — a partial update would be a second way to arrive at a row, and a
 * second way is how a materialised table starts disagreeing with its source.
 */
export async function writeMovesetRows(
  rows: ReadonlyArray<MovesetProjectionRow>
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(movesetsTable)
    .values(
      rows.map((r) => ({
        decisionId: r.decisionId,
        emissionSeq: r.emissionSeq,
        clusterId: r.clusterId,
        clusterKey: r.clusterKey,
        clusterGen: r.clusterGen,
        rank: r.rank,
        movesetKey: r.movesetKey,
        moves: sql`${JSON.stringify(r.moves)}::jsonb`,
        witnessPlanKey: r.witnessPlanKey,
        seenIn: r.seenIn,
        lo: r.lo,
        est: r.est,
        hi: r.hi,
        channel: r.channel,
        exact: r.exact,
        ledgerSize: r.ledgerSize,
        vacuity: r.vacuity,
        complementKey: r.complementKey,
        complementStale: r.complementStale,
        cited: sql`${JSON.stringify(r.cited)}::jsonb`,
        basisKey: r.basisKey,
        staged: r.staged,
        dominanceKind: r.dominanceKind,
        dominance: sql`${JSON.stringify(r.dominance)}::jsonb`,
        h1Lo: r.h1Lo,
        h1Hi: r.h1Hi,
        deepHorizon: r.deepHorizon,
        deepLo: r.deepLo,
        deepHi: r.deepHi,
        derived: r.derived,
        line: r.line === null ? sql`NULL` : sql`${JSON.stringify(r.line)}::jsonb`,
      }))
    )
    .onConflictDoNothing();
}

export async function deleteMovesetsFor(decisionId: string): Promise<void> {
  await db.delete(movesetsTable).where(eq(movesetsTable.decisionId, decisionId));
}

/** Every decision id of a game, oldest turn first — what the rebuild walks. */
export async function readDecisionIds(
  gameId: GameId
): Promise<ReadonlyArray<{ id: string; turn: Turn }>> {
  const rows = await db
    .select({ id: decisions.id, turn: decisions.turn })
    .from(decisions)
    .where(eq(decisions.gameId, gameId))
    .orderBy(decisions.turn);
  return rows;
}

// ----------------------------------------------------------- unit_outcomes

/**
 * The lifecycle merges rather than replaces: a request, a confirmation, a
 * commit and a resolution arrive as four separate facts about one row, in an
 * order the network chooses. A non-null value wins over null and `committed`
 * only ever goes true, so re-delivery can never un-know something.
 */
export async function writeUnitOutcome(row: UnitOutcomeRow): Promise<void> {
  await db.execute(sql`
    INSERT INTO unit_outcomes (
      game_id, turn, unit_key, unit_name, cluster_id,
      staged_move, staged_source, confirmed_move, committed,
      resolved_move, fatal_consent, operator_id
    ) VALUES (
      ${row.gameId}, ${row.turn}, ${row.unitKey}, ${row.unitName}, ${row.clusterId},
      ${row.stagedMove}, ${row.stagedSource}, ${row.confirmedMove}, ${row.committed},
      ${row.resolvedMove}, ${row.fatalConsent}, ${row.operatorId}
    )
    ON CONFLICT (game_id, turn, unit_key) DO UPDATE SET
      unit_name = COALESCE(EXCLUDED.unit_name, unit_outcomes.unit_name),
      cluster_id = COALESCE(EXCLUDED.cluster_id, unit_outcomes.cluster_id),
      staged_move = COALESCE(EXCLUDED.staged_move, unit_outcomes.staged_move),
      staged_source = COALESCE(EXCLUDED.staged_source, unit_outcomes.staged_source),
      confirmed_move = COALESCE(EXCLUDED.confirmed_move, unit_outcomes.confirmed_move),
      committed = unit_outcomes.committed OR EXCLUDED.committed,
      resolved_move = COALESCE(EXCLUDED.resolved_move, unit_outcomes.resolved_move),
      fatal_consent = COALESCE(EXCLUDED.fatal_consent, unit_outcomes.fatal_consent),
      operator_id = COALESCE(EXCLUDED.operator_id, unit_outcomes.operator_id)
  `);
}

export async function readUnitOutcomes(
  gameId: GameId,
  turn: Turn
): Promise<ReadonlyArray<UnitOutcomeRow>> {
  const rows = await db
    .select()
    .from(unitOutcomes)
    .where(and(eq(unitOutcomes.gameId, gameId), eq(unitOutcomes.turn, turn)));
  return rows.map((r) => ({
    gameId: r.gameId,
    turn: r.turn,
    unitKey: r.unitKey,
    unitName: r.unitName,
    clusterId: r.clusterId,
    stagedMove: r.stagedMove,
    stagedSource: r.stagedSource,
    confirmedMove: r.confirmedMove,
    committed: r.committed,
    resolvedMove: r.resolvedMove,
    fatalConsent: r.fatalConsent,
    operatorId: r.operatorId,
  }));
}

// ------------------------------------------------------------- replay seed

/**
 * The replay source's input, read from the tables: the anchor rebuilt from
 * `turn_boards` and the events read from `turn_events`. The anchor is
 * RECONSTRUCTED rather than read out of the log, because the settlement lives
 * in one place — a board stored twice is two boards waiting to disagree.
 *
 * Returns null when the turn's board never landed: without it nothing is
 * derivable, and an honest null beats a fold over an imaginary board.
 */
export async function loadTurnStore(gameId: GameId, turn: Turn): Promise<FrameStore | null> {
  const [board, events] = await Promise.all([
    readTurnBoard(gameId, turn),
    readTurnEvents(gameId, turn),
  ]);
  if (!board) return null;

  const stored = events.find((e) => e.kind === 'board.arrived');
  const anchor: TurnEvent = stored
    ? { ...stored, payload: { ...(stored.payload as object), settlement: board.settlement } }
    : {
        id: `${gameId}:${turn}:0`,
        gameId,
        turn,
        seq: 0,
        atWall: 0,
        atWorkMs: null,
        kind: 'board.arrived',
        actor: { kind: 'server', id: null, name: null, color: null },
        unit: null,
        causedBy: null,
        answers: null,
        payload: {
          boardHash: board.boardHash,
          deadlineMs: board.deadlineMs,
          turnExpiryTime: 0,
          roster: board.roster,
          alive: board.roster,
          settlement: board.settlement,
        },
      };

  return events
    .filter((e) => e.seq !== anchor.seq)
    .reduce<FrameStore>((store, event) => applyEvent(store, event), emptyStore(anchor));
}
