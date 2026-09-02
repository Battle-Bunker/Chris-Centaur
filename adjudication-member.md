# THE ADJUDICATION MEMBER — the boundary the flow fold does not contain

> **SUPERSEDED ON THE KIND QUESTION by composition's `16-TERMINAL-BOUNDARY.md`
> (design/joints-composition @ 2c7e59a), and their resolution is better than this sketch. See §8,
> which is the part to read.** They split what I wrote as one object into two: `model/terminal@1`
> (the exact settling rule, a MODEL member, unconditional, no rivals) and `value/horizon-*`
> (ordinary VALUE members pricing the *approach*, which bots may vary). My §2–§4 conflate the
> two. Adopt their split; §8 records where my sketch was wrong and the one thing I would add.

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

**This is an owner question, not a design choice I can make**: *which of the two is the objective
— the harness's proportional `sharePar`, or the engine's argmax-at-cap?* The pinned ruling states
the share metric, so I have built to it throughout and am not proposing to change it.

### 1.1 MEASURED — and it moderates my own alarm

I first wrote that if real games are judged by `calculateWinners` then "every measurement this
program has taken is of a surrogate". **I measured it, and that claim is too strong.** Over all
four completed cells (192 games):

| cell | median top-2 weight margin | as % of W | games decided by ≤2 weight | top team's share |
|---|---|---|---|---|
| snake6 | 19.5 | 42.2% | **6%** | 70% |
| snake5-queen | 23.0 | 41.2% | **6%** | 74% |
| snake5-rook | 16.5 | 37.5% | **10%** | 68% |
| snake5-knight | 5.0 | 25.7% | **17%** | 56% |

And the two rules **agree on the ranking in every cell**:

| cell | argmax winner (share of games) | mean sharePar |
|---|---|---|
| snake6 | territory 98% / reflex 2% / material 0% | 2.104 / 0.413 / 0.484 |
| snake5-queen | territory 62% / material 38% / reflex 0% | 1.739 / 1.203 / 0.057 |
| snake5-rook | territory 65% / material 33% / reflex 2% | 1.550 / 1.126 / 0.325 |
| snake5-knight | territory 38% / reflex 33% / material 29% | 0.995 / 1.070 / 0.935 |

**Margins are wide, not knife-edge, and the surrogate ranks the bots the same way the real rule
does.** So `sharePar` is a sound *measurement* instrument and the program's comparative verdicts
are not invalidated. I withdraw the stronger claim.

**Where the divergence is real is in DECISIONS near the cap, not in measurement.** 6–17% of games
end within two weight units, and in exactly those the objectives give opposite advice: under
argmax a risky trade that crosses into first is worth the whole game and a gain that leaves you
second is worth nothing; under share both are small and smooth. That is composition's turn-limit
razor scenario, and it is currently unrepresentable at any weighting because nothing in the
evaluator knows the game ends. So the finding survives as a **`value/horizon-*` design constraint**
rather than as an indictment of the measurement programme — which is a smaller claim than I
started with, and the one the data supports.

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

---

## 8. ALIGNED TO COMPOSITION'S SPLIT — where this sketch was wrong

Their resolution, adopted:

| object | kind | who may vary it |
|---|---|---|
| `model/terminal@1` | **MODEL** — the exact settling rule (cap, last-team-standing, same-turn annihilation on the previous turn's weights) | **nobody**; one member, no rivals, sourced from the engine's `adjudicate()` |
| `value/horizon-*` | **VALUE** — pricing the *approach*: turns-remaining schedule, elimination premium, brinkmanship | any bot; genuine strategy alternatives |

**Where my sketch was wrong.** §2–§4 treat this as one member. That is the mistake their seam
rule catches: *what the rules do is not a preference, and what it is worth to approach them is
nothing else.* Collapsing them puts "how the game ends" on a knob. Concretely, three of my claims
need re-filing:

- my §3 ("the one legitimate implementation is `adjudicate()`") belongs to **`model/terminal@1`
  only** — and their receipt is stronger than my argument: the rule existed **three times**
  (server, harness, bot), disagreed **three ways**, and the bot priced a winning mutual trade as a
  flat loss and therefore **refused winning trades**. That is the abstract hazard I described,
  already realised.
- my §4(a) (potential-based, inherits the Ng safety theorem, dialable at any weight) applies to
  **`value/horizon-*`**, not to the model member — nobody dials a correction, so invariance is
  irrelevant to it. The `invariance` coordinate still does work, but on the VALUE half only.
- my §4 gating on `capDistance` is a **`value/horizon-*`** concern (a schedule), not a property of
  the rule.

**What I would add to their row.** Their line *"the flow fold declares its domain as the INTERIOR;
its boundary value is supplied by `model/terminal@1` and never extrapolated"* needs the fold to
carry a **domain** field and to *refuse* terminal states — which is the same refusal mechanism the
epistemics lens asked for on premise coordinates. **One mechanism, two uses:** a member declares
what it is defined over, and refuses outside it. That is worth stating once in the manifest rather
than twice in two lenses' documents.

And their `FitProvenance.metric = 'model/terminal@1'` (the scoring functional *is* a member id,
not a string) fixes something my provenance list had as a weak spot: my defect #5 is *"which side
of the reduction"*, and an addressed metric object is what makes that coordinate checkable rather
than declarative. Likewise their `behaviourId` (output-addressed identity over a canonical probe
suite) resolves a question I had left open in my re-fit drift metric: **a `k` re-fit that changes
no decision retains its prior measurements**, so drift only invalidates evidence when it changes
behaviour. That is the right criterion and I adopt it.

**Their falsifier is safe to run.** I checked the one way it could have fired spuriously — that my
terminal gap might be an unobservable last turn rather than an unmodelled rule. It is not: the gap
is **0.0097** in games with no elimination against **0.1248** where one occurred, 12.9× larger
where the settling rule does more work, when an unobserved-turn artefact would be roughly equal in
both. Details in `rook-forecast-scored.md` §5.

**One caveat I would attach to their §1 reading.** They note that a potential-based decomposition
telescopes by construction, so interior-summing is "the check that the decomposition is genuinely
potential-based, and it passed" — correct, and I would add the sharper consequence I only reached
after the epistemics red team: **the telescoping is why my R² was never evidence for the basis.**
The two informative facts are the ones they name (the potential is the *right* one, and the
residual is *concentrated* at the boundary), and both survive everything that has been thrown at
the lens. The R² does not, and should not be quoted in the manifest row.
