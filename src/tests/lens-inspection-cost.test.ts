/**
 * GATE G-L2 — INSPECTION COST IS BOUNDED, END TO END.
 *
 * `lobster/__tests__/lens-reserve.test.ts` proves 7(i) and 7(iii) AT THE
 * KERNEL, against the query port directly, and `lens-cost.test.ts` proves
 * 7(ii). All three are about a caller holding a `KernelLensPort` in the same
 * process as the decision. This file asks the question one layer out, where
 * the answer could still be different:
 *
 *   with the SERVER-SIDE SINK attached — the one `seq` writer, every frame
 *   ingested and stored — and a synthetic inspector driving `lens-conditional`
 *   requests OVER THE WIRE for a whole turn, does the decision still get the
 *   search it was promised, and does every request past the reserve come back
 *   as a typed refusal envelope?
 *
 * TWO THINGS ARE ADDED HERE that the kernel-level gate cannot see.
 *
 * 1. THE SINK IS DOING REAL WORK. The kernel gate's sink is `frames.push`.
 *    This one is the production assembly: `ingestLensEvents` through a
 *    `SeqWriter`, translating substrate numbers to wire ids, encoding a row
 *    per event and re-folding the `movesets` projection whenever a reservoir
 *    frame lands. That is the work an unwatched decision does not do, and the
 *    2% claim is about the watched decision paying for it out of the reserve
 *    rather than out of the search.
 *
 * 2. THE REQUEST TRAVELS AS AN ENVELOPE. `makeInspectionPort` is the object
 *    the websocket server holds, and the reply is shaped into the exact
 *    `lens-conditional-rows` message the handler sends. A refusal that never
 *    left the kernel is easy to keep typed; what matters to an operator is
 *    that it arrives, on the same channel as an answer, JSON-encodable, with
 *    words in it — because a UI that cannot tell "the reserve is spent" from
 *    "nothing happened" draws the second when it means the first.
 */

import { LENS_INSPECTION_MS } from '../lens/types';
import { unitKeyOf } from '../lens/kernel';
import { ingestLensEvents, makeSeqWriter, projectMovesets, encodeEventRow } from '../lens/store';
import { makeInspectionPort } from '../lens/store/sources';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel } from '../lobster/kernel';
import { rigFor } from '../lobster/candidates';
import { defaultEvaluator } from '../lobster/evaluate';
import { EngineSubstrate, clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import type { Evaluator, KernelInput } from '../lobster/contracts';
import type {
  ConditionalRequest,
  LensEvent,
  RankConditionalResult,
  TurnEvent,
  TurnEventRow,
  UnitKey,
} from '../lens/types';
import {
  DecisionClock,
  MIXED_SCENARIO,
  SNAKE_SCENARIO,
  buildBoard,
  meteredEvaluator,
  runGame,
  summaryOf,
} from './local-game';

jest.setTimeout(300_000);

afterEach(() => clearGeometryCache());

const GAME = 'gate-g-l2';
const TURN = 4;
/** Big enough that the declared reserve is a fraction of a percent of the
 *  search — the regime the 2% claim is about. 7(i) owns the reserve itself. */
const WORK = 5_500;
/** Far more asks per barrier than the reserve can ever serve. The gate is
 *  about what happens to the ones it cannot. */
const ASKS_PER_BARRIER = 24;

/** The S→C reply of 04 §4.5, exactly as the websocket handler sends it. */
type ConditionalRowsEnvelope = { type: 'lens-conditional-rows'; requestId: string } & (
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; refusal: string; detail: string }
);

interface Run {
  /** Evaluator calls made before the work clock reached `searchDeadline`. */
  readonly inside: number;
  readonly frames: ReadonlyArray<LensEvent>;
  /** What the writer stamped, and what storage would hold. */
  readonly written: ReadonlyArray<TurnEvent>;
  readonly rows: ReadonlyArray<TurnEventRow>;
  readonly projections: number;
  /** Every reply the inspector received, in order. */
  readonly replies: ReadonlyArray<ConditionalRowsEnvelope>;
}

/**
 * One decision on a real board under the node clock. `watched` attaches the
 * whole server side; without it `KernelInput.lens` is undefined, which is the
 * state 7(ii) measures and the baseline this gate compares against.
 */
async function decide(watched: boolean): Promise<Run> {
  const board = buildBoard({ ...MIXED_SCENARIO, seed: 1 });
  const teamId = (MIXED_SCENARIO.teams[0] as { id: string }).id;
  const ourIds = (board.snakes ?? []).filter((s) => s.teamID === teamId).map((s) => s.id);
  const sub = makeSubstrate({ gameId: GAME, board, turn: TURN, asTeam: teamId, modeled: ourIds });

  const frames: LensEvent[] = [];
  const rows: TurnEventRow[] = [];
  const replies: ConditionalRowsEnvelope[] = [];
  const writer = makeSeqWriter(GAME, TURN);
  let projections = 0;

  try {
    const asTeam = sub.teamNumber(teamId);
    const clock = new DecisionClock(true);
    const { gen, search } = rigFor(sub);
    const kernel = new LobsterKernel({
      ...DEFAULT_KERNEL_OPTIONS,
      crossfade: 'teammate',
      reserveMs: 0,
      // A production-shaped slice, not a sixth of this budget: at a sixth the
      // reserve quantises away a whole slice and the measurement becomes a
      // measurement of rounding.
      sliceMs: 550 / 6,
      maxSliceFraction: 0,
      pinCacheCapacity: 32,
      minWriteIntervalMs: 0,
      yieldIntervalMs: 0,
    });

    // The turn's anchor, so the writer has something for a fold to begin at
    // and the `causedBy`/`answers` checks have a log to check against.
    const anchor = writer.write({
      gameId: GAME,
      turn: TURN,
      atWall: 1_700_000_000_000,
      atWorkMs: null,
      kind: 'board.arrived',
      actor: { kind: 'server', id: null, name: null, color: null },
      unit: null,
      causedBy: null,
      answers: null,
      payload: { boardHash: 'hash:gate', deadlineMs: WORK, turnExpiryTime: 0, roster: ourIds, alive: ourIds },
    });
    rows.push(encodeEventRow(anchor));

    const t0 = clock.now();
    // THE WINDOW, and it is the SAME window in both runs: the watched run's own
    // search deadline. Counting to the unwatched run's longer deadline would
    // measure the declared reserve a second time, which 7(i) already owns.
    const window = t0 + WORK - LENS_INSPECTION_MS;
    let inside = 0;
    // METERED, or the measurement is of nothing: under the node clock an
    // evaluation that does not charge the clock is free, and a reserve
    // denominated in work could not bound a cost the work clock never sees.
    const metered = meteredEvaluator(defaultEvaluator, clock);
    const counting: Evaluator = {
      scorePlan: (s, p, t) => {
        if (clock.now() < window) inside++;
        return metered.scorePlan(s, p, t);
      },
      evaluatePlan: (s, p, t) => {
        if (clock.now() < window) inside++;
        return metered.evaluatePlan(s, p, t);
      },
    };

    /** THE SERVER SIDE, as the active game manager assembles it. */
    const sink = (event: LensEvent): void => {
      frames.push(event);
      const written = ingestLensEvents(writer, [event], {
        t0AtWall: 1_700_000_000_000,
        unitKeyOf: (unitId) => unitKeyOf(sub, unitId),
      });
      for (const row of written) rows.push(encodeEventRow(row));
      if (written.some((row) => row.kind === 'movesets')) {
        projections += projectMovesets(`${GAME}:${TURN}`, writer.written).length;
      }
    };

    const kin: KernelInput = {
      sub,
      gen,
      evaluate: counting,
      search,
      asTeam,
      deadlineMs: t0 + WORK,
      initialPins: [],
      assumptions: [],
      now: clock.now,
      ...(watched ? { lens: sink } : {}),
    };

    // THE WIRE'S OWN PORT, over the running kernel — the same object the
    // websocket server holds and the same one production builds.
    const inspection = makeInspectionPort({
      portFor: (gameId) => (gameId === GAME ? kernel.lensPort() : null),
      cursorFor: (gameId) => ({ gameId, turn: TURN, seq: writer.written.length - 1 }),
    });

    /** C→S `lens-conditional` in, S→C `lens-conditional-rows` out. The reply
     *  is shaped exactly as the handler shapes it, and it is JSON — a socket
     *  carries nothing else. */
    function ask(requestId: string, req: ConditionalRequest): void {
      const answer: RankConditionalResult = inspection.rankConditional(GAME, req);
      replies.push(
        JSON.parse(
          JSON.stringify({ type: 'lens-conditional-rows', requestId, ...answer })
        ) as ConditionalRowsEnvelope
      );
    }

    const port = kernel.lensPort();
    let requestId = 0;
    for await (const rec of kernel.decide(kin)) {
      if (!watched) continue;
      // HOVERING CONTINUOUSLY, for the whole turn. Far more asks than the
      // reserve can serve: the point is that the ones past it are REFUSED and
      // not served, so the search never pays for an operator's attention.
      const cluster = port.partition().find((c) => c.members.length > 0);
      if (cluster === undefined) continue;
      for (let i = 0; i < ASKS_PER_BARRIER; i++) {
        const unit = cluster.members[i % cluster.members.length] as UnitKey;
        const unitId = sub.unitIdOf(unit);
        const to = unitId === undefined ? undefined : rec.plan.get(unitId)?.to;
        if (to === undefined) continue;
        ask(`req:${requestId++}`, {
          cluster: cluster.id,
          clusterGeneration: cluster.generation,
          lock: { unit, to },
        });
      }
    }

    return { inside, frames, written: writer.written, rows, projections, replies };
  } finally {
    sub.release();
    clearGeometryCache();
  }
}

/**
 * THE SINK MUST NOT MOVE A DECISION.
 *
 * 7(ii) says an ABSENT sink costs nothing; this says a PRESENT one changes
 * nothing the operator can see. They are different claims and the second is
 * the one that matters at merge: a lens that shifted the bot's play would make
 * every recorded game a recording of a bot nobody runs unwatched, and would
 * quietly invalidate the merge bar, which is measured with the lens off.
 *
 * THE PLAY is byte-identical — every move, every meal, every death, every
 * seed kept — compared as a STRING over the whole summary so a counter added
 * later is covered without anybody remembering, the same strictness
 * `local-game-determinism.test.ts` uses.
 *
 * THE WORK IS NOT, and must not be: the reserve is DECLARED, not taken (04
 * §3.3 Q5), so a watched decision searches for exactly `LENS_INSPECTION_MS`
 * less than an unwatched one whether or not anybody inspects. That is the
 * whole cost of the lens and it is visible before the turn starts. So the
 * `work` block is compared as a BOUND rather than for equality: the same
 * number of decisions, never longer than the unwatched run, and never shorter
 * than the reserve could account for. A watched run that searched LONGER, or
 * one that lost more than the reserve, would both fail here — and either would
 * mean the carve is not what it says it is.
 *
 * `loud` IS OF THE WORK'S KIND, not the play's (08 §5 step 1). It counts B3
 * PREAMBLES — one per priced plan with a non-empty gate — so a run that
 * searched less because the reserve was carved off it runs fewer of them, for
 * the same reason it spends fewer nodes. Holding it to equality here would be
 * asserting that the reserve is not taken, which is the opposite of what the
 * block below proves; so it is compared as a bound, in the same direction.
 *
 * AND SO IS `seedKept`, for exactly that reason and no other. It counts the
 * unit-turns whose emitted move CAME FROM THE SEED rather than from a step the
 * search took off it — the provenance of a move, not the move. Two runs that
 * play the same board to the same cells, the same meals and the same health
 * can still disagree about it, because the run with less clock reached the
 * same answer without having to improve on the seed; measured on `mixed`
 * seed 3, where every other counter in the summary is identical and this one
 * reads 23 open against 24 watched. Holding a provenance counter to equality
 * is asserting that the reserve is not taken, which is the claim the `work`
 * block below exists to disprove — so it is compared in the direction the
 * reserve implies: LESS search keeps the seed at least as often.
 */
/**
 * Take `seedKept` out of a parsed summary and return it. Mutates, because the
 * caller's next line stringifies what is left and the point is that this
 * counter is not in it.
 */
function seedProvenance(play: Record<string, unknown>): number {
  const counters = play['counters'] as Record<string, number> | undefined;
  const rates = play['rates'] as Record<string, number> | undefined;
  const kept = counters?.['seedKept'] ?? 0;
  if (counters !== undefined) delete counters['seedKept'];
  if (rates !== undefined) delete rates['seedKeptPer100'];
  return kept;
}

describe('the sink does not move a decision', () => {
  const SEEDS = [1, 2, 3] as const;
  const TURNS = 6;
  const NODES = 300;

  async function play(
    spec: typeof MIXED_SCENARIO,
    scenario: string,
    seed: number,
    watched: boolean
  ): Promise<string> {
    // The sink DOES REAL WORK when attached — the writer, the ingest, the
    // translation, the projection — because a sink that only counted would
    // prove nothing about the one production runs.
    const writers = new Map<string, ReturnType<typeof makeSeqWriter>>();
    const result = await runGame(
      { ...spec, maxTurns: TURNS, seed, nodeBudget: NODES },
      {
        scores: false,
        ...(watched
          ? {
              lensFor: (turn: number, teamId: string) => {
                const key = `${teamId}:${turn}`;
                const writer = makeSeqWriter(key, turn);
                writers.set(key, writer);
                let sub: EngineSubstrate | null = null;
                return {
                  attach: (s) => {
                    sub = s;
                  },
                  sink: (event: LensEvent) => {
                    ingestLensEvents(writer, [event], {
                      t0AtWall: 0,
                      unitKeyOf: (unitId) => sub?.unitOf(unitId)?.wireId ?? null,
                    });
                    projectMovesets(key, writer.written);
                  },
                };
              },
            }
          : {}),
      }
    );
    clearGeometryCache();
    if (watched) expect(writers.size).toBeGreaterThan(0);
    return JSON.stringify(
      summaryOf(
        result.metrics,
        { label: 'lens', scenario, seed, turnsRequested: TURNS },
        { kind: 'nodes', nodes: NODES }
      )
    );
  }

  for (const scenario of [
    ['mixed', MIXED_SCENARIO],
    ['snakes', SNAKE_SCENARIO],
  ] as const) {
    for (const seed of SEEDS) {
      it(`plays identically with the sink attached and absent — ${scenario[0]} seed ${seed}`, async () => {
        const open = JSON.parse(await play(scenario[1], scenario[0], seed, false));
        const watched = JSON.parse(await play(scenario[1], scenario[0], seed, true));
        const { work: openWork, loud: openLoud, ...openPlay } = open;
        const { work: watchedWork, loud: watchedLoud, ...watchedPlay } = watched;
        // `seedKept` is provenance, not play — see the header. Lifted out of
        // both summaries before the equality and compared as a bound below.
        const openSeed = seedProvenance(openPlay);
        const watchedSeed = seedProvenance(watchedPlay);
        expect(JSON.stringify(watchedPlay)).toBe(JSON.stringify(openPlay));
        // The counters are not vacuously equal: the bot really played.
        expect(openPlay.counters.unitTurns).toBeGreaterThan(0);
        expect(openPlay.counters.movesWithChoice).toBeGreaterThan(0);

        // And the work differs by the declared reserve, and by nothing else.
        expect(watchedWork.decisions).toBe(openWork.decisions);
        const lost = openWork.nodes - watchedWork.nodes;
        expect(lost).toBeGreaterThanOrEqual(0);
        expect(lost).toBeLessThanOrEqual(openWork.decisions * LENS_INSPECTION_MS);

        // The instrument moves with the search and only downward: the watched
        // run priced no more plans than the unwatched one, and it really
        // measured something on both.
        expect(openLoud.occasions).toBeGreaterThan(0);
        expect(watchedLoud.occasions).toBeGreaterThan(0);
        expect(watchedLoud.occasions).toBeLessThanOrEqual(openLoud.occasions);

        // Provenance moves with the search, and only one way: the run that
        // searched less cannot have stepped off the seed more often.
        expect(openSeed).toBeGreaterThan(0);
        expect(watchedSeed).toBeGreaterThanOrEqual(openSeed);
      }, 300_000);
    }
  }
});

describe('G-L2 — inspection cost is bounded with the server side attached', () => {
  let open: Run;
  let watched: Run;

  beforeAll(async () => {
    open = await decide(false);
    watched = await decide(true);
  }, 300_000);

  it('really attached the server side: frames written, rows encoded, projection folded', () => {
    // Without this the 2% claim below is a comparison of two unwatched runs.
    expect(watched.frames.length).toBeGreaterThan(0);
    expect(watched.written.length).toBeGreaterThan(watched.frames.length);
    expect(watched.rows.length).toBe(watched.written.length);
    expect(watched.projections).toBeGreaterThan(0);
    expect(open.frames).toHaveLength(0);
  });

  it('really inspected: an ask per member per barrier, for the whole turn', () => {
    expect(watched.replies.length).toBeGreaterThan(ASKS_PER_BARRIER);
    expect(open.replies).toHaveLength(0);
  });

  it('keeps evaluator calls inside searchDeadline within 2% of the sink-absent run', () => {
    expect(open.inside).toBeGreaterThan(100);
    const drift = Math.abs(watched.inside - open.inside) / open.inside;
    expect(drift).toBeLessThan(0.02);
  });

  it('answers some asks and refuses the rest — never silence, on either side', () => {
    const served = watched.replies.filter((r) => r.ok === true);
    const refused = watched.replies.filter((r) => r.ok === false);
    // Both must happen: served proves the surface works, refused proves the
    // bound is real. A run with no refusals would mean the inspector never
    // reached the reserve and the gate measured nothing.
    expect(served.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    expect(served.length + refused.length).toBe(watched.replies.length);
  });

  it('returns every over-reserve request as a TYPED refusal envelope', () => {
    const refused = watched.replies.filter((r) => r.ok === false);
    for (const reply of refused) {
      const envelope = reply as { type: string; requestId: string; refusal: string; detail: string };
      // On the same channel as an answer, with a machine-readable reason and
      // words a panel can print. Silence, or an `ok: true` with no rows, are
      // the two failures this replaces.
      expect(envelope.type).toBe('lens-conditional-rows');
      expect(typeof envelope.requestId).toBe('string');
      expect(envelope.requestId.length).toBeGreaterThan(0);
      expect(['reserve-spent', 'generation-superseded', 'off-head', 'unknown-cluster'])
        .toContain(envelope.refusal);
      expect(envelope.detail.length).toBeGreaterThan(0);
      expect((reply as Record<string, unknown>).rows).toBeUndefined();
    }
    // The reserve is what runs out, so that is what the refusals say.
    expect(refused.some((r) => (r as { refusal: string }).refusal === 'reserve-spent')).toBe(true);
  });

  it('every reply survives the wire: JSON in, JSON out, nothing lost', () => {
    for (const reply of watched.replies) {
      expect(JSON.parse(JSON.stringify(reply))).toEqual(reply);
    }
  });

  it('refuses a SUPERSEDED ask without spending the reserve on it', () => {
    // The failure this pins cost the gate its first green run, and it is the
    // exact shape the reserve exists to prevent: the guard used to compare the
    // ask's generation against `clusterAfter` — the cluster with the lock
    // APPLIED, whose generation has moved on by construction — so every
    // well-formed request was priced, served by the kernel, and then thrown
    // away as superseded. The operator paid the reserve and got a refusal.
    let priced = 0;
    const port = makeInspectionPort({
      portFor: () => ({
        partition: () => [
          { id: 0, key: 'k', generation: 7, members: ['A'], boundedBy: [], lineage: [] },
        ],
        movesets: () => [],
        rankConditional: () => {
          priced++;
          throw new Error('a superseded ask must never reach the kernel');
        },
        explainMoveset: async () => ({ ok: false, refusal: 'reserve-spent', detail: 'spent' }),
        reserve: { budgetMs: LENS_INSPECTION_MS, spentMs: 0, queued: 0 },
      }) as never,
      cursorFor: () => null,
    });
    const answer = port.rankConditional(GAME, {
      cluster: 0,
      clusterGeneration: 3,
      lock: { unit: 'A', to: 20 },
    });
    expect(answer.ok).toBe(false);
    expect((answer as { refusal: string }).refusal).toBe('generation-superseded');
    expect(priced).toBe(0);
  });

  it('still re-stages a conforming plan with zero slices in between', () => {
    const operators = watched.frames.filter((e) => e.kind === 'operator');
    // No operator acted in this run, so there is nothing to conform to — the
    // claim is vacuous here and is owned by the kernel gate, which scripts a
    // pin. What must hold is that the inspector alone never produced one.
    expect(operators).toHaveLength(0);
  });
});
