# ENDGAME — outcomes, the turn cap, and what decides a level board

The `endgame` row of the orchestrator loop. Everything below is measured on this
branch with the outcome instrument committed in `ecf64a6` (the runner records
`adjudicate`'s own verdict, the lead trajectory and a `--side` colour swap;
`scripts/ab-compare.js` pairs on `side` and prints W/D/L, a win rate and a paired
sign test on the lead at the cap).

Corpus, unless a section says otherwise: `mixed`, `snakes`, `potions`, `sparse`,
seeds 1–8, 60 turns, `--nodes`, `--opponent=material-only`, **both colours**
(`--side=0` and `--side=1`) — 64 games. A class here is a (scenario, side) pair,
never a scenario alone: see §2.

---

## 1. The hole the instrument found first

`buildBoard` (`src/tests/local-game.ts`) stated no `maxTurns`, so every reader
got `resolveMaxTurns(undefined)` = the engine's `DEFAULT_MAX_TURNS` of 100 —
while `runGame`'s own loop stops at `spec.maxTurns ?? 100`. **On every 60-turn
arm this repo has ever run, the harness played a sixty-turn game and told the bot
it was playing a hundred-turn one.**

That is not a reporting detail. The evaluator reads the limit off the same field
(`substrate` → `marshalled.maxTurns` → `terminal.ts:capVerdicts`), so:

> Measured, `mixed` seed 1, 60 turns, `--nodes`, vs `material-only`:
> `capVerdicts` was consulted **~100,000 times and fired 0 times** — 0 of the
> ~20,000 consultations in turns 43–54 (counter at turn 43 = 80,000, at turn 54 =
> 100,000, `fired=0` throughout, `limit=100`).

**The terminal member's share of the fold at turns 50–60 is exactly zero.** The
half of the boundary that `16-TERMINAL.md` and `08-DEPTH-VERDICT.md` exist to
seat has never fired on this corpus. Every decision in the last ten turns of
every arm ever measured was priced by the interior fold as if the game ran
forever, and a fatal risk taken on turn 60 cost the same as one taken on turn 5.

The verdict in the outcome instrument is therefore taken by calling `adjudicate`
at the turn the loop stopped, with that turn as the limit — the same function,
the same board, the same team map, and no second encoding of the rule.

---

## 2. The outcome baseline (64 games, both colours)

W/D/L is for the deciding team — the roster slot that keeps the default profile —
against a `material-only` field. `lead` is our end weight minus the heaviest
rival's, meaned over the eight seeds. `winRate` scores a draw as half a win.

| class | W/D/L | winRate | lead@cap | sharePar | kinds | deaths/100 |
|---|---|---|---|---|---|---|
| mixed / side 0 (red) | 1/0/7 | 0.125 | −12.13 | 1.03 | turn-limit 8 | 1.13 |
| mixed / side 1 (blue) | 8/0/0 | 1.000 | +38.50 | 2.38 | turn-limit 8 | 1.07 |
| potions / side 0 | 0/0/8 | 0.000 | −27.13 | 0.72 | turn-limit 8 | 0.93 |
| potions / side 1 | 8/0/0 | 1.000 | +45.00 | 2.58 | turn-limit 8 | 0.94 |
| snakes / side 0 | 6/1/1 | 0.813 | +15.38 | 2.10 | turn-limit 7, last-team 1 | 1.18 |
| snakes / side 1 | 8/0/0 | 1.000 | +15.13 | 2.00 | turn-limit 7, last-team 1 | 0.72 |
| sparse / side 0 | 8/0/0 | 1.000 | +9.25 | 1.39 | turn-limit 8 | 0.11 |
| sparse / side 1 | 8/0/0 | 1.000 | +10.63 | 1.45 | turn-limit 8 | 0.00 |

Per-seed leads at the cap:

```
mixed/side0    [ 4,-16,-20, -3,-24,-21, -3,-14]
mixed/side1    [45, 32, 42, 33, 47, 36, 36, 37]
potions/side0  [-11,-14,-29,-34,-41,-36,-28,-24]
potions/side1  [49, 44, 50, 39, 49, 42, 44, 43]
snakes/side0   [21,  0, 30, -3, 26,  5, 22, 22]
snakes/side1   [ 2, 13, 14, 24, 22, 26, 18,  2]
sparse/side0   [ 8, 13, 13,  8,  5,  9,  8, 10]
sparse/side1   [13, 10, 13, 12,  9,  9,  9, 10]
```

### 2.1 The colour swap is the whole story on two of the four boards

`mixed` and `potions` share a roster: red is snake + pawn + knight, blue is snake
+ queen + pawn. Our profile playing **blue wins 16/16**; the same profile playing
**red wins 1/16**. The lead trajectory says the same thing and says it about the
opening, not the endgame:

```
             T10    T20    T30    T40    T50    T60
mixed/side0  -0.6   -2.4   -4.1   -8.3  -11.5  -12.1
mixed/side1  +7.0  +12.6  +19.5  +24.6  +31.3  +38.5
potions/s0   -0.5   -4.9   -9.8  -15.3  -18.8  -27.1
potions/s1   +7.0  +14.4  +22.3  +30.4  +37.3  +45.0
snakes/s0    +2.0   +6.0  +10.0  +16.4  +14.4  +13.3
snakes/s1    +1.4   +2.9   +4.8   +9.5  +13.3  +13.9
sparse/s0    +1.6   +3.9   +6.0   +7.4   +8.5   +9.3
sparse/s1    +1.0   +3.0   +4.6   +6.5   +8.3  +10.6
```

mixed/side0 and potions/side0 are **monotone downward from turn 10**. Those are
not endgames lost; they are games never held, and the cause is the queen's weight
on the other roster. Nothing at the cap decides them, so they carry no endgame
question — they carry a *roster* question, and a bot measured only on side 0
would have been optimised against the wrong one for eight seeds a class. **Every
outcome A/B from here runs both colours.**

The endgame question lives in the two classes that *are* held: `snakes/side0`
peaks at T40 = +16.4 and **erodes to +13.3 by T60**, and it is the only class
that produced a draw and a three-weight loss.

---

## 3. The endgame audit — the last 15 turns of all 64 games

Deaths in turns 46–60, by class, and the body weight ours cost:

| class | deaths T46–60 (all teams) | ours | our weight lost | causes (T46–60) |
|---|---|---|---|---|
| mixed / side 0 | 8 | 1 | 10 | contest 5, self 2, bodyBlock 1 |
| mixed / side 1 | 3 | 0 | 0 | contest 3 |
| potions / side 0 | 6 | 3 | 33 | contest 4, wall 1, self 1 |
| potions / side 1 | 4 | 0 | 0 | contest 4 |
| snakes / side 0 | 6 | 3 | 52 | self 3, bodyBlock 3 |
| snakes / side 1 | 4 | 1 | 18 | self 1, bodyBlock 2, wall 1 |
| sparse / side 0 | 1 | 1 | 9 | self 1 |
| sparse / side 1 | 0 | 0 | 0 | — |

Our nine late deaths, in full:

```
mixed/s8/side0   T46 red-A  contest 10
potions/s3/side0 T60 red-A  contest 15
potions/s5/side0 T52 red-A  wall     8
potions/s6/side0 T53 red-A  self    10
snakes/s1/side1  T55 blue-B self    18
snakes/s2/side0  T48 red-A  self    19
snakes/s4/side0  T49 red-B  self    13
snakes/s6/side0  T60 red-A  self    20
sparse/s5/side0  T56 red-A  self     9
```

**Six of our nine late deaths are `self`, and each costs 9–20 weight on a board
whose margins are 0 to 5.** At the cap, weight *is* the score, and a long snake
is the score. There is no time to regrow.

### 3.1 Class E-1 — the draw a weight-aware choice would have won

`snakes` seed 2, side 0. `node dist/tests/local-game.js snakes 60 2 --nodes
--opponent=material-only`. Final: **red 13, blue 13, green 0 — DRAW at the cap,
lead 0.**

```
T 48 red-A snake hp 99 (10,3)->(10,4) REVERSAL [seed]
       top3: (10,4)=0.40|50.78 (9,3)=0.40|50.78 (11,3)=0.40|50.78
DEATH red-A (self) body was (10,3)(10,4)(10,5)(9,5)(9,6)(10,6)(10,7)(10,8)
                            (9,8)(9,7)(8,7)(8,6)(8,5)(8,4)(9,4)(9,3)(9,2)(10,2)(10,1)
```

Nineteen cells, on a board decided by zero. The three listed options score
*identically* — `(10,4)` is its own neck, `(9,3)` its own body and `(11,3)` is off
an 11-wide board — because by turn 48 every neighbour of the head was body or
wall. **The death at T48 was forced; the decision that lost the game is earlier**,
and the fold priced the coil that made it at its best value of the game.

### 3.2 Class E-2 — the loss by three, same shape

`snakes` seed 4, side 0. Final: **red 12, blue 8, green 15 — LOSS, lead −3.**

```
T 47 red-B snake hp 99 (8,0)->(7,0) [seed]
       top3: (7,0)=20.23|126.17  (9,0)=20.23|126.17  (8,1)!=-110.70|-4.75
T 48 red-B snake hp 98 (7,0)->(6,0) [seed]
       top3: (6,0)=18.84|124.78  (7,1)!=-110.66  (8,0)!=-110.66
T 49 red-B snake hp 97 (6,0)->(6,1) [seed]
       top3: (6,1)=-120.74|-9.78 (5,0)=-120.74|-9.78 (7,0)=-120.74|-9.78
DEATH red-B (self) body was (6,0)(7,0)(8,0)(8,1)(7,1)(6,1)(6,2)(5,2)(5,1)(5,0)(4,0)(3,0)(2,0)
```

**T47 is the decision, and it is an exact tie**: `(7,0)` (into the pocket its own
body has already closed on three sides) and `(9,0)` (out along the free edge)
score `20.23|126.17` to the last digit. The fold has *nothing* that separates a
cell whose escape is two turns away from one whose escape is open, so the
tie-break took the incumbent and walked in. Thirteen cells; the game was lost by
three.

### 3.3 Class E-3 — the fatal risk taken on the last turn

`snakes` seed 6, side 0. Final: **red 10, blue 5, green 5 — WIN, lead 5.**
Trajectory: `T40=20 T50=21 T60=5`.

```
T 57 red-A ... ENTRAPPED red-A kept=8/22
T 58 red-A snake hp 99 (6,3)->(6,2)  top3: (6,2)=200.92|251.52 (6,4)=200.88 (5,3)!=-0.06|50.53
T 60 red-A ... DEATH red-A (self) body was (6,1)(6,2)…(0,4)   [20 cells]
```

The entrapment instrument saw it at T57 — `kept=8/22`, a 22-cell snake with an
8-cell pocket — and the fold scored walking deeper into that pocket at **200.92,
its best value of the game**, against **−0.06** for the one cell that led out.
Sixteen weight evaporated on turns 58–60 and the win shrank from 21 to 5. **A
fatal risk on turn 60 has no future to pay for it and the fold does not know
that turn 60 is different from turn 5** — because, per §1, nothing in the fold
knows the game ends at all.

### 3.4 What the audit does and does not find

* **Lead protection when ahead: absent, and it costs.** snakes/side0 gives back
  3.1 weight of lead between T40 and T60; snakes/s6 gives back 16 in three turns.
  Every unit of that is a `self` death or a `bodyBlock` death of a long unit.
* **Risk when behind: absent, and it is not what loses these games.** The two
  classes that lose (mixed/side0, potions/side0) are behind by T20 and lose
  monotonically. No cap-aware gamble recovers a −27 deficit in ten turns; the
  deficit is a roster and territory difference, which `WEIGHT-SWEEP.md` already
  established is not reachable at the weight scale without paying +5…+9 deaths.
* **What decides an even game near the cap: one long unit dying.** Every level or
  near-level board in the corpus (leads 0, −3, +2, +5, +5) turned on exactly one
  late `self` death of a 9–20 cell unit.
* **Which member, which line.** Not `terminal.ts` — it cannot fire (§1). The
  decisions in §3.2 and §3.3 are made by the space members: `reach` (weight 1)
  and `room` (weight 3) in `calibration.ts:47`, folded at
  `src/lobster/evaluate/bound.ts:183`. `room`'s saturation is the known defect —
  BEHAVIOUR-AUDIT-2's **D5**, "room saturation under a slider", still open — and
  §3.2's exact tie is D5 in one line: two cells with the same *count* of
  reachable ground, one of which is a pocket the unit's own body closes in two
  turns. The runner's `entrappedAt` instrument separates them (`kept=8/22`); no
  member does.

---

## 4. The rule, measured

### 4.1 The rule

> **THE CAP THE HARNESS PLAYS TO IS THE CAP THE BOT IS TOLD ABOUT, and the cap's
> verdict is read wherever the settlement has ENDED — not only where turn-limit
> is its sole reachable ending.**
>
> Parameterised by one predicate: `ended(kinds) = kinds.length > 0 &&
> !kinds.includes('continues')`, replacing `kinds.length === 1 && kinds[0] ===
> 'turn-limit'`.
>
> Two parts, one idea. **(A)** `buildBoard` states `maxTurns: spec.maxTurns ?? 100`
> so the board's limit is the loop's limit. **(B)** `terminal.ts:capVerdicts`
> reads the bracket's verdict on every ended settlement.

**Falsifier, on OUTCOMES and deaths.** Win rate vs `material-only` up on ≥2
classes and down on none, over eight seeds and both colours; deaths not up on any
class; mirror deaths not up; the sixteen-arm inversion gate prints zero;
`exact-reply` exact; the law-sweep ratchet not up.

### 4.2 Part (B) alone is a soundness fix, and it is one this repo needed

Part (B) is not a strategy knob. At `arrivalTurn >= limit`, `adjudicate` cannot
return `continues` (`decide` emits it only when `reachedTurnLimit` is false), so
every reachable branch is a decided ending and the bracket's two sets mean exactly
what the corners need: `us ∉ certainWinners` ⇒ some reachable world has us not
winning or tying ⇒ **DEAD is a sound floor**, whichever kind that world ended by;
`us ∉ possibleWinners` ⇒ no world has us winning or tying ⇒ **DEAD is a sound
ceiling**. The kinds test never enters either implication, which is why it can be
dropped.

The old gate's abstention left the interior fold standing as a *lower bound on a
board that had ended*. Measured on the head build, `mixed` seed 1 vs
`material-only` run to 120 turns:

```
16,510 BoundsInversionError from turn 100 on
   12,615  bank floor=B0 ceiling=B2       ← the abstention class
    3,169  bank floor=B1 ceiling=B0
      726  bank floor=B3 ceiling=B2
"crashed": "turn 104: inverted ScoreBounds [-620, -Infinity]: bank floor=B0 ceiling=B2"
```

with the abstention visible at the moment it happens:

```
CAPABSTAIN turn=100 limit=100 us=blue kinds=["last-team","turn-limit"]
           certainW=[] possibleW=["red","blue","green"]
```

B0's *complete* cover abstained here and kept an interior floor of −292; a B2
witness on the **same plan** resolved its one reply tuple, reached the `certain`
branch with `kind === "turn-limit"`, clamped to DEAD and certified a ceiling of
−Infinity. A complete floor above a sound ceiling is the fatal bug class and the
bank throws rather than clamping it — so the decision at turn 104 died of it, and
the game the harness recorded as a loss was a **forfeit**. Production boards carry
a real `maxTurns`; the harness's blindness (§1) is the only reason this was never
seen.

With part (B) applied, the abstention class is **gone** and every 120-turn game
runs to completion. The long arm, `mixed` seeds 1–4, side 0, cap 120:

| seed | pre-fix | part (B) |
|---|---|---|
| 1 | **crash turn 104**, 16,510 inv, LOSS lead −21 @103 | no crash, 72,370 inv, LOSS −22 @120 |
| 2 | no crash, LOSS −47 @120 | no crash, **0 inv**, LOSS −47 @120 (identical game) |
| 3 | **crash turn 120**, LOSS −61 | no crash, 1,468 inv, LOSS −61 @120 |
| 4 | no crash, LOSS −55 @103 | no crash, **0 inv**, LOSS −55 @103 (identical game) |

Seeds 2 and 4 never reach the abstention and are the same game byte for byte.
Seed 1's larger absolute count is **sixteen more turns of play, not a worse
rate**: 16,510 over turns 100–104 is 3,302 per turn, 72,370 over turns 100–120 is
3,446 per turn — the same regime, now allowed to finish. None of the residual is
`floor=B0 ceiling=B2`; all of it is `floor=B1 ceiling=B0` (64,864), `floor=B1
ceiling=B2` (5,111) and `floor=B3 ceiling=B2` (3,863), all finite-against-finite
and all the `finish` defect of §4.3, which fires on any board past the cap
whatever this member does. **Part (B) removes the crash and the unsound floor; it
does not and cannot fix `finish`.**

### 4.3 Part (A) is REFUTED — it fails the inversion gate

Making the cap visible turns `terminal.ts` on for the last two turns of every arm
and immediately fails the standing gate. Three configurations, same three arms,
`CENTAUR_DEBUG_INVERSION=1`:

| config | mixed 30 s1 | potions 30 s2 | potions 30 s3 |
|---|---|---|---|
| (B) alone — terminal fix, cap invisible | **0** | **0** | **0** |
| (A) alone — cap visible, head `terminal.ts` | 2,268 | 0 | 0 |
| (A)+(B) | 2,906 | 835 | 1,454 |

Over the twelve 30-turn arms of the sixteen-arm gate, (A)+(B) prints **5,195
INVERSION lines** — 3,741 `bank floor=B1 ceiling=B2` and 1,454 `bank floor=B0
ceiling=B2`, all of them finite-against-finite (`[222.13404204280567,
202.4482982411528]`), so they are *not* the DEAD/WIN clamp. The mechanism is
`finish`'s own `Math.min(lo, hi) / Math.max(lo, hi)` swap
(`src/lobster/evaluate/index.ts:366`) meeting a `clampTo` that **replaces** the
interval rather than intersecting it (`bound.ts:119-124` — `bound(lo, …, hi)`,
not a meet with `total`). The cap's two corners can disagree in direction:
`cap.worst === 'win'` (WIN = +∞, reachable when `us ∈ certainWinners` and
`possibleWinners === [us]`) alongside `cap.best === 'draw'` (which is *not* a
clamp, so `hi` stays the interior ceiling). `Math.min` then hands `clampTo` the
interior ceiling **as the floor**, and the plan comes back as
`[interiorCeiling, +∞]`. Two rungs holding different held sets have different
interior ceilings, so B1 promotes 222.13 to a floor while B2 still certifies
202.45 as a ceiling — a complete floor above a sound ceiling, from two members
that were each individually right. The comment above that line asserts the
clamps "can only ever tighten an interval, never invert it"; that is true of the
elimination corners, whose worlds are ordered by inclusion, and **false of the
cap corners**, which are read off `certainWinners` and `possibleWinners` — two
sets that are not.

**So part (A) is refused, and the reason is worth more than the rule.** The cap
member cannot be switched on anywhere until `finish` prices a `win`-floor against
a `draw`-ceiling without the `min/max` swap — which is a `bound.ts` question, not
a `terminal.ts` one, and is the next thing anyone taking this row should do.

Part (A) is also a one-line change with the blast radius of the whole corpus:
every baseline in `ORCHESTRATOR-LOOP.md` was taken against a bot that could not
see its cap, and turning it on invalidates all of them at once. It should land
with the `finish` repair, a fresh `stable/*` cut, and both colours — not before.

### 4.4 What was kept

**Part (B) only.** It is a terminal-member change, and it is **byte-identical on
the whole corpus** by construction: with the cap invisible (§1) `capVerdicts`
returns at its first line and the new predicate is never reached. Measured, not
argued:

| gate | result |
|---|---|
| sixteen-arm inversion gate (12 × 30t + 4 × potions 60t) | **0 INVERSION lines** |
| `ab-compare --all-metrics`, same 16 arms, pre-fix vs kept | **every row 0**, outcome section included: winRate flat 4/4, lead flat 4/4 |
| `ab-compare`, 6 games vs `material-only` on the baseline corpus, both colours | every row 0; deaths flat 4/4, meals flat 4/4, winRate flat 4/4 |
| `tsc --noEmit -p .` / `eslint "src/**/*.ts"` | clean |
| determinism + evaluate + soundness | 92 tests, green |
| `exact-reply.gate` | 16/16 exact |
| law-sweep ratchet | `totalLo=0 totalHi=9`, unchanged, green |

So every clause of the keep rule that can discriminate is satisfied — deaths not
up on any class, mirror deaths not up, inversion gate zero, exact-reply exact,
ratchet not up — and the win-rate clause is **vacuous on this corpus**, which is
§1 restated: the corpus cannot reach the cap, so nothing measured on it can move.
What the change buys is production, where boards carry a real `maxTurns`, and the
120-turn arm: no crash, the unsound floor gone, and two of four games identical.

---

## 5. For the drives branch — risk as a function of standing

`docs/design/drives/00-FRAMEWORK.md` already has the object this needs: a row
with `constructor: MemberId`, a `referent`, a `weight ≥ 0` and an `authority`. The
endgame wants two rows whose *weight is a function of the board's standing*, which
is the one thing the framework's table does not yet carry — and this is the case
that argues for it, so it belongs there rather than as a special case in
`calibration.ts`.

* **`drive/lead-protection@1`** — referent `{ kind: 'none' }` (a PREFERENCE:
  untargeted). Weight rises with `min(1, lead / leadScale)` and with
  `1 − (maxTurns − turn) / horizon`. What it multiplies is the *existing* death
  term, not a new one: it makes a unit's own weight worth more as the cap nears
  and as we stand ahead, which is exactly the statement "at turn 58 with a 21
  lead, a 22-cell snake is the game". §3.3 is its test: it must reprice
  `(6,2)=200.92` against `(5,3)=−0.06` when 22 cells are at stake with 3 turns
  left, and it must not touch turn 5.
* **`drive/beware-entrapment@1`** — the fear the owner named verbatim, referent
  `{ kind: 'none' }` or unit-scoped. Its member is the one the runner already
  computes and the evaluator does not: `entrappedAt`'s `kept/need` shortfall
  (`local-game.ts`), the reading that separates §3.2's tie. Weight rises with the
  same standing function. This is BEHAVIOUR-AUDIT-2's **D5** given a referent and
  a schedule instead of a slider.

Both are the same shape — `weight = base × f(lead, turnsRemaining)` — so the
framework change is one field, not two members: a `schedule` on the row, read at
fold time from the board the plan lands on. That is a strictly smaller change
than either special case, and it is the factoring the standing orders ask for.

**Preconditions, in order.** (i) `finish`'s cap corners (§4.3) — nothing that
reads the cap can ship until the `min/max` swap is replaced. (ii) part (A), with
a fresh baseline on both colours. (iii) then, and only then, a standing schedule
has a boundary to be a function of.

---

## 6. Reproductions

```sh
# the sixteen-arm inversion gate and the identity A/B (both builds)
for s in mixed snakes sparse potions; do for d in 1 2 3; do
  CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js $s 30 $d --nodes --json=one.jsonl
  cat one.jsonl >> arms.jsonl; done; done
for d in 4 5 6 8; do
  CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js potions 60 $d --nodes --json=one.jsonl
  cat one.jsonl >> arms.jsonl; done
node scripts/ab-compare.js pre.jsonl keep.jsonl --all-metrics

# the baseline, one class, both colours
for s in 1 2 3 4 5 6 7 8; do
  node dist/tests/local-game.js snakes 60 $s --nodes --opponent=material-only --side=0 --json=b-$s.jsonl
done
node scripts/ab-compare.js base.jsonl new.jsonl     # outcome section: W/D/L, winRate, sign test on lead

# E-1 the draw            (red 13, blue 13)
node dist/tests/local-game.js snakes 60 2 --nodes --opponent=material-only   # DEATH red-A (self) T48, 19 cells
# E-2 the loss by three   (red 12, blue 8, green 15)
node dist/tests/local-game.js snakes 60 4 --nodes --opponent=material-only   # tie at T47, DEATH red-B (self) T49
# E-3 the last-turn risk  (lead 21 -> 5)
node dist/tests/local-game.js snakes 60 6 --nodes --opponent=material-only   # ENTRAPPED T57, DEATH red-A (self) T60

# the cap, and the crash it used to cause (head build)
CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js mixed 120 1 --nodes --opponent=material-only
```
