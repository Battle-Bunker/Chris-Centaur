# THE ADJUDICATION MEMBER — the boundary the flow fold does not contain

`basis-audit.md` §4.1 established that the three-flow basis is complete in the *interior* of a
game (0.00% attribution gap) and that **100% of the remaining residual lives at the terminal
boundary** (`corr(residual, terminal gap) = +0.969`). This is the type sketch for the member that
occupies that boundary.

It opens with a finding I did not expect and which changes what the member is for.

---

## 1. THE RULE, READ FROM THE ENGINE — and it is not the metric we optimise

`TeamSnekProcessor.calculateWinners` (`:716`) is four branches:

```
aliveTeams == 0          → calculatePreviousTurnTeamOutcome()   // settle on the previous turn
aliveTeams == 1          → that team wins
reachedTurnLimit         → maxScore = max over teams of Σ unit lengths
                           topTeams = every team at maxScore
                           one  → that team wins
                           many → DRAW between the top teams
otherwise                → []                                   // game continues
```

> **At the turn limit the game is WINNER-TAKE-ALL BY MAXIMUM TEAM WEIGHT — an argmax with a
> draw rule — not a proportional share.**

That is a different objective from the one this program measures. `sharePar` is proportional
(the R1 replays show 0.935 / 0.995 / 1.070 on the knight board — three living teams splitting),
whereas `calculateWinners` at the cap awards everything to the single heaviest team.

**This is exactly the KataGo tension, live in our own codebase, and pointing the opposite way to
how we are calibrated.** KataGo maximises `winLossUtilityFactor · P(win) + ~0.3 · U(score)` —
win/loss dominant, score a minority term — precisely because a score-margin objective plays badly
when the *rule* is win/lose. We are doing the reverse: **the engine's rule is argmax (win/lose),
and every number in this program is a score-margin metric.** The two objectives differ sharply
in the regime that matters:

| position at the cap | under `sharePar` | under `calculateWinners` |
|---|---|---|
| 40% → 45% of weight, still second | a real gain | **worth nothing** |
| 34% → 35%, crossing into first | the same small gain | **worth the entire game** |
| clearly first, growing further | a real gain | **worth nothing** |
| level tie at the top | — | a draw; one weight unit breaks it |

**This is an owner question, not a design choice I can make**, and it is the single highest-value
question I have found: *which of the two is the objective — the harness's proportional `sharePar`,
or the engine's argmax-at-cap?* The pinned ruling states the share metric, so I have built to it
throughout and I am not proposing to change it. But the engine implements the other one, and if
the owner's real games are judged by `calculateWinners`, then **every measurement this program has
taken is of a surrogate**, and the KataGo experience says the surrogate is the one that produces
slack play near the boundary.

Either way the adjudication member is required, because under *both* readings the terminal step is
a rule the evaluator must model and currently does not.

---

## 2. WHAT THE MEMBER READS

Deliberately small, and every field is on the live board:

```
AdjudicationMember reads:
    K            team count                            (from roster)
    W            total live weight                     (Σ over live units)
    w[team]      per-team live weight                  (Σ per team)
    alive        the alive SET, per team               (not a count — see §3)
    turn         current turn number
    capDistance  maxTurns − turn, or ∞ when uncapped   (the only novel input)

emits:  a distribution over terminal outcomes, in the score's own units
```

`capDistance` is the field nothing in the current evaluator has. Every existing feature is
turn-invariant: `reach`, `room`, `material` and `command` all compute the same number on turn 5 and
turn 119. **But the value of a position genuinely depends on how much game is left** — being 2
weight behind is nearly irrelevant at turn 5 and decisive at turn 119 — and no member can express
that today. That is the concrete gap this member fills, and it is also, I now think, the honest
explanation of the length-dependence in my residual: the residual loaded on game length because
the model had no term that knew what turn it was.

**The alive *set*, not a count**, because elimination is what moves `W` discontinuously and the
member must price *which* team leaves, not how many.

---

## 3. THE ONE LEGITIMATE IMPLEMENTATION

**The member must not re-implement the adjudication rule. Its one legitimate implementation is a
call to the engine's own exported `adjudicate()`.**

This matters more here than anywhere else in the evaluator, for a reason specific to this member:
every other feature is an *approximation* of something, so a divergence between our version and
the engine's is a quality question. Adjudication is not an approximation — it is a rule with a
correct answer, and a member that disagrees with the engine is simply wrong, silently, at exactly
the moment the game is decided. The four branches in §1 include two easily-missed cases (the
mutual-annihilation settlement onto the *previous* turn, and the draw among tied top teams) that a
re-implementation would very likely get wrong and never be caught getting wrong.

So this member is a direct consumer of the composition lens's one-adjudicator engine ask, and it
should be stated as a **requirement** rather than a preference:

- the engine exports `adjudicate(board, turn, cap) → outcome`, pure and total;
- the member calls it on candidate terminal states;
- there is exactly one implementation of the rule in the system, and a test asserts the member and
  the live engine agree on the replay corpus.

The member's *own* content is therefore not the rule at all — it is the **distribution over the
states the rule will be applied to**, which is genuinely an evaluator's job.

---

## 4. THE SHAPE OF ITS CONTRIBUTION, AND WHY IT IS NOT A FLOW

```
contribution = E[ adjudicate(terminal state) ] − adjudicate(current state)
```

Two properties follow, and both matter for how it is registered:

**(a) It is potential-based, so it inherits the §2 safety theorem.** It is a difference of a state
function, so by Ng et al. it is policy-invariant and may be dialled to any weight without
distorting optimal play — the same guarantee the flow fold has, for the same reason.

**(b) But it is not linear, and that is the whole point of having it.** The flow fold is the
*derivative* of share; this member is the *terminal condition*, and it contains the two
non-linearities the fold structurally cannot express: **the elimination step** (a team's weight
leaving `W`) and, under §1's reading, **the argmax at the cap**. My cycle-1 finding was that the
score's dominant nonlinearity is elimination and that a linear fold cannot express a step. This
member is where that step lives. The interior/boundary split is the resolution of that finding:
**the fold is complete and linear in the interior; every nonlinearity is at the boundary; they are
two members, not one.**

**Cost and gating.** `capDistance` gates it for free: when `capDistance` is large the terminal
distribution is diffuse and the member is near-inert, so it need not run; as the cap approaches it
becomes the dominant term. That is a natural schedule rather than a tuned one, and it is the
member's own answer to "when is it worth computing".

---

## 5. WHAT IT DOES *NOT* NEED

No fitting. `K`, `W`, `w[team]`, `alive` and `capDistance` are all read off the board; the rule
comes from `adjudicate()`. **The only genuinely uncertain input is the distribution over terminal
states**, which is the search's job and not this member's — so the member's own provenance is
`derived`, and it carries none of the debt my fitted `k` does.

---

## 6. AND ONE RESULT IT ALREADY EXPLAINS

The fold's conversion factor predicts not only the level of the score but its **spread**, which is
the search-theory lens's question. `SD(sharePar)` should equal `(K/W)·SD(terminal weight)`:

| cell | SD(sharePar) | SD(terminal weight) | mean W | K/W | predicted SD | **ratio** |
|---|---|---|---|---|---|---|
| snake6 | 0.898 | 13.53 | 43.8 | 0.0685 | 0.927 | **0.969** |
| snake5-queen | 0.998 | 17.71 | 54.3 | 0.0552 | 0.978 | **1.020** |
| snake5-knight | 0.582 | 5.50 | 25.0 | 0.1200 | 0.660 | **0.883** |

**Ratios 0.969 / 1.020 / 0.883** across cells whose share-SD ranges 0.582–0.998 and whose
weight-SD ranges 5.50–17.71. The conversion holds to about ±12%, so **the fold predicts spread,
not just level.**

That makes the search-theory lens's temperature remedy **derivable rather than fitted**. A softmax
temperature denominated in absolute weight units (`t0 = 0.25`) corresponds to a share-denominated
temperature of `(K/W)(1−p)·t0`, and `K/W` alone varies **2.2×** across these three cells
(0.0552 → 0.1200). So one `t0` is a different temperature on every board — precisely their
"nearly-argmax on spread boards, nearly-uniform on tied boards" pathology, with the scale factor
now measured. **The remedy is to denominate the temperature in share units and divide by
`(K/W)(1−p)`, which is computable from the live board with no fitting.**

One honest boundary on that: the fold supplies the **conversion** from weight spread to share
spread, which is what a temperature needs. It does not predict the weight spread of a proposal
pool itself — that is a property of the plan distribution, i.e. a search quantity, not a value
one. So the correct construction is to normalise by the pool's own measured spread, with the fold
supplying the units that spread should be expressed in.

---

## 7. PROVENANCE ADDENDUM — defect #5, and a fourth inert-weight path

**C-V1 accepted, as provenance defect #5 for `value/fold-k@1`.** My `k` is fitted on *realised*
outcomes — the pre-reduction side — and a consumer that folds-then-reduces obtains a different
number from one that reduces-then-folds. The fit provenance therefore needs a **"which side of the
reduction"** coordinate, and mine is `realised / pre-reduction`. The running list for the fitted
member: single-lineage corpus, single-game labels, regicide-absent regime, clock-mixed extraction,
and now pre-reduction fit side. **Five defects; the derived member `value/fold@1` at `k ≡ 1` has
none of them, and I continue to recommend seating only that one.**

**And a fourth path to an inert weight, which I add to my taxonomy from the search-theory lens's
mechanism finding.** My three were (a) admission, (b) no gradient at the point of comparison,
(c) scale separation. Theirs is upstream of all of them: **a saturated pure-maximin floor carries
no ordering information exactly on contested cells** — every contest-entering option floors at
`−inf-dead`, so adjudication falls through to `est` and then to the tie key. This is cause (b)
arising *before the evaluator is consulted at all*, which is materially different from the other
three:

> **No evaluator improvement can restore that gradient**, because the ordering is decided
> upstream. A term measured as inert on contested cells may be perfectly good and simply never
> consulted there.

That is a genuinely worse failure than mine, and their free test — splitting adjudication counters
by contested-vs-quiet cells — should run *before* any of my instruments, since it partitions the
population on which mine are meaningful. It also sharpens my §4.7 unit-class point: contested
cells are disproportionately where fat accounts fight, which is the queen board, which is where
everything else in my lens says the game is decided.
