# 11 — MOTION AND MARKS: a vocabulary for what moves, and who did it

UX lens, document 11. `05-EVALUATION.md` handed two proposals back rather than
guessing at them, and both were handed back for the same reason: they are
**shared decisions written down once**, not local edits.

* **P-7 — the arrival pulse.** `.lens-arrival-pulse` has a reduced-motion guard
  and no users; `board-renderer.js` has no animation loop. The evaluation
  refused to invent a duration, and it was right to: `01-RESEARCH.md` P3 says
  **nothing above L2 may move**, so a pulse built to a guess puts new motion on
  the one surface that principle exists to protect. §1–§4 below are the spec it
  asked for — the vocabulary, the durations, the rule about what may move, the
  flash budget, and what `prefers-reduced-motion` means for each verb.
* **P-4 — the per-operator mark.** `§2.5` of `02-IA-AND-CONTROLS.md` already
  defers "which operator staged an arrow is hue only" to the multi-operator
  work, and A-1 found three of the six remaining contrast failures in the
  operator badges. The palette half of P-4 (an Okabe–Ito ordering in
  `src/shared/player-palette.ts`) is **board-owned and is not taken here** —
  changing those twelve hexes repaints the board, the badges, the arrows and
  every historical screenshot. §5–§7 take the other half: a per-operator
  **mark**, a shape, drawn from the same index the palette is, so hue and shape
  are two readings of one fact and either alone is enough.

Everything below is normative. `src/web/tokens.css` groups D, E and F are the
machine-readable copy of §2 and §4; §8 says what is asserted, and where.

---

## 1. The one rule motion is answerable to

`01-RESEARCH.md` P1 states the constraint twice, from two directions:

> Peripheral vision reads **motion**, transients and **brightness**; it does
> not read colour, shape detail or text.

and

> A swap the eye does not see is a swap that did not happen — change blindness
> is defeated by **motion at the change**, not by the change being large.

So motion is not decoration on this surface. It is the only channel that
reaches an operator who is not looking, and the only channel that can defeat a
change the operator's eye skipped. That is *why* there is motion at all, and it
is also why there is so little of it: a channel that is spent on decoration
cannot be spent on a change.

Against that sits `03-LATENCY.md` §3.3's rule — *nothing flashes* — and WCAG
2.3.1, which bounds the whole page at three flashes in any one second. §4 is
the arithmetic that keeps both.

### 1.1 The rail's rule, as a property list

P3 — *nothing re-orders under the cursor* — is enforced here as a **whitelist
of animatable properties**, because "do not move things" is not checkable and a
property list is.

**On any element that is in flow** — every row, chip, tick, banner, cell and
word in the rail, the strip, the clock and the header — motion may touch **only
these properties**:

`opacity` · `color` · `background-color` · `border-color` · `outline-color` ·
`box-shadow` (colour and blur, never offset)

and **never** these:

`transform` · `width` · `height` · `top` · `left` · `right` · `bottom` ·
`margin` · `padding` · `font-size` · `letter-spacing` · `border-width` ·
`display` · `order` · `flex-*` · `grid-*`

The test is not aesthetic. Every property in the second list either **reflows
the page** (so the thing the operator was about to click has moved) or
**changes an element's box while the eye is inside it** (so the row being read
is a different size than it was at the start of the fixation). Both are the
same failure as H-1's re-ordering stage line, arriving by a different route.

**One exception, and it is the exception that lets the arrival pulse exist.**
A layer that is (a) `position: fixed` or `absolute`, out of normal flow, (b)
`pointer-events: none`, and (c) carries **no text** may animate `transform`,
because it displaces nothing, intercepts nothing, and there is no word inside
it for a scale to blur. The alert ring (`06-ALERTS.md` §3.1) already satisfies
all three; §3's arrival pulse is built to the same three conditions and to no
others.

### 1.2 What never moves, whatever the layer

* **Nothing on the canvas.** `board-renderer.js` gets no animation loop. The
  board's pixels are a pure function of turn state; making them a function of
  *time* means two screenshots of one state differ, which costs every pixel
  gate on this surface (`05 §2`, `09 §5.3`) and buys nothing the overlay above
  the canvas cannot buy. **The arrival pulse is a DOM layer over the board, not
  a canvas animation.** This is the sentence P-7 was waiting for.
* **Nothing loops.** There is exactly one repeating animation left on the
  surface (`--dur-badge-pulse`, the connection badge, 2 s) and it is not part
  of this vocabulary; nothing added here repeats. `02-INSPECTION-UI.md` §5 said
  it first: *one pulse, never a loop — the point is to move the eye once, not
  to nag*.
* **Nothing modal moves.** A modal on a 500 ms clock is a lost turn
  (`03 §3.3`); a modal that also animates is a lost turn with a delay on it.

---

## 2. The vocabulary — five verbs

Every animated declaration on the operator surface names one of five verbs, and
every verb is one duration token and one easing token. A declaration that wants
a sixth verb is a design question, not a CSS question, and it comes back here.

| verb | duration token | value | easing token | value | what it is for |
|---|---|---|---|---|---|
| **enter** | `--motion-enter` | `140ms` | `--ease-enter` | `linear` | a transient that was not there is there |
| **exit** | `--motion-exit` | `620ms` | `--ease-exit` | `ease-out` | a transient decays back to nothing |
| **emphasis** | `--motion-emphasis` | `600ms` | `--ease-emphasis` | `cubic-bezier(.33,0,.2,1)` | one shot at the eye, at a change it would otherwise miss |
| **state change** (peripheral) | `--motion-state` | `900ms` | `--ease-state` | `ease-out` | a readout that is read *without* a saccade now says something else |
| **state change** (foveal) | `--motion-state-near` | `150ms` | `--ease-state` | `ease-out` | a control **under the hand** now says something else |
| **progress** | `--motion-progress` | `250ms` | `--ease-progress` | `linear` | a quantity moving because the *data* moved |

Plus one duration that is not a verb: `--motion-emphasis-fade` (`620ms`), which
is what emphasis becomes under `prefers-reduced-motion` (§4).

### 2.1 Where the numbers come from

**None of them are new.** Every value is one already on the surface, measured
and shipped; the vocabulary names them rather than inventing a sixth set.

| token | where the number was already | citation |
|---|---|---|
| `--motion-enter` `140ms` | the alert ring's onset (`--dur-al-ring-on`) | `06-ALERTS.md` §3.1 |
| `--motion-exit` `620ms` | the alert ring's decay (`--dur-al-ring-off`) | `06-ALERTS.md` §3.1 |
| `--motion-emphasis` `600ms` | the arrival pulse, specified and never built | `decision-lens/02-INSPECTION-UI.md` §5; `01-RESEARCH.md` P3 |
| `--motion-state` `900ms` | the ladder's one transient per rung change (`--dur-lat-arrive`) | `03-LATENCY.md` §3.3 |
| `--motion-state-near` `150ms` | the rail's own hover (`--dur-hover`) | `09-DESIGN-TOKENS.md` §2 |
| `--motion-progress` `250ms` | the clock's fill (`--dur-slow`) | `09-DESIGN-TOKENS.md` §2 |

The four old names (`--dur-al-ring-on`, `--dur-al-ring-off`,
`--dur-lat-arrive`, `--dur-slow`, `--dur-hover`) are kept in `tokens.css` as
**aliases pointing at the vocabulary**, so a sheet that has not been rewritten
yet still gets the right number, and group E turns both off in one place.

### 2.2 Why enter and exit are not the same number

140 ms in, 620 ms out — a 4.4 : 1 asymmetry, and it is the whole reason the ring
reads as a transient rather than as a blink. An onset is what the periphery
detects; a *decay* is what gives a returning eye something to land on. Reversing
them (slow in, fast out) produces a cue that has finished by the time the
operator's gaze arrives, which is the failure mode `06 §4`'s 900 ms **hold**
exists to prevent from the other side. Anything on this surface that appears and
goes away uses this pair in this order.

### 2.3 Why state change has two registers and not one

`--motion-state` is 900 ms because the ladder strip is read **without a
saccade** — a low-amplitude change over most of a second is exactly the kind of
transient peripheral vision integrates, and a 150 ms one is a flick the
periphery misses. `--motion-state-near` is 150 ms because a chip is read at
arm's length with the eye already on it, and 900 ms on a chip's border is a
control that visibly lags the key that changed it — on a 500 ms clock, a control
that finishes after the turn is a control that lied about when it changed.

One verb, two registers, chosen by **reading distance**, not by importance.

### 2.4 Progress is not a transient

The clock's fill is the only continuous motion on the surface, and it is
categorically different from the other four: it is not a cue *about* a change,
it **is** the datum. `03-LATENCY.md` §3.3: *a bar that shortens and a fill that
brightens*. `--motion-progress` exists so the fill does not step visibly between
the four repaints a second the strip does anyway; it is a smoothing constant,
not a transition.

---

## 3. The arrival pulse — P-7, specified

### 3.1 What pulses

**The arrived unit's own cells**, and nothing else.

The three candidates the evaluation listed were *the arrived unit*, *the changed
unit* and *the board edge*. The board edge is taken: `06-ALERTS.md` §3.1 draws
the alert ring there, and two channels on one edge is the collision `02 §2.5`'s
whole audit exists to prevent — an operator who has learned that a ring at the
board's edge means an alert must not have to decide, in the periphery, whether
this one means an alert or a widen. "The changed unit" is a superset that
includes units the operator is already looking at, and pulsing a cell under the
cursor is precisely what P3 forbids. So: the units that **arrived** — the
members a widen added to the cluster the operator is reading.

### 3.2 On which event

On the widen being **accepted** — `lensAcceptWiden()` — with `notice.gained` as
the unit set, and never while the widen is *held* behind its banner.

This follows from the reactive policy itself (`02-INSPECTION-UI.md`, *additive
uncertainty is staged; subtractive certainty is applied*). While the widen is
held, the banner **is** the cue and the rail below it is struck through: the
operator has been told, in words, that something is waiting. The pulse says a
different thing — *it has landed, and the board under your eye is now a
different board*. Firing it at hold time would mean pulsing cells whose change
has not been applied yet, which is a lie about the board.

A **narrow** does not pulse. Subtractive certainty applies at once with a
one-line footer note, and it removes a variable — there is nothing new on the
board for an eye to find.

### 3.3 How it is drawn

A DOM layer, `#lensPulseLayer`, pinned to the canvas's **content box** with
exactly the arithmetic `createBoardOverlay` already uses (`offsetLeft +
clientLeft`, `canvasCssSize`, `boardCellSize`) — so the pulse sits on the drawn
cells at every size the resize grip can produce, and reads no geometry the board
does not already read.

It is its **own** layer and not `#boardOverlay`, for one reason: `#boardOverlay`
is `innerHTML = ""` on every render, and a render lands mid-pulse on most turns.

Per gained unit, one `.lens-arrival-pulse` div over that unit's head cell:

```
@keyframes motion-arrival {
  from { opacity: 0;   transform: scale(0.72); }
  35%  { opacity: 0.95; }
  to   { opacity: 0;   transform: scale(1.9); }
}
.lens-arrival-pulse {
  position: absolute; pointer-events: none;
  border: 2px solid var(--lens-ink); border-radius: var(--radius-round);
  animation: motion-arrival var(--motion-emphasis) var(--ease-emphasis) 1 both;
}
```

Violet (`--lens-ink`), because `02-INSPECTION-UI.md` §5 says violet ring and
violet is already the lens's ink on the board — the pulse is the lens speaking,
not the alert channel, and it must not be mistaken for one. A **ring**, not a
fill: `06 §3.1`'s reasoning transfers exactly — the general-flash threshold is
about area and luminance, and a 2 px expanding outline changes neither by much.

The layer satisfies §1.1's three conditions — out of flow, `pointer-events:
none`, no text — which is what licenses the `transform`. It is removed from the
DOM when the animation ends, so the rest state has no extra element in it at
all: **the resting page is byte-identical to the page before this document**.

### 3.4 What it costs when it is wrong

Nothing. It intercepts no input, it reflows nothing, it draws for 600 ms and
deletes itself, and if `notice.gained` is empty or the units are not on the
board the layer is never created.

---

## 4. `prefers-reduced-motion` — which verbs go, and which stays

`tokens.css` group E is the one place the preference is stated, and it stays the
one place. The semantics are **not** "everything to zero":

| verb | under the preference | why |
|---|---|---|
| **enter** | **instant** — 0 s | the appearance is the information; the ramp is not |
| **exit** | **instant** — 0 s | `06 §2`'s own rule: *a fade is motion*, and the ring's hold (extended to 1.5 s) is what carries it instead |
| **state change** (both registers) | **instant** — 0 s | the new reading is the information; the crossfade is not |
| **progress** | **instant** — 0 s | the bar is repainted four times a second regardless, so it steps rather than eases and loses nothing |
| **emphasis** | **kept, as a single fade** — `--motion-emphasis-fade` `620ms`, keyframe swapped to `motion-arrival-reduced` (opacity only: no scale, no ring expansion, one iteration) | see below |

**Why emphasis survives and the other four do not.** The other four are cues
*about* a state the operator can also read in words, right there, at rest: the
ring's alert is in the live region, the rung is in the strip, the chip says its
own state. Removing their motion removes a redundancy. The arrival pulse is not
redundant — it is the **only** thing that says *the board under your eye changed
while you were reading the rail*, and an operator who asked for less motion has
not asked to be told less. Deleting it removes information from exactly the
operator most likely to miss the change.

`prefers-reduced-motion` is about **movement** — translation, scale, parallax,
things that trigger vestibular symptoms — and a single non-repeating opacity
ramp on a static outline is none of those. So the pulse keeps its 620 ms, loses
its `transform` entirely, and is guaranteed by `animation-iteration-count: 1` to
happen once.

This replaces the guard that `05 §A-4` and `09 §1.5` both recorded as guarding
nothing: `.lens-arrival-pulse { animation: none !important }` is gone, and the
rule in its place turns a real animation into a real, reduced one.

`chrome.css`'s universal catch-all (`animation-duration: var(--dur-instant)
!important`) is untouched and still correct: it covers the lobby pages, which do
not link this vocabulary, and it is the right shape for anything not yet
tokenised. It does not reach `play-game.html`, which links `tokens.css` alone.

---

## 4a. The flash budget, shared with alerts

`06-ALERTS.md` §4 fixes the alert ring at a **700 ms onset floor** — a hard
ceiling of 1000/700 ≈ **1.43 onsets a second**, against WCAG 2.3.1's limit of
three. This document adopts the same floor for the emphasis verb, on its own
clock, and the two clocks add:

| channel | floor | ceiling | measured |
|---|---|---|---|
| the alert ring (`06 §3.1`) | 700 ms | 1.43 / s | 12 raisings in 2,895 ms → **4 onsets** (`alerts/report.json`) |
| the arrival pulse (§3) | 700 ms | 1.43 / s | one per accepted widen; the reactive policy's auto-accept timer is deadline-scaled and cannot deliver two inside 700 ms |
| **both together, worst case** | | **2.86 / s** | under 3, with no coordination between them required |

The budget is deliberately **not** a shared counter. A shared counter would mean
an alert suppressing a widen's pulse, which trades a WCAG margin the arithmetic
already has for a channel losing a message it is the only carrier of. Two
independent floors that sum to 2.86 is the cheaper correct answer.

Independently of the rate: both are **thin outlines at moderate luminance** —
2–5 px borders, never a saturated red, never a full-screen wash — so both are
under the general-flash and red-flash **area and luminance** thresholds on their
own, before the rate argument is made at all. `01-RESEARCH.md` change 10's
"verify nothing flashes > 3 Hz" holds by two arguments, not one.

---

## 5. The marks — P-4's other half

### 5.1 What is board-owned and stays board-owned

`src/shared/player-palette.ts` is **not touched by this document**. Twelve
hexes, ordered by a farthest-point walk, contrast-designed against the board's
own reserved colours and neutrals, read by the server (which assigns from it),
the canvas, the badges, the arrows and the history replay. Re-ordering it to
Okabe–Ito is the shared decision `05` handed back, it repaints every historical
screenshot, and it belongs to whoever owns the board. **The palette stays where
it is.**

What this document adds is the channel that does not need anyone's permission
to be added, because it takes nothing away: a **shape**.

### 5.2 The mark alphabet

Twelve marks, index-aligned with `PLAYER_PALETTE`, so **the mark and the hue are
two readings of one number** — the operator's arrival index. An operator's mark
is derivable from their colour and vice versa; neither is authoritative over the
other, and either alone identifies them.

| i | mark | hue (palette) | i | mark | hue (palette) |
|---|---|---|---|---|---|
| 0 | `■` | azure blue | 6 | `▼` | rust brown |
| 1 | `★` | coral rose | 7 | `◈` | turquoise |
| 2 | `▽` | emerald green | 8 | `▣` | periwinkle |
| 3 | `◆` | violet | 9 | `◐` | deep petrol |
| 4 | `□` | cyan teal | 10 | `◧` | crimson wine |
| 5 | `☆` | magenta | 11 | `◒` | deep teal-green |

**The order is chosen the way the palette's is** — prefix dispersion. A game has
two or three operators far more often than ten, so the first four marks are the
four most different silhouettes available: a filled square, a filled star, a
hollow down-triangle and a filled diamond. Fill, edge count and axis all differ
between each adjacent pair; none of the first four is another's outline or
another's rotation.

**Every mark is unspent.** `02 §2.5`'s audit lists what the rail's glyph
vocabulary already means, and the alphabet was chosen against that list:
`▸` cursor · `◇` foil · `⚠` refused · `◦` unplanned · `🔒` fixed · `⦿` lock ·
`↺` undo · `⛨` hold · `◎` goto · `◉` near · `✕` clear · `⚑` banner ·
`●` `▲` `○` lane ticks. No mark in the table is any of those, and none is one of
them rotated or hollowed (`◇` foil versus `◆` mark is the one near pair, and
they never appear in the same place: the foil is a card heading in the rail, the
mark is an attribution).

`◐` `◧` `◒` sit at indices 9–11 deliberately: they are half-fills, which are the
weakest silhouettes in the set and are only reached by a game with ten
operators. Past index 11 the marks wrap, exactly and at exactly the same point
as the palette does — so two operators who share a hue share a mark, and the
number of distinguishable operators is not silently different from twelve.

### 5.3 Where the mark is drawn

Four places, chosen because they are the four places a *determination* is
attributed. The mark answers one question — **who did that** — and it is drawn
wherever that question is currently answered by a hue, or not answered at all.

| surface | today | with the mark |
|---|---|---|
| **the board** — the fixed chip on a pinned unit's head plate (`renderLensHandle`, `drawLensChip`) | `•` in `--lens-fixed` grey, identical for every operator | the operator's mark in the same chip, same size, same ink. Two operators' pins are now two different glyphs on two heads |
| **the rail** — the fixed strip under the moveset table (`🔒 red-B → 119 pinned (Ada)`) | the name, in the rail's own ink | `🔒 red-B → 119 pinned (★ Ada)` — the mark immediately before the name, so a glance matches the board without reading |
| **the timeline lane** — the operator lane's solid ticks | `●`, coloured by `actor.color`; the name only on hover | the operator's mark, still coloured. Hue and shape agree, and "whose lane row is this" is answerable at rest |
| **the roster** — the connected-operator badges (`#connectedUsers`) | a 12 px hue dot, and nothing else. **A-1's three contrast failures are exactly these** | the dot keeps its hue; the mark sits beside it in the roster's own ink, so identity survives at 1.55 : 1 and survives a colour-vision filter |

**Where it is deliberately not drawn.** Not on the staged **arrow** — see §6,
the wire cannot say whose it is. Not on the unit **name tag**: the tag's
ownership outline is already an operator channel, the tag is a dense
five-statistic plate at `max(12px, cellSize·0.38)`, and a thirteenth glyph on it
buys nothing the head-plate chip two pixels away does not already buy. Not on
the **hold shield**: `02 §2.5`'s rule — *a held unit keeps its amber shield and
gets no padlock; two glyphs for one fact is the collision this vocabulary exists
to prevent*.

### 5.4 How it reads at each size

* **On the board**, the chip is a disc of radius `max(5, cellSize·0.17)` with
  the glyph at `max(7, round(r·1.2))px` bold — 7–9 px at the sizes `05 §4`
  photographs. That is small, and it is why the alphabet is silhouettes rather
  than glyphs with interior detail: at 7 px `■` and `★` and `▽` and `◆` are four
  different blobs, which is all this channel is asked to be. The chip is
  *already* a disc at that size carrying `•`, so nothing about its geometry is a
  new claim.
* **In the rail and the lane**, the mark is at the rail's own
  `calc(var(--lens-size) - 1px)`, which `05 §4` measures at 10–13 px across the
  three densities. Comfortable.
* **In the roster**, the mark is beside a 12 px dot at the roster's own size.
* **Colour is never required to read it.** In every one of the four places the
  mark is a shape in an ink chosen for the ground, and the hue — where there is
  one — is the second reading. That is the same rule `02 §2.5` applies to every
  other mark on the rail, arriving at the one channel that had escaped it.

---

## 6. What the wire carries about who pinned, and what it lacks

Read from `src/server/websocket-server.ts`, `src/server/active-game-manager.ts`
and `src/lens/types.ts`.

### 6.1 What is already there

* **`TurnEvent.actor`** — `src/lens/types.ts`: `{ kind: 'operator' | 'bot' |
  'server' | 'wire', id: OperatorId | null, name: string | null, color: string |
  null }`, on **every** turn event, including `pin`, `unpin`, `commit` and
  `operator.command`. It rides the `lens-frames` broadcast
  (`broadcastLensFrames` → `{ type: 'lens-frames', gameId, turn, events, head
  }`), which goes to **every** subscriber of the game. So *who pinned* is on the
  wire, broadcast, with a stable operator id **and** a name **and** the colour.
  `renderTimeline` already passes `event.actor.id` and `event.actor.color` into
  the `timeline.tick` op. The lane's mark needs no wire change at all.
* **`UnitRow.owner: OperatorId | null`** and **`UnitRow.operator: string |
  null`** on the folded frame, which is what `authorOf` reads to attribute a
  `fixed.chip`. So the board's pin chip and the rail's fixed strip have an
  author today; it is a name rather than an id, but it is an author.
* **`selections-update`** carries `selections[snakeId] = { userId, color }`,
  `owners[snakeId] = { userId, name, color }` and `connectedUsers: Array<{
  userId, name, color, selectedSnakeId }>`. So the client has a complete
  **directory** of the game's operators — id, name and hue together — which is
  what lets one `mark(key)` function resolve an id, a name *or* a hue to the
  same index.

### 6.2 What it lacks — one field, named exactly

**`StagedMoveView` carries no operator identity.**
`active-game-manager.ts:346` — `{ move, requestedMove, committed, color,
source, fatal, rotation? }`. `color` is the operator's hue and `source` is
`'manual' | 'bot' | 'fallback' | …`; there is **no `userId` and no `name`**.
That projection is what `broadcastSelectionsUpdate` sends and what the board
draws every staged arrow from. So **the arrow on the board is attributable by
hue and by nothing else** — which is precisely the deferral `02 §2.5` recorded,
still open, and the reason §5.3 does not draw the mark on the arrow.

**What is needed is one field, and the value already exists server-side.**
`getCommandStateForGame` (`active-game-manager.ts:3611`) already builds

```ts
operators[snakeId] = cs.intentBy;   // OperatorRef { userId, name, color }
```

for exactly this reason, and `broadcastSelectionsUpdate`
(`websocket-server.ts:1254`) does not include it in the envelope. The exact
need, in one line:

> `broadcastSelectionsUpdate` sends `operators` — the `{ [snakeId]: OperatorRef
> | null }` map `getCommandStateForGame` already computes — alongside
> `stagedMoves`; **or**, equivalently, `getStagedMovesForGame` puts `by:
> OperatorRef | null` on `StagedMoveView` beside the `color` it already derives
> from the same `cs.intentBy`.

Either is additive, neither changes a value any client reads today, and the
second also fixes the replay path, because `CommandTurnState` is the shape the
history viewer renders from. It is **not taken here**: it is a wire change on a
projection three surfaces and a replay format read, and it belongs with P-4's
palette decision, in the same pass, with one set of regenerated screenshots.

**A second, smaller gap, recorded not fixed.** The `lens-lock` reply
(`websocket-server.ts:967`) is `this.send(client.ws, …)` — **unicast to the
operator who pressed**. A peer learns about the lock only through the pin events
in `lens-frames`, which is sufficient for everything in §5.3 (that is where the
lane's ticks and the frame's `boundedBy` come from) but means there is no
lock-shaped envelope a peer can react to. Nothing here needs one; it is written
down so the next reader does not go looking for one.

### 6.3 What is mocked, and only in the harness

`src/tests/lens-walkthrough-server.ts` enrols **one** operator, because operator
names are unique per game and a second entry arrives as a stranger and gets a
takeover dialog (`scripts/ux-walk-server.js`'s own header says so). So the
property "two operators' pins are told apart" cannot be staged by entering
twice.

The motion-and-marks drill therefore injects a **second operator into the
page's own `connectedUsers` directory** — id, name and the palette's index-1
hue — and asserts that the two operators resolve to two different marks, that
each mark is the one its palette index names, and that the mark drawn beside a
name in the rail is the same mark drawn in that operator's lane tick. Nothing on
the server is mocked, no envelope is faked, and the injection lives in
`scripts/lens-walkthrough.js` alone. The shipped page has no code path that
invents an operator.

---

## 7. What changed in the code

| file | what |
|---|---|
| `src/web/tokens.css` | group D gains the eleven `--motion-*` / `--ease-*` tokens of §2 and re-points the five old duration names at them as aliases; group E gains §4's semantics (four verbs to `0s`, emphasis to a fade); **group F** is new — the shared `@keyframes`, in one delimited block, so every sheet on every page names the same animation |
| `src/web/play-game.html` | the pulse layer and `.lens-arrival-pulse`'s real rule; the reduced-motion block's dead `animation: none !important` replaced by §4's fade; chips and lane ticks get `--motion-state-near`; the roster badge gets its mark; `lensAcceptWiden` fires the pulse; `lensLaneRows` carries `actor.id` through |
| `src/web/alerts.js` | the ring's two transitions name `--motion-enter` / `--motion-exit` |
| `src/web/latency.js` | `.lat-pulse` names `--motion-state` / `--ease-state` |
| `src/web/lens-panel.js` | `operatorMark()` and the directory behind it; the fixed strip's attribution and the operator lane's tick draw the mark |
| `src/web/board-renderer.js` | the fixed chip draws `bound.mark` where it drew `•` (one expression; the renderer gains no state and no loop) |
| `scripts/lens-walkthrough.js` | the motion-and-marks drill (§8) |

### 7.1 Why the keyframes are in `tokens.css` and not `chrome.css`

`chrome.css` is linked by the five lobby pages and **deliberately not by
`play-game.html`** (`09 §2`, and the comment at the top of the page's own
`<style>`). A keyframe defined there is invisible to the operator surface, which
is the only surface with an arrival pulse on it. `tokens.css` is the sheet every
page links.

That file's stated invariant is *custom properties and nothing else, so it
paints nothing on its own and can be linked by every page*. A bare `@keyframes`
block preserves the property the invariant exists for: **a keyframe paints
nothing until an element names it.** Adding one changes no computed style
anywhere. The invariant is restated in the file's header as *custom properties
and inert `@keyframes`*, with this paragraph as the reason.

---

## 8. What is asserted, and where

Motion is not screenshot-testable — a PNG of a transition is a PNG of one
moment — so it is asserted the way `06-ALERTS.md` asserts its ring: on the
**class**, on the **computed duration**, and on the **token the duration came
from**.

The drill is `scripts/lens-walkthrough.js`, section `drill/motion`, and it fails
the run like the other four.

1. **The rest state is unchanged.** `#lensPulseLayer` does not exist until a
   widen is accepted, and does not exist after the animation ends. The whole
   walkthrough's PNGs are diffed against the run before this work: **identical**.
2. **The pulse exists and is one-shot.** A widen is accepted; the layer appears,
   carries one `.lens-arrival-pulse` per gained unit, computed
   `animation-duration` is `0.6s`, `animation-iteration-count` is `1`, and the
   layer is gone afterwards.
3. **Every duration equals its token.** For each of the five verbs the drill
   reads `getComputedStyle` on the element that uses it and compares it against
   `getPropertyValue` of the token on `:root` — so a hard-coded `0.6s` that
   happens to match fails the day the token moves.
4. **Reduced motion.** With `emulateMedia({ reducedMotion: 'reduce' })`: the
   four instant verbs read `0s` on their own elements; the pulse reads
   `animation-name: motion-arrival-reduced`, `animation-duration: 0.62s`,
   `animation-iteration-count: 1`, and its computed `transform` is `none`.
5. **The marks.** Two operators in the directory resolve to two different marks;
   each mark is the one its palette index names; the mark drawn in the rail's
   fixed strip is the mark drawn in that operator's lane tick; and the roster
   badge carries a mark beside every dot.
6. **The flash budget** is still `scripts/alerts-drill.js`'s to prove, unchanged
   — 12 raisings in 2,895 ms → 4 onsets — and §4a's second floor is a property of
   the reactive policy's timer rather than of a counter, so there is nothing new
   to count.

The gates over the whole series: `npx tsc --noEmit -p .`,
`npx eslint "src/**/*.ts"`, `node --check` on every changed `.js`,
`npm run build:lens`, `npx jest --maxWorkers=2 "src/tests/lens-"
src/tests/local-game-determinism.test.ts`, `scripts/lens-walkthrough.js` and
`scripts/alerts-drill.js` both exiting 0.

---

## 9. What this document does not settle

* **The palette.** P-4's Okabe–Ito half (§5.1). Still open, still board-owned.
* **The staged arrow's operator.** §6.2's one field. Still open; the marks work
  everywhere else without it.
* **The rank trail on the board.** `01-RESEARCH.md` P3 asks for `▲was #1` to
  fire on the board as well as in the table. It is an **emphasis** in this
  vocabulary and it would use `--motion-emphasis` on the same layer as §3's
  pulse — but *what* it marks (the row's unit? its old cell? its new one?) is
  the same kind of question §3.1 had to answer, and it has not been asked of
  anyone yet.
* **The badge's 2 s loop.** `--dur-badge-pulse` is the one repeating animation
  left and it is outside this vocabulary. It is honest about being outside it:
  §1.2 says nothing added here loops, not that nothing on the surface does.
