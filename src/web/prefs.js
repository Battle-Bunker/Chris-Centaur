/**
 * THE PREFERENCE STORE — one schema, one key, one popover.
 *
 * Six passes each grew their own persisted state in `localStorage` and each of
 * them was right to; what none of them could do from inside its own file was
 * see the other five. `docs/design/ux/12-PREFERENCES.md` §1 counts what that
 * cost — eleven keys in five files, five spellings of "read a value back
 * safely", four different ways of failing on a corrupt one — and this module
 * is §2 and §3 of that document, in code.
 *
 * ONE TABLE (`SCHEMA`). The defaults, the validation, the migration, the
 * settings panel's controls and the export document are all DERIVED from it,
 * so a new preference is a row and never a code path. A type is a validator,
 * a control and an export line at the same time; there are five of them and a
 * preference may not have a type outside them.
 *
 * NOTHING HERE THROWS. `get`, `set`, `reset`, `exportJSON` and `importJSON`
 * all return rather than raise: a corrupt value falls back to its default, an
 * unparseable document is discarded whole, and a storage object that throws on
 * access (a locked-down profile, a private window) leaves the store in
 * memory-only mode where every preference works for the session and nothing
 * persists. That is what the five hand-written `catch` blocks were each
 * paying for separately.
 *
 * THE PANEL IS HERE AND NOT IN THE CHROME because `play-game.html` does not
 * load `page-chrome.js`, and a chord an operator learns on one screen has to
 * work on the other. `Ctrl+,` opens it everywhere; `page-chrome.js` adds the
 * visible way in on the five screens that have chrome.
 */
(function (global) {
  'use strict';

  /** The document's key carries its version, so a future v2 reads v1 through
   *  exactly the machinery §3 uses for the legacy keys: a migration is a table
   *  entry, not a new mechanism. */
  var STORE_KEY = 'centaur.prefs.v1';
  var VERSION = 1;

  /* ── The five types ──────────────────────────────────────────────────────
   * `check` returns the accepted value, or `undefined` for "this is not a
   * value of my type" — which is the ONE failure signal in the module, used
   * identically by read validation, by `set`, by import and by migration.
   */
  var TYPES = {
    boolean: {
      check: function (v) { return typeof v === 'boolean' ? v : undefined; },
    },
    number: {
      check: function (v, entry) {
        var n = typeof v === 'number' ? v : NaN;
        if (!isFinite(n)) return undefined;
        if (entry.integer) n = Math.round(n);
        if (entry.min !== undefined && n < entry.min) return undefined;
        if (entry.max !== undefined && n > entry.max) return undefined;
        return n;
      },
    },
    enum: {
      check: function (v, entry) { return entry.values.indexOf(v) >= 0 ? v : undefined; },
    },
    flags: {
      // An object of booleans over a FIXED id set: unknown ids are dropped and
      // missing ones take their default, so a catalogue that gains an event
      // does not invalidate everybody's stored opt-outs.
      check: function (v, entry) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
        var out = {};
        for (var i = 0; i < entry.ids.length; i++) {
          var id = entry.ids[i];
          out[id] = typeof v[id] === 'boolean' ? v[id] : !!entry.def[id];
        }
        return out;
      },
    },
    opaque: {
      // The deliberate escape hatch, with one occupant (`review.marks`): a
      // per-game map no panel would ever render as a widget. The store checks
      // that it is JSON; the owning module checks what is inside it.
      check: function (v) {
        if (!v || typeof v !== 'object') return undefined;
        try { JSON.stringify(v); } catch (e) { return undefined; }
        return v;
      },
    },
  };

  /** The alert catalogue's ids. Named here rather than read off `Alerts`
   *  because the store loads first and must have its defaults before any
   *  module that reads it exists. `alerts.js` asserts the two agree. */
  var ALERT_EVENTS = [
    'fatal-unpinned', 'press-window', 'wire-stale', 'wire-degraded',
    'lock-refused', 'stage-drift',
  ];
  var ALERT_EVENT_LABELS = {
    'fatal-unpinned': 'a unit is one turn from a fatal cell',
    'press-window': 'the last safe press has passed',
    'wire-stale': 'the board on screen is stale',
    'wire-degraded': 'the wire is degraded',
    'lock-refused': 'the server refused a press',
    'stage-drift': 'the bot re-staged a unit you had determined',
  };
  function allEventsOn() {
    var out = {};
    for (var i = 0; i < ALERT_EVENTS.length; i++) out[ALERT_EVENTS[i]] = true;
    return out;
  }

  /* ── THE TABLE (12 §2.3) ───────────────────────────────────────────────── */

  var SCHEMA = [
    {
      group: 'lens',
      title: 'The lens',
      note: 'How the rail is spelled and how big it is (02 §3.1).',
      prefs: [
        {
          id: 'lens.scheme', label: 'Key scheme', type: 'enum',
          values: ['bracket', 'vim', 'lefthand'],
          labels: { bracket: 'bracket (default)', vim: 'vim', lefthand: 'left hand' },
          def: 'bracket',
        },
        {
          id: 'lens.density', label: 'Rail density', type: 'enum',
          values: ['compact', 'default', 'roomy'],
          labels: { compact: 'compact', default: 'default', roomy: 'roomy' },
          def: 'default',
        },
      ],
    },
    {
      group: 'explain',
      title: 'The explanation',
      note:
        'The two L3 readings under the moveset table (15 §3). The L2 pair — what ' +
        'separates rank 1 from rank 2, and whether that separation is proved — is ' +
        'not a preference: an operator who can turn off the reason a ranking exists ' +
        'is an operator who will overrule it without one.',
      prefs: [
        { id: 'explain.threats', label: 'The threat ranking', type: 'boolean', def: true },
        { id: 'explain.line', label: 'The settlement the bound was read on', type: 'boolean', def: true },
      ],
    },
    {
      group: 'board',
      title: 'The board',
      note: 'What is drawn at rest, and how large.',
      prefs: [
        {
          id: 'board.tagMode', label: 'Unit tags', type: 'enum',
          values: ['always', 'ours', 'never'],
          labels: { always: 'all tags shown', ours: 'our team’s tags shown', never: 'tags hidden' },
          def: 'always',
        },
        {
          id: 'board.sizePx', label: 'Board size', type: 'number',
          min: 300, max: 1400, step: 10, integer: true, unit: 'px', def: 550,
        },
      ],
    },
    {
      group: 'alerts',
      title: 'Alerts',
      note: 'The mute, the volume and the per-event opt-out (06 §2; WCAG 1.4.2).',
      prefs: [
        { id: 'alerts.muted', label: 'Mute all sound', type: 'boolean', def: false },
        {
          id: 'alerts.volume', label: 'Volume', type: 'number',
          min: 0, max: 1, step: 0.05, def: 0.6, percent: true,
        },
        { id: 'alerts.notify', label: 'Desktop alerts while the tab is hidden', type: 'boolean', def: false },
        {
          id: 'alerts.events', label: 'Alert on', type: 'flags',
          ids: ALERT_EVENTS, labels: ALERT_EVENT_LABELS, def: allEventsOn(),
        },
      ],
    },
    {
      group: 'wire',
      title: 'The wire',
      note: 'The state word and the clock are never optional — a glance has to answer (03 §3).',
      prefs: [
        { id: 'wire.numbers', label: 'Show the four numbers (rtt, frame, board, lag)', type: 'boolean', def: true },
      ],
    },
    {
      group: 'tour',
      title: 'The guided tour',
      note: 'It opens itself once. This is how you ask for it again.',
      prefs: [
        {
          id: 'tour.doneVersion', label: 'Completed', type: 'enum',
          values: ['', '1'], labels: { '': 'not yet', 1: 'seen' }, def: '',
          // Nobody SETS this; the only operation an operator wants on it is
          // the group's own reset, which is why the control is read-only.
          readonly: true, resetLabel: 'Show the tour again',
        },
      ],
    },
    {
      group: 'review',
      title: 'Review',
      note: 'Bookmarks, per game (07 §5).',
      prefs: [
        {
          id: 'review.marks', label: 'Bookmarks', type: 'opaque', def: {},
          summary: function (v) {
            var games = Object.keys(v || {});
            var n = 0;
            for (var i = 0; i < games.length; i++) {
              n += (v[games[i]] || []).length;
            }
            return n + (n === 1 ? ' bookmark' : ' bookmarks') +
              ' across ' + games.length + (games.length === 1 ? ' game' : ' games');
          },
          resetLabel: 'Forget every bookmark',
        },
      ],
    },
    {
      group: 'chrome',
      title: 'The chrome',
      note: 'The screens outside the live view (04).',
      prefs: [
        {
          id: 'chrome.landing', label: 'The brand mark opens', type: 'enum',
          values: ['play', 'history', 'config', 'activity', 'debug'],
          labels: {
            play: 'Play', history: 'History', config: 'Config',
            activity: 'Activity', debug: 'Connection debug',
          },
          def: 'play',
        },
      ],
    },
  ];

  /** Flattened once: id → entry, and id → group. */
  var ENTRY = {};
  var GROUP_OF = {};
  var IDS = [];
  (function flatten() {
    for (var g = 0; g < SCHEMA.length; g++) {
      for (var p = 0; p < SCHEMA[g].prefs.length; p++) {
        var e = SCHEMA[g].prefs[p];
        e.group = SCHEMA[g].group;
        ENTRY[e.id] = e;
        GROUP_OF[e.id] = SCHEMA[g].group;
        IDS.push(e.id);
      }
    }
  }());

  /* ── THE MIGRATION TABLE (12 §3) ───────────────────────────────────────
   * One row per legacy key, in FIRST-WRITER-WINS order, so the modern key
   * beats the two dead ancestors it replaced. `to` returns a map of new ids;
   * every value it returns still goes through its own type check, so a legacy
   * value that fails is dropped and the default stands — the same rule as a
   * corrupt value and not a second one.
   */
  var LEGACY = [
    { key: 'lensKeyScheme', to: function (raw) { return { 'lens.scheme': raw }; } },
    { key: 'lensDensity', to: function (raw) { return { 'lens.density': raw }; } },
    { key: 'unitTagDisplayMode', to: function (raw) { return { 'board.tagMode': raw }; } },
    {
      key: 'unitTagsHiddenByDefault',
      to: function (raw) { return { 'board.tagMode': raw === '1' ? 'never' : 'always' }; },
    },
    {
      key: 'unitTagsTranslucentDefault',
      to: function (raw) { return { 'board.tagMode': raw === '1' ? 'never' : 'always' }; },
    },
    {
      key: 'boardSizePx',
      to: function (raw) {
        var n = parseInt(raw, 10);
        if (!isFinite(n)) return {};
        // Clamped rather than dropped: the old reader validated `isFinite` and
        // not the range, so a hand-edited 99999 was honoured as a preference
        // the product could never show. It now arrives in range.
        return { 'board.sizePx': Math.max(300, Math.min(1400, Math.round(n))) };
      },
    },
    {
      key: 'centaurAlerts',
      to: function (raw) {
        var saved = null;
        try { saved = JSON.parse(raw); } catch (e) { return {}; }
        if (!saved || typeof saved !== 'object') return {};
        return {
          'alerts.muted': saved.muted,
          'alerts.volume': saved.volume,
          'alerts.notify': saved.notify,
          'alerts.events': saved.events,
        };
      },
    },
    { key: 'lensTourDone', to: function (raw) { return { 'tour.doneVersion': raw }; } },
    {
      key: 'centaur.reviewMarks',
      to: function (raw) {
        var marks = null;
        try { marks = JSON.parse(raw); } catch (e) { return {}; }
        return { 'review.marks': marks };
      },
    },
  ];

  /* ── Storage, which may not exist ──────────────────────────────────────── */

  function store() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }
  function rawGet(key) {
    var s = store();
    if (!s) return null;
    try { return s.getItem(key); } catch (e) { return null; }
  }
  function rawSet(key, value) {
    var s = store();
    if (!s) return false;
    try { s.setItem(key, value); return true; } catch (e) { return false; }
  }
  function rawRemove(key) {
    var s = store();
    if (!s) return;
    try { s.removeItem(key); } catch (e) { /* nothing to forget */ }
  }

  /* ── State ─────────────────────────────────────────────────────────────── */

  var values = {};          // id → the effective value, defaults merged
  var migrated = [];        // legacy keys folded in, for the record
  var subscribers = [];
  var loaded = false;

  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }
  function same(a, b) {
    if (a === b) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }
  function defaultOf(id) { return clone(ENTRY[id].def); }

  /** THE ONE VALIDATOR. `undefined` in, or a value of the wrong shape in, and
   *  the default comes out — this never throws and never writes back. */
  function validate(id, value) {
    var entry = ENTRY[id];
    if (!entry) return undefined;
    if (value === undefined) return undefined;
    return TYPES[entry.type].check(value, entry);
  }

  function defaults() {
    var out = {};
    for (var i = 0; i < IDS.length; i++) out[IDS[i]] = defaultOf(IDS[i]);
    return out;
  }

  /** Only what differs from its default is stored, so a default that changes
   *  reaches every operator who never touched it. */
  function persist() {
    var out = {};
    for (var i = 0; i < IDS.length; i++) {
      var id = IDS[i];
      if (!same(values[id], ENTRY[id].def)) out[id] = values[id];
    }
    var doc = { v: VERSION, at: Date.now(), migrated: migrated.slice(), values: out };
    return rawSet(STORE_KEY, JSON.stringify(doc));
  }

  function readDocument() {
    var raw = rawGet(STORE_KEY);
    if (!raw) return null;
    var doc = null;
    try { doc = JSON.parse(raw); } catch (e) { return null; }
    // A whole document that does not parse — or that is not a document — is
    // discarded, every preference falls back at once, and the page comes up.
    if (!doc || typeof doc !== 'object' || !doc.values || typeof doc.values !== 'object') return null;
    return doc;
  }

  /** Resolve a stored document into effective values. Validation on read: an
   *  id that fails its type takes its default and the valid ids beside it
   *  survive. */
  function resolve(doc) {
    var out = defaults();
    if (!doc) return out;
    for (var i = 0; i < IDS.length; i++) {
      var id = IDS[i];
      var ok = validate(id, doc.values[id]);
      if (ok !== undefined) out[id] = ok;
    }
    return out;
  }

  /** The legacy keys, once. Returns the ids it settled. */
  function migrate() {
    var found = {};
    var keys = [];
    for (var i = 0; i < LEGACY.length; i++) {
      var raw = rawGet(LEGACY[i].key);
      if (raw === null || raw === undefined) continue;
      keys.push(LEGACY[i].key);
      var mapped = LEGACY[i].to(raw) || {};
      for (var id in mapped) {
        if (!Object.prototype.hasOwnProperty.call(mapped, id)) continue;
        if (Object.prototype.hasOwnProperty.call(found, id)) continue; // first writer wins
        var ok = validate(id, mapped[id]);
        if (ok !== undefined) found[id] = ok;
      }
    }
    if (keys.length === 0) return null;
    return { keys: keys, values: found };
  }

  function load() {
    if (loaded) return;
    loaded = true;
    var doc = readDocument();
    values = resolve(doc);
    migrated = doc && Array.isArray(doc.migrated) ? doc.migrated.slice() : [];
    if (doc) return;              // the store owns these preferences already
    var old = migrate();
    if (!old) { persist(); return; }
    for (var id in old.values) {
      if (Object.prototype.hasOwnProperty.call(old.values, id)) values[id] = old.values[id];
    }
    migrated = old.keys.slice();
    // The legacy keys go ONLY after the new document has landed: a migration
    // that deletes the only copy of a value is not a migration.
    if (persist()) {
      for (var k = 0; k < old.keys.length; k++) rawRemove(old.keys[k]);
    }
  }

  function notify(ids) {
    if (!ids || ids.length === 0) return;
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](ids.slice(), api); } catch (e) { /* one bad listener is not the others' problem */ }
    }
    syncPanel();
  }

  /* ── The API ───────────────────────────────────────────────────────────── */

  function get(id) {
    load();
    if (!ENTRY[id]) return undefined;
    return clone(values[id]);
  }

  function set(id, value) {
    load();
    if (!ENTRY[id]) return false;
    var ok = validate(id, value);
    if (ok === undefined) return false;
    if (same(values[id], ok)) return true;
    values[id] = ok;
    persist();
    notify([id]);
    return true;
  }

  /** Several at once, one write and one notification — what an import and a
   *  group of panel controls both want. */
  function setMany(map) {
    load();
    var changed = [];
    var rejected = [];
    for (var id in map) {
      if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
      if (!ENTRY[id]) { rejected.push(id); continue; }
      var ok = validate(id, map[id]);
      if (ok === undefined) { rejected.push(id); continue; }
      if (same(values[id], ok)) continue;
      values[id] = ok;
      changed.push(id);
    }
    if (changed.length > 0) { persist(); notify(changed); }
    return { applied: changed, rejected: rejected };
  }

  /** `reset()` everything, `reset('alerts')` a group, `reset('alerts.volume')`
   *  one preference — one function, because the ids are namespaced. */
  function reset(scope) {
    load();
    var changed = [];
    for (var i = 0; i < IDS.length; i++) {
      var id = IDS[i];
      if (scope && scope !== id && GROUP_OF[id] !== scope) continue;
      var def = defaultOf(id);
      if (same(values[id], def)) continue;
      values[id] = def;
      changed.push(id);
    }
    if (changed.length > 0) { persist(); notify(changed); }
    return changed;
  }

  function all() {
    load();
    var out = {};
    for (var i = 0; i < IDS.length; i++) out[IDS[i]] = clone(values[IDS[i]]);
    return out;
  }

  function exportJSON() {
    return JSON.stringify({ v: VERSION, at: Date.now(), values: all() }, null, 2);
  }

  /** Per preference, not all-or-nothing: an operator pasting a colleague's
   *  setup gets every id that validates and a list of the ones that did not. */
  function importJSON(text) {
    var doc = null;
    try { doc = JSON.parse(String(text || '')); } catch (e) {
      return { applied: [], rejected: [], error: 'that is not JSON' };
    }
    var map = doc && doc.values && typeof doc.values === 'object' ? doc.values
      : (doc && typeof doc === 'object' ? doc : null);
    if (!map) return { applied: [], rejected: [], error: 'no preferences in it' };
    return setMany(map);
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    return function () {
      var i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  /* ── Another tab (12 §5.1, source 3) ───────────────────────────────────── */

  function onStorage(e) {
    if (e && e.key && e.key !== STORE_KEY) return;   // key === null is a clear()
    var next = resolve(readDocument());
    var changed = [];
    for (var i = 0; i < IDS.length; i++) {
      var id = IDS[i];
      if (same(values[id], next[id])) continue;
      values[id] = next[id];
      changed.push(id);
    }
    notify(changed);
  }

  /* ── The panel (12 §5) ─────────────────────────────────────────────────── */

  var CSS =
    '.prefs-backdrop{position:fixed;inset:0;z-index:var(--z-keysheet,11000);' +
    'display:flex;align-items:center;justify-content:center;padding:var(--space-24,24px);' +
    'background:var(--keysheet-scrim,rgba(0,0,0,0.6));}' +
    // A CLASS BEATS THE UA'S `[hidden]` RULE, which is how a closed popover
    // ends up taking every click on the page it is invisible over. The
    // attribute is the state — `el.hidden` is what the drill reads — so the
    // sheet has to say what it means here rather than leave it to the cascade.
    '.prefs-backdrop[hidden]{display:none !important;}' +
    '.prefs-pop{background:var(--keysheet-bg,#232323);border:1px solid var(--line,#444);' +
    'border-radius:var(--radius-10,10px);box-shadow:var(--shadow-modal,0 8px 32px rgba(0,0,0,0.5));' +
    'color:var(--ink,#e0e0e0);width:100%;max-width:620px;max-height:86vh;overflow:auto;' +
    'padding:var(--space-18,18px) var(--space-22,22px);font-size:var(--size-13,13px);}' +
    '.prefs-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-12,12px);}' +
    '.prefs-head h2{font-size:var(--size-15,15px);margin:0;}' +
    '.prefs-head .prefs-chord{color:var(--ink-faint,#6e6e6e);font-size:var(--size-12,12px);}' +
    '.prefs-group{margin-top:var(--space-18,18px);border-top:1px solid var(--line-soft,#383838);padding-top:var(--space-12,12px);}' +
    '.prefs-group-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-12,12px);}' +
    '.prefs-group h3{font-size:var(--size-13,13px);margin:0;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-bright,#fff);}' +
    '.prefs-note{color:var(--ink-faint,#6e6e6e);font-size:var(--size-12,12px);}' +
    '.prefs-row{display:flex;align-items:center;gap:var(--space-12,12px);margin-top:var(--space-6,6px);}' +
    '.prefs-row>label:first-child{flex:1 1 auto;color:var(--ink-dim,#9a9a9a);}' +
    '.prefs-row select,.prefs-row input[type=range]{max-width:220px;}' +
    '.prefs-flags{margin-top:var(--space-6,6px);display:grid;gap:var(--space-6,6px);}' +
    '.prefs-flags label{display:flex;align-items:center;gap:var(--space-6,6px);color:var(--ink-dim,#9a9a9a);}' +
    '.prefs-val{color:var(--ink-bright,#fff);font-family:var(--font-mono,monospace);min-width:52px;text-align:right;}' +
    '.prefs-foot{margin-top:var(--space-18,18px);border-top:1px solid var(--line-soft,#383838);padding-top:var(--space-12,12px);}' +
    '.prefs-foot textarea{width:100%;height:88px;background:var(--kbd-bg,#1a1a1a);color:var(--ink,#e0e0e0);' +
    'border:1px solid var(--line,#444);border-radius:var(--radius-4,4px);font-family:var(--font-mono,monospace);' +
    'font-size:var(--size-12,12px);padding:var(--space-6,6px);}' +
    '.prefs-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-6,6px);margin-top:var(--space-6,6px);}' +
    '.prefs-pop button{background:var(--kbd-bg,#1a1a1a);color:var(--ink,#e0e0e0);border:1px solid var(--line,#444);' +
    'border-radius:var(--radius-4,4px);padding:2px var(--space-6,6px);font-size:var(--size-12,12px);cursor:pointer;}' +
    // A control that came with the browser's own colours is the one thing on
    // this surface that would not be reading the sheet (09).
    '.prefs-pop select{background:var(--kbd-bg,#1a1a1a);color:var(--ink,#e0e0e0);border:1px solid var(--line,#444);' +
    'border-radius:var(--radius-4,4px);padding:1px var(--space-4,4px);font:inherit;font-size:var(--size-12,12px);}' +
    '.prefs-pop input[type=checkbox],.prefs-pop input[type=range]{accent-color:var(--go,#3fb950);}' +
    '.prefs-pop select:disabled{opacity:0.6;}' +
    '.prefs-status{color:var(--ink-faint,#6e6e6e);font-size:var(--size-12,12px);margin-left:auto;}';

  var backdrop = null;
  var body = null;

  function ensureStyle() {
    if (!global.document || global.document.getElementById('prefs-style')) return;
    var style = global.document.createElement('style');
    style.id = 'prefs-style';
    style.textContent = CSS;
    (global.document.head || global.document.documentElement).appendChild(style);
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** One control per TYPE, and none per preference — which is why a new row in
   *  the table costs no panel work at all. */
  function controlHTML(entry) {
    var v = values[entry.id];
    var id = esc(entry.id);
    if (entry.type === 'boolean') {
      return '<div class="prefs-row"><label for="pf-' + id + '">' + esc(entry.label) + '</label>' +
        '<input type="checkbox" id="pf-' + id + '" data-pref="' + id + '"' + (v ? ' checked' : '') + '></div>';
    }
    if (entry.type === 'enum') {
      var opts = entry.values.map(function (val) {
        var label = (entry.labels && entry.labels[val]) || String(val || '—');
        return '<option value="' + esc(val) + '"' + (val === v ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
      return '<div class="prefs-row"><label for="pf-' + id + '">' + esc(entry.label) + '</label>' +
        '<select id="pf-' + id + '" data-pref="' + id + '"' + (entry.readonly ? ' disabled' : '') + '>' +
        opts + '</select></div>';
    }
    if (entry.type === 'number') {
      return '<div class="prefs-row"><label for="pf-' + id + '">' + esc(entry.label) + '</label>' +
        '<input type="range" id="pf-' + id + '" data-pref="' + id + '" min="' + entry.min +
        '" max="' + entry.max + '" step="' + entry.step + '" value="' + v + '">' +
        '<span class="prefs-val" data-pref-val="' + id + '">' + esc(numberText(entry, v)) + '</span></div>';
    }
    if (entry.type === 'flags') {
      var rows = entry.ids.map(function (fid) {
        return '<label><input type="checkbox" data-pref="' + id + '" data-flag="' + esc(fid) + '"' +
          (v && v[fid] ? ' checked' : '') + '> <span>' + esc((entry.labels && entry.labels[fid]) || fid) + '</span></label>';
      }).join('');
      return '<div class="prefs-row"><label>' + esc(entry.label) + '</label></div>' +
        '<div class="prefs-flags">' + rows + '</div>';
    }
    // opaque: counted, never edited.
    return '<div class="prefs-row"><label>' + esc(entry.label) + '</label>' +
      '<span class="prefs-val" data-pref-val="' + id + '">' + esc(entry.summary ? entry.summary(v) : 'stored') + '</span></div>';
  }

  function numberText(entry, v) {
    if (entry.percent) return Math.round(v * 100) + '%';
    return String(v) + (entry.unit || '');
  }

  function panelHTML() {
    var groups = SCHEMA.map(function (g) {
      var resetLabel = 'Reset';
      for (var i = 0; i < g.prefs.length; i++) {
        if (g.prefs[i].resetLabel) resetLabel = g.prefs[i].resetLabel;
      }
      return '<section class="prefs-group" data-prefs-group="' + esc(g.group) + '">' +
        '<div class="prefs-group-head"><h3>' + esc(g.title) + '</h3>' +
        '<button type="button" data-prefs-reset="' + esc(g.group) + '">' + esc(resetLabel) + '</button></div>' +
        '<div class="prefs-note">' + esc(g.note) + '</div>' +
        g.prefs.map(controlHTML).join('') +
        '</section>';
    }).join('');
    return '<div class="prefs-pop" role="dialog" aria-modal="true" aria-label="Preferences">' +
      '<div class="prefs-head"><h2>Preferences</h2>' +
      '<span class="prefs-chord">Ctrl+, — stored in this browser, per operator</span></div>' +
      groups +
      '<div class="prefs-foot">' +
      '<div class="prefs-note">The whole set as JSON. Copy takes it to the clipboard; ' +
      'Import reads whatever is in the box, per preference.</div>' +
      '<textarea data-prefs-json spellcheck="false"></textarea>' +
      '<div class="prefs-actions">' +
      '<button type="button" data-prefs-copy>Copy</button>' +
      '<button type="button" data-prefs-import>Import</button>' +
      '<button type="button" data-prefs-reset="">Reset everything</button>' +
      '<button type="button" data-prefs-close>Close</button>' +
      '<span class="prefs-status" data-prefs-status></span>' +
      '</div></div></div>';
  }

  function status(text) {
    if (!backdrop) return;
    var el = backdrop.querySelector('[data-prefs-status]');
    if (el) el.textContent = text || '';
  }

  /** Written in place rather than rebuilt, so a change arriving from another
   *  tab (or from the alert popover) does not take the focus out of the
   *  control under the operator's hand. */
  function syncPanel() {
    if (!backdrop || backdrop.hidden) return;
    var nodes = backdrop.querySelectorAll('[data-pref]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var entry = ENTRY[node.getAttribute('data-pref')];
      if (!entry) continue;
      var v = values[entry.id];
      var flag = node.getAttribute('data-flag');
      if (flag) { node.checked = !!(v && v[flag]); continue; }
      if (entry.type === 'boolean') { node.checked = !!v; continue; }
      if (entry.type === 'number') {
        if (node !== global.document.activeElement) node.value = String(v);
        continue;
      }
      if (entry.type === 'enum') { node.value = String(v); continue; }
    }
    var vals = backdrop.querySelectorAll('[data-pref-val]');
    for (var j = 0; j < vals.length; j++) {
      var e2 = ENTRY[vals[j].getAttribute('data-pref-val')];
      if (!e2) continue;
      vals[j].textContent = e2.type === 'number'
        ? numberText(e2, values[e2.id])
        : (e2.summary ? e2.summary(values[e2.id]) : 'stored');
    }
  }

  function fillJSON() {
    if (!backdrop) return;
    var box = backdrop.querySelector('[data-prefs-json]');
    if (box) box.value = exportJSON();
  }

  function onPanelInput(e) {
    var node = e.target;
    if (!node || !node.getAttribute) return;
    var id = node.getAttribute('data-pref');
    if (!id || !ENTRY[id]) return;
    var entry = ENTRY[id];
    var flag = node.getAttribute('data-flag');
    if (flag) {
      var next = clone(values[id]) || {};
      next[flag] = !!node.checked;
      set(id, next);
    } else if (entry.type === 'boolean') {
      set(id, !!node.checked);
    } else if (entry.type === 'number') {
      set(id, Number(node.value));
    } else {
      set(id, node.value);
    }
    fillJSON();
    status('');
  }

  function onPanelClick(e) {
    var node = e.target;
    if (!node || !node.getAttribute) return;
    if (node === backdrop) { toggle(false); return; }
    if (node.hasAttribute('data-prefs-close')) { toggle(false); return; }
    if (node.hasAttribute('data-prefs-reset')) {
      var scope = node.getAttribute('data-prefs-reset');
      var changed = reset(scope || undefined);
      fillJSON();
      status(changed.length + (changed.length === 1 ? ' preference' : ' preferences') + ' back to default');
      return;
    }
    if (node.hasAttribute('data-prefs-copy')) {
      var text = exportJSON();
      fillJSON();
      var done = function () { status('copied — paste it anywhere'); };
      try {
        if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
          var p = global.navigator.clipboard.writeText(text);
          if (p && typeof p.then === 'function') p.then(done, function () { status('clipboard refused — the JSON is in the box'); });
          else done();
          return;
        }
      } catch (err) { /* fall through to the box */ }
      status('the JSON is in the box — select it and copy');
      return;
    }
    if (node.hasAttribute('data-prefs-import')) {
      var box = backdrop.querySelector('[data-prefs-json]');
      var out = importJSON(box ? box.value : '');
      if (out.error) { status(out.error); return; }
      status(out.applied.length + ' applied' +
        (out.rejected.length ? ', rejected: ' + out.rejected.join(', ') : ''));
      syncPanel();
      return;
    }
  }

  function build() {
    if (backdrop || !global.document || !global.document.body) return backdrop;
    ensureStyle();
    backdrop = global.document.createElement('div');
    backdrop.className = 'prefs-backdrop';
    backdrop.id = 'prefs-panel';
    backdrop.hidden = true;
    backdrop.innerHTML = panelHTML();
    backdrop.addEventListener('click', onPanelClick);
    backdrop.addEventListener('change', onPanelInput);
    backdrop.addEventListener('input', onPanelInput);
    global.document.body.appendChild(backdrop);
    body = backdrop.querySelector('.prefs-pop');
    return backdrop;
  }

  function isOpen() { return !!backdrop && !backdrop.hidden; }

  function toggle(open) {
    load();
    build();
    if (!backdrop) return false;
    var next = open === undefined ? backdrop.hidden : !!open;
    backdrop.hidden = !next;
    if (next) {
      syncPanel();
      fillJSON();
      status('');
      if (body) body.scrollTop = 0;
    }
    return next;
  }

  /** THE CHORD, everywhere. While the panel is open it owns the keyboard —
   *  the same rule the shortcuts pane in `play-game.html` states — so nothing
   *  behind it is steered by a keystroke aimed at a checkbox. */
  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === ',' || e.code === 'Comma')) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      toggle(false);
      return;
    }
    e.stopPropagation();
  }

  function install() {
    load();
    if (!global.document) return;
    build();
    global.document.addEventListener('keydown', onKey, true);
    if (global.addEventListener) global.addEventListener('storage', onStorage);
  }

  var api = {
    get: get,
    set: set,
    setMany: setMany,
    reset: reset,
    all: all,
    defaults: defaults,
    subscribe: subscribe,
    exportJSON: exportJSON,
    importJSON: importJSON,
    /** The table itself, for a panel or a drill that would otherwise hard-code
     *  it. Cloned: a reader may not edit the schema. */
    schema: function () {
      return SCHEMA.map(function (g) {
        return {
          group: g.group, title: g.title, note: g.note,
          prefs: g.prefs.map(function (p) {
            return {
              id: p.id, label: p.label, type: p.type, def: clone(p.def),
              values: p.values ? p.values.slice() : undefined,
              ids: p.ids ? p.ids.slice() : undefined,
              min: p.min, max: p.max, step: p.step,
            };
          }),
        };
      });
    },
    ids: function () { return IDS.slice(); },
    groups: function () { return SCHEMA.map(function (g) { return g.group; }); },
    /** Which legacy keys this browser's document was built from. */
    migrated: function () { load(); return migrated.slice(); },
    storeKey: STORE_KEY,
    version: VERSION,
    panel: { toggle: toggle, isOpen: isOpen },
    install: install,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Prefs = api;
    load();
    if (global.document && global.document.readyState !== 'loading') install();
    else if (global.document) global.document.addEventListener('DOMContentLoaded', install);
  }
})(typeof window !== 'undefined' ? window : globalThis);
