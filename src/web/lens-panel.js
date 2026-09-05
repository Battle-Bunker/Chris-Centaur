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
   * A BRACKET AS A BAND, not as two numbers. Roughly one reader in three
   * inverts an interval printed as text even with a correct key beside it, and
   * `-51.6 ⌈93.0⌉` asks them to do the subtraction as well. The band is drawn
   * on one scale shared by every row of the table, so "wider" and "further
   * right" mean the same thing on every row of it:
   *
   *   · the SPAN is `lo … hi` — the proved floor to the unproved ceiling;
   *   · the TICK is `est`, the estimate, which never adjudicates and is drawn
   *     as a mark inside the span rather than as a third number beside it;
   *   · an open end (`hi = +∞`) draws an ARROWHEAD, never a bar: nothing is
   *     proved above, which is a reading and not a big number.
   *
   * The numbers stay in the cell beside it. The band is the fast read; the
   * text is the checkable one, and Law A wants both.
   */
  function bandHTML(lo, width, est, scale) {
    if (typeof lo !== 'number' || Number.isNaN(lo) || !scale || scale.span <= 0) return '';
    const hi = typeof width === 'number' && Number.isFinite(width) ? lo + width : Infinity;
    const pct = (v) => Math.max(0, Math.min(100, ((v - scale.lo) / scale.span) * 100));
    const left = pct(lo);
    const open = !Number.isFinite(hi);
    const right = open ? 100 : pct(hi);
    const tick =
      typeof est === 'number' && Number.isFinite(est)
        ? `<i class="lens-band-tick" style="left:${pct(est).toFixed(1)}%"></i>`
        : '';
    return (
      `<span class="lens-band" role="img" aria-label="floor ${num(lo, 1)} to ${open ? 'open' : num(hi, 1)}">` +
      `<i class="lens-band-span${open ? ' lens-band-open' : ''}" ` +
      `style="left:${left.toFixed(1)}%;width:${Math.max(1.5, right - left).toFixed(1)}%"></i>${tick}</span>`
    );
  }

  /** One scale for the whole table: the widest finite reading in it. */
  function bandScale(rows) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of rows) {
      const args = ARGS(row);
      const a = args[2];
      const w = args[3];
      if (typeof a !== 'number' || Number.isNaN(a)) continue;
      lo = Math.min(lo, a);
      hi = Math.max(hi, a + (typeof w === 'number' && Number.isFinite(w) ? w : 0));
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const pad = Math.max(0.5, (hi - lo) * 0.08);
    return { lo: lo - pad, span: hi - lo + pad * 2 };
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
    // DEPTH IS A DEPTH, so it is also drawn as one: `h<n>` keeps the number
    // (it is what a reader checks) and gains a three-segment gauge beside it,
    // lit to the horizon this row was proved at. On a build where nothing
    // deepens every row reads `h1` with one segment lit — which is the honest
    // picture of a bot that does not look ahead, drawn rather than omitted.
    const ply = parseInt(String(cell.label || '').replace(/^h/, ''), 10);
    const gauge = Number.isFinite(ply)
      ? `<span class="lens-depth" title="proved at horizon ${ply}">${[1, 2, 3]
          .map((n) => `<i class="${n <= ply ? 'on' : ''}"></i>`)
          .join('')}</span>`
      : '';
    return `${escapeHTML(cell.label)}${gauge} ${escapeHTML(marks)}${escapeHTML(delta)}`;
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
  function sourceLine(source, retained, shown, truncated) {
    if (source === 'conditional') {
      // WHERE THE RANKING STOPPED, in the head, because a table that stops
      // short reads exactly like a cluster with nothing else in it. The
      // reserve's stop is a REFUSAL and is drawn as one; the row cap's is not
      // — a full list has not been cut short by anything (10 §4 O1).
      const short = !truncated
        ? ''
        : truncated.why === 'reserve-spent'
          ? ` · <span class="lens-refused">⚠ ${escapeHTML(truncated.detail)}</span>`
          : ` · ${escapeHTML(truncated.detail)}`;
      return `conditional list — the rows a lock here would stage${
        retained ? ` · ${escapeHTML(retained)} retained for the cluster` : ''
      }${short}`;
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
    const [clusterId, members, bounded, seq, stale, source, retained, truncated] = ARGS(head);

    const rowCalls = allOf(transcript, 'panel.movesets.row');
    const rowCount = rowCalls.length;
    const scale = bandScale(rowCalls);

    // WHAT SEPARATES THIS ROW FROM THE ONE BEING READ.
    //
    // The measured case: rank 1 assigns `red-A→84 · red-C→69`, the foil
    // assigns `red-A→84 · red-C→67`, and NOTHING marks that the whole
    // difference is one cell on one unit. The contrastive pair is the object
    // the research says actually moves a decision (`01 §1` P5, #18) and the
    // operator was left diffing two three-token strings character by
    // character at 13 px, on a half-second clock.
    //
    // Worse on the rows below them: ranks 3–5 clip at 113 px, and since every
    // row shares its first token the ellipsis eats exactly the token that
    // differs — `red-A→108 · r…`, three times, identical. A list whose rows
    // are distinguishable only in the part that is cut off is a list of one
    // row drawn five times.
    //
    // So the reference is the row the cursor is on — the row the operator is
    // comparing FROM — and every other row is drawn against it: the cards
    // mark the tokens that differ, the walked rows show only those tokens and
    // count the agreements they folded away. The transcript is untouched;
    // this is the view choosing what to spend 380 px on.
    const ASSIGNMENT = 7;
    const SELECTED = 9;
    const unitOf = (token) => String(token).split('\u2192')[0];
    const rowsArgs = rowCalls.map((call) => ARGS(call));
    const refRow = rowsArgs.find((a) => a[SELECTED]) || rowsArgs[0];
    const reference = new Map(
      ((refRow && refRow[ASSIGNMENT]) || []).map((m) => [unitOf(m), String(m)])
    );
    /** The row's assignment, split into what agrees with the reference and
     *  what does not. A row with no reference to compare against (there is
     *  only one row, or it IS the reference) differs in nothing, and says so
     *  by drawing itself whole. */
    const splitAssignment = (assignment) => {
      const list = (assignment || []).map(String);
      const differs = list.filter((m) => {
        const ref = reference.get(unitOf(m));
        return ref !== undefined && ref !== m;
      });
      return { list, differs, agreed: list.length - differs.length };
    };

    /** A card draws every unit and MARKS the ones that differ; a walked row
     *  draws only what differs and says how many it folded. Both put the
     *  informative token first, which is the half a 380 px column has room
     *  for. */
    const assignmentHTML = (assignment, isCard) => {
      const { list, differs, agreed } = splitAssignment(assignment);
      if (list.length === 0) return '';
      const mark = (m) => {
        const ref = reference.get(unitOf(m));
        const cls = ref !== undefined && ref !== m ? 'lens-move lens-move-diff' : 'lens-move';
        return `<span class="${cls}">${escapeHTML(m)}</span>`;
      };
      if (isCard || differs.length === 0) {
        return list.map(mark).join(' · ');
      }
      // `\u2261 2` reads "two units the same as the row you are on" — a count,
      // not a hidden list: the whole assignment is still one keypress away as
      // this row's own card the moment the cursor lands on it.
      return (
        differs.map(mark).join(' · ') +
        (agreed > 0 ? ` <span class="lens-move-same">\u2261 ${agreed}</span>` : '')
      );
    };

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
          isFoil,
          est,
        ] = ARGS(call);
        // A stale complement is a row whose QUESTION changed while its answer
        // stayed sound: struck through, kept, never dropped.
        // THE TWO ROWS THAT MATTER ARE DRAWN AT FULL SIZE, and the rest are
        // one line each. Rank 1 is what will happen and the foil is what it
        // nearly did — the contrastive pair is what actually moves a human's
        // decision, and drawing rank 1 exactly like rank 5 spends the reader's
        // whole 500 ms budget telling them the two are equally important.
        // Everything below them is still a keypress away, never hidden.
        const cls = [
          selected ? 'lens-row-cursor' : '',
          selected ? 'lens-row-lead' : '',
          isFoil ? 'lens-row-foil' : '',
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
          `<tr class="${cls}" data-lens-moveset="${escapeHTML(key)}" tabindex="-1">` +
          // NOTHING IS ENCODED BY HUE ALONE. The cursor row carries `▸`, the
          // foil carries `◇` and a dashed rule of its own, and both say what
          // they are in words — the tint underneath them is reinforcement, and
          // a deuteranope reading this table loses nothing.
          `<td>${selected ? '▸' : isFoil ? '◇' : ''}${escapeHTML(rank)}` +
          `${selected ? '<span class="lens-row-tag">would be staged</span>' : ''}` +
          `${isFoil ? '<span class="lens-row-tag">foil</span>' : ''}</td>` +
          // A ROW WITH NO PRICE DRAWS NO BRACKET EITHER: `⌈—⌉` is a width of
          // nothing. The assignment is the row's content and the numbers say
          // they are absent (Law A, F7).
          `<td>${num(aggregate, 1)}${
            width == null ? '' : ` <span class="lens-width">⌈${num(width, 1)}⌉</span>`
          }${bandHTML(aggregate, width, est, scale)}</td>` +
          `<td>${depthHTML(cell)}</td>` +
          `<td>${delta === 0 ? '—' : num(delta, 1)}</td>` +
          // THE `unless` CELL — what this moveset is betting on, per row. It is
          // drawn on the leader too, where it reads "leads on the proved
          // floor": a blank cell and a row that leads are different states.
          `<td class="lens-unless">${escapeHTML(unless || '')}</td>` +
          `<td>${assignmentHTML(assignment, selected || isFoil)}` +
          `${trailHTML(trail, staged)}</td></tr>`
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
        ? `<div class="lens-foil lens-foil-absent">◇ ${escapeHTML(foilArgs[2])}</div>`
        : `<div class="lens-foil">◇ foil #${escapeHTML(foilArgs[0])}${
            foilArgs[1] == null ? '' : ` · margin ${num(foilArgs[1], 1)}`
          } · ${escapeHTML(foilArgs[2])} · at ${escapeHTML(foilArgs[3])}</div>`;

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
      `<div class="lens-list-source">${sourceLine(source, retained, rowCount, truncated)}</div>` +
      `<table class="lens-table">${rows}</table>` +
      (fixed ? `<div class="lens-fixed-strip">${fixed}</div>` : '') +
      foil +
      // THE LEGEND, UNDER THE TABLE IT GLOSSES. Four tokens are on that table
      // with no gloss anywhere, and three of them mean something else in the
      // rest of the codebase, so it stays. But it is L4 — "needed to check a
      // number, never to take a decision inside 500 ms" — and it was drawn
      // ABOVE the two cards, at the top of L2, three lines of definitions
      // between the operator's eye and the row that is going to happen
      // (`heuristic → movesets-measured`: legend at y 132, rank 1 at y 160).
      // A reader meets the decision first now and the key to it afterwards,
      // which is the order they are needed in.
      `<div class="lens-legend">⌈w⌉ bracket width · h&lt;n&gt; horizon proved at · ` +
      `Q loud replies · unless what this row is betting on</div>` +
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
    // `stale @ seq n`, ON THE BANNER. The flag used to ride the movesets
    // panel's HEAD, which a cluster with no retained rows never draws — it
    // draws its empty state instead — so a held widen over such a cluster put
    // the banner up, froze the rail, and said nothing about the numbers under
    // it being answers to the previous question. The banner is up in exactly
    // the cases the hold applies to, so the flag belongs on the banner: one
    // place, all of them.
    const stale =
      notice.staleAtSeq == null
        ? ''
        : `<div class="lens-sub lens-stale-flag">the rail below is stale @ seq ${escapeHTML(
            notice.staleAtSeq
          )}</div>`;
    return (
      `<div class="lens-banner">⚑ ${who} ${escapeHTML(notice.gained.join(', '))} — ` +
      `cluster is now ${escapeHTML(notice.gained.length + (notice.members || 0))} units. ` +
      `<span class="lens-sub">${timer}</span>` +
      `<button type="button" data-lens-accept="1">Show</button>${stale}</div>`
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

  // ------------------------------------------------------- the glance layer

  /**
   * THE STAGE LINE — what the bot is about to do, in one sentence, readable in
   * under a second, at the top of the rail whether or not a unit is focused.
   *
   * It is the question every turn asks and the one the shipped surface
   * answered nowhere: an operator had to read the board's arrows one unit at a
   * time to assemble it. `panel.stage` carries the units this decision is
   * about with what is staged for each, so the sentence is a read of the frame
   * and says the same thing in replay.
   *
   * `live` is the page's own staged map, which knows two things the frame does
   * not — a REQUESTED move that has not confirmed, and a COMMITTED one — and
   * is preferred per unit where it has an answer. Where neither knows, the
   * unit is drawn as unplanned rather than omitted: the count of units with no
   * plan is the whole point of the strip under it.
   */
  function stageHTML(transcript, live) {
    const call = firstOf(transcript, 'panel.stage');
    const rows = (ARGS(call)[0] || []).map((row) => {
      const own = (live && live[row.unit]) || null;
      return {
        ...row,
        to: own && own.to != null ? own.to : row.to,
        source: own && own.to != null ? 'staged' : row.source,
        state: own ? own.state : null,
      };
    });
    if (rows.length === 0) {
      return `<div class="lens-stage-line lens-stage-none">nothing is staged yet</div>`;
    }
    // FOUR STATES, FOUR MARKS, NO HUE. `»` committed and frozen, `⋯` requested
    // and not yet confirmed, `~` the bot's current plan rather than a written
    // move, and nothing at all for a confirmed staged move — which is the
    // common case and therefore the quiet one.
    const word = (row) => {
      if (row.to == null) return `<span class="lens-unplanned">${escapeHTML(row.letter)} ◦ no plan</span>`;
      const mark =
        row.state === 'committed'
          ? '»'
          : row.state === 'requested'
            ? '⋯'
            : row.source === 'plan'
              ? '~'
              : '';
      return (
        `<span class="lens-stage-move">${escapeHTML(row.letter)} →&nbsp;${escapeHTML(row.to)}${mark}` +
        `${row.fixity && row.fixity !== 'free' ? ` <span class="lens-stage-why">${escapeHTML(row.fixity)}</span>` : ''}` +
        `</span>`
      );
    };
    const staged = rows.filter((r) => r.to != null && r.source === 'staged').length;
    const planned = rows.filter((r) => r.to != null && r.source !== 'staged').length;
    const fixed = rows.filter((r) => r.fixity && r.fixity !== 'free').length;
    const unplanned = rows.filter((r) => r.to == null).length;
    // THE UNFINISHED-BUSINESS STRIP. One segment per state, each with its own
    // glyph, counting ONLY what the page can know: there is no `fatal` segment
    // until a fatal consent exists this turn, because a count that cannot be
    // taken must not be printed as zero.
    const strip =
      `<span>${rows.length} unit${rows.length === 1 ? '' : 's'}</span>` +
      (staged > 0 ? `<span>● ${staged} staged</span>` : '') +
      (planned > 0 ? `<span>~ ${planned} planned</span>` : '') +
      (unplanned > 0 ? `<span class="lens-biz-open">◦ ${unplanned} no plan</span>` : '') +
      (fixed > 0 ? `<span>🔒 ${fixed} fixed</span>` : '');
    return (
      `<div class="lens-stage-line">Bot stages ${rows.map(word).join(' · ')}</div>` +
      `<div class="lens-biz">${strip}</div>`
    );
  }

  /**
   * ONE AFFORDANCE LANGUAGE. Pin, lock, hold, goto, near, release, widen and
   * clear were six vocabularies in five places — a padlock on the board, a
   * word in the focus line, a count inside a label, a colour on an arrow, and
   * three of them only in the help pane. Every one of them is now this chip:
   * GLYPH · VERB · KEY · STATE, in one row, in one place, in the same order.
   * The glyph is the constant; the state is the only thing that changes.
   */
  function chipHTML(chip) {
    const cls = ['lens-aff', chip.tone ? `lens-aff-${chip.tone}` : '', chip.off ? 'lens-aff-off' : '']
      .filter(Boolean)
      .join(' ');
    // A CHIP THAT CLICKS IS A BUTTON, and has to say so. §3.3 makes the chips
    // the mouse-first operator's path to every action; drawn as bare `<span>`s
    // with a pointer handler they had no role, no name and no way to take
    // focus, so the keyboard could not reach them and a screen reader could
    // not announce them (WCAG 2.1.1, 4.1.2). The ones that do something are
    // buttons now; the ones that only report state stay inert text, which is
    // what they are.
    const act = chip.action && !chip.off;
    return (
      `<span class="${cls}"${chip.action ? ` data-lens-action="${escapeHTML(chip.action)}"` : ''}` +
      `${act ? ` role="button" tabindex="0"` : ''}` +
      `${chip.action && chip.off ? ' aria-disabled="true"' : ''}>` +
      `<span class="lens-aff-glyph">${escapeHTML(chip.glyph)}</span>${escapeHTML(chip.label)}` +
      `${chip.key ? `<kbd>${escapeHTML(chip.key)}</kbd>` : ''}` +
      `${chip.note ? `<span class="lens-aff-note">${escapeHTML(chip.note)}</span>` : ''}</span>`
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
  const HELP = {
    'moveset.prev': 'previous moveset in the conditional list',
    'moveset.next': 'next moveset in the conditional list',
    foil: 'the contrastive runner-up — tap latches, hold peeks',
    drill: 'the breakdown drill on the highlighted member',
    'drill.all': 'expand every member’s terms',
    'timeline.prev': 'step the turn timeline back one event',
    'timeline.next': 'step the turn timeline on one event',
    'timeline.prevEmission': 'previous kernel emission',
    'timeline.nextEmission': 'next kernel emission',
    'timeline.start': 'timeline to the board’s arrival',
    'timeline.head': 'timeline to the head',
    now: 'return to now (the live head)',
    release: 'undo — release the pin your last determination wrote, leaving goto/near',
    'lock.moveset': 'lock the whole moveset — pin every member',
  };

  /**
   * THREE SCHEMES OVER ONE ACTION SET.
   *
   * The action set is the lens's vocabulary and never changes; only which key
   * carries it does. Which one an operator wants is a hand posture, not a
   * preference about the product:
   *
   *  · `bracket` — the shipped schema, unchanged, and still the default. Every
   *    binding in it is exactly what it was, so nothing an operator has
   *    already learned is re-taught.
   *  · `vim` — `j`/`k` walk the list, `g`/`G` are the ends, `u` is undo. For
   *    the reader whose hands already do this.
   *  · `lefthand` — every key reachable by the left hand alone, for the
   *    operator who keeps the right on the mouse: the board is a pointing
   *    surface and the rail is a keyboard one, and they are used at once.
   *
   * The constraint all three obey: NO CHORD IN THE HOT PATH (one unmodified
   * press per action), and no collision with the shipped move schema — Tab,
   * Esc, the arrow pad, WASD, 1–9, Space, H, Del, Enter, Ctrl+Enter, Ctrl+/
   * and Alt keep exactly the meanings they have, in every scheme.
   */
  const SCHEME_KEYS = {
    bracket: {
      'moveset.prev': '[', 'moveset.next': ']',
      foil: 'f', drill: 'b', 'drill.all': 'B',
      'timeline.prev': ',', 'timeline.next': '.',
      'timeline.prevEmission': '<', 'timeline.nextEmission': '>',
      now: 'n', release: 'u',
    },
    vim: {
      'moveset.prev': 'k', 'moveset.next': 'j',
      foil: 'x', drill: 'i', 'drill.all': 'I',
      'timeline.prev': ',', 'timeline.next': '.',
      'timeline.prevEmission': '<', 'timeline.nextEmission': '>',
      'timeline.start': 'g', 'timeline.head': 'G',
      now: 'n', release: 'u',
    },
    lefthand: {
      'moveset.prev': 'q', 'moveset.next': 'e',
      foil: 'r', drill: 't', 'drill.all': 'T',
      'timeline.prev': 'z', 'timeline.next': 'c',
      'timeline.prevEmission': 'Z', 'timeline.nextEmission': 'C',
      'timeline.start': 'g', 'timeline.head': 'v',
      now: 'f', release: 'x',
    },
  };

  const SCHEME_LABELS = {
    bracket: 'bracket (default)',
    vim: 'vim',
    lefthand: 'left hand',
  };

  /** Home/End and Shift+Space are the same in every scheme: two of them are
   *  the keyboard's own names for the ends of a timeline, and the third is the
   *  one gesture that is DELIBERATELY the hardest on the surface (§3.4). */
  const COMMON = [
    { key: 'home', action: 'timeline.start' },
    { key: 'end', action: 'timeline.head' },
    { key: ' ', shift: true, action: 'lock.moveset' },
  ];

  /**
   * A SHIFTED PUNCTUATION KEY HAS TWO NAMES AND THE BROWSER ONLY EVER SAYS
   * THE SECOND. A scheme writes the emission jump as `<`, meaning "the comma
   * key with Shift down", and the binding is stored under its bare name `,`
   * with `shift: true`. But `KeyboardEvent.key` for that press is `'<'`, not
   * `','` — so a lookup that lowercases the event key and stops there never
   * matches, and `Shift+,` / `Shift+.` have been inert since they were bound.
   * One table, read from both ends: `keymapFor` folds the scheme's name down
   * to the bare key, and `keyBinding` folds the event's name down the same
   * way, so the two halves cannot disagree about what a key is called.
   */
  const SHIFTED_PUNCTUATION = { '<': ',', '>': '.' };
  const bareKey = (key) =>
    Object.prototype.hasOwnProperty.call(SHIFTED_PUNCTUATION, key)
      ? SHIFTED_PUNCTUATION[key]
      : String(key).toLowerCase();

  /** A scheme's bindings, as the table the shortcuts pane and the cheat strip
   *  both render — there is one list, so they cannot disagree. */
  function keymapFor(name) {
    const keys = SCHEME_KEYS[name] || SCHEME_KEYS.bracket;
    const out = [];
    for (const [action, key] of Object.entries(keys)) {
      const shift =
        key.length === 1 && key !== key.toLowerCase()
          ? true
          : Object.prototype.hasOwnProperty.call(SHIFTED_PUNCTUATION, key);
      out.push({ key: bareKey(key), shift, action, help: HELP[action], display: key });
    }
    for (const c of COMMON) {
      // Deduped by KEY, not by action: `Home` and `End` stay bound in every
      // scheme even where the scheme has its own `g`/`G` for the same two
      // places, because they are the keyboard's own names for them.
      if (out.some((b) => b.key === c.key && !!b.shift === !!c.shift)) continue;
      out.push({
        ...c,
        help: HELP[c.action],
        display: c.action === 'lock.moveset' ? 'Shift+Space' : c.key === 'home' ? 'Home' : 'End',
      });
    }
    return out;
  }

  /** The shipped schema, still the default and still exactly what it was. */
  const KEYMAP = keymapFor('bracket');

  let activeSchemeName = 'bracket';
  const schemeNames = () => Object.keys(SCHEME_KEYS);
  const schemeLabel = (name) => SCHEME_LABELS[name] || name;
  const activeScheme = () => activeSchemeName;
  function setScheme(name) {
    activeSchemeName = SCHEME_KEYS[name] ? name : 'bracket';
    return activeSchemeName;
  }

  /** null when the press is not the lens's business, which is most presses. */
  function keyBinding(event, scheme) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
    const key = bareKey(event.key || '');
    const shift = !!event.shiftKey;
    const map = scheme === undefined ? keymapFor(activeSchemeName) : keymapFor(scheme);
    return map.find((b) => b.key === key && !!b.shift === shift) || null;
  }

  /**
   * THE CHEAT SHEET, ON SCREEN AND AT REST. `Ctrl+/` is a complete reference
   * and it is a page-covering modal — which on a 500 ms clock costs the
   * operator the board and therefore the turn. The eight keys that are
   * actually in the hot path live in the rail as one quiet line, rendered from
   * the same table the modal renders, so switching scheme rewrites both.
   */
  const CHEAT = [
    ['moveset.prev', 'moveset.next', 'rank'],
    ['foil', null, 'foil'],
    ['drill', null, 'breakdown'],
    ['timeline.prev', 'timeline.next', 'timeline'],
    ['now', null, 'now'],
    ['release', null, 'undo'],
  ];
  function cheatSheetHTML(scheme) {
    const map = keymapFor(scheme || activeSchemeName);
    const keyOf = (action) => (map.find((b) => b.action === action) || {}).display || '';
    const cells = CHEAT.map(([a, b, label]) => {
      const keys = [keyOf(a), b ? keyOf(b) : null].filter(Boolean);
      return `<span class="lens-cheat-item">${keys
        .map((k) => `<kbd>${escapeHTML(k)}</kbd>`)
        .join('')}${escapeHTML(label)}</span>`;
    }).join('');
    return (
      `<div class="lens-cheat">${cells}` +
      `<span class="lens-cheat-item"><kbd>Space</kbd>lock</span>` +
      `<span class="lens-cheat-item"><kbd>Ctrl+/</kbd>all</span></div>`
    );
  }

  return {
    inkFromTranscript,
    railHTML,
    stageHTML,
    chipHTML,
    cheatSheetHTML,
    keymapFor,
    schemeNames,
    schemeLabel,
    activeScheme,
    setScheme,
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
