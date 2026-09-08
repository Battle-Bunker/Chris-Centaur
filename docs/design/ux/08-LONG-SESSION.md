# 08 — LONG SESSION: what the page accumulates, what it spends, and what it costs to open

UX, document 8. `03-LATENCY.md` §1 times one turn on the operator page and
answers "what does a turn cost". This document asks the two questions that
document could not: **what does the page ACCUMULATE over hundreds of turns**,
and **what does it SPEND per second while it waits**. An operator holds
`play-game.html` open for an afternoon across many games; a surface that is
fast per turn and leaks 30 nodes a turn is unusable by the evening, and a
surface that leaks nothing and lays out thirty times a second is the one that
flattens the laptop. §1 is the soak, §2 is the standing cost, §3 is the cold
load, §4 is what was changed and §5 is what was found and deliberately left.

Measured on `ux-perf-2` against `src/tests/lens-walkthrough-server.ts` (`mixed`
at seed 1, 550 work units, three teams, 11 × 11) with three new drivers:

| | what it asks |
|---|---|
| `scripts/lens-soak.js` | 200 turns, every module live — heap, DOM, listeners, timers, detached DOM |
| `scripts/lens-churn.js` | per-second cost at rest and while stepping, attributed by ablation |
| `scripts/lens-coldload.js` | first paint, TTI, and every byte in front of them |

The raw runs are checked in beside this file under `soak/`.

**Four modules run on this page, not five.** `page-chrome.js` is on
`activity.html`, `config.html`, `connection-debug.html`, `history.html` and
`play.html`; `play-game.html` has never loaded it. The operator page's own
module set is the lens view (`lens-view.js` + `lens-panel.js`), `latency.js`,
`alerts.js` and `tour.js`, over `board-renderer.js`, `keynav-machine.js`,
`ws-client.js`, `dom-utils.js`, `idle-policy.js`, `idle-watcher.js`,
`connection-debug.js`, `server-status-badge.js`, `firebase-status-banner.js`
and `replay-deeplink.js` — fifteen scripts.

---

## 1. The soak: 200 turns

### 1.1 How

`scripts/lens-soak.js` opens the shipped page at the shipped viewport
(1500 × 950), enters through the login gate as an operator, and plays 200 turns
through `/dev/step`. Between turns it drives the same gestures
`scripts/lens-walkthrough.js` photographs, on **coprime periods** — hover every
turn, moveset hover every 2, roster focus every 3, the answered candidate and a
rank walk every 5, foil and drill every 7, scrub and undo every 11, a lock every
13, the lane every 17, the alerts popover every 19 — so the combinations that
come up are not the same four every ten turns. The tour is opened once, walked
and closed. The wire is reshaped every 40 turns through the new `/dev/wire`
route, so the latency ladder changes rung five times in one session and
`alerts.js` has something to raise more than once (46 alerts raised in the
`after` run, ending on `STALE`).

Per turn it forces a GC (`HeapProfiler.collectGarbage`) and then reads CDP
`Performance.getMetrics` — `JSHeapUsedSize`, `Nodes`, `JSEventListeners`,
`LayoutCount`, `RecalcStyleCount`, `ScriptDuration`, `LayoutDuration` — plus a
per-module ledger of `setTimeout` / `setInterval` / `addEventListener` /
`removeEventListener` installed before any page script runs and attributed by
stack, plus a census of every top-level collection the page holds. Heap
snapshots at turn 50 and turn 200 are parsed for detached DOM.

**The GC is not optional and the first version of this driver proved it.**
Between collections the page holds four to five thousand nodes it has already
dropped: an ungc'd node count reads 1,859 on one turn and 8,163 on the next and
says nothing whatever about what is *retained*, which is the only question a
soak asks.

### 1.2 The instrument's first finding was itself

The first run reported the page growing **32 DOM nodes per turn**. It was not.
A Playwright `ElementHandle` is a global handle in the page's own V8 heap, and
the roster and the rail are rebuilt several times a turn, so a handle taken on
one turn pins a node the page has already dropped — together with its entire
detached subtree. The same run with the drills switched off reported −1.6
nodes a turn. The 32 was Playwright.

Every handle in the driver is now taken through `withHandle` / `withHandles`
and disposed in a `finally`. This is recorded because the next person to point
a headless browser at a leak will make the same measurement and get the same
wrong answer, and because a leak-hunting instrument that leaks is the one bug
that cannot be caught by looking at the graph.

### 1.3 The curves

Second-half least-squares slopes (turns 100–200), so that the warm-up every
page legitimately does — filling the roster, the timeline, the style sheets —
is not counted as a leak:

| | before | after | |
|---|---|---|---|
| JS heap | **+2.09 KB/turn** (3.46 → 5.13 MB) | **+1.48 KB/turn** (3.46 → 5.19 MB) | −29 % |
| DOM nodes | −0.67/turn (1732 → 1668) | −2.02/turn (1739 → 1674) | flat, both |
| event listeners | **0.00/turn** (107 → 106) | **0.00/turn** (109 → 108) | flat, both |
| live timers | 0.00/turn (9 intervals throughout) | 0.00/turn (9 intervals throughout) | flat, both |
| detached DOM nodes | **0 at turn 50, 0 at turn 200** | **0 at turn 50, 0 at turn 200** | none, both |

**Three of the five lines were already flat and the honest headline is that
this page does not leak.** No listener survives a turn change, no timer
survives a disconnect, and nothing is detached and held. The per-module
listener ledger is constant from turn 1 to turn 200 in both runs — 37
registrations from `play-game.html`, 9 from `idle-watcher.js`, 7 from
`alerts.js`, 5 each from `tour.js` and `connection-debug.js`, and so on down —
and the interval count is nine at turn 1 and nine at turn 200:

```
idle-watcher.js 2 · play-game.html 3 · latency.js 2 · alerts.js 2
replay-deeplink.js 1 · connection-debug.js 1
```

### 1.4 The one line that is not flat, and what it is

The census of the page's own collections at turn 200 names the whole of the
remaining slope:

| collection | at turn 200 | |
|---|---|---|
| `turnTimeline` | **202** | one full board snapshot per turn, unbounded |
| `timelineTurns` | **202** | its sorted key list |
| `lensPending` | **18** | request ids whose answer never came |
| `alertsLog` | 44 | capped at `LOG_MAX` = 200 |
| `lensEvents` | 13 | reset every turn |
| `lensTranscript` | 24 | reset every turn |
| `snakeLastSeen`, `lensUndoStack`, `historicEvents`, `connectedUsers`, … | ≤ 8 | flat |

The heap-snapshot diff between turn 50 and turn 200 agrees exactly: every DOM
constructor is unchanged (`HTMLDivElement` 178 → 178, `HTMLSpanElement` 97 →
94, `SVGPathElement` 45 → 45, `Attr` 17 → 17) and the growth is **plain
`Object` +6,767 and `Array` +1,061** — 45 objects a turn, which is what an
11 × 11 board with its snakes, bodies, food and hazards costs to keep.

`turnTimeline` is the timeline scrubber's board cache; `lensPending` is the map
of in-flight lens requests. **Both live in `play-game.html`'s inline script,
which this branch does not own** (`ux-eval` holds that page). They are named
here, with their rate, so whoever does own it has the measurement:
at one turn a second, 1.48 KB/turn is 5.3 MB an hour, and the cache has no
ceiling and no eviction — every row of it is re-fetchable from
`/api/games/:id/turns`, so a bounded window plus a refetch on a scrub outside
it would flatten the last line on this page.

---

## 2. The standing cost: what an open page spends per second

A leak is not the only way a long session goes wrong. `scripts/lens-churn.js`
measures `LayoutCount`, `RecalcStyleCount`, `ScriptDuration` and
`LayoutDuration` over a 25-second window in two conditions — **idle** (the page
open, no turn being played, which is most of an operator's afternoon) and
**stepping** (a turn every 1.5 s) — and attributes them **by ablation**: an
init script swallows `setInterval` calls made from a named file, nothing else
about that module changes, and the difference between the run with and the run
without is that module's standing cost. A wrapper around a module's own draw
could only see the work that module does; the layouts it *causes* happen later,
in the browser's own rendering task, and ablation is the only thing that
catches those.

### 2.1 The finding

| idle, per second | before | after |
|---|---|---|
| layouts | **30.3** | **21.3** |
| style recalculations | 59.5 | 53.3 |
| script | 5.7 ms | 3.8 ms |
| — with `latency.js`'s intervals ablated | 20.4 layouts | 20.4 layouts |
| — with `alerts.js`'s intervals ablated | 30.0 layouts / 48.4 recalcs | 21.0 layouts / 39.5 recalcs |

**`latency.js` was doing ten forced layouts a second, for ever, and the cause
was one string.** On any wire the ladder is not calling `LIVE`, the banner
reads `no decision frame for 1234 ms` — an *age*, so a different string on
every one of the ten ticks a second, so a `textContent` write, a style
recalculation and a layout on every one of them. The strip's four numbers had
the same shape: two of the four (`frame +Nms`, `board +Nms`) are ages, so
`el.nums.innerHTML = numsHTML(r)` destroyed and rebuilt four spans ten times a
second as well. The page an operator leaves open all afternoon spent its whole
afternoon re-laying-out a sentence that says the same thing.

After the fixes in §4, `latency.js`'s contribution to idle layout is **0.9 per
second** — ablating it now changes nothing measurable — and its script time
falls with it. While turns are flowing it still draws on every arrival, which
is 4.5 layouts/s of the `stepping` figure below and is the readout doing its
job:

| stepping (one turn / 1.5 s), per second, after | |
|---|---|
| layouts | 30.0 |
| style recalculations | 55.4 |
| script | 15.0 ms |
| — `latency.js` ablated | 25.5 layouts, 11.9 ms |
| — `alerts.js` ablated | 28.3 layouts, 12.1 ms |

`alerts.js` costs **no layout at all** and about 13 style recalculations a
second on a degraded wire — the ring's opacity transition, which is a
compositor property and is the cheap kind. It was left alone.

**The 20.4 layouts a second that remain at idle belong to neither module**: the
figure is unchanged by ablating both, and `03-LATENCY.md` §1.4 already names a
50 ms interval in `play-game.html`'s own script (`startTurnTimer`), which at
20 Hz is exactly the shape of what is left. That is the next thing worth
removing on this surface and it is not in a file this branch owns.

---

## 3. Cold load

Median of three loads with the cache cleared (`Network.clearBrowserCache` and a
fresh context each time), against the walkthrough server — which now mounts
`compression()` before its static handler, as `src/index.ts` does. Its absence
was not neutral: this page ships 462 KB of script and 308 KB of markup, and
measuring a cold load against an uncompressed mount measures a server nobody
runs.

| | before | after |
|---|---|---|
| first paint / first contentful paint | 92 ms | **80 ms** |
| DOM interactive | 190 ms | 256 ms |
| DOMContentLoaded | 194 ms | 259 ms |
| load | 200 ms | 266 ms |
| time to interactive | 92 ms | 80 ms |
| long tasks before TTI | none | none |

The DCL and load columns moved by more than the change can explain and by less
than this shared CPU's own drift: the whole script waterfall starts at 54 ms in
the second table and at 29 ms in the first. **Nothing about DCL is claimed
here.** First paint and the byte table below are the numbers that hold.

### 3.1 The bytes

| | on the wire | decoded |
|---|---|---|
| `play-game.html` | 90.4 KB | 307.6 KB |
| 15 scripts | 153.7 KB | 456.7 KB |
| `invulnerability-potion.png` | **912.1 KB** | 911.8 KB |

The largest scripts, decoded: `board-renderer.js` 183.2 KB, `lens-view.js`
57.4, `alerts.js` 44.1, `lens-panel.js` 40.2, `latency.js` 36.9, `tour.js`
20.3; the other nine total 63 KB. **There are no web fonts on this page** —
every face is a system stack — so there is no font blocking, no FOIT and no
`font-display` to argue about. There is exactly one image.

**And that one image is 912 KB, and it was fetched on every cold load of every
page that includes `board-renderer.js`, in parallel with all fifteen scripts.**
It is six times the entire script payload on the wire, for an icon most boards
never draw. `03-LATENCY.md` §1.4 recorded that its *decode* is lazy; its
*fetch* was not — `loadPotionImage()` was called unconditionally at module
load. After §4.4 it is requested at the page's idle callback after `load`
(345 ms on a potion-free game, where before it started at 90 ms alongside the
scripts) or immediately at the first board that actually carries potions
(219 ms in the `mixed` scenario). Either way it is off the critical path and
the operator is interactive at 80 ms with it still in flight.

Re-encoding the art itself would be the larger win and it is
`board-renderer.js`'s owner's call, as `03-LATENCY.md` says. This change is the
scheduling only.

### 3.2 Load order: `defer` cannot be applied, and here is why

All fifteen scripts are classic, ordered, and sit at the end of `<body>`, so
they do not block first paint (FCP lands at 80 ms; the last script finishes at
122 ms). They do block `DOMContentLoaded`, and `defer` is the obvious fix —
except that the page's **inline bootstrap follows them in the same document and
reads their globals on its first statement** (`window.ConnectionDebugger.attach(…)`).
`defer` is ignored on inline scripts, so deferring the fifteen externals would
run the bootstrap *before* them and break the page outright. The only way to
apply `defer` is to move the bootstrap into a file of its own, which is a
change to `play-game.html`'s structure and belongs to its owner. **No
script-tag attribute was changed.**

### 3.3 Dead exports in the lens bundle: yes, and it is not worth it

`scripts/build-lens-view.js` bundles `src/lens/view/index.ts` as an IIFE with
`globalName: 'LensView'`, so **every export is reachable through the global and
esbuild cannot tree-shake any of it**. Of 33 runtime exports, 16 are referenced
by `play-game.html`, `lens-panel.js` or `board-renderer.js`; 17 are not
(`makeLiveDecisionSource`, `makeReplayDecisionSource`, `renderTimeline`,
`stageSummary`, `depthCell`, `movesetListFor`, `cursorState`, …).

Rebuilding the same entry with only the 16 used names re-exported gives
**57,213 bytes against 58,597 — a saving of 1,384 bytes, 2.4 %**, because the
internals the seventeen use are almost entirely shared with the sixteen that
stay. Narrowing a module surface the boundary tests import, and rewriting the
checked-in bundle, to save 1.4 KB uncompressed (under half a kilobyte gzipped)
is not a trade worth making. Measured, named, and not done.

---

## 4. What was changed

Four changes to shipped code, three of them in one file, plus the harness.

### 4.1 `latency.js` — the tick follows what is actually moving

`draw()` is now split from the timer that calls it. `tick()` runs at the same
100 ms and repaints at 100 ms **only while something on the strip moves that
fast** — a turn deadline running (`wire.deadlineAt !== null`) or a command
still unanswered (`pending.length > 0`). With neither in play it repaints once
a second, which is the same sentence to a reader and a tenth of the work.
Event-driven draws — an arrival, a socket open or close, a command being sent
or answered — are never gated; only the timer is.

### 4.2 `latency.js` — the four numbers are written, not rebuilt

`numsHTML` built a four-span string and `el.nums.innerHTML = …` installed it.
Two of the four numbers are ages, so that ran ten times a second for the life
of the session. The four cells are now built once at mount from a `NUM_CELLS`
table — same labels, same order, same `— / +Nms / Nms` formatting, so the
rendered strip is character-identical — and `drawNums` writes each cell's value
text and `data-grade` in place through the existing `set` / `setAttr` guards.

### 4.3 `latency.js` — a hidden tab is not read, so it is not painted

`draw()` returns early when `document.visibilityState === 'hidden'`, and a
`visibilitychange` listener repaints in full on return. Nothing depends on the
painted strip: `LatencyView.read()` recomputes from state on every call,
`alerts.js` polls `read()` rather than the DOM, and the board's optimistic ink
reads `pending()`. The wire is still measured while hidden; only the painting
stops.

### 4.4 `board-renderer.js` — the 912 KB icon is no longer on the critical path

`loadPotionImage()` is no longer called at module load. It is called at the
first of two moments: the page's idle callback after `load` (a `setTimeout`
where `requestIdleCallback` is missing), or immediately the first time a board
that actually carries `invulnerabilityPotions` is rendered. The draw path is
untouched — it already drew the 🧪 fallback whenever `_potionImage` is null,
which is what it did for the first hundred milliseconds of every session before
this change too.

### 4.5 The harness — soak mode

`src/tests/lens-walkthrough-server.ts` gains `compression()` (as §3), and two
dev-only routes that are not on the walkthrough's own path:

* `POST /dev/steps` `{n}` — N turns back to back in one request.
* `POST /dev/wire` `{latency, jitter, loss, …}` — reshape the transport under a
  page that stays open. `GameWebSocketServer.shapeTransport` was already a
  runtime setter; without a route to it the ladder could only be set at startup,
  and a 200-turn session would see it change state never.

`/dev/step` is untouched, so `10-WALKTHROUGH.md`'s re-run plays the same turns
through the same code it always did.

---

## 5. Gates

`npx tsc --noEmit -p .` · `npx eslint "src/**/*.ts"` · `node --check` on all
five changed or added `.js` · `npm run build:lens` (the bundle is byte-identical
— nothing under `src/lens/` moved) · `npx jest --maxWorkers=2 "src/tests/lens-"
"src/lobster/__tests__/lens-" src/tests/local-game-determinism.test.ts` →
**345 passed, 22 suites** · `scripts/alerts-drill.js` → **46/46** ·
`scripts/lens-walkthrough.js` → 47 shots, 0 exceptions, 0 overflow.

**The walkthrough's pixel gate is bit-identical to the checked-in baseline**:
the live-versus-replay diff of the same frame reads `1688 differing pixels,
0.684 %, rows 494–505` both before and after, and T4's byte-identity
(`04-hover-moveset` byte-for-byte equal to `03d-conditional`) holds. Every
rail-only shot that was byte-stable before is byte-stable now
(`03b-rail`, `03d-conditional`, `04-hover-moveset`, `05-moveset-next`). Twenty-one
whole-page and controls shots differ in PNG size run to run — they contain the
latency strip's live millisecond counters and the turn clock — and **the rail,
stage and controls text captured beside each one is identical in all
twenty-one**, which is the check that says the difference is pixels of a moving
clock and not a change of content.
