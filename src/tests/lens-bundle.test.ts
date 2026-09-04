/**
 * THE BROWSER'S COPY OF THE LENS IS THE LENS.
 *
 * `src/web/lens-view.js` is generated from `src/lens/view/**`. A generated
 * artifact in the tree is only legitimate when something asserts it still
 * matches its source — that is the rule the vendored engine lives by, and the
 * rule `command_turn_states` broke by materialising a view nothing checked.
 *
 * The stakes here are Law C. If the page ran a second, hand-written fold, live
 * play and replay would be two state machines that agree until they don't, and
 * this whole exercise is about a fork that drifted exactly that way. So the
 * page runs the same module the boundary tests run, and this file is what
 * makes "the same" true rather than intended.
 *
 * It also checks the surface the page actually calls, because a bundle that
 * builds and exports nothing the caller names is a bundle that fails silently
 * at 3am in a browser nobody is watching.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const BUNDLE = join(ROOT, 'src', 'web', 'lens-view.js');
const BUILDER = join(ROOT, 'scripts', 'build-lens-view.js');

describe('the checked-in bundle matches its source', () => {
  it('rebuilds byte-identically', () => {
    // The builder's own --check does the comparison and exits non-zero on
    // drift, so the failure names the fix rather than printing 35 KB of diff.
    expect(() =>
      execFileSync(process.execPath, [BUILDER, '--check'], { cwd: ROOT, stdio: 'pipe' })
    ).not.toThrow();
  });

  it('says it is generated, in its first line', () => {
    const source = readFileSync(BUNDLE, 'utf8');
    expect(source.slice(0, 400)).toContain('GENERATED — do not edit');
    expect(source.slice(0, 400)).toContain('npm run build:lens');
  });
});

describe('the bundle exposes exactly what the page calls', () => {
  const loaded = (() => {
    const source = readFileSync(BUNDLE, 'utf8');
    const host: { LensView?: Record<string, unknown> } = {};
    // The bundle is an IIFE that assigns a global; evaluate it against a
    // stand-in window rather than the test's own scope.
    new Function('window', `${source}\n window.LensView = LensView;`)(host);
    return host.LensView as Record<string, unknown>;
  })();

  // Every name `play-game.html` reaches for through `window.LensView`. A page
  // that calls a missing one fails in the browser and nowhere else.
  const CALLED_BY_THE_PAGE = [
    'frameAtSeq',
    'renderFrame',
    'initialCursor',
    'applyCursorEvent',
    'resolveCursor',
    'rowTrails',
    'reactiveNotice',
    'planLock',
    'checkDivergence',
    'clusterOf',
    'rowsFor',
    // The badge component and the replay entry point: the page calls both
    // now, which is what stops a replayed turn claiming it is scrubbed.
    'replayFrameAtSeq',
    'modeBadge',
    'provenanceBadge',
    'emptyStateLine',
  ];

  it.each(CALLED_BY_THE_PAGE)('exports %s', (name) => {
    expect(typeof loaded[name]).toBe('function');
  });

  it('carries the cursor machine, not a copy of it', () => {
    // A trivial end-to-end walk through the bundled machine: the cursor starts
    // empty and the state machine is the one the boundary tests drive.
    const cursor = (loaded.initialCursor as () => Record<string, unknown>)();
    expect(cursor).toEqual({
      unit: null,
      candidate: null,
      moveset: null,
      drill: null,
      foil: 'off',
      explicit: { candidate: false, moveset: false, drill: false },
    });
    expect((loaded.cursorState as (c: unknown) => string)(cursor)).toBe('NONE');
  });

  it('refuses a determination off the head, in the browser too', () => {
    const frame = { at: { seq: 4, isHead: false }, partition: [], movesets: {} };
    const cursor = (loaded.initialCursor as () => unknown)();
    expect(() => (loaded.planLock as (f: unknown, c: unknown) => unknown)(frame, cursor)).toThrow(
      /live head/
    );
  });
});
