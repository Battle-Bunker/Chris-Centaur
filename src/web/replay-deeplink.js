/**
 * A TURN, ADDRESSABLE — `#turn=<n>` on the game viewer.
 *
 * The operator's journey out of `/history` is "open THAT moment", and before
 * this the viewer had no URL state at all: every path into the lens landed on
 * the head and cost a scrub (docs/design/ux/04-SECONDARY-SCREENS.md F3). This
 * gives the viewer three things and touches nothing else in it:
 *
 *   1. `#turn=<n>` on arrival — once the page's own turn domain exists, ONE
 *      scrub is committed to that turn, through `commitScrub`, which is the
 *      single coalesced commit path every other entry point already uses. No
 *      second way to move the playhead is introduced.
 *   2. the fragment is kept in step with the playhead thereafter
 *      (`replaceState`, never `pushState` — a scrub is not a navigation and
 *      must not fill the Back button), so the URL in the address bar is always
 *      the turn on screen and is always pasteable.
 *   3. the last turn viewed per game is remembered in `localStorage`, which is
 *      what `/history` offers back as `resume at turn K`.
 *
 * It reads the viewer's state and calls one of its functions; it never writes
 * that state itself. `viewMode`, `liveMaxTurn` and `historicTurnNumber` are
 * top-level `let` bindings of the page's classic script and `commitScrub` is a
 * top-level function declaration, so both are reachable from here — and if the
 * viewer ever renames them this file degrades to doing nothing rather than to
 * doing something wrong.
 */
(function (global) {
  'use strict';

  var KEY = 'centaur.lastTurn';       // { [gameId]: turn }
  var POLL_MS = 250;                  // the playhead is a human's, not a frame's
  var GIVE_UP_MS = 20000;             // a game with no turns is not a failure

  function gameIdOf() {
    var parts = global.location.pathname.split('/');
    try { return decodeURIComponent(parts[2] || ''); } catch (e) { return parts[2] || ''; }
  }

  function wantedTurn() {
    var m = /(?:^|[#&])turn=(\d+)/.exec(global.location.hash || '');
    return m ? parseInt(m[1], 10) : null;
  }

  /** The viewer's playhead, or null when the page has not defined one yet. */
  function playhead() {
    try {
      if (typeof viewMode === 'undefined' || typeof liveMaxTurn === 'undefined') return null;
      if (viewMode === 'historic') {
        return typeof historicTurnNumber === 'undefined' ? null : historicTurnNumber;
      }
      return liveMaxTurn;
    } catch (e) {
      return null;
    }
  }

  function maxTurn() {
    try { return typeof liveMaxTurn === 'undefined' ? null : liveMaxTurn; } catch (e) { return null; }
  }

  function readStore() {
    try { return JSON.parse(global.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  /** Where an operator last was in this game. Read by /history. */
  function lastTurnFor(id) {
    var v = readStore()[id];
    return typeof v === 'number' && v >= 0 ? v : null;
  }

  function remember(id, turn) {
    if (!id || !Number.isFinite(turn)) return;
    try {
      var all = readStore();
      if (all[id] === turn) return;
      all[id] = turn;
      // Bounded: the fifty most recent games, in insertion order, so a long-
      // lived browser profile does not accumulate a row per game forever.
      var keys = Object.keys(all);
      while (keys.length > 50) { delete all[keys.shift()]; }
      global.localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) { /* private mode / quota — the feature is a convenience */ }
  }

  function start() {
    var id = gameIdOf();
    if (!id) return;
    var target = wantedTurn();
    var applied = target === null;
    var startedAt = Date.now();
    var lastWritten = null;

    setInterval(function () {
      var head = playhead();
      if (head === null) return;

      if (!applied) {
        var max = maxTurn();
        // Wait for a turn domain wide enough to hold the request. A game whose
        // log only reaches turn 12 gets turn 12, not an error and not silence.
        if (max === null || (max < target && Date.now() - startedAt < GIVE_UP_MS)) return;
        applied = true;
        if (typeof global.commitScrub === 'function') {
          try { global.commitScrub(Math.min(target, max)); } catch (e) { /* viewer moved on */ }
        }
        return;
      }

      if (head !== lastWritten) {
        lastWritten = head;
        remember(id, head);
        var hash = '#turn=' + head;
        if (global.location.hash !== hash) {
          try {
            global.history.replaceState(null, '', global.location.pathname + hash);
          } catch (e) { /* some embeddings refuse replaceState; the view is fine */ }
        }
      }
    }, POLL_MS);
  }

  var api = { lastTurnFor: lastTurnFor, storageKey: KEY };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ReplayDeepLink = api;
    // Only the viewer runs the sync loop; /history loads this file purely for
    // `lastTurnFor`, and starting a poll there would be a timer for nothing.
    if (/^\/(game|play)\/[^/]+/.test(global.location.pathname)) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
      } else {
        start();
      }
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
