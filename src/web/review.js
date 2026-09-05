/**
 * THE REVIEW — a finished game, judged.
 *
 * `docs/design/ux/07-REVIEW.md`. `/history` could always open turn 63 of a
 * 118-turn game and could never say that 63 was the turn. This computes the
 * INDEX OF MOMENTS from rows that already exist, draws it as a strip along the
 * game, and answers "why did it do that" at any one of them out of the stored
 * breakdown and the stored ranking.
 *
 * IT COMPUTES NOTHING ABOUT A DECISION. Every reading here is a read of a row
 * the game already wrote — `turn_boards` through `/api/games/:id/turns`,
 * `turn_events` through `/api/logs` — folded, ranked and formatted. No re-run,
 * no re-price, no second `explainPlan`; a row the game did not price draws `—`
 * and says so. Nothing here writes anything anywhere except one bounded
 * preference (`review.marks`) for the reviewer's own bookmarks.
 *
 * TWO PASSES, because a whole game's `movesets` frames are tens of megabytes
 * (07-MEASURED §1: 33–88 KB per emission, seven to ten an emission a turn):
 *
 *   · the INDEX pass is one boards fetch plus five `kind=`-filtered event
 *     fetches, all of them small, and it settles M1–M4 for every turn;
 *   · the DEEP pass is one turn's whole log, fetched when the reviewer lands
 *     on that turn and cached, and it settles M5/M6 and the why panel. It also
 *     runs, bounded and in the background, over the turns the index already
 *     flagged, so the strip deepens rather than lying about what it read. The
 *     strip says which turns were read deeply; the rest are drawn as unread,
 *     never as empty (01-RESEARCH P5).
 */
(function (global) {
  'use strict';

  var MARKS_KEY = 'review.marks';          // { [gameId]: [{turn, focus, at}] }, in `prefs.js`
  var MARKS_CAP = 200;
  var DEEP_BUDGET = 40;                    // turns read deeply in the background
  var LOG_LIMIT = 5000;                    // per index fetch — these are small kinds
  var TURN_LIMIT = 4000;                   // one turn's whole log

  var esc = (global.DomUtils && global.DomUtils.escapeHtml) ||
    function (s) { return String(s == null ? '' : s); };

  // ── Numbers ─────────────────────────────────────────────────────────────
  // A lens payload names its non-finite numbers on the way out
  // (`{$num:'+inf'}`) because plain JSON flattens `+∞` to `null` and "unbounded
  // above" and "unmeasured" are not the same reading. `LensView.reviveEvents`
  // undoes that for a whole event; this is the one-value form, for a number
  // read out of anything that did not go through it.
  function num(v) {
    if (v && typeof v === 'object' && typeof v.$num === 'string') {
      if (v.$num === '+inf') return Infinity;
      if (v.$num === '-inf') return -Infinity;
      return NaN;
    }
    return typeof v === 'number' ? v : NaN;
  }

  /** A bound, as the rail writes one. `∞` is a reading; `—` is its absence. */
  function fmtNum(v, digits) {
    var n = num(v);
    if (!Number.isFinite(n)) {
      if (n === Infinity) return '∞';
      if (n === -Infinity) return '−∞';
      return '—';
    }
    var d = digits == null ? 2 : digits;
    return (n < 0 ? '−' : '') + Math.abs(n).toFixed(d);
  }

  function fmtSigned(v, digits) {
    var n = num(v);
    if (!Number.isFinite(n)) return fmtNum(v, digits);
    return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(digits == null ? 2 : digits);
  }

  /** A cell index as the board reads it. The stride is `width + 2` — the ring
   *  of off-board squares the substrate pads with — so an index is `(x, y)`
   *  wherever a board is known and `#n` where one is not. */
  function fmtCell(cell, board) {
    var n = num(cell);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (!board || !board.width) return '#' + n;
    var w = board.width + 2;
    return '(' + ((n % w) - 1) + ',' + (Math.floor(n / w) - 1) + ')';
  }

  /** The ledger's residue entry, as the rail names it. `#-1` is the gap the
   *  evaluator declares when no held unit accounts for it, and printing the
   *  raw sentinel at a reviewer is not naming it — the same rule and the same
   *  words as `src/lens/view/index.ts`'s `namedUnit`. */
  function namedUnit(key) {
    return String(key) === '#-1' ? 'the evaluator residue' : String(key);
  }

  /** A moveset key is a hash and a reviewer reads the tail of one. */
  function shortKey(key) {
    var s = String(key == null ? '' : key);
    return s.length > 18 ? '…' + s.slice(-16) : s;
  }

  // ── Who is ours ─────────────────────────────────────────────────────────

  /**
   * The team under review, as a predicate over a settlement's units. The games
   * listing groups by team and hands us the roster it grouped on, so the ids
   * are authoritative; `teamID` is the fallback for a unit that joined the
   * board after the roster snapshot the listing read.
   */
  function ourSideOf(group, turns) {
    var ids = {};
    (group.snakes || []).forEach(function (s) { if (s.snake_id) ids[s.snake_id] = true; });
    var team = null;
    for (var i = 0; i < turns.length && team === null; i++) {
      var snakes = unitsOf(turns[i]);
      for (var j = 0; j < snakes.length; j++) {
        if (ids[snakes[j].id]) { team = snakes[j].teamID == null ? null : snakes[j].teamID; break; }
      }
    }
    return {
      ids: ids,
      team: team,
      has: function (unit) {
        if (!unit) return false;
        if (ids[unit]) return true;
        return false;
      },
      isOurs: function (snake) {
        if (!snake) return false;
        if (ids[snake.id]) return true;
        return team !== null && snake.teamID === team;
      },
    };
  }

  function boardOf(row) {
    var s = row && row.game_state;
    return (s && s.board) || null;
  }

  function unitsOf(row) {
    var b = boardOf(row);
    return (b && b.snakes) || [];
  }

  function alive(snake) {
    return snake && snake.health > 0 && (snake.body ? snake.body.length > 0 : true);
  }

  // ── The lead, exactly as the runner adjudicates it ──────────────────────

  /**
   * `weight(team) = Σ length` over that team's live units — `length` is body
   * length for a snake and stack weight for a piece, which is the same
   * quantity — and `lead = ours − the heaviest rival's`, signed, zero on a
   * level board. That is `leadOf()` on the `endgame` branch verbatim
   * (`src/tests/local-game.ts`, the `GameOutcome` instrument); the runner
   * takes it off its own adjudication at the end and every ten turns, the
   * store keeps no such record, so the review takes the same function over the
   * boards the store does keep. Same definition on purpose: when that branch
   * merges, its `lead` becomes the headline's authority and this becomes its
   * per-turn continuation.
   */
  function leadOfTurn(row, side) {
    var byTeam = {};
    var ourWeight = 0;
    unitsOf(row).forEach(function (s) {
      if (!alive(s)) return;
      var w = Number(s.length) || 0;
      if (side.isOurs(s)) { ourWeight += w; return; }
      var key = s.teamID || s.id;
      byTeam[key] = (byTeam[key] || 0) + w;
    });
    var best = null;
    Object.keys(byTeam).forEach(function (k) {
      if (best === null || byTeam[k] > best) best = byTeam[k];
    });
    return { turn: row.turn, lead: best === null ? ourWeight : ourWeight - best, ours: ourWeight, rival: best || 0 };
  }

  function leadSeries(turns, side) {
    return turns.map(function (row) { return leadOfTurn(row, side); });
  }

  // ── The index of moments ────────────────────────────────────────────────

  var RULES = {
    'death-ours': { glyph: '▼', weight: 4, tone: 'stop', label: 'we lost a unit' },
    'death-theirs': { glyph: '△', weight: 3, tone: 'ink', label: 'a rival died' },
    handover: { glyph: '◆', weight: 4, tone: 'warn', label: 'the lead changed hands' },
    swing: { glyph: '◇', weight: 2, tone: 'warn', label: 'the lead swung' },
    operator: { glyph: '■', weight: 2, tone: 'cool', label: 'an operator acted' },
    refused: { glyph: '■', weight: 3, tone: 'stop', label: 'a determination was refused' },
    'late-leader': { glyph: '●', weight: 3, tone: 'ink', label: 'the leader changed on the last emission' },
    narrow: { glyph: '○', weight: 2, tone: 'ink', label: 'the ranking was narrow' },
  };

  var OPERATOR_KINDS = ['pin', 'unpin', 'commit', 'pin.refused', 'operator.command'];

  /** Categorical rules: a death or a hand-over is not a matter of degree and
   *  is never cut, however quiet the game around it was. */
  var ALWAYS = { 'death-ours': true, 'death-theirs': true, handover: true, refused: true };

  /**
   * THE INDEX IS A RANKING, NOT A FILTER — and this is the one thing the plan
   * got wrong. §1.2's thresholds are absolute, and against a real log the
   * consequence was immediate: the leader changes on the last emission of
   * almost every turn (the search is still improving when the deadline
   * arrives) and the top two rows are within a hundredth of each other nearly
   * as often, so fifteen turns produced a hit on fifteen turns. A strip of
   * identical marks is the `/activity` legend failure (04 F4) in a new place.
   *
   * So every hit carries a MAGNITUDE in its own rule's units, the magnitudes
   * are normalised within the game — the only scale that means anything, since
   * an evaluator's units are not comparable across boards — and the index
   * keeps the turns that stand out: `clamp(4, turns/6, 24)` of them. The rest
   * stay on the strip at the lowest brightness, because "quieter than the
   * others" and "nothing here" are different readings and only one of them is
   * true. The categorical rules are never cut.
   */
  function collectHits(state) {
    var out = [];
    var turns = state.turns;
    var side = state.side;
    var leads = state.leads;

    // M1 — a death. THE BOARDS ARE THE SOURCE, not `turn.resolved.deaths`:
    // the manager writes that field as `[]` on every turn it has ever written
    // (`active-game-manager.ts::applyResolvedMoves`), so an index that trusted
    // it would report a game in which nothing ever died. A unit alive in turn
    // t's settlement and gone from t+1's died in t; the boards are also the
    // class retained forever, so this rule outlives the hot event window. A
    // non-empty `deaths` payload, where one ever appears, corroborates.
    for (var i = 1; i < turns.length; i++) {
      var before = {};
      unitsOf(turns[i - 1]).forEach(function (s) { if (alive(s)) before[s.id] = s; });
      unitsOf(turns[i]).forEach(function (s) { if (alive(s)) delete before[s.id]; });
      var gone = Object.keys(before);
      if (gone.length === 0) continue;
      var ours = gone.filter(function (id) { return side.isOurs(before[id]); });
      var theirs = gone.filter(function (id) { return !side.isOurs(before[id]); });
      if (ours.length > 0) {
        out.push(moment(turns[i - 1].turn, 'death-ours',
          ours.length === 1 ? 'we lost ' + ours[0] : 'we lost ' + ours.length + ' units',
          ours.map(function (id) { return id + ' at ' + fmtCell(headCell(before[id], boardOf(turns[i - 1])), boardOf(turns[i - 1])); }).join(' · '),
          ours[0], ours.length));
      }
      if (theirs.length > 0) {
        out.push(moment(turns[i - 1].turn, 'death-theirs',
          theirs.length === 1 ? theirs[0] + ' died' : theirs.length + ' rivals died',
          theirs.join(' · '), null, theirs.length));
      }
    }

    // M2/M3 — the lead swung, or changed hands.
    var maxAbs = 0;
    leads.forEach(function (l) { maxAbs = Math.max(maxAbs, Math.abs(l.lead)); });
    var floor = Math.max(2, 0.15 * maxAbs);
    for (var k = 1; k < leads.length; k++) {
      var d = leads[k].lead - leads[k - 1].lead;
      var crossed = (leads[k - 1].lead > 0 && leads[k].lead < 0) ||
        (leads[k - 1].lead < 0 && leads[k].lead > 0);
      if (crossed) {
        out.push(moment(leads[k].turn, 'handover',
          leads[k].lead > 0 ? 'we took the lead' : 'we lost the lead',
          'lead ' + fmtSigned(leads[k - 1].lead, 0) + ' → ' + fmtSigned(leads[k].lead, 0),
          null, Math.abs(d)));
      } else if (Math.abs(d) >= floor) {
        out.push(moment(leads[k].turn, 'swing',
          'the lead ' + (d > 0 ? 'widened' : 'narrowed') + ' by ' + Math.abs(d).toFixed(0),
          'lead ' + fmtSigned(leads[k - 1].lead, 0) + ' → ' + fmtSigned(leads[k].lead, 0),
          null, Math.abs(d)));
      }
    }

    // M4 — an operator acted. A refusal weighs more than the rest: a binding
    // refused in play is otherwise invisible (04-SECONDARY-SCREENS F1) and a
    // review is the last place it can still be seen.
    var byTurn = {};
    state.operatorEvents.forEach(function (e) {
      var t = e.turn;
      byTurn[t] = byTurn[t] || [];
      byTurn[t].push(e);
    });
    Object.keys(byTurn).forEach(function (t) {
      var evs = byTurn[t];
      var refused = evs.some(function (e) { return e.kind === 'pin.refused'; });
      var verbs = {};
      evs.forEach(function (e) { verbs[e.kind] = (verbs[e.kind] || 0) + 1; });
      var who = (evs[0].actor && evs[0].actor.name) || (evs[0].actor && evs[0].actor.id) || 'an operator';
      out.push(moment(Number(t), refused ? 'refused' : 'operator',
        refused ? 'a determination was refused' : who + ' ' + Object.keys(verbs).join(', '),
        Object.keys(verbs).map(function (v) { return verbs[v] + '× ' + v; }).join(' · '),
        evs[0].unit || null, refused ? 3 : evs.length));
    });

    return out.concat(state.deepMoments);
  }

  /** Normalise each rule's magnitudes within this game, score every hit, and
   *  keep the turns that stand out. Pure over what was collected. */
  function indexMoments(state) {
    var all = collectHits(state);
    var top = {};
    all.forEach(function (h) {
      top[h.rule] = Math.max(top[h.rule] || 0, Math.abs(h.mag) || 0);
    });
    all.forEach(function (h) {
      var max = top[h.rule] || 0;
      h.norm = max > 0 ? Math.min(1, Math.abs(h.mag) / max) : 0;
      h.score = h.weight + h.norm;
    });

    var best = {};
    all.forEach(function (h) { best[h.turn] = Math.max(best[h.turn] || 0, h.score); });
    var n = Math.max(4, Math.min(24, Math.ceil(state.turns.length / 6)));
    var order = Object.keys(best).sort(function (a, b) {
      return best[b] - best[a] || Number(a) - Number(b);
    });
    var keep = {};
    order.slice(0, n).forEach(function (t) { keep[t] = true; });
    all.forEach(function (h) { if (ALWAYS[h.rule]) keep[h.turn] = true; });
    all.forEach(function (h) { h.kept = !!keep[h.turn]; });
    all.sort(function (a, b) { return a.turn - b.turn || b.score - a.score; });
    return all;
  }

  function headCell(snake, board) {
    if (!snake || !snake.head || !board) return -1;
    return (snake.head.y + 1) * (board.width + 2) + snake.head.x + 1;
  }

  function moment(turn, rule, headline, detail, unit, mag) {
    return {
      turn: turn, rule: rule, headline: headline, detail: detail || '',
      unit: unit || null, weight: RULES[rule].weight, glyph: RULES[rule].glyph,
      tone: RULES[rule].tone,
      // In the rule's OWN units; normalised against the game before it is
      // compared with anything.
      mag: mag == null ? 1 : mag, norm: 0, score: RULES[rule].weight, kept: true,
    };
  }

  /**
   * M5/M6, off ONE turn's whole log. The `movesets` frames of a turn, grouped
   * by cluster in `seq` order: the last frame is the list the decision ended
   * on, and the frame before it is what it would have staged had the deadline
   * come one emission earlier.
   */
  function deepMomentsFor(turn, events) {
    var out = [];
    var frames = events.filter(function (e) { return e.kind === 'movesets'; });
    var byCluster = {};
    frames.forEach(function (e) {
      var c = e.payload && e.payload.cluster;
      if (c == null) return;
      byCluster[c] = byCluster[c] || [];
      byCluster[c].push(e);
    });

    Object.keys(byCluster).forEach(function (c) {
      var list = byCluster[c];
      var last = list[list.length - 1];
      var prev = list.length > 1 ? list[list.length - 2] : null;
      var lastTop = rankOne(last);
      if (lastTop === null) return;

      // M5 — the leader changed on the LAST emission. A leader that changed
      // early and then settled is a search working, and is not a moment.
      if (prev !== null) {
        var prevTop = rankOne(prev);
        if (prevTop && prevTop.key !== lastTop.key) {
          // The MAGNITUDE is what the swap bought on the proved floor. A
          // leader that changed for a hundredth is the search polishing; one
          // that changed for ten is the deadline landing on a different game.
          var gain = num(lastTop.lo) - num(prevTop.lo);
          out.push(moment(turn, 'late-leader',
            'the bot changed its mind on its last emission',
            'cluster ' + c + ': ' + shortKey(prevTop.key) + ' → ' + shortKey(lastTop.key) +
              ' · Δlo ' + fmtSigned(gain),
            (lastTop.moves && lastTop.moves[0] && lastTop.moves[0].unit) || null,
            Number.isFinite(gain) ? Math.abs(gain) : 0));
        }
      }

      // M6 — the ranking was narrow.
      var second = rankN(last, 2);
      var dom = lastTop.dominance;
      var advisory = dom && (dom.kind === 'advisory-only' || dom.kind === 'indifferent');
      var margin = second === null ? Infinity : num(lastTop.lo) - num(second.lo);
      var tight = Number.isFinite(margin) &&
        Math.abs(margin) <= Math.max(0.05, 0.01 * Math.abs(num(lastTop.lo)));
      if (advisory || tight) {
        out.push(moment(turn, 'narrow',
          advisory ? 'the floors were equal — it won on the advisory channel'
            : 'it nearly played something else',
          'cluster ' + c + ': rank 1 over rank 2 by ' + fmtNum(margin) +
            (dom ? ' · ' + clauseOf(dom) : ''),
          (lastTop.moves && lastTop.moves[0] && lastTop.moves[0].unit) || null,
          // Tighter is bigger: a hair between the top two is the strongest
          // reading this rule has.
          Number.isFinite(margin) ? 1 / (1 + Math.abs(margin)) : 0));
      }
    });
    return out;
  }

  function rowsOf(frame) {
    return (frame && frame.payload && frame.payload.rows) || [];
  }
  function rankOne(frame) {
    return rankN(frame, 1);
  }
  function rankN(frame, n) {
    var rows = rowsOf(frame);
    for (var i = 0; i < rows.length; i++) if (rows[i].rank === n) return rows[i];
    return rows.length >= n ? rows[n - 1] : null;
  }

  /** The rail's own sentence for why a row is not rank 1, from the shipped
   *  bundle — never a second wording of it here. */
  function clauseOf(dominance) {
    if (global.LensView && typeof global.LensView.dominanceClause === 'function') {
      try { return global.LensView.dominanceClause(dominance || null); } catch (e) { /* fall through */ }
    }
    return dominance && dominance.kind ? dominance.kind : 'unsealed — the barrier has not run';
  }

  // ── Bookmarks ───────────────────────────────────────────────────────────

  /** THE BOOKMARKS ARE A PREFERENCE (docs/design/ux/12-PREFERENCES.md §4):
   *  deliberately set, per operator, about no single session. They live in
   *  the store under `review.marks`, whose `opaque` type checks that what
   *  comes back is JSON and leaves the shape to this file — which is the one
   *  thing the old reader never did. A page with no store keeps the panel
   *  working for the session. */
  function prefs() {
    return global.Prefs && typeof global.Prefs.get === 'function' ? global.Prefs : null;
  }

  function readMarks() {
    var P = prefs();
    var all = P ? P.get(MARKS_KEY) : null;
    return all && typeof all === 'object' ? all : {};
  }

  function writeMarks(all) {
    var P = prefs();
    if (P) P.set(MARKS_KEY, all);   // private mode / quota — a bookmark is a convenience
  }

  function marksFor(gameId) {
    var all = readMarks();
    return Array.isArray(all[gameId]) ? all[gameId] : [];
  }

  function toggleMark(gameId, turn, focus) {
    var all = readMarks();
    var list = Array.isArray(all[gameId]) ? all[gameId].slice() : [];
    var at = -1;
    for (var i = 0; i < list.length; i++) if (list[i].turn === turn) { at = i; break; }
    if (at >= 0) list.splice(at, 1);
    else list.push({ turn: turn, focus: focus || null, at: Date.now() });
    list.sort(function (a, b) { return a.turn - b.turn; });
    all[gameId] = list;
    // Bounded across games, oldest game first, like `centaur.lastTurn` is.
    var keys = Object.keys(all);
    var total = 0;
    keys.forEach(function (k) { total += (all[k] || []).length; });
    while (total > MARKS_CAP && keys.length > 1) {
      var drop = keys.shift();
      total -= (all[drop] || []).length;
      delete all[drop];
    }
    writeMarks(all);
    return at < 0;
  }

  // ── Links ───────────────────────────────────────────────────────────────

  function reviewHash(gameId, turn, focus) {
    var bits = ['game=' + encodeURIComponent(gameId)];
    if (Number.isFinite(turn)) bits.push('turn=' + turn);
    if (focus) bits.push('focus=' + encodeURIComponent(focus));
    return '#' + bits.join('&');
  }

  function reviewUrl(gameId, turn, focus) {
    return global.location.origin + global.location.pathname + reviewHash(gameId, turn, focus);
  }

  /** The other half: the lens itself, at the turn, with the unit named.
   *  `replay-deeplink.js` honours `#turn=` and carries `focus=` through its
   *  own `replaceState`, so a pasted link still names the unit after the
   *  recipient has scrubbed. */
  function lensUrl(gameId, turn, focus) {
    var base = '/game/' + encodeURIComponent(gameId);
    if (!Number.isFinite(turn)) return base;
    return base + '#turn=' + turn + (focus ? '&focus=' + encodeURIComponent(focus) : '');
  }

  function readHash() {
    var h = String(global.location.hash || '');
    var get = function (name) {
      var m = new RegExp('(?:^|[#&])' + name + '=([^&]*)').exec(h);
      if (!m) return null;
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    };
    var turn = get('turn');
    return { game: get('game'), turn: turn === null ? null : parseInt(turn, 10), focus: get('focus') };
  }

  // ── Fetching ────────────────────────────────────────────────────────────

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' → ' + r.status);
      return r.json();
    });
  }

  function revive(events) {
    if (global.LensView && typeof global.LensView.reviveEvents === 'function') {
      try { return global.LensView.reviveEvents(events); } catch (e) { /* raw is still readable */ }
    }
    return events;
  }

  /** The shipped view bundle, on demand. `/history` is a listing and must not
   *  pay 58 KB for a panel nobody opened; a review cannot be read without it. */
  var bundle = null;
  function lensBundle() {
    if (bundle) return bundle;
    bundle = new Promise(function (resolve) {
      if (global.LensView) return resolve(global.LensView);
      var s = document.createElement('script');
      s.src = '/lens-view.js';
      s.onload = function () { resolve(global.LensView || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return bundle;
  }

  function logsUrl(gameId, params) {
    var q = ['gameId=' + encodeURIComponent(gameId)];
    Object.keys(params || {}).forEach(function (k) {
      q.push(k + '=' + encodeURIComponent(params[k]));
    });
    return '/api/logs?' + q.join('&');
  }

  // ── The panel ───────────────────────────────────────────────────────────

  var el = {};                 // the panel's elements, once built
  var state = null;            // the open review, or null

  function build(root) {
    root.innerHTML =
      '<div class="review-head">' +
        '<button type="button" class="rv-back" id="rvBack">← all games</button>' +
        '<h2 class="rv-verdict" id="rvVerdict"></h2>' +
        '<span class="rv-read" id="rvRead"></span>' +
        '<span class="mono rv-id" id="rvId"></span>' +
      '</div>' +
      '<div class="rv-stripwrap">' +
        '<ol class="rv-strip" id="rvStrip" aria-label="Every turn of the game; the marked ones are the moments"></ol>' +
        '<div class="rv-legend" id="rvLegend"></div>' +
      '</div>' +
      '<div class="rv-body">' +
        '<div class="rv-side">' +
          '<h3 class="rv-h">Moments <span class="rv-hint">j / k</span></h3>' +
          '<ol class="rv-list" id="rvList"></ol>' +
          '<h3 class="rv-h">Bookmarks <span class="rv-hint">b</span></h3>' +
          '<ol class="rv-marks" id="rvMarks"></ol>' +
        '</div>' +
        '<div class="rv-main">' +
          '<div class="rv-turnbar">' +
            '<span class="rv-turn" id="rvTurn"></span>' +
            '<span class="rv-lead" id="rvLead"></span>' +
            '<span class="grow"></span>' +
            '<button type="button" class="rv-btn" id="rvMark">☆ bookmark</button>' +
            '<a class="rv-btn" id="rvLens" href="#">open in the lens ↗</a>' +
            '<button type="button" class="rv-btn" id="rvEmbed">embed the lens</button>' +
          '</div>' +
          '<div class="rv-share">' +
            '<label for="rvLink">this turn, as a link</label>' +
            '<input class="rv-link" id="rvLink" readonly spellcheck="false">' +
            '<button type="button" class="rv-btn" id="rvCopy">copy <span class="rv-hint">y</span></button>' +
            '<span class="rv-said" id="rvSaid" role="status"></span>' +
          '</div>' +
          '<div class="rv-why" id="rvWhy"></div>' +
          '<div class="rv-embed" id="rvFrame"></div>' +
        '</div>' +
      '</div>';

    el = {
      root: root,
      back: root.querySelector('#rvBack'),
      verdict: root.querySelector('#rvVerdict'),
      read: root.querySelector('#rvRead'),
      id: root.querySelector('#rvId'),
      strip: root.querySelector('#rvStrip'),
      legend: root.querySelector('#rvLegend'),
      list: root.querySelector('#rvList'),
      marks: root.querySelector('#rvMarks'),
      turn: root.querySelector('#rvTurn'),
      lead: root.querySelector('#rvLead'),
      mark: root.querySelector('#rvMark'),
      lens: root.querySelector('#rvLens'),
      embed: root.querySelector('#rvEmbed'),
      link: root.querySelector('#rvLink'),
      copy: root.querySelector('#rvCopy'),
      said: root.querySelector('#rvSaid'),
      why: root.querySelector('#rvWhy'),
      frame: root.querySelector('#rvFrame'),
    };

    el.legend.innerHTML = Object.keys(RULES).map(function (k) {
      return '<span class="rv-key rv-' + RULES[k].tone + '"><span class="rv-glyph">' +
        RULES[k].glyph + '</span>' + esc(RULES[k].label) + '</span>';
    }).join('');

    el.back.addEventListener('click', function () { close(); });
    el.mark.addEventListener('click', function () { bookmark(); });
    el.copy.addEventListener('click', function () { copyLink(); });
    el.embed.addEventListener('click', function () { toggleEmbed(); });
    el.strip.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.rv-cell');
      if (b) goTurn(Number(b.dataset.turn));
    });
    el.list.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.rv-moment');
      if (b) {
        state.cursor = Number(b.dataset.index);
        goTurn(state.moments[state.cursor].turn, state.moments[state.cursor].unit, true);
      }
    });
    el.marks.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.rv-markrow');
      if (b) goTurn(Number(b.dataset.turn), b.dataset.focus || null);
    });
    el.why.addEventListener('click', function (e) {
      var c = e.target.closest && e.target.closest('[data-cluster]');
      if (c) { state.cluster = c.dataset.cluster; renderTurn(); return; }
      var b = e.target.closest && e.target.closest('[data-focus]');
      if (b) { state.focus = b.dataset.focus; renderTurn(); }
    });
  }

  // ── Opening and closing ─────────────────────────────────────────────────

  function open(group, want) {
    var root = document.getElementById('reviewPanel');
    if (!root) return;
    if (!el.root) build(root);
    root.hidden = false;
    var list = document.getElementById('gameContainer');
    var bar = document.querySelector('.list-bar');
    if (list) list.hidden = true;
    if (bar) bar.hidden = true;

    state = {
      group: group,
      gameId: group.game_id,
      turns: [],
      leads: [],
      side: null,
      operatorEvents: [],
      deepMoments: [],
      deepRead: {},          // turn -> true once its whole log was read
      logs: {},              // turn -> revived events
      moments: [],
      all: [],
      byTurn: {},
      turn: want && Number.isFinite(want.turn) ? want.turn : null,
      focus: (want && want.focus) || null,
      cursor: -1,
      cluster: null,
      embed: false,
      loading: true,
    };

    el.id.textContent = group.game_id;
    el.verdict.textContent = 'reading the game…';
    el.read.textContent = '';
    el.strip.innerHTML = '';
    el.list.innerHTML = '';
    el.why.innerHTML = '<div class="rv-empty">reading the stored log…</div>';
    writeHash();

    lensBundle().then(loadIndex).then(function () {
      state.loading = false;
      recompute();
      if (state.turn === null) {
        // WHERE IT WAS DECIDED, on arrival — that is the question the reviewer
        // opened the game with, and landing on turn 1 makes them ask it again.
        // The lead is off the boards, so this is known after the index pass
        // and does not wait for the deep one.
        var d = decidedAt();
        state.turn = d ? d.turn
          : (state.moments.length > 0 ? state.moments[0].turn
            : (state.turns.length > 0 ? state.turns[0].turn : null));
        syncCursor();
      } else {
        syncCursor();
      }
      render();
      return deepen();
    }).catch(function (err) {
      console.error('[review] failed:', err);
      el.verdict.textContent = 'could not read this game';
      el.why.innerHTML = '<div class="rv-empty">The store did not answer: ' +
        esc(err && err.message) + '</div>';
    });
  }

  function close() {
    if (el.root) el.root.hidden = true;
    var list = document.getElementById('gameContainer');
    var bar = document.querySelector('.list-bar');
    if (list) list.hidden = false;
    if (bar) bar.hidden = false;
    state = null;
    try { global.history.replaceState(null, '', global.location.pathname); } catch (e) { /* fine */ }
  }

  function loadIndex() {
    var id = state.gameId;
    var kinds = ['turn.resolved'].concat(OPERATOR_KINDS);
    return Promise.all([
      getJson('/api/games/' + encodeURIComponent(id) + '/turns'),
    ].concat(kinds.map(function (kind) {
      return getJson(logsUrl(id, { kind: kind, limit: LOG_LIMIT })).catch(function () { return { events: [] }; });
    }))).then(function (answers) {
      var timeline = answers[0] || {};
      state.turns = (timeline.turns || []).slice().sort(function (a, b) { return a.turn - b.turn; });
      state.side = ourSideOf(state.group, state.turns);
      state.leads = leadSeries(state.turns, state.side);

      var seen = {};
      var ops = [];
      answers.slice(1).forEach(function (answer) {
        revive((answer && answer.events) || []).forEach(function (e) {
          if (!e || OPERATOR_KINDS.indexOf(e.kind) < 0) return;
          // The harness answers `/api/logs` for any game and ignores `kind`;
          // production filters in SQL. Filtering here too costs nothing and
          // makes the two answer the same question.
          if (e.gameId && e.gameId !== state.gameId) return;
          var key = e.turn + ':' + e.seq;
          if (seen[key]) return;
          seen[key] = true;
          ops.push(e);
        });
      });
      ops.sort(function (a, b) { return a.turn - b.turn || a.seq - b.seq; });
      state.operatorEvents = ops;
    });
  }

  /** One turn's whole log, cached. The only fetch that can be large, and it is
   *  the same one the replay path already makes for a turn. */
  function loadTurn(turn) {
    if (state.logs[turn]) return Promise.resolve(state.logs[turn]);
    return getJson(logsUrl(state.gameId, { startTurn: turn, endTurn: turn, limit: TURN_LIMIT }))
      .then(function (answer) {
        var events = revive((answer && answer.events) || []).filter(function (e) {
          return e && e.turn === turn && (!e.gameId || e.gameId === state.gameId);
        });
        events.sort(function (a, b) { return a.seq - b.seq; });
        state.logs[turn] = events;
        if (!state.deepRead[turn]) {
          state.deepRead[turn] = true;
          state.deepMoments = state.deepMoments.concat(deepMomentsFor(turn, events));
          recompute();
        }
        return events;
      });
  }

  /**
   * The bounded background pass. It reads the turns the index already flagged
   * first — those are where a reviewer is going — then walks the game in
   * order until the budget is spent, and stops. What it did not read is drawn
   * as unread on the strip, because a strip that drew an unread turn as an
   * empty one would be asserting a fact it never checked.
   */
  function deepen() {
    var wanted = [];
    var push = function (t) { if (wanted.indexOf(t) < 0 && !state.deepRead[t]) wanted.push(t); };
    state.moments.forEach(function (m) { push(m.turn); });
    state.turns.forEach(function (row) { push(row.turn); });
    var queue = wanted.slice(0, DEEP_BUDGET);
    var at = 0;
    var next = function () {
      if (state === null || at >= queue.length) { renderRead(); return Promise.resolve(); }
      var t = queue[at++];
      return loadTurn(t).catch(function () { state.deepRead[t] = true; }).then(function () {
        if (state === null) return;
        renderStrip();
        renderList();
        renderRead();
        return next();
      });
    };
    return next();
  }

  function recompute() {
    if (state === null) return;
    var all = indexMoments(state);
    state.all = all;
    // The LIST is the index — the turns that stood out. The STRIP is every
    // hit, the quiet ones drawn dim, so what was cut is still visible and
    // still reachable with `h` / `l`.
    state.moments = all.filter(function (m) { return m.kept; });
    var by = {};
    all.forEach(function (m) { (by[m.turn] = by[m.turn] || []).push(m); });
    state.byTurn = by;
    syncCursor();
  }

  function syncCursor() {
    if (state.turn === null) return;
    var found = -1;
    for (var i = 0; i < state.moments.length; i++) {
      if (state.moments[i].turn === state.turn) { found = i; break; }
    }
    state.cursor = found;
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  function render() {
    renderVerdict();
    renderStrip();
    renderList();
    renderMarks();
    renderRead();
    renderTurn();
  }

  /** The headline: the outcome, and the turn the game was decided on — the
   *  last hand-over, or the largest single swing where it never changed
   *  hands. */
  function decidedAt() {
    var hand = null;
    var swing = null;
    state.moments.forEach(function (m) {
      if (m.rule === 'handover') hand = m;
      if (m.rule === 'swing' && (swing === null || m.weight > swing.weight)) swing = m;
    });
    if (hand) return { turn: hand.turn, why: 'the lead changed hands' };
    var best = null;
    for (var i = 1; i < state.leads.length; i++) {
      var d = Math.abs(state.leads[i].lead - state.leads[i - 1].lead);
      if (best === null || d > best.d) best = { d: d, turn: state.leads[i].turn };
    }
    if (best && best.d > 0) return { turn: best.turn, why: 'the biggest single swing in the lead' };
    return null;
  }

  function renderVerdict() {
    var g = state.group;
    var oc = global.HistoryOutcome ? global.HistoryOutcome(g) : { word: 'Game', mark: '·', cls: 'open' };
    var d = decidedAt();
    var last = state.leads.length > 0 ? state.leads[state.leads.length - 1] : null;
    el.verdict.className = 'rv-verdict outcome outcome-' + oc.cls;
    el.verdict.innerHTML =
      '<span aria-hidden="true">' + oc.mark + '</span>' + esc(oc.word) +
      '<span class="rv-sub"> · ' + state.turns.length + ' turns' +
      (last ? ' · final lead ' + fmtSigned(last.lead, 0) : '') +
      (d ? ' · decided at turn <b>' + d.turn + '</b> (' + esc(d.why) + ')' : '') +
      '</span>';
  }

  function renderRead() {
    var deep = Object.keys(state.deepRead).length;
    el.read.textContent = state.loading ? 'reading…'
      : deep + ' of ' + state.turns.length + ' turns read in full' +
        (deep < state.turns.length ? ' — the rest are indexed from the boards only' : '');
  }

  function renderStrip() {
    var cells = state.turns.map(function (row) {
      var t = row.turn;
      // THE CELL'S GLYPH IS THE CONCRETE READING FIRST. A turn where a unit
      // died reads as a death even when a leader also changed on it: a death
      // is a fact about the game and the other rules are facts about the
      // search, and a reviewer scanning the strip is looking for the first.
      var here = (state.byTurn[t] || []).slice().sort(function (a, b) {
        return (ALWAYS[b.rule] ? 1 : 0) - (ALWAYS[a.rule] ? 1 : 0) ||
          b.weight - a.weight || b.score - a.score;
      });
      var top = here[0] || null;
      var cls = ['rv-cell'];
      if (t === state.turn) cls.push('rv-at');
      if (top) cls.push('rv-' + top.tone, 'rv-w' + (top.kept ? top.weight : 1));
      else cls.push(state.deepRead[t] ? 'rv-none' : 'rv-unread');
      var label = here.length > 0
        ? 'turn ' + t + (top.kept ? ': ' : ' (quieter than the rest): ') +
          here.map(function (m) { return m.headline; }).join('; ')
        : 'turn ' + t + (state.deepRead[t] ? ': nothing' : ': not read in full');
      return '<li><button type="button" class="' + cls.join(' ') + '" data-turn="' + t +
        '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
        '<span class="rv-glyph" aria-hidden="true">' + (top ? top.glyph : '·') + '</span>' +
        '</button></li>';
    });
    el.strip.innerHTML = cells.join('');
  }

  function renderList() {
    if (state.moments.length === 0) {
      el.list.innerHTML = '<li class="rv-empty">No moment fired. Every turn is on the strip; ' +
        '<kbd>h</kbd> <kbd>l</kbd> walk them.</li>';
      return;
    }
    var quiet = (state.all || []).length - state.moments.length;
    el.list.innerHTML = state.moments.map(function (m, i) {
      return '<li><button type="button" class="rv-moment rv-' + m.tone +
        (i === state.cursor ? ' rv-at' : '') + '" data-index="' + i + '">' +
        '<span class="rv-glyph" aria-hidden="true">' + m.glyph + '</span>' +
        '<span class="rv-mturn">' + m.turn + '</span>' +
        '<span class="rv-mhead">' + esc(m.headline) + '</span>' +
        '<span class="rv-mdet">' + esc(m.detail) + '</span>' +
        '</button></li>';
    }).join('') + (quiet > 0
      ? '<li class="rv-empty">' + quiet + ' quieter reading' + (quiet === 1 ? '' : 's') +
        ' did not make the cut; they are on the strip, dim, and <kbd>h</kbd> <kbd>l</kbd> ' +
        'still walk to them.</li>'
      : '');
  }

  function renderMarks() {
    var marks = marksFor(state.gameId);
    if (marks.length === 0) {
      el.marks.innerHTML = '<li class="rv-empty">None yet. <kbd>b</kbd> marks the turn you are on; ' +
        'the mark lives in this browser.</li>';
      return;
    }
    el.marks.innerHTML = marks.map(function (m) {
      return '<li><button type="button" class="rv-markrow" data-turn="' + m.turn +
        '" data-focus="' + esc(m.focus || '') + '">★ turn ' + m.turn +
        (m.focus ? ' · ' + esc(m.focus) : '') + '</button></li>';
    }).join('');
  }

  function renderTurn() {
    var t = state.turn;
    if (t === null) { el.why.innerHTML = '<div class="rv-empty">This game stored no boards.</div>'; return; }
    var lead = null;
    var prev = null;
    for (var i = 0; i < state.leads.length; i++) {
      if (state.leads[i].turn === t) { lead = state.leads[i]; prev = state.leads[i - 1] || null; }
    }
    el.turn.innerHTML = 'turn <b>' + t + '</b> of ' + (state.turns.length ? state.turns[state.turns.length - 1].turn : t) +
      ' <span class="rv-hint">h / l</span>';
    el.lead.textContent = lead
      ? 'lead ' + fmtSigned(lead.lead, 0) + (prev ? ' (Δ ' + fmtSigned(lead.lead - prev.lead, 0) + ')' : '') +
        ' · us ' + lead.ours + ' vs ' + lead.rival
      : '';
    el.link.value = reviewUrl(state.gameId, t, state.focus);
    el.lens.href = lensUrl(state.gameId, t, state.focus);
    var marked = marksFor(state.gameId).some(function (m) { return m.turn === t; });
    el.mark.textContent = (marked ? '★ bookmarked' : '☆ bookmark');
    el.mark.classList.toggle('rv-on', marked);
    writeHash();
    renderStrip();
    renderList();

    var events = state.logs[t];
    if (!events) {
      el.why.innerHTML = '<div class="rv-empty">reading turn ' + t + '…</div>';
      loadTurn(t).then(function () { if (state && state.turn === t) renderTurn(); })
        .catch(function (err) {
          if (state && state.turn === t) {
            el.why.innerHTML = '<div class="rv-empty">turn ' + t + ' has no stored log: ' +
              esc(err && err.message) + '</div>';
          }
        });
      return;
    }
    el.why.innerHTML = whyHtml(t, events);
    if (state.embed) mountEmbed();
  }

  // ── The why panel ───────────────────────────────────────────────────────

  /**
   * Six readings, in the order 07-REVIEW §1.4 sets: what it did, the number
   * with its premise, the breakdown by member and unit, the runner-up, the
   * foil, and the threats. All six off the rows this turn already wrote.
   */
  function whyHtml(turn, events) {
    var row = null;
    for (var i = 0; i < state.turns.length; i++) if (state.turns[i].turn === turn) row = state.turns[i];
    var board = boardOf(row);

    var frames = events.filter(function (e) { return e.kind === 'movesets'; });
    if (frames.length === 0) {
      return '<div class="rv-empty"><b>No decision was recorded for turn ' + turn + '.</b> ' +
        'The boards are stored forever and the event log is a hot window ' +
        '(<code>/api/logs/old</code> keeps seven days), so a turn this old is ' +
        'indexed from its board and nothing else. ' + resolvedHtml(events, board) + '</div>';
    }

    // The cluster the decision ended on: the last `movesets` frame, and where
    // several clusters were live, the one whose leader is staged.
    var byCluster = {};
    frames.forEach(function (e) {
      var c = e.payload.cluster;
      byCluster[c] = byCluster[c] || [];
      byCluster[c].push(e);
    });
    var drilled = {};
    events.forEach(function (e) {
      if (e.kind === 'breakdown' && e.payload) drilled[e.payload.moveset] = true;
    });
    // A turn decides every live cluster, and one panel can only be about one
    // of them. The default is the cluster with the most to say — the one whose
    // leader was drilled during the game, else the widest, else the staged one
    // — and the rest are one click away rather than invisible.
    var clusters = Object.keys(byCluster).sort(function (a, b) { return Number(a) - Number(b); });
    var scoreOf = function (c) {
      var top = rankOne(byCluster[c][byCluster[c].length - 1]);
      if (!top) return -1;
      return (drilled[top.key] ? 100 : 0) + (top.moves || []).length * 2 + (top.staged ? 1 : 0);
    };
    var pick = clusters[0];
    clusters.forEach(function (c) { if (scoreOf(c) > scoreOf(pick)) pick = c; });
    if (state.cluster !== null && byCluster[state.cluster]) pick = state.cluster;
    var last = byCluster[pick][byCluster[pick].length - 1];
    var chosen = rankOne(last);
    var second = rankN(last, 2);
    var rows = rowsOf(last);
    if (chosen === null) return '<div class="rv-empty">The last frame of turn ' + turn + ' carried no rows.</div>';

    var breakdowns = {};
    events.forEach(function (e) {
      if (e.kind === 'breakdown' && e.payload) breakdowns[e.payload.moveset] = e.payload;
    });
    var conditionals = events.filter(function (e) { return e.kind === 'conditional'; });

    // THE FOIL — not the runner-up. The highest-ranked row whose dominance
    // NAMES a threat is what the leader is betting against, and in a turn
    // where that is rank 5, rank 5 is the row the reviewer wants.
    var foil = null;
    for (var f = 0; f < rows.length; f++) {
      var d = rows[f].dominance;
      if (rows[f].key === chosen.key) continue;
      if (d && (d.kind === 'refuted-by-witness' || d.kind === 'contingent')) { foil = rows[f]; break; }
    }

    var picker = clusters.length < 2 ? '' :
      '<div class="rv-clusters">this turn decided ' + clusters.length + ' clusters: ' +
      clusters.map(function (c) {
        var top = rankOne(byCluster[c][byCluster[c].length - 1]);
        return '<button type="button" class="rv-cbtn' + (String(c) === String(pick) ? ' rv-on' : '') +
          '" data-cluster="' + esc(c) + '">cluster ' + esc(c) + ' · ' +
          ((top && top.moves) || []).length + ' units</button>';
      }).join('') + '</div>';

    return '' +
      '<div class="rv-sentence">' + esc(sentenceOf(chosen, second, turn)) + '</div>' +
      picker +
      '<div class="rv-cards">' +
        card('what it played', chosenHtml(chosen, last, board, events)) +
        card('the number, with its premise', numbersHtml(chosen)) +
        card('the breakdown, by member and unit', breakdownHtml(chosen, breakdowns, rows, board)) +
        card('the runner-up', runnerHtml(chosen, second, board)) +
        card('the foil — what it is betting against', foilHtml(chosen, foil, second, board)) +
        card('the threats', threatHtml(chosen, board)) +
        card('the conditional rankings', conditionalHtml(conditionals, board)) +
      '</div>';
  }

  function card(title, body) {
    return '<section class="rv-card"><h4>' + esc(title) + '</h4>' + body + '</section>';
  }

  function sentenceOf(chosen, second, turn) {
    var members = (chosen.moves || []).length;
    var margin = second === null ? null : num(chosen.lo) - num(second.lo);
    return 'On turn ' + turn + ' it played a ' + members + '-unit moveset priced ' +
      fmtNum(chosen.lo) + ' … ' + fmtNum(chosen.hi) +
      ' on the ' + (chosen.channel === 'lo' ? 'proved floor' : 'advisory') + ' channel' +
      (margin === null ? ', with nothing else on the list.'
        : ', ' + (Math.abs(margin) < 0.005 ? 'level with' : 'ahead of') + ' the runner-up by ' +
          fmtNum(margin) + '.');
  }

  function chosenHtml(chosen, frame, board, events) {
    var moves = chosen.moves || [];
    var outcome = {};
    events.forEach(function (e) {
      if (e.kind === 'turn.resolved' && e.payload && e.payload.moves) {
        e.payload.moves.forEach(function (m) { outcome[m.unit] = m.to; });
      }
    });
    var staged = {};
    events.forEach(function (e) {
      if ((e.kind === 'stage.requested' || e.kind === 'stage.fastpass' || e.kind === 'stage.confirmed') &&
          e.payload && e.payload.unit != null) staged[e.payload.unit] = e.payload.to;
    });
    var body = moves.map(function (m) {
      var res = outcome[m.unit];
      var stg = staged[m.unit];
      var agree = res == null || num(res) === num(m.to);
      return '<tr' + (state.focus === m.unit ? ' class="rv-focus"' : '') + '>' +
        '<td><button type="button" class="rv-unit" data-focus="' + esc(m.unit) + '">' + esc(m.unit) + '</button></td>' +
        '<td>' + fmtCell(m.to, board) + '</td>' +
        '<td>' + ((m.path || []).length ? (m.path.length - 1) + ' step' + (m.path.length === 2 ? '' : 's') : '—') + '</td>' +
        '<td>' + (stg == null ? '—' : fmtCell(stg, board)) + '</td>' +
        '<td class="' + (agree ? '' : 'rv-differs') + '">' + (res == null ? '—' : fmtCell(res, board)) +
          (agree ? '' : ' ✕') + '</td></tr>';
    }).join('');
    return '<table class="rv-table"><thead><tr><th>unit</th><th>assigns</th><th>path</th>' +
      '<th>staged</th><th>resolved</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="5">this row assigns nothing</td></tr>') + '</tbody></table>' +
      '<p class="rv-note">cluster ' + esc(frame.payload.cluster) + ' · generation ' +
      esc(chosen.generation) + ' · rung <code>' + esc(chosen.rung) + '</code> · ' +
      (chosen.staged ? 'this row was staged' : 'this row was not the staged one') +
      ' · <code>' + esc(shortKey(chosen.key)) + '</code></p>';
  }

  function numbersHtml(row) {
    if (row.unpriced) {
      return '<p class="rv-note"><b>Unpriced.</b> This is an assignment with no bound: ' +
        '<code>conform</code> returns a plan, not a price. Every numeric column is <b>—</b>, ' +
        'which is the reading a number that was never computed gets.</p>';
    }
    var d = row.depth || {};
    var h1 = d.h1 || {};
    var deep = d.deepest || {};
    var delta = d.delta || {};
    return '<table class="rv-table"><tbody>' +
      '<tr><th>bracket</th><td><b>' + fmtNum(row.lo) + '</b> … ' + fmtNum(row.est) + ' … <b>' +
        fmtNum(row.hi) + '</b> <span class="rv-note">width ' +
        fmtNum(num(row.hi) - num(row.lo)) + '</span></td></tr>' +
      '<tr><th>adjudicates on</th><td>' + esc(row.channel) +
        (row.channel === 'est' ? ' — the channel that never decides on its own' : ' — the proved floor') + '</td></tr>' +
      '<tr><th>exact</th><td>' + (row.exact ? 'yes' : 'no') + ' · ledger ' + esc(row.ledgerSize) + '</td></tr>' +
      '<tr><th>depth</th><td>h' + esc(h1.horizon == null ? 1 : h1.horizon) + ' → h' +
        esc(deep.horizon == null ? 1 : deep.horizon) +
        (deep.horizon > h1.horizon
          ? ' · Δlo ' + fmtSigned(delta.lo) + ' · Δhi ' + fmtSigned(delta.hi) +
            (d.derived ? ' · derived' : ' · hull, not derived')
          : ' · nothing deepened') + '</td></tr>' +
      '<tr><th>verdict</th><td>' + esc(clauseOf(row.dominance)) + '</td></tr>' +
      '<tr><th>fiber</th><td>basis <code>' + esc(shortKey(row.basis)) + '</code> · complement <code>' +
        esc(shortKey(row.complementKey)) + '</code> · ' + esc(row.complement || 'live') +
        ' · seen in ' + esc(row.seenIn) + ' plans</td></tr>' +
      '</tbody></table>';
  }

  function featureRow(f) {
    return '<li><code>' + esc(f.key) + '</code> ' + fmtNum(f.contribution ? f.contribution.est : f.delta && f.delta.est) + '</li>';
  }

  function breakdownHtml(chosen, breakdowns, rows, board) {
    var payload = breakdowns[chosen.key] || null;
    var about = null;
    // The row an operator drilled live is the row the leader WAS when they
    // pressed `B`, and the leader moves. Where the chosen row carries no
    // breakdown, another row of the same list often does, and that breakdown
    // is a real fact about this decision — drawn, and labelled as being about
    // a different row, which is not the same as drawing it as the chosen
    // row's own.
    if (payload === null) {
      for (var r = 0; r < rows.length && about === null; r++) {
        if (breakdowns[rows[r].key]) { about = rows[r]; payload = breakdowns[rows[r].key]; }
      }
    }
    if (!payload) {
      return '<p class="rv-note"><b>Nobody priced any row of this list during the game.</b> A ' +
        'breakdown is an answer to a question an operator asked (<kbd>B</kbd> in the lens), and ' +
        'it is stored only where one was asked. The review does not run the evaluator to ' +
        'manufacture one — open the turn in the lens and drill it there.</p>';
    }
    var note = about === null ? '' :
      '<p class="rv-clause">This is rank ' + esc(about.rank) + '\u2019s breakdown, not rank 1\u2019s: ' +
      'the leader moved after the operator drilled. <code>' + esc(shortKey(about.key)) + '</code></p>';
    var agg = payload.aggregate;
    var head = agg
      ? '<p class="rv-note">level 1 · profile <code>' + esc(agg.profile) + '</code> · ' +
        fmtNum(agg.bound && agg.bound.lo) + ' … ' + fmtNum(agg.bound && agg.bound.hi) +
        ' · ' + (agg.exact ? 'exact' : 'inexact') + '</p>' +
        '<ul class="rv-feats">' + (agg.features || []).slice(0, 5).map(featureRow).join('') + '</ul>'
      : '<p class="rv-note">The evaluator does not explain — level 1 is genuinely absent, ' +
        'which is not the same as zero.</p>';

    var members = (payload.marginals || []).map(function (m) {
      return '<tr' + (state.focus === m.unit ? ' class="rv-focus"' : '') + '>' +
        '<td><button type="button" class="rv-unit" data-focus="' + esc(m.unit) + '">' + esc(m.unit) + '</button></td>' +
        '<td>' + fmtNum(m.delta && m.delta.lo) + ' … ' + fmtNum(m.delta && m.delta.hi) + '</td>' +
        '<td>vs ' + fmtCell(m.against && m.against.to, board) + '</td>' +
        '<td>' + (m.features || []).slice(0, 3).map(function (f) {
          return '<code>' + esc(f.key) + '</code> ' + fmtNum(f.delta && f.delta.est);
        }).join(' · ') + '</td></tr>';
    }).join('');

    var res = payload.residual || {};
    return note + head +
      '<table class="rv-table"><thead><tr><th>member</th><th>contributes</th>' +
      '<th>priced against</th><th>top terms</th></tr></thead><tbody>' +
      (members || '<tr><td colspan="4">no member was drilled</td></tr>') +
      '<tr class="rv-residual"><th colspan="2">joint residual</th><td colspan="2">' +
      fmtNum(res.total && res.total.lo) + ' … ' + fmtNum(res.total && res.total.hi) +
      ' <span class="rv-note">aggregate − Σ marginals, drawn at zero too: a cluster exists ' +
      'because of cross terms</span></td></tr>' +
      '</tbody></table>';
  }

  function runnerHtml(chosen, second, board) {
    if (second === null) {
      return '<p class="rv-note">The list held one row. There was nothing else to play in this ' +
        'cluster at this generation — which is a reading, not an omission.</p>';
    }
    return '<p class="rv-note">rank 2 · <code>' + esc(shortKey(second.key)) + '</code> · ' +
      'Δlo ' + fmtSigned(num(second.lo) - num(chosen.lo)) +
      ' · Δest ' + fmtSigned(num(second.est) - num(chosen.est)) + '</p>' +
      '<p class="rv-clause">' + esc(clauseOf(second.dominance)) + '</p>' +
      diffTable(chosen, second, board);
  }

  function foilHtml(chosen, foil, second, board) {
    if (foil === null) {
      return '<p class="rv-note"><b>No row on this list names a threat.</b> Every one of them ' +
        (second === null
          ? 'there was — there was only the leader.'
          : 'reads <i>' + esc(clauseOf(second.dominance)) + '</i> or is unsealed.') +
        ' The runner-up is the only contrast this turn has, and it is above.</p>';
    }
    var isSecond = second !== null && foil.key === second.key;
    return '<p class="rv-note">rank ' + esc(foil.rank) + (isSecond ? ' — which is also the runner-up' : '') +
      ' · <code>' + esc(shortKey(foil.key)) + '</code> · Δlo ' +
      fmtSigned(num(foil.lo) - num(chosen.lo)) + '</p>' +
      '<p class="rv-clause">' + esc(clauseOf(foil.dominance)) + '</p>' +
      diffTable(chosen, foil, board);
  }

  /** Only where the two disagree — the board's own rule for a foil arrow. */
  function diffTable(a, b, board) {
    var mine = {};
    (a.moves || []).forEach(function (m) { mine[m.unit] = m.to; });
    var rows = (b.moves || []).filter(function (m) { return num(mine[m.unit]) !== num(m.to); })
      .map(function (m) {
        return '<tr><td>' + esc(m.unit) + '</td><td>' + fmtCell(mine[m.unit], board) +
          '</td><td>→ ' + fmtCell(m.to, board) + '</td></tr>';
      }).join('');
    return '<table class="rv-table"><thead><tr><th>unit</th><th>played</th><th>would have</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="3">the same assignment on every member</td></tr>') +
      '</tbody></table>';
  }

  /**
   * Threat cells where there are cells, and the absence drawn where there are
   * not. A `theirs` ply in the leader's line carries the enemy's own actions;
   * on a build that proves at h1 the line is empty by construction and
   * `Witness.replies` is a `Map`, which `lensStringify` writes as `{}` — the
   * certificate does not survive storage. So what is named is named, and what
   * is missing is said to be missing (01-RESEARCH P5).
   */
  function threatHtml(row, board) {
    var line = (row.depth && row.depth.line) || [];
    var theirs = line.filter(function (p) { return p.side === 'theirs'; });
    if (theirs.length > 0) {
      return '<table class="rv-table"><thead><tr><th>ply</th><th>their reply</th><th>bracket</th></tr></thead><tbody>' +
        theirs.map(function (p) {
          return '<tr><td>' + esc(p.ply) + '</td><td>' +
            (p.moves || []).map(function (m) { return esc(m.unit) + ' → ' + fmtCell(m.to, board); }).join(' · ') +
            '</td><td>' + fmtNum(p.lo) + ' … ' + fmtNum(p.hi) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    var cited = (row.citedUnits || []).slice();
    var dom = row.dominance;
    var onUnits = dom && dom.kind === 'contingent' ? (dom.onUnits || []) : [];
    return '<p class="rv-note"><b>No enemy cells are stored for this decision.</b> It proved at ' +
      'h1, so the line has no <code>theirs</code> ply to read cells off, and a witness\'s replies ' +
      'are a <code>Map</code> that JSON does not carry. What it does name:</p>' +
      '<ul class="rv-feats">' +
      '<li>cited by the ledger: ' +
      (cited.length ? cited.map(function (u) { return esc(namedUnit(u)); }).join(', ') : '<i>nothing</i>') + '</li>' +
      '<li>resolves against us: ' +
      (onUnits.length ? onUnits.map(function (u) { return esc(namedUnit(u)); }).join(', ') : '<i>nothing named</i>') +
      (dom && dom.kind === 'contingent' ? ' · ' + fmtNum(dom.atStake) + ' at stake' : '') + '</li>' +
      '<li>assumptions carried: ' + ((row.assumptions || []).length || 'none') + '</li>' +
      '</ul>';
  }

  function conditionalHtml(events, board) {
    if (events.length === 0) {
      return '<p class="rv-note">No conditional ranking was asked for on this turn. That list is ' +
        'the answer to "what would a lock here stage" and it exists only where somebody asked.</p>';
    }
    return events.map(function (e) {
      var p = e.payload || {};
      var rows = (p.rows || []).slice(0, 4);
      return '<p class="rv-note">cluster ' + esc(p.cluster) + ' · locks ' +
        ((p.locks || []).map(function (l) { return esc(l.unit) + '→' + fmtCell(l.to, board); }).join(', ') || 'none') +
        ' · source <code>' + esc(p.source) + '</code> · ' + (p.final ? 'closed' : 'open') +
        (p.truncated ? ' · truncated (' + esc(p.truncated.why) + ', ' + esc(p.truncated.notRanked) + ' unranked)' : '') +
        '</p><table class="rv-table"><thead><tr><th>#</th><th>assignment</th><th>bracket</th><th>unless</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + esc(r.rank) + '</td><td>' +
            (r.moves || []).map(function (m) { return esc(m.unit) + '→' + fmtCell(m.to, board); }).join(' · ') +
            '</td><td>' + (r.unpriced ? '—' : fmtNum(r.lo) + ' … ' + fmtNum(r.hi)) + '</td><td>' +
            esc(clauseOf(r.dominance)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }).join('');
  }

  function resolvedHtml(events, board) {
    var res = null;
    events.forEach(function (e) { if (e.kind === 'turn.resolved') res = e; });
    if (res === null) return '';
    return 'What resolved: ' + ((res.payload.moves || []).map(function (m) {
      return esc(m.unit) + ' → ' + fmtCell(m.to, board);
    }).join(' · ') || 'nothing');
  }

  // ── The lens, embedded ──────────────────────────────────────────────────

  function toggleEmbed() {
    state.embed = !state.embed;
    el.embed.textContent = state.embed ? 'hide the lens' : 'embed the lens';
    if (!state.embed) { el.frame.innerHTML = ''; return; }
    mountEmbed();
  }

  /** The shipped viewer, at the turn, in an iframe. It is the same page the
   *  link opens; embedding it costs a socket the reviewer did not ask for on
   *  a live game, so it is off until asked for and rebuilt on every move. */
  function mountEmbed() {
    var src = lensUrl(state.gameId, state.turn, state.focus);
    var frame = el.frame.querySelector('iframe');
    if (frame && frame.dataset.src === src) return;
    el.frame.innerHTML = '<iframe class="rv-iframe" title="the decision lens at turn ' +
      esc(state.turn) + '" src="' + esc(src) + '" data-src="' + esc(src) + '"></iframe>';
  }

  // ── Moving ──────────────────────────────────────────────────────────────

  function goTurn(turn, focus, keepCursor) {
    if (state === null || !Number.isFinite(turn)) return;
    var first = state.turns.length ? state.turns[0].turn : turn;
    var last = state.turns.length ? state.turns[state.turns.length - 1].turn : turn;
    if (state.turn !== turn) state.cluster = null;
    state.turn = Math.max(first, Math.min(last, turn));
    if (focus !== undefined) state.focus = focus;
    // A turn carries several moments; walking them must not be undone by
    // re-seating the cursor on the first one of the turn it landed on.
    if (!keepCursor) syncCursor();
    renderTurn();
  }

  function stepTurn(delta) {
    if (state === null || state.turns.length === 0) return;
    var at = 0;
    for (var i = 0; i < state.turns.length; i++) if (state.turns[i].turn === state.turn) at = i;
    var next = Math.max(0, Math.min(state.turns.length - 1, at + delta));
    goTurn(state.turns[next].turn, null);
  }

  function stepMoment(delta) {
    if (state === null || state.moments.length === 0) return;
    var at = state.cursor;
    if (at < 0) {
      // Not on a moment: go to the nearest one in the direction asked.
      at = delta > 0 ? -1 : state.moments.length;
      for (var i = 0; i < state.moments.length; i++) {
        if (delta > 0 && state.moments[i].turn > state.turn) { at = i - delta; break; }
        if (delta < 0 && state.moments[i].turn < state.turn) at = i - delta;
      }
    }
    var next = Math.max(0, Math.min(state.moments.length - 1, at + delta));
    state.cursor = next;
    goTurn(state.moments[next].turn, state.moments[next].unit, true);
  }

  function bookmark() {
    if (state === null || state.turn === null) return;
    var added = toggleMark(state.gameId, state.turn, state.focus);
    say(added ? 'bookmarked turn ' + state.turn : 'bookmark removed');
    renderMarks();
    renderTurn();
  }

  function copyLink() {
    if (state === null) return;
    var text = el.link.value;
    var done = function () { say('link copied'); };
    try {
      el.link.focus();
      el.link.select();
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(done); });
      } else {
        fallbackCopy(done);
      }
    } catch (e) { say('select the field and copy'); }
  }

  function fallbackCopy(done) {
    try { document.execCommand('copy'); done(); }
    catch (e) { say('select the field and copy'); }
  }

  var sayTimer = null;
  function say(text) {
    el.said.textContent = text;
    if (sayTimer) clearTimeout(sayTimer);
    // A status line that clears itself, in a fixed slot, so nothing under the
    // reviewer's cursor moves when it appears (01-RESEARCH P3).
    sayTimer = setTimeout(function () { el.said.textContent = ''; }, 2500);
  }

  function writeHash() {
    if (state === null) return;
    try {
      global.history.replaceState(null, '',
        global.location.pathname + reviewHash(state.gameId, state.turn, state.focus));
    } catch (e) { /* some embeddings refuse replaceState */ }
  }

  // ── Keys ────────────────────────────────────────────────────────────────
  // Registered through PageChrome, which runs page keys BEFORE the shared list
  // keys — so `j`/`k` are the moment walk while a review is open and stay the
  // list's own selection when it is not. The scheme is 02-IA §3.1's `vim`
  // column, because a review is a reading surface.

  function isOpen() {
    return state !== null && el.root && !el.root.hidden;
  }

  function bindKeys() {
    if (!global.PageChrome || !global.PageChrome.key) return;
    var on = function (k) {
      return function (e) { return isOpen() && e.key === k && !e.ctrlKey && !e.metaKey && !e.altKey; };
    };
    global.PageChrome.key(on('j'), function () { stepMoment(1); }, ['j / k', 'next / previous moment (in a review)']);
    global.PageChrome.key(on('k'), function () { stepMoment(-1); });
    global.PageChrome.key(on('l'), function () { stepTurn(1); }, ['h / l', 'previous / next turn (in a review)']);
    global.PageChrome.key(on('h'), function () { stepTurn(-1); });
    global.PageChrome.key(on('b'), function () { bookmark(); }, ['b', 'bookmark this turn']);
    global.PageChrome.key(on('y'), function () { copyLink(); }, ['y', 'copy the link to this turn']);
    global.PageChrome.key(on('Enter'), function () {
      global.location.href = lensUrl(state.gameId, state.turn, state.focus);
    }, ['Enter', 'open this turn in the lens']);
    global.PageChrome.key(on('Escape'), function () { close(); }, ['Esc', 'back to the list']);
  }

  var api = {
    open: open,
    close: close,
    isOpen: isOpen,
    bindKeys: bindKeys,
    readHash: readHash,
    reviewHash: reviewHash,
    lensUrl: lensUrl,
    marksFor: marksFor,
    // The pure half, named so a test can reach it without a DOM.
    leadOfTurn: leadOfTurn,
    leadSeries: leadSeries,
    indexMoments: indexMoments,
    deepMomentsFor: deepMomentsFor,
    RULES: RULES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Review = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
