/**
 * THE SHARED CHROME FOR THE SECONDARY SCREENS.
 *
 * One header on /play, /history, /config, /activity and /connection-debug:
 * brand, the page's own name, the same nav everywhere with a `you are here`
 * mark, and status chips on the RIGHT — where the eye already passes on the
 * way to the nav — instead of health living only in the bottom-left corner
 * (docs/design/ux/01-RESEARCH.md #7, #10).
 *
 * It also owns the keyboard for these pages, so the affordances are the same
 * from screen to screen and consistent with the live view:
 *
 *   Ctrl+/ (or ?)   the key sheet — the same chord play-game.html uses
 *   p h c a d       go to play / history / config / activity / debug
 *   /               focus the page's filter, where it has one
 *   ↑ ↓ Enter       move and open the selected row      (list pages)
 *   1..9            open the nth row                    (list pages)
 *   Esc             clear the filter / close the sheet
 *
 * NO NEW NETWORK. The Firebase chip is fed by the ONE status object
 * `firebase-status-banner.js` already fetches (one GET on load, one on
 * visibilitychange, plus live pushes over a socket where there is one) — this
 * file never polls, because a poll from an open tab is what holds the
 * autoscale instance up (see idle-watcher.js). The socket chip is a mirror of
 * whatever the page's own connection state already is; on a page with no
 * socket it says so rather than implying freshness it does not have.
 */
(function (global) {
  'use strict';

  var PAGES = [
    { key: 'play', href: '/play', label: 'Play', title: 'Play', accel: 'p' },
    { key: 'history', href: '/history', label: 'History', title: 'History', accel: 'h' },
    { key: 'config', href: '/config', label: 'Config', title: 'Config', accel: 'c' },
    { key: 'activity', href: '/activity', label: 'Activity', title: 'Activity', accel: 'a' },
    { key: 'debug', href: '/connection-debug', label: 'Debug', title: 'Connection debug', accel: 'd' },
  ];

  var esc = (global.DomUtils && global.DomUtils.escapeHtml) ||
    function (s) { return String(s == null ? '' : s); };

  var current = null;      // the PAGES entry for this document
  var statusEl = null;     // the chip row
  var chips = {};          // key -> element
  var extraKeys = [];      // page-registered handlers
  var listState = null;    // set up by PageChrome.list()

  /* ── The chips ──────────────────────────────────────────────────────────
   * A chip is a GLYPH plus a WORD plus a brightness. The glyph is what a
   * glance resolves; the hue only reinforces it, so the reading survives any
   * colour vision (01-RESEARCH #17).
   */
  var GLYPH = { ok: '●', warn: '◐', bad: '✕', unknown: '○' };

  function chip(key, tone, word, title, href) {
    if (!statusEl) return null;
    var el = chips[key];
    if (!el) {
      el = document.createElement(href ? 'a' : 'span');
      if (href) el.href = href;
      el.className = 'chip';
      el.innerHTML = '<span class="glyph"></span><span class="word"></span>';
      statusEl.appendChild(el);
      chips[key] = el;
    }
    el.className = 'chip chip-' + tone;
    el.querySelector('.glyph').textContent = GLYPH[tone] || GLYPH.unknown;
    el.querySelector('.word').textContent = word;
    el.title = title || word;
    return el;
  }

  var FB_TONE = {
    connected: 'ok', connecting: 'warn', suspended: 'warn',
    error: 'bad', not_configured: 'bad',
  };
  var FB_WORD = {
    connected: 'Firebase', connecting: 'Firebase…', suspended: 'Firebase paused',
    error: 'Firebase down', not_configured: 'Firebase unset',
  };

  function setFirebase(status) {
    if (!status || typeof status !== 'object') return;
    var tone = FB_TONE[status.state] || 'unknown';
    var since = status.since ? new Date(status.since).toLocaleTimeString() : null;
    chip(
      'firebase', tone, FB_WORD[status.state] || 'Firebase ?',
      (status.error || 'Firebase interface: ' + status.state) +
        (since ? ' (since ' + since + ')' : '')
    );
  }

  var SOCK_TONE = {
    connected: 'ok', active: 'ok',
    connecting: 'warn', reconnecting: 'warn', idle: 'warn', suspended: 'warn',
    disconnected: 'bad', error: 'bad',
  };

  /** Mirror of the page's own connection state. Pages with no socket call
   *  setSocketAbsent() instead, because "nothing drawn" would read as
   *  "healthy" and that is the one thing a status must never do. */
  function setSocket(state, label) {
    var el = chip('socket', SOCK_TONE[state] || 'unknown', label || state,
      'This page’s live link to the centaur server — click for the WS debugger');
    // The corner bubble was the entry point to the WS debugger panel; the chip
    // inherits that, so consolidating the two readings loses no affordance.
    if (el && !el.dataset.wired) {
      el.dataset.wired = '1';
      el.style.cursor = 'pointer';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      var open = function () { if (global.WSDebuggerPanel) global.WSDebuggerPanel.toggle(); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    }
  }
  function setSocketAbsent(why) {
    chip('socket', 'unknown', 'No live link',
      why || 'This page reads on load only — it holds no socket, so it ' +
      'cannot report freshness and does not pretend to.');
  }

  /* ── The header ────────────────────────────────────────────────────────── */

  function buildHeader() {
    var header = document.querySelector('.header');
    if (!header) {
      header = document.createElement('div');
      header.className = 'header';
      document.body.insertBefore(header, document.body.firstChild);
      // Pages that had no fixed header did not reserve room for one.
      if (!document.body.style.paddingTop) document.body.style.paddingTop = '60px';
    }
    var title = (current && current.title) ||
      (document.querySelector('.header h1') || {}).textContent || '';

    header.innerHTML =
      '<a class="brand" href="/play">' +
        '<span class="brand-mark">Centaur</span>' +
        '<span class="brand-page">' + esc(title) + '</span>' +
      '</a>' +
      '<nav class="nav-links" aria-label="Screens"></nav>' +
      '<div class="chrome-status" role="status" aria-live="polite"></div>';

    var nav = header.querySelector('.nav-links');
    PAGES.forEach(function (p) {
      var a = document.createElement('a');
      a.href = p.href;
      a.textContent = p.label;
      a.title = p.title + '  (' + p.accel + ')';
      if (current && p.key === current.key) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });
    statusEl = header.querySelector('.chrome-status');
    chips = {};
  }

  /* ── The key sheet ─────────────────────────────────────────────────────── */

  var sheet = null;
  function buildSheet(rows) {
    sheet = document.createElement('div');
    sheet.className = 'keysheet-backdrop';
    var dl = rows.map(function (r) {
      return '<dt><kbd>' + esc(r[0]) + '</kbd></dt><dd>' + esc(r[1]) + '</dd>';
    }).join('');
    sheet.innerHTML =
      '<div class="keysheet" role="dialog" aria-label="Keyboard shortcuts">' +
      '<h2>Keys on this screen</h2><dl>' + dl + '</dl>' +
      '<div class="foot">The live game view keeps its own keys; ' +
      '<kbd>Ctrl</kbd>+<kbd>/</kbd> opens the list there too.</div></div>';
    sheet.addEventListener('pointerdown', function (e) {
      if (e.target === sheet) toggleSheet(false);
    });
    document.body.appendChild(sheet);
  }
  function toggleSheet(open) {
    if (!sheet) return;
    var next = open === undefined ? !sheet.classList.contains('open') : open;
    sheet.classList.toggle('open', next);
  }

  function baseKeyRows() {
    var rows = [['Ctrl + /', 'this list']];
    PAGES.forEach(function (p) { rows.push([p.accel, 'go to ' + p.label]); });
    if (listState) {
      rows.push(['/', 'filter the list']);
      rows.push(['↑ ↓', 'move the selection']);
      rows.push(['Enter', 'open the selected row']);
      rows.push(['1 … 9', 'open that row directly']);
      rows.push(['Esc', 'clear the filter']);
    }
    extraKeys.forEach(function (k) { if (k.help) rows.push(k.help); });
    return rows;
  }

  /* ── Keyboard ──────────────────────────────────────────────────────────── */

  function typing(e) {
    var t = e.target;
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  function onKey(e) {
    // Ctrl+/ (Cmd+/ on a Mac), matched on e.code too because a layout where
    // '/' needs a modifier reports a different e.key for the same key. Same
    // rule play-game.html uses, so the chord is one thing across the product.
    if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key === '?' || e.code === 'Slash')) {
      e.preventDefault();
      toggleSheet();
      return;
    }
    if (e.key === 'Escape') {
      if (sheet && sheet.classList.contains('open')) { toggleSheet(false); return; }
      if (listState && listState.filterEl) {
        if (listState.filterEl.value !== '') {
          listState.filterEl.value = '';
          listState.onFilter('');
        }
        listState.filterEl.blur();
      }
      return;
    }
    if (typing(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === '?') { e.preventDefault(); toggleSheet(); return; }

    if (e.key === '/' && listState && listState.filterEl) {
      e.preventDefault();
      listState.filterEl.focus();
      listState.filterEl.select();
      return;
    }

    for (var i = 0; i < extraKeys.length; i++) {
      if (extraKeys[i].match(e)) { e.preventDefault(); extraKeys[i].run(e); return; }
    }

    if (listState) {
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveSelection(1); return; }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); moveSelection(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); openSelection(); return; }
      if (e.key >= '1' && e.key <= '9') {
        var items = listState.items();
        var hit = items[Number(e.key) - 1];
        if (hit) { e.preventDefault(); listState.open(hit); }
        return;
      }
    }

    for (var j = 0; j < PAGES.length; j++) {
      if (e.key === PAGES[j].accel) {
        if (current && PAGES[j].key === current.key) return;
        e.preventDefault();
        global.location.href = PAGES[j].href;
        return;
      }
    }
  }

  /* ── The list idiom (used by /play and /history) ───────────────────────── */

  function moveSelection(delta) {
    var items = listState.items();
    if (items.length === 0) return;
    var idx = items.indexOf(listState.selected);
    idx = idx < 0 ? (delta > 0 ? 0 : items.length - 1) : idx + delta;
    idx = Math.max(0, Math.min(items.length - 1, idx));
    select(items[idx]);
  }

  function select(el) {
    var items = listState.items();
    items.forEach(function (it) { it.removeAttribute('aria-selected'); });
    if (!el) { listState.selected = null; return; }
    el.setAttribute('aria-selected', 'true');
    listState.selected = el;
    // `nearest` and never `center`: the row under the eye must not jump when
    // it is already on screen (01-RESEARCH P3).
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function openSelection() {
    var el = listState.selected || listState.items()[0];
    if (el) listState.open(el);
  }

  /**
   * Wire a page's list to the shared keyboard.
   *   opts.container  the element holding the rows
   *   opts.itemSel    CSS selector for a row (visible ones only are counted)
   *   opts.filterEl   the filter input, optional
   *   opts.onFilter   called with the trimmed filter text
   *   opts.open       called with a row element to open it
   */
  function list(opts) {
    listState = {
      container: opts.container,
      itemSel: opts.itemSel,
      filterEl: opts.filterEl || null,
      onFilter: opts.onFilter || function () {},
      open: opts.open || function (el) { if (el.href) global.location.href = el.href; },
      selected: null,
      items: function () {
        return Array.prototype.filter.call(
          opts.container.querySelectorAll(opts.itemSel),
          function (el) { return el.offsetParent !== null; }
        );
      },
    };
    if (listState.filterEl) {
      listState.filterEl.addEventListener('input', function () {
        listState.onFilter(listState.filterEl.value.trim());
        select(null);
      });
    }
    opts.container.addEventListener('pointerdown', function (e) {
      var row = e.target.closest && e.target.closest(opts.itemSel);
      if (row) select(row);
    });
    rebuildSheet();
    return { select: select, selected: function () { return listState.selected; } };
  }

  /** Register a page-specific key. `help` is [key, meaning] for the sheet. */
  function key(match, run, help) {
    extraKeys.push({ match: match, run: run, help: help });
    rebuildSheet();
  }

  function rebuildSheet() {
    if (sheet) { sheet.remove(); sheet = null; }
    buildSheet(baseKeyRows());
  }

  /* ── Boot ──────────────────────────────────────────────────────────────── */

  function init() {
    var path = global.location.pathname.replace(/\/+$/, '') || '/play';
    current = PAGES.find(function (p) { return p.href === path; }) || null;
    buildHeader();
    rebuildSheet();
    document.addEventListener('keydown', onKey);
    // The Firebase chip picks up whatever the banner already knows or learns.
    if (global.FirebaseStatusBanner && global.FirebaseStatusBanner.subscribe) {
      global.FirebaseStatusBanner.subscribe(setFirebase);
    } else {
      chip('firebase', 'unknown', 'Firebase ?', 'Status not fetched yet');
    }
  }

  global.PageChrome = {
    init: init,
    list: list,
    key: key,
    chip: chip,
    setFirebase: setFirebase,
    setSocket: setSocket,
    setSocketAbsent: setSocketAbsent,
    toggleSheet: toggleSheet,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
