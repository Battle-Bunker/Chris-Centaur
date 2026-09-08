# DEEP-DEATHS — why 4× budget kills more

`BUDGET.md` §2 measured it and would not explain it: from 1× to 4× deaths rise
on `mixed` (14 → 16) and `potions` (14 → 22), worse on 15 of 24 paired seeds
(p = 0.0024), and the extra deaths are `bodyBlock` and `edge` rather than
`contest`. This document opens those deaths one at a time.

**The answer is not a soundness hole and not a member that overprices joint
plans. It is that at the decisions which kill, EVERY danger channel in the fold
is flat between the two arms' plans and only the GAIN channels move — so the
extra budget buys a rung (`restart`) the shipped budget never reaches, and that
rung spends its extra reach on a margin made of food.**

## 1. Reproduction

24 games, 60 turns, node clock, seeds 1–6, `--budget-scale` 1 and 4. Deaths and
causes reproduce `BUDGET.md` §1 exactly.

| | 1× | 4× |
|---|---|---|
| mixed deaths | **14** (contest 11, bodyBlock 2, self 1) | **16** (contest 9, bodyBlock 4, edge 1, wall 1, self 1) |
| potions deaths | **14** (contest 12, bodyBlock 2) | **22** (contest 13, bodyBlock 4, edge 3, self 2) |
| self-inflicted (bodyBlock/edge/wall/self) | 5 of 28 = **18 %** | 16 of 38 = **42 %** |

## 2. Method — attributing a death to a decision

Two arms played as separate games diverge on the first disagreement, so a 4×
death has no 1× counterpart. The attribution fixes the board: **the game is
played at 4×, and at every `(turn, team)` the SAME position is also decided at
1×.** The replay reproduces each recorded 4× game's death list turn-for-turn and
cause-for-cause, which is what licenses it. A death is attributed to the LAST
decision before it at which the 1× arm would have staged a different cell *for
the unit that dies*. 29 of 38 attribute; 9 have no own-unit divergence and are
left unattributed rather than given a decision they do not have. Both arms'
plans are then re-priced under ONE bank on that board (`BoundBank.price` +
`Evaluator.explainPlan`), and the decision re-run with a lens on both arms so
the staged row's rung comes from the search's own provenance. The lens carves
budget, so each lensed staged set is checked against its unlensed one:
**matched on 29 of 29.**

## 3. The per-death table

`k`: sn = snake, pw = pawn. `margin` is 4× minus 1× on the channel that decided
under `better()`'s order (floor, est, ceiling, salted tie). `Δmat.lo` is the
change in `material`'s worst-side contribution — the only term carrying the
death cliff (`CLIFF_MATERIAL_WEIGHT` = 10, one unit). The 9 unattributed deaths
are omitted here and counted in §4.

| scen | s | turn | unit | k | cause | diverged | rung 4x/1x | channel | margin | Δmat.lo | terms that moved | cls |
|---|--:|--:|---|---|---|---|---|---|--:|--:|---|---|
| mix | 1 | 14 | red-B | pw | contest | t12 red | sweep/seed | floor | +0.0245 | +0 | food+0.02, command+0.01 | b |
| mix | 1 | 15 | blue-C | pw | bodyBlock | t15 blue | restart/seed | est | +0.0058 | +0 | none | b |
| mix | 2 | 14 | red-B | pw | contest | t11 red | sweep/sweep | floor | +0.8314 | +10 | material+10.00, contest+1.00, energyEconomy+0.50 | d |
| mix | 3 | 23 | blue-C | pw | bodyBlock | t20 blue | restart/seed | hash tie | +0.0000 | +0 | none | b |
| mix | 3 | 27 | red-B | pw | contest | t25 red | restart/seed | hash tie | +0.0000 | +0 | none | b |
| mix | 4 | 28 | red-B | pw | edge | t22 red | restart/seed | floor | +0.3232 | +0 | momentum+0.16, food+0.03, command-0.02 | b |
| mix | 4 | 42 | green-A | sn | contest | t38 green | restart/sweep | floor | +0.0083 | +0 | none | b |
| mix | 5 | 24 | red-A | sn | self | t8 red | sweep/sweep | floor | +0.0189 | +0 | food+0.02, reach-0.02, command+0.02 | b |
| mix | 5 | 34 | red-B | pw | contest | t19 red | restart/seed | floor | +0.5091 | +0 | momentum+0.33, command+0.17, food+0.03 | b |
| mix | 6 | 9 | red-B | pw | contest | t5 red | restart/sweep | floor | +0.1660 | +0 | momentum+0.16, food+0.01, energy-0.01 | b |
| mix | 6 | 10 | red-A | sn | contest | t4 red | restart/sweep | floor | +0.1972 | +0 | command+0.20, reach-0.02, food+0.02 | b |
| mix | 6 | 52 | blue-C | pw | contest | t51 blue | sweep/conform | floor | +10.6416 | +10 | material+10.00, energyEconomy+0.50, food+0.25 | d |
| pot | 1 | 14 | red-B | pw | edge | t14 red | restart/seed | floor | +0.0045 | +0 | reach+0.02, command-0.02, food-0.01 | b |
| pot | 1 | 23 | blue-C | pw | contest | t23 blue | sweep/seed | hash tie | +0.0000 | +0 | none | b |
| pot | 1 | 36 | green-A | sn | contest | t23 green | seed/seed | floor | +0.5000 | +0 | room+0.50 | b |
| pot | 1 | 55 | red-A | sn | bodyBlock | t49 red | restart/seed | floor | +0.0105 | +0 | reach+0.03, food+0.03 | b |
| pot | 2 | 16 | red-B | pw | contest | t14 red | restart/seed | hash tie | +0.0000 | +0 | none | b |
| pot | 3 | 42 | green-A | sn | contest | t26 green | restart/sweep | floor | +8.5905 | -10 | material-10.00, contest-1.50, food-0.55 | d |
| pot | 3 | 47 | red-B | pw | contest | t33 red | restart/seed | floor | +0.2031 | +0 | momentum+0.15, food+0.02, command-0.01 | b |
| pot | 3 | 48 | red-A | sn | edge | t32 red | sweep/sweep | floor | +0.5152 | +0 | momentum+0.33, food+0.02, command-0.02 | b |
| pot | 3 | 54 | blue-A | sn | self | t25 blue | restart/seed | est | +0.0030 | +0 | none | b |
| pot | 4 | 11 | red-B | pw | contest | t6 red | restart/seed | hash tie | +0.0000 | +0 | none | b |
| pot | 4 | 22 | green-A | sn | contest | t19 green | restart/sweep | floor | +0.0243 | +0 | command+0.03, reach+0.02, food-0.02 | b |
| pot | 4 | 24 | blue-C | pw | bodyBlock | t24 blue | sweep/sweep | floor | +10.5398 | -30 | material-30.00, contest-1.00, energyEconomy-0.50 | d |
| pot | 4 | 50 | red-A | sn | self | t36 red | restart/seed | est | +0.0826 | +0 | none | b |
| pot | 5 | 13 | red-B | pw | contest | t7 red | restart/seed | floor | +0.1629 | +0 | momentum+0.16, food+0.01, energy-0.01 | b |
| pot | 6 | 36 | blue-C | pw | bodyBlock | t30 blue | restart/sweep | floor | +0.1638 | +0 | momentum+0.16, food+0.01, energy-0.00 | b |
| pot | 6 | 36 | red-B | pw | bodyBlock | t35 red | restart/seed | floor | +24.0410 | +130 | material+130.00, contest+2.00, potion+1.07 | d |
| pot | 6 | 55 | green-A | sn | contest | t21 green | restart/sweep | floor | +9.5537 | +0 | momentum-0.24, command+0.02, food-0.01 | b |

## 4. Class counts

Applied to the 38 deaths at 4×:

| class | n | reading |
|---|--:|---|
| **(a)** floor honestly higher, death from a world the floor EXCLUDED (soundness hole) | **0** | `floorComplete` is `true` on BOTH arms at 29 of 29 decisions: every deciding floor rested on an unconditional cover, so there is no excluded world to blame. |
| **(b)** floor equal, or its gap carries no death content — `est`/ceiling/gain-residue decided (bias at depth) | **24** | `material`'s worst-side contribution is IDENTICAL across the two plans; the margin is food/command/momentum/reach residue, or `est`, or a hash. |
| **(c)** a member REWARDED a joint plan's own-body geometry | **0** | No member prices that geometry at all (§5.2). The blind spot is an omission, not a reward. |
| **(d)** other — the death accounting genuinely moved | **5** | `Δmaterial.lo` ≠ 0 (+10, +10, −10, −30, +130): the worst reading keeps a different set of units alive. The only decisions where the floor said anything about who dies. |
| unattributed | 9 | no divergence on the dying unit's own cell |

Within the 29 attributed: 21 decided on the **floor**, 18 of them by a gap under
a tenth of a unit of material (median **0.19**, max 0.83); 3 on **`est`** (0.0030,
0.0058, 0.0826); and **5 on the salted `planTieKey`** — floor, `est` and ceiling
all exactly equal, an arbitrary hash choosing the plan that died.

## 5. The dominant mechanism

### 5.1 The rung that only 4× reaches

Staged-plan provenance, read off the lens at both budgets, over the 29 decisions
— **4×: `seed` 1, `sweep` 7, `restart` 21, `conform` 0. 1×: `seed` 17,
`sweep` 11, `restart` 0, `conform` 1.**

`restart` is `improve`'s perturbed-restart loop (`src/lobster/search/core.ts:912`,
`for (let r = 0; r < cfg.restarts …)`, seeded by `perturb` at `core.ts:854`). It
runs only after `sweep` and `pairRepair` converge AND `jointPolish` fails —
budget the 1× arm does not have: **`restart` fires on 21 of 29 fatal decisions
at 4× and on none at 1×.**

It is not that the deeper search reasons worse. The accepting margins are the
same size at both budgets — median **0.158** at 1× (n = 11) against **0.151** at
4× (n = 13). What changes is how OFTEN one is spent: at 1× the search never
leaves rung 0's `conform` plan on **17 of 28** decisions, at 4× on **2 of 15**.
Budget does not buy better margins, only more occasions to spend one.

### 5.2 What the margin is made of: every danger channel is flat

Both plans re-priced under one bank, per-feature, over the 29 decisions — the
count of decisions on which each term's contribution is IDENTICAL for the two
plans (weight in brackets):

**`room` (3): 28/29. `contest` (3): 25. `material` (10): 24. `momentum` (1): 18.
`reach` (1): 15. `command` (2): 14. `food` (4): 6.**

Every term that could price danger is flat; every term that prices gain moves.
Of the 21 floor gaps `food` contributes to 19, `command` 14, `momentum` 11,
`reach` 10 — and `room` to **one**.

`room` is not merely flat, it is SILENT: exactly zero — lo, est and hi — on **57
of the 58** plan evaluations at these decisions, and on **2 076 of 2 160
(96.1%)** of all `(turn, team)` evaluations across the twelve 4× games, read on
the plan actually played. Two causes, both documented intent:

* **`src/lobster/evaluate/features.ts:786** — `fearOf` opens
  `if (!leavesTrail(s.kind)) return 0;`. Every piece reads zero fear by
  construction, and pieces are **20 of the 38** deaths at 4× and **9 of the 16**
  self-inflicted ones. It must return 0 rather than 1 because of a divisor:
  `ourUnitTerm` (`bound.ts:183`, `worst / ours.length`) divides by our own
  non-held count, and a piece charged the missing-unit fallback put `lo` 1.5 too
  high on ninety worlds.
* **`src/lobster/evaluate/territory.ts:1014** — `keptOf` returns
  `Math.min(region.length, need)` and its flood stops the moment
  `region.length >= need`, with `need = needOf(L) = max(4, L + 2)`
  (`territory.ts:820`) serving as BOTH target and horizon. A snake therefore
  reads zero whenever it can reach `L + 2` cells within `L + 2` steps — on these
  boards, nearly always.

On **11 of the 16** self-inflicted 4× deaths `room` reads 0 on every turn up to
and including the fatal one. It never speaks at all.

### 5.3 Why `material`'s floor cannot break the tie either

`ADMISSION.lo.admits(s, mine) = s.worstAlive && !s.held`
(`src/lobster/evaluate/features.ts:573`) is a BOOLEAN. Two plans putting a unit
on two different cells of the same contested fan give the same `worstAlive`, so
`material.lo` — the only term carrying the cliff — is the SAME NUMBER for both
(identical on 24 of 29). This is `contest-gap.md` §2's flat member state
reaching the one term that outweighs everything: the floor's death accounting
has no per-plan content, so `better()` (`core.ts:676`) falls through it to a
margin of food.

### 5.4 The joint-plan signature

Deaths do concentrate on joint moves, even though no member rewards their
geometry. Among the 29 attributed decisions **12 (41.4%)** move two or three
units; among all changed decisions at 4× (`BUDGET.md` §4) only **14 of 119
(11.8%)** — one-sided binomial **p = 5.2 × 10⁻⁵**. Silence hurts most where two
units move together: the geometry they make between them is one that neither
unit's own reading contains.

### 5.5 Two rules tested here and REFUTED, so nobody re-runs them

* **A bigger `room` horizon.** Parameterising the flood target as
  `N = ⌈need·(1+h)⌉` (built off-tree; `h = 0` byte-identical) wakes `room` on 5
  of 29 decisions at `h = 1.0` and **flips zero comparisons**. Flooding the
  staged cells directly, every body a wall, at depths 4–24 says why: the FATAL
  cell is frequently the ROOMIER one at the moment of choice (mixed s1 T15: 23
  reachable cells against 12 for the 1× arm's). The pocket does not exist yet —
  the plan's own later trail makes it.
* **An acceptance margin.** The 1× and 4× margin distributions are the same
  (§5.1), so any threshold μ that refuses the 4× excess refuses as large a share
  of 1× moves: at μ = 1.0, 9 of 13 at 4× and 8 of 11 at 1×.

## 6. The rule — `survivalDegree` κ. NOT SHIPPED, AND NOW MEASURED — SEE §10.

*(§10 builds the rule, proves it sound on the sweep and the oracle, measures it
at three doses on both budgets, and deletes it. Read §10.4 before re-proposing
anything shaped like this one: the boolean it replaces is not a coarsening of
`c/R`, it is that quantity's indicator, and there is nothing between admitted
and dropped for κ to grade.)*

Fixed at the cause in §5.3 — the floor's death accounting is a boolean, so it is
constant between the two plans and cannot decide.

> **`survivalDegree` κ ∈ [0, 1], default κ = 0.** In the `lo` reading only, a
> unit of ours that `ADMISSION.lo` admits (`features.ts:573`) enters
> `ourUnitTerm` (`bound.ts:154`) with survival weight `w = 1 − κ·c/R` instead of
> `1`, where `c` is the number of the `R` enemy replies the bank actually
> enumerated in which the resolver beats that unit's staged cell, and `material`
> charges `(1 − w)·CLIFF_MATERIAL_WEIGHT` against it. A unit `ADMISSION.lo`
> drops keeps `w = 0`, unchanged.

κ = 0 gives `w = 1` for every admitted unit and `w = 0` for every dropped one —
the shipped booleans exactly, every reading byte-identical. `w` is monotone
decreasing in `c` and never exceeds 1, so the rule can only LOWER a floor: the
inversion `ourUnitTerm` exists to forbid (a death RAISING our floor,
`features.ts:742`) cannot return through it.

**Algebra — it changes the 4× comparison.** `material`'s weight is 10, so one
unit's difference in contested-cell count moves `material.lo` by `10κ/R`; at
R = 4, κ = 0.08 that is **0.20**. Of the 29 attributed decisions 24 are class
(b) — `material.lo` identical, decided by 18 floor gaps (median 0.19, max 0.83),
3 `est` gaps (≤ 0.0826) and 5 exact hash ties (0.0). At κ = 0.08 the new term
exceeds all 3 `est` gaps and all 5 ties outright and 10 of the 18 floor gaps; at
κ = 0.34 it exceeds all 18. On every one of the 24 the deciding channel becomes
a per-plan count of units in contested cells instead of a food increment of
0.006. The 5 class-(d) decisions already move `material.lo` by ≥ 1 unit
(10, 10, −10, −30, +130), and κ ≤ 1 shifts a floor by at most 2.5 per unit, so
their signs are unchanged.

**Algebra — what it does to the 1× choices.** On **17 of the 28** measured 1×
decisions the staged plan IS rung 0's `conform` output, and `conform` is not
gated by `better()` at all (`kernel.ts` `conformNow` → `core.ts:1007`, returning
`repairSelfHarm(...).plan` with no gain-term ladder): no change to a fold term
can move those 17. The other 11 moved off the seed by a single-unit `sweep`,
never `restart` (0 of 29 at 1×), and a single-unit sweep changes the team's
contested-cell count by at most one unit — so the rule perturbs those floors by
at most 2.5κ = 0.20 at κ = 0.08, against measured accepting margins of
0.0154 … 1.9702. **Up to 8 of 28, and 0 of the 17 seed-staged, is the rule's
entire exposure at 1×.** That bound is an argument, not a measurement, and it is
why nothing here is shipped.

**The counter.** `worstAlive` is a boolean because the settlement is a boolean:
a unit is alive after the turn or it is not, and no world exists in which it is
0.8 alive. A fractional `w` publishes a number no resolution can witness, and
`lo` stops being a floor over enumerated worlds and becomes an expectation over
them — the exact laundering the bounds layer exists to prevent, and the shape
`08-DEPTH-VERDICT` already has on record (a depth layer publishing a proved
floor into a mean slot, composing a downward bias with an upward one where
nobody could see it). Every consumer reading `bounds.worst` as a proved lower
bound would silently be reading a mean: the witness veto at `core.ts:673`,
`refutedAt`, and the bank's `floorComplete`. The honest form carries `c/R` as a
DECLARED NARROWING in the basis rather than as a silent reweighting — a
bounds-layer change, far larger than one parameter. That is the case against
merging it, and it is not weak.

## 7. The falsifier

Run the 24 outcome games (mixed + potions, seeds 1–6) at 1× and 4× with κ set.
Refuted unless **both** hold:

1. **Deaths at 1× not up on any class** — mixed ≤ 14, potions ≤ 14, and no
   cause-class above its 1× baseline (contest ≤ 11 / ≤ 12, bodyBlock ≤ 2 / ≤ 2,
   self ≤ 1 / ≤ 0, edge ≤ 0 / ≤ 0, wall ≤ 0 / ≤ 0).
2. **Deaths at 4× down toward 1× on both classes** — mixed ≤ 15 (from 16),
   potions ≤ 18 (from 22), self-inflicted share falling from 16/38 toward 5/28.

One further check falsifies the DIAGNOSIS rather than the parameter: at the 29
attributed decisions `material.lo` must stop being identical across the arms in
at least 18 of the 24 class-(b) cases. **If deaths fall without that, §5.3 is
wrong and the improvement is luck.** — Measured in §10.4: `material.lo`
separates on **0 of the 25** decisions where it was identical, at every dose.
The diagnosis check fails, and it fails before the parameter does.

## 8. What this means for the deadline in production

`BUDGET.md` §5 puts production at ~1 200 work units on a 500 ms turn — a little
over 2×. The gap to this document's 4× arm matters less than it looks: the
affordability guard retires a decision far below the budget offered
(`BUDGET.md` §3: 902 of 2 200 at 4×), and measured on the 29 attributed
decisions the 4× arm actually SPENT a mean of **1 264 nodes** against the 1×
arm's **487**. Production's ~1 200 is the 4× arm's real spend. **On the
entangled decisions, production is already inside the regime measured here.**

That sharpens `BUDGET.md` §5 rather than contradicting it. It said there is
nothing to buy at the top; the mechanism here says there is something to LOSE at
the top, and names the quantity: how often `restart` gets to spend a margin of
median 0.15 carrying no death content. `restart` fires on 21 of 29 fatal
decisions at 4× and none at 1×, so the loss is not smooth in the budget — it
switches on when the clock first affords a perturbed restart after `sweep`,
`pairRepair` and `jointPolish` have all converged. Two consequences:

* **A longer server window, or a faster host, is a RISK and not a gain**: both
  move more decisions past the point where `restart` runs. `BUDGET.md` §5's
  advice to instrument `effectiveDeadlineMs − now` stands; add the second thing
  worth counting in the same instrument — **the share of production decisions
  whose staged plan came from the `restart` rung**, one field off the lens the
  kernel already emits, and the number that says how far into this regime a real
  game sits.
* **The floor that hurts is still the floor.** Nothing here weakens `BUDGET.md`
  §5's finding that 0.5× costs meals on 12 of 12 seeds; the asymmetry is now
  explained rather than observed. Below 1× the search loses `sweep` and stakes
  cells it cannot hold (`contest`); above it the search gains `restart` and
  walks into its own body (`bodyBlock`, `edge`). The head's 550 sits between
  them because it is the budget at which the ascent runs the rungs whose margins
  carry death content and stops before the one whose margins do not.

## 9. Recordings
All under `/tmp/.../scratchpad/dd` (this container): `out/` 24 outcome games with
per-death turn/unit/cause and transcripts; `div/` 12 paired replays (4× reference,
1× re-decided on every board); `dec/` 29 decisions re-priced under one bank with
per-feature breakdowns; `rung/`, `rung2/` the same with a lens on both arms;
`room/` the `room` term on the played plan for all 2 160 `(turn, team)`
evaluations; `rule/` the refuted headroom sweep. **Nothing in `src/` is changed
by this document.**

---

## 10. STATUS — the rule implemented and measured (`survival-degree`)

### 10.1 The baseline, at both budgets

The `budget` worker's 96 outcome recordings reproduce BYTE FOR BYTE at this
head — `mixed` seed 1 at 1× and `potions` seed 3 at 4× re-run here match on
every game counter, on `deathsByCause`, and on `work` (`nodes`, `reads`,
`slices`, `worstDecisionNodes`) — so they are reused as the baseline rather
than re-run, and only `sparse-lean` (which that study did not carry) was
recorded fresh.

| class | budget | deaths | self-inflicted | meals | meals/100 | causes |
|---|---|--:|--:|--:|--:|---|
| `mixed` 1–6 | 1× | **14** | 3 | 446 | 18.108 | contest 11, bodyBlock 2, self 1 |
| | 4× | **16** | 7 | 460 | 20.149 | contest 9, bodyBlock 4, edge 1, self 1, wall 1 |
| `potions` 1–6 | 1× | **14** | 2 | 462 | 19.115 | contest 12, bodyBlock 2 |
| | 4× | **22** | 9 | 476 | 21.278 | contest 13, bodyBlock 4, edge 3, self 2 |
| `snakes` 1–3 | 1× / 4× | 7 / 7 | 7 / 7 | 157 / 157 | 16.236 | bodyBlock 4, self 3 (identical) |
| `sparse` 1–3 | 1× / 4× | 0 / 0 | 0 | 52 / 52 | 7.222 | — (identical) |
| `sparse-lean` 1–3 | 1× / 4× | 0 / 0 | 0 | 45 / 45 | 6.250 | — (identical) |

§1's table is reproduced exactly, which is what licenses the falsifier in §7 to
be read against these numbers.

### 10.2 What was built, and what κ = 0 costs

One knob, on the criterion profile so it folds into `evaluationIdentity` and
two doses can never share an evaluation memo entry, and validated at
construction beside the command knobs (`checkWeights` → `checkSurvivalDegree`:
κ must be a finite fraction in [0, 1], because a negative one RAISES the floor
above the boolean admission and one above 1 prices a live unit as worse than a
dead one). `CENTAUR_SURVIVAL_DEGREE` seeds it once at module load, so a sweep
arm is a run of the same build.

The rule is `survivalWeightOf` in `evaluate/features.ts`, spent in
`materialBounds` and NOWHERE ELSE:

* R is the enemy replies the resolver enumerates on this board — one per live
  enemy, its whole action set at once, the same enumeration `contest.ts`'s
  `contestField` folds. Measured over 540 evaluations it is **4.23 on average**,
  which is the `R = 4` §6's algebra assumed.
* `c` is how many of those replies beat the unit where the plan stages it, by
  the resolver's own `winsContest` at the resolver's own frozen tier.
* `material` charges `(1 − w)` of the unit's own weight in the WORST reading.

**Why not in `ourUnitTerm`, which §6 named.** A factor below 1 on a FEAR
(`room`, `contest`, `momentum` — every `ourUnitTerm` member whose value is
negative) SHRINKS a charge and RAISES the floor. That is the exact inversion
`ourUnitTerm` exists to forbid, so the weight can only be spent where our unit's
own contribution is non-negative, which is `material`'s worst side. `material`
does not route through `ourUnitTerm` at all; the rule is `materialBounds`'s.

**And it stops at a determinate world.** κ applies only while something is
HELD. With every reply named the settlement has already said who dies, `c`
counts replies that are no longer open, and a discount there would put `lo`
under `hi` on a world that IS its own answer — breaking `material`'s declared
discharge, the point-ness `bounds/exact-reply.ts` needs to compare a floor
against a world at all (it would answer `world-not-a-point` and skip every
check), and the law sweep's own worlds.

**κ = 0 is byte-identical, and it is measured rather than argued.**
`sum all 60 5 --nodes` — twenty-five 60-turn games across all five scenarios —
prints the same transcript line for line as the head, deaths, meals, work and
`Q` histogram included. At κ = 0 not one enemy action set is enumerated.

### 10.3 The soundness argument, and what the instruments say about it

**The argument.** `w ≤ 1` and one of our units' own material contribution is
non-negative, so the weighted sum is `≤` the boolean one, term by term and on
every board. Whatever set of worlds the old `lo` was a lower bound over, the
new one is a lower bound over the same set: nothing is claimed about a world, a
floor is lowered. `hi` is untouched — lowering a ceiling is what would not be
sound — so the bracket stays the right way up, and refinement still only raises
`lo`, because `c` and R are facts about the board and the plan and not about
which units a reading admits.

**And the instruments agree, at the largest dose tried.**

| gate | κ = 0 | κ = 0.34 |
|---|---|---|
| `law-sweep` 240 boards / 8 637 worlds | `totalLo` 0, `totalHi` 9, `food.hi` 63, `reach.hi` 220, `command.hi` 600, `reach.lo` 128, `material.hi` 8, `energy.hi` 10, `momentum.lo` 27 | **identical, class for class** — no `material.lo`, no `contest.lo`, no `room.lo`, nothing above its pin |
| `bounds/exact-reply`, four scenarios at seed 1, 30 turns | exact | **102 448 checks over 5 207 844 concrete worlds, 0 floor violations, 0 ceiling violations, and 0 skips** |
| sixteen-arm `CENTAUR_DEBUG_INVERSION`, at 1× AND at 4× | no line | **no `INVERSION` line on any of the thirty-two arms** |

The zero SKIPS matter as much as the zero violations: they are the held gate
above doing its job. A discount that leaked into a determinate world would make
every world non-a-point and turn the oracle's zero into a silence.

**So the rule is sound, and that is not what refuses it.**

### 10.4 The mechanism: the boolean is not a coarsening of `c/R`, it is its indicator

§7's third check — the one that falsifies the DIAGNOSIS rather than the
parameter — is the whole story. The 29 attributed decisions of §3 were replayed
at this head (the game driven at 4×, the 1× arm re-decided on the same board,
both plans priced under ONE bank per κ) and `material.lo` was read on both arms
at κ = 0, 0.08, 0.16 and 0.34:

* `material.lo` is IDENTICAL across the two arms on **25 of 29** decisions at
  κ = 0 — §5.3 reproduced.
* at every κ it separates them on **0 of those 25**. §7 asked for at least 18
  of 24. **The check fails outright.**
* the floors move at all on **3 of 29**, and all three are the class-(d)
  decisions where `material.lo` already differed. On two of them the 4× arm's
  advantage GREW (mix s2 t11 `+0.83 → +1.68`, pot s6 t35 `+24.04 → +30.84` at
  κ = 0.34) and on one it shrank (pot s3 t26 `+8.59 → +7.23`). The rule does not
  control the sign.

The reason is a fact about the two predicates, and it was measured directly.
Over six 4× games (`mixed` and `potions`, seeds 1–3) — 1 080 `(turn, team)`
evaluations, 2 261 readings of one of our units on the plan actually staged:

| | n | of which `c > 0` |
|---|--:|--:|
| `ADMISSION.lo` ADMITS it (`worstAlive`, unheld) | 2 104 | **0** |
| `ADMISSION.lo` DROPS it (contingent) | 157 | **84** |

(1 880 of the 2 261 readings are of a unit that WOULD lose a contest somewhere
on the board, so the zero is not a board with nothing to fear on it.)

**Not one admitted unit was standing where an enumerated reply beats it.** That
is not a coincidence and not a property of these boards: `worstAlive` is false
exactly when the resolver's ledger names a contact this unit could lose, so
"some enumerated reply beats it" is the very condition that DROPS it. The
boolean is the indicator function of `c > 0`, not a coarsening of `c/R`, and
between "admitted" and "dropped" there is no middle for κ to grade. §5.3's
premise — that the floor's death accounting has no per-plan content — is right;
its proposed cause, that the content is being lost to a boolean, is wrong. The
content is not in the floor's own reading to lose.

Where κ fires at all is a place §6 did not name: inside the bank's MODELLED
branches, where one enemy has been named — so the ledger no longer condemns our
unit — while another, still held, has a coarse arrival set that still covers its
cell. That is the 0.20 that moves mix s2 t11's floor at κ = 0.08 (`10κ/R` at
R = 4, exactly §6's arithmetic). It is a real quantity; it is just not the one
that decides which plan kills, and its sign is whichever arm happens to have
named a different enemy.

### 10.5 The falsifier, three doses

The 24 outcome games at each dose, 60 turns, `--nodes`, six seeds per class,
never pooled.

| | mixed 1× | potions 1× | mixed 4× | potions 4× |
|---|--:|--:|--:|--:|
| **κ = 0 (head)** | **14** | **14** | **16** | **22** |
| §7's bar | ≤ 14 | ≤ 14 | ≤ 15 | ≤ 18 |
| κ = 0.08 | **22** | **17** | **16** | **14** |
| κ = 0.16 | **20** | **16** | **16** | **16** |
| κ = 0.34 | **19** | **16** | **17** | **13** |

By cause, against the 1× baseline (`contest` 11, `bodyBlock` 2, `self` 1 on
`mixed`; `contest` 12, `bodyBlock` 2 on `potions`):

| dose | mixed 1× causes | potions 1× causes |
|---|---|---|
| κ = 0.08 | contest 13, **bodyBlock 8**, self 1 | contest 15, bodyBlock 2 |
| κ = 0.16 | contest 12, **bodyBlock 5**, self 2, wall 1 | contest 14, bodyBlock 2 |
| κ = 0.34 | contest 13, **bodyBlock 4**, edge 1, self 1 | contest 14, bodyBlock 2 |

**Meals are not what refuses it.** At 1× `mixed` runs 446 → 439 / 454 / 437
(−1.6% / +1.8% / −2.0%) and `potions` 462 → 479 / 477 / 494 (+3.7% / +3.2% /
+6.9%), so every dose is inside the 3% meals budget on the class that has one
and ahead of the head on the other. The refusal is deaths and only deaths.

**Condition 1 fails at every dose, on both classes, by five to eight deaths on
`mixed` — and it fails in the causes as well: `bodyBlock` at 1× goes 2 → 8, 5,
4, which is the 4× DEATH SIGNATURE appearing at the shipped budget.** Condition
2 is HALF-MET at every dose, and interestingly so: `potions` at 4× falls 22 →
14 / 16 / 13, inside its ≤ 18 on all three, while `mixed` at 4× never moves off
16 → 16 / 16 / 17 and never reaches its ≤ 15. The 4× half of the gap does close
on one class. It closes because 1× has been dragged down to meet it, which is
the one way §7 forbids.

**Why a floor that only goes DOWN costs deaths at 1×.** §5.1 measured the
accepting margins and found them the same size at both budgets — median 0.158 at
1×. The shift this rule applies is `10κ·c/R`, which is 0.20 at κ = 0.08 and 0.85
at κ = 0.34 for a single unit at R = 4: LARGER than the median margin. So it does
not nudge an ordering, it re-decides one, and §6's own exposure argument — "up to
8 of 28, and 0 of the 17 seed-staged, is the rule's entire exposure at 1×" — was
optimistic in the one direction that matters. It counted the decisions the
rule could reach and assumed the perturbation would be small against their
margins; it is not.

### 10.6 STATUS — NOT SHIPPED, and the knob is deleted

κ is reverted to nothing at all: no field on `CriterionProfile`, no constant, no
env seed, no `EvalContext` member. `git diff f98af15 -- src/` is EMPTY — the
tree this branch leaves under `src/` is byte-for-byte the tree it started from,
which is a stronger statement than any re-run, and the gates were taken anyway:
`tsc --noEmit` and `eslint "src/**/*.ts"` clean, and the five suites green
(`law-sweep` at its unchanged pins, `local-game-determinism` and
`basic-intelligence` UNCHANGED — no fixture was re-pinned, because no move
changed — `evaluate` and `territory-acceptance`, 122 tests).

What was bought is the measurement, and it is worth having in three parts:

1. **The rule was implemented and it is SOUND** — the law sweep does not move a
   class, the exact-reply oracle stays exact over 5.2 million concrete worlds
   with zero skips, and the sixteen-arm inversion gate is silent. §6's counter
   ("`lo` stops being a floor and becomes an expectation") is answered by
   construction: a floor lowered over the same worlds is still a floor. The
   objection to a fractional `w` is real but it is about what the number MEANS,
   not about whether the bound holds.
2. **The diagnosis in §5.3 is half wrong, and now measurably so.** The floor's
   death accounting has no per-plan content — that reproduces. But it is not
   because a boolean is coarsening a graded quantity: the boolean IS that
   quantity's indicator, and no unit is ever both admitted and contested. A
   future attempt on this cause has to move `worstAlive` itself — i.e. price
   the plan's own geometry somewhere the resolver's ledger already looks — and
   not re-weight what the ledger has already decided.
3. **The 1× floor is the binding constraint on any floor change**, and the
   reason is §5.1's own finding read the other way: because the accepting
   margins are the same size at both budgets, ANY perturbation big enough to
   re-decide a 4× decision is big enough to re-decide a 1× one, and at 1× the
   decisions being re-decided are the ones the head is already winning. That is
   the shape of §7's first condition, and it is why it is the hard half.

### 10.7 Recordings

Under `/tmp/.../scratchpad/survival` (this container): `base/` the two-budget
baseline (96 games reused from the `budget` study plus six fresh `sparse-lean`),
`k0.08/`, `k0.16/`, `k0.34/` the 24 outcome games per dose, `dec/` the 29
attributed decisions re-priced under one bank at four doses (`kappa-dec.js`),
`scan/` the admitted-versus-contested support over six 4× games (`scan.js`),
`why/` the per-unit `(c, R)` at six of the fatal decisions, and
`transcript-head.txt` / `transcript-k0.txt`, the byte-identity pair.
