# 07 — THE REVIEW: judging a finished game

UX lens, document 7. The four screens of `04-SECONDARY-SCREENS.md` serve an
operator *during* a game and one of them — `/history` — hands a finished game
back. This document is about the journey that starts there and that nothing in
the product has ever served: **the owner sits down after the fact and judges
the bot.**

Answerable to `01-RESEARCH.md` (P1 the glance, P3 nothing moves under the
cursor, P5 absence is a reading, #17 colour-vision safety), to
`02-IA-AND-CONTROLS.md` §3.1 for the key vocabulary, to
`decision-lens/01-DATA-MODEL.md` §6.1 for what the five tables hold and
`decision-lens/02-INSPECTION-UI.md` §Replay for what a path into the lens must
land on, and to `docs/OPERATOR-MANUAL.md` §11 for the deep link that already
exists.

It computes **nothing new about a decision**. Every reading below is a read of
a row that was already written: `turn_boards`, `turn_events`, `decisions`,
`movesets`, `unit_outcomes`. The review is a lens on the store, not a second
opinion about the kernel.

---

## 1. The design

### 1.1 The journey

> *Open a finished game. See at once where it was decided. Jump to those
> moments. Understand each in under ten seconds. Mark the ones that matter and
> send them to somebody.*

Five moves, and today the product serves half of one. `/history` says `▲ WON ·
118 turns · 4h ago` and offers three ways into the lens — the outcome link,
`open at turn [___] Go`, and `↩ resume at K` — all of which require the
reviewer to *already know the turn number*. That is the whole gap. A game is
118 turns and roughly four of them decided it; the reviewer's problem is not
opening turn 63, it is knowing that 63 is the turn.

The cost of the gap is the cost of the journey. Scrubbing a 118-turn replay at
one turn per keypress, reading the rail at each stop, is minutes per game — so
in practice the bot is judged on its win rate and nothing else, which is the
one reading that cannot say *why*.

Each move of the journey, and what serves it:

| move | what serves it | what it costs today |
|---|---|---|
| open a finished game | the row that is already there | free |
| see where it was decided | **the moments strip** (§1.2, §1.3) | the whole game, scrubbed |
| jump to a moment | `j` `k` on the strip; `h` `l` on turns | a typed turn number |
| understand it | **the why panel** (§1.4) | open the lens, focus a unit, press `B`, read |
| mark and share | **bookmarks and a deep link** (§1.5) | a turn number pasted into a message |

### 1.2 The index of moments, and what it is computed from

A **moment** is a turn the reviewer would have wanted to be told about. It is
derived — never asserted, never stored — from rows that already exist, by six
rules. Every rule names its source table, because a moment whose provenance is
not nameable is a number the review invented.

**M1 — a death.** From `turn_boards.settlement`: a unit alive in turn `t`'s
board and gone from `t+1`'s died on `t`. **Not** from `turn.resolved`'s
`deaths` field — the only writer there has ever been emits it as `[]`
(`active-game-manager.ts::applyResolvedMoves`), so an index that trusted it
would report a game in which nothing ever died. The boards are also the class
retained forever, so this rule outlives the seven-day event window and works on
a game whose log has been folded away. Ours (a unit in this game group's
roster) weighs more than a rival's: losing a unit is the event the reviewer is
looking for, killing one is a result.

**M2 — a lead swing.** From `turn_boards.settlement` alone. For each stored
turn, `weight(team) = Σ length` over that team's units that are alive in the
settlement — `length` is body length for a snake and stack weight for a piece,
which is the same quantity in both cases — and

```
lead(t) = weight(ours) − max over rivals weight(rival)
```

which is exactly `leadOf()` on the `endgame` branch (`src/tests/local-game.ts`,
the `GameOutcome` instrument: *"our end weight minus the heaviest rival's,
signed, zero on a level board"*). The runner computes it at adjudication and
keeps a ten-turn `trajectory`; the store keeps no such record, so the review
recomputes the same function over the boards it does keep. When that branch
merges, the runner's own `lead` and `sharePar` become the headline's authority
and this recomputation becomes its per-turn continuation — the definition is
deliberately the same one so that day is a substitution and not a rewrite.

A swing is `Δ(t) = lead(t) − lead(t−1)` with `|Δ| ≥ max(2, 0.15 · max|lead|)`.
The floor of 2 is one small unit; the proportional term keeps a heavyweight
board from marking every meal.

**M3 — a hand-over.** `sign(lead)` changes across a turn, zero excluded. This
is a different event from a swing and it is the heaviest one on the strip: the
game changed hands here. The **headline** — *"decided at turn N"* — is the last
hand-over, or, in a game that never changed hands, the turn of the largest
single `|Δ|`.

**M4 — an operator intervention.** `turn_events.kind ∈ { pin, unpin, commit,
pin.refused, operator.command }`, with `actor.kind = 'operator'` and the
attribution the row already carries. A turn a human touched is a turn whose
outcome is not the bot's alone, and a review that does not separate the two is
judging the wrong player. `pin.refused` weighs more than the rest: a refused
determination is the documented silent failure (`04` F1) and a review is the
last place it can still be seen.

**M5 — a leader that changed late.** The turn's `movesets` frames, grouped by
cluster in `seq` order (`turn_events`, and identically `movesets` under
`(decision_id, cluster_id, rank)`). If the rank-1 `moveset_key` of the **last**
frame differs from the frame before it, the bot changed its mind on the last
emission it had — a decision the deadline cut. A leader that changed early and
then settled is a search working and is not a moment.

**M6 — a ranking that was narrow.** On the last `movesets` frame per cluster,
and on every `conditional` frame the turn holds: narrow when the leader's
`dominance` is `advisory-only` (*floors equal — the leader won on the channel
that never adjudicates*) or `indifferent`, or when `rank1.lo − rank2.lo ≤
max(0.05, 0.01 · |rank1.lo|)`. This is the turn where the bot nearly did
something else, which is the turn a reviewer most wants and the one no summary
statistic can surface.

**Weight, magnitude, and the cut.** Each rule contributes a **weight** — its
class: M1-ours and M3 4, M1-theirs, M4-refused and M5 3, M2, M4 and M6 2 — and
each hit carries a **magnitude** in its own rule's units: units lost, the size
of the swing, what the late swap bought on the proved floor, how thin the
margin was. Magnitudes are normalised **within the game**, which is the only
scale that means anything (an evaluator's units are not comparable across
boards), and `score = weight + normalised magnitude`.

The index then **keeps the turns that stand out** — `clamp(4, turns/6, 24)` of
them, by best score — and the categorical rules (a death, a hand-over, a
refusal) are never cut, because those are facts about the game rather than
matters of degree. Everything below the cut stays on the strip at the lowest
brightness and stays reachable with `h`/`l`: *quieter than the rest of this
game* and *nothing here* are different readings.

This is a **ranking, not a threshold**, and §2.1 records why: against a real
log, absolute thresholds fired on every turn.

**What is deliberately not a moment.** Food, health, hazards, and per-turn
kernel counters: all readable, none of them decisive on their own. A moment
index that fires on everything is a strip of identical marks, which is the
`/activity` legend failure (`04` F4) in a new place.

### 1.3 The strip: shape and brightness, never hue

One cell per stored turn, laid along the game. `01-RESEARCH` #17's audit rule
holds: **every mark is a glyph first**, and colour is a second reading of
something the shape already said.

| glyph | moment | hue (reinforcing only) |
|---|---|---|
| `▼` | one of ours died | `--stop` vermillion |
| `△` | a rival died | ink |
| `◆` | the lead changed hands | `--warn` orange |
| `◇` | the lead swung | `--warn` orange, dim |
| `■` | an operator acted | `--cool` sky |
| `●` | the leader changed on the last emission | ink |
| `○` | the ranking was narrow | ink, dim |
| `·` | nothing | ink-faint |

Okabe–Ito, as `chrome.css` already declares them. Brightness carries weight
because brightness is what the periphery reads (`01` P1's peripheral rule) and
because it survives every colour vision. Where a turn holds several hits the cell draws the **concrete** one first — a
turn on which a unit died reads as a death even when a leader also changed on
it, because a death is a fact about the game and the other rules are facts
about the search, and a reviewer scanning the strip is looking for the first.
A cell's `title` and its `aria-label` name every rule that fired on it, so the
strip is readable by a screen reader as a list and not as a picture.

The strip does not re-order, ever, and the cursor moves through it without the
cells moving (`01` P3). It is a `<ol>` of buttons, not a canvas: `/activity`'s
canvas is mouse-only and that finding is not worth repeating.

### 1.4 "Why did it do that", in under ten seconds

The reviewer is not on a 500 ms clock — that is the operator's constraint, and
the review is the one surface in this product that may be *dense*. But ten
seconds is still a budget, and it buys six readings, in this order, all off
stored rows:

1. **What it did.** The chosen moveset: the rank-1 row of the turn's last
   `movesets` frame — the one the decision ended on — for the cluster with the
   most to say (the one whose leader was drilled during the game, else the
   widest, else the staged one), with the turn's other clusters one click
   away rather than invisible; with its cluster, its
   members, and **per member the move it assigns** (`unit → cell`, and the
   path length). Beside it, what actually resolved: `turn.resolved.moves` and
   `unit_outcomes` (`staged_move`, `confirmed_move`, `resolved_move`,
   `committed`, `operator_id`, `fatal_consent`). Where those two disagree, the
   disagreement is the answer.

2. **The number, with its premise.** `lo · est · hi`, which channel
   adjudicates, `exact`, `ledgerSize`, and the depth column `h1 → deepest`
   with its delta and bracket width. Law A holds here as it does in the rail:
   the triple is a whole-board bracket of a complete plan and never a sum, and
   an `unpriced` row draws `—` and not a zero.

3. **The breakdown, by member and by unit.** The stored `breakdown` event for
   that moveset key (`turn_events.kind = 'breakdown'`, payload
   `BreakdownPayload`) — level 1 `aggregate` with its top feature
   contributions, level 2 one `marginal` per named member with the **reference
   action it was priced against**, and the **joint residual, drawn even at
   zero**. The residual is mandatory: marginals that do not add up to the
   aggregate are a lie unless the gap is named (Law C2). Where the turn holds
   no `breakdown` — nobody drilled that row live — the panel says *"nobody
   priced this row during the game"* and offers the lens, because the review
   does not run the kernel to manufacture one.

4. **The runner-up.** Rank 2 of the same list, its assignment, its `Δlo` and
   `Δest` against the leader, and its `dominanceClause()` — the same sentence
   the rail draws, read from the same function in the same bundle
   (`LensView.dominanceClause`), so the two surfaces cannot drift apart.

5. **The foil.** Not the same thing as the runner-up, and this is where the
   review earns its keep: the foil is **the highest-ranked row whose dominance
   names a threat** — `refuted-by-witness` or `contingent` — i.e. the row that
   says what the leader is *betting against*. In most turns that is rank 2 and
   the panel says so; where it is rank 5, rank 5 is the row the reviewer wants
   and no list ordered by rank would have shown it to them.

6. **The threats, as cells where there are cells.** A `theirs` ply in the
   leader's `depth.line` carries `{ unit, to }` — enemy actions, i.e. threat
   cells, and they are drawn as such. **On today's build there are none**:
   every reading is `h1` (`06-LOOKAHEAD`, `07-MEASURED`), the line is empty by
   construction, and `Witness.replies` is a `Map`, which `lensStringify` writes
   as `{}` — the certificate does not survive storage. So the panel draws the
   named threats it *does* have — `citedUnits`, and `contingent.onUnits` with
   `atStake` — and states in one line that this decision proved at h1 and
   stored no enemy cells. That is `01` P5: **the absence is a reading, and it
   is drawn**. When depth ships, the cells appear here with no other change.

Under all six: basis, complement freshness and generation — the fiber (Law E).
Two rows from two complements are never compared, and a review that let a
reviewer compare them would be manufacturing the exact error the lens exists
to prevent.

### 1.5 Marking and sharing

* **Bookmark** (`b`): a `{ game, turn, focus, note-free }` mark in
  `localStorage` under `centaur.reviewMarks`, bounded, per browser profile —
  the same class of state as `centaur.lastTurn`, which `/history` already
  offers back as `↩ resume at K`. It is a convenience and it is written and
  read in a `try`, because a private window is not a failure.
* **The deep link** (`y`): `#game=<id>&turn=<n>&focus=<unit>` on `/history`
  reopens the review exactly where it was, and the lens link beside it is
  `/game/<id>#turn=<n>&focus=<unit>`. `replay-deeplink.js` already honours
  `#turn=`; it is taught here to *carry* `focus=` through the `replaceState`
  it does on every playhead move, so the fragment a reviewer pastes is the
  fragment the recipient still has after the viewer has scrubbed. One field,
  preserved; nothing else in the viewer is touched.
* **Export the turn**: the same link, in a read-only field beside a copy
  button, because a link that only exists on the clipboard cannot be checked
  before it is sent.

### 1.6 What the review may not do

* **Read-only against the store.** Four `GET`s, all of them routes that exist:
  `/api/logs/games`, `/api/games/:id/turns`, `/api/logs`, `/api/logs/commands`.
  No new route, no write, no `POST`, and nothing that could reach a live game.
* **No new kernel computation.** Not a re-run, not a re-price, not a second
  `explainPlan`. A row the game did not price is drawn as unpriced.
* **No new polling.** A finished game does not change; the review fetches once
  per game and holds it.
* **It does not touch the live view.** `play-game.html`, `lens-panel.js`,
  `board-renderer.js`, `keynav-machine.js` and `src/lens/view/**` are read
  from and never written to; the review loads the shipped `lens-view.js`
  bundle for `dominanceClause` and `reviveEvents` rather than restating either.

### 1.7 The keys

The review is a reading surface, so its keys are the reading scheme
(`02` §3.1's `vim` column), and they are registered through
`PageChrome.key` — which runs before the shared list keys — so they exist only
while a review is open and `/history`'s list keeps `j`/`k` when it is not.

| key | action |
|---|---|
| `j` `k` | next / previous **moment** |
| `l` `h` | next / previous **turn** |
| `b` | bookmark this turn |
| `y` | copy the deep link |
| `Enter` | open this turn in the lens |
| `Esc` | back to the list |

`Ctrl+/` lists them, from the same table, because `page-chrome.js` builds the
sheet from what was registered and cannot disagree with it.

---

## 2. What landed

Against §1, with what changed and why. The pictures are `review/r1`…`r7`,
taken by the review drill in `scripts/lens-walkthrough.js` against
`src/tests/lens-walkthrough-server.ts` — the shipped page, the shipped routes,
a real recorded game; `review/report.json` is what the drill asserted and what
it saw.

### 2.1 The index — and the one thing the plan got wrong

`src/web/review.js` (new). Rules M1–M6 are implemented as §1.2 describes, with
two corrections the log forced within an hour:

**The deaths rule read a field that is always empty.** §1.2 named
`turn.resolved`'s `deaths`. The only writer that has ever emitted that event
writes `deaths: []` unconditionally (`active-game-manager.ts:4090`), so the
first run of the index on a fifteen-turn game with two deaths in it found
none. Deaths are diffed off successive settlements instead — which is also the
better source, because `turn_boards` is retained forever and the event log is
a seven-day window, so the rule now outlives the log it was going to depend
on. §1.2 records the corrected rule; this records that it was found by
running it.

**The thresholds fired on everything.** The first index over a real fifteen-turn
log produced a hit on all fifteen turns: the leader changes on the last
emission of almost every turn — the search is still improving when the deadline
lands, which is a true thing about this bot and a useless thing to mark — and
the top two rows sit within a hundredth of each other nearly as often. The
strip was fifteen identical marks, which is `04` F4's legend failure in a new
place and is exactly what §1.2's own last paragraph warned against.

So the index became a **ranking**: a magnitude per hit in its own rule's units,
normalised within the game, `score = weight + magnitude`, and a cut at
`clamp(4, turns/6, 24)` turns with the categorical rules exempt. On the same
log the strip now marks five turns out of fifteen and names thirty-six quieter
readings it kept off the list (`r1-strip.png`). The absolute thresholds that
survive — the swing floor, the narrowness test — are now only a first filter
in front of the ranking, and the ranking is what the reviewer sees.

**Two passes, not one.** §1.6 said four `GET`s and meant it, but not all at
once: a whole game's `movesets` frames are tens of megabytes (`07-MEASURED` §1:
33–88 KB per emission, seven to ten a turn), so fetching the log to build an
index would cost 60 MB on a 120-turn game. The index pass is one boards fetch
plus five `kind=`-filtered event fetches, all of them rows the size of a
sentence; the deep pass is **one turn's** whole log, fetched when the reviewer
lands there, cached, and run bounded (40 turns) in the background over the
turns the index already flagged. The strip draws what it has not read as
**unread** — dashed and dim — and the header says `N of M turns read in full`,
because a strip that drew an unread turn as an empty one would be asserting a
fact it never checked.

The harness's `/api/logs` learned to honour `kind=` for the same reason:
production filters it in SQL on an indexed column, and a stub that ignored it
would have handed the review the megabytes the split exists to avoid.

### 2.2 The strip and the keys

One `<ol>` of buttons, one per stored turn, glyph first and brightness for
weight, `title` and `aria-label` naming every rule that fired (`r1-strip.png`).
A turn that carries both a death and a leader change draws the death: the
concrete reading wins the cell, and the drill asserts exactly that by diffing
the boards itself and requiring the strip's death marks to be the turns a unit
disappeared on — the page's own index is not allowed to be its own witness.

`j`/`k` walk moments, `h`/`l` walk turns, `b` bookmarks, `y` copies, `Enter`
opens the lens, `Esc` returns to the list. They are registered through
`PageChrome.key`, which runs page keys before the shared list keys, so
`/history`'s own `j`/`k` row selection is untouched when no review is open and
the cheat sheet (`Ctrl+/`) lists both from the one table.

One defect the drill caught here: stepping a moment moved the turn, and moving
the turn re-seated the cursor on that turn's *first* moment — so `j` on a turn
carrying five moments went nowhere. The step now carries its cursor through.

### 2.3 The why panel

Seven cards off the turn's own log (`r3-why.png`): what it played (per member,
with what was staged and what resolved beside it), the number with its premise
(bracket, channel, exactness, ledger, depth, the fiber), the stored breakdown
by member and unit with its mandatory joint residual, the runner-up, the foil,
the threats, and the turn's conditional rankings.

Three things it does that the plan only implied:

* **The foil is not the runner-up.** It is the highest-ranked row whose
  dominance names a threat, and the card says when that is also rank 2 and
  when it is not.
* **A breakdown that is about a different row says so.** An operator drills
  the leader *at the moment they press `B`*, and the leader moves; where the
  chosen row carries no breakdown but another row of the same list does, that
  breakdown is drawn with a line saying whose it is. Drawing it silently as
  the chosen row's own would be the exact class of error this lens exists to
  prevent.
* **The threats card draws its own absence.** Every reading on this build is
  `h1`, so the line has no `theirs` ply to take enemy cells from, and
  `Witness.replies` is a `Map`, which `lensStringify` writes as `{}` — the
  certificate does not survive storage. The card says so in a sentence and
  then names what it does have: the cited units (`the evaluator residue` where
  the ledger's residue entry is cited, the same wording the rail uses), the
  contingent's `onUnits` and what is at stake, and the assumption count.

`dominanceClause` and `reviveEvents` come from the shipped `lens-view.js`
bundle, loaded on demand so the listing does not pay 58 KB for a panel nobody
opened. The review does not restate either: one wording of "why this row is not
rank 1" exists in this product.

### 2.4 Marking and sharing

`b` writes a bookmark to `localStorage` under `centaur.reviewMarks`, bounded and
in a `try`; `y` copies `#game=<id>&turn=<n>&focus=<unit>`, which is also always
in a read-only field beside the button, because a link that exists only on the
clipboard cannot be checked before it is sent (`r7-share.png`). The lens link
beside it is `/game/<id>#turn=<n>&focus=<unit>` and the viewer can be embedded
at that turn in place, off by default.

`replay-deeplink.js` gained one field: it reads `focus=` on arrival and
re-emits it in every `replaceState` it makes as the playhead moves, so the unit
a reviewer named survives the recipient's first scrub. It does not act on the
value — moving the viewer's focus belongs to the viewer — and
`ReplayDeepLink.focusUnit()` is where that viewer will read it. Nothing else in
the viewer was touched: `play-game.html`, `lens-panel.js`, `board-renderer.js`,
`keynav-machine.js` and `src/lens/view/**` are byte-identical.

### 2.5 What was not built

* **No re-run and no re-price.** A row the game did not price draws `—`; a row
  nobody drilled says nobody drilled it and offers the lens.
* **No new route and no write.** Three of the four documented read routes, and
  the one `localStorage` key.
* **No cross-game index.** "Which of my last twenty games did this" is a real
  question and it is a different document: it needs an aggregate the store has
  no route for, and inventing one here would have made this pass a schema
  change wearing a UI.

## 3. Gates

* `npx tsc --noEmit -p .` clean · `npx eslint "src/**/*.ts"` clean ·
  `node --check src/web/review.js` clean.
* `npm run build:lens` writes `src/web/lens-view.js` unchanged — this pass
  reads that bundle and does not touch what builds it.
* `npx jest --maxWorkers=2 "src/tests/lens-" src/tests/local-game-determinism.test.ts`
  — the lens suites and the determinism gate, unaffected.
* The walkthrough re-run end to end against a fresh harness: the operator,
  tour, key-scheme and **review** drills all green (16 review assertions), no
  page exception and no horizontal overflow on any screen. The only entries in
  the request log are the deliberate `/api/play/game/<id>-replay` 404 — which
  is what tips the viewer into finished mode — and the viewer's unload beacon,
  which the browser aborts on navigation. The harness now mounts
  `/api/connection-log/client`, which production has and it did not, so a walk
  that leaves the game page no longer records a 404 belonging to the harness.
* Seven review screenshots under `docs/design/ux/review/`, every one inside the
  300 KB budget (largest 249 KB, the whole panel), beside the drill's own
  `report.json`.
