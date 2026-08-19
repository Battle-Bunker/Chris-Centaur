/**
 * Shared DOM/formatting helpers for the web pages.
 *
 * Shared between the browser pages (via <script src="/dom-utils.js">, loaded
 * BEFORE any script that uses them) and the Jest unit tests
 * (src/tests/dom-utils.test.ts, via require) — the single source of truth for
 * HTML escaping and the debug-timestamp/duration formats. Replaces the six
 * per-page escapeHtml copies (one of which, play-game's, was NOT null-safe)
 * and the fmtTime/fmtDur pair duplicated between connection-debug.js and
 * connection-debug.html.
 *
 * Note: activity.html keeps its own coarse d/h/m/s duration formatter
 * (fmtDurCoarse) — that one buckets to whole units for timeline labels and is
 * semantically different from the millisecond-precision fmtDur here.
 *
 * In the browser the helpers are exposed both under the DomUtils namespace and
 * as bare globals, so inline handlers (onclick="openGame(...)") and existing
 * call sites work unchanged.
 */
(function (global) {
  'use strict';

  // Null-safe: null/undefined render as ''. Everything else is stringified
  // and HTML-escaped.
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // Local wall-clock time with millisecond precision, e.g. "14:03:07.482".
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour12: false }) + '.' +
      String(d.getMilliseconds()).padStart(3, '0');
  }

  // Millisecond-precision duration: "742ms", "3.5s", "2m 17s". Null-safe:
  // null/undefined render as ''.
  function fmtDur(ms) {
    if (ms == null) return '';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return m + 'm ' + s + 's';
  }

  // Navigate to a game's replay/live page.
  function openGame(gameId) {
    global.location.href = '/game/' + encodeURIComponent(gameId);
  }

  const api = { escapeHtml, fmtTime, fmtDur, openGame };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.DomUtils = api;
    global.escapeHtml = escapeHtml;
    global.fmtTime = fmtTime;
    global.fmtDur = fmtDur;
    global.openGame = openGame;
  }
})(typeof window !== 'undefined' ? window : globalThis);
