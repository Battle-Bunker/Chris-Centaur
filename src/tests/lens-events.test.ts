/**
 * ONE WRITER, ONE ORDER.
 *
 * `seq` is the total order within a turn and the only thing the UI sorts on,
 * so it has exactly one author: the active game manager, one writer per
 * `(gameId, turn)` (04 §3 O6). Under a decision, operator commands and a turn
 * resolution arriving together, no two events may share a `(gameId, turn, seq)`
 * and the sequence must be gapless and monotone.
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is two writers — the failure
 * `decision-worker-pool.ts` would have caused, and which the one-engine
 * rewrite removes by deleting it. The out-of-process case is moot today; the
 * trigger to revisit is any decision leaving the process, and this file is
 * what would notice when one did.
 *
 * Two smaller properties ride along because they are properties of the same
 * writer: `answers` names the operator event whose `ConformanceSample`
 * measured the emission — the single highest-value causal link in the model,
 * turning *"the operator pinned and then something was staged"* into *"this
 * write is the answer to that pin, 18 ms later, 0 slices in between"* — and
 * `atWorkMs` is NULL, never 0, when nothing measured it.
 */

import { makeSeqWriter } from '../lens/store';
import type { SeqWriter } from '../lens/store';
import type { TurnEvent } from '../lens/types';
import { BOT_ACTOR, FIXTURE_GAME, operatorActor } from './lens-fixtures';

const TURN = 41;

type Draft = Omit<TurnEvent, 'id' | 'seq'>;

function draft(over: Partial<Draft> & Pick<Draft, 'kind'>): Draft {
  return {
    gameId: FIXTURE_GAME,
    turn: TURN,
    atWall: 1_700_000_000_000,
    atWorkMs: null,
    actor: BOT_ACTOR,
    unit: null,
    causedBy: null,
    answers: null,
    payload: {},
    ...over,
  };
}

function writer(): SeqWriter {
  return makeSeqWriter(FIXTURE_GAME, TURN);
}

describe('one writer assigns seq', () => {
  it('is gapless and monotone from the anchor', () => {
    const w = writer();
    const written = [
      w.write(draft({ kind: 'board.arrived' })),
      w.write(draft({ kind: 'decision.begin' })),
      w.write(draft({ kind: 'partition', atWorkMs: 0 })),
      w.write(draft({ kind: 'emission', atWorkMs: 12 })),
    ];
    expect(written.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(w.written.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
  });

  it('never repeats a (gameId, turn, seq) under interleaved producers', () => {
    const w = writer();
    // A decision emitting, two operators commanding and the server resolving —
    // all through the ONE writer, in whatever order they arrive.
    const events: TurnEvent[] = [];
    for (let i = 0; i < 40; i++) {
      events.push(
        w.write(
          draft({
            kind: i % 4 === 0 ? 'emission' : i % 4 === 1 ? 'pin' : i % 4 === 2 ? 'operator.command' : 'movesets',
            actor: i % 4 === 0 || i % 4 === 3 ? BOT_ACTOR : operatorActor(i % 2 ? 'ada' : 'ben'),
            atWorkMs: i % 4 === 0 || i % 4 === 3 ? i : null,
          })
        )
      );
    }
    events.push(w.write(draft({ kind: 'turn.resolved' })));
    const keys = events.map((e) => `${e.gameId}:${e.turn}:${e.seq}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  });

  it('stamps the id as `${gameId}:${turn}:${seq}` and nothing else', () => {
    const w = writer();
    const e = w.write(draft({ kind: 'emission', atWorkMs: 4 }));
    expect(e.id).toBe(`${FIXTURE_GAME}:${TURN}:${e.seq}`);
  });

  it('gives a second turn its own sequence, starting again at 0', () => {
    const first = makeSeqWriter(FIXTURE_GAME, TURN);
    first.write(draft({ kind: 'board.arrived' }));
    first.write(draft({ kind: 'emission', atWorkMs: 1 }));
    const second = makeSeqWriter(FIXTURE_GAME, TURN + 1);
    const e = second.write(draft({ kind: 'board.arrived', turn: TURN + 1 }));
    expect(e.seq).toBe(0);
  });

  it('refuses an event for a turn it does not own', () => {
    const w = writer();
    expect(() => w.write(draft({ kind: 'emission', turn: TURN + 7 }))).toThrow();
  });
});

describe('`answers` names the operator event the emission responded to', () => {
  it('links an emission to the pin whose ConformanceSample measured it', () => {
    const w = writer();
    w.write(draft({ kind: 'board.arrived' }));
    const pin = w.write(
      draft({ kind: 'pin', actor: operatorActor('ada'), unit: 'A-A', payload: { unit: 'A-A', to: 20, tentative: false } })
    );
    const emission = w.write(
      draft({
        kind: 'emission',
        atWorkMs: 18,
        answers: pin.id,
        causedBy: null,
        payload: { planKey: 'plan:1' },
      })
    );
    expect(emission.answers).toBe(pin.id);
    // `answers` is NOT `causedBy`: an emission is caused by a slice boundary
    // and answers a pin (01 §5.3).
    expect(emission.causedBy).toBeNull();
  });

  it('is null on an emission no operator event provoked', () => {
    const w = writer();
    w.write(draft({ kind: 'board.arrived' }));
    expect(w.write(draft({ kind: 'emission', atWorkMs: 6 })).answers).toBeNull();
  });

  it('never names an event that has not been written yet', () => {
    const w = writer();
    w.write(draft({ kind: 'board.arrived' }));
    expect(() =>
      w.write(draft({ kind: 'emission', atWorkMs: 6, answers: `${FIXTURE_GAME}:${TURN}:99` }))
    ).toThrow();
  });
});

describe('atWorkMs is null, never zero, when unmeasured', () => {
  it('is null on events outside a decision', () => {
    const w = writer();
    const arrived = w.write(draft({ kind: 'board.arrived' }));
    const command = w.write(draft({ kind: 'operator.command', actor: operatorActor('ben') }));
    expect(arrived.atWorkMs).toBeNull();
    expect(command.atWorkMs).toBeNull();
  });

  it('preserves a genuine zero on the first frame of a decision', () => {
    const w = writer();
    w.write(draft({ kind: 'board.arrived' }));
    const first = w.write(draft({ kind: 'partition', atWorkMs: 0 }));
    expect(first.atWorkMs).toBe(0);
    expect(first.atWorkMs).not.toBeNull();
  });
});
