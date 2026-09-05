# 05 — EVALUATION: the operator interface, measured

UX lens, document 5. `01-RESEARCH.md` named the principles, `02-IA-AND-CONTROLS.md`
built to them, and `04-SECONDARY-SCREENS.md` carried the same chrome across the
rest of the surface. This is the audit of what actually landed — driven as an
operator drives it, with a stopwatch, a contrast meter and a colour-vision
filter, against the page as it stands after the `ux-ia`, `ux-latency`,
`ux-secondary` and `ux-manual` merges.

Nothing here is an opinion about the design. Every finding has a number and a
picture, and every fix has a before and an after in the same units.

* **The harness**: `scripts/ux-eval.js`, four suites, against
  `src/tests/lens-walkthrough-server.ts`. Screenshots and the raw measurements
  are in `eval/` — 45 PNGs and `eval/eval-report.json`, which is the primary
  evidence and is cited by path throughout.
* **The gates**, re-run over the whole series: `npx tsc --noEmit -p .`,
  `npx eslint "src/**/*.ts"`, `npm run build:lens`,
  `npx jest --maxWorkers=2 "src/tests/lens-" "src/lobster/__tests__/lens-"
  src/tests/local-game-determinism.test.ts` (22 suites, 345 tests), and
  `scripts/lens-walkthrough.js` exiting 0 with all four drills green —
  operator, tour, scheme and the clock notch this evaluation added.

---

## 0. What the harness can and cannot see, stated first

Three limits, because a finding measured through a hole in the harness is not a
finding about the page.

**The walkthrough server sends no `controlled-snake-turn-data.`** So
`setupMoveStateForSnake` never runs with `moveEvaluations`, `moveState.moves`
is `{}` for the whole run, and **no press of `Space` can stage anything, on any
candidate, in any state the walk reaches**. The staging path — the single most
important gesture on the surface — has never been exercised in a browser. This
is how H-2 shipped and how H-15 stayed green. It is proposal **P-1**.

> **Closed on `ux-fixes`.** The harness now does what
> `team-decision-engine.emitTelemetry` does, with the same pieces:
> `buildDecisionRows` builds the rows and
> `ActiveGameManager.setBotRecommendation` publishes them, so the shipped
> `snake-turn-update` broadcast carries them. `moveState.moves` non-empty and a
> candidate under the cursor is a FAILING drill assertion now rather than a
> caveat in `report.json`, and the drill asserts the staged RECORD
> (`requestedMove`, `source: manual`) across `Space` → `U` → `Space` on a real
> snake. The harness also acks its own writes the way Firestore does, or the
> retry backstop repaints the rail forever over a move nothing will confirm.
> Every measurement above this line was taken before that, and the numbers
> stand as measured.

**The clock never runs.** `/dev/step` plays turns on demand, so
`turnExpiryTime` is never a future instant, `startTurnTimer` paints the idle
bar, and L0 — the whole of the glance layer — has been shipping unphotographed
by every gate. This evaluation drives `updateTurnClock` directly
(`eval/h04`–`h07`), and the walkthrough now does too.

**Fatality is a server verdict.** The page learns it only from
`fatal-move-confirmation-needed`, in reply to a stage it has already sent, so
"one turn from a fatal cell" is not a state an operator can be warned about
before acting. Scenario S1 is therefore run against the alarm channel the IA
built for exactly this question — the strip's `◦ n no plan` — and the consent
dialog is timed separately as S1b.

---

## 1. Heuristic evaluation

Nielsen's ten, plus the game-HUD principles of `01 §1` (P1 the 300 ms glance,
P2 one key away, P3 nothing re-orders, P4 undo over confirmation, P5 confidence
is a shape) and the pattern catalogue of `01 §2`.

Severity: **critical** = the operator's action does not happen and they are not
told · **major** = the operator is misled, or the layer's stated job is not
done · **moderate** = friction inside the turn budget · **minor** = correct but
costly.

| # | finding | severity | principle | evidence | status |
|---|---|---|---|---|---|
| **H-1** | **The stage line re-orders its units across a turn.** `stageSummary` collects in partition order, so a pinned unit leaves `members`, joins `boundedBy`, and jumps to the end of the sentence: `A → 108 · B → 119 · C → 133` became `B → 119 · C → 133 · A → 108 pinned`. L1 is read in one fixation by an eye that lands where it landed last turn, and it moved on the one turn the operator is checking their own work. | major | P3; §1.4 rule 1 ("nothing above L2 may move") | `eval/h02-stage-after-pin.png`; `heuristic → stage-order`, `stableAcrossTurn: false` | **fixed** — sorted by letter; `stableAcrossTurn: true` |
| **H-2** | **The rail's candidate click never armed `Space` for a snake.** The lookup deciding between `selectMove` (which sets `userSelectedMove`) and `lensSelectCandidate` (which does not) compares `moveState.moves[k].move` against the rail's `to`. `to` is a full-board cell index; `.move` is a numeric index for a chess piece and a **Direction string** for a snake. So it compared `'up'` against `'109'`, never hit, and `Space` did nothing — silently — on every candidate of every snake unit. §3.3 records this defect as fixed; the fix landed for pieces only. | critical | Nielsen #1 visibility, #4 consistency; §3.3's own display contract | `heuristic → rail-click-arms-space`: `armsSpace false → true`, `userSelectedMove null → "left"` | **fixed** — matched on the destination cell too |
| **H-3** | **`stageSelectedMove` refuses on four guards and says nothing on any of them.** With the cursor visibly on a candidate and the bar reading `⦿ lock Space`, the press is a no-op with no notice, no chip change and no reason. Measured with the cursor on candidate 112 of `red-A`: `userSelectedMove null`, `undoDepth 0`, `notice null`, before and after. | major | Nielsen #1, #9 (recognise and recover) | `eval/h03e-after-space.png`; `heuristic → space-precondition` | **fixed on `ux-fixes`** — `stageRefusalReason` reads the four preconditions once; a refused press writes `nothing staged — <the missing one>` to the notice region, and the same reading drives the chip's state and tone |
| **H-4** | **Nothing said what separates one moveset from another.** Rank 1 `red-A→84 · red-C→69` against the foil `red-A→84 · red-C→67` — the whole difference is one cell on one unit, unmarked, at 13 px. Worse on ranks 3–5, which clip at 113 px: every row shares its leading token, so the ellipsis ate exactly the token that differed and three rows read `red-A→108 · r…`, identical. | major | P5, #18 (contrastive explanation is what moves a decision); §2.3 | `eval/h03b-cards.png`, `eval/s2-cards.png`; `scenarios → S2`, `differingMarked false → true` | **fixed** — cards mark the differing token; walked rows lead with it and count the agreements (`red-B→134 ≡ 1`) |
| **H-5** | **The legend was drawn above the two cards** — three lines of L4 definitions between the eye and the row that is going to happen (legend y 132, rank 1 y 160). | moderate | §1.4 layer budgets; P2 | `heuristic → movesets-measured` | **fixed** — under the table; legend y 524, rank 1 y 429 |
| **H-6** | **Two lock affordances, in two grammars, on screen together.** `#lensControls` draws `⦿ lock Space pins 3 of 3` and the movesets panel draws `[Space] lock — pins 3 of 3` beneath it. §2.4 exists to end exactly this. And the chip is drawn `primary` — violet border, white ink, the loudest thing in the bar — whenever a lock affordance exists at all, including when the count beside it reads `pins 0 of 0`. | moderate | §2.4 one affordance language; Nielsen #4, #8 | `eval/h03-rail.png`, `eval/h03d-lock-zero.png`; `heuristic → movesets-measured`, `lockLine` and `lockChip` | **fixed on `ux-fixes`** — `.lens-lock` is gone; the chip is the one affordance, and `pins n of m` is drawn only where it is true (see P-2 below) |
| **H-7** | **The clock's urgent state was a hue and nothing else.** Crossing 500 ms swapped the fill's colour ramp — same height, same border, same shape. The one transition L0 exists to announce rode in the single channel `§2.5`'s own audit forbids working alone, and the one the periphery reads worst. | major | P1's peripheral rule, #10, #17; §2.5 | `eval/h06-clock-urgent.png`, `eval/a06-*-clock-urgent.png`; `heuristic → clock-urgency-channel`, `differsOnlyInHue true → false` | **fixed** — hatch, 12 px height and a warn border |
| **H-8** | **The last-safe-press notch has never drawn.** §2.1 says it is drawn "wherever `window.__lensLastSafePressMs` puts it, and nothing when nobody has set it" — and nothing in the page or in `latency.js` ever set it. Undetectable by inspection: an absent mark and a correctly absent mark are the same pixels, which is `01 §4`'s only unacceptable failure. | critical | §2.1; `01 §4` "silent degradation" | `eval/h07-clock-safe-mark.png`; walkthrough `notes.clockNotch` | **fixed** — fed from `LatencyView.read().pressSlackMs`; drill asserts it both ways |
| **H-9** | **`#latency-mount` was declared twice** — `ux-ia`'s reservation in the page header and `ux-latency`'s under the board header. `getElementById` takes the first, so the whole ladder rendered into a header flex box and was clipped to nothing. | major | Nielsen #1 | `eval/h01-idle.png` (the ladder, full width, after) | **fixed** — one mount, where the ladder draws |
| **H-10** | **The undo stack was cleared at the turn boundary with nothing said.** `↺ undo u 1 · undoes: lock — 3 pins (red-A, red-B, red-C)` became `↺ undo u nothing yet`. The rule is right; "nothing yet" is a different and untrue claim from "what you took is no longer yours to take back". | major | P4; Nielsen #1 | `eval/s3-undone.png`; `scenarios → S3`, `stackBeforeWiden`/`stackAfterOneTurn` | **fixed** — `cleared — new turn`, for that turn only |
| **H-11** | **`Ctrl+/` covers 100 % of the board.** §3.2 says as much and answers it with the rail's cheat strip; the number is recorded here because it is what makes the strip load-bearing rather than a nicety. | moderate | P2; §3.2 | `eval/h09-shortcuts-modal.png`; `heuristic → shortcuts-modal`, `coversBoardPct 100` | **open, by design** |
| **H-12** | **A second operator answers one takeover modal per unit.** Six in one evaluation run over a three-unit team. `§3.4` keeps the dialog on purpose (it is irreversible from the other operator's seat) and there is no "take the team". | moderate | Nielsen #7 efficiency; `01 §5` q9 | `eval-report.json → takeovers: 6` | **open** — proposal **P-6** |
| **H-13** | **`.lens-arrival-pulse` is a dead selector.** Nothing adds the class, `board-renderer.js` contains zero `requestAnimationFrame`, and the reduced-motion guard §2.5 claims for "the arrival pulse" therefore guards nothing. The pulse that `02 §1.6`, P3 and #11 all call for is not built. | minor | P3, #11 | `a11y → reducedMotionCanvas`, `rendererConsults: false` | **open, recorded** — proposal **P-7** |
| **H-14** | **The turn budget is re-learned as "the longest remaining time seen this turn".** A page that attaches mid-turn — a reconnect, a scrub back to now — learns a short budget and draws a full bar over a half-spent turn. | moderate | P1; `01 §4` | `play-game.html::startTurnTimer` | **fixed on `ux-fixes`** — `turnBudgetFromServer()` reads `game.timeout` off the board; the inferred value is the fallback for a board that carries none |
| **H-15** | **Two of the operator drill's five assertions could not fail.** `/undo/i.test(controls)` matches the chip's own label whatever happened; the pin step was saved only by `!/nothing yet/`, which is absent whenever the stack is non-empty for any reason — including the multi-unit lock at `17-locked`, which runs immediately before the drill. `d1-pin` photographed a pin that had not happened, over a harness that cannot stage at all (§0). | major | the gate's own contract (`04 §4.2`: "a gate, not a slideshow") | walkthrough `notes.pinStageable` | **fixed** — both assertions read `lensUndoStack.length` across the press |
| **H-16** | **The band never draws in this scenario.** §2.3's headline L2 change — "a bracket draws as a band" — needs a priced row, and every retained row the harness produces is unpriced, so `bandHTML` returns nothing and all five rows read `—`. Honest (Law A), and it means the band is unexercised by every gate and every screenshot the project has. | moderate | §2.3; evidence hygiene | `heuristic → movesets-measured`, `band: false` on every row | **open** — proposal **P-9** |
| **H-17** | **The rail scrolls.** 1116 px of content in a 692 px column at 1280×720. Nothing above L2 is below the fold and the control bar is not either, so the cost falls on L3/L4 — but the operator's answer to "what else is in this list" is a scroll, not a key. | minor | P2 | `density`, `railScrollH`/`railVisibleH` | **open** |

Two claims of §2 were checked and **hold**: hover never commits the cursor
(T4), and the stage line is a draw call on the transcript rather than something
the page computes, so a replayed turn says the same sentence.

---

## 2. The timed scenarios

Playwright, with the clock started at the operator's own input and stopped at
the first animation frame after the DOM carries the answer — a `MutationObserver`
armed against a **baseline**, so a mark that reads 0.2 ms because the text
already matched is not recorded as a measurement. Presses and clicks ride
alongside, because a fast answer that costs six keys is not a fast answer.

*Time-to-first-relevant-paint* is the fixation proxy: when the pixel that
answers the operator is first on screen. It is a lower bound on a fixation, not
a substitute for one — no eye tracker was involved.

| scenario | first relevant paint | total | keys | clicks | what it says |
|---|---|---|---|---|---|
| **S1** — a unit's plan state changes; the operator sees it, then pins a chosen move | **59.5 ms** from `board-update` to the L1 strip carrying the count | 15.5 s to intervene | 1 | 2 | **L1 answers inside one frame.** The glance layer does its job: `3 units · ● 1 staged · ~ 2 planned · 🔒 1 fixed` is on screen ~60 ms after the board, well inside P1's 300 ms. The intervention is 2 clicks (roster row, candidate) + 1 key, and the seconds are the harness's own settle waits, not the operator's. |
| **S1b** — the server refuses a certain-death move | **2.0 ms** to raise the consent dialog | — | 1 (`Enter`) | 0 | The one dialog `§3.4` keeps on purpose, and the cheapest gesture on the surface. It now moves focus into itself and announces (A-2). |
| **S2** — the top two candidates differ only in the foil | **0 ms** | — | **0** | 0 | **The IA's biggest win.** The foil is a full-size card without being asked for; before `ux-ia` it cost `F`. What it did *not* do was say what separates the pair — `red-A→84 · red-C→69` against `red-A→84 · red-C→67`, `differingCount: 1`, `differingMarked: false` (H-4). Now marked: the token, not the row. `F` still costs 1 key and 706 ms to put the difference on the board, where it is spatial. |
| **S3a** — undo a lock, in the turn it was taken | 13.9 ms to acknowledge | 763 ms | 1 (`u`) | — | Undo is as cheap as `§3.4` promises. The lock itself is 2 keys and 1.8 s, because a multi-unit lock arms first — by design, and the arm paints in 9 ms. |
| **S3b** — undo a lock **after a peer's widen** | 16.3 ms | 975 ms | 4 total | 2 | **The undo is gone, and this is correct.** A widen only arrives during a decision, so it crosses a turn boundary, and `§3.4` clears the stack there on purpose. What was wrong is that it said nothing (H-10). The banner itself is right: `⚑ Timer released red-A — cluster is now 2 units. auto 6s [Show] · the rail below is stale @ seq 22` — held behind one gesture, nothing re-ordered. |
| **S4** — switch key scheme mid-turn | **42 ms** to rewrite the strip | 538 ms | 0 | 1 | The strip and the modal render from one keymap table, so the switch rewrites both, and the new key really drives the rail (712 ms to step a row with `j`). It costs a **mouse trip**: there is no key for the picker, which is defensible for a preference and worth knowing on a 500 ms clock. Until this evaluation it could not be done from the keyboard at all (A-6). |

The two numbers worth carrying forward: **L1 lands in one frame** (59.5 ms
against a 500 ms turn), and **the contrastive pair now costs nothing** — the
change `01 §3` ranked third, delivered and measurable.

---

## 3. Accessibility

### A-1 — contrast (WCAG 1.4.3, AA)

Every element with its own visible text, against the background that is
actually **painted** — the composited ancestor stack, plus any `opacity` on the
way up, because `.lens-aff-off` was `opacity: .45` and its ratio on screen was
not the one its `color` claimed.

**26 of 83 distinct pairs failed. Now 7 of 85, and every one that remains is
structural or exempt.**

The two worst were the two that mattered most:

* `pins n of m` — what `§1.2` calls "what makes a determination checkable, and
  what makes a dialog unnecessary" — at **2.00 : 1**, the least legible text in
  the control bar, because the chip it sits in was faded;
* `⛨ hold H pieces only` at **2.70 : 1**: a control that says why it cannot act
  has to be readable to say it.

Then `#pingDisplay`, `.lens-lane-name` and `#noSelectionMsg` at 2.50;
`.lens-legend` at 3.49; `#timerDisplay.idle` — the checkable read of the
deadline — at 3.56; `.lens-sub`, `.lens-provenance`, `.lens-lane-foot` at 4.05;
and `.lens-cheat` / `.lens-scheme`, the strip that exists so the operator does
not have to open the modal, at 4.21. The dead roster row had the same shape of
bug: `opacity: 0.45` took `(dead)` — the word explaining why the row is quiet —
to 2.4 : 1, with the grayscale already carrying that reading on its own.

The roster's `♥` is **text** at 11 px and owes 4.5 : 1, which the health bar's
`#43a047` misses at 4.35. It has `healthTextColor` now, the same three steps
lifted just far enough to read, kept beside `healthBarColor` so the two cannot
drift; the **bar** keeps its ramp, because a bar is a non-text mark and owes
3 : 1.

**What remains, and why:**

| pair | ratio | why it is not fixed here |
|---|---|---|
| operator name badges (`rgb(142,7,70)`, `rgb(10,126,58)`, `rgb(255,77,109)`) | 1.55–4.47 | arbitrary per-operator hues — nobody chose them against this ground. Proposal **P-4**. |
| the `#888888` unit-colour fallback | 4.05 | same family; a unit with no colour gets grey on grey. |
| `#navNextBtn` / `#navEndBtn` when disabled | 2.20 | WCAG 1.4.3 exempts inactive components. |
| `.lat-num` at `#6d6d6d` and `#e0685a` | 2.77, 4.30 | `src/web/latency.js`, owned by `ux-latency`. Handed back as **P-10**. |

### A-2 — keyboard operation (WCAG 2.1.1, 2.1.2, 2.4.7, 4.1.2)

**A Tab walk from the top of the document found zero tab stops.** Not a short
order, not one missing a ring — none. 43 focusable elements in the DOM and no
way to reach `Submit All`, the turn slider, the scheme picker, the lane's
ticks, or a dialog's own buttons; and no way out of the page either.

    if (e.key === 'Tab') { e.preventDefault(); cycleOwnedSnakes(); return; }

Unconditional, and it never read `shiftKey`, so `Shift+Tab` was cycling units
too — occupying the one key every browser uses to get back into a focus order.

Three more things were reachable in principle and still could not be operated:

* **the pickers** — real `<button>`s, focusable, ringed, and bound on
  `pointerdown` alone. A keyboard activation of a button dispatches `click` and
  never `pointerdown`, so they looked operable, rang when focused, and did
  nothing when pressed (`a11y → keyboardActivation`, `activated: false`). The
  evaluation harness found this by accident and then measured it on purpose.
* **the control chips** — `§3.3` makes them the mouse-first operator's path to
  every action, drawn as bare `<span>`s with a pointer handler: no role, no
  name, no focus.
* **the two consent dialogs** — the only modals on the surface, and the only
  ones with no `role`, no `aria-modal` and no focus move. Opening one left
  `activeElement` on `BODY` (`heuristic → fatal-dialog`): nothing announced,
  and nothing focused inside the thing now covering the board.
  `#shortcutsOverlay` already had the pattern.

**Fixed.** Tab still cycles units while nothing is focused — the hot path the
binding exists for, and the state the page is in until someone deliberately
enters the order. `Shift+Tab` is the door in; once focus is on anything, Tab is
focus movement again.

| | before | after |
|---|---|---|
| tab stops | **0** | **62** |
| stops with no visible focus ring | — | **0** |
| pickers activated from the keyboard | no | yes |
| actionable chips with a role and focus | no | yes (`role="button"`, Enter/Space) |
| consent dialogs announced, focus moved | no | `role="alertdialog"`, focus to the primary button, returned on close |

The chips' keydown listens on the panel and stops there, because `Space` is the
lock key globally and an operator who has tabbed onto `undo` and pressed Space
meant `undo`.

### A-3 — colour vision (protanopia, deuteranopia)

`feColorMatrix` over the whole document; the board, the cards, the control bar
and the clock's urgent ramp in each: `eval/a01`–`a06`.

**§2.5's audit holds.** Under deuteranopia the board's hues collapse — violet
reads as blue, the green `goto` cross and the red hazards both go yellow — and
every mark keeps its own form: the lens arrow filled and one weight heavier,
the implied arrow hollow and dashed, the foil dashed with its own Δ, the
agreement ring a ring, the tethers line-art, the controlled units dashed on the
body outline. The cards separate on `▸`/`◇`, the words `WOULD BE STAGED` and
`FOIL`, and a solid-versus-dashed rule, before a hue is spent.

Two things the simulation surfaced that hue was carrying alone:

* the clock's urgent ramp (**H-7**) — now hatched and taller;
* the operator name badges, which are hue and nothing else and are also the
  contrast failures of A-1. `§2.5` already records "which operator staged an
  arrow is hue only" as deferred to the multi-operator work; the badges belong
  with it. Proposal **P-4**.

The new `.lens-move-diff` mark was chosen against this constraint: weight,
white ink and an underline, no hue, because violet and teal are already spent
on rank and foil.

### A-4 — motion (`prefers-reduced-motion`)

Measured in a context with the preference set. The clock's fill, the connection
pill and the header countdown all report `transition-duration: 0s`; `chrome.css`
zeroes every animation and transition on the secondary screens and kills the
badge's pulse; `latency.js` turns off `lat-pulse`; `tour.js` turns off its
spotlight transitions. Nothing on the surface flashes above 3 Hz.

One gap, recorded rather than fixed: **`.lens-arrival-pulse` has no users**
(H-13). The guard is real; the animation it guards was never built, and
`board-renderer.js` has no animation loop at all. Deleting the guard would make
it harder to build the pulse `02 §1.6` still wants; building the pulse is
proposal **P-7**.

### A-5 — focus visibility (WCAG 2.4.7, 2.4.13)

All 62 tab stops paint a visible indicator — `2px solid #fff` with a 1 px
offset in the rail, the browser default elsewhere; none rely on colour change
alone. `eval/a07-focus-chip.png`, `eval/a08-focus-scheme.png`.

The moveset and candidate rows keep `tabindex="-1"` on purpose: they are walked
with `[`/`]`, not with Tab, and their `:focus-visible` rules are live for the
programmatic focus the cursor machine gives them.

---

## 4. Density and legibility

1280×720 and 1920×1080, all three densities. **No horizontal overflow at any
combination**, nothing above L2 below the fold, and the control bar on screen
at both sizes.

`§2.5` calls density "one number in three steps … a scale, not a second
design". It was not one. `--lens-size` moved 11/12/13 px and almost nothing
read it: forty-odd text nodes in the rail hardcoded 9, 10, 11 and 12 px, and
they were exactly the ones an operator on a 27" screen at arm's length wants
bigger — the legend, the cheat strip, the pickers, the lane names, the
list-source line, the `unless` clause, the row tags, the table itself.

| | compact | default | roomy |
|---|---|---|---|
| `--lens-size` | 11 px | 12 px | 13 px |
| smallest type — **before** | 10 px | 10 px | 10 px |
| smallest type — **after** | 9 px | 9 px | 10 px |
| rail height — **before** | 1047 px | 1072 px | 1094 px (a 2.4 % span) |
| rail height — **after** | 1061 px | 1116 px | 1223 px (a **14 %** span) |

A 9 px floor is applied to the two- and three-steps-down classes so `compact`
scales without going under what a screen at arm's length can resolve.

**The board does not use the room.** The canvas is 550 px at 1280×720 and 550 px
at 1920×1080; the extra 640 px of viewport becomes margin. The rail is 380 px in
both. The resize grip can drag the board, but nothing does it for the operator,
and the board is where P1 says the eye is. Proposal **P-5**.

At 1280×720 the rail scrolls (1116 px into 692 px). The layers hold — L0, L1,
L2 and the control bar are all above the fold — so the cost is that L3/L4 are a
scroll rather than a key (**H-17**).

---

## 5. What was fixed, and what is handed back

### Fixed here, one commit each, every gate green

| commit | finding |
|---|---|
| *Make the rail's candidate click arm `Space`…* | H-2 |
| *Stop the operator drill passing on an undo it did not take* | H-15 |
| *Keep the stage line's units in one order…* | H-1 |
| *Say what separates a moveset from the one being read* | H-4 |
| *Raise every quiet grey in the rail above 4.5 : 1* | A-1 |
| *Give the page a keyboard focus order at all…* | A-2, A-5, A-6 |
| *One latency mount, and a last-safe-press notch that actually draws* | H-8, H-9 |
| *Make urgency a shape, and density a scale…* | H-7, D-1 |
| *Say when the undo stack went, and put the legend under the table…* | H-10, H-5 |

The walkthrough also learned to answer the takeover dialog, so it is a gate on
the second run against a server and not only the first.

### Handed back, ranked

Cost: **S** ≈ hours · **M** ≈ a day · **L** ≈ multi-day.

| # | proposal | why | cost |
|---|---|---|---|
| **P-1** | **Teach the walkthrough server to send `controlled-snake-turn-data`**, so `moveState.moves` is populated and the drill can assert a real staged move. | §0: the single most important gesture on the surface has never been exercised in a browser, and that is how H-2 shipped behind a comment saying it was fixed. Everything else on this list is smaller than this. | M |
| **P-2** | **Resolve the two lock affordances into one, and decide what `pins 0 of n` means.** Drop `.lens-lock` in favour of the chip, and settle whether `Space` at a zero count stages the focused candidate (in which case the note is wrong) or does nothing (in which case the chip should not be `primary`). | H-6. Not fixed here because the answer is a decision about what `Space` means, not a rendering choice, and guessing it would make the bar lie in a new way. | S |
| **P-3** | **`stageSelectedMove` should say why it refused** — one line in the notice region naming the missing precondition. | H-3. The four silent guards are the same class of defect as H-2 and will hide the next one. | S |
| **P-4** | **Operator colours from a contrast-checked, CVD-safe set** (Okabe–Ito, `01 §2` #17), and a per-operator **mark** rather than a per-operator hue. | A-1 and A-3: three of the six remaining contrast failures are operator badges, at 1.55 : 1 at worst. `§2.5` already defers the arrow's operator mark to the multi-operator work; this is the same decision. | M |
| **P-5** | **Let the board take the viewport's width.** 550 px on a 1920 px screen, with the difference spent on margin. | §4; P1 puts the eye on the board. | S–M |
| **P-6** | **"Take the team" beside "take this unit"** in the takeover dialog. | H-12: six modals to pick up a three-unit team. | S |
| **P-7** | **Build the arrival pulse, or delete the guard.** | H-13: `02 §1.6`, P3 and `01 §2` #11 all call for it; the reduced-motion rule for it exists and there is nothing to reduce. | S |
| **P-8** | **The turn budget should come from the server**, not be inferred as the longest remaining time seen. | H-14: a mid-turn attach draws a full bar over a half-spent turn, which is a lie in the one channel P1 says is read without a fixation. | S |
| **P-9** | **A scenario with priced retained rows**, so the band, the incumbent tick and the open-end arrowhead are exercised by a gate and photographed at least once. | H-16: §2.3's headline L2 change is unwitnessed. | S |
| **P-10** | **`.lat-num`'s `#6d6d6d` and `#e0685a` are below AA** (2.77 : 1 and 4.30 : 1) on the ladder's own ground. | `src/web/latency.js`, owned by `ux-latency` — not touched here. | S |

### Status of the ranked list, after `ux-fixes`

Four landed, one commit each, every gate green — `npx tsc --noEmit -p .`,
`npx eslint "src/**/*.ts"`, `npm run build:lens`, `npx jest --maxWorkers=2
"src/tests/lens-" "src/lobster/__tests__/lens-"
src/tests/local-game-determinism.test.ts` (22 suites, 353 tests) and
`scripts/lens-walkthrough.js` exiting 0 with every drill green. **The lens
never moved a decision**: nothing here touches the kernel, the view model's
frame, or what any of them stage.

| # | status |
|---|---|
| **P-1** | **landed.** The harness publishes production-shaped per-unit turn data through `setBotRecommendation`, and acks its own staged writes as Firestore does. The operator drill asserts a real stage → undo → stage → lock → widen → undo round trip on a snake — eleven checks, two of which could not pass on an empty harness. |
| **P-2** | **landed.** One affordance. The movesets panel's `[Space] lock — pins n of m` line and its CSS are gone; the chip reads the same `affordance.lock` transcript call, which is untouched. `pins 0 of n` settled the way the code already answered it: `Space` stages the candidate under the cursor — the one-unit lock §3.4 calls "what `Space` has always done" — and `pins n of m` is the reach of the MOVESET lock, so the NOTE was wrong, not the key. The count is drawn only where it is true; elsewhere the chip says what `Space` will do or why it will not, and it is `primary` only when the next press does something. The drill counts the affordances. |
| **P-3** | **landed.** `stageRefusalReason` is the one reading of `stageSelectedMove`'s four guards; a refused press puts one line in the notice region naming the missing precondition, and the drill presses `Space` in the state the undo before it leaves and asserts the sentence is there. |
| **P-8** | **landed.** The budget is `game.timeout` off the board — the field `recordTurnArrival` computes the deadline from — not the longest remaining time seen. The clock drill puts the page in the mid-turn-attach state and asserts the bar reads a third rather than full. |
| **P-4** | **handed back — needs a shared decision, not a local one.** The operator palette is `src/shared/player-palette.ts` (`colorForArrivalIndex`), which the server assigns from and the board, the badges, the arrows and history all read. The exact need: an Okabe–Ito ordering in that one function, contrast-checked against **both** grounds it lands on (the rail's `#1a1a1a` and the board's cells), **plus** a per-operator MARK — `§2.5` already defers "which operator staged an arrow is hue only" to the multi-operator work and this is the same decision. Changing the hues alone would repaint every historical screenshot and still leave the arrow hue-only. |
| **P-5** | **handed back — needs a layout decision this branch may not take alone.** The canvas is 550 px at both viewport widths and the rail 380 px, so 640 px of a 1920 px screen is margin. The need is a rule for how the two share the width (the board takes the remainder above some rail minimum, or a stored grip position wins), and it lands in `play-game.html`'s layout, which `ux-perf-2` is also holding. Sized wrong it costs the property `04 §4` measures — no horizontal overflow at any of six size × density combinations — so it wants its own before/after in those units. |
| **P-6** | **handed back — needs a server answer first.** "Take the team" is one gesture over N units, and `select-snake` is per unit with its own contest/revoke reply per unit (`websocket-server.ts` `case 'select-snake'`). Looping it client-side would send N takeovers and raise N `selection-revoked` messages at the other operator — six modals traded for six revocations. The exact need: a `select-team` envelope that resolves the whole set atomically and answers once, with one `blockedBy` list; until that exists the dialog cannot honestly offer the button. |
| **P-7** | **handed back — needs a spec before it needs code.** `.lens-arrival-pulse` still has no users and `board-renderer.js` still has no animation loop. The guard is correct and cheap; what is missing is the design, and it is not a detail: P3 says **nothing above L2 may move**, so a pulse has to name exactly what pulses (the arrived unit, the changed unit, the board edge), on which event, for how long, and how it reads under `prefers-reduced-motion` other than "off". Building it to a guess would put new motion on the one surface the principle protects. The guard stays until that is written. |
| **P-9** | **handed back — needs the kernel to price the rows.** `bandHTML` draws nothing because every retained row this harness produces is unpriced, and a row's price is the fold's bound on it, not something the harness can supply. The exact need: a walkthrough scenario whose decision reaches the depth at which `evaluate.explainPlan` returns bounds for the RETAINED rows (not only for the staged one), or a kernel option that explains the retained set on demand. Feeding the panel a number the search did not take would be the old table's lie in a new place (Law A). |
| **P-10** | **handed back — not this branch's file.** `.lat-num`'s `#6d6d6d` (2.77 : 1) and `#e0685a` (4.30 : 1) are in `src/web/latency.js`, owned by `ux-latency` / `ux-perf-2`. The need is two hex values lifted to 4.5 : 1 against `#1a1a1a`, in that file, with the ladder's own before/after. |

One finding outside the ranked list also closed here: `08 §1.4`'s unbounded
`turnTimeline` (one board snapshot per turn, 1.48 KB/turn) now keeps a
64-turn window of the rows the page minted itself, releases the rest, and
refetches a released turn rather than substituting a floor row for it.
`scripts/lens-soak.js` became a gate over it.

---

### Open questions this evaluation could not answer

`01 §5` asked eleven; three now have partial answers and the rest still need a
human in the seat.

* **q4, "do you read the moveset list, or only rank 1?"** — as drawn before
  H-4, you could not have: ranks 3–5 were distinguishable only in the part the
  ellipsis cut off. The question is now askable.
* **q10, colour vision and motion** — the audit passes on shape (A-3) and the
  motion contract holds (A-4). Screen and viewing distance are answered by the
  density scale, which is now real (§4).
* **q1, the real turn budget** — still unanswered, and H-14 is downstream of
  it.

Everything in `01 §5` about *what an operator actually does in the seat* —
whether they watch or intervene, whether `Space` is pressed in anger, whether a
pin has ever been regretted, whether a second operator ever plays — remains
open. This document measured the interface. It did not measure an operator.
