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

  // Navigate to a game's replay/live page. `turn` is optional: with it the
  // viewer opens AT that turn (replay-deeplink.js reads the fragment), which
  // is what makes a link out of history land on the moment the operator meant
  // rather than on the head of the game.
  function openGame(gameId, turn) {
    global.location.href = gameUrl(gameId, turn);
  }

  // The one place the viewer's URL shape is written down.
  function gameUrl(gameId, turn) {
    const base = '/game/' + encodeURIComponent(gameId);
    return Number.isFinite(turn) && turn >= 0 ? base + '#turn=' + Math.floor(turn) : base;
  }

  // A colour from an untrusted source (Firebase team data, a decision-log row)
  // on its way into a style attribute. Only plain CSS colour tokens pass;
  // anything else becomes a neutral grey rather than breaking out of the
  // attribute or silently rendering as nothing. Lived in play.html; history
  // needed the same rule and had none, which is why it is here.
  const COLOR_RE =
    /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/;
  function safeColor(c, fallback) {
    return typeof c === 'string' && COLOR_RE.test(c.trim()) ? c.trim() : (fallback || '#888');
  }

  // "just now" / "14m ago" / "3h ago" / "6d ago". An operator reads elapsed
  // time; a wall clock makes them subtract. Null-safe: nullish renders as ''.
  function fmtAgo(ts, now) {
    if (ts == null) return '';
    const ms = Math.max(0, (now == null ? Date.now() : now) - ts);
    if (ms < 10000) return 'just now';
    if (ms < 60000) return Math.floor(ms / 1000) + 's ago';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
    if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago';
    return Math.floor(ms / 86400000) + 'd ago';
  }

  const api = { escapeHtml, fmtTime, fmtDur, fmtAgo, openGame, gameUrl, safeColor };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.DomUtils = api;
    global.escapeHtml = escapeHtml;
    global.fmtTime = fmtTime;
    global.fmtDur = fmtDur;
    global.fmtAgo = fmtAgo;
    global.openGame = openGame;
    global.gameUrl = gameUrl;
    global.safeColor = safeColor;
  }
})(typeof window !== 'undefined' ? window : globalThis);
