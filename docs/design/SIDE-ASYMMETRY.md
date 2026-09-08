# SIDE-ASYMMETRY — the measurement corpus is not fair, and the unfairness is in the boards

`docs/design/ENDGAME.md` §2.1 found it and named it correctly without being able
to prove it: against a `material-only` field our profile playing blue wins
`mixed` and `potions` 16/16 and the same profile playing red wins 1/16, with
side 0 losing monotonically from turn 10 — "not endgames lost; they are games
never held". Every death and every meal in `BEHAVIOUR-AUDIT.md`,
`BEHAVIOUR-AUDIT-2.md`, `WEIGHT-SWEEP.md` and `docs/design/ab/` was taken with
the default profile on team 0.

This document settles where the asymmetry lives, by measurement; says which of
those older conclusions it qualifies and whether any of them flip; and states
the standing rule that replaces "side 0" as the default.

Everything below: 60 turns, `--nodes` (the deterministic budget), seeds 1–8.

---

## 1. The verdict

**It is the ROSTER. Not the runner, not the engine.**

The instrument that separates the three is MIRROR SELF-PLAY with no
`--opponent`: every team plays the identical default profile, so no difference
in *play* is possible and whatever asymmetry remains is the board's, the
runner's or the engine's. `--side` in a mirror run picks which team the outcome
is read for and changes nothing else — pinned as a test, see §5.

| test | what it separates | result |
|---|---|---|
| **(a)** mirror self-play, the five baseline classes, both slots | board vs. bot | slot 0 **12W/0D/28L** (win rate 0.300), slot 1 **26/0/14** (0.650). On `mixed` and `potions` slot 0 is **0/16** with mean leads −35.1 and −28.5 |
| **(b)** the same, with the two teams' UNIT LISTS SWAPPED (`mixed`) | roster vs. slot | the result swaps with them: red **0/8 → 8/8**, mean lead **−35.13 → +32.25**; blue **8/8 → 0/8**, **+28.75 → −36.63**. The win follows the units |
| **(c)** one decision per team on a board that is exactly its own mirror image | runner / bot equivariance | red's staged set, reflected, **IS** blue's, on all five control boards — and is the same whether the two decisions run back to back or with the shared caches dropped between them |
| **(d)** mirror self-play, the five HAND-SYMMETRIC controls, both slots | residual structural bias | slot 0 **18W/1D/21L** (0.463), slot 1 **21/1/18** (0.537). Mean leads −3.63, −2.25, +0.50, +4.88, +1.00 — sign varies by class |
| **(e)** `--opponent=material-only`, both slots, on the hand-symmetric controls | the opponent wiring itself | slot 0 **22W/0D/2L** (0.917, mean lead +15.7), slot 1 **23/0/1** (0.958, +16.3) over 48 games. The bot beats the field from either colour on a fair board |

(a) alone rules the bot out: both teams are the same program. (b) rules the slot
out: move the units and the result moves. (c) and (d) rule the runner and the
engine out: the decision is reflection-equivariant and order-independent, and on
a board that is genuinely symmetric the slots split like a coin over forty
games.

### Why the boards are not fair

| class | roster | items | fair? |
|---|---|---|---|
| `mixed` | red snake + pawn + **knight**, blue snake + **queen** + pawn | 180°-symmetric | **no — blue has the queen** |
| `potions` | `mixed`'s roster | symmetric | **no — same** |
| `snakes` | mirror-image rosters | six meals, and **(0,5) has no twin at (10,5)** | no |
| `sparse` | mirror-image rosters | two meals, and **(3,9) has no twin at (9,9)** | no |
| `sparse-lean` | `sparse`'s | `sparse`'s | no |

`mixed` and `potions` are the loud ones and the queen is the whole of it. The
`snakes`/`sparse` families are mildly unfair for a different reason — an
unmirrored meal — which is why their side split is small and its sign moves
between classes.

### The residual: a tie-break that is not reflection-invariant

The controls are not perfectly fair either, and the reason is worth recording
because it is the one real *structural* asymmetry found.

The first cut of the controls kept each baseline class's third team on the
centre file, where the reflection maps it onto itself. `mirror-mixed` then read
slot 1 **8/8 at a mean lead of +39.4** — on a board that is exactly its own
mirror image. The cause is not adjudication order and not move collection: on a
self-mirrored position a team's own tied options are mirror images of *each
other*, the search breaks that tie by cell index, and cell index is not
reflection-invariant. So the third team commits to one half of the board on
turn 1 and harasses that half for sixty turns. Dropping it reads slot 0
**3/0/5 at −2.25**.

The controls are therefore two-team boards, pinned as such in
`side-symmetry.test.ts`. Note what this rules IN as well as out: **a
self-mirrored third party is not a neutral party**, and any future "fair board"
with an odd team on the axis is not one.

**Nothing here is a TacticToes report.** The engine was tested and cleared: on
symmetric boards the settlement never favours a slot, and the only direction
preference found is in this repo's own search tie-break, which is a preference
between equal-valued options and not a soundness defect. No edit to
`src/engine-vendor` is proposed and none is needed.

---

## 2. The numbers

Mirror self-play, no `--opponent`, seeds 1–8, 60 turns, `--nodes`. Both slots
are read off the same eight games per class — with every team on one profile the
slot is a readout, so this is not sixteen games, it is eight read twice.

### The five baseline classes

| class | slot 0 W/D/L | lead | slot 1 W/D/L | lead |
|---|---|---|---|---|
| `snakes` | 1/0/7 | −9.50 | 5/0/3 | +0.88 |
| `mixed` | **0/0/8** | **−35.13** | **8/0/0** | **+28.75** |
| `sparse` | 6/0/2 | +1.38 | 2/0/6 | −1.38 |
| `potions` | **0/0/8** | **−28.50** | **8/0/0** | **+24.75** |
| `sparse-lean` | 5/0/3 | +1.88 | 3/0/5 | −1.88 |
| **pooled** | **12/0/28** (0.300) | | **26/0/14** (0.650) | |

(The two columns do not sum to 40 wins: `snakes`, `mixed` and `potions` carry a
third team, which takes the games neither slot does.)

Per-seed leads, slot 0:

```
snakes       [-12,  1,-17,-14,-12, -7, -6, -9]
mixed        [-30,-43,-36,-35,-41,-43,-30,-23]
sparse       [  1,  4,  5,  1, -1,  1, -4,  4]
potions      [-31,-28,-25,-35,-24,-37,-24,-24]
sparse-lean  [  6,  6,  6,  5, -2, -6, -5,  5]
```

### The roster swap — `mixed`, mirror self-play, seeds 1–8

Same board, same seeds, same profile on every team; only which SLOT holds which
unit list changes.

| arm | slot 0 (red) | lead | slot 1 (blue) | lead |
|---|---|---|---|---|
| `mixed` as written (red: snake, pawn, knight) | 0/0/8 | −35.13 | 8/0/0 | +28.75 |
| `mixed` **rosters swapped** (red: snake, queen, pawn) | **8/0/0** | **+32.25** | **0/0/8** | **−36.63** |

The verdict follows the units across the swap, sign and magnitude together.
There is no residue for the slot to carry.

### The five hand-symmetric controls

| class | slot 0 W/D/L | lead | slot 1 W/D/L | lead |
|---|---|---|---|---|
| `mirror-snakes` | 2/0/6 | −3.63 | 6/0/2 | +3.63 |
| `mirror-mixed` | 3/0/5 | −2.25 | 5/0/3 | +2.25 |
| `mirror-sparse` | 5/1/2 | +0.50 | 2/1/5 | −0.50 |
| `mirror-potions` | 4/0/4 | +4.88 | 4/0/4 | −4.88 |
| `mirror-sparse-lean` | 4/0/4 | +1.00 | 4/0/4 | −1.00 |
| **pooled** | **18/1/21** (0.463) | | **21/1/18** (0.537) | |

Forty games, a 0.463/0.537 split, and the mean lead changes sign between
classes. Set beside 0.300/0.700 with a 0/16 on the two queen boards, that is the
whole answer: **the runner and the engine are even; the boards are not.**

---

## 3. What earlier conclusions this qualifies, and whether any flip

The good news first, and it is most of the corpus.

**A mirror run's totals do not depend on the slot at all.** With no
`--opponent` every team plays the same profile, so `--side` selects which team
the verdict is read for and touches nothing else: the board, the decisions, the
rng draws and every board-wide counter are identical. And those counters are
BOARD-WIDE sums over every team, not ours-only.

The one thing the slot does move is `docs/design/OPPONENTS.md`'s side split
(`oursMeals`, `theirsDeaths`, …), and it moves it in the only way it may — the
two halves SWAP, and each pair still sums to the total it is a half of. That is
not an exception to the rule, it is the rule stated per team: "ours" means
`spec.teams[side]`. Both halves are asserted (`side-symmetry.test.ts`,
"`mirror-sparse` holds every total and swaps the side split": everything but
the split compared as a string, then each `ours`/`theirs` pair exchanged) —
because a split that failed to swap and a total that failed to hold are two
different bugs.

So:

| record | corpus | side-0-only? | flips? |
|---|---|---|---|
| `WEIGHT-SWEEP.md` §5, "the head's weights are a local minimum in deaths along every direction swept" | 5 of 7 arms are mirror runs (`mixed` 1–6, `potions` 1–8, `snakes`/`sparse`/`sparse-lean` 1–3) | **no** for those five — mirror counters are slot-invariant and board-wide | **no.** The sweep's direction rests on the mirror arms and they are not side readings at all |
| the same document's two `material-only` arms (`mixed` 1–3, `snakes` 1–3), including every "**ours**" split | vs `material-only`, side 0 | **yes** | see §3.1 |
| `BEHAVIOUR-AUDIT.md` D1, the honest floor, "deaths fall on both board classes that have any" | `mixed` and `potions`, mirror | **no** | **no** |
| `BEHAVIOUR-AUDIT-2.md` P1's reproduction and its "3 of 4 parked pawn deaths are ours" | `mixed` vs `material-only`, side 0 | **yes** | qualified, §3.1 |
| `entrapment.md` §9.5, the repair kept because "`snakes` deaths fall at both horizons" | `snakes`, mirror | **no** | **no** |
| `DECISIONS.md` 2026-09-05 09:00Z (D1 taken), 2026-09-03 (entrapment repair taken), and the P1/P2/P3 refusals | mirror corpora | **no** | **no** |
| `ENDGAME.md` §2.1 | both colours already | — | it was right, and this is the proof |

**No taken decision flips.** Every ruling in `DECISIONS.md` that turns on a
death or a meal count turns on a mirror arm, and a mirror arm is not a side
reading. What is genuinely qualified is narrower and is stated next.

### 3.1 What IS side-0-only: the `material-only` arms and every "ours" split

An arm against a named opponent is a different game per slot — that is the
point of the flag — so its counters, and above all the ours/theirs split of its
deaths, are readings of ONE colour. Re-measured here on both:

`mixed` and `snakes` vs `material-only`, seeds 1–3, 60 turns — the exact corpus
of `WEIGHT-SWEEP.md` §1's two opponent rows and of `BEHAVIOUR-AUDIT-2.md`'s
material-only arms. Side 0 reproduces both documents to the digit, which is the
check that this is the same instrument:

| arm | side | board-wide deaths | **ours** | our causes | unit-turns | meals/100 | outcomes |
|---|---|---|---|---|---|---|---|
| `mixed` vs mat-only | 0 (red) | 12 | **4** | contest 4 | 1120 | 16.16 | W+4 L−16 L−20 |
| `mixed` vs mat-only | 1 (blue) | 10 | **3** | contest 3 | 1109 | 15.15 | W+45 W+32 W+42 |
| `snakes` vs mat-only | 0 (red) | 11 | **1** | self 1 | 800 | 12.25 | W+21 D+0 W+30 |
| `snakes` vs mat-only | 1 (blue) | 5 | **1** | self 1 | 978 | 10.84 | W+2 W+13 W+14 |

(`WEIGHT-SWEEP.md` §1 records `mixed` vs mat-only 1–3 as *1120 ut, 12 board-wide,
4 ours, all contest, 16.161 meals/100* and `snakes` vs mat-only 1–3 as *800 ut,
11 board-wide, 1 ours (self), 12.250* — reproduced exactly at side 0.)

`BEHAVIOUR-AUDIT-2.md`'s combined material-only row therefore reads:

| | unit-turns | deaths | ours | our share |
|---|---|---|---|---|
| audit 2 as published (side 0) | 1920 | 23 | **5** | 22% |
| the same six games on side 1 | 2087 | 15 | **4** | 27% |

The reading: **direction survives, magnitude does not.** Every one of our own
deaths is the same cause on both colours (`mixed`: contest only; `snakes`: self
only), our share of the board's deaths stays a small minority (22% → 27%), and
the audit's actual claim — "the bot beats `material-only`, and only a fifth of
the deaths are ours" — is true on both. What is not portable is any *count*: 23
board-wide deaths is a side-0 number and the other colour sees 15, on 167 more
unit-turns, because on side 1 our roster carries the queen and fewer units die
anywhere on the board. Nothing that was taken on these arms is reversed; every
one of them is now a number with a colour attached to it.

One claim is narrowed rather than confirmed. `BEHAVIOUR-AUDIT-2.md`'s P1 rests
on parked PAWN deaths in `mixed` vs `material-only` — "3 of 4 are ours" — and
our pawn is a different pawn on each colour (red's at (2,1), blue's at
(10,10)). All our deaths are `contest` on both colours, so the class is not
absent on side 1, but this document did not re-classify them by shape and
does not claim P1's ratio holds there. P1 was **refused** anyway
(`DECISIONS.md`, 2026-09-05), so nothing rests on it; anyone re-opening it
owes the side-1 classification first.

### 3.2 What this does NOT license

It does not license reading the baseline classes' *outcomes* as a bot property.
`mixed`/side 0 losing 8/8 to `material-only` is the queen, not a defect, and
`ENDGAME.md` §2.1 already declines to treat it as one. The endgame question
lives where the board is close — which after this document means the controls
and the `snakes`/`sparse` families, not `mixed`.

---

## 4. `material-only` on both sides of a fair board

Test (e): the opponent wiring itself. If `--opponent`/`--side` applied the
profile asymmetrically — the wrong team keeping the default, the deciding team
resolved from a different roster than the profile assignment — a fair board
would still split. It does not:

| control | side 0 W/D/L | lead | side 1 W/D/L | lead |
|---|---|---|---|---|
| `mirror-snakes` | 8/0/0 | +21.88 | 8/0/0 | +17.25 |
| `mirror-mixed` | 6/0/2 | +15.38 | 7/0/1 | +21.88 |
| `mirror-sparse` | 8/0/0 | +9.88 | 8/0/0 | +9.63 |
| **pooled (48 games)** | **22/0/2** (0.917) | **+15.71** | **23/0/1** (0.958) | **+16.25** |

Beside it, the same instrument on the baseline `mixed`, which reproduces
`ENDGAME.md` §2 exactly:

| | side 0 W/D/L | lead | side 1 W/D/L | lead |
|---|---|---|---|---|
| `mixed` vs `material-only` | 1/0/7 (0.125) | **−12.13** | 8/0/0 (1.000) | **+38.50** |

A 50-point swing on the unfair board and a 0.04 difference on the fair ones.
The wiring is fine; the board was the whole finding.

---

## 5. The standing rule

> **Every A/B and every audit runs BOTH colours and reports them separately.**
> Never pooled: red-plays-us and blue-plays-us are two experiments over one
> asymmetric board.

Wired in three places:

1. **`src/tests/local-game.ts`** — `--side=both` (equivalently `--side=0,1`)
   plays every (scenario, seed) from slot 0 and again from slot 1 and writes a
   summary for each. `--side=N` is unchanged and the default is still `[0]`, so
   every standing invocation is byte-identical to what it was.
2. **`scripts/ab-compare.js`** — runs are keyed on `side` and never pooled (that
   part predates this document, from `ENDGAME.md`); new here, the coverage block
   NAMES every arm that ran one colour only, and `--require-both-sides` turns
   that warning into exit code 2 for a gate that must not pass without it.
3. **`scripts/both-sides-corpus.sh`** — the standing corpus, both colours, one
   command. A merged `scripts/wide-corpus.sh` needs only `--side=both` added to
   its runner invocations; the rule is a flag, not a fork.

And two supporting pieces:

4. **The hand-symmetric controls** — `mirror-snakes`, `mirror-mixed`,
   `mirror-sparse`, `mirror-potions`, `mirror-sparse-lean`, one per class,
   symmetric under `x -> width-1-x`. Reached as the group `mirrors`;
   `everything` is the baseline five plus these. **`all` is pinned to the
   baseline five**, so adding a scenario can never change what a standing
   `sum all` measures.
5. **`src/tests/side-symmetry.test.ts`** — the five baseline specs pinned by
   hash (they are never repaired in place: the whole A/B corpus is bound to
   their side-0 play, and the fix for their unfairness is the controls beside
   them); the controls' reflection symmetry and two-team rule; and a mirror
   run's slot-invariance, totals and side split both.

### Why the five old boards were not fixed

Every record in `docs/design/ab/` is a paired per-seed diff against the baseline
specs' side-0 play. Editing `mixed` to give red a queen would not repair those
records, it would silently invalidate them — the pairing key would still match
and the numbers would no longer be comparable. The boards stay exactly as they
are, the controls are new boards beside them, and the byte-identity gate is
part of this branch: the five baseline classes, mirror self-play, seeds 1–8 at
60 turns, are byte-identical before and after every change here (`ab-compare`
reports every per-seed delta 0 on every metric of every class).
