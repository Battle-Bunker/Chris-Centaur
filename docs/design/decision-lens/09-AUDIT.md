# 09 — AUDIT: what the shipped lens actually says to an operator

DECISION-LENS, document 9. Written against `lens-audit` @ `d4c0886` by walking
every panel and every state of the cursor machine in `src/lens/view/**`, the
fold that feeds them (`src/lens/store/**`), the generated bundle
(`src/web/lens-view.js`) and — read only, since they belong to other owners —
the transcript driver (`src/web/lens-panel.js`) and the page that drives it
(`src/web/play-game.html`).

The design is `02-INSPECTION-UI.md`; the numbers are `07-MEASURED.md`; what
depth means on this build is `08-DEPTH-VERDICT.md`. This document is the
difference between those three and the code.

**What has since landed.** Every Band A and Band B finding, the whole of Band
D and C1 were fixed on `lens-audit`. The two findings that needed a file that
audit did not own — A6's kernel emission and the mid-turn joiner's anchor —
and the seven page-side items handed over with them are fixed on `lens-2`.
Each is marked **FIXED** below, with what closed it; C3 and C4 are still open
and are the honest remainder.

**Ranking rule.** Findings are ordered by how much they mislead an operator,
not by how hard they are to fix.

| band | what it means |
|---|---|
| **A** | the rail states something false, or the lens can move a decision it is only supposed to watch |
| **B** | a number or a word is on screen whose meaning is not the one it will be read with |
| **C** | the kernel computes and emits it, the operator never sees it |
| **D** | dead code, duplicated code, and doc text describing what is not there |

---

## Band A — the operator is told something untrue

### A1. Replay was drawn by the LIVE source, and one keypress made a recorded turn lockable — **FIXED**

`frameAtSeq` (`src/lens/view/index.ts`) always builds its frame through
`makeLiveDecisionSource`, so its `at.mode` can only ever be `live-head` or
`live-scrub`. The page's replay path called it with `isHead: false`
(`play-game.html::historicFrameFor`), so a replayed turn rendered as
`⏸ SCRUBBED`, and the lock affordance read `[N] return to now and lock`.
`N` (`play-game.html::lensNow`) set the page's `lensAtHead = true` on the
**replayed** event array; the next `Shift+Space` passed `planLock`'s head check
and sent `lens-lock` with pins computed from a recorded frame.

`makeReplayDecisionSource` existed, was correct, and was reachable from no
production caller: the browser had never run the replay source. "Two sources,
one reducer" was true of the tests and half-true of the product.

*Fixed in both halves.* `replayFrameAtSeq(events, seq)` is the same fold and
the same frame, stamped by the replay source, and `historicFrameFor` calls it
— which also stops `lensNow` marking a recorded frame as the head. The rail's
badge is `modeBadge` + `provenanceBadge` rather than the page's own copy of
one of them, so a replayed turn now says `REPLAY · seq n · read-only`.

### A2. The retained movesets are folded under a key no reader ever asks for

`frameAt` files a `movesets` frame under `reservoirKey(cluster)` = `"0"`
(`src/lens/store/index.ts`), and `rowsFor` only ever looks up
`${cluster}|${unit}|${to}` (`src/lens/view/cursor.ts`). Nothing reads the
cluster-keyed entry. The MOVESETS panel is therefore populated **only** by a
`conditional` frame, which only exists if somebody asked for one.

`07-MEASURED.md` §1 records **0 conditional frames in 180 bot-only decisions**.
So on replay of any turn nobody inspected live, the panel that is the whole
point of the lens is empty while the frame is holding the rows. The tests miss
it because `recordLensRun` scripts an inspector that hovers once per emission
(`src/lens/kernel/record.ts`), which is the one condition under which the key
exists.

*Fix:* `rowsFor` falls back to the cluster's retained rows restricted to those
that assign `to` to `unit` — a selection over rows the search really priced, not
a computation. A conditional list, when one exists, still wins.

### A3. The empty state names one cause and it is usually the wrong one

`emptyStateLine` returns `"… — no kernel emission yet at seq N"` for every
empty table, and the sentence is false in at least three of the four states
that reach it:

| state | what is true | what it said |
|---|---|---|
| no emission yet | correct | correct |
| unit is `pinned` / `committed` / `dead` (the UNIT-terminal state, 02 §1.3) | the bot is not choosing this move, and who fixed it | "no kernel emission yet" |
| a candidate whose conditional list has not answered | the ask is in flight | "no kernel emission yet" |
| emissions happened, the reservoir retained nothing (07 §2: 13 of 90 `snakes` decisions) | honest emptiness | "no kernel emission yet" |

The design gives the second row its own display — *"the rail shows the fixity
reason instead of a moveset list"* — and it does not exist.

*Fix:* `emptyStateLine(frame, cursor)` answers all four, naming the fixity and
the operator who caused it.

### A4. The widen banner does not fire for half of all releases, and miscounts when it does

`reactiveNotice` (`src/lens/view/cursor.ts`) matches a cluster's successor by
`c.id === before.id`. A `ClusterId` is `group[0]` — **the smallest member's unit
id** (`src/lens/kernel/partition.ts::partitionOf`). Release a unit that sorts
below the current anchor and the widened cluster is a different id, the match
fails, and the owner's headline reactive case ("Ben released R — cluster α is
now 4 units") is silently not drawn. `ClusterView.lineage` exists for exactly
this and is unread; so is `PartitionPayload.changes`, where the kernel already
publishes `widened` / `narrowed` derived with lineage — the fold drops it.

And when it does fire, `WidenNotice` carries no member count while
`lens-panel.js::bannerHTML` renders `gained.length + (notice.members || 0)`, so
the banner reads **"cluster is now 1 units"**.

*Fix:* match on `id` then on `lineage`; carry `members` (the count before the
widen, which is what the banner's arithmetic wants).

### A5. The foil line can print the winner's reason as the loser's

`decidingRung` (`src/lens/view/index.ts`) falls back to
`loser === selected ? foil.dominance : selected.dominance` when the losing row's
own `dominance` is null (which it is on every row before the barrier). The rail
then reads `foil #2 · leads on the proved floor` — the reason the row that WON
won, offered as the reason the other one lost.

*Fix:* read the loser's own condition, and say `unsealed — the barrier has not
run` when there is none. The line is also relabelled: it was calling a
dominance clause a "rung", which is a different object entirely (B3).

### A6. The BREAKDOWN panel could not draw, anywhere, ever — **FIXED**

`frameAt` returned `breakdown: {}` unconditionally; no `LensEvent` kind carried
a breakdown; `LobsterKernel.explainMoveset` answered the asking socket only,
and `play-game.html` discarded `lens-breakdown-rows`. So
`panel.breakdown.pending` — *"[B] to price this row"* — was the only breakdown
state that had ever been on screen, `B` appeared to do nothing, and the
**mandatory joint-residual row** (02 §3.7, the one thing that stops the panel
repeating the old per-unit table's lie) had never been rendered in production.

*Fixed by one emission at the site beside the conditional's.*
`explainMovesetNow` puts its answer on the sink (`framedBreakdown`) on both
success paths, including the evaluator that does not explain; the `breakdown`
event kind carries what 01 §3.3 says a breakdown row holds — moveset, basis,
level-1 `aggregate`, level-2 `marginals` each against the reference action it
was priced against, and the named `residual`, mandatory and carried at zero.
The reducer files it under its moveset key, `ingestLensEvents` encodes it
verbatim, and `storeFromRows` gives it back, so the panel draws the same rows
live and in replay; the `movesets` projection is untouched, because a breakdown
is a fact about a row and not a row. `lens-replay-parity.test.ts` records a
drilled decision and asserts the event on the wire and in storage, the residual
on the folded frame, and `panel.breakdown.residual` in both transcripts.

---

## Band B — the number does not mean what it will be read as

### B1. Three numbers on one row, from two channels, none of them labelled

`movesetOps` prints the aggregate as `row.channel === 'lo' ? row.lo : row.est`,
the width as `hi − lo`, and Δ as `row.lo − leader.lo`. The reservoir ranks rows
on `(lo, est, hi, tie)` (`kernel/reservoir.ts::byBetter`). So on an `est`-channel
row the operator reads an estimate, bracketed by a proved-floor width, ranked
and differenced on the proved floor — and nothing on screen says which number is
which. `est` is the channel that *never adjudicates* (`types.ts`), and this is
the one place it was being shown as if it did.

*Fix:* the aggregate column is `lo`, always — the quantity `⌈w⌉` brackets, the
quantity the rank is on, and the quantity Δ measures. The est channel keeps its
own voice in the `unless` cell (`floors equal — advisory …`).

### B2. `Nq` in the provenance line is a count of emissions

`frameAt` does `quantaSpent += 1` per `emission` event. The rail renders it as
`…q`, next to `e<seq>`, in a system where a quantum is a search slice
(`Reading.quanta`, and 07's `1,180q`). Emissions per board turn are 7–10 (07
§1), so the line reads `9q` for a decision that spent thousands.

*Fix:* take the real reading — the largest `depth.deepest.quanta` over the rows
the frame is holding.

### B3. `⌈w⌉`, `h1`, `Q`, `unless`, `rung` — the vocabulary has no legend anywhere

Every one of these is on screen with no gloss, and three of them are also used
elsewhere in the codebase to mean something else:

- `rung`: the row's own `MovesetRung` (`seed | sweep | pair | polish | restart |
  conform` — *how the row was found*) is never displayed, while the foil line
  called a dominance clause "the deciding rung" (A5).
- `h1`: the horizon of the deepest reading. On this build it is always 1 by
  construction (`08` §1.1), which is honest and unreadable.
- `⌈w⌉`: `hi − lo`, the bracket width — "slack in its honest form" (06 §2.2).
- `unless`: the row's `DominanceCondition`, the threat/opportunity map.

The clauses I own are now written as sentences rather than tokens where there
was room. The legend belongs in the rail's panel heads, which are
`lens-panel.js`'s markup, and it is there now — one line under the MOVESETS
head, glossing all four (item 5 of *Handed over* below).

### B4. The foil's per-member Δ badge is the whole-moveset margin

`boardOps` pushes `call('foil.delta', move.unit, foil.lo − selected.lo)` for
**every** differing member — the same cluster-level number on each unit's cell,
labelled as that unit's contribution difference (02 §3.5 asks for "that member's
contribution difference"). Two differing members get the same badge; the badge
is not about either of them.

*Fix:* derive the badge from the two rows' member marginals when a breakdown is
in the frame, and draw no badge when it is not. Since A6 the frame can hold
one, so the badge is drawn on a drilled row and absent on every other — which
is the honest state either way.

### B5. `tMono` is a wall clock on a bot whose clock is the work clock

`frameAt` sets `tMono: last.atWall - anchor.atWall`, while every event carries
`atWorkMs` — *"the KERNEL's clock from t0 … the axis that replays; wall time
does not"* (`types.ts`), fractional and stored as `double precision` after 07
§4.3. The frame's own time axis is therefore the one axis a re-run does not
reproduce.

*Fix:* prefer `atWorkMs`, fall back to the wall delta when the event was never
measured.

### B6. The focused unit's exclusion is drawn on the board and not explained in the rail

`clusterOf` searches `members` only, so focusing a pinned or committed unit
yields `cluster = null` and the FOCUS panel says **"unclustered"** — for a unit
that is very much part of a cluster's problem, as a constant. `boundingOf`
returns exactly the missing fact (`why`, `by`) and had no callers.

*Fix:* the focus panel names the cluster the unit is bounding, its reason, and
the operator who caused it. "Operator-pinned units are excluded" is then a
sentence the rail says, not just a padlock the board draws.

### B7. The candidate count reads as "the unit's legal moves"

`panel.candidates` carries `rows.length`, and the rows are only the destinations
this decision priced (deliberately — 04 §2.5). The design's header is `9 legal`;
the rail's is the same shape with a much smaller number. *Fix:* the note says
what the list is.

---

## Band C — emitted by the kernel, never seen

### C1. `Q` — the loud product — is measured, shipped, stored and dropped

`LoudReading` (`src/lobster/bounds/loud.ts`) is measured on the leader's own
plan, carried on every `movesets` frame (`MovesetsPayload.loud`), written to the
event log — and `frameAt` never reads it. `08-DEPTH-VERDICT.md` §4.5 and gate
G-D6 ask for exactly this cell: *"`h1 · Q=340` … the absence of depth is drawn,
never omitted, and now it is drawn with its reason."* Today every row reads
`h1 ·` and the reason is nowhere.

*Fix:* the frame carries the reading; the leader's depth cell reads `h1 · Q=n`.
It is the leader's row and only the leader's, because that is the plan the
reading was taken on.

### C2. `PartitionPayload.changes` — and why the fold is right to drop it

`diffPartitions` derives `split | merge | narrowed | widened` with lineage and
puts them on every partition frame; the fold keeps only `clusters`. That is the
correct call and it stays: a `ClusterEvent` is *"DERIVED by diffing successive
partitions, never asserted"* (`types.ts`), and the diff the operator is owed is
between the two frames THEY saw, not between two the kernel saw. The defect was
never the drop — it was that the view's own derivation keyed on an id that
moves (A4). Recorded here so the next reader does not fix the wrong half.

### C3. The depth column's evidence

`DepthColumn.line`, `lineTruncated`, `derived` (Law H′'s `hull, not derived`),
`delta.attribution` (`width / terminal / residual`), `rankAtH1` and `confidence`
are carried on every row and none of them is rendered. On this build the line is
empty and the deltas are zero, so nothing is being *hidden* yet — but 06's Rule
L-1 ("a row with a depth number and no line is a number the operator cannot
check") has no implementation, and the day a row reads `h2` there is nothing to
check it against. The LINE panel of 06 §2.3 does not exist.

### C4. `refusal`, `posture` and `rung` frames reach the lane and nothing else

`LANE_OF` maps them to the kernel lane, which is right. But a `refusal` tick
carries `EmitRefusal` and a `posture` tick carries a channel flip — the two
events that explain a table changing under the operator — and the tick's only
text is its kind.

---

## Band D — dead code, duplicated code, stale doc text

| # | what | why it is dead |
|---|---|---|
| D1 | `LENS_INK` (`view/index.ts`) | a second copy of the palette. `board-renderer.js::LENS_THEME` is the one the board actually draws with and the one `lens-ink.test.ts` checks; nothing imports `LENS_INK` |
| D2 | `LensTransport`, `withTransport`, `LiveSourceInput.transport` | no caller has ever supplied a transport — the page asks over its own socket messages. Worse, `withTransport.breakdown` **bypasses the store's stored-breakdown-first rule**, which is the clause that makes a drilled row in replay the row that was drilled live (Law C) |
| D3 | `requestConditional` / `requestBreakdown` | one-line wrappers around `source.conditional` / `source.breakdown`, called by nothing |
| D4 | `depthArrivals` | the timeline's depth badge (08 §4.6). No caller; the ceiling ply is not merged (08 §7), so no row can deepen. Deleted with the doc line that cites it |
| D5 | `gestureState` / `resetGestureState` | accessors on module-level gesture state that nothing outside the module reads; the state is reset by the turn-boundary transition, `planLock` and `checkDivergence` |
| D6 | `DepthCell.width` | computed from the deepest reading and never rendered; the row's own width arg was `row.hi − row.lo`, which is the *current* bracket rather than the deepest one (they are equal today and diverge the day depth lands) |
| D7 | `emptyStateLine`'s `+ (emissions > 0 ? '' : '')` | appends the empty string either way; the `emissions` count it was computed for was never used |
| D8 | `08-DEPTH-VERDICT.md` §3.4 and §4.6 | cited `decidingRung` and `depthArrivals` by name and line: one is renamed and now drawn per row, the other is deleted |
| D9 | `02-INSPECTION-UI.md` §1.2 `cursor.cluster`, §1.3 T5, §3.8 `\`, §1.4's `minimalPinSet` fallback and §5 Q2/Q3 | a cursor level, a transition, a key binding and a `pins ≤ n` affordance that the shipped machine does not have and a test forbids. 04 closed Q2 and Q3; the design text still put them open |

---

## Handed over, and now closed

**Owned by `src/web/lens-panel.js` / `play-game.html`** — all seven **FIXED**:

1. **A1's page line.** `historicFrameFor` folds through `replayFrameAtSeq`.
2. **The rail duplicated the badge component.** The lane's badge is
   `modeBadge` + `provenanceBadge`; the page's hardcoded
   `'⏸ SCRUBBED · [N] to return to now'` — which is how a replayed turn came
   to claim it was scrubbed — is gone.
3. **The lane was built twice.** `renderTimeline` emits ticks for
   `frame.events`, which is truncated at the playhead, so a lane built from
   them shrinks as the operator scrubs back. The page's rows over the whole
   turn are the survivor; `laneEventsFromTranscript`, the second builder, is
   deleted.
4. **`LANES` gained the `anchor` lane**, and the page's lane map sends
   `board.arrived` and `turn.resolved` to it: the two ends the lane is defined
   between have a tick.
5. **The legend for B3** is one line under the MOVESETS head:
   `⌈w⌉ bracket width · h<n> horizon proved at · Q loud replies · unless what this row is betting on`.
6. **The empty rail** says `emptyStateLine`'s sentence, which tells A3's four
   emptinesses apart. The page's second copy is deleted.
7. **`lens-breakdown-rows` / `lens-conditional-rows`** are the receipt and say
   so: both answers reach the page as recorded frames through the fold — the
   same bytes replay reads — and what the reply carries that the fold cannot is
   the typed refusal, which is rendered as the answer it is.

**Kernel-side and socket-side** — both **FIXED**:

- **A6's `breakdown` lens frame.** `LobsterKernel.explainMoveset` emits one
  beside the conditional's, so a drilled row is a recorded fact. What the
  kernel decides is untouched: the emission is a thunk on the existing sink,
  and no reading is retaken.
- **A client that joins mid-turn now receives `board.arrived`.**
  `WebSocketServer.broadcastLensFrames` keeps the turn's anchor per game and
  replays it on subscribe. Without it a late subscriber's fold anchored on
  whatever arrived first, dropped that event, and `boardOf` fell back to a 0×0
  board.

**Still open**, and deliberately: **C3** (the depth column's evidence — there
is nothing to hide yet on a build where no row deepens, and the LINE panel of
06 §2.3 does not exist) and **C4** (`refusal`, `posture` and `rung` ticks whose
only text is their kind).

---

## What the two branches changed

`lens-audit` closed every Band A and Band B finding whose code is in
`src/lens/**`, the whole of Band D, and C1. C2 is answered rather than changed
— the fold is right and the view's derivation was wrong, which A4 fixed.

`lens-2` closed what was left: A6 at its kernel emission site, the mid-turn
joiner's anchor on the socket, and the seven page-side items above. The two
exports `lens-audit` kept without callers now have them — `modeBadge` /
`provenanceBadge` in the lane's badge, and `replayFrameAtSeq` in
`historicFrameFor`.
