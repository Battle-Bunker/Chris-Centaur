# 10 — WALKTHROUGH: the lens, in a browser

DECISION-LENS, document 10. Documents 1–9 were written by reading code. This
one was written by **looking at the running page**: a real decision, driven by
the shipped kernel, delivered over the shipped socket, rendered by the shipped
`play-game.html`, walked by a Chromium through every cursor-machine state
`02-INSPECTION-UI.md` §1.3 names. Every screenshot under `walkthrough/` is a
frame of that session; every verdict below is about what is in the picture.

Written on `lens-walk`, from `a417e05`. The design is `02-INSPECTION-UI.md`,
the numbers are `07-MEASURED.md`, the two audits are `09-AUDIT.md`.

---

## 0. How the game was driven

There was no way to look at the lens before this. `src/index.ts` serves the
page, but games arrive **only** over the TacticToes Firebase transport, so
every gate that has ever exercised the lens compared frames and transcripts
inside a jest process. Two files close that:

**`src/tests/lens-walkthrough-server.ts`** — the smallest dev entry that puts
the shipped page in front of a real decision. What is real in it:

| piece | what runs |
|---|---|
| the page | `src/web/play-game.html` off the shipped static mount, at `/game/:id` |
| the socket | the real `GameWebSocketServer` — `subscribe-game`, `board-update`, `lens-frames`, the mid-turn anchor replay, and all four inbound lens envelopes |
| the game | `buildBoard(MIXED_SCENARIO)` + `settleTurn` from `src/tests/local-game.ts` — three teams, snakes and pieces, the vendored rules |
| the decision | `makeSubstrate` → `rigFor` → `LobsterKernel.decide` under the node clock, exactly as `src/lens/kernel/record.ts` runs it |
| the log | `ActiveGameManager.lensDecision(gameId, turn, …)` — the seam `firebase-interface.ts` binds. The manager is the one `seq` writer: it opens the turn with its own `board.arrived`, stamps every kernel frame, writes `decision.begin` / `decision.end`, and broadcasts |
| the turn's end | `ActiveGameManager.applyResolvedMoves`, so `turn.resolved` is the shipped row |

What is stubbed is Postgres and Firestore only. The turn log lives in a list
and the four read routes the replay path calls (`/api/logs/games`,
`/api/games/:id/turns`, `/api/logs`, `/api/logs/commands`) are served off it —
**including the anchor's settlement being dropped on the way to storage**,
because that is what `ActiveGameManager.logStoredEvent` does and it is a
property the walk must see rather than one it may paper over. `/api/logs` is
encoded with `lensStringify`, as `turn_events.payload` is.

A **synthetic operator** is scripted on emission count, not on the clock: it
opens a conditional list on the cluster at every emission, drills the leader
once (so the turn's log holds a breakdown), pins its first unit onto whatever
the bot has just staged for it at emission 2, and releases that pin at emission
4 — which is the owner's headline reactive case, arriving while a browser is
looking at it.

**`scripts/lens-walkthrough.js`** — the Chromium driver. It enters as an
operator through the real login gate, plays turns with `POST /dev/step`, walks
the states, and writes `walkthrough/report.json` beside the PNGs: console
errors, failed requests, page exceptions, horizontal overflow, and the rail's
own text at every stop, because a screenshot cannot show a console and a
verdict needs the words as well as the pixels.

```
npx ts-node --transpile-only src/tests/lens-walkthrough-server.ts --port=5055 &
node scripts/lens-walkthrough.js --port=5055 --out=docs/design/decision-lens/walkthrough
# /game/lens-walk         — live
# /game/lens-walk-replay  — the same log, through the replay path
```

Board: `mixed` at seed 1 — red (snake A, pawn B, knight C) against blue and
green, 11×11, six food. Budget 550 work units per decision under the node
clock, so the session is reproducible.

---

## 1. The walk

Every heading is a state `02` §1.3 or §2.2 names. **See** is what is in the
picture. **Design** is the clause it is answerable to. **Verdict** is the
difference. Where a defect was found it is marked and the screenshot shows the
**fixed** state, because the fixes are on this branch; §3 lists them with the
before-text the walk recorded.

### 1.1 `NONE` — the idle cursor · `01-idle.png`

**See.** A live board at turn 3, the rail to its right: `No unit focused —
click one, or Tab.` over `4 emissions at seq 18 — no unit is focused`, the
provenance line `lobster-local · walkthrough/mixed · eval — · e17 · 0q`, the
lane below it, and its badge `LIVE · seq 27 · observed · walkthrough/mixed`. A
widen banner from the turn that just landed sits above the rail.

**Design.** §3.7's rail with the focus panel's empty state; §2.2's `live-head`
badge; 09 §A3's honest emptiness naming which of four causes is in play.

**Verdict.** Correct, and it took two fixes to get here. Before them the badge
read `⏸ SCRUBBED · seq 27 · read-only` on a live head and the rail sat
permanently on `nothing staged yet — no kernel emission yet at seq 0` (§3, F1).
`eval —` is drawn rather than blank (§3, F7), and it is no longer what the
footer reads: `digestOf` now joins the evaluator's own identity, so the line
ends `eval:7f5b86c4` (§4, O2).

### 1.2 Hover a unit on the board · `02-hover-unit.png`

**See.** The pointer over a unit; its tag calls up and the neighbouring tags
step aside. The rail does not move.

**Design.** T4 — *"Hover never commits the cursor: the board is a place to
look, and a lens that re-ranks under the pointer is unusable."*

**Verdict.** Correct. Hover is the shipped tag behaviour and the lens is
untouched by it.

### 1.3 `CANDIDATE` — a focused unit · `03-focus-unit.png`, `03b-rail.png`, `03c-board.png`

**See.** `A snake · hp 98 · wt 3 · cluster 0(2) · free · 2 of 2 free`;
`CANDIDATES · 3 · priced here · scored as best-of-cluster` with the incumbent
marked `▸` and two more graded `·` (unpriced) and `~` (estimated); a MOVESETS
table with the legend under its head; `[Space] lock — pins 2 of 2`. On the
board: violet cluster chips on the member head plates, the interior wash, a
filled violet arrow on the focused unit's candidate and a hollow violet arrow
on the member that would move differently.

**Design.** Law D — focus auto-advances to the incumbent and the moveset panel
is never empty for a focused unit. §3.3 chips, tethers, wash. §3.4's draw
order. §3.7's `scored as best-of-α` and never a bare number.

**Verdict.** Correct on every clause. The grades are drawn, the header says
what the list is (09 §B7), and only disagreement draws.

### 1.4 Hover a moveset row · `04-hover-moveset.png`

**See.** Byte-identical to `03b-rail.png` (`md5` equal).

**Design.** T6's hover is not in the transition table at all; T4's rule
generalises — hover never commits the cursor.

**Verdict.** Correct by construction, and worth stating: the rail's rows carry
**no pointer handlers and no hover behaviour at all** — hover is a place to
look until something is pressed. What they lacked when this walk first ran was
a way to say WHICH row was pressed, so a click did nothing either, against T3
and T6 both listing "click a candidate cell" / "click a row" as sources. The
markup now names the target (`data-lens-candidate`, `data-lens-moveset`) and
`#lensRail` binds it; the walk still drives the cursor from the keyboard, so
the evidence is the markup and its gate rather than a shot. Closed (§4, O5).

### 1.5 Walking the list — `]` · `05-moveset-next.png`, `05b-board.png`

**See.** Byte-identical to `03b-rail.png` again.

**Design.** T6 — the cursor moves to the next moveset, the board lights up the
members that would move differently.

**Verdict.** **Not a defect, and the most important finding of the walk.** The
conditional list has exactly **one row** — `▸4 -51.6 ⌈93.0⌉` — so `]` has
nowhere to go. This is `rowsFor`'s A2 fallback doing what it was written to do:
`07-MEASURED.md` §1 records **0 conditional frames in 180 bot-only decisions**,
so the list is the cluster's retained reservoir rows restricted to those that
assign this candidate to this unit, and on this build that is usually one row.
The MOVESETS panel is therefore a *list of one* in every live state this walk
reached. Nothing is wrong with the code; the operator's experience of "the
panel that is the whole point of the lens" is one row and two inert keys, and
that is a fact about the reservoir, not about the UI.

What WAS wrong with the UI is that it said none of this. The head now names
which of the two lists it is drawing and how many rows the reservoir retained
before the restriction, so the shortness is a fact the operator can check
rather than a table that looks broken (§4, O1). The reservoir itself is
unchanged and the cause is still upstream, in the kernel.

### 1.6 The breakdown drill — `B` · `06-breakdown.png`, `06b-breakdown-panel.png`, `16b-widen-accepted.png`

**See.** On a row the decision drilled, the panel draws:

```
BREAKDOWN · lobster-territory
red-A   -0.03…0.00   vs 109   material 0.00…0.00 · reach -0.01…0.00
red-B  -11.51…0.00   vs 131   material -10.00…0.00 · reach 0.00…0.00
red-C   -0.14…0.00   vs 111   material 0.00…0.00 · reach 0.00…0.00
joint  -61.85…∞               [why?]
```

On a row it did not, `[B] to price this row`.

**Design.** §3.7 — per member: contribution and top terms, against the
reference action it was priced against; **the joint row is mandatory** whenever
it is non-zero, and if zero, say zero and offer `[why?]`.

**Verdict.** Correct, and this is 09 §A6's fix arriving on screen for the first
time — the residual row has never been in a browser before. `…∞` is the
lattice top and is now named rather than printed as `—` (§3, F8). `[B] to price
this row` is the honest pending state: the drill asks the socket, and off a
running decision the port answers a typed refusal.

### 1.7 The `unless` cell and the depth ink · `07-movesets-panel.png`

**See.** A head that says which list this is —
`MOVESETS · cluster 0 · 2 of 2 free · seq 30`, then *"no conditional was
answered — 1 of 5 retained rows play this candidate, so `[` and `]` have
nowhere to go"* — the legend `⌈w⌉ bracket width · h<n> horizon proved at ·
Q loud replies · unless what this row is betting on`, one row
`▸4 · -51.6 ⌈93.0⌉ · h1 · Q=0/33 · — · the evaluator residue, blue-A resolve
against us · 82.9 at stake · red-A→94 · red-C→118`, and under it the foil line
*"no runner-up — only 1 of 5 retained rows plays this candidate"*.

**Design.** §3.4/§2 of `08-DEPTH-VERDICT`: the absence of depth is drawn, never
omitted, and drawn *with its reason* (09 §C1's `Q`); the threat/opportunity map
is one clause per row (09 §B3).

**Verdict.** Correct. `h1` is honest on a build where no row deepens, `Q=0/33`
is the loud reading on the leader's own plan, and the `unless` clause names the
units the row is betting on and prices the bet. The assignment cell used to
break inside a unit id at 380 px — `red-` / `A→94` — and no longer does (§3,
F6). The head and the foil line were both added after this walk first ran, when
a table of one row under a head that said only `MOVESETS` turned out to be the
panel's worst reading: §4, O1 and O3.

### 1.8 The contrastive foil — `F` · `08-foil.png`, `08b-foil-board.png`

**See.** Byte-identical to `03b-rail.png`. No teal arrow, and where a
`foil #n · margin …` line would go, its absence with the reason for it:
*"no runner-up — only 1 of 5 retained rows plays this candidate"*.

**Design.** §3.5 — *"Panel side: **always visible** as one line under the
moveset table."*

**Verdict.** Correct now; it was not when this walk first ran. The line was
drawn only where a rank 2 existed, and §1.5's list of one has no rank 2 — so
the *"highest-value cheap signal on the surface"* was absent in the ordinary
case and its absence was silent, which reads as "there is nothing to compare"
rather than "the list came up short". The absence is now drawn with its cause,
the same move the depth cell makes with `Q=0/33`. Closed (§4, O3).

### 1.9 The timeline lane · `09-lane.png`, `10-lane-expanded.png`

**See.** Five lanes — `anchor` (a tick at each end of the turn), `kernel`
(dense), `operator` (four solid ticks), `staging` and `advice` (empty) — over
`seq 30 · 31 / 31 · LIVE · seq 30 · observed · walkthrough/mixed`. Expanding
the lane brings up a fifth operator tick the collapsed lane does not draw: a
hollow `○` at `+149ms`, ahead of the solid ones.

**Design.** §2.2 — ticks are clickable, the playhead snaps to events, operator
ticks carry the operator's colour, attention ticks are hollow and hidden until
expanded.

**Verdict.** The lane draws, its ticks scrub, and both channels §2.2 asks for
are now on it. Three gaps when this walk first ran, none of them the lane's own
fault, and all three closed:

* Ticks were being drawn **on top of the lane's name** — `left: 0%` was the
  start of the row rather than the start of the turn, so `board.arrived` sat
  squarely on the word `kernel`. Fixed (§3, F5).
* Expanding showed nothing new, because nothing emitted an attention tick: no
  producer wrote `payload.hover`, so §2.1's `operator.attention` channel was not
  in the log at all. The look DOES reach the kernel, in a shape §2.1 did not
  name — a TENTATIVE pin, a hint the search may speculate on and never a
  constraint — and once that gesture became a row the reader had something to
  read. `09-lane.png` and `10-lane-expanded.png` used to be byte-identical and
  are not. Closed (§4, O4).
* The operator ticks were the kernel's own `operator` frames, titled
  `operator · seq 11 · +149.62ms` — the kind and the time and nothing else, no
  colour — because **nothing wrote a `pin` or `unpin` turn event** anywhere in
  the repository. They now read `pin(red-A) · seq 9 · +149.57ms` and
  `unpin(red-A) · seq 19 · +263.63ms` in the operator's colour. This was 09 §C4
  with a cause. Closed (§4, O6).

The `staging` lane is empty in this session because the harness stages through
the kernel rather than through `setIntent`; that is the harness, not the page.

### 1.10 `live-scrub` · `11-scrub-anchor.png`, `12-scrub-emission.png`

**See.** `Home` puts the playhead on the anchor: badge `⏸ SCRUBBED · seq 0 ·
read-only`, rail `nothing staged yet — no kernel emission yet at seq 0`, board
ink desaturated. `Shift+.` twice lands on `seq 8`: `CANDIDATES · 1` and
`nothing retained for red-A at this candidate — 2 emissions by seq 8 and no
priced restriction plays it`.

**Design.** §2.2's third mode, loud; 09 §A3's four distinguishable
emptinesses.

**Verdict.** Correct, and the empty states are telling three of the four causes
apart in one session (no emission yet; nothing retained; a unit that is a
constant, §1.11). Determinations re-label to `[N] return to now and lock`.

### 1.11 `pinned` — Rule E, drawn · `13-pinned.png`, `13b-pinned-board.png`

**See.** Scrubbed to the partition frame the pin produced:

```
A snake · hp 98 · wt 3                       cluster 1(1)
pinned · a constant of cluster 1 — not a member
CANDIDATES · 3 · priced here · scored as best-of-cluster
red-A is pinned — it is a constant of cluster 1, not a variable the bot is solving
```

On the board the pinned unit's chip has gone **grey**; the remaining members
keep their violet cluster chips, and no tether reaches the pinned unit.

**Design.** Rule E — *"if the panel shows a unit as a member, the bot is still
choosing its move, full stop"*; §1.3's UNIT-terminal state showing the fixity
reason instead of a moveset list; 09 §B6.

**Verdict.** Correct after one fix: the sub-line read `free · pin · a constant,
not a member` — a unit simultaneously a free variable and a constant — and the
empty state read `red-A is pin`. Both fixed (§3, F9).

### 1.12 The widen — a peer releases a pin · `14-released-widen.png`, `16-widen-banner.png`, `16b-widen-accepted.png`

**See.** Scrubbed to the release, the cluster is whole again (`cluster 0(2)`,
`2 of 2 free`). Live, with the operator watching, the banner arrives:

```
⚑ Ada released red-A, red-C — cluster is now 3 units.   auto 6s   [Show]
   the rail below is stale @ seq 21
```

and the rail under it keeps the pre-widen picture until `[Show]` is pressed,
after which the wider list lands with the breakdown beside it. The picture it
keeps here is the movesets panel's EMPTY state — *"red-A is pinned — it is a
constant of cluster 1, not a variable the bot is solving"* — struck through
along with everything else the hold supersedes.

**Design.** §1.6 — additive uncertainty is staged behind one gesture on a
visible, pausable, deadline-scaled timer; the old list stays rendered; the
narrow direction applies at once with a footer note.

**Verdict.** Correct after two fixes. The banner **never appeared at all**
before them: the timer floored at zero (§3, F4), so the widen auto-accepted on
the next macrotask; and the hold was freezing the operator's own gestures as
well as the incoming data, so focusing a unit or walking the list while a
banner was up left the rail drawing the frozen picture (§3, F10). Two clauses
were missing afterwards and are here now. The banner said `released red-A,
red-C` with **no operator**, because nothing wrote the pin and then, once
something did, because the fold had already dropped the author by the time the
partition caught up (§4, O6). And this is the shot that opened O8: a held widen
whose list is empty drew no head, and the `stale @ seq n` flag rode the head —
so the one case where the rail says least about itself was the one case where
nothing said it was frozen. The flag is on the banner now (§4, O8).

### 1.13 Back to the head — `N` · `15-back-to-now.png`

**See.** The badge returns to `LIVE · seq n`, the ink comes back to full
strength, and the affordance re-reads `[Space] lock — pins 3 of 3`.

**Design.** T14. **Verdict.** Correct.

### 1.14 `locked` — `Shift+Space` · `17-locked.png`, `17b-locked-rail.png`

**See.** Before: `[Space] lock — pins 3 of 3`. After: the three members carry
staged arrows in the operator's colour and the affordance reads `[Space] lock —
pins 1 of 3` — the other two now agree with what is staged, so only the
operator's own unit would still need a pin.

**Design.** §1.4 — the minimum-pin set, exact and counted on screen before the
press; the ownership guard refuses only a determination that crosses **another
operator's** units.

**Verdict.** Correct after a fix, and this was the worst defect the walk found
after F1. The press used to come back `lock refused: not yours to determine:
red-B, red-C` while the rail had just promised `pins 3 of 3`: the server
required every pinned unit to be `selectedBy` this operator, and an operator
holds **one** selection at a time, so every lock over a cluster of two or more
was impossible. The affordance was promising a determination the server would
never make — the display contract failing at the one gesture it exists for.
Fixed (§3, F3).

### 1.15 `replay` · `18-replay.png`, `19-replay-focus.png`, `19b-replay-rail.png`, `19c-replay-board.png`, `20-replay-scrub.png`

**See.** `/game/lens-walk-replay` loads the same recorded log through
`/api/logs/games` → `/api/games/:id/turns` → `/api/logs`. Badge: `REPLAY ·
seq 40 · read-only · observed · walkthrough/mixed`. Focusing a unit gives
`A snake · hp 100 · wt 4`, the same candidates, the same single moveset row
with the same aggregate, bracket, depth cell and `unless` clause, and the same
breakdown including `joint -61.85…∞`. The turn slider scrubs back a turn and
the rail re-renders from that turn's rows.

**Design.** §2.4 — two sources, one reducer; Law C; 09 §A1.

**Verdict.** Correct after two fixes, and both were versions of A1 that A1's
own fix did not reach:

* **The rail was drawn by the LIVE source.** `historicFrameFor` was changed on
  `lens-2` to fold through `replayFrameAtSeq`, but the rail does not render
  `historicFrameFor` — it renders `lensFrame()`, which was `frameAtSeq(…,
  lensAtHead)`. A replayed turn therefore still badged itself `⏸ SCRUBBED ·
  read-only` and still offered `[N] return to now and lock`, and `lensNow` still
  set `lensAtHead = true` on a **recorded** event array. Fixed (§3, F2).
* **The replayed board was 0×0.** `logStoredEvent` drops the anchor's
  settlement (`turn_boards` holds it), and the browser folded the stored rows
  as-is, so every unit row came back nameless: kind `snake`, letter blank,
  `hp 0 · wt 0`, for a knight the live rail showed as `C knight · hp 99 · wt 3`.
  Fixed (§3, F2).

One clause was still wrong afterwards and is right now: a replayed turn was
offered `[N] return to now and lock`, naming a `now` a closed turn does not
have. It could not be fixed inside `renderFrame` — a frame carries no content
that separates a recorded turn from a scrubbed live one, which is why the
structural gate refuses a renderer that reads `at.mode` — so the line split at
the seam the design already draws. The rail now reads
`locked by Ada at +149.56ms → [jump]`, which is a read of a recorded row and
therefore the same sentence off both sources, and the way back moved to the
badge, where only `live-scrub` is offered one. Closed (§4, O7).

---

## 2. Live and replay, on one turn · `21a-live-frame.png`, `21b-replay-frame.png`

The last section of the walk renders **the same turn** twice — once from the
socket at the live head, once from `/api/logs` through the replay fold — and
diffs the two rails pixel for pixel in the browser that drew them.

```
turn 4 · live seq 140 · replay seq 40
346 × 539 px · 1,842 pixels differ · 0.988 % · all within rows 180–332
```

Everything the operator reads as a number is **identical**: the focus line, all
three candidate rows with their grades, the aggregate, the bracket `⌈0.0⌉`, the
depth cell `h1 · Q=0/33`, the Δ, the `unless` clause, the assignment, the list's
own description of itself (*"conditional list — the rows a lock here would
stage · 5 retained for the cluster"*), the foil line, all three breakdown
marginals with their reference actions and features, the joint residual
`-61.85…∞`, and the provenance line `lobster-local · walkthrough/mixed ·
eval:7f5b86c4 · e28 · 2q`.

The 0.988 % is two lines, and both are content the operator is entitled to:

| | live | replay |
|---|---|---|
| MOVESETS head | `… · seq 140` | `… · seq 40` |
| affordance | `[Space] lock — pins 1 of 3` | `locked by Ada at +149.56ms → [jump]` |
| badge | `LIVE · seq 140 · observed` | `REPLAY · seq 40 · read-only · observed` |

The `seq` difference is the harness, not the product: the replay page caches a
finished turn's events on first fetch (correct — a settled turn's log is
closed), and this "finished" game was still being written to. The last emission
is `e28` on both sides, which is why every number agrees.

The affordance row is the one that changed since this walk first ran, and it
changed in the direction the design asked for: it used to read `[N] return to
now and lock` on the replayed side, naming a `now` a closed turn does not have.
Both sides are still a read of the FRAME — neither branches on `at.mode`, which
is what keeps the comparison meaningful — and the replay sentence is a read of
a recorded row, so it says the same thing off either source at the same `seq`
(§4, O7).

**Verdict.** Law C holds on screen. Live and replay are one fold, one renderer,
one picture, and the only differences are the three badge fields plus the
affordance, which reads off `isHead` and off the turn's own rows.

---

## 3. Defects found and fixed

| # | what an operator saw | where | fix |
|---|---|---|---|
| **F1** | **The lens showed nothing in live play.** Badge `⏸ SCRUBBED · seq 27 · read-only` at the head of a live turn; the playhead stopped following, so the rail sat on the anchor's `seq 0` empty state for the whole turn; `Space` was unreachable behind `[N] return to now`. | `websocket-server.ts::sendLensAnchor` sent the mid-turn anchor with `head: false`, and `play-game.html::ingestLensFrames` latches the flag: one subscribe put every operator into `live-scrub` for the rest of the game. | `head` is computed from the game's own `boardStateTurn`; the page returns the playhead to the head on a turn boundary, and `head: false` is read as "these events are for an older turn", never as "you are scrubbing". |
| **F2** | **Replay drew a different turn from live.** `red-A snake · hp 0 · wt 0` for a unit at full health, kind and letter gone, and the badge `⏸ SCRUBBED` on a recorded turn with `[N] return to now and lock` offered. | The rail renders `lensFrame()`, which was the LIVE fold over the recorded array (09 §A1's page half fixed `historicFrameFor`, which the rail does not use); and a stored `board.arrived` has had its settlement dropped by `logStoredEvent`. | `play-game.html` carries `lensReplay` + the turn's settlement, and folds through `replayFrameAtSeq(events, seq, settlement)`; `replayFrameAtSeq` gained the settlement argument and runs `store::anchorWithSettlement` — the one reconstruction `storeFromRows` already performed. |
| **F3** | **The lock promised a determination the server refused.** `[Space] lock — pins 3 of 3`, then `lock refused: not yours to determine: red-B, red-C`. | `websocket-server.ts` `lens-lock` required every pinned unit to be `selectedBy` this operator; an operator holds one selection at a time, so every lock over a cluster of two or more was refused. | Refuse a unit we do not control, or one **another** operator holds — §1.4's actual rule. |
| **F4** | **The widen banner never appeared.** The list was swapped out from under the reader with no gesture. | `view/cursor.ts::widenAutoAcceptMs` floored at 0, so a turn past its deadline (or one whose expiry was never reported — `0` is the anchor's not-reported sentinel) auto-accepted on the next macrotask. | Clamped to 1.5 s at the bottom; `turnExpiryOf` reads `0` as unknown rather than as 1970. Gate added to `lens-widen.test.ts`. |
| **F5** | Lane ticks drawn on top of the lane's own name. | `lens-panel.js::laneHTML` / the `.lens-lane` CSS: `left: X%` resolved against the row, which the name shares. | The ticks live in their own `.lens-lane-track`; `0 %` is the start of the turn. |
| **F6** | The assignment column broke inside a unit id at 380 px: `red-` / `A→94 · red-` / `C→118`. | `lens-panel.js::movesetsHTML` joined the assignment as one string. | One `.lens-move` span per entry; the cell wraps between entries and never inside one. |
| **F7** | `±∞` printed as `—`, collapsing the lattice bounds into "unmeasured". | `lens-panel.js::num` treated every non-finite number as absent — the exact distinction `lensStringify`/`reviveLens` exist to carry across the wire and the jsonb column. | `∞` / `−∞` are named; `—` is reserved for a number that is genuinely not there. The absent `evalVersion` prints `eval —` rather than a blank. |
| **F8** | The rail sat under the board **and** under the whole three-team roster: an operator reading `red-A→94 · red-C→118` could not see the board those arrows are drawn on. The stylesheet still carried a `.board-right { width: 300px }` rule for a column the markup no longer had. | `play-game.html` layout. | A 380 px sticky right rail at ≥ 1180 px (§3.7), one scroll region. `#gameUI` is shown by a class, because an inline `style.display` set in script outranks any stylesheet rule and silently defeated the grid. |
| **F9** | `free · pin · a constant, not a member` — a unit both free and fixed, on one line; and `red-A is pin`. | `view/index.ts::renderFrame`'s `panel.focus` read `UnitRow.fixity` (derived from `pin`/`commit` events, which nothing writes) while the reason came from the partition; `emptyStateLine` dropped a tag into prose. | The partition wins, because it is the statement the kernel actually made; `FIXITY_VERB` says the reason in words. |
| **F10** | While a widen banner was up, the operator's own gestures did nothing: focus, `[`/`]`, and the lane scrubber all left the rail drawing the frozen picture. | `play-game.html::lensRender` draws the held transcript unconditionally. | Any cursor transition accepts the widen first — a hold is against incoming data, never against the reader. T1/T3/T6/T13 are unconditional in the transition table. |

Nothing here moves a decision. The kernel is untouched; the one server-side
change is a refusal predicate and a boolean that was asserted instead of asked.

---

## 4. Closed here, and what is left

Eight items were open when this walk was first written. Seven are closed; one
is closed on the surface with its cause still upstream, and says so. Every
claim below cites the run that is in `walkthrough/` now, re-shot against
`src/tests/lens-walkthrough-server.ts` after the last of these commits.

**The lens still moves no decision.** Twenty-seven of the thirty-two PNGs
changed and every one of them changed in the rail. The other five did not
change at all: the four board-only shots — `03c-board.png`, `05b-board.png`,
`08b-foil-board.png`, `19c-replay-board.png` — plus `06b-breakdown-panel.png`,
are BYTE-IDENTICAL to the run that opened these items. That is the cheapest
available statement that eight items' worth of work moved nothing but what an
operator reads. No feature flags: there is one code path and the walk is on it.

**O1 — the moveset list is a list of one. CLOSED on the surface; the CAUSE is
upstream.** `view/cursor.ts::movesetListFor` now answers with the rows *and*
their provenance — which of the two lists this is, and how many rows the
reservoir retained for the cluster before the restriction — and
`view/index.ts::movesetOps` puts it on the head. `07-movesets-panel.png` reads
*"no conditional was answered — 1 of 5 retained rows play this candidate, so
`[` and `]` have nowhere to go"*, so the shortness is a fact the operator can
check rather than a table that looks broken — and where a conditional list WAS
answered the same head says so instead (`21a`/`21b`: *"conditional list — the
rows a lock here would stage · 5 retained for the cluster"*), which is the
distinction the panel could not previously draw at all.

WHAT REMAINS is the reason the restricted list is what an operator actually
gets, and it is not on this surface. This harness asks for a conditional from
inside the decision, so the walk sees one; a BROWSER cannot, because off a
running decision the port answers `off-head` and by the time a browser looks
the decision is over. 07 §1's **0 conditional frames in 180 bot-only
decisions** is unchanged and this walk did not try to change it.
**Kernel-side:** `src/lobster/kernel.ts::rankConditional` and the reserve.

**O2 — `evalVersion` is never populated. CLOSED.** The field 02 §2.3 calls
mandatory is on every shipped frame. The version is a property of the
EVALUATOR and not of `KernelOptions`, which is why adding it to the latter was
the wrong repair: `src/lobster/team-decision-engine.ts::digestOf` now takes the
decision's evaluator and joins the `evaluationIdentity` the bound evaluator
already declares — hashed FNV-1a, because the identity is the profile spelled
out and the rail is 380 px wide. Every rail shot in this run carries it —
`lobster-local · walkthrough/mixed · eval:7f5b86c4 · e26 · 3q` under
`07-movesets-panel.png`, the same `eval:7f5b86c4` under every other — where the
footer used to read `eval —`. An evaluator
that declares nothing reads `eval:unknown` rather than an unverifiable version.
Gated by `src/tests/lens-reducer.test.ts`.

**O3 — the foil line is not "always visible". CLOSED.** `view/index.ts::foilRow`
/ `movesetOps` draw the line unconditionally for a selected row, and where
there is no rank 2 the absence carries its reason — the same move the depth
cell makes with `Q=0/33`. Under the table in `07-movesets-panel.png`:
*"no runner-up — only 1 of 5 retained rows plays this candidate"*. §3.5's
clause is now true as written rather than true in the uncommon case.

**O4 — the attention channel is not logged. CLOSED, producer and reader.** The
look does reach the kernel, in a shape §2.1 did not name: a TENTATIVE pin, a
hint the search may speculate on and never a constraint
(`websocket-server.ts` case `'lens-conditional'` →
`ActiveGameManager.notePinConsideration` → `PinEvents.tentativePin`). Since O6
that gesture is a row, so `view/index.ts::renderTimeline` reading `tentative`
beside `hover` now has something to read. Evidence is the pair `09-lane.png`
and `10-lane-expanded.png`, which used to be byte-identical and are not: the
collapsed lane draws four solid operator ticks, and expanding it reveals a
hollow `○` at `+149ms` — the look, hidden until asked for, and never drawn as
a determination nobody made. The harness drives one so the walk can see it
(`lens-walkthrough-server.ts`, the `emitted === 1` act).

**O5 — the rail's rows are not clickable. CLOSED.** The markup names the
target and the page binds it: `panel.movesets.row` carries the row's own key,
`panel.candidates.row` its candidate, and `play-game.html`'s `#lensRail`
`pointerdown` routes `[data-lens-candidate]` to `lensSelectCandidate` and
`[data-lens-moveset]` to `lensSelectMoveset`, which is what T3 and T6 always
said the rail did. Hover stays inert, per T4. Gated by
`src/tests/lens-panel.test.ts` *"the rail names its click targets for T3 and
T6"*, which also asserts the markup carries no `onmouse` / `onclick` / `:hover`
— the walk itself still drives the cursor from the keyboard, so the click path's
evidence is that test and the markup rather than a PNG.

**O6 — no `pin` / `unpin` turn event exists anywhere. CLOSED.** The manager now
implements `LensDecisionPort.command`: it resolves the unit, attributes the row
to the operator holding it, writes through the one `seq` writer, and hands the
id back; `team-decision-engine.ts::routeToKernel` calls it and passes that id to
`kernel.onPinEvent`. The order is causal and not a convenience — the writer
refuses an answer whose question it has not written. Everything downstream that
was permanently null now reads: `report.json`'s `operatorTicks` are
`pin(red-A) · seq 9 · +149.57ms` and `unpin(red-A) · seq 19 · +263.63ms` in the
operator's colour where they were a verbless `operator · seq 11`; the replay
rail reads `locked by Ada at +149.56ms → [jump]`; and `frameAt`'s fixity map is
populated, so `planLock`'s client-side ownership guard is a guard again rather
than a no-op.

The re-run found one more null in the same family, and it is fixed here rather
than recorded: the banner still read `released red-A, red-C` with no operator,
because the fold DELETES a unit's fixity on `unpin` and the partition recompute
that produces the widen lands seqs later — so the row the author stood on was
free and anonymous by the time there was a widen to attribute. The turn's own
rows still say who, so `view/cursor.ts::attributionFor` falls back to them: the
same read `recordedLock` makes, sound for the same reason, and a tentative pin
attributes nothing. The banner over `16-widen-banner.png` now opens
`⚑ Ada released red-A, red-C`. One new row per gesture, and an id.

**O7 — a replayed turn is offered `[N] return to now and lock`. CLOSED, at the
seam the design already draws.** This was recorded as a gap in `lockLabel`; it
is a boundary. A frame carries no CONTENT that separates a recorded turn from a
scrubbed live one — `at.mode` is on the frame precisely because the distinction
is not derivable — so `lens-panel.test.ts`'s structural gate is right to refuse
a renderer that reads it. What is true of the FRAME stayed in the transcript:
`view/index.ts::recordedLock` draws §1.4's own sentence where the turn's rows
hold a lock at this `seq`, and `— read-only —` where they do not, which is true
of both off-head modes. THE WAY BACK is a fact about the SOURCE, so it moved to
`WAY_BACK` beside `modeBadge`. Read the two badges side by side:
`12-scrub-emission.png` is `⏸ SCRUBBED · seq 10 · read-only · [N] return to now`
and `19b-replay-rail.png` is `REPLAY · seq 40 · read-only` with no `now` offered
at all, over a lock line reading `locked by Ada at +149.56ms → [jump]` — a
sentence that was unsayable until O6 made the pin a row.

**O8 — a widen's staleness is invisible when the table is empty. CLOSED.** The
`stale @ seq n` flag rode `panel.movesets`'s head, and a cluster with no
retained rows never draws that head — `movesetsHTML` returns its empty state
and nothing else — so the one case where the rail said least about itself was
the one case where nothing said it was frozen. The flag moved to the banner
(`lens-panel.js::bannerHTML`), which is up in exactly the cases the hold applies
to: one place, all of them. `16-widen-banner.png` is the case that used to fail
— the movesets panel is its empty state, *"red-A is pinned — it is a constant
of cluster 1, not a variable the bot is solving"*, struck through by the new
`.lens-held .lens-movesets .lens-empty` rule, under a banner reading *"the rail
below is stale @ seq 21"*. The falsifier is written as the failing case in
`src/tests/lens-widen.test.ts` *"still flags staleness when the list under the
banner is EMPTY"*, which asserts the body carries no `lens-stale-flag` and the
banner does.

---

## 5. Console, requests, layout

Across the whole session, on both pages:

* **Page exceptions: none.**
* **Console errors: none from the lens.** The three distinct lines recorded are
  the harness's own — two 404s (below) and the deliberate
  `[firebase-status] not_configured` line the banner is driven by.
* **Failed requests: two, both the harness.**
  `/api/connection-log/client` 404 (the dev entry does not mount the
  connection-debug router) and `/api/play/game/lens-walk-replay` 404, which is
  correct and load-bearing: it is what tips the page into `finishedMode`. That
  same 404 against the LIVE id was what made the first run of this walk read a
  live game as a finished one — worth knowing, because it means an operator
  whose `/api/play/game/:id` call fails gets a silent replay of a live game.
* **Horizontal overflow: none**, at 1500 × 950 after F8. The rail is a
  380 px column and every panel fits inside it; the assignment column wraps
  between entries after F6.
* **Unreadable:** the lane's names before F5; the assignment column before F6;
  `—` where `∞` was meant before F7. All fixed. Still cramped rather than
  unreadable: the MOVESETS table carries six columns in 380 px, and the
  `unless` clause — a sentence — takes three or four lines of the row.

---

## 6. What this document is evidence for

The lens works. A real decision, over the real socket, in the real page, draws
a cluster on the board, names what each moveset is betting on, prices a
member's contribution against the reference action it was priced against,
carries a mandatory joint residual, scrubs inside the turn, stages a widen
behind a gesture, and stages a determination whose pin count is exact and on
screen before the press — and it draws the same picture off the log as off the
wire.

It also did not work, in live play, before this walk: an operator who opened
the page got a rail frozen on `seq 0` badged `read-only`, and a replayed turn
that claimed to be a scrubbed live one and lied about its board. Both defects
were invisible to a test suite that folds arrays and compares transcripts,
because both live in the half-inch between the fold and the browser — one
boolean on a socket envelope, and one function the rail does not call. That is
the argument for keeping `src/tests/lens-walkthrough-server.ts` and running
this walk again after anything in `src/lens/**`, `src/web/**` or
`websocket-server.ts` moves.

Re-running it to close §4 made the same argument a second time. Two of the
eight items were reported closed by a green suite and were not closed on
screen: the attention channel had a producer in production and none in the
walk, so the lane's expand toggle was still a control over nothing; and the
widen banner was still anonymous, because the fold drops a unit's author on
`unpin` and the partition recompute that produces the banner lands seqs later.
Neither is visible to a test that asserts a notice's fields — both wanted a
browser, a real log, and someone looking at the picture. The re-run is part of
closing an item, not a formality after it.
