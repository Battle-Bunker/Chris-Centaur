# 01 — UNDER THE CURRENT CONTROLS: the call

DRIVES lens, second document. `00-FRAMEWORK.md` defined the object and closed
the joint list. This one answers the question the owner actually put:

> *"The current control UI should remain fairly stable for now, but if you see
> the way to elegantly architecting the framework of drives and preferences
> underneath the current controls such that it simplifies code and integrates
> well with the new bot architecture while leaving the human UI familiar, make
> the call if it reduces complexity and technical debt."*

Two options:

- **(i) BESIDE.** Keep `SnakeIntent` and its ladder; add drives as a second,
  parallel channel that reaches the fold. Right-click still sets a goto; a new
  affordance sets a drive.
- **(ii) UNDER.** Re-express the current intents *as* drives. Right-click still
  sets a goto — and a goto is now a drive row with a route-completion
  condition, priced inside the search like every other member.

**The call is (ii).** Not because it deletes the most lines — it deletes
roughly 430–480 net, which is real but not decisive — but because **(i) makes
permanent a defect that (ii) removes**, and because two of the code paths (ii)
deletes are paths the concurrent rewrite is currently planning to *port*.

The rest of this document is the evidence, the accounting, the risk, and the
commit sequence.

---

## 1. What settles it is not a preference, it is an audit

Before comparing designs it is necessary to say precisely what the current
controls do, because the answer is not what the code's own comments say. Every
claim below is `file:line` in this worktree (`feature/drives-preferences`).

---

## 2. The audit: today's goto, traced end to end

### 2.1 The snake path under `CENTAUR_ENGINE=lobster`, in four steps

**Step 1 — the search never hears the target.** The lobster team decision
engine takes `TeamTurnInput`; nothing in `src/lobster/` reads a waypoint,
a goto or a target. The one occurrence of the word "waypoint" in the entire
directory is a comment in `team-decision-engine.ts:8` saying the precedence
ladder *"runs untouched in the manager"*. The legacy path is different — 
`firebase-interface.ts:1539-1542` fetches `getActiveWaypointTarget` and passes
it into `strategy.getBestMoveIterative(view, ourTeam, waypoint, …)` — but that
branch is the one the concurrent rewrite deletes. **Under the engine we are
keeping, the operator's target is not an input to the decision.**

**Step 2 — the manager re-scores the search's output.**
`computeIntendedMove` (`active-game-manager.ts:2019-2062`) reaches
`getWaypointBiasedMove` (`:1838-1899`) for a `goto` or `near` intent. That
function re-runs the selection over `turnData.moveEvaluations` as:

```
adjusted(move) = engineScore(move) − recordedWaypointContribution(move)
               + weight × progressStat(move)                    (:1825-1832)
```

where `weight` is `breakdown.weights.gotoProgress ?? DEFAULT_CONFIG.gotoProgress`
(`:1876-1878`) and `recorded` is `breakdown.weighted.gotoProgressScore ?? 0`
(`:1879`).

**Step 3 — every key it reads belongs to a vocabulary the rows do not use.**
Under lobster the rows come from `buildDecisionRows`; their breakdown is built
by `breakdownOf` (`telemetry.ts:672-683`), which writes `weights[key]` and
`weighted[key + 'Score']` **keyed by lobster feature names** — `material`,
`reach`, `room`, `food`, … The file says so in as many words
(`telemetry.ts:126-132`: *"with the lobster feature names as their keys … `engine`
is what tells a renderer which vocabulary it is looking at"*). So:

| read | intended value | actual value under lobster |
|---|---|---|
| `weights.gotoProgress` | the operator's configured goto weight | `undefined` → `DEFAULT_CONFIG.gotoProgress` = **300** (`heuristics.ts:266-267`) |
| `weighted.gotoProgressScore` | the contribution already inside the score | `undefined` → **0** |
| `breakdown.trapped` | the fatal-pocket flag | `undefined` → **0** |
| `breakdown.regicide` | "this move ends our own team" | `undefined` → **0** |

The first two produce a **scale collision**. `engineScore` is a lobster bound
read on a scale where `material` is 10, `food` is 4, `room` is 3 and
`momentum` is 1, every one of them deliberately an order of magnitude inside a
cliff denominated in `CLIFF_MATERIAL_WEIGHT = 10` (`calibration.ts:47-90,161`).
A bonus of `300 × stat`, `stat ∈ [0,1]` (`waypoint.test.ts:103-109`), is not a
vote in that fold; it is a verdict. The legacy scale it was calibrated for had
`deaths` at −500 and `trapped` at −600 (`heuristics.ts:210-211,303-304`), and the
comment there states the whole safety argument as an ordering between those
three numbers — an ordering that does not survive being moved onto a scale
where the largest ordinary term is 10.

The second two disable both vetoes. `pickBestMove`
(`decision-engine.ts:91-104`) filters on `regicide < 0.5` then `trapped < 0.5`;
with both defaulting to 0 every candidate survives both filters and the
function is a bare argmax.

**Step 4 — the result becomes a binding constraint on the next decision.**
The staged move carries `source: 'waypoint'`; `PINNING_SOURCES` is
`{'manual', 'waypoint'}` (`pin-events.ts:70-74`), so `observeStaged`
(`:136-144`) mints a pin, which reaches `TeamPinLedger` (`pins.ts:53`) and then
`SearchContext.pins`. **The direction a legacy-scaled argmax picked outside the
search is handed back to the search as fact.**

### 2.2 The failure is invisible to the tests, and the reason is instructive

`waypoint.test.ts:481-494` is called *"the goto weight cannot buy a fatally-
trapped move (veto survives the bias)"* and it is green. Its fixture,
`makeEvaluations` (`:378-389`), hand-builds

```ts
breakdown: { trapped: 0, weights: { gotoProgress: 300, nearProgress: 250 },
             weighted: { gotoProgressScore: 0, nearProgressScore: 0 } }
```

— the **legacy** shape, described in its own comment as *"shaped like the
strategy's mapping"*. The test asserts a property of a vocabulary that
production no longer produces. This is not sloppiness; it is what happens when
one layer's contract with another is a bag of optional keys read through `??`.
The framework's answer is §2's compiled object: one constructor returning the
member list and the weight table together, *"so the two can never disagree"*.

### 2.3 The piece path is honest, separate, and therefore a second evaluator

Pieces do not take that path. `computePieceStagedMove` (`:2290-2384`) resolves
`goto` through `bestPieceCandidate` (`:2385-2470`) over
`computePieceCandidates` (`:2471-2573`), which builds its own candidate set,
runs each ray through the vendored engine (`evaluateCandidatePath`, `:2542`),
and scores

```
weight × stat + healthLoss × cost + deaths × fatal + regicide × endsOurTeam + …
```

with real `fatal` and `regicide` flags, so its vetoes hold (`:2386-2400`). It
is good code and its reasoning is written down. It is also **a second scoring
pipeline**, on the legacy weight scale, deciding a unit the lobster kernel has
just decided jointly with the rest of the team. Its comment concedes the point:
*"The bot has no piece evaluator yet, so every candidate's base weight is 0 and
the waypoint stat is the only POSITIVE signal ordering them"* (`:2447-2451`).
That premise is now false — `command`, `energy`, `tier` and `material` all price
pieces inside the fold — and the layer has outlived its reason.

### 2.4 The three findings, sorted

| # | finding | kind |
|---|---|---|
| **F1** | Under lobster the snake goto re-bias applies a 300-weight bonus on a scale whose largest ordinary term is 10, and both its safety vetoes read absent keys and pass everything | **bug**, fixable today, independent of drives |
| **F2** | A goto is already a determination (`PINNING_SOURCES` includes `'waypoint'`), so joint (c) is doing joint (a)'s work, one turn late | **architecture** |
| **F3** | The piece goto runs a second, separate evaluator on the legacy scale beside the joint search | **architecture** |

F1 must be repaired regardless of which option is chosen — §6, M1. F2 and F3
are what the two options actually differ about.

---

## 3. Option (i): drives beside the intents

Keep `SnakeIntent` (`:268-281`), its four-rung ladder (`:2019-2062`), the
waypoint re-bias, and the piece mini-evaluator. Add a `Drive` row type, a fold
member per drive, and a new UI affordance for setting one.

**What it costs.** Two ways to tell a unit where to go, with different
arithmetic, different safety guarantees, and different transports. An operator
who right-clicks gets a determination priced outside the search; an operator
who adds a `goto` *drive* gets a member priced inside it. Both are called
"goto" in the UI. The two disagree in exactly the cases that matter — a target
that costs material, a target across a contested file — and no surface exists
that can explain the disagreement, because joint (d) can only report on the
half it can see.

**What it buys.** Nothing this branch needs. It does not remove F1 (the
re-bias survives), it does not remove F2 (the pin still fires), it does not
remove F3 (the piece evaluator still runs), and it adds a second vocabulary to
a UI whose stability is the constraint. It also leaves the concurrent rewrite
holding `getWaypointBiasedMove`, whose only import of `pickBestMove`
(`active-game-manager.ts:17`) is the last non-test consumer standing between
that branch and its 844-line delete of `decision-engine.ts`
(`ONE-ENGINE-PLAN.md` §3.1).

Option (i) is the option that ships two systems and calls them one feature.

---

## 4. Option (ii): the intents *are* drives

### 4.1 The mapping, command by command

Every current control keeps its key, its mouse button, its wire message and its
on-screen rendering. What changes is what the server does with it.

| control | today | under (ii) | joint |
|---|---|---|---|
| Right-click cell | `set-waypoint` green → `intent: goto` | `set-waypoint` green → drive row `{ constructor: 'drive/goto-ramp@1', referent: cell, lifetime: until/latched, weight: default }` | (a) |
| Shift+Right-click | append/toggle in the goto queue (`:1470-1474`) | append/toggle a cell in the row's `referent.cells` — a region referent, ordered | (a) |
| Ctrl/Cmd+Left-click | `set-waypoint` blue → `intent: near` | drive row `{ constructor: 'drive/near-ramp@1', referent: cell, lifetime: standing }` — *near is goto without a completion condition* (`00-FACTORING.md:86,118`), which under (ii) is one field, not a second command | (a) |
| Arrows / WASD / numpad + Space | `intent: manual` → pin | unchanged transport; a row with `authority: 'determine'`, `lifetime: turn` exists so the UI, replay and echo see one vocabulary | (c) |
| `h` | `intent: hold` → staged as `source:'manual'` (`:2306-2316`) | row with `authority: 'determine'`, `lifetime: standing`, re-minting a turn-scoped pin at each ingestion (`00-FRAMEWORK.md` §3.3) | (c) |
| `Delete` | `clearHumanInput` → `intent: heuristic` (`:1572-1583`) | remove every operator-authored row on the unit; the seated preferences remain | (a)+(c) |
| `Ctrl/Cmd+Enter` | Submit All | **untouched.** A commit is a move, not configuration (`00-FRAMEWORK.md` §5.3) | — |
| `Tab`, `Escape` | selection | untouched | — |
| config sliders `gotoProgress` / `nearProgress` | `HEURISTICS` entries surfaced by `CONFIG_UI` (`heuristics.ts:266-286`, `:501`) | the drive constructor's default weight, in the bot binding — *preferences at rest* | (a) |

The mutual exclusion the union enforced structurally becomes a set, which is
the point: `goto(A, cell)` and `avoid(A, region)` coexist and fold additively
(`00-FRAMEWORK.md` §4.2–4.3). The ladder (`:2019-2062`) survives only as the
one genuine precedence — a `determine` row outranks every `weight` row, which
is the pin path doing what it already does.

### 4.2 What (ii) deletes

| file | region | lines | disposition |
|---|---|---|---|
| `active-game-manager.ts` | `getWaypointBiasedMove` `:1838-1899` | 62 | **deleted whole** — the fold prices the drive |
| `active-game-manager.ts` | `computePieceCandidates` `:2471-2573` | 103 | **deleted whole** — F3 |
| `active-game-manager.ts` | `bestPieceCandidate` `:2385-2470` | 86 | **deleted whole** — F3 |
| `active-game-manager.ts` | `computePieceMoveEvaluations` `:2645-2704` | 60 → ~15 | reads the lobster telemetry rows instead of re-deriving |
| `active-game-manager.ts` | `computePieceStagedMove` `:2290-2384` | 95 → ~45 | the goto rung goes; manual/hold/bot rungs stay |
| `active-game-manager.ts` | `computeIntendedMove` `:2019-2062` | 44 → ~14 | manual and the bot rung; goto/near are no longer rungs |
| `active-game-manager.ts` | `SnakeIntent` + `IntentMode` `:268-281` | 14 → ~4 | the union collapses; `IntentMode` becomes a projection of the live drive set for the client contract |
| `active-game-manager.ts` | `checkGotoArrival` `:3459-3513` | 55 → ~20 | completion becomes a joint (d) event; the queue shift is a lifetime transition |
| `heuristics.ts` | `gotoProgress` / `nearProgress` `:266-286` | 21 | **deleted** — the weight moves to the constructor and the binding |
| `waypoint-pathing.ts` | `waypointProgressByDestination` `:325-357` | 33 | **deleted** — its only two callers are the two mini-evaluators above |
| `active-game-manager.ts` | `pickBestMove` import `:17` | 1 | **the last non-test consumer of `decision-engine.ts` (844)** |

**Net deleted: ~430–480 lines across three files**, plus the removal of the
import that blocks an 844-line delete on the concurrent branch.

**What is deliberately NOT deleted.** `refreshGotoRoute` (`:1667-1837`, 171
lines) stays: the drawn green route is display, it is derived from the live
board every stage, and the operator needs to see the path the drive is pulling
along. `waypointRoute` / `waypointPath` / `gotoProgressStat` / `nearProgressStat`
(`waypoint-pathing.ts:130,231,277,297`) stay and become load-bearing — the
ramps *are* the two day-one drive members, with a unit-tested table already
standing (`waypoint.test.ts:62-94`), which is `00-FRAMEWORK.md` I6's whole
argument for why the catalogue may open with exactly these two. `setWaypoint`
(`:1475-1571`) keeps its validation, ownership check and append semantics; only
its final write changes from `setIntent` to a drive edit.

### 4.3 What (ii) adds

| file | lines | what |
|---|---|---|
| `src/lobster/evaluate/drives.ts` (new) | ~180 | the `Drive` row, `profileFor`, `featuresFor`, the constructor catalogue, `goto-ramp@1` and `near-ramp@1` as `Feature<EvalContext>` |
| `src/lobster/drive-set.ts` (new) | ~120 | per-game live set; the fold of `drive.*` events; the accept-time budget check (I4) |
| `src/lobster/evaluate/laws.test` additions | ~80 (test) | `checkSoundness ∧ checkMonotone ∧ checkCollapse` per constructor — the catalogue admission fee (I1) |
| `team-decision-engine.ts` | ~25 | compile the drive set into the profile at decision start |
| `websocket-server.ts` + manager | ~60 | the three existing messages (`set-waypoint`, `toggle-hold`, `clear-human-input`, `:57-58,547-592`) translate to drive edits |
| operator-behaviour suite (new) | ~250 (test) | §6 M0 |

**Added: ~385 source, ~330 test.** So the honest net on source lines is roughly
**−80 to −100** — a wash. **(ii) is not a line-count win; it is a
one-evaluator win.** The lines it removes are the lines that constitute a
second scoring pipeline, and the lines it adds are a catalogue with a law
harness. That is the trade, stated plainly.

### 4.4 What (ii) buys that (i) does not

1. **F1 stops being possible**, not merely fixed. There is no second scale to
   collide with, because there is no second evaluator.
2. **F2 inverts.** `PINNING_SOURCES` narrows to `{'manual'}`. A goto enters at
   joint (a) as a member the search prices *while deciding*, instead of at joint
   (c) as a constraint on the decision after. This is what the shipped comment
   at `:2014-2016` always claimed was happening.
3. **F3 disappears.** One fold prices snakes and pieces alike.
4. **The fatal gate's stated reasoning becomes true again.** `stageMove` (`:2155-2163`)
   excludes `'waypoint'` from the fatal-move consent prompt *because* "a
   goto/near direction is BOT-chosen — the heuristic matrix with the waypoint
   weight integrated — so the bot's own death-aversion already arbitrates it".
   Under lobster today that is false at every clause. Under (ii) it is true at
   every clause, and the exclusion is correct rather than lucky.
5. **The concurrent rewrite gets smaller** — §7.
6. **The repertoire opens.** Adding `avoid`, `escort`, `trap` costs one member
   and one law case each, at a joint whose law is already proved, rather than a
   rung on a ladder and a veto to write.

---

## 5. The recommendation, and the risk that is actually there

**Recommend (ii).**

**The UI-stability risk is not where it looks.** Every keyboard and mouse
control keeps its binding: right-click goto, Shift+Right append, Ctrl+Left
near, arrows/WASD/numpad and Space for manual staging, `h` hold, `Delete`
cancel, `Tab` cycle, `Ctrl+Enter` Submit All, `Escape` deselect
(`play-game.html:2500-2545`, `:3335-3372`, `:3396-3418`). Every websocket message
keeps its name and payload (`websocket-server.ts:57-58,547-592`). Every client
projection keeps its shape — `waypoints`, `routes`, `activeIntentModes`,
`operators`, `stagedMoves` (`active-game-manager.ts:319-328`) — with
`activeIntentModes` becoming a derived read of the live drive set rather than
of a union discriminant. **No pixel and no keystroke moves.**

**The risk is that the moves change.** Today a snake's goto is effectively a
path override worth 300 on a scale of 10. Under (ii) it is a bounded [0,1] ramp
at a weight the budget invariant (I4) caps well inside the cliff. **A goto that
today walks the shortest path regardless will, under (ii), sometimes decline a
step that costs material or walks into contested ground.** That is precisely
the designed behaviour — *"a click-target never dictates the move"* (`:2014-2016`) — and it
will read to the operator on day one as the bot ignoring them.

Three mitigations, all cheap, all in the commit sequence:

- **Calibrate before switching, not after.** The drive's default weight is
  chosen so the ramp's maximum contribution sits at the top of the fold's
  ordinary discrimination band — comparable to `food: 4` on its own [0,1]
  range, i.e. the term calibration already argues can order a move without
  buying a life (`calibration.ts:78-85`) — and the accept-time budget check
  refuses anything that could outbid the cliff, loudly, with the headroom named
  (I4).
- **Ship joint (d) with the switch, not after it.** The `outvoted` event is the
  answer to "why didn't it go there", and without it a drive that loses is
  indistinguishable from a drive that was never received. If the search lens's
  `set_aside` ledger has not landed, ship the weaker read off `parts`
  (`bound.ts:171-176`) — *"your goto contributed +0.8 against a winning margin
  of 2.1"* — which needs no new instrument (`00-FRAMEWORK.md` Q5).
- **Keep the flag until the operator says so.** M4–M6 run behind a per-game
  flag with both paths under the same behaviour suite, so a comparison is one
  toggle rather than a revert.

**The risk of NOT doing (ii)** is F1 shipping indefinitely: an operator command
that silently disables the two safety vetoes protecting the unit it commands.

---

## 6. The migration, in commits, tests first

Each step is independently revertible and each keeps every keyboard command
behaving identically unless the line says otherwise.

**M0 — the operator-behaviour suite, written first, no source change.**
A suite that drives `ActiveGameManager` through *the exact wire messages the UI
sends* (`set-waypoint` green/blue/append, `toggle-hold`, `clear-human-input`,
manual selection, `commitAllStaged`) and asserts the observable operator
surface: the staged move, `activeIntentModes`, `waypoints`, `routes`,
`operators`, the fatal-consent prompt, and the pin events emitted. It asserts
*behaviour*, never `intent.kind`, so it survives the union's deletion.
Parameterised over both `CENTAUR_ENGINE` values.

In the same commit, `waypoint.test.ts`'s `makeEvaluations` (`:378-389`) gains a
lobster-shaped variant built from `breakdownOf`'s real output.
**`waypoint.test.ts:481` — the fatally-trapped veto test — will fail under
that fixture.** That failing test is the first deliverable of this branch: it
is F1, made visible, on the current architecture.

**M1 — repair F1, on the current architecture.** Either make
`getWaypointBiasedMove` read the lobster vocabulary and scale (translating the
weight into the fold's units and reading `bounds`/`features` for the fatal and
regicide facts), or make it **refuse to re-bias** when the breakdown's `engine`
tag is not the one it knows, falling through to the bot move labelled truthfully
— which is the behaviour `:2035-2038` already documents for the
no-evaluations case. Prefer the refusal: it is smaller, it is honest, and it is
deleted by M7 anyway. Turns M0 green. **Ship this even if the owner rejects
(ii).**

**M2 — the framework, inert.** `drives.ts`: the row type, the catalogue,
`goto-ramp@1` / `near-ramp@1` over the existing ramps, `profileFor`,
`featuresFor`, and the law cases. Nothing calls it. The gate is I5: `profileFor(base, [])`
returns a byte-identical weight table and an unchanged `evaluationIdentity`.
*The object proves itself by changing nothing.*

**M3 — the seam.** The team decision engine compiles the live drive set into
the profile at decision start; both `checkWeights` call sites
(`bot-binding.ts:314`, `evaluate/index.ts:109`) take `featuresFor(profile)` as
their second argument. The live set is empty in production. Behaviour
unchanged; `evaluationIdentity` unchanged.

**M4 — goto and near become drives, behind a flag.** `setWaypoint` writes drive
rows *and* keeps the intent union in sync (both, deliberately). With the flag
on, `getWaypointBiasedMove` returns null and the fold decides; with it off,
today's path runs. M0's suite runs both ways and the diff between them is the
calibration evidence. This is the commit whose behaviour the owner judges.

**M5 — the piece path.** `computePieceStagedMove`'s goto rung reads the
lobster recommendation, which now prices the drive. Delete `bestPieceCandidate`
and `computePieceCandidates`; `computePieceMoveEvaluations` reads the telemetry
rows. Gated by `piece-staging.test.ts` (747) and `piece-bot-route.test.ts`
(344), which assert the offered destinations and the staged action and are
untouched by this change.

**M6 — manual and hold get rows; the pin narrows.** The transport does not
move — pins stay pins. The row exists for the UI, replay and echo. In the same
commit `PINNING_SOURCES` narrows to `{'manual'}` (`pin-events.ts:70-74`),
because a goto now enters at joint (a) and must not also arrive at joint (c) a
turn later. This is the one commit that changes what the kernel is constrained
by, and it wants its own soundness run.

**M7 — the deletion.** Remove `getWaypointBiasedMove`, the `SnakeIntent` union
and its ladder rungs, the `pickBestMove` import, `waypointProgressByDestination`,
and the `gotoProgress` / `nearProgress` config entries. Remove the flag.
`activeIntentModes` becomes a projection of the drive set. This is where the
~430–480 lines go.

**M8 — joint (d).** `drive.add` / `drive.remove` / `drive.reweight` /
`drive.completed` as `TurnEvent`s, `outvoted` included, folded into the live set
and rendered in the operator surface.

M0–M3 change no behaviour at all. M4–M6 change behaviour behind a flag. M7 is
pure deletion. M8 is additive.

---

## 7. What should fold into the concurrent rewrite NOW

`claude/succession-doc-subagent-orchestration-n41iua` is planning edits to code
that (ii) deletes. Four items, each a message to that branch, each saving it
work:

1. **Do not repoint `pickBestMove`; the caller is going away.**
   `ONE-ENGINE-PLAN.md` §3.1 lists `active-game-manager.ts:17` as one of two
   live consumers of `decision-engine.ts` (844 lines), the other being the
   legacy branch it deletes. That import exists *only* for
   `getWaypointBiasedMove` (the call is at `:1872`; §3.1 cites `:1875`). If (ii)
   is accepted, the rewrite should
   plan on **deleting `getWaypointBiasedMove` outright** rather than writing a
   ~40-line replacement argmax for it. This is the single highest-value item
   here: it removes the last thing standing between that branch and its
   844-line delete.

2. **Three of the five `BoardGraph` / `piece-moves` call sites need no
   adapter.** §2.5 budgets `active-game-manager.ts` at −~90 lines for
   repointing `piece-moves` (`:15,2342,2364,2485`) and `BoardGraph`
   (`:7,1687,1869,1961,2514`) at `logic/staging-legality.ts` and
   `logic/route.ts`. But `:2485` and `:2514` are inside `computePieceCandidates`
   and `:1869` is inside `getWaypointBiasedMove` — all three deleted by (ii).
   What still needs the adapters is `:2342` and `:2364` (the `planPieceAction`
   legality checks on the manual and bot rungs, both of which survive),
   `canHold` at `:1614` (which §2.5 does not list at all — worth adding to its
   inventory either way), `:1687` (the route display) and `:1961` (the fatal
   check). Three of the eight sites go away for free.

3. **`waypoint-pathing.ts`'s port is smaller, and the ramps must survive it.**
   §2.5 has it at 381 → ~260 via `logic/route.ts`.
   `waypointProgressByDestination` (`:325-357`) is deleted by (ii), so the port
   is ~33 lines lighter. Conversely `gotoProgressStat` / `nearProgressStat`
   (`:277-306`) become the two day-one drive members and **must be ported
   unchanged**, along with their table test (`waypoint.test.ts:62-94`) — they
   are load-bearing under (ii) in a way they are not today.

4. **`gotoProgress` / `nearProgress` are on the heuristics prune list after
   all.** §2.5 says `config/heuristics.ts` goes 501 → ~380 by pruning "the
   weights only `board-evaluator` read (verify at cut time)". These two are read
   by the *manager* (`:1877-1878`, `:2508-2509`), so a careful cut keeps them.
   Under (ii) they go, and their config-UI rows (`heuristics.ts:501`) go with
   them.

And one item for `feature/decision-lens`: **add the four `drive.*` kinds to
`TurnEventKind` while that union is being written**, beside `'operator.command'`
and `'pin'`, rather than as a later amendment to a shipped type. `turn_events`
needs no schema change to carry them (`04-SYNTHESIS.md` §4.2–4.3).

---

## 8. Open questions for the owner

- **S1 — sequencing.** Does this branch land before, after, or interleaved with
  the one-engine rewrite? Interleaved is cheapest (§7 items 1–2 shrink the
  rewrite) and riskiest (two branches editing `active-game-manager.ts`). After
  is safest and pays for the rewrite to port code it will then delete. The
  recommendation is: **send §7 items 1–4 to that branch now as decisions, land
  M0–M3 (behaviour-free) in parallel, and land M4 onward after the rewrite's
  cut.**
- **S2 — does M1 ship on its own?** F1 is a live defect affecting every
  operator goto on a snake under lobster. It is a small fix and it is
  independent of the (i)/(ii) call. Recommend shipping M0+M1 to `main` without
  waiting for the drives decision.
- **S3 — the goto default weight.** §5's calibration is an argument, not a
  measurement. The honest way to set it is M4's flag: run both paths over the
  acceptance boards and compare staged moves. Is that measurement worth a day?
- **S4 — near's lifetime.** Today `near` never auto-clears (`:281`) and `goto`
  retires on arrival. Under (ii) that is one field (`lifetime: standing` vs
  `until/latched`), which makes "a goto that does not retire" and "a near that
  does" both expressible and both unnamed in the UI. Leave them unnamed, or
  give the operator the toggle?
- **Q1 from `00-FRAMEWORK.md` still stands** and is the one that shapes the
  repertoire: *"beware attack from that unit"* is properly a support demand, not
  a weight, and that port does not exist. Ship graded-aversion fears now, or
  hold the fear vocabulary until it does?
