# 12 — INPUT MODALITIES: the hands the interface is actually under

Three rounds of this work have been about the keyboard: which key carries an
action (`bracket` / `vim` / `left hand`), how dense the type is, and what a
press costs the bot. All three assumed a hand already on the home row. This
round asks the prior question — **which hand, on which device** — and it turns
out the shipped surface has one answer for a mouse, a worse one for touch, and
none at all for a left-handed operator.

The order this round answers is the standing one: *"efficient and intuitive
controls meeting a variety of known human preferences for game interfaces, and
research into best practice."* The variety is the point. What follows is what
other people already learned about time-pressured selection input (§1), what
the shipped interface does when measured against it (§2), what was built (§3),
and the drills that hold it (§4).

---

## 1. What is known about input under a clock

### 1.1 The chess clients: two gestures, both shipped, neither default-only

Every serious chess client ships **click-click and drag-drop at the same
time**, and lets the player turn either off. This is not indecision. The two
gestures fail differently under time pressure: a drag is one continuous act
with a slip risk at the release, and a click-click is two discrete acts with a
"which piece is armed?" risk in between. Chess.com's own support pages carry
the artefact of that trade-off — players report that click-to-move on mobile
turns a *change of mind* (select piece A, then decide on piece B) into an
unintended premove, and ask for premove to require drag while ordinary moves
allow both [1]. Lichess's preference set has the same shape: move method,
premove on/off, and auto-promotion as three separate switches [2].

Three lessons the shipped Centaur surface can take verbatim:

* **Both gestures, one selection model.** The drag and the click must resolve
  to the same "this destination is selected" state, or the two paths drift and
  one of them silently stops arming the commit key. (We already shipped this
  defect once between the rail and the board — 02 §3.3.)
* **A move method is a preference, not a mode.** Neither client asks which one
  you want per move.
* **Auto-anything is a preference with a stated default.** Auto-queen is the
  canonical example: it is right under a clock and wrong in a study, so it is
  a switch and it says which one it is doing [2].

**Premove** is the genre's answer to the clock: an input taken during the
opponent's turn that fires the instant the turn flips [3]. It is worth being
precise about why it exists — it converts *reaction time* into *preparation
time*, at the cost of committing against an unknown board. Lichess allows one;
Chess.com allows a chain [4]. It is only sound where the game's own semantics
say a move issued before the turn opens is well-defined. §2.13 records what our
semantics actually say.

### 1.2 RTS and MOBA: the selection is the expensive part

The StarCraft II literature is unusually direct about where the time goes. Yan,
Cheung and Huang's analysis of 3,000+ replays found that **control-group use is
the single clearest differentiator between skill levels** — novices barely use
them, experts nearly always do, and the difference shows up hardest in
time-pressured situations, where experts stay composed and keep recalling
saved selections rather than re-acquiring units by pointing [5]. The action
being issued is cheap; *re-establishing which units it applies to* is what
costs.

The genre's two other answers point the same way. **Quick-cast** (fire on key
press at the cursor, rather than key press → click) removes one full pointing
act from every ability, and is the near-universal expert setting [6].
**Smart-cast / automatic control groups** in newer RTS are explicitly framed as
"lowering the skill floor without affecting the ceiling" [7] — the design
position that an input economy should not itself be the difficulty.

For us: an operator under a 500 ms clock re-acquires *the focused unit* every
time attention moves. Anything that makes focus sticky, recallable, or
reachable without a pointing act is worth more than shaving a keystroke off
the command.

### 1.3 Fighting games: leniency is invisible when it works

Fighting games buffer input — a press arriving a few frames before the game can
act on it is stored and fired at the first legal frame, rather than dropped
[8][9]. The design literature is blunt about the failure mode: **a dropped
early input is not read by players as "I was early", it is read as "the
controls are laggy"** [10]. One published refactor added a 10-frame pre-input
buffer to dodge/parry/light-attack and lifted the perfect-dodge rate 38% with
no animation change at all [10].

The counterweight is equally documented: too long a buffer produces actions the
player has already changed their mind about, and the community reads *that* as
unresponsiveness too [11]. Research into the "grace frame" for command input
finds the right window is not a function of command length but of where input
continuity breaks [12].

For us: the analogue is not a combo buffer, it is **the press that lands while
the rail is re-rendering**. The shipped page already learned half of this — the
board and the units table are bound on `pointerdown` on a permanent ancestor
precisely because a `click` is dropped when a re-render lands between press and
release. The other half is that a press with no effect must *say so* (05 H-3,
already fixed for `Space`), because a silent no-op is read as broken hardware.

### 1.4 Touch: the size floor, the thumb, and no hover at all

Three numbers, from three authorities, and they do not agree — which is itself
the useful fact:

* **WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA: 24 × 24 CSS px**, with
  an explicit *spacing* exception — an undersized target passes if a 24 px
  circle centred on it does not intersect another target's circle — plus
  *equivalent*, *inline*, *user-agent* and *essential* exceptions [13].
* **WCAG 2.1 SC 2.5.5 Target Size, Level AAA: 44 × 44 CSS px** [14].
* **Apple HIG 44 × 44 pt; Material 48 × 48 dp** [15][16]. Android's own
  guidance adds the mechanism that matters — the *touchable region* may be
  grown beyond the drawn control (`TouchDelegate`), so meeting the floor need
  not change what is drawn [16].

Empirically, Parhi, Karlson and Bederson's one-handed thumb study gives 9.2 mm
for discrete targets and 7.6 mm for serial ones as the point past which
accuracy and preference stop improving [17] — roughly 35 and 29 CSS px, i.e.
between the AA floor and the AAA figure, which is about where honest practice
lands.

Two structural facts matter more than the number:

* **There is no hover on touch.** Anything an interface says only on hover is
  unsaid on a tablet. (Our T4 rule — the board and the rail are places to
  *look* until something is pressed — turns out to be a touch rule as well as
  a stability rule.)
* **There is no right button.** Android's desktop guidance states the mapping
  explicitly: *touch interactions rely on long-press where desktop users expect
  a secondary click*, and dragging on a touchscreen requires a long-press first
  because a one-finger swipe belongs to scrolling [18].

And the thumb: on a phone held one-handed, the reachable arc is the bottom
half, angled toward the holding side; menus and primary actions placed at the
top or on the far side are measurably harder to hit [19][20]. The 44 px rule is
a floor, not a layout — target size, spacing, and *position relative to the
holding hand* are three separate variables and getting one right does not save
the others [21].

### 1.5 Accessibility: the pointer requirements are not the keyboard ones

The distinction that gets missed: **a keyboard alternative does not satisfy a
pointer success criterion** [22]. The four that bind us:

* **2.5.1 Pointer Gestures (AA)** — every multipoint or path-based gesture
  needs a single-pointer, non-path alternative unless it is essential [23].
* **2.5.7 Dragging Movements (AA, WCAG 2.2)** — every dragging action needs a
  *single pointer without dragging* alternative unless dragging is essential.
  The alternative may be a sequence of single-pointer acts: activate the thing
  to move, then activate the destination [24]. Failure F108 is exactly "the
  only way to actuate this is to drag it" [25].
* **2.5.8 Target Size (Minimum) (AA)** — 24 px or the spacing exception [13].
* **2.1.1 Keyboard** — and *not* as a substitute for the above.

Who this is for is concrete: hand tremor, trackball, head pointer, eye gaze,
speech-driven mouse emulation, switch access [24]. Switch access in particular
only reaches what a **primary click** reaches — Android's guidance says so in
as many words: *"Not hiding functionality from primary clicks is not only good
for discoverability but also critical to assistive technologies like Switch
Access"* [18]. A command reachable only by right-click, only by Ctrl+click, or
only by a held press is a command a switch user does not have.

Note also that both major desktop platforms ship a *simulated secondary click*
— hold the primary button to right-click [26]. An interface that binds a
long-press to its own meaning on a mouse will collide with that; the long-press
belongs to touch.

### 1.6 Left-handed and one-handed operation

The pen/tablet literature finds a **mirrored** optimum: target-acquisition time
by position interacts with handedness, so any static placement of a control
relative to the point of activation disadvantages one group or the other [27].
Occlusion is the mechanism — the hand covers what it reaches across [28]. On
touchscreens the same asymmetry shows up in scroll arcs and in which parts of a
fixed layout fall in the comfortable zone [19].

The honest reading is narrow: this is *not* a licence to mirror everything.
Reading order is left-to-right regardless of handedness, and the usability
literature's standing advice is that consistency with the rest of a user's
software usually beats a hand-derived micro-optimum [29]. What it does support
is mirroring the **column the pointing hand works in**, so the hand does not
cross the thing it is looking at. That is a preference with a stated default,
not a redesign.

### 1.7 Mouse-first versus keyboard-first, honestly

The famous claim — *subjects report keyboarding is faster; the stopwatch says
mousing is* [30] — is worth citing and worth qualifying. It is a 1989
observation about a menu-driven single-document interface, its underlying data
was never published, and the reconstruction of its one described experiment
does not survive scrutiny [31]. Better-controlled work finds the ordering is
**task-dependent**: a toolbar click beats a menu-keyboard traversal for common
commands, while keyboard shortcuts, once memorised, are as fast as toolbars and
scale to *all* commands rather than the dozen a toolbar can hold [32]. And
experienced users mostly *do not* migrate to shortcuts even when shortcuts are
faster [33] — the transition does not happen on its own.

Three consequences we can act on:

* Do not design as if one population wins. Both paths must be complete.
* Discoverability matters even for the keyboard-first: the printed key on the
  chip is how a mouse user becomes a keyboard user (33).
* Time the *task*, not the *keystroke*. Our own clock is 500 ms per decision,
  and the expensive part is re-acquiring focus (§1.2), not the command.

### 1.8 The ranked list of preferences the interface must support

Ranked by cost to the operator if unmet, under our clock.

| # | Preference | Why it ranks here |
|---|---|---|
| **P1** | **Every command has a primary-click path.** No command reachable only by a modifier, a held press, a second button, or a key. | Switch access, speech and head pointers reach primary click only [18][24]. Also the touch floor: no right button exists. |
| **P2** | **Both move gestures — click-click and drag — resolving to one selection.** | Genre-universal [1][2]; and a drag-only path fails 2.5.7 [24]. |
| **P3** | **Command and board legible together.** The commit control must be reachable without losing sight of the thing it commits. | §1.2: re-acquisition is the expensive act. A 1.4 k px scroll inside a 500 ms turn is not a control. |
| **P4** | **Targets at the AA floor (24 px) always, at the touch figure (≥44 px) under a coarse pointer,** with the hit region grown rather than the drawing [13][16]. | Legal AA floor; and tremor/trackball/thumb accuracy [17]. |
| **P5** | **No hover-only meaning; no press-and-hold-only meaning without a tap-reachable twin.** | No hover on touch [18]; timed presses collide with simulated secondary click [26]. |
| **P6** | **A stated default for every automatic behaviour, and a switch beside it.** | Auto-queen's lesson [2]. |
| **P7** | **Handedness mirrors the working column, and nothing else.** | Mirrored optimum is real [27][28]; wholesale mirroring is not supported [29]. |
| **P8** | **A press that does nothing says why, at once.** | §1.3: a silent drop reads as broken hardware [10]. Already our 05 H-3. |
| **P9** | **Preparation, where the semantics allow it — and only there.** | Premove converts reaction time to preparation time [3][4], but only where a command issued before the turn opens is defined. |
| **P10** | **One layer, not scattered handlers.** | The rail/board selection split (02 §3.3) is the standing proof of what two input paths cost. |

### 1.9 The heuristic checklist

Ten questions, each answerable by measurement rather than opinion. §2 answers
them; §4 keeps answering them.

1. **Primary-click completeness.** Can a full turn — focus, candidate,
   override, lock, undo, foil, drill, clear — be played with unmodified left
   clicks alone?
2. **Gesture parity.** Do click-click and drag reach the same selection state,
   and does either alone suffice?
3. **Modifier reachability.** Does every modifier-gated command (right-click,
   Ctrl+click) have a modifier-free twin?
4. **Co-visibility.** Are the board and the command bar simultaneously in the
   viewport at every supported width?
5. **Target size.** Every interactive target ≥ 24 × 24 CSS px (or the spacing
   exception), and ≥ 44 px under `pointer: coarse`.
6. **Overflow.** `scrollWidth === clientWidth` at 390 px; no two-axis scroll.
7. **Hover independence.** Does anything the operator must *read* appear only
   on hover?
8. **Held-press safety.** Is any long-press meaning also reachable by a tap,
   and is no long-press bound on a fine pointer?
9. **Focus parity.** Does the keyboard reach everything the pointer reaches,
   with a visible ring, and does a pointer act never steal the commit key?
10. **One machine.** Do the pointer and the keyboard drive the same state
    machine, asserted by a drill that plays the same turn twice?

---

## 2. The audit: the shipped interface, measured

Measured on the walkthrough harness (`scripts/ux-walk-server.js`, a real local
decision) with Chromium at `/opt/pw-browsers/chromium`, in three contexts:
1500 × 950 fine-pointer, 768 × 1024 touch-emulated, and 390 × 844 touch
emulated (`hasTouch`, `isMobile`, DPR 2). Sizes are `getBoundingClientRect`
readings of every interactive element, not eyeballed. The raw numbers are the
`audit` block of `docs/design/ux/eval/input-audit.json`.

Findings are numbered `I-n` and each carries the repro that produced it.

### I-1 — the foil has no pointer path

`F` is the only way to put the runner-up on the board. The control bar's chip
row is `lock · undo · hold · goto · near · clear`; there is no foil chip and no
other element carries the action.

*Repro:* focus a unit, then
`document.querySelector('[data-lens-action="foil"]')` → `null`.

Against **P1** and checklist 1. The foil is 02 §8's *"cheapest signal on the
screen"*, and a mouse-only operator cannot ask for it.

### I-2 — the breakdown drill (L3) has no pointer path

Same shape. `B` / `Shift+B` reach `drill` and `drill.all`; nothing in the
breakdown panel or the moveset table does.

*Repro:* `document.querySelectorAll('.lens-breakdown [data-lens-action]').length`
→ `0`; `document.querySelectorAll('[data-lens-drill]').length` → `0`.

### I-3 — `goto` and `near` are unreachable on touch, and unreachable by switch

Both are modifier-gated board gestures (right-click; Ctrl/Cmd+click). Their
chips exist in the bar but are **inert text** — they carry no `data-lens-action`
and are drawn without `role="button"`. A touch device has no right button and
no practical Ctrl+click; a switch user has primary click only.

*Repro:* on the 768 × 1024 context, no gesture available to the operator sets a
waypoint; `[data-lens-action]` on the page is `['lock','undo','clear']`.

Against **P1** and checklist 3. This is the worst of the three "no pointer
path" findings because these two commands *are* the interface's forward
planning.

### I-4 — a drag does not move a unit

Press on the focused unit's head, move to a candidate cell, release: nothing is
selected. The board is click-click only, so half the genre's operators arrive
with a gesture that silently fails.

*Repro:* with `red-A` focused and its head at `(2,2)` and a candidate at
`(2,3)`, `mouse.down` at the head → `mouse.move` to the candidate →
`mouse.up`; `userSelectedMove` is `null` afterwards.

Against **P2**. (Note the inverse is *not* a defect: click-click alone
satisfies 2.5.7. What fails is the operator's expectation, not the criterion.)

### I-5 — the command bar is off-screen on every touch viewport

At 768 × 1024 the board sits at y ≈ 259 and `#lensControls` at y = **1433**; at
390 × 844 the board is at y ≈ 182 and the bar at **1741**. Below 1180 px the
rail is not a rail — it stacks under the board *and* under the whole roster.
Staging a candidate picked on the board therefore costs a ~1.4 k px scroll away
from the board and a scroll back, inside a 500 ms turn.

*Repro:* `document.getElementById('lensControls').getBoundingClientRect().top`
→ `1433` (tablet) / `1741` (phone), with `window.innerHeight` 1024 / 844.

Against **P3** and checklist 4. The highest-cost finding in this audit.

### I-6 — horizontal overflow at 390 px

`document.documentElement.scrollWidth` = **580** against `clientWidth` = 390.
The canvas is a fixed 550 CSS px and hangs off the left edge
(`getBoundingClientRect().left` = −80): the board is clipped and the page
scrolls on two axes.

*Repro:* 390 × 844 context, `scrollWidth`/`clientWidth` as above;
`#gameCanvas` rect `left: -80, w: 550`.

Against checklist 6.

### I-7 — targets below the 24 px floor, and none at the touch figure

Twenty-five of thirty-six measured targets are under 24 px in one dimension on
the tablet context; twenty-nine of thirty-six are under 44 px. The
representative set:

| target | measured | floor |
|---|---|---|
| control chips (`lock`, `undo`, `hold`, `clear`, …) | 169.7 × **22** | 24 AA / 44 touch |
| lane ticks (`[data-seq]`) | **10.9 × 12** | 24 AA / 44 touch |
| key-scheme pickers (`bracket`/`vim`/`left hand`) | 86.3 × **15** | 24 AA |
| density pickers (`compact`/`default`/`roomy`) | 51.8 × **15** | 24 AA |
| per-row copy-id | **22.8 × 18** | 24 AA |
| `Submit All` / `Suicide All` | 78.9 × **22** | 24 AA |
| `Help: Ctrl + /` | 112.7 × **21** | 24 AA |
| lane foot (expand attention ticks) | 322 × **12** | 24 AA |

*Repro:* `getBoundingClientRect()` over
`[data-lens-action],[data-seq],[data-lens-scheme],[data-lens-density],[data-copy-id],button`
with zero-size and hidden elements dropped.

Against **P4** and checklist 5. The lane tick is the sharpest case: an 11 × 12
px scrubber tick is not operable by a thumb at all, and the ticks are adjacent,
so the spacing exception does not rescue them either.

### I-8 — a held press means nothing, anywhere

Neither the board nor the rail interprets a press held past a threshold. Touch
therefore has *no* secondary gesture: the one mapping the platforms agree on
(long-press = secondary click [18]) is unbound.

*Repro:* dispatch `pointerdown`, wait 800 ms, dispatch `pointerup` on a board
cell: `selectedCell` is unchanged, no waypoint is set, no panel opens.

### I-9 — a wheel over the board scrolls the page — OPEN, by design

`window.scrollY` 0 → 130 on a 200 px wheel over the board: the board leaves the
viewport under the operator's own gesture. Nothing board-level is bound to the
wheel, and nothing should be invented: the board has no zoom semantics, and a
wheel-zoom would be a new one. Recorded, not fixed. Once I-5 puts the command
bar in a fixed position under a coarse pointer, the cost of this drops.

### I-10 — the board resize grip is drag-only — OPEN

`#boardResizeHandle` binds `pointerdown` / `pointermove` / `pointerup` and
nothing else. There is no single-pointer alternative, which is WCAG 2.2 SC
2.5.7 failure technique F108 [25] on the nose. Not fixed in this round: the
grip's own semantics (a continuous size, persisted) want a size control rather
than a bolt-on, and inventing one here would put a second sizing affordance on
the page. Handed back, ranked.

### I-11 — no handedness preference

At ≥ 1180 px the rail is fixed to the right of the board
(`grid-template-columns: minmax(0,1fr) 380px`). A left-handed operator's
pointing hand crosses the board — the thing being read — to reach every chip.

*Repro:* the grid rule in `play-game.html`; no preference exists that changes
it.

Against **P7**.

### I-12 — focus parity: checked, no defect

After a board click `document.activeElement` is `BODY`. That is **correct** and
must stay: `Space` is the global lock key, and a board click that moved focus
onto a chip would make the next `Space` press the chip instead of the lock.
Thirty-two elements are keyboard-reachable, the enabled chips carry
`role="button"` and `tabindex="0"`, and the panel's own `keydown` handler stops
`Enter`/`Space` at the chip so a focused chip does not double-fire (already
fixed in an earlier round). No change.

### I-13 — premove: the semantics do not permit one, and two shipped commands already do the job

The order says *"a premove-style 'arm next turn' only if the existing
stage/lock semantics already permit it (do not invent game semantics)"*. They
do not:

* staging is gated on `moveSubmitted` and on this turn's candidate enumeration
  (`moveState.moves`), which is rebuilt per turn;
* the undo stack is **cleared at the turn boundary** on purpose — *"every entry
  names a command for a board that has since resolved"* (02 §3.4);
* a lock's pins are spent against *this* turn's cluster.

An input issued against next turn's board would therefore be an input against a
candidate set that does not exist yet. That is new game semantics and is not
built here.

What *is* already persistent, and already premove-shaped, is exactly two
commands: **`hold`**, which the operator's manual calls a *standing order* that
"governs every turn after it, not just this one", and the **`goto` / `near`
queue**, which biases the search on subsequent turns and survives the boundary.
Both are the operator's preparation, and both are — per I-3 — the two commands
with no primary-click path. **The premove-shaped work this round owes is
therefore I-3, not a new command**, and that is what §3.3 builds.

---

## 3. What was built

One layer, not a scatter of handlers. `src/web/input-layer.js` is the pointer
half of the same input vocabulary the keyboard already has, and it is
deliberately small: it owns the preferences, a pure gesture recogniser, and the
wiring — and it owns **no game meaning at all**. Every gesture it recognises
ends in a call the keyboard also makes.

### 3.1 The preferences, in one store

Three, named `input.*` and resolved through one accessor:

| name | values | default | what it changes |
|---|---|---|---|
| `input.moveGesture` | `click` · `both` · `drag` | `both` | whether a drag from the head selects a candidate. Click-click works under **all three** — a drag-only path is WCAG 2.2 F108 (§1.5). |
| `input.handedness` | `right` · `left` | `right` | which side of the board the control column sits on, and nothing else (§1.6). |
| `input.targets` | `auto` · `large` | `auto` | `auto` is the 24 px floor everywhere and 44 px under a coarse pointer; `large` asks for the touch figure on a fine pointer too. |

`InputLayer.pref` reads `window.Prefs.get(name, default)` first and falls back
to `localStorage` under the same name; `InputLayer.setPref` writes through
`window.Prefs.set` and mirrors locally. **There is one store, and the operator
preferences module owns it** — this file owns only what the names mean and
what values are legal. A value outside the allowed set resolves to the
default, so a stale or hand-edited store cannot invent a mode.

The pickers sit in the rail's existing scheme/density row, in the same markup,
because they are the same kind of thing: a hand posture, not an opinion about
the product (02 §3.1).

### 3.2 The gesture recogniser

A pure `{idle → down → tap | longpress | drag}` machine over coordinates and an
injected clock. Three properties, all asserted in
`src/tests/input-layer.test.ts`:

* **The outcomes are disjoint.** One press yields exactly one of tap /
  longpress / dragend. Three independent listeners over one press is how an
  interface ends up staging a move *and* opening a panel on one gesture — and
  is, precisely, what a naive long-press bolted beside the shipped click
  handler would have done.
* **Long-press is a touch gesture.** It is bound for `touch` and `pen` and not
  for `mouse`, because both desktop platforms already bind a held primary
  button to a simulated secondary click (§1.5) and we must not fight the
  operating system for it.
* **A second pointer cannot steer or end the first one's gesture.**

The press is **opened on the board and closed on the document**. That is not
tidiness: a release that lands outside the element the press started on — the
finger slid onto the fixed command bar, the page scrolled under it — never
reaches an element-scoped listener, so the press stays open and the long-press
timer fires half a second after the operator finished. On the phone that
showed up exactly once during this work: a tap selected a candidate and then,
450 ms later, silently replaced it with a goto target.

Both board listeners are registered in the **capture** phase, because the
shipped `handleBoardPointerDown` is registered on the same element in capture
and calls `stopPropagation()` on every press it answers. A bubble-phase
listener would have seen only the presses the shipped handler ignored — the
drag would have worked from the unit's own head and never from a candidate
cell.

### 3.3 One action set, reached two ways

`lensHandleKey`'s switch became **`lensRunAction(name)`**. While it lived
inside the key handler the keyboard was its only caller, which is the whole of
I-1 and I-2: `F` and `B` were the *only spelling* of two actions. Now the
chips call it with the same names the keymap carries.

The control bar gains two chips in the existing `glyph · verb · key · state`
grammar and no new vocabulary:

* **`⟂ foil F`** — states `on the board` while latched.
* **`⌕ drill B`** — states `long-press a row` while idle, `drilled` after.

And `goto` / `near` stop being inert text naming gestures half the devices do
not have. They are chips that **arm the next board press**, borrowing the
armed lock's own idiom rather than inventing one: the chip re-reads
`goto — press a cell`, the board's edge takes a dashed ring, the next
unmodified left press sets the target, `Esc` cancels, and the arm expires on
its own after eight seconds — because an armed gesture that waits forever is
the trap 02 §3.4 refuses. It sends the same `set-waypoint` message the
modifier gestures send: **no new game semantics, one more way to reach the
ones we have.** The right-click and the ctrl-click are untouched and remain
the fast path.

On the board the layer adds exactly two gestures:

* **A drag from the head to a candidate** resolves to `selectMove(key)` — the
  same call the click makes, which is the same call the arrow pad makes. A
  drag that did not start on the unit does nothing at all; a board that eats a
  mis-swipe is worse than one that ignores it.
* **A held press on a cell** sets the goto target — the secondary click a
  touchscreen does not have, where both platforms put it.

And on the rail, one: **a held press on a moveset row drills it** (the touch
twin of `B`). It is never the *only* way there — the chip carries the same
action — because a meaning available only to a timed press is unavailable to a
switch user.

### 3.4 The surface

Three groups of CSS, and the first two are invisible at rest on a fine
pointer.

**The hit region, grown without growing the drawing.** SC 2.5.8 asks for
24 × 24 CSS px of *target*, and the target is the region that accepts the
pointer, not the ink. Our chips are 22 px tall, the pickers 15, the copy
control 22.8 × 18. Android's guidance names the mechanism — grow the touchable
region, keep the view — and a pseudo-element is the web's version of it: a
press on `::after` reports the **owning element** as its target, so every
delegated `closest()` handler on the page resolves it unchanged. The expansion
is 1–5 px per side and sits inside the existing 5 px chip gap, so no two
targets' regions overlap. Nothing is painted and nothing moves.

**The coarse pointer.** Under `(pointer: coarse), (hover: none)`:

* the canvas is clamped to the viewport (`max-width: 100%`), which is the whole
  of the board half of I-6 — `pointerToCanvas` already divides by the box
  rather than the buffer, so no coordinate maths changes;
* the header rows wrap. Clamping the canvas took the phone from 580 px of
  content to 485; the remaining 95 were a single non-wrapping flex row whose
  intrinsic width is 485 whatever the viewport is, and a row that cannot wrap
  sets the layout viewport — which is why `position: fixed` elements were
  485 px wide on a 390 px screen;
* **`#lensControls` is fixed to the bottom of the viewport.** It is the same
  element with the same chips and the same handlers; only its box moves. This
  is I-5, the costliest finding: the bar was 1433–1741 px below a board the
  operator has to be looking at;
* chips, pickers, roster rows, buttons and the lane reach 44 px, and
  `scroll-margin-bottom` keeps a scrolled-to row clear of the fixed bar;
* the drag-only resize grip is hidden rather than left to fight the page's own
  scroll.

**Handedness.** `input-hand-left` on the root swaps the ≥1180 px grid to
`380px minmax(0,1fr)` and the areas to `"rail board" / "rail roster"`. The
rail's own contents, the board and the roster are untouched: the literature
supports a *mirrored* optimum for the hand that points and supports nothing
wider than that (§1.6). The default stamps no class at all.

### 3.5 What was NOT built, and why

* **A premove.** §2 I-13: staging is gated on this turn's candidate
  enumeration and the undo stack is cleared at the boundary by design, so an
  input against next turn's board would be an input against a candidate set
  that does not exist. That is new game semantics. The two commands that *are*
  already persistent — `hold` and the goto queue — got the pointer path they
  were missing instead, which is the premove-shaped work these semantics
  actually permit.
* **A wheel or pinch meaning on the board** (I-9). The board has no zoom
  semantics and inventing one here would be a game decision dressed as an
  input one.
* **A pointer alternative for the board resize grip** (I-10). It wants a size
  control, not a bolt-on, and a second sizing affordance is worse than the
  one gap. Handed back.

---

## 4. Evidence

### 4.1 The gates

`npx tsc --noEmit -p .`, `npx eslint src/**/*.ts src/web/*.js`,
`npm run build:lens`, and `npx jest --maxWorkers=2 "src/tests/lens-"
"src/lobster/__tests__/lens-" src/tests/local-game-determinism.test.ts
src/tests/input-layer.test.ts src/tests/keynav-machine.test.ts` — all green.
`keynav-machine.test.ts` is in that list on purpose: the claim that the pointer
and the keyboard drive **one** destination machine is only worth anything if
the machine's own parity test still passes.

### 4.2 The input drill

`scripts/input-drill.js` plays the same determination the keyboard drill plays,
three more ways, and asserts the **end state** rather than the pixels:
`stagedMoves[unit]` carrying the operator's own candidate with
`source: 'manual'`, and the undo stack one deeper — exactly what
`lens-walkthrough.js` asserts at `d1-pin`.

```
node scripts/ux-walk-server.js --port=5503
node scripts/input-drill.js --port=5503 --out=docs/design/ux/input
```

Thirty-eight checks, all green, exit code 0:

* **pointer (16)** — focus, candidate, lock, undo, foil, drill, goto armed,
  goto spent, goto disarmed. **No key is pressed at any point in this drill**:
  a command reachable only by a key is a command a switch user does not have.
* **drag (3)** — a drag from the head reaches the *same* selection a click
  reaches; a drag that did not start on the unit selects nothing;
  `input.moveGesture: click` turns the drag off and leaves the click alone.
* **handedness (3)** — one class on the root, the control column crosses the
  board, and the default stamps nothing.
* **tablet 768 × 1024 (8)** and **phone 390 × 844 (8)** — no sideways scroll;
  the command bar in the viewport with the board; every pressed target ≥ 44 px
  on its short side; a tap on the board selects; a tap on the chip reaches the
  same end state the keyboard drill asserts; a held press sets the goto
  target.

One documented exception in the target sweep: **the lane tick is held to 24 px
wide rather than 44**, and it is named rather than waived. A scrubber tick's
*position* is the datum, so a 44 px tick would overlap its neighbours and stop
pointing at what it points at — WCAG 2.5.8's `Essential` case. It is 44 px
tall, and `,` `.` `Home` `End` are beside it.

### 4.3 The pixel gate

The base commit's tree was stood up on its own port and photographed beside the
head's, region by region, at rest, with the clock-driven paint frozen
(`docs/design/ux/input/pixel-gate.json`):

| region | base → head | verdict |
|---|---|---|
| `#gameCanvas` | 550 × 551, **0 differing pixels** | unchanged, as intended |
| `#lensRail` | 346 × 200, **0 differing pixels** | unchanged, as intended |
| `#lensStage` | 346 × 39, **0 differing pixels** | unchanged, as intended |
| roster | 760 × 195, 19 796 pixels differ **by exactly 1 level; none by more than 1** | see below |
| `#lensControls` | 346 × 96 → 346 × **123** | **intended** — the `foil` and `drill` chips wrap to a third line |
| `#lensKeys` | 346 × 88 → 346 × **116** | **intended** — the three `input.*` pickers |

The chips themselves measure **170 × 22, 139 × 22, 136 × 22 …** in *both*
trees: the hit-area expansion adds no layout, which is the claim §3.4 makes and
this is the measurement of it.

The roster's difference is a compositing rounding of one 8-bit level — the
`position: relative` the hit expansion needs on the per-row copy control gives
that row's paint its own stacking context. Zero pixels differ by more than one
level, the region's geometry is identical (760 × 194 at the same origin in both
trees), and no rule of mine applies to the roster outside the coarse-pointer
block. It is recorded rather than hidden.

Everything else on the page below y = 446 moves because the rail column grew by
55 px, which is the two intended changes and nothing else.

### 4.4 The findings, closed and open

| finding | state |
|---|---|
| I-1 foil has no pointer path | **fixed** — `⟂ foil` chip, drilled |
| I-2 L3 drill has no pointer path | **fixed** — `⌕ drill` chip + long-press a moveset row |
| I-3 goto/near unreachable on touch and by switch | **fixed** — armable chips + long-press, drilled |
| I-4 a drag does not move a unit | **fixed** — `input.moveGesture`, drilled for parity |
| I-5 command bar off-screen on touch | **fixed** — fixed thumb-zone bar, drilled |
| I-6 horizontal overflow at 390 px | **fixed** — canvas clamp + header wrap, drilled |
| I-7 targets under the 24/44 px floors | **fixed** — hit expansion (fine) + 44 px (coarse), drilled |
| I-8 a held press means nothing | **fixed** — recogniser, drilled on both touch viewports |
| I-9 wheel over the board scrolls the page | **open**, by design — no zoom semantics exist |
| I-10 resize grip is drag-only (SC 2.5.7) | **open**, handed back — wants a size control, hidden under coarse |
| I-11 no handedness preference | **fixed** — `input.handedness`, drilled |
| I-12 focus does not follow the pointer | **no defect** — moving focus on a board click would steal `Space` |
| I-13 premove | **declined on the semantics** — the two persistent commands got their pointer path instead |

Eleven fixed, two open, one non-defect.

### 4.5 The checklist, answered

1. Primary-click completeness — **yes**, drilled in sixteen checks with no key
   pressed.
2. Gesture parity — **yes**, asserted as an equality between the click's
   selection and the drag's.
3. Modifier reachability — **yes**, `goto` and `near` arm from a chip.
4. Co-visibility — **yes** on both touch viewports; **yes** on the desktop rail
   (it was already sticky).
5. Target size — **yes**, with the lane tick's `Essential` exception named.
6. Overflow — **yes**, `scrollWidth === clientWidth` at 390 px.
7. Hover independence — **yes**; the fourteen `:hover` rules on the page are
   all border/background emphasis and none carries information (T4).
8. Held-press safety — **yes**; every long-press meaning has a chip, and no
   long-press is bound on a fine pointer.
9. Focus parity — **yes**, and deliberately *not* focus-follows-pointer.
10. One machine — **yes**: `keynav-machine.test.ts` still passes, the drag ends
    in `selectMove`, and the chips end in `lensRunAction`.

---

## Sources

1. Chess.com forums, *"Click-to-Move Causes Unwanted Premoves"* — click-to-move
   and premove interacting badly on mobile, and the request to bind premove to
   drag alone. <https://www.chess.com/forum/view/general/click-to-move-causes-unwanted-premoves>
2. Lichess preferences and forum, *"Always autopromoting to Queen, but
   preference is only when premoving"* — move method, premove and auto-promotion
   as separate switches. <https://lichess.org/forum/lichess-feedback/always-autopromoting-to-queen-but-preference-is-only-when-premoving>
3. *Premove* — Wikipedia. <https://en.wikipedia.org/wiki/Premove>
4. Chess Stack Exchange, *"Difference in Premove Limits: Lichess vs.
   Chess.com"*. <https://chess.stackexchange.com/questions/43490/difference-in-premove-limits-lichess-vs-chess-com>
5. E. Q. Yan, J. Huang, G. K. Cheung, *"Masters of Control: Behavioral Patterns
   of Simultaneous Unit Group Manipulation in StarCraft 2"*, CHI '15.
   <https://jeffhuang.com/papers/MastersOfControl_CHI15.pdf>
6. Dota 2 hotkey guidance — abilities, items, control groups and quick cast.
   <https://neznakov.ru/guides-hotkei-dota-2-en>
7. Frost Giant / Stormgate design statement — automated control groups and the
   quick macro panel as "lowering the skill floor without affecting the skill
   ceiling". <https://www.thefpsreview.com/2024/08/01/stormgate-new-rts-from-starcraft-ii-and-warcraft-iii-veterans-now-available-in-early-access-on-steam>
8. Infil, *The Fighting Game Glossary* — "Buffer Window".
   <https://glossary.infil.net/?t=Buffer+Window>
9. A. Jens, *"I wanna make a fighting game — input buffers"* — buffers, and
   negative edge as leniency. <https://andrea-jens.medium.com/i-wanna-make-a-fighting-game-a-practical-guide-for-beginners-part-6-311c51ab21c4>
10. *"Game input buffering explained: pre-input queues, coyote time and
    responsive combat"* — dropped early inputs read as "laggy controls"; the
    10-frame buffer and the 38% perfect-dodge change.
    <https://solana.garden/guides/game-input-buffering-explained/>
11. No Rest For The Wicked feedback, *"Input buffering (combat queueing) feels
    too unresponsive in dynamic situations"* — the over-long buffer, read as
    unresponsiveness. <https://forum.norestforthewicked.com/t/input-buffering-combat-queueing-feels-too-unresponsive-in-dynamic-situations/16313>
12. R. Tomida, W. Kurihara, Y. Kanematsu, K. Mikami, *"An Investigation of
    Command Input Grace Frame in Fighting Games"*, ITE 2025.
    <https://www.ite.or.jp/ken/paper/20250310cAnk/eng/>
13. W3C WAI, *Understanding SC 2.5.8 Target Size (Minimum)* (AA, WCAG 2.2).
    <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>
14. W3C WAI, *Understanding SC 2.5.5 Target Size* (AAA, WCAG 2.1).
    <https://www.w3.org/WAI/WCAG21/Understanding/target-size.html>
15. Apple HIG / Material minimums, summarised with the fingertip-area basis.
    <https://www.uiguides.com/guides/how-to-design-for-touch>
16. Android accessibility, *Touch target size* — 48 dp, and `TouchDelegate` to
    grow the touchable region without growing the view.
    <https://support.google.com/accessibility/android/answer/7101858>
17. P. Parhi, A. K. Karlson, B. B. Bederson, *"Target size study for one-handed
    thumb use on small touchscreen devices"*, Mobile HCI 2006 — 9.2 mm discrete
    / 7.6 mm serial. <https://www.semanticscholar.org/paper/7fc3a48e6ce88c56a5e5b921e1ee2e0c0e3af976>
18. Android Developers, *Pointer interactions (desktop experience)* — primary
    click completeness and Switch Access; long-press as the touch secondary
    click; drag on touch requiring a long-press first.
    <https://developer.android.com/design/ui/desktop/guides/interaction/pointer-interactions>
19. C. Fernández et al., *"Implicit detection of user handedness in touchscreen
    devices through interaction analysis"*, PeerJ CS 2021 — thumb zones and the
    handedness asymmetry in reach. <https://pmc.ncbi.nlm.nih.gov/articles/PMC8093950/>
20. A. K. Karlson, B. B. Bederson, *"Studies in One-Handed Mobile Design"*,
    Mobile HCI 2006. <https://www.semanticscholar.org/paper/b2724f942cc0a23ebc6fc2b73f7a64bb1736a744>
21. *"Tap Targets, Thumb Zones, and the 44px Lie"* — size, spacing and position
    as three separate variables. <https://www.72technologies.com/blog/tap-targets-thumb-zones-mobile-ux>
22. M. Gifford, *Touch and Pointer Accessibility Best Practices* — a keyboard
    alternative does not satisfy a pointer criterion.
    <https://mgifford.github.io/ACCESSIBILITY.md/examples/TOUCH_POINTER_ACCESSIBILITY_BEST_PRACTICES.html>
23. W3C WAI, *Understanding SC 2.5.1 Pointer Gestures*.
    <https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures>
24. W3C WAI, *Understanding SC 2.5.7 Dragging Movements*.
    <https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements>
25. W3C WAI, *F108: Failure of SC 2.5.7 due to not providing a single pointer
    method that does not require a dragging movement*.
    <https://www.w3.org/WAI/WCAG22/Techniques/failures/F108>
26. GNOME Help, *Simulate a right mouse click* (and the equivalent macOS
    Pointer Control settings) — the held primary button is already spoken for
    on the desktop. <https://help.gnome.org/users/gnome-help/gnome-help/a11y-right-click.html>
27. M. Hancock, *Improving Menu Placement Strategies for Pen Input*, UBC 2004 —
    the mirrored optimum by handedness.
    <https://www.cs.ubc.ca/labs/imager/th/2003/Hancock2004/Hancock2004.pdf>
28. P. Brandl et al., *"Occlusion-aware menu design for digital tabletops"*,
    CHI EA 2009. <https://doi.org/10.1145/1520340.1520461>
29. Psychology & Neuroscience Stack Exchange, *"Any research on
    right-hand/left-hand based preferences when interacting with an
    interface?"* — the caution against deriving layout from handedness alone.
    <https://psychology.stackexchange.com/questions/2056/>
30. B. Tognazzini, *"Keyboard vs. The Mouse, pt 1"*, AskTog (1989).
    <https://www.asktog.com/TOI/toi06KeyboardVMouse1.html>
31. D. Luu, *"The widely cited studies on mouse vs. keyboard efficiency are
    completely bogus"*. <https://danluu.com/keyboard-v-mouse>
32. R. C. Omanson, C. S. Miller, E. Young, D. Schwantes, *"Comparison of Mouse
    and Keyboard Efficiency"*, HFES 2010. <https://doi.org/10.1177/154193121005400612>
33. D. M. Lane, H. A. Napier, S. C. Peres, A. Sándor, *"Hidden Costs of
    Graphical User Interfaces: Failure to Make the Transition from Menus and
    Icon Toolbars to Keyboard Shortcuts"*.
    <https://www.ruf.rice.edu/~lane/papers/hidden_costs.pdf>
