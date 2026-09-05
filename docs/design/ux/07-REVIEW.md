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

**M1 — a death.** `turn_events.kind = 'turn.resolved'`, payload `deaths:
UnitKey[]`. Non-empty ⇒ a moment on that turn. Ours (a unit in this game
group's roster) weighs more than a rival's: losing a unit is the event the
reviewer is looking for, killing one is a result.

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
max(0.5, 0.05 · |rank1.lo|)`. This is the turn where the bot nearly did
something else, which is the turn a reviewer most wants and the one no summary
statistic can surface.

**Weight and ranking.** Each rule contributes a weight (M3 4, M1-ours and M5 3,
M1-theirs, M4 and M6 2, M4-refused 3); a turn's weight is the largest it earns
and the strip's brightness is that weight in four steps. The moment *list* is
every rule's hit, ranked by weight and then by turn, so a turn that is a death
*and* a hand-over says both.

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
because it survives every colour vision. A cell's `title` and its
`aria-label` name every rule that fired on it, so the strip is readable by
a screen reader as a list and not as a picture.

The strip does not re-order, ever, and the cursor moves through it without the
cells moving (`01` P3). It is a `<ol>` of buttons, not a canvas: `/activity`'s
canvas is mouse-only and that finding is not worth repeating.

### 1.4 "Why did it do that", in under ten seconds

The reviewer is not on a 500 ms clock — that is the operator's constraint, and
the review is the one surface in this product that may be *dense*. But ten
seconds is still a budget, and it buys six readings, in this order, all off
stored rows:

1. **What it did.** The chosen moveset: the rank-1 row of the turn's last
   `movesets` frame — the one the decision ended on — with its cluster, its
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
