/**
 * GENERATED — do not edit. Run `npm run build:lens` after changing
 * src/lens/**; src/tests/lens-bundle.test.ts fails if this file drifts.
 *
 * The decision lens's view-model: the reducer's consumer, the cursor state
 * machine, the two sources and the renderer, bundled for the browser as
 * window.LensView. One implementation, shared by live play, replay and the
 * boundary tests.
 */
"use strict";
var LensView = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lens/view/index.ts
  var index_exports = {};
  __export(index_exports, {
    LENS_INK: () => LENS_INK,
    LensNoMovesetError: () => LensNoMovesetError,
    LensOffHeadError: () => LensOffHeadError,
    applyCursorEvent: () => applyCursorEvent,
    boundingOf: () => boundingOf,
    checkDivergence: () => checkDivergence,
    clusterGlyph: () => clusterGlyph,
    clusterOf: () => clusterOf,
    cursorState: () => cursorState,
    depthArrivals: () => depthArrivals,
    depthCell: () => depthCell,
    emptyStateLine: () => emptyStateLine,
    frameAtSeq: () => frameAtSeq,
    gestureState: () => gestureState,
    incumbentCandidate: () => incumbentCandidate,
    initialCursor: () => initialCursor,
    makeLiveDecisionSource: () => makeLiveDecisionSource,
    makeReplayDecisionSource: () => makeReplayDecisionSource,
    modeBadge: () => modeBadge,
    movesetListKey: () => movesetListKey,
    planLock: () => planLock,
    provenanceBadge: () => provenanceBadge,
    rankOne: () => rankOne,
    reactiveNotice: () => reactiveNotice,
    renderFrame: () => renderFrame,
    renderTimeline: () => renderTimeline,
    requestBreakdown: () => requestBreakdown,
    requestConditional: () => requestConditional,
    resetGestureState: () => resetGestureState,
    resolveCursor: () => resolveCursor,
    rowTrails: () => rowTrails,
    rowsFor: () => rowsFor,
    stagedCellOf: () => stagedCellOf,
    widenAutoAcceptMs: () => widenAutoAcceptMs
  });

  // src/lens/store/index.ts
  var NOT_IMPLEMENTED = "not implemented: L2/L4/L5";
  function emptyStore(_anchor) {
    throw new Error(NOT_IMPLEMENTED);
  }
  function applyEvent(_store, _event) {
    throw new Error(NOT_IMPLEMENTED);
  }
  function frameAt(_store, _seq) {
    throw new Error(NOT_IMPLEMENTED);
  }

  // src/lens/view/cursor.ts
  var WIDEN_AUTO_ACCEPT_CAP_MS = 6e3;
  var WIDEN_AUTO_ACCEPT_SHARE = 0.25;
  var TRAIL_DECAY_EMISSIONS = 2;
  var gesture = {
    drillOpen: false,
    lockInFlight: false,
    lockEveryMember: false,
    displaced: null
  };
  function gestureState() {
    return { ...gesture };
  }
  function resetGestureState() {
    gesture.drillOpen = false;
    gesture.lockInFlight = false;
    gesture.lockEveryMember = false;
    gesture.displaced = null;
  }
  function clusterOf(frame, unit) {
    return frame.partition.find((c) => c.members.includes(unit)) ?? null;
  }
  function boundingOf(frame, unit) {
    for (const cluster of frame.partition) {
      const found = cluster.boundedBy.find((b) => b.unit === unit);
      if (found) return found;
    }
    return null;
  }
  function movesetListKey(cluster, unit, to) {
    return `${cluster}|${unit}|${to}`;
  }
  function rowsFor(frame, unit, to) {
    if (unit === null || to === null) return [];
    const cluster = clusterOf(frame, unit);
    if (cluster === null) return [];
    return frame.movesets[movesetListKey(cluster.id, unit, to)] ?? [];
  }
  function rankOne(rows) {
    return rows.reduce(
      (best, row) => best === null || row.rank < best.rank ? row : best,
      null
    );
  }
  function hasCandidate(frame, unit, to) {
    return (frame.candidates[unit] ?? []).some((c) => c.to === to && c.legal);
  }
  function stagedCellOf(frame, unit) {
    const view = frame.staged[unit];
    return typeof view?.to === "number" ? view.to : null;
  }
  function incumbentCandidate(frame, unit) {
    const all = frame.candidates[unit] ?? [];
    const legal = all.filter((c) => c.legal);
    const pool = legal.length > 0 ? legal : all;
    if (pool.length === 0) return null;
    const staged = stagedCellOf(frame, unit);
    if (staged !== null && pool.some((c) => c.to === staged)) return staged;
    return pool[0]?.to ?? null;
  }
  function initialCursor() {
    return {
      unit: null,
      candidate: null,
      moveset: null,
      drill: null,
      foil: "off",
      explicit: { candidate: false, moveset: false, drill: false }
    };
  }
  function cursorState(cursor) {
    if (cursor.unit === null) return "NONE";
    if (cursor.candidate === null) return "UNIT";
    if (cursor.moveset === null) return "CANDIDATE";
    if (cursor.drill === null) return "MOVESET";
    return "BREAKDOWN";
  }
  function settle(frame, base) {
    const unit = base.unit;
    if (unit === null) return { ...initialCursor(), foil: base.foil };
    const keptCandidate = base.explicit.candidate && base.candidate !== null && hasCandidate(frame, unit, base.candidate) ? base.candidate : null;
    const candidate = keptCandidate ?? incumbentCandidate(frame, unit);
    const rows = rowsFor(frame, unit, candidate);
    const keptMoveset = base.explicit.moveset && base.moveset !== null && rows.some((r) => r.key === base.moveset) ? base.moveset : null;
    const moveset = keptMoveset ?? rankOne(rows)?.key ?? null;
    const members = clusterOf(frame, unit)?.members ?? [];
    const keptDrill = base.explicit.drill && base.drill !== null && moveset !== null && members.includes(base.drill) ? base.drill : null;
    return {
      unit,
      candidate,
      moveset,
      drill: keptDrill,
      foil: base.foil,
      explicit: {
        candidate: keptCandidate !== null,
        moveset: keptMoveset !== null,
        drill: keptDrill !== null
      }
    };
  }
  var NO_CHOICES = { candidate: false, moveset: false, drill: false };
  function applyCursorEvent(cursor, frame, event) {
    const next = transition(cursor, frame, event);
    gesture.drillOpen = next.drill !== null;
    return next;
  }
  function transition(cursor, frame, event) {
    switch (event.t) {
      // T1 — focus. Law D auto-advances past UNIT on the same tick.
      case "focus":
        return settle(frame, {
          ...initialCursor(),
          unit: event.unit,
          foil: cursor.foil
        });
      // T2 — blur.
      case "blur":
        return initialCursor();
      // T3 — a candidate is chosen; moveset and drill re-default beneath it.
      case "candidate":
        return settle(frame, {
          ...cursor,
          candidate: event.to,
          moveset: null,
          drill: null,
          explicit: { candidate: event.to !== null, moveset: false, drill: false }
        });
      // T4 — hover NEVER commits the cursor. The board is a place to look, and
      // a lens that re-ranks under the pointer is unusable.
      case "candidate.hover":
        return cursor;
      // T6 — choosing a moveset does NOT touch the candidate.
      case "moveset":
        return settle(frame, {
          ...cursor,
          moveset: event.key,
          drill: null,
          explicit: { ...cursor.explicit, moveset: true, drill: false }
        });
      // T7 — the drill toggles on the member it names.
      case "drill": {
        const open = cursor.drill === event.unit ? null : event.unit;
        return settle(frame, {
          ...cursor,
          drill: open,
          explicit: { ...cursor.explicit, drill: open !== null }
        });
      }
      // T8 — the contrastive foil. It touches nothing else.
      case "foil":
        return { ...cursor, foil: event.mode };
      // T9 / T10 — the two determination gestures. Neither moves the cursor:
      // the whole point is that what is staged is what is already drawn.
      case "lock":
        gesture.lockInFlight = true;
        return cursor;
      case "lock.moveset":
        gesture.lockInFlight = true;
        gesture.lockEveryMember = true;
        return cursor;
      // T11 — release one unit's pin. The cluster widens for everyone, so the
      // moveset list beneath the cursor is about to be a different list.
      case "release":
        return settle(frame, {
          ...cursor,
          explicit: { ...cursor.explicit, moveset: false, drill: false }
        });
      // T12 — clear every command on the unit, and re-default everything below.
      case "clear":
        return settle(frame, { ...cursor, explicit: { ...NO_CHOICES } });
      // T13 / T14 / T15 / T16 — the frame moves, the cursor does not. Identity
      // re-resolution against the new frame is `resolveCursor`, which the caller
      // runs when the frame it holds actually changes.
      case "seek":
      case "now":
      case "emission":
      case "partition-change":
        return cursor;
      // T17 — a turn boundary. The old board's moves are meaningless, so every
      // board-specific level clears; FOCUS SURVIVES, because an operator
      // watching one unit across turns must not have to re-click it every turn.
      case "turn-boundary":
        gesture.lockInFlight = false;
        gesture.displaced = null;
        return { ...initialCursor(), unit: cursor.unit };
    }
  }
  var LensOffHeadError = class extends Error {
    constructor(seq) {
      super(
        `determinations are legal only from the live head; this frame is at seq ${seq}. Press [N] to return to now.`
      );
      this.name = "LensOffHeadError";
    }
  };
  var LensNoMovesetError = class extends Error {
    constructor(detail) {
      super(`nothing to lock: ${detail}`);
      this.name = "LensNoMovesetError";
    }
  };
  function assignmentOf(row, unit) {
    return row.moves.find((m) => m.unit === unit)?.to ?? null;
  }
  function planLock(frame, cursor) {
    const everyMember = gesture.lockEveryMember;
    gesture.lockEveryMember = false;
    const legal = frame.at.isHead;
    if (!legal) throw new LensOffHeadError(frame.at.seq);
    const unit = cursor.unit;
    if (unit === null) throw new LensNoMovesetError("no unit is focused");
    const rows = rowsFor(frame, unit, cursor.candidate);
    const row = rows.find((r) => r.key === cursor.moveset) ?? rankOne(rows);
    if (row === null) throw new LensNoMovesetError(`no moveset list for ${unit}`);
    const cluster = clusterOf(frame, unit);
    const members = cluster?.members ?? [unit];
    const pinned = members.filter((v) => {
      if (everyMember || v === unit) return true;
      const to = assignmentOf(row, v);
      return to !== null && to !== stagedCellOf(frame, v);
    });
    const pins = pinned.map((v) => ({ unit: v, to: assignmentOf(row, v) })).filter((p) => p.to !== null);
    const mine = frame.units.find((u) => u.unit === unit)?.owner ?? null;
    const blockedBy = [];
    for (const pin of pins) {
      const owner = frame.units.find((u) => u.unit === pin.unit)?.owner ?? null;
      if (owner !== null && owner !== mine) blockedBy.push({ unit: pin.unit, owner });
    }
    return {
      moveset: row.key,
      pins,
      count: pins.length,
      members: members.length,
      blockedBy,
      expected: row.moves,
      emissionSeq: frame.at.seq
    };
  }
  function checkDivergence(plan, next) {
    gesture.lockInFlight = false;
    const pinned = new Set(plan.pins.map((p) => p.unit));
    const differing = plan.expected.filter((m) => !pinned.has(m.unit)).map((m) => ({
      unit: m.unit,
      expected: m.to,
      actual: stagedCellOf(next, m.unit),
      why: divergenceReason(next)
    })).filter(
      (d) => d.actual !== null && d.actual !== d.expected
    );
    return differing.length === 0 ? null : { moveset: plan.moveset, differing };
  }
  function divergenceReason(next) {
    const emission = [...next.events].reverse().find((e) => e.kind === "emission");
    const operator = [...next.events].reverse().find((e) => e.kind === "operator.command");
    if (operator) return `a peer command at seq ${operator.seq}`;
    if (emission) return `a later emission at seq ${emission.seq}`;
    return "the board changed";
  }
  function restrictedAssignment(row, members) {
    return row.moves.filter((m) => members.has(m.unit)).map((m) => `${m.unit}@${m.to}`).sort().join(",");
  }
  function commonMembers(prev, next, unit) {
    const before = clusterOf(prev, unit)?.members ?? [];
    const after = new Set(clusterOf(next, unit)?.members ?? []);
    return new Set(before.filter((m) => after.has(m)));
  }
  function resolveMovesetIdentity(oldRow, prevRows, nextRows, members) {
    const fallback = rankOne(nextRows)?.key ?? null;
    if (oldRow === null) return { key: fallback, displaced: false, wasRank: 0 };
    const wasRank = oldRow.rank;
    if (nextRows.some((r) => r.key === oldRow.key)) {
      return { key: oldRow.key, displaced: false, wasRank };
    }
    const want = restrictedAssignment(oldRow, members);
    const sameBefore = prevRows.filter((r) => restrictedAssignment(r, members) === want);
    const sameAfter = nextRows.filter((r) => restrictedAssignment(r, members) === want);
    if (sameBefore.length === 1 && sameAfter.length === 1) {
      return { key: sameAfter[0].key, displaced: false, wasRank };
    }
    const atRank = sameAfter.find((r) => r.rank === wasRank);
    if (atRank) return { key: atRank.key, displaced: false, wasRank };
    return { key: fallback, displaced: fallback !== null, wasRank };
  }
  function resolveCursor(cursor, prev, next) {
    const unit = cursor.unit;
    if (unit === null) return cursor;
    const candidateSurvives = cursor.candidate !== null && hasCandidate(next, unit, cursor.candidate);
    const candidate = candidateSurvives ? cursor.candidate : incumbentCandidate(next, unit);
    const prevRows = rowsFor(prev, unit, cursor.candidate);
    const nextRows = rowsFor(next, unit, candidate);
    const oldRow = prevRows.find((r) => r.key === cursor.moveset) ?? null;
    const resolved = resolveMovesetIdentity(
      oldRow,
      prevRows,
      nextRows,
      commonMembers(prev, next, unit)
    );
    gesture.displaced = resolved.displaced && resolved.key !== null ? { moveset: resolved.key, wasRank: resolved.wasRank, atSeq: next.at.seq } : null;
    return settle(next, {
      ...cursor,
      candidate,
      moveset: resolved.key,
      explicit: {
        candidate: cursor.explicit.candidate && candidateSurvives,
        moveset: cursor.explicit.moveset && resolved.key !== null,
        drill: cursor.explicit.drill
      }
    });
  }
  function rowTrails(prev, next, cursor) {
    const unit = cursor.unit;
    if (unit === null) return [];
    const emissionsAgo = Math.max(0, next.at.seq - prev.at.seq);
    if (emissionsAgo > TRAIL_DECAY_EMISSIONS) return [];
    const candidate = hasCandidate(next, unit, cursor.candidate ?? -1) ? cursor.candidate : incumbentCandidate(next, unit);
    const prevRows = rowsFor(prev, unit, cursor.candidate ?? candidate);
    const nextRows = rowsFor(next, unit, candidate);
    const members = commonMembers(prev, next, unit);
    const trails = nextRows.flatMap((row2) => {
      const wasRank = predecessorRank(row2, prevRows, members);
      return wasRank === null ? [] : [{ moveset: row2.key, wasRank, rank: row2.rank, emissionsAgo, displaced: false }];
    });
    const displaced = gesture.displaced;
    const fresh = displaced !== null && next.at.seq - displaced.atSeq <= TRAIL_DECAY_EMISSIONS;
    if (displaced === null || !fresh) return trails;
    const row = nextRows.find((r) => r.key === displaced.moveset);
    if (row === void 0) return trails;
    const badge = {
      moveset: row.key,
      wasRank: displaced.wasRank,
      rank: row.rank,
      emissionsAgo,
      displaced: true
    };
    return [...trails.filter((t) => t.moveset !== row.key), badge];
  }
  function predecessorRank(row, prevRows, members) {
    const byKey = prevRows.find((r) => r.key === row.key);
    if (byKey) return byKey.rank;
    const want = restrictedAssignment(row, members);
    const same = prevRows.filter((r) => restrictedAssignment(r, members) === want);
    if (same.length === 1) return same[0].rank;
    const atRank = same.find((r) => r.rank === row.rank);
    return atRank?.rank ?? null;
  }
  function turnExpiryOf(frame) {
    const anchor = frame.events.find((e) => e.kind === "board.arrived");
    const payload = anchor?.payload;
    return typeof payload?.turnExpiryTime === "number" ? payload.turnExpiryTime : null;
  }
  function widenAutoAcceptMs(frame) {
    const expiry = turnExpiryOf(frame);
    if (expiry === null) return WIDEN_AUTO_ACCEPT_CAP_MS;
    const remaining = expiry - frame.at.tWall;
    return Math.max(0, Math.min(WIDEN_AUTO_ACCEPT_CAP_MS, Math.round(WIDEN_AUTO_ACCEPT_SHARE * remaining)));
  }
  function reactiveNotice(prev, next) {
    for (const before of prev.partition) {
      const after = next.partition.find((c) => c.id === before.id);
      if (after === void 0) continue;
      const gained = after.members.filter((m) => !before.members.includes(m));
      if (gained.length > 0) {
        return {
          cluster: before.id,
          fromGeneration: before.generation,
          toGeneration: after.generation,
          gained,
          by: attributionFor(before.boundedBy, gained),
          autoAcceptMs: widenAutoAcceptMs(next),
          suspended: gesture.drillOpen,
          queuedBehindLock: gesture.lockInFlight,
          staleAtSeq: prev.at.seq
        };
      }
      const lost = before.members.filter((m) => !after.members.includes(m));
      if (lost.length > 0) {
        const bound = after.boundedBy.find((b) => lost.includes(b.unit));
        return {
          cluster: before.id,
          lost,
          why: bound?.why ?? "pin",
          by: bound?.by ?? null
        };
      }
    }
    return null;
  }
  function attributionFor(boundedBy, gained) {
    return boundedBy.find((b) => gained.includes(b.unit))?.by ?? null;
  }

  // src/lens/view/index.ts
  var LIVE_MODE = { true: "live-head", false: "live-scrub" };
  function refuse(reason, detail) {
    return { ok: false, refusal: reason, detail };
  }
  function headSeqOf(store) {
    return store.events.reduce((max, e) => Math.max(max, e.seq), store.anchor.seq);
  }
  function subscribers() {
    const fns = /* @__PURE__ */ new Set();
    return {
      add: (fn) => {
        fns.add(fn);
        return () => {
          fns.delete(fn);
        };
      },
      emit: (d) => {
        for (const fn of fns) fn(d);
      }
    };
  }
  function makeLiveDecisionSource(input) {
    const store = input.store;
    let at = input.at;
    const listeners = subscribers();
    return {
      kind: "live",
      get at() {
        return at;
      },
      seek(to) {
        at = to;
        listeners.emit({ kind: "cursor", at: to });
      },
      frame() {
        const head = input.isHead && at.seq >= headSeqOf(store);
        const base = frameAt(store, at.seq);
        return {
          ...base,
          at: { ...base.at, ...at, mode: LIVE_MODE[`${head}`], isHead: head }
        };
      },
      timeline() {
        return store.events.filter((e) => e.seq <= at.seq);
      },
      breakdown(moveset) {
        const transport = input.transport;
        return transport === void 0 ? Promise.resolve(refuse("unknown-cluster", "no inspection transport is attached")) : transport.breakdown(moveset);
      },
      conditional(req) {
        const transport = input.transport;
        return transport === void 0 ? Promise.resolve(refuse("unknown-cluster", "no inspection transport is attached")) : transport.conditional(req);
      },
      subscribe(fn) {
        return listeners.add(fn);
      }
    };
  }
  function makeReplayDecisionSource(input) {
    let at = input.at;
    const listeners = subscribers();
    return {
      kind: "replay",
      get at() {
        return at;
      },
      seek(to) {
        at = to;
        listeners.emit({ kind: "cursor", at: to });
      },
      frame() {
        const base = frameAt(input.store, at.seq);
        return { ...base, at: { ...base.at, ...at, mode: "replay", isHead: false } };
      },
      timeline() {
        return input.store.events.filter((e) => e.seq <= at.seq);
      },
      breakdown(moveset) {
        const frame = frameAt(input.store, at.seq);
        const stored = frame.breakdown[moveset];
        return Promise.resolve(
          stored === void 0 ? refuse("unknown-cluster", `no breakdown was retained for ${moveset}`) : {
            value: stored,
            basis: stored.basis,
            provenance: { kind: "observed", at }
          }
        );
      },
      conditional(_req) {
        return Promise.resolve(
          refuse("off-head", "a conditional ranking is a question for a running decision")
        );
      },
      subscribe(fn) {
        return listeners.add(fn);
      }
    };
  }
  function frameAtSeq(events, seq, isHead) {
    const anchor = events.find((e) => e.kind === "board.arrived") ?? events[0];
    if (anchor === void 0) throw new Error("a turn with no events has no frame");
    const store = events.filter((e) => e.seq > anchor.seq).reduce((acc, e) => applyEvent(acc, e), emptyStore(anchor));
    return makeLiveDecisionSource({
      store,
      at: { gameId: anchor.gameId, turn: anchor.turn, seq },
      isHead
    }).frame();
  }
  function requestConditional(source, req) {
    return source.conditional(req);
  }
  function requestBreakdown(source, moveset) {
    return source.breakdown(moveset);
  }
  var LENS_INK = {
    lens: { light: "#7B4FE0", dark: "#B39DFF" },
    lensWash: { light: "rgba(123,79,224,.07)", dark: "rgba(179,157,255,.12)" },
    foil: { light: "#00897B", dark: "#4DB6AC" },
    fixed: { light: "#6B6B6B", dark: "#9A9A9A" },
    refuter: { light: "#D84315", dark: "#FF8A65" }
  };
  var CLUSTER_GLYPHS = "αβγδεζηθικλμν";
  function clusterGlyph(index) {
    return CLUSTER_GLYPHS[index] ?? `c${index}`;
  }
  function call(op, ...args) {
    return { op, args };
  }
  function depthCell(row) {
    const { h1, deepest, delta, confidence, terminal } = row.depth;
    const deepened = deepest.horizon > h1.horizon;
    const narrowed = deepest.basis !== h1.basis;
    const marks = [];
    if (delta.lo > 0) marks.push("▲");
    if (delta.hi < 0) marks.push("▽");
    if (delta.rank !== 0) marks.push("◂");
    if (confidence === "incomparable") marks.push("↕");
    if (narrowed) marks.push("✂");
    if (terminal !== "none") marks.push("⊤");
    return {
      label: `h${deepest.horizon}`,
      width: Number((deepest.hi - deepest.lo).toFixed(2)),
      marks: marks.length > 0 || deepened ? marks : ["·"],
      delta: deepened ? Number((delta.lo !== 0 ? delta.lo : delta.hi).toFixed(2)) : null,
      // A declared narrowing means `compareFloors` refuses: the row is present
      // and is NOT sorted against the others.
      sorted: !narrowed
    };
  }
  function depthArrivals(prev, next) {
    const before = /* @__PURE__ */ new Map();
    for (const rows of Object.values(prev.movesets)) {
      for (const row of rows) before.set(row.key, row.depth.deepest.horizon);
    }
    const arrived = [];
    for (const rows of Object.values(next.movesets)) {
      for (const row of rows) {
        const was = before.get(row.key);
        if (was !== void 0 && row.depth.deepest.horizon > was) arrived.push(row.key);
      }
    }
    return arrived;
  }
  function selectedRow(frame, cursor) {
    const rows = rowsFor(frame, cursor.unit, cursor.candidate);
    return rows.find((r) => r.key === cursor.moveset) ?? rankOne(rows);
  }
  function foilRow(frame, cursor, selected) {
    if (selected === null) return null;
    const rows = rowsFor(frame, cursor.unit, cursor.candidate);
    return rows.filter((r) => r.key !== selected.key).sort((a, b) => a.rank - b.rank)[0] ?? null;
  }
  function emptyStateLine(frame) {
    const emissions = frame.events.filter((e) => e.kind === "emission").length;
    const fastpass = frame.events.some((e) => e.kind === "stage.fastpass");
    const staged = fastpass ? "fast-pass only" : "nothing staged yet";
    return `${staged} — no kernel emission yet at seq ${frame.at.seq}` + (emissions > 0 ? "" : "");
  }
  function boardOps(frame, cursor, selected) {
    const ops = [];
    const board = frame.board.board;
    ops.push(call("board", frame.at.turn, board.width, board.height));
    frame.partition.forEach((cluster2, index) => {
      const glyph = clusterGlyph(index);
      for (const member of cluster2.members) ops.push(call("cluster.chip", member, glyph, cluster2.id));
      for (const bound of cluster2.boundedBy) {
        ops.push(call("fixed.chip", bound.unit, bound.why, bound.by, bound.to));
      }
    });
    const cluster = cursor.unit === null ? null : clusterOf(frame, cursor.unit);
    if (cluster !== null) {
      for (const member of cluster.members) ops.push(call("cluster.tether", cluster.id, member));
      ops.push(call("cluster.wash", cluster.id, cluster.members));
    }
    if (selected !== null && cursor.unit !== null) {
      for (const move of selected.moves) {
        const agrees = stagedCellOf(frame, move.unit) === move.to;
        const focused = move.unit === cursor.unit;
        ops.push(
          focused ? call("moveset.arrow", move.unit, move.to, "filled") : agrees ? call("moveset.ring", move.unit, move.to) : call("moveset.arrow", move.unit, move.to, "hollow")
        );
      }
    }
    const foil = foilRow(frame, cursor, selected);
    if (foil !== null && selected !== null && cursor.foil !== "off") {
      for (const move of foil.moves) {
        const same = selected.moves.find((m) => m.unit === move.unit)?.to === move.to;
        if (!same) {
          ops.push(call("foil.arrow", move.unit, move.to));
          ops.push(call("foil.delta", move.unit, Number((foil.lo - selected.lo).toFixed(2))));
        }
      }
    }
    return ops;
  }
  function candidateOps(frame, cursor) {
    if (cursor.unit === null) return [];
    const rows = frame.candidates[cursor.unit] ?? [];
    const incumbent = incumbentCandidate(frame, cursor.unit);
    return [
      call("panel.candidates", rows.length, "scored as best-of-cluster"),
      ...rows.map(
        (row) => call(
          "panel.candidates.row",
          row.to,
          row.legal,
          // A candidate whose conditional list was never computed shows a GRADE
          // and never a bare number: `~` estimated, `·` unpriced. Pricing every
          // candidate is one queen at 6.4x a whole decision, so the rail grades
          // instead of guessing.
          row.conditionalBest === null ? null : row.conditionalBest.aggregate,
          row.conditionalBest === null ? "·" : row.conditionalBest.grade === "exact" ? "" : "~",
          row.disposition,
          row.to === incumbent,
          row.to === cursor.candidate
        )
      )
    ];
  }
  function movesetOps(frame, cursor, selected, trails) {
    const rows = rowsFor(frame, cursor.unit, cursor.candidate);
    if (rows.length === 0) return [call("panel.movesets.empty", emptyStateLine(frame))];
    const leader = rankOne(rows);
    const cluster = cursor.unit === null ? null : clusterOf(frame, cursor.unit);
    const ops = [
      call(
        "panel.movesets",
        cluster?.id ?? null,
        cluster === null ? 0 : cluster.members.length,
        cluster === null ? 0 : cluster.boundedBy.length,
        frame.at.seq,
        // A stale complement is a row whose QUESTION changed while its answer
        // stayed sound. It is struck through and headed, never dropped.
        rows.some((r) => r.complement === "stale")
      )
    ];
    for (const row of rows) {
      const cell = depthCell(row);
      const trail = trails.find((t) => t.moveset === row.key) ?? null;
      ops.push(
        call(
          "panel.movesets.row",
          row.rank,
          row.channel === "lo" ? row.lo : row.est,
          Number((row.hi - row.lo).toFixed(2)),
          cell,
          leader === null ? 0 : Number((row.lo - leader.lo).toFixed(2)),
          row.moves.map((m) => `${m.unit}→${m.to}`),
          row.complement,
          row.key === selected?.key,
          row.staged,
          trail
        )
      );
    }
    for (const bound of cluster?.boundedBy ?? []) {
      ops.push(call("panel.movesets.fixed", bound.unit, bound.to, bound.why, bound.by));
    }
    const foil = foilRow(frame, cursor, selected);
    if (foil !== null && selected !== null) {
      ops.push(
        call(
          "panel.foil",
          foil.rank,
          Number((selected.lo - foil.lo).toFixed(2)),
          decidingRung(selected, foil),
          depthCell(foil).label
        )
      );
    }
    return ops;
  }
  function decidingRung(selected, foil) {
    const loser = selected.rank > foil.rank ? selected : foil;
    const dominance = loser.dominance ?? (loser === selected ? foil.dominance : selected.dominance);
    if (dominance === null) return "unsealed — the barrier has not run";
    switch (dominance.kind) {
      case "leader":
        return "leads on the proved floor";
      case "refuted-by-witness":
        return "refuted by a witness";
      case "incomparable-basis":
        return "incomparable basis — not sorted against this row";
      case "contingent":
        return `contingent on ${dominance.onUnits.join(", ")} (${dominance.atStake} at stake)`;
      case "dominated":
        return `dominated by ${dominance.by}`;
      case "advisory-only":
        return `floors equal — advisory margin ${dominance.estMargin}`;
      case "indifferent":
        return "my proof rungs are silent here — your call beats my tie-break";
    }
  }
  function breakdownOps(frame, cursor, selected) {
    if (selected === null) return [];
    const breakdown = frame.breakdown[selected.key];
    if (breakdown === void 0) {
      return [call("panel.breakdown.pending", selected.key, "[B] to price this row")];
    }
    const ops = [
      call(
        "panel.breakdown",
        selected.key,
        // An evaluator that does not explain is NOT an error state. The panel
        // says so in words rather than drawing thirty zero rows, which is the
        // lesson the deleted per-unit table paid for.
        breakdown.aggregate === null ? "this evaluator does not explain" : breakdown.aggregate.profile
      )
    ];
    for (const marginal of breakdown.marginals) {
      ops.push(
        call(
          "panel.breakdown.member",
          marginal.unit,
          marginal.delta,
          marginal.against.to,
          marginal.unit === cursor.drill ? marginal.features.map((f) => [f.key, f.delta]) : marginal.features.slice(0, 2).map((f) => [f.key, f.delta])
        )
      );
    }
    ops.push(
      call(
        "panel.breakdown.residual",
        breakdown.residual.total,
        breakdown.residual.features.map((f) => [f.key, f.delta]),
        "[why?]"
      )
    );
    return ops;
  }
  var LANE_OF = {
    partition: "kernel",
    movesets: "kernel",
    emission: "kernel",
    operator: "operator",
    posture: "kernel",
    conditional: "kernel",
    refusal: "kernel",
    "board.arrived": "anchor",
    "stage.fastpass": "kernel",
    "decision.begin": "kernel",
    "decision.end": "kernel",
    "operator.command": "operator",
    pin: "operator",
    unpin: "operator",
    commit: "operator",
    "pin.refused": "operator",
    "stage.requested": "staging",
    "stage.confirmed": "staging",
    "stage.retry": "staging",
    "commit.observed": "staging",
    advice: "advice",
    selection: "operator",
    "turn.resolved": "anchor"
  };
  function renderTimeline(events) {
    const ops = [call("timeline", events.length)];
    for (const event of events) {
      const hover = event.payload?.hover === true;
      ops.push(
        call(
          "timeline.tick",
          LANE_OF[event.kind] ?? "operator",
          event.seq,
          event.atWorkMs,
          event.kind,
          event.actor.id,
          event.actor.color,
          hover ? "hollow" : "solid"
        )
      );
    }
    return ops;
  }
  function renderFrame(frame, cursor = initialCursor(), trails = []) {
    const selected = selectedRow(frame, cursor);
    const ops = [call("frame", frame.at.turn, frame.at.seq, frame.at.tMono)];
    ops.push(...boardOps(frame, cursor, selected));
    ops.push(call("panel.advice", frame.advice.length));
    if (cursor.unit !== null) {
      const row = frame.units.find((u) => u.unit === cursor.unit);
      const cluster = clusterOf(frame, cursor.unit);
      ops.push(
        call(
          "panel.focus",
          cursor.unit,
          row?.kind ?? null,
          row?.letter ?? null,
          row?.health ?? null,
          row?.weight ?? null,
          row?.fixity ?? null,
          cluster?.id ?? null,
          cluster?.members.length ?? 0,
          // "Locking narrows" is the word, everywhere: the header counts what is
          // still free, and a lock moves a unit into the bounded strip.
          cluster === null ? null : `${cluster.members.length} of ${cluster.members.length + cluster.boundedBy.length} free`
        )
      );
    }
    ops.push(...candidateOps(frame, cursor));
    ops.push(...movesetOps(frame, cursor, selected, trails));
    ops.push(...breakdownOps(frame, cursor, selected));
    ops.push(...renderTimeline(frame.events));
    ops.push(call("affordance.lock", lockLabel(frame, cursor, selected)));
    ops.push(
      call(
        "panel.provenance",
        frame.provenance.botId,
        frame.provenance.behaviourId,
        frame.provenance.evalVersion,
        frame.provenance.guidanceId,
        frame.provenance.emissionSeq,
        frame.provenance.quantaSpent,
        frame.provenance.premise
      )
    );
    return ops;
  }
  var LOCK_AFFORDANCE = {
    true: (pins, members) => `[Space] lock — pins ${pins} of ${members}`,
    false: () => "[N] return to now and lock"
  };
  function lockLabel(frame, cursor, selected) {
    const cluster = cursor.unit === null ? null : clusterOf(frame, cursor.unit);
    const members = cluster?.members ?? [];
    const pins = selected === null || cursor.unit === null ? 0 : members.filter(
      (v) => v === cursor.unit || (selected.moves.find((m) => m.unit === v)?.to ?? null) !== stagedCellOf(frame, v)
    ).length;
    return LOCK_AFFORDANCE[`${frame.at.isHead}`](pins, members.length);
  }
  var MODE_BADGE = {
    "live-head": "LIVE",
    "live-scrub": "⏸ SCRUBBED",
    replay: "REPLAY"
  };
  var PROVENANCE_BADGE = {
    observed: "observed",
    rerun: "re-derived"
  };
  function modeBadge(frame) {
    const head = headOf(frame);
    return `${MODE_BADGE[frame.at.mode]} · seq ${frame.at.seq}${head}`;
  }
  function headOf(frame) {
    return frame.at.isHead ? "" : " · read-only";
  }
  function provenanceBadge(frame) {
    return `${PROVENANCE_BADGE[frame.provenance.kind]} · ${frame.provenance.behaviourId}`;
  }
  return __toCommonJS(index_exports);
})();
