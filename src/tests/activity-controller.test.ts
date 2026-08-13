/**
 * Awake-rule and managed-timer tests for the ActivityController — the single
 * owner of instance idleness and of every long-lived timer in the process.
 *
 * The awake rule under test (see idle-policy.ts):
 *   awake iff (now − lastHumanActionAt < IDLE_GRACE_MS)
 *          OR (a game is verifiably progressing
 *              AND now − lastHumanActionAt < GAME_HUMAN_ATTENTION_CAP_MS)
 * with boot seeding the clock. Fake timers throughout (modern fake timers
 * drive Date.now too); pure-time transitions land via the controller's
 * internal evaluation sweep.
 */

import { ActivityController, transientDelay, transientInterval, transientTimeout } from '../server/activity-controller';
import { GAME_HUMAN_ATTENTION_CAP_MS, IDLE_GRACE_MS } from '../shared/idle-policy';

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

/** Controller with one game-progress source whose value the test flips. */
function controllerWithGame(progressing: boolean) {
  const controller = new ActivityController();
  const game = { progressing };
  controller.registerSource('running-games', () => game.progressing);
  return { controller, game };
}

describe('awake rule matrix', () => {
  test('boot with no human interaction suspends after the grace window', () => {
    const { controller } = controllerWithGame(false);
    expect(controller.getState()).toBe('active');

    jest.advanceTimersByTime(IDLE_GRACE_MS - 5000);
    expect(controller.getState()).toBe('active');
    jest.advanceTimersByTime(5000);
    expect(controller.getState()).toBe('idle');
  });

  test('a progressing game plus recent human action stays awake', () => {
    const { controller } = controllerWithGame(true);
    controller.recordHumanAction();

    // Human keeps touching a page every ~5 minutes: never idles.
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(controller.getState()).toBe('active');
      controller.recordHumanAction();
    }
    expect(controller.getState()).toBe('active');
  });

  test('a game with 11 minutes of human silence suspends mid-game (absolute cap)', () => {
    const { controller, game } = controllerWithGame(true);
    controller.recordHumanAction();

    jest.advanceTimersByTime(GAME_HUMAN_ATTENTION_CAP_MS - 5000);
    expect(controller.getState()).toBe('active'); // game branch holds it awake
    jest.advanceTimersByTime(65 * 1000); // past the 10-minute cap
    expect(controller.getState()).toBe('idle');
    expect(game.progressing).toBe(true); // the game never stopped — the cap won
  });

  test('a broken room (stuck game) with only an untouched tab suspends after grace', () => {
    // The stuck game's progress predicate is false (no turn advance, deadline
    // long past); the connected tab contributes nothing (no recordHumanAction).
    const { controller } = controllerWithGame(false);

    jest.advanceTimersByTime(IDLE_GRACE_MS);
    expect(controller.getState()).toBe('idle');
  });

  test('a human action resets the 10-minute game clock', () => {
    const { controller } = controllerWithGame(true);
    controller.recordHumanAction();

    jest.advanceTimersByTime(9 * 60 * 1000);
    expect(controller.getState()).toBe('active');
    controller.recordHumanAction(); // 1 minute before the cap: clock resets

    jest.advanceTimersByTime(9 * 60 * 1000);
    expect(controller.getState()).toBe('active'); // 18 min after the first action
    jest.advanceTimersByTime(GAME_HUMAN_ATTENTION_CAP_MS - 9 * 60 * 1000);
    expect(controller.getState()).toBe('idle'); // cap after the LAST action
  });

  test('an untouched connected tab never counts: poke() alone neither wakes nor extends', () => {
    const { controller } = controllerWithGame(false);

    // Repeated pokes (the most a connect/subscribe could do) do not extend.
    jest.advanceTimersByTime(IDLE_GRACE_MS / 2);
    controller.poke();
    jest.advanceTimersByTime(IDLE_GRACE_MS / 2);
    expect(controller.getState()).toBe('idle');

    // While idle, pokes do not wake either — only a human action does.
    controller.poke();
    expect(controller.getState()).toBe('idle');
    controller.recordHumanAction();
    expect(controller.getState()).toBe('active');
  });

  test('a game cannot wake the instance once the human-attention cap has passed', () => {
    const { controller, game } = controllerWithGame(false);
    jest.advanceTimersByTime(GAME_HUMAN_ATTENTION_CAP_MS + 5000);
    expect(controller.getState()).toBe('idle');

    game.progressing = true; // no human in over 10 minutes
    controller.poke();
    expect(controller.getState()).toBe('idle'); // only a human action wakes now
  });

  test('a game appearing while idle but within the cap re-extends wakefulness (suspension race)', () => {
    // The awake rule is a pure predicate: a game that lands just as we
    // suspend (invite replay racing suspension) brings the instance back for
    // the remainder of the 10-minute human-attention window — self-limiting,
    // because the cap still bounds it.
    const { controller, game } = controllerWithGame(false);
    jest.advanceTimersByTime(IDLE_GRACE_MS + 10_000);
    expect(controller.getState()).toBe('idle');

    game.progressing = true;
    controller.poke();
    expect(controller.getState()).toBe('active'); // boot anchor still within the cap

    jest.advanceTimersByTime(GAME_HUMAN_ATTENTION_CAP_MS);
    expect(controller.getState()).toBe('idle'); // …and the cap ends it
  });

  test('a game holds the instance awake past the grace window (within the cap) with zero clients', () => {
    // The deliberate D1 behavior change: a running game keeps the instance
    // awake headless after the last human action, up to the cap.
    const { controller, game } = controllerWithGame(true);
    controller.recordHumanAction();

    jest.advanceTimersByTime(IDLE_GRACE_MS + 60 * 1000); // 2 min in
    expect(controller.getState()).toBe('active');

    game.progressing = false; // game ends
    controller.poke();
    expect(controller.getState()).toBe('idle'); // grace long past, no game left
  });

  test('idle entry and wake each emit exactly once per transition', () => {
    const { controller } = controllerWithGame(false);
    const events: string[] = [];
    controller.onIdle('probe', () => { events.push('idle'); });
    controller.onWake('probe', () => { events.push('wake'); });

    jest.advanceTimersByTime(IDLE_GRACE_MS * 3); // many sweeps while idle
    controller.poke();
    controller.poke();
    expect(events).toEqual(['idle']);

    controller.recordHumanAction();
    controller.recordHumanAction(); // already awake: no second wake
    expect(events).toEqual(['idle', 'wake']);

    jest.advanceTimersByTime(IDLE_GRACE_MS * 3);
    expect(events).toEqual(['idle', 'wake', 'idle']);
  });

  test('a human action inside the grace window extends it (no idle blip)', () => {
    const { controller } = controllerWithGame(false);
    const events: string[] = [];
    controller.onIdle('probe', () => { events.push('idle'); });

    jest.advanceTimersByTime(IDLE_GRACE_MS - 10_000);
    controller.recordHumanAction();
    jest.advanceTimersByTime(IDLE_GRACE_MS - 10_000);
    expect(controller.getState()).toBe('active');
    expect(events).toEqual([]);
    jest.advanceTimersByTime(15_000);
    expect(controller.getState()).toBe('idle');
  });

  test('subscribers fire in registration order; a throwing subscriber does not break the chain', () => {
    const { controller } = controllerWithGame(false);
    const order: string[] = [];
    controller.onIdle('first', () => { order.push('idle:first'); });
    controller.onIdle('boom', () => { order.push('idle:boom'); throw new Error('boom'); });
    controller.onIdle('last', () => { order.push('idle:last'); });
    controller.onWake('first', () => { order.push('wake:first'); });
    controller.onWake('last', () => { order.push('wake:last'); });

    jest.advanceTimersByTime(IDLE_GRACE_MS);
    controller.recordHumanAction();

    expect(order).toEqual(['idle:first', 'idle:boom', 'idle:last', 'wake:first', 'wake:last']);
  });

  test('a throwing game-progress source counts as progressing (never tears down on a broken signal)', () => {
    const controller = new ActivityController();
    controller.registerSource('broken', () => { throw new Error('bad source'); });
    controller.recordHumanAction();

    jest.advanceTimersByTime(IDLE_GRACE_MS + 60_000);
    expect(controller.getState()).toBe('active'); // within the cap, source "active"
    jest.advanceTimersByTime(GAME_HUMAN_ATTENTION_CAP_MS);
    expect(controller.getState()).toBe('idle'); // the cap still bounds it
  });
});

describe('managed timers', () => {
  function idleAfterGrace() {
    const controller = new ActivityController();
    return controller;
  }

  test("scope 'while-active' interval pauses at idle entry and resumes on wake", () => {
    const controller = idleAfterGrace();
    let ticks = 0;
    controller.managedInterval('t', () => { ticks++; }, 1000, { scope: 'while-active' });

    jest.advanceTimersByTime(30_000);
    expect(ticks).toBe(30);

    jest.advanceTimersByTime(IDLE_GRACE_MS - 30_000); // grace expires → idle
    expect(controller.getState()).toBe('idle');
    const atIdle = ticks;
    jest.advanceTimersByTime(60_000); // a minute of idle: no ticks
    expect(ticks).toBe(atIdle);

    controller.recordHumanAction(); // wake resumes with a fresh full period
    jest.advanceTimersByTime(2000);
    expect(ticks).toBe(atIdle + 2);
  });

  test("scope 'always' interval keeps ticking through idle (liveness heartbeat contract)", () => {
    const controller = idleAfterGrace();
    let ticks = 0;
    controller.managedInterval('t', () => { ticks++; }, 1000, { scope: 'always' });

    jest.advanceTimersByTime(IDLE_GRACE_MS);
    expect(controller.getState()).toBe('idle');
    const atIdle = ticks;
    jest.advanceTimersByTime(5000);
    expect(ticks).toBe(atIdle + 5);
  });

  test("'while-active' interval created while idle starts paused and arms on wake", () => {
    const controller = idleAfterGrace();
    jest.advanceTimersByTime(IDLE_GRACE_MS);
    expect(controller.getState()).toBe('idle');

    let ticks = 0;
    controller.managedInterval('late', () => { ticks++; }, 1000, { scope: 'while-active' });
    jest.advanceTimersByTime(10_000);
    expect(ticks).toBe(0);

    controller.recordHumanAction();
    jest.advanceTimersByTime(3000);
    expect(ticks).toBe(3);
  });

  test("'while-active' timeout pauses at idle with its remaining delay preserved across wake", () => {
    const controller = idleAfterGrace();
    let fired = 0;
    controller.managedTimeout('t', () => { fired++; }, IDLE_GRACE_MS + 10_000, { scope: 'while-active' });

    jest.advanceTimersByTime(IDLE_GRACE_MS); // idle at 60s: 10s remaining
    expect(controller.getState()).toBe('idle');
    expect(fired).toBe(0);
    jest.advanceTimersByTime(60_000); // idle time doesn't consume the delay
    expect(fired).toBe(0);

    controller.recordHumanAction();
    jest.advanceTimersByTime(9_999);
    expect(fired).toBe(0);
    jest.advanceTimersByTime(1);
    expect(fired).toBe(1);
  });

  test('handle.clear() stops a managed interval and is idempotent', () => {
    const controller = idleAfterGrace();
    let ticks = 0;
    const handle = controller.managedInterval('t', () => { ticks++; }, 1000, { scope: 'always' });
    jest.advanceTimersByTime(2000);
    handle.clear();
    handle.clear();
    jest.advanceTimersByTime(5000);
    expect(ticks).toBe(2);
  });

  test('a fired managed timeout does not resurrect on wake', () => {
    const controller = idleAfterGrace();
    let fired = 0;
    controller.managedTimeout('t', () => { fired++; }, 1000, { scope: 'while-active' });
    jest.advanceTimersByTime(1000);
    expect(fired).toBe(1);

    jest.advanceTimersByTime(IDLE_GRACE_MS);
    expect(controller.getState()).toBe('idle');
    controller.recordHumanAction();
    jest.advanceTimersByTime(60_000);
    expect(fired).toBe(1);
  });
});

describe('shutdown orchestration', () => {
  test('runs steps sequentially in registration order and is idempotent', async () => {
    const controller = new ActivityController();
    const order: string[] = [];
    controller.onShutdown('a', async (reason) => {
      order.push(`a:${reason}:start`);
      await Promise.resolve();
      order.push('a:end');
    });
    controller.onShutdown('b', () => { order.push('b'); });

    const p1 = controller.shutdown('SIGTERM');
    const p2 = controller.shutdown('SIGINT'); // second call joins the first
    expect(p2).toBe(p1);
    await p1;

    expect(order).toEqual(['a:SIGTERM:start', 'a:end', 'b']);

    await controller.shutdown('again');
    expect(order).toEqual(['a:SIGTERM:start', 'a:end', 'b']); // no re-run
  });

  test('a failing step does not block later steps', async () => {
    const controller = new ActivityController();
    const order: string[] = [];
    controller.onShutdown('boom', () => { throw new Error('boom'); });
    controller.onShutdown('rejects', async () => { throw new Error('async boom'); });
    controller.onShutdown('after', () => { order.push('after'); });

    await controller.shutdown();
    expect(order).toEqual(['after']);
  });

  test('shutdown stops managed timers and the evaluation sweep; later pokes are ignored', async () => {
    const controller = new ActivityController();
    let ticks = 0;
    const idleEvents: string[] = [];
    controller.managedInterval('t', () => { ticks++; }, 1000, { scope: 'always' });
    controller.onIdle('probe', () => { idleEvents.push('idle'); });

    await controller.shutdown();

    jest.advanceTimersByTime(IDLE_GRACE_MS * 2);
    expect(ticks).toBe(0); // managed interval never ticked after shutdown
    expect(idleEvents).toEqual([]); // the sweep never drove an idle entry

    controller.poke();
    controller.recordHumanAction();
    expect(controller.getState()).toBe('active'); // state frozen; no emissions
    expect(idleEvents).toEqual([]);
  });
});

describe('transient wrappers', () => {
  test('transientTimeout fires once and is clearable', () => {
    let fired = 0;
    const t = transientTimeout(() => { fired++; }, 500);
    jest.advanceTimersByTime(499);
    expect(fired).toBe(0);
    jest.advanceTimersByTime(1);
    expect(fired).toBe(1);

    const t2 = transientTimeout(() => { fired++; }, 500);
    clearTimeout(t2);
    jest.advanceTimersByTime(1000);
    expect(fired).toBe(1);
    clearTimeout(t);
  });

  test('transientInterval ticks until cleared', () => {
    let ticks = 0;
    const t = transientInterval(() => { ticks++; }, 100);
    jest.advanceTimersByTime(350);
    expect(ticks).toBe(3);
    clearInterval(t);
    jest.advanceTimersByTime(350);
    expect(ticks).toBe(3);
  });

  test('transientDelay resolves after the given time', async () => {
    let resolved = false;
    const p = transientDelay(200).then(() => { resolved = true; });
    jest.advanceTimersByTime(199);
    await Promise.resolve();
    expect(resolved).toBe(false);
    jest.advanceTimersByTime(1);
    await p;
    expect(resolved).toBe(true);
  });
});
