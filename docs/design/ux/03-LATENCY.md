# 03 — LATENCY: what the client costs, and what the operator is told about the wire

UX, document 3. `01-RESEARCH.md` §4 says the interface conflates two clocks —
the deadline and the freshness of what is on screen — and that the periphery
reads brightness and motion rather than text or colour. This document is the
measurement and the build under those two claims: §1 times the shipped client
on a real decision, §2 is what was made cheaper and what the gates say about
it, §3 is the operator-facing latency surface and the injected-latency harness
it was designed under, and §4 is what an operator sees at each rung of the
ladder, in pictures taken under injected delay.

The dev environment has **no latency on either hop** — the walkthrough server
and the browser are the same machine and the game server is a list in memory —
so every number in §1 is a *client* number and every picture in §4 was taken
with delay injected on purpose. That split is the point: §1 says what the page
costs when the wire is free, and §3/§4 say what the page says when it is not.

Measured on `ux-latency`, against
`src/tests/lens-walkthrough-server.ts` (`mixed` at seed 1, 550 work units,
three teams, 11 × 11) with `scripts/lens-latency-profile.js`.

---

## 1. The client, timed

### 1.1 How

`scripts/lens-latency-profile.js` is the walkthrough's driver with a stopwatch
instead of a camera. It opens the same page at the same viewport
(1500 × 950), enters as an operator through the same login gate, focuses a unit
with the same roster gesture and clicks the same candidate the reserve answered
— so the rail it measures is the rail `10-WALKTHROUGH.md` §1.3b photographs,
five conditional rows and all — then plays **eight turns** through `/dev/step`.

Nothing it times is a copy of the shipped code. It **wraps the page's own
functions in place** (`lensRender`, `ingestLensFrames`, `renderGameBoard`,
`BoardRenderer.renderBoard`, `LensPanel.railHTML` / `laneHTML`,
`LensView.frameAtSeq` / `renderFrame` / `reviveEvents`) and the two
`innerHTML` setters that install the rail and the lane, on those two elements
only. `JSON.parse` is wrapped before any page script runs, so a frame's parse
cost is attributed to the frame's own type and byte count. Every geometry
getter (`offsetWidth`, `clientHeight`, `getBoundingClientRect`, …) is wrapped
too and its reads charged to whichever render span is open, because **a layout
read inside a render is a reflow the render did not have to pay for** and the
only way to know is to count them. A CDP sampling profile (100 µs) runs over
the same eight turns, because a wrapper can only see functions it knows the
name of: a 62 ms long task with 1 ms of instrumented work inside it is being
spent somewhere the wrappers do not reach, and the sampler says where.

Three runs; every number below is the median of the three. The CPU is shared,
so the spread run-to-run is roughly ±15 % on totals and larger on maxima.

### 1.2 What arrives, per turn

| | per turn | p50 | max | parse |
|---|---|---|---|---|
| `lens-frames` | **12.8 messages, 54.8 KB** | 2.4 KB | 13.9 KB | 0.09 ms/msg |
| `board-update` | 1 message, 3.7 KB | 3.7 KB | 3.7 KB | 0.06 ms/msg |

**JSON parse is not a cost and a worker would be a regression.** All 102
`lens-frames` of an eight-turn session parse in **9.5 ms total** — 1.2 ms per
turn, 0.09 ms for a median frame. A worker thread would have to beat that
*including* a structured clone of the parsed object in both directions; at
these sizes the clone alone is the larger number. This is the measurement that
says the third bullet of the optimisation list should not be built, and it is
here so the next person does not build it either.

### 1.3 The four spans

Wall-clock, from the frame landing to the thing the operator can see:

| span | p50 | p95 | max |
|---|---|---|---|
| `board-update` arrival → the board repainted | **13.5 ms** | 18.6 ms | 18.6 ms |
| `lens-frames` arrival → the rail installed | **0.6 ms** | 1.4 ms | 7.9 ms |
| hover on the board → the frame that answers it | **16.6 ms** | 19.7 ms | 19.7 ms |
| click a candidate cell (T3) → the frame that answers it | **16.6 ms** | 19.7 ms | 19.7 ms |

The board number is one animation frame plus a 1.2 ms draw: `board-update`
sets state and calls `scheduleRender`, which coalesces onto `requestAnimationFrame`.
That is the right shape and 13.5 ms is the frame it waits for, not work.

The rail number is the opposite shape and it is the finding: **0.6 ms, because
the rail is rebuilt synchronously inside the websocket message handler**. It is
not fast because it is cheap; it is fast because nothing schedules it. Twelve
of these land per turn, each one a full teardown of the panel the operator is
reading, at whatever moment the socket delivers — which is the one thing
`01-RESEARCH.md` P3 (*nothing re-orders under the cursor*) asks the surface not
to do, and which under a bursty wire becomes twelve teardowns in one task.

### 1.4 Where the time goes

Totals over eight turns (a span includes its children; the four top-level
entries are the ones that add up):

| span | calls | total | per turn | p50 | max | layout reads |
|---|---|---|---|---|---|---|
| `ingestLensFrames` (socket task) | 110 | **120.5 ms** | 15.1 ms | 0.8 | 11.6 | 0 |
| ↳ `lensRender` | 122 | 102.6 ms | 12.8 ms | 0.7 | 3.3 | 0 |
| ↳↳ `rail.innerHTML` | 122 | 32.4 ms | 4.1 ms | 0.2 | 1.5 | 0 |
| ↳↳ `lane.innerHTML` | 122 | 21.0 ms | 2.6 ms | 0.1 | 3.0 | 0 |
| ↳↳ `LensPanel.railHTML` | 122 | 5.9 ms | 0.7 ms | 0.0 | 0.6 | 0 |
| ↳↳ `LensPanel.laneHTML` | 122 | 7.3 ms | 0.9 ms | 0.0 | 0.9 | 0 |
| ↳↳ `LensView.renderFrame` | 122 | 9.4 ms | 1.2 ms | 0.0 | 2.5 | 0 |
| `LensView.frameAtSeq` (the fold) | **346** | 27.5 ms | 3.4 ms | 0.0 | 6.0 | 0 |
| `runScheduledRender` (rAF) | 71 | **101.1 ms** | 12.6 ms | 1.2 | 3.4 | **142** |
| ↳ `BoardRenderer.renderBoard` | 71 | 91.7 ms | 11.5 ms | 1.1 | 3.2 | 142 |
| `renderSnakeInfo` | 8 | 10.9 ms | 1.4 ms | 1.2 | 2.7 | 0 |

**≈ 28 ms of main thread per turn.** On the 500 ms budget
`01-RESEARCH.md` §0 measures for this game that is 5.6 %; on a 1,500 ms turn it
is 1.9 %. Nothing here is an emergency, and that is worth stating plainly
before the list of what is wrong with it — the client is not the reason an
operator would feel this interface as slow. What is wrong with it is *shape*,
and shape is what shows up the moment the wire stops being free.

**The five costs, named.**

1. **DOM churn — the panels are rebuilt whole, and most rebuilds change
   nothing.** Of 122 rail installs in eight turns, **75 (61 %) wrote markup
   character-identical to the markup already in the element**, at a median cost
   of 20.6 ms per session for zero pixels. The lane adds 11 more. This is the
   single clearest waste on the surface, and it is worse than its milliseconds:
   an `innerHTML` assignment destroys and rebuilds every node under it, so a
   redundant rebuild also drops any focus, any text selection and any scroll
   position inside the rail — under a reader who did not move.

2. **Re-render granularity — the panel redraws 15.3 times a turn for 12.8
   arrivals.** `lensRender` has fifteen call sites and every one of them redraws
   the whole rail and the whole lane. Three of those calls per turn are not
   answering new data at all.

3. **The fold runs 43 times a turn.** `frameAtSeq` re-folds the turn's entire
   event array from its `board.arrived` anchor on *every* call — `storeOf` is a
   `reduce` over every event, then a second full pass in `frameAt` — and the
   page calls it about 2.8 times per render. At 39 events held at the end of a
   turn that is ≈ 1,700 `applyEvent` steps per turn to answer twelve distinct
   questions. It is 3.4 ms/turn today and it is O(turn length × call count), so
   it is the number that grows worst with a longer turn.

4. **JSON parse: 1.2 ms/turn.** Named here so it can be crossed off. See §1.2.

5. **Layout: 142 forced reads per session, all in the board path, none in the
   rail.** That is two per `renderBoard` — the canvas's own size, read once to
   size the cells and once by the overlay — and they are before any write in
   the same frame. There is no layout thrash on this surface, and the rail
   never touches geometry at all. Recorded because "avoid layout reads in
   render" was on the list and the answer turned out to be *there are none to
   remove*.

**Image decode: not a per-frame cost, and one loaded asset is oversized.**
`invulnerability-potion.png` is **933 KB** and is decoded once, lazily, on the
first board that carries a potion; it never appears in a per-turn span. It is
not a latency cost and it is a page-weight cost, and it belongs to whoever owns
`board-renderer.js`.

**Long tasks: one per session, ~62 ms**, and the instrumented work inside it is
1 ms. The sampler puts the rest in `(program)` — style, layout, paint and GC
for the same frame — with `set innerHTML` (55.8 ms across the session) the
largest single self-time entry in our own code, ahead of the 50 ms
`startTurnTimer` interval (26.5 ms) and `ingestLensFrames` itself (17.2 ms).
The long task is a *rendering* task, not a scripting one; the way to shorten it
is to stop handing the compositor whole rebuilt panels, which is §2.
