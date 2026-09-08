# ORDERING — does the order candidates are considered decide the choice?

The question, exactly: **at a FIXED node budget, does the ORDER in which
candidate movesets are considered decide how good the final choice is — does
the search reach the 4x-budget decision at 1x if better candidates come
first?**

It is a different question from the budget worker's (*how much* budget matters,
and how to split it across decisions) and from `perf-1`'s (*what a node costs*).
Those two move the amount of search. This one asks whether the same amount of
search, spent in a different order, buys a different answer.

**The short version.** Ordering decides the choice on a measurable minority of
decisions and nowhere else. Ranks are shallow — the plan a decision ends on is
first priced at rank 4 (p50) and rank 14 (p90) out of a median 2 631
comparisons — and two thirds of the node budget goes on trials that never lead.
A 4x budget changes the staged set on **10.2%** of 1 953 decisions, **zero of
them** on `snakes` or `sparse`; on **43.2%** of those differences the 1x arm
NEVER PRICED the deeper arm's answer, and **94%** of those arrived on the sweep
rung, which is the one rung a re-ordering can act on. So the lever is real and
it is precisely located.

**And pulling it does not pay.** One ordering rule — the sweep made
breadth-first over candidate rank instead of depth-first over units — did
exactly what it was designed to do: it cut the decisions where 4x disagrees from
19.4% to 15.8% on `mixed`, and cut the never-priced share of those from 48.6% to
31.8%. It also raised deaths on two board classes of five and lowered them on
none. **Refused, per the standing rule**, and the finding it leaves behind is
sharper than the rule was: *reaching the deeper search's answer more often is
not the same thing as playing better.*

---

## 0. What was measured, and with what

`src/lobster/search/core.ts` `observeTrials` — a module-level latch on
`better()`, one occasion per priced trial, in the shape `bounds/loud.ts` settled
for the loud product and for the same reason: threading a sink through
`SearchContext` and `KernelInput` for a counter is the seam a measurement is
supposed to avoid buying, and `SearchContext.trials` is wired only where a lens
is attached. Off, it is one null check per trial. On, it costs two plan keys per
trial — string work, and neither an evaluator call nor a `now()` read, so under
the runner's node clock an observed arm and a plain arm are byte-identical in
every counter. Checked: `sum mixed 20 1 --nodes` with the latch installed
matches the same command without it, field for field.

`OrderRecorder` (`src/tests/local-game.ts`) folds the occasions in the runner,
beside the node clock — the only place a trial's cost can be read without
spending a `now()` on the decision's own budget. Per decision: trials, leader
changes, the rank the staged plan was first priced at, the rank it became the
leader at, the rung it arrived on, and the nodes spent on trials that never led.

An accept advances the leader **iff it was compared against the leader**. That
is why the occasion carries the incumbent's key as well as the trial's: a
perturbed restart ascends against its own local incumbent, so its accepts are
accepts against a plan that was never the decision's answer. Counting them turns
three real leader changes into eight hundred imaginary ones, which is what the
first reading of this instrument did.

The 1x-versus-4x half is the `budget` branch's `--probe` (`fb49e1e`,
cherry-picked, not re-implemented). Separate games at two budgets diverge on the
first disagreement and every position after it is a different game, so a
transcript diff past that point compares boards and not choices. The probe fixes
the board instead: the game advances on the reference decision and at every
(turn, team) the SAME position is decided again at 4x. This work added one field
to its row — `refRankOfWinner`, the rank the REFERENCE arm first priced THIS
arm's answer at, or `0` if it never priced it at all. That integer is the whole
ordering question, per decision:

* `0` — the 1x budget never GENERATED the better answer. Ordering could have
  reached it; the budget ran out first.
* `> 0` — the 1x budget DID reach it and `better()` refused it. Reaching it
  sooner changes nothing the ascent's path does not already decide.

**Arms.** `mixed` and `potions`, seeds 1–3, 60 turns; `snakes` and `sparse`,
seeds 1–3, 60 turns. 1 953 decisions, each re-decided at 4x on its own board.
`--nodes` throughout (`DEFAULT_NODE_BUDGET = 550`).

Reproduce:

```
node dist/tests/local-game.js sum mixed 60 3 --nodes --probe=base-mixed.jsonl --probe-scales=4
node scripts/ordering-report.js base-mixed.jsonl base-potions.jsonl base-snakes.jsonl base-sparse.jsonl
```

---

## 1. The rank distribution, per class

`n` is decisions; `trials` is `better()` comparisons the decision made; `rank`
is where in that sequence the plan it ended on was FIRST priced; `wasted` is the
share of evaluator calls spent on trials that never led.

The class is the decision's observable shape before the search starts — the
cluster size the occupancy-reach graph cuts, and how many of our units are in
contact with a live enemy. Both are `--probe`'s own board-only fields.

| class | n | trials p50 | rank p50 | p90 | max | leader changes p50 | wasted |
|---|---:|---:|---:|---:|---:|---:|---:|
| cluster1 / free | 451 | 5 963 | 3 | 5 | 16 | 1 | 2.0% |
| cluster1 / contact1 | 578 | 3 000 | 3 | 7 | 70 | 1 | 28.8% |
| cluster1 / contact2+ | 372 | 37 | 5 | 14 | 46 | 2 | 68.1% |
| cluster2 / free | 12 | 5 989 | 4 | 5 | 14 | 1 | 2.5% |
| cluster2 / contact1 | 108 | 2 573 | 11 | 25 | 84 | 3 | 57.1% |
| cluster2 / contact2+ | 263 | 52 | 10 | 27 | 125 | 2 | 73.4% |
| cluster3+ / free | 1 | 9 270 | 8 | 8 | 8 | 4 | 5.6% |
| cluster3+ / contact1 | 66 | 5 265 | 12 | 18 | 40 | 4 | 51.2% |
| cluster3+ / contact2+ | 102 | 78 | 12 | 34 | 90 | 2 | 78.7% |
| **ALL** | **1 953** | **2 631** | **4** | **14** | **125** | **2** | **41.9%** |

By scenario, because the classes are not evenly spread across them:

| scenario | n | trials p50 | rank p50 | p90 | max | wasted |
|---|---:|---:|---:|---:|---:|---:|
| `mixed` | 540 | 84 | 8 | 20 | 90 | **70.1%** |
| `potions` | 540 | 740 | 7 | 22 | 125 | **66.6%** |
| `snakes` | 513 | 3 816 | 2 | 5 | 16 | 6.0% |
| `sparse` | 360 | 4 911 | 4 | 5 | 18 | 6.2% |

By the width of the option space the generator offered (candidates summed over
the free set), which is the axis a re-ordering has anything to re-order on:

| candSum | n | rank p50 | p90 | max | wasted |
|---|---:|---:|---:|---:|---:|
| ≤ 8 | 1 072 | 3 | 5 | 18 | 15.5% |
| 9–24 | 577 | 7 | 15 | 125 | 70.2% |
| 25+ | 304 | 13 | 37 | 94 | 70.8% |

And as a distribution, over all 1 953:

| rank | n | share | cumulative |
|---|---:|---:|---:|
| 1 | 399 | 20.4% | 20.4% |
| 2 | 140 | 7.2% | 27.6% |
| 3 | 239 | 12.2% | 39.8% |
| 4–5 | 511 | 26.2% | 66.0% |
| 6–10 | 258 | 13.2% | 79.2% |
| 11–25 | 332 | 17.0% | 96.2% |
| 26–100 | 73 | 3.7% | 99.9% |
| > 100 | 1 | 0.1% | 100.0% |

**Reading R-1 — the answer is found early and then re-confirmed for the rest of
the budget.** Two thirds of decisions have their answer in hand by the fifth
comparison and 96% by the twenty-fifth, against a median 2 631 comparisons made.
The leader changes twice. Everything after the winner's rank is the search
proving to itself that nothing else is better, which is what an anytime search
under a proved floor is *for* — but it means the marginal comparison at this
budget almost never changes the answer.

**Reading R-2 — the wasted share is a fact about CONTACT, not about width.**
Where nothing of ours meets a live enemy, 2% of nodes go on trials that never
lead: the memo serves nearly every trial and the ones that cost something are
the ones that win. In contact with two or more enemies it is 68–79%. That is the
bank paying for real settlements against real replies, and it is the same
population `08-DEPTH-VERDICT` Finding D-1 is about: the decisions where the
bracket is open are the expensive ones.

**Reading R-3 — the rung the answer arrives on names the only lever.** Over all
1 953: `sweep` 74.5%, `seed` 12.5%, `conform` 11.8%, `restart` 1.2%, `polish`
0.1%, `pair` 0. A winner seated as the `seed` was the carried incumbent and no
rung had to find it. A winner from `polish` or `restart` needed a joint move or
a perturbation, and no re-ordering of a per-unit list reaches those at all. Only
`sweep` — the coordinate ascent — is a place where candidate order and unit
order decide what gets tried before the clock stops.

---

## 2. 1x against 4x, per decision, on the same board

1 953 paired decisions.

| | n | share |
|---|---:|---:|
| staged set differs at 4x | **199** | **10.2%** of all decisions |
| … 1x NEVER priced the 4x answer | **86** | 43.2% of differences · **4.4% of all** |
| … 1x priced it and `better()` refused it | 113 | 56.8% of differences |

On the 113 it reached, the 4x answer sat at rank p50 22, p90 41, max 94 — inside
the arm's reach, and refused on the floor rather than missed.

Per scenario:

| scenario | paired | differ | never priced | priced & refused |
|---|---:|---:|---:|---:|
| `mixed` | 540 | 105 (19.4%) | 51 (48.6%) | 54 (51.4%) |
| `potions` | 540 | 94 (17.4%) | 35 (37.2%) | 59 (62.8%) |
| `snakes` | 513 | **0** | — | — |
| `sparse` | 360 | **0** | — | — |

Per class, on the two scenarios that have any:

| class | n | differ | of those, never priced |
|---|---:|---:|---:|
| cluster1 / contact1 | 214 | 2.8% | 50.0% |
| cluster1 / contact2+ | 319 | 24.8% | 60.8% |
| cluster2 / contact1 | 99 | 8.1% | 12.5% |
| cluster2 / contact2+ | 262 | 23.3% | 32.8% |
| cluster3+ / contact1 | 66 | 7.6% | 0.0% |
| cluster3+ / contact2+ | 102 | 39.2% | 35.0% |
| cluster* / free | 18 | 0.0% | — |

**Reading R-4 — on half the board classes the budget is not the binding
constraint at all.** 873 `snakes` and `sparse` decisions, a 4x budget, and not
one staged set moves. Those boards are `candSum ≤ 8` everywhere, the search
converges, and the extra 1 650 nodes buy re-confirmation. Any ordering rule is
inert there by construction, and the A/B below confirms it byte for byte.

**Reading R-5 — where the budget DOES bind, it binds by exhaustion as often as
by refusal, and exhaustion is the ordering-shaped half.** 86 of 1 953 decisions
— 4.4% — are ones where a deeper search's answer was a plan the shipped budget
NEVER PRICED. That is the whole population an ordering rule can address. It is
not nothing, and it is not large.

**Reading R-6 — and it is concentrated on the sweep.** Of those 86, **94.2%**
arrived on the `sweep` rung at 4x and 5.8% on `restart`. Zero on `polish` or
`pair`. The mechanism is arithmetic: `climb` walks units in danger order and
exhausts each unit's `candidateCap = 8` list before touching the next, so one
depth-first pass over three units needs 24 comparisons before the third unit is
priced at all — and in the `contact2+` classes the whole decision affords a
median of 37 to 78. **The clock stops inside unit one or two, and the last unit
in danger order is never re-optimised. Not because its options lost: because
they were never priced.**

---

## 3. The rule, and why it is not merged

**THE ROUND-ROBIN SWEEP.** Make `climb` breadth-first over candidate rank
instead of depth-first over units: every unit's best alternative is tried before
any unit's second, and so on to the cap.

It reads nothing new. The per-unit lists are the generator's own, in the
generator's own order, cut by the same `topCandidates` prefix; `better()` is
still the only thing that accepts; no candidate becomes reachable that was not
reachable before. Only the order differs — and under a budget that stops
mid-pass, a budget that buys `k` trials buys the `k` best-ranked alternatives
spread across the whole free set rather than the first unit's whole list and
nothing else. One extra correctness note it forces: the incumbent must be
re-read per round rather than captured per unit, because under this order a
unit's own move can have been taken in an earlier round.

**It did what it was designed to do.** `mixed`, seeds 1–3, 60 turns, same
budget, same probe:

| | shipped | round-robin |
|---|---:|---:|
| decisions where 4x stages a different set | 105 / 540 (19.4%) | **85 / 538 (15.8%)** |
| … of those, never priced at 1x | 51 (48.6%) | **27 (31.8%)** |
| rank the staged plan was first priced at (p50 / max) | 8 / 90 | **6 / 82** |
| wasted node share | 70.1% | **67.5%** |

Twenty fewer decisions on which four times the budget would have chosen
differently, and the never-priced half of the gap nearly halved. The lever moved
what R-5 and R-6 said it would move.

**And the play got worse.** `sum all 60 3 --nodes`, per board class, never
pooled, three paired seeds each:

| class | deaths/100 | meals/100 | dithers/100 |
|---|---|---|---|
| `mixed` | 0.492 → **0.758** (+0.266) | 17.901 → 17.577 (−1.8%) | 6.037 → 3.685 |
| `potions` | 0.534 → **0.748** (+0.214) | 19.124 → 18.730 (−2.1%) | 8.043 → 3.400 |
| `snakes` | 0.723 → 0.723 | 16.190 → 16.190 | — |
| `sparse` | 0 → 0 | 7.222 → 7.222 | — |
| `sparse-lean` | 0 → 0 | 6.250 → 6.667 | — |

**Deaths up on two classes of five and down on none.** Meals are inside the 3%
budget and the dither rate improves markedly on both live classes — but the
standing rule is that a change must be at least as good as the baseline **per
board class**, and this is the same ledger `08-DEPTH-VERDICT` §7.1 refused
`b1-sound` on. **Reverted.** `climb` is unchanged on this branch; the rule is
written down here so the next attempt starts from the measurement rather than
from the idea.

**Finding O-1 — reaching the deeper search's answer more often is not the same
thing as playing better.** This is the finding the null carries, and it is
stronger than the rule would have been. The round-robin demonstrably moved the
1x choice TOWARD the 4x choice on 3.6 percentage points of decisions, and lost
units for it. So the 4x answer is not a better MOVE; it is a different local
optimum with a marginally higher proved floor, and the floor the bank proves is
not the game's outcome. An ordering rule aimed at "agree with a bigger budget"
is therefore aimed at the wrong target, and any future rule has to be argued
against deaths and meals directly rather than against agreement with 4x.

**Finding O-2 — the depth-first sweep is not an accident, it is a bias worth
having.** The measured cost of round-robin is exactly its stated benefit read
the other way: it stops re-optimising the most endangered unit after ONE
alternative in order to give a safe unit its first. `dangerOrder` puts the unit
that dies in the floor-justifying world first *because that is where a move
change is worth the most*, and exhausting that unit's list is what cashes the
ordering in. Spreading the budget uniformly across the free set discards it. The
deaths are on `contest`, `edge` and `bodyBlock` — the endangered-unit
categories — which is the mechanism, not a coincidence.

---

## 4. The verdict

**Ordering decides the choice on 4.4% of decisions at the shipped budget, and
the shipped order is not the wrong one.**

Stated as the question was asked: *does the search reach the 4x-budget decision
at 1x if better candidates come first?* Partly — a re-ordering closed a fifth of
the 1x/4x gap and a half of its exhaustion-shaped half. But the 4x decision is
not worth reaching: the arm that reached more of them played worse on every
class that had anything to lose.

What this does NOT say:

* It does not say the generator's order (`orderKey` / `gainOrderKey`) is
  optimal. It says the SWEEP's consideration order is, against this alternative,
  on these arms. `candidates.ts`'s comparator terms were not varied here.
* It does not say ordering is inert. 4.4% of decisions are decided by
  exhaustion, and 94% of those on one rung. A rule that reaches them WITHOUT
  taking budget away from the endangered unit is not ruled out by anything
  above — it is simply not the rule that was tried.
* It does not license spending the wasted 42% (68–79% in contact) differently.
  Those nodes are the bank proving a floor, and `08-DEPTH-VERDICT` §7.1's
  oracle says the floors are exact on every real arm.

---

## 5. Gates

The instrument is merged; the rule is not, so no behaviour gate is owed for it.
For the instrument:

* `npx tsc --noEmit -p .` — clean.
* `npx eslint "src/**/*.ts"` — clean.
* `npx jest --maxWorkers=2 src/lobster/__tests__ src/lobster/bounds/soundness.test.ts
  src/tests/local-game-determinism.test.ts src/tests/lens-determinism.test.ts
  src/tests/lens-inspection-cost.test.ts` — 18 suites, 321 tests, green.
* **Byte-identity**: `sum mixed 20 1 --nodes` with the latch installed is
  field-for-field the same summary as without it. The latch adds no evaluator
  call and no `now()` read, so it cannot move the node clock.
* Sixteen-arm inversion gate, exact-reply, the law sweep's ratchet and
  `lens-inspection-cost` are untouched by an instrument that only reads: no
  bound, no comparator and no budget split was edited on this branch.

Files: `src/lobster/search/core.ts` (`observeTrials`, `TrialOccasion`),
`src/lobster/search/index.ts`, `src/tests/local-game.ts` (`OrderRecorder`,
`DecisionOrderStats`, the probe's ordering fields),
`scripts/ordering-report.js`.
