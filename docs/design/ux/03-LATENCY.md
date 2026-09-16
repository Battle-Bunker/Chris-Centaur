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

---

## 2. What was made cheaper, and what was left alone

Three changes, each gated. The measurement is **alternating A/B**: a run of the
base and a run of this branch, on freshly started servers, one after the other,
three pairs — because this CPU is shared with seven other workers and drifts
over minutes, so a block of "before" followed by a block of "after" measures
the machine as much as it measures the change. Both sides play the same eight
turns and make the same 136 `lensRender` calls, 374 folds and 110 socket
batches, so the counts below are identical by construction and only the times
move.

| span (8 turns) | before | after | |
|---|---|---|---|
| `lensRender` | 132.4 ms | **81.1 ms** | −39 % |
| ↳ `rail.innerHTML` | 39.4 ms | **18.7 ms** | −53 % |
| ↳ `lane.innerHTML` | 31.2 ms | **20.7 ms** | −34 % |
| ↳ `LensView.renderFrame` | 23.8 ms (max 16.2) | **8.1 ms** (max 0.6) | −66 % |
| `LensView.frameAtSeq` (the fold) | 30.4 ms | **16.0 ms** | −47 % |
| `ingestLensFrames` (the socket task) | 136.2 ms | **106.2 ms** | −22 % |
| arrival → rail installed, p95 / max | 1.8 / 21.7 ms | **1.4 / 4.6 ms** | the tail |
| pin → the frame that answers it, p95 | 21.7 ms | **17.1 ms** | |
| `BoardRenderer.renderBoard` | 119.8 ms | 154.4 ms | *noise, see below* |

Per turn: the lens's own share of the main thread falls from **17.0 ms to
13.3 ms**, and the panel rebuild inside it from 8.8 ms to 4.9 ms.

**The board path did not change and is not claimed to have.** Its three runs
read 93 / 188 / 120 ms before and 154 / 90 / 157 ms after — overlapping ranges
that track the sampler's `(program)` total (2.9 / 4.2 / 3.4 GHz-seconds before,
4.5 / 2.7 / 4.2 after) almost exactly. That span is machine load and nothing
else, and the honest reading of it is that a canvas draw on a shared CPU has a
±50 % spread and no conclusion may be drawn from three samples of it. The four
lens spans are stated as wins because their three runs do not overlap at all:
`rail.innerHTML` reads 36.4 / 43.1 / 39.4 against 20.9 / 18.7 / 17.5, and the
fold 28.2 / 30.4 / 31.7 against 18.0 / 12.5 / 16.0.

### 2.1 The fold is kept, not re-run — `src/lens/view/index.ts`

`frameAtSeq` re-folded the turn's whole event array from its anchor on every
call: `storeOf` is a `reduce` over every event and `frameAt` is a second pass
over the same array, and the page asks 43 times a turn for the twelve batches
that arrive (§1.4). The fold is **pure**, so the only thing that can change its
answer is the array growing — and the page grows `lensEvents` by pushing and
re-sorting, which means the common case is "the same events plus a few more".

`foldOf` therefore keeps one fold per events-array in a `WeakMap`, validated on
the two facts that make a prefix a prefix — the length it was folded at, and
the object that was last in it — and **extends** it by folding only the new
events onto the store it already had. A different anchor, a different
settlement, or an array whose prefix moved all fall through to the untouched
full fold. The frames built from a kept fold are memoised on the cursor they
answer for (`live/<seq>/<head|scrub>`, `replay/<seq>`).

This is a cache and not a second fold: every entry in it was produced by
`applyEvent`, in order, from `emptyStore(anchor)`. `lens-determinism` and
`lens-replay-parity` are the gate and they compare what comes out of it against
the reducer with no memo in front of it.

### 2.2 An identical panel rebuild is a no-op — `src/web/latency.js`

**61 % of rail rebuilds installed markup that was already there** (§1.4).
`lensRender` assigns `innerHTML` unconditionally at all fifteen of its call
sites, and an `innerHTML` assignment destroys and rebuilds every node under it,
so a rebuild that changes no pixel still costs the teardown *and* drops focus,
text selection and scroll position inside a panel the operator is reading —
which is exactly what `01-RESEARCH.md` P3 asks the surface never to do.

`installPanelWriteGuard` makes an identical write a no-op, on `#lensRail` and
`#lensLane` only, by remembering the string last installed *through that
setter*. Every write to those elements goes through it, so the memory cannot go
stale, and any write with different content passes through untouched.

That it is a behavioural change as well as a cheaper one showed up in the
profiler itself, and the profiler was wrong first. Its interaction loop
captured the candidate cells once and then clicked them: on the base build the
first click rebuilds the rail, **detaching the remaining cells**, so clicks two
to eight land on orphaned nodes and never reach `#lensRail`'s delegated
handler; on this build the elided rebuild leaves them attached and all eight
clicks land. The loop re-queries now, so both sides do the same eight clicks —
but the difference it exposed is the point: preserving node identity is what
keeps a gesture working across a redraw.

**Its permanent home is `lensRender`, in `play-game.html`**, which belongs to
another surface owner (`ux-ia`). It is installed from `latency.js` so that the
measurement and the fix ship together rather than the measurement shipping
alone, and it should move when that file next opens.

### 2.3 What was measured and deliberately NOT built

* **A worker thread for parsing.** All 102 `lens-frames` of a session parse in
  9.5 ms — 0.09 ms for a median frame (§1.2). A worker would have to beat that
  including a structured clone in both directions, and at these sizes the clone
  alone is the larger number.
* **Removing layout reads from render.** There are 166 forced geometry reads in
  a session and every one is in the board path — two per `renderBoard`, the
  canvas's own size, taken before any write in the same frame. The rail reads
  no geometry at all. There is no layout thrash on this surface to remove, and
  the latency surface added in §3 keeps it that way: it is expressed entirely
  in percentages and text and never measures anything.
* **Coalescing `lensRender` onto an animation frame** (`01-RESEARCH.md` change
  #9). Worth doing and not done here: the fifteen call sites are in
  `play-game.html`, the redundant-rebuild half of the cost is already gone via
  §2.2, and a coalescer installed by wrapping another owner's global would be
  the kind of action-at-a-distance this repository is right to dislike.

### 2.4 The gates

`npx tsc --noEmit -p .`, `npx eslint "src/**/*.ts"`, `npm run build:lens` and
the jest lens suites (`src/tests/lens-*`, `src/lobster/__tests__/lens-*`,
`local-game-determinism`) are green: **21 suites, 317 tests**. `latency.js` is
not TypeScript and no jest suite loads it, so **`node --check src/web/latency.js`
is in the loop too** — a backtick inside its CSS template literal ended that
string early and killed the whole module, twice, and the only symptom on the
page was a readout that was not there.

**The walkthrough is the pixel gate, and it is run as a PAIR on today's code.**
The committed pictures in `docs/design/decision-lens/walkthrough` predate the
bot changes this branch merged, so they differ from anything this branch draws
for reasons that have nothing to do with this surface — comparing against them
would be comparing two different bots. So: two freshly started servers, same
seed, same 550 nodes, one walk each, one with `play-game.html`'s mount and
script tag removed and one as shipped. Thirty-three shots, differenced pixel by
pixel with `scripts/lens-png-diff.js`:

* **Zero differing pixels on every board shot and every rail/panel shot** —
  `03b`, `03c`, `03d`, `04`, `05`, `05b`, `06`, `06b`, `07`, `08`, `08b`, `09`,
  `10`, `12`, `13`, `13b`, `14`, `16`, `16b`, `17b`, `19b`, `19c`, `21a`,
  `21b`. These are the pictures `10-WALKTHROUGH.md` argues from; twenty-four of
  them, byte-identical, with the surface installed and reading a live socket.
* **Zero on all three REPLAY full-page shots** (`18`, `19`, `20`) — the whole
  1500 × 950 page, unchanged. A replayed game opens no socket, the mount stays
  empty, `#latency-mount:empty { display: none }` takes it out of flow entirely,
  and the page is the page it always was. That is the `:empty` rule being
  tested rather than asserted.
* **The six LIVE full-page shots differ** (`01`, `02`, `03`, `11`, `15`,
  `17`), by 14–23 % of their pixels, and every one of them differs **only from
  the strip's own row downwards** (the first differing row is 60–95 in a
  950-row image, which is where the strip is). That is the strip existing and
  the 30 px of board below it moving down by 30 px. It is the change, not a
  regression, and it is the reason the element shots above are the gate.

Earlier runs of this comparison, before the fixes in §3.6, are what caught the
three defects recorded there.

---

## 3. The operator surface — `src/web/latency.js`

One module, one mount, and nothing else on the page. `<div id="latency-mount">`
is a full-width strip under the board header; the script tag is after
`ws-client.js`. Those two lines are the whole of this branch's footprint in
`play-game.html`, which belongs to `ux-ia`.

### 3.1 What it reads, and why it does not open a socket

`ws-client.js` gained an observatory: every frame the page sends or receives is
announced to `WSClient.observe`. The surface subscribes to that. **It therefore
reports on the socket the operator is actually using** — a second connection
would have a second RTT, a second reconnect and a second opinion about the
clock, and would report on none of them.

Three things had to exist on the wire before any of this could be honest:

* **`serverSentAt`, on every outbound envelope**, stamped by
  `websocket-server.ts` as it lets go of the frame. Subtracting it from arrival
  gives **flight**, not skew; and `turnExpiryTime − serverSentAt` gives the turn
  budget with **both ends in the server's own clock**, so the number every
  threshold hangs off carries no clock correction at all.
* **`gameLagMs` on `board-update`**, from `noteTurnOrigin`: how old the turn
  already was when the centaur learned about it. It is `null` — never `0` —
  wherever nobody reported the game server's own clock, because "we do not know"
  and "no lag" are different readings and only one of them is a reassurance.
* **A clock estimate.** NTP-style over the transport's own ping/pong, at 1 Hz
  rather than the page's 5 s (5 s is too coarse to steer a 500 ms turn by), on
  the low-RTT half of a 12-sample window.

### 3.2 The signals, and every threshold

Every threshold is a **fraction of the current turn budget** and not a number of
milliseconds — `01-RESEARCH.md` §4's instruction, and the reason it is the right
one is visible in §4's pictures: the same ladder is photographed at budgets of
1,126 ms, 1,434 ms and 2,949 ms and the rungs land in the same places.

| signal | drawn as | threshold | at B = 500 ms | at B = 1,500 ms |
|---|---|---|---|---|
| **RTT** | `rtt Nms`, graded | warn at `0.1 · B`; DEGRADED at `max(150 ms, 0.3 · B)` | 50 / 150 ms | 150 / 450 ms |
| **frame age** (clock B) | `frame +Nms`, graded | THINKING at `0.5 · B`; DEGRADED at `1 · B`; STALE at `2 · B` | 250 / 500 / 1000 ms | 750 / 1500 / 3000 ms |
| **board age** | `board +Nms` | same ladder, reported not laddered | | |
| **game lag** | `game +Nms`, graded | DEGRADED at `1 · B` | 500 ms | 1500 ms |
| **deadline** | a bar that depletes | `warn` under 35 % left; `urgent` past the notch; `past` at zero | | |
| **last safe press** | a notch on the bar | `deadline − (RTT/2 + server work)` | | |
| **unacknowledged write** | `⟳ label Nms` | DEGRADED at `max(1200 ms, 3 · RTT)` | | |
| **dropped turn** | DEGRADED, named | any gap in `board-update`'s own turn numbers | | |

**The ladder**, in the order it is evaluated — the first rung that matches wins,
so the reading is always the worst true thing rather than the first:

1. `DISCONNECTED` — the socket is not open. Names the close code and that a
   reconnect is pending.
2. `STALE` — the deadline has passed and **nothing has arrived since it
   passed**, or the frame age is past twice the budget.
3. `DEGRADED` — RTT over threshold, **or** the game server over a budget
   behind, **or** a write unacknowledged past `3 · RTT`, **or** a frame age past
   a whole budget, **or** a turn that never arrived.
4. `THINKING` — half a budget with no decision frame, inside the deadline.
5. `LIVE` — none of the above. **Draws nothing beyond the bar.**

The `last safe press` is the one number here that is a decision input rather
than a diagnostic. A lock issued at `T` lands at `T + one-way-up + the centaur's
own work`; the surface estimates the first as `RTT/2` and **measures** the
second, as an EMA over the commands that answer for themselves (§3.4). Past the
notch the fill goes to its urgent tone and the banner gains the sentence a
countdown alone cannot say: *a lock issued now may not land this turn.*

### 3.3 How it draws — the periphery reads brightness and motion

`01-RESEARCH.md`'s §4 principle is a constraint, not a preference: peripheral
vision reads **motion** and **luminance**, and does not read colour, shape
detail or text. So everything urgent is encoded twice — a bar that **shortens**
and a fill that **brightens** as it goes (dim green → amber → red) — and the
words are for the reader who has already looked.

* **Nothing is red for a recoverable state.** DEGRADED and STALE are amber;
  DISCONNECTED, the one rung the operator can do nothing about, is the only red.
* **Nothing is modal.** A modal on a 500 ms clock is a lost turn.
* **Nothing flashes.** One 900 ms transient per state change, never a loop,
  never above 3 Hz, and nothing at all under `prefers-reduced-motion`.
* **The strip never relayouts the page.** Banner and chips live in an overlay
  that is out of flow and `pointer-events: none`, so a page that goes bad does
  not also jump — and the mount is `display: none` while empty, so a replayed
  game's page is byte-identical (§2.4).
* **No geometry is read.** The bar and the notch are percentages; the surface
  measures nothing, which is what keeps §1.4's "no layout thrash on this
  surface" true after adding one.

### 3.4 Optimistic commands, reconciliation, and a rollback you can see

Every outbound envelope the page sends is matched against the inbound frame
that answers it. Thirteen command types are named with what acknowledges each,
and the distinction between them is drawn:

* **A chip appears in the frame the gesture was made in**, `⟳ label Nms`, ageing
  live. That is the optimism, and it costs nothing to be wrong about.
* **`✓ ack`** — the command had an answer of its own (`lens-lock`,
  `snake-selected`, `toggle-hold-result`, …) and it came. The age it took is
  also the sample that trains the server-work estimate the last-safe-press notch
  is drawn from, which is why the two live on the same surface.
* **`✓ applied`** — the command had no answer of its own and was acknowledged
  only by the next broadcast that would carry its effect. Weaker evidence,
  drawn weaker.
* **`✗ refused — <reason>`** — the server disagreed with the picture the press
  was made against. **The chip does not quietly vanish**; it becomes the
  refusal, carries the reason, and stays 9 s (an accepted one stays 2.5 s).
  Silent rollback is the failure `01-RESEARCH.md` §4 says is the only
  unacceptable one, and a gesture that was on screen and is now not is a silent
  rollback unless something says so.

Photographing this found a real one nobody had reported: **the page fires a
`lens-conditional` on every unit focus, and the harness refuses it between
turns.** Nine of the thirteen pictures below carry `✗ ask red-A — no decision is
inspectable on this game right now` without anyone having asked for it. It has
presumably always done that; it was simply invisible.

### 3.5 The injected wire — `lens-walkthrough-server.ts`

In this process both hops are free: the browser and the server are the same
machine and the game server is a list in memory. **A latency surface designed
against a free wire is a surface nobody has ever read**, so the harness can make
the wire cost something:

| flag (or `LENS_*` env) | what it does |
|---|---|
| `--latency=N` | N ms each way, client ↔ centaur |
| `--latency-down=N` / `--latency-up=N` | split them: a slow DOWN hop makes the board old, a slow UP hop makes the press late |
| `--jitter=N` | uniform ± on each direction, **order preserved** |
| `--loss=F` | drop that fraction of superseded broadcasts |
| `--loss-any` | …and of every other type, `lens-frames` included |
| `--latency-game=N` | the centaur learns of the turn N ms late, and says so as `gameLagMs` |
| `--turn-timeout=N` | give the harness a real turn deadline to count down |

`shapeTransport` lives on the websocket server, is order-preserving, and
**production cannot reach it** — only the walkthrough server calls it. Every
flag defaults to zero and **at zero nothing is installed at all**, which is what
keeps §2.4's re-run a comparison against the same transport rather than against
a shaped one.

### 3.6 Three defects the camera found

None of these were reachable before there was a picture, which is the argument
for taking the pictures.

1. **The mount was a 210 px box at the end of the header's flex row.** Four
   numbers and a state word do not fit in 210 px: the first photograph shows the
   readout running past the card's edge and stopping mid-word at `board +50`.
   It is now a full-width strip under the header — which the deadline bar wanted
   anyway, since a 210 px bar puts the whole last-safe-press question inside a
   centimetre.
2. **The budget was an EMA and an average lags.** On the first frames of a turn
   `remaining` exceeded the smoothed `budget`, so the bar's fill clamped to
   100 % **and the last-safe-press notch clamped with it** — pinned off the
   right edge, which is exactly where it says nothing. The sample is one number
   per turn and wants no averaging; taken whole it also makes `remaining ≤
   budget` true by construction, because `serverSentAt` is stamped no later than
   the deadline it defines.
3. **STALE was the weaker reading.** It required an OLD emission past the
   deadline; §4 says *no emission past the deadline*. The camera caught a page
   reading `THINKING` 189 ms after its deadline had passed with a 552 ms-old
   frame — which is silent degradation, the one failure §4 rules out. STALE is
   now "the clock ran out and nothing has arrived since", which also correctly
   leaves a kernel that is still emitting past its own deadline on the DEGRADED
   rung rather than the stale one (see `12-loss` in §4).

---

## 4. What an operator sees, at each rung, under injected latency

`node scripts/lens-latency-shots.js --out=docs/design/ux/latency` — four scenes,
a server each, thirteen shots. It **waits for the rung and never for a clock**:
this CPU is shared, so a `sleep(600)` that catches THINKING on an idle machine
catches DEGRADED on a busy one. Every shot is gated on the state the widget has
actually **drawn**, the strip is cropped out of the same capture as the page so a
close-up cannot disagree with the page it is a close-up of, and
`docs/design/ux/latency/report.json` carries the whole of `LatencyView.read()`
at the instant of every picture — because a screenshot of a readout is not
evidence that the readout is right.

The turn clock is set longer than a real game on purpose (1.2–3.0 s): taking a
screenshot costs a few hundred milliseconds, and on a 500 ms turn the rung has
moved on before the bytes are taken. Every threshold is a fraction of the
budget, so a longer budget photographs the same ladder at the same proportions —
which is the argument for fractions, tested.

### 4.1 The shipped wire — `--turn-timeout=3000`, nothing injected

| | picture | what the surface said |
|---|---|---|
| **LIVE** | [`01-live.png`](latency/01-live.png) · [page](latency/01-live-page.png) | `rtt 5ms · frame +106ms · board +107ms · game +31ms`. B = 2,919 ms, 2,812 ms left, press slack **3 ms**, notch at **97.3 %** — hard against the right shoulder, which is what a free wire looks like. No banner. Silence is the signal. |
| **THINKING** | [`02-thinking.png`](latency/02-thinking.png) | `frame +1542ms` against a 1,475 ms threshold, 797 ms still on the clock. The dot dims and **nothing else changes** — the bot is allowed to think, and a banner every turn is a banner nobody reads. |
| **acknowledged** | [`03-acknowledged.png`](latency/03-acknowledged.png) | `✓ select red-B 11ms` beside `✗ ask red-B — no decision is inspectable…`. Both halves of §3.4 in one picture: an answer, and a refusal that says why. |
| **STALE** | [`04-stale.png`](latency/04-stale.png) · [page](latency/04-stale-page.png) | 71 ms past the deadline with `frame +2756ms`: *no decision frame for 2756 ms, past this turn's deadline*. The fill goes flat grey, the notch is gone. Determinations are still offered — and labelled. |
| **DISCONNECTED** | [`05-disconnected.png`](latency/05-disconnected.png) · [page](latency/05-disconnected-page.png) | *socket closed (4001) — reconnecting.* The one red rung, and it still names the code rather than going quietly grey. |

### 4.2 A slow wire — `--latency=500 --jitter=60`, `--turn-timeout=3000`

| | picture | what the surface said |
|---|---|---|
| **DEGRADED** | [`06-degraded-rtt.png`](latency/06-degraded-rtt.png) · [page](latency/06-degraded-rtt-page.png) | `rtt 1214ms` in amber against an 884 ms threshold: *1214 ms round trip — a press needs 627 ms to land.* The notch has walked from 97 % to **1.6 %**: on this wire almost the whole turn is flight. |
| **optimistic** | [`07-optimistic-pending.png`](latency/07-optimistic-pending.png) | `⟳ select red-A 8ms` — the gesture is on screen in the frame it was made in, ageing, with nothing having answered it. |
| **reconciled** | [`08-reconciled.png`](latency/08-reconciled.png) | the same chips at `✓ select red-A 1310ms`. That 1,310 ms is not decoration: it is the sample the press-slack estimate is built from. |
| **past the last safe press** | [`09-last-safe-press.png`](latency/09-last-safe-press.png) · [page](latency/09-last-safe-press-page.png) | 529 ms left, 576 ms of slack needed. The fill turns red and the banner gains *· a lock issued now may not land this turn.* **This is the picture the whole surface exists for**: the countdown alone still reads "half a second left", and half a second is not enough. |
| **rolled back** | [`10-rollback.png`](latency/10-rollback.png) · [page](latency/10-rollback-page.png) | a second operator held the unit: `✗ select red-C 1005ms — another operator holds it`. The optimistic chip became the refusal instead of vanishing. |

### 4.3 The other hop — `--latency-game=1500`, `--turn-timeout=1200`

[`11-game-lag.png`](latency/11-game-lag.png) · [page](latency/11-game-lag-page.png)

`rtt 24ms · frame +8ms · board +77ms · **game +1524ms**`. The client's own wire
is perfect and the turn was already a second and a half old when it arrived. The
deadline bar is green, the notch is at 97 %, and the only amber thing on the
strip is the number that is actually wrong — *the game server is 1524 ms
behind*. An operator on this page can tell that pressing faster will not help,
which is the entire reason the two hops are two numbers.

### 4.4 Loss — `--latency=180 --jitter=60 --loss=0.5 --loss-any`, `--turn-timeout=1500`

| | picture | what the surface said |
|---|---|---|
| **DEGRADED under loss** | [`12-loss.png`](latency/12-loss.png) · [page](latency/12-loss-page.png) | `rtt 486ms` (threshold 430 ms), `frame +230ms`, `board +2673ms`, and 1,239 ms **past** a deadline that decision frames are still arriving after. The `board-update` carrying the next deadline was one of the dropped ones — so the page is counting down a dead clock while the kernel talks. The new STALE rule reads this correctly as DEGRADED and not stale: something *is* arriving. |
| **STALE under loss** | [`13-loss-stale.png`](latency/13-loss-stale.png) | `frame +2938ms`, `board +5568ms`. The same rung as `04`, reached by a wire that is up, fast, and losing frames rather than by a turn that ended. **A dropped frame is indistinguishable from a frame that was never sent**, which is the honest reading and the reason the ladder is built on age rather than on socket liveness. |

### 4.5 What is not built, and who owns it

* **The board's own optimistic ink.** `LatencyView.read()` and
  `LatencyView.pending()` are exported for exactly this — the board renderer can
  draw a ghost arrow for a write still in flight, and clear it on the same
  reconciliation the chip uses, from the same numbers rather than a second
  estimate. The board belongs to another owner and is not touched here.
* **The turn clock on the board's edge.** It still counts to the deadline and
  not to the last safe press. `read().lastSafePressAt` is there when `ux-ia`
  next opens that file; putting a second countdown on the page from this module
  would be two clocks disagreeing.
* **`installPanelWriteGuard`'s permanent home** is `lensRender` (§2.2).
* **ROUND 2 IS `13-LATENCY-2.md`**, and three of the readings above have moved
  since. `pressSlackMs` is no longer `rtt/2 + work` but a quantile of the press
  costs the page has observed (13 §3b); the STALE rung no longer fires between
  turns when the turn was answered and the wire is still carrying (13 §3c, and
  it was firing on every turn of every wire including the LAN); and the RTT the
  rungs steer by is now `max(the EMA, an outstanding ping's age)`, because an
  average of the pongs that came back cannot follow a queue that is filling
  (13 §4.1). The thresholds in §3.2 are unchanged; what changed is what is
  compared against them.
* **`prefers-contrast` and a colour-blind check.** The ladder is encoded in
  brightness and motion first and colour second, on purpose, but it has not been
  measured against a simulated deficiency.
