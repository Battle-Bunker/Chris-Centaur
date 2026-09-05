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
    LensNoMovesetError: () => LensNoMovesetError,
    LensOffHeadError: () => LensOffHeadError,
    applyCursorEvent: () => applyCursorEvent,
    boundingOf: () => boundingOf,
    bracketWidth: () => bracketWidth,
    checkDivergence: () => checkDivergence,
    clusterGlyph: () => clusterGlyph,
    clusterOf: () => clusterOf,
    cursorState: () => cursorState,
    depthCell: () => depthCell,
    dominanceClause: () => dominanceClause,
    emptyStateLine: () => emptyStateLine,
    frameAtSeq: () => frameAtSeq,
    incumbentCandidate: () => incumbentCandidate,
    initialCursor: () => initialCursor,
    makeLiveDecisionSource: () => makeLiveDecisionSource,
    makeReplayDecisionSource: () => makeReplayDecisionSource,
    modeBadge: () => modeBadge,
    movesetListFor: () => movesetListFor,
    movesetListKey: () => movesetListKey,
    planLock: () => planLock,
    provenanceBadge: () => provenanceBadge,
    rankOne: () => rankOne,
    reactiveNotice: () => reactiveNotice,
    renderFrame: () => renderFrame,
    renderTimeline: () => renderTimeline,
    replayFrameAtSeq: () => replayFrameAtSeq,
    reservoirListKey: () => reservoirListKey,
    resolveCursor: () => resolveCursor,
    reviveEvents: () => reviveEvents,
    rowTrails: () => rowTrails,
    rowsFor: () => rowsFor,
    stageSummary: () => stageSummary,
    stagedCellOf: () => stagedCellOf,
    widenAutoAcceptMs: () => widenAutoAcceptMs
  });

  // src/lens/store/index.ts
  function emptyStore(anchor) {
    return { turn: anchor.turn, anchor, events: [] };
  }
  function applyEvent(store, event) {
    if (event.turn !== store.turn) return store;
    if (event.seq === store.anchor.seq) return store;
    for (const held of store.events) {
      if (held.seq === event.seq) return store;
    }
    return { turn: store.turn, anchor: store.anchor, events: [...store.events, event] };
  }
  function bySeq(a, b) {
    return a.seq - b.seq;
  }
  function upTo(store, seq) {
    return [store.anchor, ...store.events].filter((e) => e.seq <= seq).sort(bySeq);
  }
  function payloadOf(event) {
    return event.payload;
  }
  function boardOf(anchor) {
    const carried = anchor.payload;
    const settlement = carried?.settlement;
    if (settlement && settlement.board) return settlement;
    return {
      game: { id: anchor.gameId, ruleset: { name: "", version: "", settings: {} }, map: "", timeout: 0, source: "" },
      turn: anchor.turn,
      board: { width: 0, height: 0, food: [], hazards: [], snakes: [] }
    };
  }
  function unitRowsOf(board, roster, fixities, dead) {
    const snakes = board.board.snakes ?? [];
    const keys = snakes.length > 0 ? snakes.map((s) => s.id) : [...roster];
    return keys.map((unit) => {
      const snake = snakes.find((s) => s.id === unit);
      const fixed = fixities.get(unit);
      return {
        unit,
        kind: snake?.unitType ?? "snake",
        letter: snake?.letter ?? "",
        weight: snake?.length ?? 0,
        health: snake?.health ?? 0,
        orientation: snake?.orientation ?? { dx: 0, dy: 0 },
        fixity: dead.has(unit) ? "dead" : fixed?.fixity ?? "free",
        owner: fixed?.owner ?? null,
        operator: fixed?.operator ?? null
      };
    });
  }
  function quantaOf(rows) {
    return rows.reduce((most, row) => Math.max(most, row.depth.deepest.quanta), 0);
  }
  function reservoirKey(cluster) {
    return String(cluster);
  }
  function conditionalKey(cluster, unit, to) {
    return `${cluster}|${unit}|${to}`;
  }
  function candidatesOf(priced) {
    const out = {};
    for (const [unit, rows] of priced) {
      out[unit] = [...rows.values()].sort((a, b) => a.to - b.to);
    }
    return out;
  }
  function noteCandidates(priced, rows, best) {
    for (const row of rows) {
      for (const move of row.moves) {
        let perUnit = priced.get(move.unit);
        if (!perUnit) {
          perUnit = /* @__PURE__ */ new Map();
          priced.set(move.unit, perUnit);
        }
        const existing = perUnit.get(move.to);
        const aggregate = best && row.rank === 1 ? { aggregate: row.lo, grade: row.exact ? "exact" : "provisional" } : existing?.conditionalBest ?? null;
        perUnit.set(move.to, {
          key: `${move.unit}:${move.to}`,
          to: move.to,
          path: move.path,
          legal: true,
          conditionalBest: aggregate,
          disposition: existing?.disposition ?? null
        });
      }
    }
  }
  function frameAt(store, seq) {
    const events = upTo(store, seq);
    const anchor = store.anchor;
    const board = boardOf(anchor);
    const arrival = payloadOf(anchor);
    let partition = [];
    const movesets = {};
    const truncation = {};
    const breakdown = {};
    const priced = /* @__PURE__ */ new Map();
    const staged = {};
    const routes = {};
    const waypoints = {};
    const advice = [];
    const fixities = /* @__PURE__ */ new Map();
    const dead = /* @__PURE__ */ new Set();
    const loud = {};
    let input = null;
    let emissionSeq = anchor.seq;
    let quantaSpent = 0;
    let last = anchor;
    for (const event of events) {
      last = event;
      switch (event.kind) {
        case "partition": {
          partition = payloadOf(event).clusters;
          break;
        }
        case "movesets": {
          const p = payloadOf(event);
          movesets[reservoirKey(p.cluster)] = p.rows;
          if (p.loud !== null) loud[reservoirKey(p.cluster)] = p.loud;
          quantaSpent = Math.max(quantaSpent, quantaOf(p.rows));
          noteCandidates(priced, p.rows, true);
          break;
        }
        case "conditional": {
          const p = payloadOf(event);
          for (const lock of p.locks) {
            movesets[conditionalKey(p.cluster, lock.unit, lock.to)] = p.rows;
            if (p.truncated !== null) {
              truncation[conditionalKey(p.cluster, lock.unit, lock.to)] = p.truncated;
            }
          }
          quantaSpent = Math.max(quantaSpent, quantaOf(p.rows));
          noteCandidates(priced, p.rows, true);
          break;
        }
        case "breakdown": {
          const p = payloadOf(event);
          breakdown[p.moveset] = p;
          break;
        }
        case "emission": {
          emissionSeq = event.seq;
          break;
        }
        case "decision.begin": {
          input = payloadOf(event).input ?? null;
          break;
        }
        case "pin": {
          const p = payloadOf(event);
          fixities.set(p.unit, {
            fixity: p.tentative ? "free" : "pinned",
            owner: event.actor.id,
            operator: event.actor.name
          });
          break;
        }
        case "unpin": {
          fixities.delete(payloadOf(event).unit);
          break;
        }
        case "commit": {
          const p = payloadOf(event);
          fixities.set(p.unit, {
            fixity: "committed",
            owner: event.actor.id,
            operator: event.actor.name
          });
          break;
        }
        case "commit.observed": {
          const unit = event.unit;
          if (unit !== null) {
            const held = fixities.get(unit);
            fixities.set(unit, {
              fixity: "committed",
              owner: held?.owner ?? event.actor.id,
              operator: held?.operator ?? event.actor.name
            });
            staged[unit] = { ...staged[unit] ?? {}, committed: true };
          }
          break;
        }
        case "stage.fastpass":
        case "stage.requested": {
          const p = payloadOf(event);
          staged[p.unit] = { ...staged[p.unit] ?? {}, unit: p.unit, to: p.to, source: p.source };
          break;
        }
        case "stage.confirmed": {
          const p = payloadOf(event);
          staged[p.unit] = { ...staged[p.unit] ?? {}, unit: p.unit, confirmed: p.to, serverTs: p.serverTs };
          break;
        }
        case "stage.retry": {
          const p = payloadOf(event);
          staged[p.unit] = { ...staged[p.unit] ?? {}, unit: p.unit, retryWhy: p.why };
          break;
        }
        case "operator.command": {
          applyCommand(event, routes, waypoints);
          break;
        }
        case "advice": {
          const p = payloadOf(event);
          advice.push({ ...p, by: event.actor.id });
          break;
        }
        case "turn.resolved": {
          const p = payloadOf(event);
          for (const death of p.deaths) dead.add(death);
          for (const move of p.moves) {
            staged[move.unit] = { ...staged[move.unit] ?? {}, unit: move.unit, resolved: move.to };
          }
          break;
        }
        default:
          break;
      }
    }
    const at = {
      gameId: anchor.gameId,
      turn: store.turn,
      seq,
      // THE AXIS THAT REPLAYS. `atWorkMs` is the kernel's own clock from t0 —
      // `nodes × NODE_COST + reads × READ_COST` — and it is what the ticks
      // carry; the wall delta is the fallback for an event nobody measured, and
      // it is a different axis from the one the lane is laid out on.
      tMono: last.atWorkMs ?? last.atWall - anchor.atWall,
      tWall: last.atWall,
      mode: "replay",
      isHead: false
    };
    return {
      at,
      board,
      units: unitRowsOf(board, arrival?.roster ?? [], fixities, dead),
      partition,
      candidates: candidatesOf(priced),
      movesets,
      movesetTruncation: truncation,
      breakdown,
      loud,
      staged,
      routes,
      waypoints,
      advice,
      events,
      provenance: provenanceOf(input, emissionSeq, quantaSpent)
    };
  }
  function applyCommand(event, routes, waypoints) {
    const p = payloadOf(event);
    const unit = p.target ?? event.unit;
    if (unit === null) return;
    switch (p.verb) {
      case "goto-set":
      case "goto-append":
      case "goto-remove":
      case "goto-target-reached":
        routes[unit] = { kind: "goto", ...p.detail, by: event.actor.id };
        break;
      case "near-set":
        waypoints[unit] = { kind: "near", ...p.detail, by: event.actor.id };
        break;
      case "waypoint-clear":
        delete waypoints[unit];
        break;
      case "input-clear":
      case "command-cleared-on-death":
        delete routes[unit];
        delete waypoints[unit];
        break;
      default:
        break;
    }
  }
  function digestString(digest, key) {
    const value = digest?.[key];
    return typeof value === "string" ? value : null;
  }
  function provenanceOf(input, emissionSeq, quantaSpent) {
    return {
      botId: input?.botId ?? "",
      behaviourId: input?.behaviourId ?? "",
      evalVersion: digestString(input?.kernelOptions, "evalVersion") ?? "",
      guidanceId: digestString(input?.kernelOptions, "guidanceId"),
      emissionSeq,
      quantaSpent,
      premise: null,
      kind: "observed"
    };
  }
  function anchorWithSettlement(anchor, settlement) {
    return { ...anchor, payload: { ...anchor.payload, settlement } };
  }
  function reviveLens(value) {
    return revive(value);
  }
  function revive(value) {
    if (Array.isArray(value)) return value.map(revive);
    if (value === null || typeof value !== "object") return value;
    const record = value;
    const named = record.$num;
    if (typeof named === "string" && Object.keys(record).length === 1) {
      if (named === "+inf") return Infinity;
      if (named === "-inf") return -Infinity;
      if (named === "nan") return NaN;
    }
    const out = {};
    for (const key of Object.keys(record)) out[key] = revive(record[key]);
    return out;
  }

  // src/lens/store/sources.ts
  function refuse(reason, detail) {
    return { ok: false, refusal: reason, detail };
  }
  var LIVE_MODE = { true: "live-head", false: "live-scrub" };
  var NO_PORT = "no running kernel is attached to this source, so nothing can be searched for the ask; the recorded frames answer, the reserve does not";
  function headSeqOf(store) {
    return store.events.reduce((max, e) => Math.max(max, e.seq), store.anchor.seq);
  }
  function makeSource(kind, input, stamp) {
    let store = input.store;
    let at = input.at;
    const listeners = /* @__PURE__ */ new Set();
    function announce(delta) {
      for (const fn of listeners) fn(delta);
    }
    return {
      kind,
      get at() {
        return at;
      },
      seek(to) {
        at = to;
        announce({ kind: "cursor", at: to });
      },
      frame() {
        return stamp(frameAt(store, at.seq), at, store);
      },
      timeline() {
        return frameAt(store, at.seq).events;
      },
      async breakdown(moveset) {
        const stored = frameAt(store, at.seq).breakdown[moveset];
        if (stored !== void 0) {
          return { value: stored, basis: stored.basis, provenance: { kind: "observed", at } };
        }
        if (!input.port) return refuse("off-head", NO_PORT);
        const answer = await input.port.explainMoveset(moveset);
        if ("ok" in answer) return answer;
        return {
          value: answer,
          basis: answer.basis,
          provenance: { kind: "observed", at }
        };
      },
      async conditional(req) {
        if (!input.port) return refuse("off-head", NO_PORT);
        const answer = askConditional(input.port, req);
        if (!answer.ok) return answer;
        return {
          requestId: answer.contextKey,
          ranking: answer.rows,
          cursor: answer.cursor,
          final: answer.final,
          cancel() {
          }
        };
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      /** Live only in practice, and harmless on a replay: fold one more event
       *  and tell every cursor watching. The reducer refuses a duplicate `seq`,
       *  so a re-delivered event costs a scan and changes nothing. */
      ingest(event) {
        const next = applyEvent(store, event);
        if (next === store) return;
        store = next;
        announce({ kind: "event", event });
      }
    };
  }
  function askConditional(port, req) {
    const live = port.partition().find((c) => c.id === req.cluster);
    if (live !== void 0 && live.generation !== req.clusterGeneration) {
      return refuse(
        "generation-superseded",
        `cluster ${req.cluster} is at generation ${live.generation}, the ask named ${req.clusterGeneration} — rows from two generations are never in one list`
      );
    }
    return port.rankConditional(req.cluster, [req.lock]);
  }
  function makeLiveSource(input) {
    return makeSource("live", input, (frame, at, store) => {
      const head = input.isHead && at.seq >= headSeqOf(store);
      return { ...frame, at: { ...frame.at, mode: LIVE_MODE[`${head}`], isHead: head } };
    });
  }
  function makeReplaySource(input) {
    return makeSource("replay", input, (frame) => ({
      ...frame,
      at: { ...frame.at, mode: "replay", isHead: false }
    }));
  }

  // src/lens/view/cursor.ts
  var WIDEN_AUTO_ACCEPT_CAP_MS = 6e3;
  var WIDEN_AUTO_ACCEPT_SHARE = 0.25;
  var WIDEN_AUTO_ACCEPT_FLOOR_MS = 1500;
  var TRAIL_DECAY_EMISSIONS = 2;
  var gesture = {
    drillOpen: false,
    lockInFlight: false,
    lockEveryMember: false,
    displaced: null
  };
  function clusterOf(frame, unit) {
    return frame.partition.find((c) => c.members.includes(unit)) ?? null;
  }
  function boundingOf(frame, unit) {
    for (const cluster of frame.partition) {
      const found = cluster.boundedBy.find((b) => b.unit === unit);
      if (found) return { cluster, bound: found };
    }
    return null;
  }
  function movesetListKey(cluster, unit, to) {
    return `${cluster}|${unit}|${to}`;
  }
  function reservoirListKey(cluster) {
    return String(cluster);
  }
  var EMPTY_LIST = { rows: [], source: "none", retained: 0, truncated: null };
  function movesetListFor(frame, unit, to) {
    if (unit === null || to === null) return EMPTY_LIST;
    const cluster = clusterOf(frame, unit);
    if (cluster === null) return EMPTY_LIST;
    const conditional = frame.movesets[movesetListKey(cluster.id, unit, to)];
    const retained = frame.movesets[reservoirListKey(cluster.id)] ?? [];
    if (conditional !== void 0) {
      return {
        rows: conditional,
        source: "conditional",
        retained: retained.length,
        truncated: frame.movesetTruncation?.[movesetListKey(cluster.id, unit, to)] ?? null
      };
    }
    return {
      rows: retained.filter((row) => row.moves.some((m) => m.unit === unit && m.to === to)),
      source: "restricted",
      retained: retained.length,
      truncated: null
    };
  }
  function rowsFor(frame, unit, to) {
    return movesetListFor(frame, unit, to).rows;
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
    const expiry = payload?.turnExpiryTime;
    return typeof expiry === "number" && expiry > 0 ? expiry : null;
  }
  function widenAutoAcceptMs(frame) {
    const expiry = turnExpiryOf(frame);
    if (expiry === null) return WIDEN_AUTO_ACCEPT_CAP_MS;
    const remaining = expiry - frame.at.tWall;
    const scaled = Math.round(WIDEN_AUTO_ACCEPT_SHARE * remaining);
    return Math.max(
      WIDEN_AUTO_ACCEPT_FLOOR_MS,
      Math.min(WIDEN_AUTO_ACCEPT_CAP_MS, scaled)
    );
  }
  function reactiveNotice(prev, next) {
    for (const before of prev.partition) {
      const after = successorOf(before, next);
      if (after === void 0) continue;
      const gained = after.members.filter((m) => !before.members.includes(m));
      if (gained.length > 0) {
        return {
          cluster: before.id,
          fromGeneration: before.generation,
          toGeneration: after.generation,
          gained,
          by: attributionFor(prev, before.boundedBy, gained),
          // What the cluster WAS. The banner adds the gained members to it, so
          // "cluster α is now 4 units" is arithmetic the reader can check
          // against the two halves of the same sentence.
          members: before.members.length,
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
          // A unit leaves a cluster because somebody FIXED it — and also because
          // it died, or resolved, or is simply not on the board any more. Only
          // the first of those has a reason and an author in `boundedBy`, and
          // naming the others `pin` would attribute a determination nobody made.
          why: bound?.why ?? "gone",
          by: bound?.by ?? null
        };
      }
    }
    return null;
  }
  function successorOf(before, next) {
    const sameId = next.partition.find((c) => c.id === before.id);
    if (sameId !== void 0) return sameId;
    return next.partition.find((c) => c.lineage.includes(before.id));
  }
  function attributionFor(prev, boundedBy, gained) {
    const declared = boundedBy.find((b) => gained.includes(b.unit))?.by ?? null;
    if (declared !== null) return declared;
    const row = prev.units.find((u) => gained.includes(u.unit) && u.owner !== null);
    if (row !== void 0) return row.operator ?? row.owner;
    const released = [...prev.events].reverse().find(
      (e) => (e.kind === "pin" || e.kind === "unpin" || e.kind === "commit") && e.unit !== null && gained.includes(e.unit) && e.payload?.tentative !== true
    );
    if (released === void 0) return null;
    return released.actor.name ?? released.actor.id ?? null;
  }

  // src/lens/view/index.ts
  function makeLiveDecisionSource(input) {
    return makeLiveSource(input);
  }
  function makeReplayDecisionSource(input) {
    return makeReplaySource(input);
  }
  function reviveEvents(events) {
    return events.map((e) => reviveLens(e));
  }
  function storeOf(events, settlement) {
    const found = events.find((e) => e.kind === "board.arrived") ?? events[0];
    if (found === void 0) throw new Error("a turn with no events has no frame");
    const anchor = settlement ? anchorWithSettlement(found, settlement) : found;
    const store = events.filter((e) => e.seq > anchor.seq).reduce((acc, e) => applyEvent(acc, e), emptyStore(anchor));
    return { store, at: { gameId: anchor.gameId, turn: anchor.turn, seq: anchor.seq } };
  }
  function frameAtSeq(events, seq, isHead) {
    const { store, at } = storeOf(events);
    return makeLiveDecisionSource({ store, at: { ...at, seq }, isHead }).frame();
  }
  function replayFrameAtSeq(events, seq, settlement = null) {
    const { store, at } = storeOf(events, settlement);
    return makeReplayDecisionSource({ store, at: { ...at, seq } }).frame();
  }
  var CLUSTER_GLYPHS = "αβγδεζηθικλμν";
  function clusterGlyph(index) {
    return CLUSTER_GLYPHS[index] ?? `c${index}`;
  }
  function call(op, ...args) {
    return { op, args };
  }
  var round1 = (n) => Number(n.toFixed(1));
  function bracketWidth(row) {
    const { deepest } = row.depth;
    return Number((deepest.hi - deepest.lo).toFixed(2));
  }
  function depthCell(row, loud = null) {
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
    const decline = deepened || loud === null ? "·" : `· Q=${loud.q}/${loud.product}`;
    return {
      label: `h${deepest.horizon}`,
      marks: marks.length > 0 || deepened ? marks : [decline],
      delta: deepened ? Number((delta.lo !== 0 ? delta.lo : delta.hi).toFixed(2)) : null,
      // A declared narrowing means `compareFloors` refuses: the row is present
      // and is NOT sorted against the others.
      sorted: !narrowed
    };
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
  function emptyStateLine(frame, cursor = initialCursor()) {
    const unit = cursor.unit;
    if (unit !== null) {
      const bound = boundingOf(frame, unit);
      if (bound !== null) {
        const author = authorOf(frame, unit, bound.bound.by);
        const by = author === null ? "" : ` by ${author}`;
        return `${unit} is ${FIXITY_VERB[bound.bound.why]}${by} — it is a constant of cluster ${bound.cluster.id}, not a variable the bot is solving`;
      }
      const dead = frame.units.find((u) => u.unit === unit)?.fixity ?? "free";
      if (dead === "dead") return `${unit} is dead — there is nothing left to choose for it`;
    }
    const emissions = frame.events.filter((e) => e.kind === "emission").length;
    if (emissions === 0) {
      const fastpass = frame.events.some((e) => e.kind === "stage.fastpass");
      const staged = fastpass ? "fast-pass only" : "nothing staged yet";
      return `${staged} — no kernel emission yet at seq ${frame.at.seq}`;
    }
    if (unit === null) return `${emissions} emissions at seq ${frame.at.seq} — no unit is focused`;
    return `nothing retained for ${unit} at this candidate — ${emissions} emissions by seq ${frame.at.seq} and no priced restriction plays it`;
  }
  function authorOf(frame, unit, declared) {
    if (declared !== null) return declared;
    const row = frame.units.find((u) => u.unit === unit);
    return row?.operator ?? row?.owner ?? null;
  }
  var FIXITY_VERB = {
    pin: "pinned",
    commit: "committed",
    reference: "held as a reference",
    "pin-unreachable": "pinned at a cell it cannot reach"
  };
  function boardOps(frame, cursor, selected) {
    const ops = [];
    const board = frame.board.board;
    ops.push(call("board", frame.at.turn, board.width, board.height));
    frame.partition.forEach((cluster2, index) => {
      const glyph = clusterGlyph(index);
      for (const member of cluster2.members) ops.push(call("cluster.chip", member, glyph, cluster2.id));
      for (const bound of cluster2.boundedBy) {
        ops.push(
          call("fixed.chip", bound.unit, bound.why, authorOf(frame, bound.unit, bound.by), bound.to)
        );
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
        if (same) continue;
        ops.push(call("foil.arrow", move.unit, move.to));
        const delta = memberDelta(frame, foil, selected, move.unit);
        if (delta !== null) ops.push(call("foil.delta", move.unit, delta));
      }
    }
    return ops;
  }
  function memberDelta(frame, foil, selected, unit) {
    const of = (row) => frame.breakdown[row.key]?.marginals.find((m) => m.unit === unit)?.delta.lo ?? null;
    const mine = of(foil);
    const theirs = of(selected);
    return mine === null || theirs === null ? null : Number((mine - theirs).toFixed(2));
  }
  function candidateOps(frame, cursor) {
    if (cursor.unit === null) return [];
    const rows = frame.candidates[cursor.unit] ?? [];
    const incumbent = incumbentCandidate(frame, cursor.unit);
    return [
      // WHAT THE LIST IS: the destinations THIS DECISION priced, scored as the
      // best the whole cluster can do given that candidate. It is not the unit's
      // legal-move count, and a header that read like one invited the operator
      // to conclude the bot had considered four moves when it had priced four.
      call("panel.candidates", rows.length, "priced here · scored as best-of-cluster"),
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
    const list = movesetListFor(frame, cursor.unit, cursor.candidate);
    const rows = list.rows;
    if (rows.length === 0) return [call("panel.movesets.empty", emptyStateLine(frame, cursor))];
    const leader = rankOne(rows);
    const cluster = cursor.unit === null ? null : clusterOf(frame, cursor.unit);
    const loud = cluster === null ? null : frame.loud?.[reservoirListKey(cluster.id)] ?? null;
    const ops = [
      call(
        "panel.movesets",
        cluster?.id ?? null,
        cluster === null ? 0 : cluster.members.length,
        cluster === null ? 0 : cluster.boundedBy.length,
        frame.at.seq,
        // A stale complement is a row whose QUESTION changed while its answer
        // stayed sound. It is struck through and headed, never dropped.
        rows.some((r) => r.complement === "stale"),
        // WHAT THIS LIST IS. On the shipped build it is one row — the cluster's
        // retained rows restricted to the ones that play this candidate — and a
        // table headed `MOVESETS` over a single row with two inert keys tells
        // the operator nothing about why. The head says which of the two lists
        // this is and how many rows the reservoir retained for the cluster, so
        // "there is nowhere for `]` to go" is a readable fact rather than a
        // suspicion (10 §4 O1).
        list.source,
        list.retained,
        // WHERE THE RANKING STOPPED. A conditional list that the reserve cut
        // short and a cluster with nothing else in it are the same table on
        // screen unless the head says which one this is — the same distinction
        // a typed refusal draws for a request nobody could serve (10 §4 O1).
        list.truncated
      )
    ];
    const foil = selected === null ? null : foilRow(frame, cursor, selected);
    for (const row of rows) {
      const cell = depthCell(row, row.key === leader?.key ? loud : null);
      const priced = row.unpriced !== true;
      const trail = trails.find((t) => t.moveset === row.key) ?? null;
      ops.push(
        call(
          "panel.movesets.row",
          row.rank,
          // THE ROW'S OWN KEY. T6 names a click on a moveset row as a source of
          // the cursor transition, and the rail could not offer one because the
          // markup had no way to say which row was clicked (10 §4 O5).
          row.key,
          // ONE CHANNEL PER ROW, AND IT IS THE ONE THAT ADJUDICATES. `lo` is the
          // proved floor: the quantity the reservoir ranks on (`byBetter`), the
          // quantity `⌈w⌉` is a width of, and the quantity Δ measures. Showing
          // `est` here when the posture ordered by it put three numbers from two
          // channels on one row with nothing saying which was which — and `est`
          // is the channel that never adjudicates. It keeps its own voice in the
          // `unless` cell, where `advisory-only` prices it and names it.
          priced ? row.lo : null,
          priced ? bracketWidth(row) : null,
          cell,
          leader === null || !priced || leader.unpriced === true ? null : Number((row.lo - leader.lo).toFixed(2)),
          // THE `unless` CELL. Drawn on every row, leader included, and never
          // omitted: a row with no clause and a row that leads on the proved
          // floor are two different states and only "always draw it" tells them
          // apart (Law A, applied to the reduction).
          dominanceClause(row.dominance),
          row.moves.map((m) => `${m.unit}→${m.to}`),
          row.complement,
          row.key === selected?.key,
          row.staged,
          trail,
          // WHICH ROW IS THE RUNNER-UP, and the row's own estimate. Both are
          // appended rather than woven in, so every existing reader keeps its
          // indices: the rail marks the foil row at full size beside rank 1, and
          // draws the bracket as a BAND with `est` as its marked point rather
          // than as `-51.6 ⌈93.0⌉` text that one reader in three inverts.
          row.key === foil?.key,
          priced ? row.est : null
        )
      );
    }
    for (const bound of cluster?.boundedBy ?? []) {
      ops.push(
        call(
          "panel.movesets.fixed",
          bound.unit,
          bound.to,
          bound.why,
          authorOf(frame, bound.unit, bound.by)
        )
      );
    }
    if (selected !== null) {
      ops.push(
        foil === null ? call("panel.foil", null, null, noFoilReason(list), null) : call(
          "panel.foil",
          foil.rank,
          // A MARGIN BETWEEN TWO UNPRICED ROWS IS NOT A NUMBER. The
          // conditional ranking's rows are assignments, so the line names
          // the runner-up and why it lost and draws `—` where a margin
          // would be, rather than a difference of two zeros.
          selected.unpriced === true || foil.unpriced === true ? null : Number((selected.lo - foil.lo).toFixed(2)),
          whyItLost(selected, foil),
          depthCell(foil).label
        )
      );
    }
    return ops;
  }
  function noFoilReason(list) {
    if (list.source === "conditional") {
      return list.truncated === null ? "no runner-up — the conditional list has one row" : `no runner-up — ${list.truncated.detail}`;
    }
    return list.retained <= 1 ? "no runner-up — the reservoir retained one row for this cluster" : `no runner-up — only 1 of ${list.retained} retained rows plays this candidate`;
  }
  var RESIDUE_KEY = "#-1";
  var namedUnit = (key) => key === RESIDUE_KEY ? "the evaluator residue" : key;
  function dominanceClause(dominance) {
    if (dominance === null) return "unsealed — the barrier has not run";
    switch (dominance.kind) {
      case "leader":
        return "leads on the proved floor";
      case "refuted-by-witness":
        return "refuted by a witness";
      case "incomparable-basis":
        return "incomparable basis — not sorted against the leader";
      case "contingent":
        return dominance.onUnits.length === 0 ? `wins on nothing named — ${round1(dominance.atStake)} at stake` : `${dominance.onUnits.map(namedUnit).join(", ")} resolve against us · ${round1(dominance.atStake)} at stake`;
      case "dominated":
        return `cannot win — dominated by ${round1(dominance.by)}`;
      case "advisory-only":
        return `floors equal — advisory ${round1(dominance.estMargin)}`;
      case "indifferent":
        return "my proof rungs are silent here — your call beats my tie-break";
    }
  }
  function whyItLost(selected, foil) {
    const loser = selected.rank > foil.rank ? selected : foil;
    return `#${loser.rank} ${dominanceClause(loser.dominance)}`;
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
    breakdown: "kernel",
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
      const payload = event.payload;
      const hover = payload?.hover === true || payload?.tentative === true;
      ops.push(
        call(
          "timeline.tick",
          LANE_OF[event.kind] ?? "operator",
          event.seq,
          event.atWorkMs,
          event.kind,
          event.actor.id,
          event.actor.color,
          hover ? "hollow" : "solid",
          // WHO AND ON WHAT. §2.2 asks for `●Ada near(s2)` — the verb, the unit
          // and the operator — and the tick carried the kind and the time and
          // nothing else, because no `pin` / `unpin` row existed to carry a name.
          event.actor.name,
          event.unit
        )
      );
    }
    return ops;
  }
  function stageSummary(frame) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (unit, clusterId, fixity, by) => {
      if (seen.has(unit)) return;
      seen.add(unit);
      const row = frame.units.find((u) => u.unit === unit);
      const staged = stagedCellOf(frame, unit);
      const planned = staged !== null || clusterId === null ? null : rankOne(frame.movesets[reservoirListKey(clusterId)] ?? [])?.moves.find(
        (m) => m.unit === unit
      )?.to ?? null;
      out.push({
        unit,
        letter: row?.letter || unit,
        to: staged !== null ? staged : planned,
        source: staged !== null ? "staged" : planned !== null ? "plan" : "none",
        fixity,
        by
      });
    };
    for (const cluster of frame.partition) {
      for (const member of cluster.members) push(member, cluster.id, "free", null);
      for (const bound of cluster.boundedBy) {
        push(
          bound.unit,
          cluster.id,
          FIXITY_VERB[bound.why] ?? bound.why,
          authorOf(frame, bound.unit, bound.by)
        );
      }
    }
    return out;
  }
  function renderFrame(frame, cursor = initialCursor(), trails = []) {
    const selected = selectedRow(frame, cursor);
    const ops = [call("frame", frame.at.turn, frame.at.seq, frame.at.tMono)];
    ops.push(...boardOps(frame, cursor, selected));
    ops.push(call("panel.advice", frame.advice.length));
    ops.push(call("panel.stage", stageSummary(frame)));
    if (cursor.unit !== null) {
      const row = frame.units.find((u) => u.unit === cursor.unit);
      const cluster = clusterOf(frame, cursor.unit);
      const bound = cluster === null ? boundingOf(frame, cursor.unit) : null;
      const home = cluster ?? bound?.cluster ?? null;
      const boundBy = bound === null ? null : authorOf(frame, bound.bound.unit, bound.bound.by);
      const why = bound === null ? null : `a constant of cluster ${bound.cluster.id}${boundBy === null ? "" : `, by ${boundBy}`} — not a member`;
      ops.push(
        call(
          "panel.focus",
          cursor.unit,
          row?.kind ?? null,
          row?.letter ?? null,
          row?.health ?? null,
          row?.weight ?? null,
          // THE UNIT'S OWN FIXITY, AND THE PARTITION'S, ARE ONE ANSWER. `frameAt`
          // derives `UnitRow.fixity` from the turn's `pin` / `commit` events —
          // which nothing on the wire writes today — while the partition frame
          // carries the same fact as `boundedBy`. Reading only the first, the
          // rail printed `free · pin · a constant, not a member` on one line: a
          // unit that is simultaneously a free variable and a constant. The
          // partition wins, because it is the statement the kernel actually made.
          bound === null ? row?.fixity ?? null : FIXITY_VERB[bound.bound.why],
          home?.id ?? null,
          home?.members.length ?? 0,
          // "Locking narrows" is the word, everywhere: the header counts what is
          // still free, and a lock moves a unit into the bounded strip.
          why ?? (home === null ? null : `${home.members.length} of ${home.members.length + home.boundedBy.length} free`)
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
  function lockLabel(frame, cursor, selected) {
    const cluster = cursor.unit === null ? null : clusterOf(frame, cursor.unit);
    const members = cluster?.members ?? [];
    const pins = selected === null || cursor.unit === null ? 0 : members.filter(
      (v) => v === cursor.unit || (selected.moves.find((m) => m.unit === v)?.to ?? null) !== stagedCellOf(frame, v)
    ).length;
    return frame.at.isHead ? `[Space] lock — pins ${pins} of ${members.length}` : recordedLock(frame, members) ?? "— read-only —";
  }
  function recordedLock(frame, members) {
    const scope = new Set(members);
    const locked = [...frame.events].reverse().find(
      (e) => (e.kind === "pin" || e.kind === "commit") && e.unit !== null && scope.has(e.unit) && e.payload?.tentative !== true
    );
    if (locked === void 0) return null;
    const who = locked.actor.name ?? locked.actor.id ?? "an operator";
    const at = locked.atWorkMs === null ? "" : ` at +${locked.atWorkMs}ms`;
    return `locked by ${who}${at} → [jump]`;
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
  var WAY_BACK = {
    "live-head": "",
    "live-scrub": " · [N] return to now",
    replay: ""
  };
  function modeBadge(frame) {
    const head = headOf(frame);
    return `${MODE_BADGE[frame.at.mode]} · seq ${frame.at.seq}${head}${WAY_BACK[frame.at.mode]}`;
  }
  function headOf(frame) {
    return frame.at.isHead ? "" : " · read-only";
  }
  function provenanceBadge(frame) {
    return `${PROVENANCE_BADGE[frame.provenance.kind]} · ${frame.provenance.behaviourId}`;
  }
  return __toCommonJS(index_exports);
})();
