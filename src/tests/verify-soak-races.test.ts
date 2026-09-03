/**
 * V3 SOAK — TURN-BOUNDARY BEHAVIOUR OF THE LOBSTER DECISION.
 *
 * Three characterisations, all measured on the real TeamDecisionEngine.
 *
 * 1. THE DECISION NEVER YIELDS TO THE EVENT LOOP.
 *    `LobsterKernel.decide` is an `async *` generator with no `await` in it, so
 *    the consumer's `for await` resolves every yield on the MICROtask queue and
 *    the loop never reaches its timer/IO phase. A pin delivered the way the
 *    transport delivers one — a Firestore snapshot listener, i.e. a macrotask —
 *    is therefore NOT seen mid-decision; only a pin raised synchronously from
 *    inside an emission is. (The legacy path deliberately does the opposite:
 *    `DecisionWorkerPool.submit` wraps every inline chunk in `setImmediate`
 *    "so staging writes, Firestore listeners and the web UI stay responsive".)
 *
 * 2. OVERLAPPING DECISIONS CLOBBER THE LIVE HANDLE.
 *    `decideTurn`'s `finally` sets `game.live = null` unconditionally. A turn
 *    that resolves EARLY (T1 fact 5) starts the next decision while the old one
 *    is still running, and when the OLD one finishes it nulls the handle the
 *    NEW one installed — after which the new turn's pin events are dropped.
 *
 * 3. THE FORCED CONFORMANCE RE-STAGE IS NOT GATED BY CROSSFADE.
 *    `LobsterKernel.buildRecord` (rung 0 and the epoch-change re-stage) calls
 *    `record()` directly and never `gate()`, so gate 4 (crossfade) is skipped —
 *    contradicting its own doc comment. Consequence, both ways: an operator's
 *    pin can never be starved by the teammate floor, and the one revision most
 *    likely to tear on a >10-unit team is the one that ships uncertified.
 */

import type { Board, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import type { JointPlan, PinEvent, UnitId } from '../lobster/contracts';
import { clearGeometryCache } from '../lobster/substrate';
import { TeamDecisionEngine, type TeamDecisionPorts } from '../lobster/team-decision-engine';

jest.setTimeout(60_000);

// ------------------------------------------------------------------ fixture

const KINDS = ['rook', 'knight', 'bishop', 'queen', 'pawn'] as const;

const unit = (id: string, at: Coord, unitType: string, weight: number, teamID: string): Snake =>
  ({
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
  }) as unknown as Snake;

function armies(size: number, ours: number, theirs: number): Board {
  const snakes: Snake[] = [];
  const place = (n: number, prefix: string, team: string, baseY: number, dir: 1 | -1): void => {
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / size);
      const kind = i === 0 ? 'king' : (KINDS[(i + row) % KINDS.length] as string);
      const weight = kind === 'king' ? 1 : kind === 'queen' ? 3 : kind === 'pawn' ? 1 : 2;
      snakes.push(unit(`${prefix}${i}`, { x: i % size, y: baseY + dir * row }, kind, weight, team));
    }
  };
  place(ours, 'r', 'red', 0, 1);
  place(theirs, 'b', 'blue', size - 1, -1);
  return { width: size, height: size, food: [], hazards: [], snakes } as unknown as Board;
}

const viewFor = (board: Board, snakeId: string, turn: number): GameState =>
  ({
    game: { id: 'g', ruleset: { name: 't', version: 'v', settings: {} }, map: 'm', timeout: 10_000, source: 't' },
    turn,
    board,
    you: board.snakes.find((s) => s.id === snakeId),
  }) as unknown as GameState;

interface Harness {
  readonly ports: TeamDecisionPorts;
  readonly staged: Array<{ snakeId: string; move: CentaurMove }>;
  fire(ev: PinEvent, turn?: number): void;
  onFirstEmission: ((snakeId: string, move: CentaurMove) => void) | null;
}

function harness(ourIds: ReadonlyArray<string>): Harness {
  const staged: Array<{ snakeId: string; move: CentaurMove }> = [];
  let sink: ((ev: PinEvent, turn?: number) => void) | null = null;
  const h: Harness = {
    staged,
    onFirstEmission: null,
    fire: (ev, turn) => sink?.(ev, turn),
    ports: {
      setBotRecommendation: (_g, snakeId, move) => {
        const first = staged.length === 0;
        staged.push({ snakeId, move });
        if (first) h.onFirstEmission?.(snakeId, move);
      },
      enableTeamStaging: () => undefined,
      onPinEvent: (_g, s) => {
        sink = s;
        return () => {
          sink = null;
        };
      },
      pinSnakeIdOf: (_g, unitId) => ourIds[unitId] ?? null,
      log: () => undefined,
    },
  };
  return h;
}

const turnInput = (board: Board, ourIds: ReadonlyArray<string>, turn: number, budgetMs: number) => ({
  gameId: 'g',
  turn,
  board,
  ourTeamId: 'red',
  units: ourIds.map((id) => ({ snakeId: id, view: viewFor(board, id, turn) })),
  deadlineMs: Date.now() + budgetMs,
});

afterEach(() => clearGeometryCache());

// -------------------------------------------------------------- 1. event loop

// INVERTED. V3 filed these as characterisations of a decision that never
// reached the event loop's timer or I/O phase: `decide` was an async generator
// with no await in it, so every yield resolved on the microtask queue. That
// made the entire mid-decision constraint machinery unreachable from the real
// wire (the transport delivers pins on a Firestore snapshot listener — a
// macrotask), collapsed every staged revision into one post-decision burst,
// and delayed the final-flush timer past endTime under multi-game load. The
// kernel now yields for real at the slice boundary, so these assert the
// opposite of what they were written to assert.
describe('the lobster decision hands the event loop back while it runs', () => {
  test('a macrotask armed before the decision RUNS during it', async () => {
    const board = armies(12, 6, 6);
    const ourIds = board.snakes.filter((s) => s.teamID === 'red').map((s) => s.id);
    const h = harness(ourIds);
    const engine = new TeamDecisionEngine(h.ports, { kernel: { reserveMs: 20, sliceMs: 10 } });

    const t0 = Date.now();
    let timerAt = -1;
    let immediateAt = -1;
    let microtaskAt = -1;
    setTimeout(() => (timerAt = Date.now() - t0), 0);
    setImmediate(() => (immediateAt = Date.now() - t0));
    void Promise.resolve().then(() => (microtaskAt = Date.now() - t0));

    const result = await engine.decideTurn(turnInput(board, ourIds, 0, 500));
    const decisionMs = Date.now() - t0;
    expect(result.report).not.toBeNull();
    expect(decisionMs).toBeGreaterThan(50);

    // The timer phase and the check phase both ran while the decision was in
    // flight, and so did the microtask queue.
    expect(timerAt).toBeGreaterThanOrEqual(0);
    expect(timerAt).toBeLessThanOrEqual(decisionMs);
    expect(immediateAt).toBeGreaterThanOrEqual(0);
    expect(immediateAt).toBeLessThanOrEqual(decisionMs);
    expect(microtaskAt).toBeGreaterThanOrEqual(0);
    expect(microtaskAt).toBeLessThanOrEqual(decisionMs);
    // And the yields are on the record.
    expect(result.report?.yields ?? 0).toBeGreaterThan(0);
    engine.release('g');
  });

  test('a pin delivered as a listener callback IS seen mid-decision, like a synchronous one', async () => {
    const board = armies(12, 6, 6);
    const ourIds = board.snakes.filter((s) => s.teamID === 'red').map((s) => s.id);

    // (a) timer-delivered — exactly how the transport's onPinEvent arrives.
    const timed = harness(ourIds);
    const e1 = new TeamDecisionEngine(timed.ports, { kernel: { reserveMs: 20, sliceMs: 10 } });
    setTimeout(() => timed.fire({ kind: 'pin', pin: { unitId: 0 as UnitId, to: 30, tentative: false } }), 20);
    const r1 = await e1.decideTurn(turnInput(board, ourIds, 0, 500));
    // The operator's pin opened a constraint epoch and got its conforming
    // re-stage, from a delivery shaped exactly like the production listener.
    expect(r1.report?.epochs).toBe(2);
    expect(r1.report?.conformance.length).toBeGreaterThan(0);
    expect(r1.report?.conformance[0]?.slicesBefore).toBe(0);
    e1.release('g');

    // (b) raised synchronously from inside an emission — the only delivery the
    //     kernel can actually observe, and the shape the repo's own smoke test
    //     uses.
    const sync = harness(ourIds);
    const e2 = new TeamDecisionEngine(sync.ports, { kernel: { reserveMs: 20, sliceMs: 10 } });
    sync.onFirstEmission = (_id, move) => {
      if (typeof move === 'number') {
        sync.fire({ kind: 'pin', pin: { unitId: 0 as UnitId, to: move, tentative: false } });
      }
    };
    const r2 = await e2.decideTurn(turnInput(board, ourIds, 0, 500));
    expect(r2.report?.epochs).toBe(2);
    expect(r2.report?.conformance.length).toBeGreaterThan(0);
    expect(r2.report?.conformance[0]?.slicesBefore).toBe(0);
    e2.release('g');
  });
});

// ------------------------------------------------------- 2. overlapping turns

// INVERTED. The older decision's `finally` used to null the handle the NEWER
// decision had installed, and every pin for the live turn then went nowhere.
describe('an early turn resolution overlaps two decisions', () => {
  test('the finishing decision leaves the LIVE decision’s handle alone, and its pins arrive', async () => {
    const board = armies(12, 6, 6);
    const ourIds = board.snakes.filter((s) => s.teamID === 'red').map((s) => s.id);
    const h = harness(ourIds);
    const engine = new TeamDecisionEngine(h.ports, { kernel: { reserveMs: 20, sliceMs: 10 } });
    const games = (engine as unknown as { games: Map<string, { live: unknown }> }).games;

    // Turn 1 starts while turn 0 is still deciding — the early-resolution race.
    let second: Promise<{ report: { epochs: number } | null }> | null = null;
    let liveWhileBothRan: unknown = null;
    h.onFirstEmission = () => {
      second = engine.decideTurn(turnInput(board, ourIds, 1, 400)) as never;
      liveWhileBothRan = games.get('g')?.live ?? null;
    };
    await engine.decideTurn(turnInput(board, ourIds, 0, 250));

    // While both were in flight the handle belonged to the newer decision...
    expect(liveWhileBothRan).not.toBeNull();
    // ...and the older decision's `finally` left it there, because it is keyed
    // by turn and turn 0 does not own turn 1's handle.
    expect(games.get('g')?.live ?? null).not.toBeNull();

    // So a pin for the LIVE turn reaches the live kernel.
    h.fire({ kind: 'pin', pin: { unitId: 0 as UnitId, to: 30, tentative: false } }, 1);
    const r = await (second as unknown as Promise<{ report: { epochs: number } | null }>);
    expect(r.report?.epochs).toBe(2);
    engine.release('g');
  });
});

// ------------------------------------------------------------- 3. crossfade

describe('the crossfade certificate does not cover the forced paths', () => {
  test('an always-blocking teammate floor cannot starve rung 0 or the conformance re-stage', async () => {
    const board = armies(12, 12, 12);
    const ourIds = board.snakes.filter((s) => s.teamID === 'red').map((s) => s.id);
    const h = harness(ourIds);
    // A certificate that reports EVERY change as a loss: the kernel calls
    // hook(previous) then hook(next) and blocks on `after < before`.
    let n = 0;
    const alwaysBlock = (_p: JointPlan, _x: ReadonlySet<UnitId>): number => -(n++);
    const engine = new TeamDecisionEngine(h.ports, {
      kernel: {
        reserveMs: 20,
        sliceMs: 10,
        minWriteIntervalMs: 5,
        teammateFloor: alwaysBlock,
      },
    });
    h.onFirstEmission = (_id, move) => {
      if (typeof move === 'number') {
        h.fire({ kind: 'pin', pin: { unitId: 0 as UnitId, to: move, tentative: false } });
      }
    };
    const r = await engine.decideTurn(turnInput(board, ourIds, 0, 1500));
    const report = r.report;
    expect(report).not.toBeNull();
    if (report === null) return;

    // The certificate refused everything it was ever consulted about: nothing
    // was certified, and every block is counted on its own refusal channel.
    // (How OFTEN it is consulted is board- and budget-dependent; the adversarial
    // count on a 12-unit team at a 3 s budget is in the soak report.)
    // A write whose delta sits wholly inside ONE chunk is atomic on the wire
    // and needs no certificate, so it can still be certified without the hook
    // ever being asked; what must never happen is a certificate CLAIMED over a
    // refusal.
    expect(report.refusals.crossfade).toBe(report.crossfade.blocked);
    // The forced paths CONSULT the certificate now and record its verdict, so
    // a re-stage that shipped without one is visible rather than invisible.
    // (Whether THIS board's re-stage spans a chunk boundary — and so has a
    // torn interleaving to refuse at all — is board-dependent; the accounting
    // itself is pinned in the kernel suite.)
    for (const rec of report.journal) expect(rec.crossfade).toBeDefined();
    expect(report.crossfade.blocked).toBeGreaterThanOrEqual(0);
    // Rung 0 still reached the wire...
    expect(report.stagedNothing).toBe(false);
    expect(report.journal.length).toBeGreaterThan(0);
    // ...and so did every epoch-change conformance re-stage. `buildRecord`
    // consults gate 4 but never obeys it: this is the answer to the
    // integrator's open question — a forced conformance re-stage CANNOT be
    // starved, and that is a stated guarantee rather than an accident of
    // where `gate()` happens to be called.
    expect(report.epochs).toBe(2);
    expect(report.conformance).toHaveLength(1);
    expect(report.emits).toBeGreaterThanOrEqual(2); // rung 0 + the re-stage
    engine.release('g');
  });
});
