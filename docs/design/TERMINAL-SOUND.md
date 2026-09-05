# TERMINAL-SOUND — the turn cap made a bound, and switched on

`docs/design/ENDGAME.md` ends with a refusal and a precondition:

> Part (A) is refused, and the reason is worth more than the rule. The cap
> member cannot be switched on anywhere until `finish` prices a `win`-floor
> against a `draw`-ceiling without the `min/max` swap — which is a `bound.ts`
> question, not a `terminal.ts` one, and is the next thing anyone taking this
> row should do.

This is that row. The `win`-floor-against-a-`draw`-ceiling turned out not to be
a pricing question at all: it was a member reporting a floor above its own
ceiling, and the swap was what hid it. Both are repaired here, the runner states
its cap like production, and `model/terminal@1` fires on a real game for the
first time in this repo's history.

---

## 1. The defect, stated once

`capVerdicts` answers per READING: `worst` for the worst-case completion world
and `best` for the best-case one. `finish` then replaces the fold's `lo` with
the first and its `hi` with the second. So the two are a FLOOR and a CEILING
over the same set of worlds, and they owe the ordering
`worst ≤ best` in the lattice `DEAD < interior < WIN`.

The head's bracket branch read:

```ts
const worst = !certainWinners.includes(us) ? 'loss'
            : possibleWinners.length === 1 ? 'win' : 'draw';
const best  = possibleWinners.includes(us) ? 'draw' : 'loss';
```

`best` is not a ceiling. `us ∈ possibleWinners` is exactly the statement that
SOME world has us winning, and a world we win **alone** is worth `WIN` — above
every finite interior number. The comment above those lines argued the point
carefully and argued the wrong one: it asked whether the two sets can prove a
sole win, decided they cannot, and settled for `'draw'` — a reading that is
weaker as a *verdict* and, as a *bound*, simply false.

Two consequences, and the second is the one that reached the bank.

**(i) The ceiling sat under real worlds.** On a board at the count with one held
enemy and us three times its weight, every completion world is our sole win and
is worth `WIN`; the plan's `hi` was the interior fold's own finite number.
`src/lobster/__tests__/terminal-sound.test.ts` is that board.

**(ii) The floor and the ceiling crossed.** `worst === 'win'` requires
`possibleWinners = {us}`, and on exactly those boards `best` said `'draw'`. So
`finish` held `lo = +Infinity` beside `hi =` the interior ceiling — and passed
them through

```ts
clampTo(evaluation.total, Math.min(lo, hi), Math.max(lo, hi));
```

under a comment asserting the clamps "can only ever tighten an interval, never
invert it". True of the elimination corners, whose worlds are ordered by
inclusion. False of the cap's, which are read off two winner sets that are not.
`Math.min` handed the **interior ceiling over as the floor**, the plan came back
as `[interiorCeiling, +Infinity]`, and a second rung certifying a sound ceiling
below it is the fatal bug class the bank throws on.

Measured, cap stated, head `terminal.ts`, `CENTAUR_DEBUG_INVERSION=1`:

| arm | INVERSION lines |
|---|---|
| mixed 30 s1 | 2,906 |
| potions 30 s2 | 835 |
| potions 30 s3 | 1,454 |
| the other nine 30-turn arms | 0 |
| **twelve 30-turn arms** | **5,195** |
| potions 60 s4 / s5 / s6 / s8 | 520 / 2,044 / 196 / 686 |
| **sixteen arms** | **8,641** |

All of them `bank floor=B1 ceiling=B2` and finite-against-finite
(`[222.13404204280567, 202.4482982411528]`) — not the DEAD/WIN clamp, the
promoted interior ceiling. And the pair that produces it is visible at the
moment it happens:

```
CAPSWAP turn=30 limit=30 capWorst=win capBest=draw
        certainW=["blue"] possibleW=["blue"] kinds=["turn-limit"]
```

219 of them on that one arm, plus 120 more at turn 31, plus a `["last-team",
"turn-limit"]` variant: 556 boards, every one of them `capWorst=win
capBest=draw`, and not one of them anything else. The defect has exactly one
shape.

---

## 2. The repair

### 2.1 The member — two corners, each derived from the bound it has to be

```
floor    us ∉ certainWinners        -> loss   some world does not have us
                                              winning or tying
         possibleWinners = {us}     -> win    no other team wins in any world
                                              and we win in every one
         otherwise                  -> draw   we win or tie everywhere, and a
                                              tie is worth the interior number

ceiling  us ∉ possibleWinners       -> loss   no world has us winning or tying
         a RIVAL in certainWinners  -> draw   that team wins in EVERY world, so
                                              we are never alone: no world is
                                              worth WIN
         otherwise                  -> win    some world may be our sole win,
                                              and WIN is the only ceiling this
                                              bracket proves
```

`certainWinners ⊆ possibleWinners` holds per branch in `bracketOutcome`
(a team whose floor clears every rival's ceiling also clears their floors), so
the pair is **ordered by construction**: `'win'` as a floor forces
`possibleWinners = {us}`, which admits no rival to `certainWinners` and so
forces `'win'` as the ceiling; `'loss'` as a ceiling forces `us` out of
`possibleWinners` and hence out of `certainWinners`, which forces `'loss'` as
the floor. The two middles meet at `'draw'`.

**The new ceiling is WEAKER where it says `'win'`**, and that is worth saying
plainly: `+Infinity` is no ceiling at all, so on a board where we might be the
sole winner the search gets no upper bound from the boundary. That is the price
of a sound one. It is paid on the LAST board of a game and nowhere else, and
the alternative — a finite ceiling under worlds worth `+Infinity` — is the
inversion above.

### 2.2 The algebra — a silence that is not a number

`clampTo(total, lo, hi)` took two bare numbers, and `DEAD` and "no floor to
state" are both `-Infinity`: a silence could not be told from a claim, which is
why the call site had to reconstruct the pair with `min`/`max` in the first
place. It takes a `TerminalClamp` now —

```ts
interface TerminalClamp { readonly lo: number | null; readonly hi: number | null }
```

— and REPLACES only the ends a member spoke for:

```ts
const lo = clamp.lo ?? total.lo;   // a lattice element, or the interior FLOOR
const hi = clamp.hi ?? total.hi;   // a lattice element, or the interior CEILING
if (hi < lo) throw ...             // a member contradicting itself; no repair
                                   // here that is not a guess
```

An interior ceiling can no longer reach the floor by any path through this
function. That is the structural half of the fix, and it holds whatever a future
boundary member does.

It is a replacement and not an intersection with `total`, deliberately: the
interior fold is defined only in the interior, so on a board that has ENDED its
number is not a bound on anything and meeting with it would keep a floor no
world stands under. The meet is between the two MEMBERS, `meetClamps`, per side
— a silent member yields to a speaking one, and where both speak the result
CONTAINS both claims (the lower floor, the higher ceiling). Two sound members of
one board cannot disagree (elimination and the cap read the same `adjudicate`,
and a team that is gone is not the sole winner of anything), so a disagreement
is a defect somewhere, and widening is the only combination that cannot
manufacture a bound out of one.

`finish`'s `Math.min`/`Math.max` is gone with them.

### 2.3 What was NOT done

The member was not made inert. It could have been — `lo = DEAD`, `hi = WIN`
costs nothing and is trivially sound — and the reason not to is that three of
its four readings survive the soundness demand intact: `[DEAD, DEAD]` where no
world has us winning or tying, `[WIN, WIN]` where every world is our sole win,
and `[interior, interior]` where a rival wins everywhere. Only the fourth
reading loses its ceiling. A member that still prices a certain loss and a
certain win at the cap is the member `16-TERMINAL.md` and
`08-DEPTH-VERDICT.md` seat; an inert one is the hole `ENDGAME.md` §1 found.

---

## 3. The instruments

| gate | before | after |
|---|---|---|
| sixteen-arm inversion gate, **cap stated** | 8,641 | **0** |
| — twelve 30-turn arms | 5,195 | 0 |
| — four potions 60-turn arms | 3,446 | 0 |
| `npm run gate:exact` | — | **16/16**, `floor=0 ceiling=0`, no class |
| `law-sweep` `terminal.lo` / `terminal.hi` | 0 / **262** | **0 / 0**, pinned at 0 |
| `law-sweep` everything else | `totalLo=0 totalHi=9`, seven classes | unmoved |

### 3.1 The law sweep did not cover the boundary, and now does

`law-sweep.test.ts` generates boards that state no `maxTurns`, so every one of
them got the engine's default of 100, the arrival turn was 41, and
`capVerdicts` returned at its first line on all 240 — the same hole in the
sweep that `ENDGAME.md` §1 found in the runner. The sweep now runs each board a
SECOND time at `maxTurns: TURN + 1`, which puts the arrival turn on the count.
231 of the 240 boards reach the boundary; 8,588 worlds are compared there.

The class is on the TOTAL rather than a `parts` entry, because the clamp is not
a feature — it replaces the fold's ends in `finish` and never appears in
`parts`. And it is booked **differentially**: a world counts only where the
UNCAPPED bracket covered it and the capped one does not. Without that, the class
would inherit the interior fold's own known slack — `totalHi`, pinned at 9,
eight of whose nine violations are one board (seed 164) whose partial settlement
believes our whole team is gone in every world while eight enumerated worlds
have it alive and tying. That is a `settlePartial`/`terminalVerdicts` question,
it pre-dates the cap on both sides of this change, and pinning the boundary at
another term's number would have hidden the boundary's own 262.

### 3.2 The repair is a no-op wherever the boundary does not speak

`lens-cost.test.ts` records four counter tuples from six-turn games. With the
repaired evaluator and the runner's cap statement REMOVED, all four are the
previous recording to the digit:

```
snake  550  nodes 6932  reads 297514  slices 6430   (unchanged)
snake 1100  nodes 13639 reads 615890  slices 13137  (unchanged)
mixed  550  nodes 7101  reads 247886  slices 1479   (unchanged)
mixed 1100  nodes 11396 reads 769166  slices 3201   (unchanged)
```

So every behavioural difference below is the CAP, and none of it is the algebra.
(The fixture is re-pinned to the capped numbers, since the capped runner is what
the repo now measures on.)

---

## 4. Part (A) landed — the runner states its cap

```ts
// src/tests/local-game.ts, buildBoard
maxTurns: spec.maxTurns ?? 100,
```

`runGame`'s loop has always stopped at `spec.maxTurns ?? 100`; the board it
handed the bot said nothing, so `resolveMaxTurns(undefined)` gave 100 and every
60-turn arm this repo has run told the bot it was playing a hundred-turn game
(`ENDGAME.md` §1). Production states the cap — `src/firebase/translate.ts`
copies `setup.maxTurns` onto the board — so the runner now matches the game the
bot actually plays, and it stays stated whatever the A/B says: a harness that
measures a bot on a boundary it cannot see is measuring the wrong bot.

### 4.1 The A/B, per class, both colours

60 turns, `--nodes`, `--opponent=material-only`, `--side=0` and `--side=1`.
`mixed`/`snakes`/`sparse`/`sparse-lean` seeds 1–3, `potions` seeds 1–8: 40 games
an arm. **A** is the capless head (`488b76a`), **B** is this branch.

| class | W/D/L A → B | winRate Δ | mean lead A → B | deaths A → B | meals A → B |
|---|---|---|---|---|---|
| mixed / side 0 | 1/0/2 → 1/0/2 | 0.000 | −10.67 → **−8.67** | 12 → 12 | 181 → 179 |
| mixed / side 1 | 3/0/0 → 3/0/0 | 0.000 | +39.67 → **+41.67** | 10 → **11** | 168 → 166 |
| potions / side 0 | 0/0/8 → 0/0/8 | 0.000 | −27.13 → **−22.38** | 28 → **30** | 500 → 486 |
| potions / side 1 | 8/0/0 → 8/0/0 | 0.000 | +45.00 → **+42.88** | 28 → **29** | 478 → 465 |
| snakes / side 0 | 2/1/0 → 2/1/0 | 0.000 | +17.00 → +17.00 | 11 → 11 | 98 → 98 |
| snakes / side 1 | 3/0/0 → 3/0/0 | 0.000 | +9.67 → +9.67 | 5 → 5 | 106 → 106 |
| sparse / side 0 | 3/0/0 → 3/0/0 | 0.000 | +11.33 → +11.33 | 0 → 0 | 42 → 42 |
| sparse / side 1 | 3/0/0 → 3/0/0 | 0.000 | +12.00 → +12.00 | 0 → 0 | 36 → 36 |
| sparse-lean / side 0 | 3/0/0 → 3/0/0 | 0.000 | +13.67 → **+14.00** | 1 → 1 | 42 → 43 |
| sparse-lean / side 1 | 3/0/0 → 3/0/0 | 0.000 | +12.33 → +12.33 | 0 → 0 | 38 → 38 |

**No outcome moved on any class, either colour.** `deltaWinRate` is flat on
10/10 arms. The lead moves on four: `potions/side0` +4.75 with the sign test at
8/0, p = 0.008 — the only result in the table that is significant at all —
`mixed` +2.00 on both colours, `sparse-lean/side0` +0.33, and `potions/side1`
**−2.13** (sign 1/7, p = 0.070) against eight unchanged wins.

`snakes` and `sparse` are BYTE-IDENTICAL on both colours, and `sparse-lean/side1`
too: five of the ten arms. That is the member's reach measured rather than
claimed — it fires only where a game arrives at the cap with the weight still
contested, which on this corpus means the two boards with pieces on them.

### 4.2 Deaths rise, and by what

**Four deaths across 40 games, all of them `contest`, all on the two
piece-bearing classes.** Nothing else moves:

```
mixed/side1     10 -> 11   contest 10 -> 11
potions/side0   28 -> 30   contest 17 -> 19   (edge 7, wall 2, self 1, bodyBlock 1 unchanged)
potions/side1   28 -> 29   contest 25 -> 26   (edge 2, bodyBlock 1 unchanged)
mixed/side0     12 -> 12   unchanged
every other class          unchanged
```

Meals fall with them — `potions` −14 and −13 over eight games, sign tests
p = 0.016 and p = 0.008; `mixed` −2 and −2 — and two games ended by `last-team`
that used to end on the count (one `mixed/side1`, one `potions/side1`).

That is the shape of a bot that has started to CONTEST near the boundary: at the
cap, weight is the score, a trade that is even on material is a win if it leaves
us heavier, and a bot that could not see the cap declined it. The lead moves the
same way on three of the four boards, and `potions/side0` — the class the deaths
rise most on — is the one class whose lead improves significantly.

**This is reported, not tuned.** The member's gain is what it is at the shipped
weights, and the standing rule (`WEIGHT-SWEEP.md`) is that a weight change earns
its keep against the whole corpus, not against the row that introduced it. What
this table licenses is the next row, not a knob: the two `drive/*` rows of
`ENDGAME.md` §5, whose whole subject is how much risk a standing should buy near
the cap, now have a boundary to be a function of.

### 4.3 What was re-pinned, and why

* `lens-cost.test.ts`, all four counter tuples. Its games are six turns long and
  it passes `maxTurns: 6`, so with part (A) the bot sees the last board as the
  last board and the search visits different plans. §3.2 is the evidence this is
  the cap and not the algebra.
* `law-sweep.test.ts`, two new classes pinned at 0 (§3.1). Nothing existing
  moved: `totalLo=0 totalHi=9` and all seven open classes are unchanged.
* **`local-game-determinism` and `basic-intelligence` were NOT re-pinned, and
  did not need to be**: 28 tests, green unchanged. Their boards either do not
  reach the cap or do not turn on it, which is the same fact the A/B reports as
  five byte-identical arms.

---

## 5. What is still open

1. **The ceiling this member now declines to give.** `best === 'win'` is
   `+Infinity`, which prunes nothing. A per-team floor/ceiling table off the
   bracket's stakes — rather than off its two summarised winner sets — could
   certify "no world is a sole win for us" much more often, and that is a
   `settlePartial` reading, not a `terminal.ts` one.
2. **`totalHi`'s board 164** (§3.1): a partial settlement that believes our team
   is gone in every world while eight enumerated worlds have it alive. It is not
   the boundary's — it is there with the cap off — but the boundary pass is what
   made it legible, and it is the last non-zero on the fold's own total.
3. **The corpus baselines.** Every arm in `ORCHESTRATOR-LOOP.md` was taken
   against a bot that could not see its cap. The five byte-identical classes
   above bound the damage, and the two that move are the ones any endgame work
   will be measured on, so a fresh `stable/*` cut belongs with the next row that
   touches them.
4. **`ENDGAME.md` §5's two `drive/*` rows.** Their precondition (i) — "nothing
   that reads the cap can ship until the `min/max` swap is replaced" — is
   discharged here, and (ii) — part (A) with a fresh baseline on both colours —
   is §4.1.

---

## 6. Reproductions

```sh
# the sixteen-arm inversion gate, cap stated
for s in mixed snakes sparse potions; do for d in 1 2 3; do
  CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js $s 30 $d --nodes 2>&1 >/dev/null \
    | grep -c INVERSION; done; done
for d in 4 5 6 8; do
  CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js potions 60 $d --nodes 2>&1 >/dev/null \
    | grep -c INVERSION; done

# the law the member failed, and the boundary class in the sweep
npx jest src/lobster/__tests__/terminal-sound.test.ts
npx jest src/lobster/evaluate/law-sweep.test.ts     # capBoards=231 capWorlds=8588

# the A/B of §4.1 — one arm per build, then the subtraction
node dist/tests/local-game.js potions 60 3 --nodes --opponent=material-only \
     --side=0 --json=one.jsonl
node scripts/ab-compare.js base.jsonl new.jsonl     # outcome section per class
```
