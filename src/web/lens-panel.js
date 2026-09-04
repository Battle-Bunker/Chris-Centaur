/**
 * THE TRANSCRIPT DRIVER — draw calls in, rail markup and board ink out.
 *
 * The lens's view-model lives in `src/lens/view` and produces a DrawTranscript:
 * a flat list of `{op, args}` that says what the inspection surface shows at
 * one `(turn, seq)`. This file is the other half of that seam and it holds NO
 * lens logic whatsoever — it does not know what a cluster is, it cannot decide
 * which arrow is hollow, and it has no opinion about ranking. It maps ops to
 * DOM and to the board renderer's `lens` option, and that is all it does.
 *
 * Why the split is worth a file: the transcript is the thing the boundary test
 * compares between a live frame and a replayed one. If the page rendered from
 * the frame directly it could branch on the mode without anything noticing —
 * which is exactly what the ~900-line fork this replaces did. The page cannot
 * branch on what it cannot see, and what it can see is a list of draw calls
 * that came out identical from both sources.
 *
 * The lane is the one thing built here from events rather than from a
 * transcript, because a lane IS a view of events: ticks at their own `seq`,
 * snapped to events and never to pixels.
 */
const LensPanel = (() => {
  const ARGS = (call) => (call && call.args) || [];

  function firstOf(transcript, op) {
    return (transcript || []).find((c) => c.op === op) || null;
  }
  function allOf(transcript, op) {
    return (transcript || []).filter((c) => c.op === op);
  }

  function escapeHTML(text) {
    return String(text == null ? '' : text).replace(
      /[&<>"']/g,
      (ch) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  /**
   * A bound, as text. `+∞` is the lattice TOP — nothing is proved above the
   * incumbent yet — and `−∞` is the bottom this bot proves floors against;
   * both are ordinary readings here. Rendering them as `—` collapsed them into
   * "unmeasured", which is the exact distinction `lensStringify` / `reviveLens`
   * carry across the wire and the jsonb column to preserve. `—` is now reserved
   * for a number that genuinely is not there.
   */
  function num(value, places) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '—';
    if (value === Infinity) return '∞';
    if (value === -Infinity) return '−∞';
    return value.toFixed(places == null ? 2 : places);
  }

  function boundText(bound) {
    if (!bound || typeof bound !== 'object') return num(bound);
    return `${num(bound.lo)}…${num(bound.hi)}`;
  }

  /**
   * The board's ink, in the renderer's own vocabulary. Every mark here came
   * out of the transcript, so what the board draws and what the rail says are
   * the same statement — they cannot drift, because there is only one of them.
   */
  function inkFromTranscript(transcript) {
    if (!transcript || transcript.length === 0) return null;
    const clusters = new Map();
    const ensure = (id) => {
      if (!clusters.has(id)) clusters.set(id, { id, glyph: '', members: [], boundedBy: [] });
      return clusters.get(id);
    };

    for (const call of allOf(transcript, 'cluster.chip')) {
      const [unit, glyph, id] = ARGS(call);
      const cluster = ensure(id);
      cluster.glyph = glyph;
      if (!cluster.members.includes(unit)) cluster.members.push(unit);
    }
    // A bounded unit is named on the cluster it is bounding. There is exactly
    // one partition on a frame, so the first cluster owns them when the chip
    // carries no id of its own.
    const anyCluster = clusters.size > 0 ? clusters.values().next().value : null;
    for (const call of allOf(transcript, 'fixed.chip')) {
      const [unit, why, by, to] = ARGS(call);
      if (anyCluster) anyCluster.boundedBy.push({ unit, why, by, to });
    }

    const arrows = allOf(transcript, 'moveset.arrow').map((call) => {
      const [unit, to, style] = ARGS(call);
      return { unit, to, style };
    });
    const rings = allOf(transcript, 'moveset.ring').map((call) => {
      const [unit, to] = ARGS(call);
      return { unit, to };
    });
    const deltas = new Map(
      allOf(transcript, 'foil.delta').map((call) => [ARGS(call)[0], ARGS(call)[1]])
    );
    const foil = allOf(transcript, 'foil.arrow').map((call) => {
      const [unit, to] = ARGS(call);
      return { unit, to, delta: deltas.get(unit) };
    });

    if (clusters.size === 0 && arrows.length === 0 && rings.length === 0) return null;
    return { clusters: [...clusters.values()], arrows, rings, foil };
  }

  // ---------------------------------------------------------------- the rail

  function focusHTML(transcript) {
    const call = firstOf(transcript, 'panel.focus');
    if (!call) return '<div class="lens-empty">No unit focused — click one, or Tab.</div>';
    const [unit, kind, letter, health, weight, fixity, clusterId, members, free] = ARGS(call);
    return (
      `<div class="lens-focus-line"><b>${escapeHTML(letter || unit)}</b> ` +
      `${escapeHTML(kind || '')} · hp ${escapeHTML(health)} · wt ${escapeHTML(weight)}` +
      `<span class="lens-cluster">${clusterId == null ? 'unclustered' : `cluster ${escapeHTML(clusterId)}(${escapeHTML(members)})`}</span></div>` +
      `<div class="lens-sub">${escapeHTML(fixity || 'free')}${free ? ` · ${escapeHTML(free)}` : ''}</div>`
    );
  }

  function candidatesHTML(transcript) {
    const head = firstOf(transcript, 'panel.candidates');
    if (!head) return '';
    const [count, note] = ARGS(head);
    const rows = allOf(transcript, 'panel.candidates.row')
      .map((call) => {
        const [to, legal, aggregate, grade, disposition, incumbent, cursor] = ARGS(call);
        // NEVER A BARE NUMBER. An unpriced candidate reads `·` and an
        // estimated one `~`; pricing every candidate is one queen at several
        // times a whole decision, so the rail grades rather than guesses.
        const value = aggregate == null ? '·' : `${num(aggregate, 1)}${escapeHTML(grade)}`;
        // T3's other source: a click on the candidate cell.
        return (
          `<tr class="${cursor ? 'lens-row-cursor' : ''}" data-lens-candidate="${escapeHTML(to)}">` +
          `<td>${cursor ? '▸' : ''}</td><td>${escapeHTML(to)}</td>` +
          `<td>${value}</td>` +
          `<td>${incumbent ? 'incumbent' : escapeHTML(disposition || (legal ? '' : 'illegal'))}</td></tr>`
        );
      })
      .join('');
    return (
      `<div class="lens-panel-head">CANDIDATES · ${escapeHTML(count)} · ${escapeHTML(note)}</div>` +
      `<table class="lens-table">${rows}</table>`
    );
  }

  function depthHTML(cell) {
    if (!cell) return '';
    // The absence of depth is DRAWN, never omitted: on a bot that does not
    // look ahead every row reads `h1 ·`, and that is the honest display.
    const marks = (cell.marks || []).join('');
    const delta = cell.delta == null ? '' : ` ${cell.delta > 0 ? '+' : ''}${num(cell.delta, 1)}`;
    return `${escapeHTML(cell.label)} ${escapeHTML(marks)}${escapeHTML(delta)}`;
  }

  /** `▲was #1`, and the displaced badge on a row the cursor had to fall to. */
  function trailHTML(trail, staged) {
    const badges = [];
    if (staged) badges.push('<span class="lens-staged-flag">staged</span>');
    if (trail && trail.displaced) {
      badges.push('<span class="lens-displaced">your moveset is not in this list · [find it]</span>');
    } else if (trail && trail.wasRank !== trail.rank) {
      badges.push(
        `<span class="lens-trail">${trail.wasRank > trail.rank ? '▲' : '▼'}was #${escapeHTML(trail.wasRank)}</span>`
      );
    }
    return badges.length ? ` ${badges.join(' ')}` : '';
  }

  /**
   * The list's own provenance, in one line. `conditional` is the kernel's
   * answer to *"what would a lock here stage"*; `restricted` is the fallback —
   * the cluster's retained reservoir rows narrowed to the ones that assign
   * this candidate — and on a build that answers no conditionals it is what
   * the operator always reads. The count says how much was narrowed away, and
   * a list of one says why the walk keys do nothing.
   */
  function sourceLine(source, retained, shown) {
    if (source === 'conditional') {
      return `conditional list — the rows a lock here would stage${
        retained ? ` · ${escapeHTML(retained)} retained for the cluster` : ''
      }`;
    }
    if (source !== 'restricted') return '';
    const of = `${escapeHTML(shown)} of ${escapeHTML(retained)} retained rows play this candidate`;
    return shown <= 1
      ? `no conditional was answered — ${of}, so [ and ] have nowhere to go`
      : `no conditional was answered — ${of}`;
  }

  function movesetsHTML(transcript) {
    const empty = firstOf(transcript, 'panel.movesets.empty');
    if (empty) return `<div class="lens-empty">${escapeHTML(ARGS(empty)[0])}</div>`;
    const head = firstOf(transcript, 'panel.movesets');
    if (!head) return '';
    const [clusterId, members, bounded, seq, stale, source, retained] = ARGS(head);

    const rowCalls = allOf(transcript, 'panel.movesets.row');
    const rowCount = rowCalls.length;
    const rows = rowCalls
      .map((call) => {
        const [
          rank,
          key,
          aggregate,
          width,
          cell,
          delta,
          unless,
          assignment,
          complement,
          selected,
          staged,
          trail,
        ] = ARGS(call);
        // A stale complement is a row whose QUESTION changed while its answer
        // stayed sound: struck through, kept, never dropped.
        const cls = [
          selected ? 'lens-row-cursor' : '',
          complement === 'stale' ? 'lens-row-stale' : '',
          cell && cell.sorted === false ? 'lens-row-unsorted' : '',
        ]
          .filter(Boolean)
          .join(' ');
        // T6's other source: a click on the row. The row carries its key so
        // the page can issue the cursor transition; there are still NO pointer
        // handlers here and no hover behaviour at all, because T4 says hover
        // never commits the cursor.
        return (
          `<tr class="${cls}" data-lens-moveset="${escapeHTML(key)}">` +
          `<td>${selected ? '▸' : ''}${escapeHTML(rank)}</td>` +
          `<td>${num(aggregate, 1)} <span class="lens-width">⌈${num(width, 1)}⌉</span></td>` +
          `<td>${depthHTML(cell)}</td>` +
          `<td>${delta === 0 ? '—' : num(delta, 1)}</td>` +
          // THE `unless` CELL — what this moveset is betting on, per row. It is
          // drawn on the leader too, where it reads "leads on the proved
          // floor": a blank cell and a row that leads are different states.
          `<td class="lens-unless">${escapeHTML(unless || '')}</td>` +
          `<td>${(assignment || [])
            .map((m) => `<span class="lens-move">${escapeHTML(m)}</span>`)
            .join(' · ')}${trailHTML(trail, staged)}</td></tr>`
        );
      })
      .join('');

    const fixed = allOf(transcript, 'panel.movesets.fixed')
      .map((call) => {
        const [unit, to, why, by] = ARGS(call);
        return `<span class="lens-fixed">🔒 ${escapeHTML(unit)} → ${escapeHTML(to)} ${escapeHTML(why)}${by ? ` (${escapeHTML(by)})` : ''}</span>`;
      })
      .join(' ');

    // ALWAYS ONE LINE UNDER THE TABLE (§3.5). Where there is no rank 2 the
    // line says so and says why, rather than vanishing: the foil is the
    // highest-value cheap signal on the surface and a silent absence reads as
    // "there is nothing to compare", which is a different claim.
    const foilCall = firstOf(transcript, 'panel.foil');
    const foilArgs = ARGS(foilCall);
    const foil = !foilCall
      ? ''
      : foilArgs[0] == null
        ? `<div class="lens-foil lens-foil-absent">${escapeHTML(foilArgs[2])}</div>`
        : `<div class="lens-foil">foil #${escapeHTML(foilArgs[0])} · margin ${num(foilArgs[1], 1)} · ${escapeHTML(foilArgs[2])} · at ${escapeHTML(foilArgs[3])}</div>`;

    const lock = firstOf(transcript, 'affordance.lock');
    return (
      `<div class="lens-panel-head">MOVESETS · cluster ${escapeHTML(clusterId)} · ` +
      `${escapeHTML(members)} of ${escapeHTML(members + bounded)} free · seq ${escapeHTML(seq)}` +
      `${stale ? ' · <span class="lens-stale-flag">stale</span>' : ''}</div>` +
      // WHAT THE LIST IS. A `MOVESETS` head over a single row, with `[` and
      // `]` that go nowhere, reads as a broken table; it is a RESTRICTION of
      // the cluster's retained rows to the ones that play this candidate, and
      // saying so — with the retained count beside it — turns the shortness
      // into a fact the operator can check (10 §4 O1).
      `<div class="lens-list-source">${sourceLine(source, retained, rowCount)}</div>` +
      // THE LEGEND. Four tokens are on this table with no gloss anywhere, and
      // three of them mean something else elsewhere in the codebase. A reader
      // who has to be told what a column means is reading a number they
      // cannot check.
      `<div class="lens-legend">⌈w⌉ bracket width · h&lt;n&gt; horizon proved at · ` +
      `Q loud replies · unless what this row is betting on</div>` +
      `<table class="lens-table">${rows}</table>` +
      (fixed ? `<div class="lens-fixed-strip">${fixed}</div>` : '') +
      foil +
      (lock ? `<div class="lens-lock">${escapeHTML(ARGS(lock)[0])}</div>` : '')
    );
  }

  function breakdownHTML(transcript) {
    const pending = firstOf(transcript, 'panel.breakdown.pending');
    if (pending) {
      return `<div class="lens-empty">${escapeHTML(ARGS(pending)[1])}</div>`;
    }
    const head = firstOf(transcript, 'panel.breakdown');
    if (!head) return '';
    const rows = allOf(transcript, 'panel.breakdown.member')
      .map((call) => {
        const [unit, delta, against, features] = ARGS(call);
        const terms = (features || [])
          .map(([key, value]) => `${escapeHTML(key)} ${boundText(value)}`)
          .join(' · ');
        return (
          `<tr><td>${escapeHTML(unit)}</td><td>${boundText(delta)}</td>` +
          `<td class="lens-sub">vs ${escapeHTML(against)}</td><td>${terms}</td></tr>`
        );
      })
      .join('');

    // THE JOINT ROW IS MANDATORY, AND IT IS DRAWN AT ZERO. A cluster exists
    // because of cross terms; showing the members' deltas without the residual
    // shows a total that does not add up and hides the fact.
    const residualCall = firstOf(transcript, 'panel.breakdown.residual');
    const residual = residualCall
      ? `<tr class="lens-residual"><td>joint</td><td>${boundText(ARGS(residualCall)[0])}</td>` +
        `<td colspan="2">${escapeHTML(ARGS(residualCall)[2])}</td></tr>`
      : '';

    return (
      `<div class="lens-panel-head">BREAKDOWN · ${escapeHTML(ARGS(head)[1])}</div>` +
      `<table class="lens-table">${rows}${residual}</table>`
    );
  }

  function provenanceHTML(transcript) {
    const call = firstOf(transcript, 'panel.provenance');
    if (!call) return '';
    const [botId, behaviourId, evalVersion, guidanceId, emissionSeq, quanta] = ARGS(call);
    // A number without its evalVersion and its guidanceId is a cross-fiber
    // comparison waiting to happen, so this line is small and always.
    //
    // AND THE ABSENCE IS DRAWN. `provenanceOf` reads `evalVersion` out of the
    // kernel-options digest, and `TeamDecisionEngine.kernelOptions()` does not
    // carry one — so on every shipped frame this field is the empty string. It
    // used to render as a bare `·  ·`, a blank the reader has no reason to
    // notice, which is the same silence the depth column was told off for in
    // 09 §C1. `eval —` says the version is missing; a gap says nothing.
    return (
      `<div class="lens-provenance">${escapeHTML(botId)} · ${escapeHTML(behaviourId)} · ` +
      `${evalVersion ? escapeHTML(evalVersion) : 'eval \u2014'}` +
      `${guidanceId ? ` · ${escapeHTML(guidanceId)}` : ''} · ` +
      `e${escapeHTML(emissionSeq)} · ${escapeHTML(quanta)}q</div>`
    );
  }

  /**
   * THE WIDEN BANNER. Additive uncertainty is STAGED: a peer unlocking a unit
   * hands the operator a bigger problem than the one on their screen, and
   * swapping the table out from under a reader is the specific failure the
   * whole policy exists to prevent. The old list stays — struck through and
   * headed `stale @ seq n`, NEVER blanked — and the new one lands on one
   * gesture, or on a timer that is visible, pausable, suspended while the
   * drill panel is open, and queued behind a lock in flight.
   */
  function bannerHTML(notice, remainingMs) {
    if (!notice || !notice.gained) return '';
    const who = notice.by ? `${escapeHTML(notice.by)} released` : 'released';
    const timer = notice.suspended
      ? 'paused — you are reading the breakdown'
      : notice.queuedBehindLock
        ? 'will apply after your lock settles'
        : `auto ${Math.ceil((remainingMs == null ? notice.autoAcceptMs : remainingMs) / 1000)}s`;
    return (
      `<div class="lens-banner">⚑ ${who} ${escapeHTML(notice.gained.join(', '))} — ` +
      `cluster is now ${escapeHTML(notice.gained.length + (notice.members || 0))} units. ` +
      `<span class="lens-sub">${timer}</span>` +
      `<button type="button" data-lens-accept="1">Show</button></div>`
    );
  }

  /** A narrow is APPLIED and announced quietly: a footer note, no banner, no
   *  timer — every surviving moveset is still a valid picture of a smaller
   *  problem. */
  function narrowNoteHTML(note) {
    if (!note || !note.lost) return '';
    return (
      `<div class="lens-sub">${escapeHTML(note.lost.join(', '))} left the cluster — ` +
      `${escapeHTML(note.why)}${note.by ? ` by ${escapeHTML(note.by)}` : ''}</div>`
    );
  }

  /** The four panels, in the order the cursor descends them. */
  function railHTML(transcript) {
    return (
      `<section class="lens-panel lens-focus">${focusHTML(transcript)}</section>` +
      `<section class="lens-panel lens-candidates">${candidatesHTML(transcript)}</section>` +
      `<section class="lens-panel lens-movesets">${movesetsHTML(transcript)}</section>` +
      `<section class="lens-panel lens-breakdown">${breakdownHTML(transcript)}</section>` +
      provenanceHTML(transcript)
    );
  }

  // ------------------------------------------------------------- the lane

  // THE ANCHOR LANE IS FIRST, because the lane is DEFINED between its two
  // anchors: `board.arrived` opens the turn and `turn.resolved` closes it.
  // Without it those two events had no tick at all, and the strip was drawn
  // between two ends it never showed.
  const LANES = ['anchor', 'kernel', 'operator', 'staging', 'advice'];

  /**
   * The intra-turn scrubber. Ticks are clickable and the playhead SNAPS TO
   * EVENTS, never to pixels — a frame between two events is the earlier
   * event's frame. Attention ticks are hollow and hidden unless the lane is
   * expanded: they are numerous, low-grade, and they fund compute, so they are
   * logged rather than thrown in the operator's face.
   */
  function laneHTML(events, at) {
    const list = (events || []).slice().sort((a, b) => a.seq - b.seq);
    if (list.length === 0) {
      return '<div class="lens-empty">no events yet this turn</div>';
    }
    const span = Math.max(1, list[list.length - 1].seq - list[0].seq);
    const seq = at && at.seq != null ? at.seq : list[list.length - 1].seq;
    const expanded = !!(at && at.expanded);

    const rows = LANES.map((lane) => {
      const ticks = list
        .filter((e) => e.lane === lane)
        .filter((e) => expanded || e.shape !== 'hollow')
        .map((e) => {
          const left = (((e.seq - list[0].seq) / span) * 100).toFixed(2);
          const style = `left:${left}%${e.color ? `;color:${escapeHTML(e.color)}` : ''}`;
          // `●Ada near(s2)` (§2.2): the verb, the unit it names and the
          // operator who did it. The tick used to say the kind and the time
          // and nothing else, because no `pin` / `unpin` row existed to carry
          // an operator — so "who did that" was unanswerable even on hover.
          const what = `${e.kind}${e.unit ? `(${e.unit})` : ''}`;
          const who = e.operator ? `${e.operator} ` : '';
          const at = e.atWorkMs == null ? '' : ` · +${e.atWorkMs}ms`;
          return (
            `<button type="button" class="lens-tick lens-tick-${escapeHTML(e.shape)}" ` +
            `data-seq="${escapeHTML(e.seq)}" style="${style}" ` +
            `title="${escapeHTML(`${who}${what} · seq ${e.seq}${at}`)}">` +
            `${e.shape === 'hollow' ? '○' : lane === 'operator' ? '●' : '▲'}</button>`
          );
        })
        .join('');
      // The ticks live in their OWN positioned track: `left: X%` is a position
      // in the turn, and with the lane's name sharing that box the first ticks
      // were drawn on top of the label.
      return (
        `<div class="lens-lane" data-lane="${lane}">` +
        `<span class="lens-lane-name">${lane}</span>` +
        `<span class="lens-lane-track">${ticks}</span></div>`
      );
    }).join('');

    const here = list.filter((e) => e.seq <= seq).length;
    return (
      rows +
      `<div class="lens-lane-foot">seq ${escapeHTML(seq)} · ${here} / ${list.length}` +
      `${at && at.badge ? ` · ${escapeHTML(at.badge)}` : ''}</div>`
    );
  }

  // THE LANE IS BUILT ONCE, and not here. A transcript's `timeline.tick` ops
  // are truncated at the playhead — that is correct for a frame, which is a
  // statement about one `seq` — so a lane built from them would SHRINK as the
  // operator scrubbed back. The page builds the strip from the whole turn's
  // events instead; the second builder that read the transcript is gone
  // rather than kept as a shape for the two to drift between.

  // ------------------------------------------------------------ the keymap

  /**
   * THE KEYMAP, as a table. It EXTENDS the shipped schema without touching a
   * single existing binding — Tab, Esc, the arrow pad, WASD, 1–9, Space, H,
   * Del, Enter, Ctrl+Enter, Ctrl+/ and Alt all keep exactly the meanings they
   * have. `Space` is the one key whose meaning grows: it still stages the
   * selected candidate, and it now thereby stages the displayed moveset, via
   * the minimum pins. An operator who never opens the moveset list presses
   * `Space` and gets precisely today's behaviour, because rank 1 conditional
   * on their candidate needs one pin — theirs. The gesture is not re-taught;
   * it is re-explained.
   */
  const KEYMAP = [
    { key: '[', action: 'moveset.prev', help: 'previous moveset in the conditional list' },
    { key: ']', action: 'moveset.next', help: 'next moveset in the conditional list' },
    { key: 'f', action: 'foil', help: 'the contrastive runner-up — tap latches, hold peeks' },
    { key: 'b', action: 'drill', help: 'the breakdown drill on the highlighted member' },
    { key: 'b', shift: true, action: 'drill.all', help: 'expand every member’s terms' },
    { key: ',', action: 'timeline.prev', help: 'step the turn timeline back one event' },
    { key: '.', action: 'timeline.next', help: 'step the turn timeline on one event' },
    { key: ',', shift: true, action: 'timeline.prevEmission', help: 'previous kernel emission' },
    { key: '.', shift: true, action: 'timeline.nextEmission', help: 'next kernel emission' },
    { key: 'home', action: 'timeline.start', help: 'timeline to the board’s arrival' },
    { key: 'end', action: 'timeline.head', help: 'timeline to the head' },
    { key: 'n', action: 'now', help: 'return to now (the live head)' },
    { key: 'u', action: 'release', help: 'release this unit’s pin, leaving goto/near' },
    { key: ' ', shift: true, action: 'lock.moveset', help: 'lock the whole moveset — pin every member' },
  ];

  /** null when the press is not the lens's business, which is most presses. */
  function keyBinding(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
    const key = String(event.key || '').toLowerCase();
    const shift = !!event.shiftKey;
    return KEYMAP.find((b) => b.key === key && !!b.shift === shift) || null;
  }

  return {
    inkFromTranscript,
    railHTML,
    bannerHTML,
    narrowNoteHTML,
    focusHTML,
    candidatesHTML,
    movesetsHTML,
    breakdownHTML,
    provenanceHTML,
    laneHTML,
    keyBinding,
    KEYMAP,
    escapeHTML,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LensPanel;
}
