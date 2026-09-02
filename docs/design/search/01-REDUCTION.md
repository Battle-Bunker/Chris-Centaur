# 01 — The REDUCTION joint: the solution concept as a plug-in member

SEARCH-THEORY lens, document 1. Owns design question (2): *simultaneous-move
handling — is there a principled search joint whose solution concept is a
plug-in member, which is what Ruling 13's worst-case-only start assumes?*

The composition lens already named this joint and its obligation:

> **REDUCTION** (exactly one — composing two is a category error) … *"moves are
> simultaneous, so a plan's value is a function over enemy actions that
> something must reduce to a comparable key"* … *"REDUCTION is five places at
> once (the ladder's order, the depth rung's position, the bank's quantifier,
> the posture defaults, each term's own endpoint), and the bot's risk posture is
> therefore ε = 1.0 chosen by nobody."*
> — `docs/design/joints/07-SYNTHESIS.md` §1, §2 finding 8

This document supplies what that carve was missing: the **type** of a member,
the **law** the type must satisfy, the **member list** with a one-parameter
family connecting them, and the **type boundary** inside the joint that nobody
has costed.

**Correction absorbed from the PRIOR-ART lens (design/prior-art, docs 01–02),
and it changes the shape of this document.** My first pass presented the
solution concept as a single pessimism axis with maximin at one end. That is
wrong in a way worth stating loudly:

> **`ε = 1` (pure maximin) is the *pure security level* — the value of moving
> first while being seen. It is strictly below the stage-game value, and NO
> setting of `ε` or `τ` reaches the game-theoretically correct answer, because
> the whole family interpolates between "seen by an adversary" and "seen by a
> model". Being seen is the defect; the paranoia level is not.**

The field's zero point (Bosanský, Lisý, Lanctot, Čermák & Winands, AIJ 237,
2016) is the **stage-matrix Nash equilibrium by LP** — a distribution, reached
by a fixed point, not by any choice of reference measure. So the joint has two
axes and they are not the same axis: an **ambiguity** axis (§2, which
interpolates between two provably-wrong answers) and a **reading** axis
(§4, which is where correctness lives). Everything below is organised on that
correction.

---

## 1. The type

A plan's value is not a number. It is a function

```
v_a : B → ℝ,     v_a(b) = evaluate(resolve(a, b))
```

and the joint's job is to reduce `v_a` to a comparable scalar. Every candidate
solution concept in the literature is such a reduction plus, in one case, a
change to what we output. So:

```ts
/** The reduction joint. One per decision, declared, stamped on every value. */
interface Reduction {
  /** WHICH replies are in play at all. The bank's rungs are members of this. */
  readonly support: SupportRestriction

  /** The AMBIGUITY SET over Δ(support): a closed convex set of reply
   *  distributions the reduction is willing to be wrong about. */
  readonly ambiguity: AmbiguitySet

  /** Fixed by law: the lower expectation over `ambiguity`. NOT a member. */
  // reduce(v: (b: B) => number): number = inf_{P ∈ ambiguity} E_P[v]
}
```

That is the whole type, and the third field is deliberately not a slot.

### Law R1 — the reduction is a lower prevision, always

> **Every member of the REDUCTION joint is `inf_{P ∈ 𝒫} E_P[v_a]` for some
> closed convex `𝒫 ⊆ Δ(B)`. Members differ ONLY in the shape of `𝒫`. A member
> that is not of this form is not a member of this joint.**

This is not a formal nicety. It buys four properties for free, each of which we
currently prove or assume separately:

| property | what it gives us |
|---|---|
| **monotone** in `v_a` | a tighter evaluator can never lower the reduced value — the whole bounds lattice's premise |
| **translation-equivariant**, **positively homogeneous** | weight units stay weight units; no member introduces a second scale (the VALUE lens's common-currency law survives the reduction) |
| **superadditive** (concave) | `reduce(v + w) ≥ reduce(v) + reduce(w)` — so a decomposed evaluator's per-term reductions are a *sound floor* on the reduction of the sum. This is exactly what the bank's B1 additivity argument needs, and it currently has to be argued by hand per rung |
| **`𝒫 ⊆ 𝒬 ⟹ reduce_𝒫 ≥ reduce_𝒬`** | the member axis is *ordered by pessimism*, so "less paranoid" is a well-defined direction and the sound floor is the maximal element |

The last row is the one that matters architecturally: it makes **the sound floor
the vacuous member of the same joint** rather than a different mechanism. Today
the bank computes a floor by one formula and the ordering channel computes `est`
/ `µ` by an unrelated one; under R1 they are two members of one family evaluated
on the same `v_a`, and the *difference between them* is a measured quantity
rather than an accident.

## 2. The members

Ordered from most to least pessimistic. Every one is `inf_{P∈𝒫} E_P[v_a]` for
the stated `𝒫`.

| member | `𝒫` | closed form | who has it today |
|---|---|---|---|
| **maximin / vacuous** | all of `Δ(B)` | `min_b v_a(b)` | **shipped.** `bank.price()`'s floor; `scoreOptions`'s inner min; the whole ladder |
| **CVaR at level τ** | density ratios `≤ 1/τ` against a reference `P₀` | mean of the worst `τ`-fraction under `P₀` | nobody |
| **ε-contamination (Huber)** | `{(1−ε)P₀ + εQ : Q ∈ Δ(B)}` | `(1−ε)·E_{P₀}[v_a] + ε·min_b v_a(b)` | **proposed by the belief lens** as `(1−ε)·estAdvised + ε·lo`, with `ε = 1` shipped |
| **best-response-to-model** | `{P₀}` | `E_{P₀}[v_a]` | the `est` channel is a degenerate cousin; no declared `P₀` anywhere |
| **quantal / logit response** | `{P₀(β)}` where `P₀(β) ∝ exp(−β·v_a(b))` | `E_{P₀(β)}[v_a]` | nobody. **Note: this is a SUPPLIER change, not an ambiguity change** — see §3 |
| ~~**Nash of the abstraction**~~ | — | — | **NOT A MEMBER OF THIS AXIS.** `P*` is a fixed point, not a set around a reference measure; and it requires our own row to become a distribution. See §4 |

**The axis is bounded above by a wrong answer.** Its most optimistic member is
`E_{P₀}[v_a]` — best response to a guess — and its most pessimistic is
`min_b v_a(b)` — the pure security level. The stage-game value lies *outside the
interval spanned by the family*: it is above the security level always, and
above or below the model-response depending on how wrong `P₀` is. So this axis
is a **calibration** axis, not a correctness axis. Turning `τ` is choosing how
much of your model to trust; it is not approaching the right answer from either
side. That distinction is the prior-art lens's contribution and it should be
stated in any owner briefing that offers a paranoia dial, because "turn it down
and we play better" is exactly the wrong intuition to leave in place.

Three observations that the member table makes visible and that prose does not.

**(a) The belief lens's ε-contamination form is exactly right, and it is a
member of this family — which retro-justifies it.** `(1−ε)·estAdvised + ε·lo`
is not an ad-hoc blend; it is the *lower prevision of the Huber ε-contamination
class*, a textbook coherent risk measure, and the reason it has a closed form is
that the class's extreme points are `P₀` and each point mass. So the two lenses
converge on one object from opposite directions: they derived it from a credal
set over enemy actions, I derive it from the reduction of a matrix game.
Cross-lens agreement of this kind is worth more than either derivation alone.

**(b) CVaR and ε-contamination are *different shapes of the same ambiguity
ball*, and CVaR has an extra property we want.** Chow, Tamar, Mannor & Pavone
(arXiv:1506.02188) prove the interpretation that matters here:

> a CVaR objective, besides capturing risk sensitivity, is *equivalently* the
> expected cost under worst-case modelling errors, for a given error budget.

That is precisely our situation. We do not have a "risk appetite" — we have a
*model* of the enemy whose error we cannot bound. CVaR's `τ` is denominated as
an **error budget on the opponent model**, which is a quantity a person can
reason about ("I believe my model is right about 80% of the mass"), whereas
`ε` is denominated as a mixture weight, which is the same number wearing a less
interpretable hat. **Recommendation: the shipped dial should be `τ` and `ε`
should be presented as its Huber-shaped sibling, not the other way round.**

**(c) `ε = 1.0` "chosen by nobody" is the vacuous member, and the composition
lens's phrasing understates it.** It is not that a default went unchosen. It is
that we have been playing the *maximally pessimistic member of a family we did
not know was a family*, and the four independent confirmations of "structural
passivity" are the measurement of that choice. Document 00 §4 gives the
magnitude: it is the pure-vs-mixed gap, and it is bounded below by
`E_{P₀}[v_a] − min_b v_a(b)` for whatever `P₀` we would have named — a number
computable from the bank's own witness columns.

## 3. What is NOT on this axis (and why the distinction is load-bearing)

Two things that look like solution concepts and are not members of `ambiguity`:

**Quantal response is a SUPPLIER, not a paranoia level.** A logit opponent
changes `P₀` — the reference measure — not the set around it. Its `β` and our
`τ` are orthogonal: one says *what we think they will do*, the other says *how
wrong we are willing to be about that*. Collapsing them (which is easy to do,
because both are "temperatures") reproduces exactly the defect the composition
lens names as `REDUCTION is five places at once`. So the joint has **two dials
and they are not interchangeable**:

```
  supplier : (board, ourPlan) → P₀ ∈ Δ(B)      -- the belief lens's weight supplier
  ambiguity : P₀ → 𝒫 ∋ P₀                      -- this document's τ / ε
```

The belief lens has this right (*"a WEIGHT SUPPLIER over the coordinates of S …
'adversarial' is its zero point"*) and this document supplies the missing half:
`'adversarial'` is not a *supplier* at all, it is `𝒫 = Δ(B)`, at which point the
supplier is irrelevant because the infimum ignores it. That is why the socket
looks empty today: **the vacuous ambiguity set makes the supplier
unobservable**, so four consumers improvised suppliers that no measurement could
ever distinguish. Turn `τ` down from 1 and the supplier becomes measurable for
the first time.

> **Finding R-1.** The opponent-model socket cannot be validated while the
> reduction is vacuous. Any experiment that varies the supplier at `ε = 1` is
> measuring nothing, because the reduction discards it. This retro-explains why
> the program has four improvised enemy-treatments and no verdict distinguishing
> them.

**Support restriction is a third axis, and it is where soundness lives.**
`support` says which replies are in `B` at all; `ambiguity` says how the
remaining mass is distributed. The bank's rungs are members of `support`:

| bank rung | as a support restriction |
|---|---|
| B0 | replace each uncontrolled unit by its possibility cloud (a *widening* of `B` — sound because it contains the true reply) |
| B1 | one enemy exact, rest held; additive over enemies |
| B2 | the banked witness columns only (a *narrowing* — sound as a ceiling, never as a floor; the code enforces this and the enforcement is correct) |
| B3 | the full product within the declared cap |

The `WHICH-truncation is forbidden` law in `bank.ts` is exactly the statement
that **narrowing `support` breaks the lower-prevision property while widening
it preserves it**. That law is currently written for the bank; under R1 it
becomes a law of the joint and applies to every future member automatically.

## 3½. The floor goes flat exactly where the decision is hard

The prior-art lens's live suspect, which I can confirm from the code and which I
think is the most under-appreciated mechanism in this whole lens:

> **A saturated pure-maximin floor carries no ordering information precisely on
> contested cells.**

The mechanism. `min_b v_a(b)` on a contested cell is attained by the reply that
kills the contesting unit. `score.ts` carries `DEAD` as `−∞` and `bank.ts`
handles `NaN` from `∞ − ∞` explicitly, which tells you the saturation is real
and known. So for every option that *enters* a contest, the floor is the same
saturated value; the floor rung `cmp.order !== 0` never fires; and adjudication
falls through to `est`, then `ceiling` (the declared O-P1 hole), then the salted
tie key. The comparator's own counters make this measurable today —
`adjudication.{floorDecided, estDecided, ceilingDecided, tieKeyDecided}` — and
the prediction is sharp:

> **Prediction P-1.** On contested-cell decisions, `floorDecided` falls and
> `estDecided + ceilingDecided + tieKeyDecided` rises, relative to quiet
> decisions. If it does not, this mechanism is not firing and the passivity
> diagnosis needs another cause.

Two consequences worth naming:

1. **This is the inert-weight taxonomy's cause (b) — "no gradient: the term is
   constant at the point of comparison" — arriving through the reduction rather
   than through the evaluator.** The composition/value lenses located causes (a)
   admission, (b) no-gradient and (c) scale separation *in the evaluator and the
   candidate closure*. There is a fourth path to (b) and it is upstream of both:
   **the reduction flattens the floor**, so no evaluator improvement can restore
   the gradient. That belongs in their taxonomy, and their instrument ("measure
   feature spread at `better()`'s comparisons, by unit class") already measures
   it if the rows are also split by *which rung decided*.
2. **It explains passivity mechanically, not just game-theoretically.** Doc 00
   §4 says pure maximin forfeits the mixed-vs-pure gap. This says something
   stronger and more operational: on the boards where that gap is largest — the
   contested ones — the floor is *also* uninformative, so the search is not even
   maximizing the security level with discrimination; it is tie-breaking. The
   two failures compound, and the second one is fixable independently of the
   first (any non-vacuous `τ` un-saturates the floor because a mixture over
   replies is finite where a min is `−∞`).

That second point is the strongest practical argument in this document for
`τ > 0`: **it restores an ordering where today there is none**, which is a
benefit that does not depend on the mixed-strategy question at all.

## 4. The third reading, and the type boundary nobody has costed

The epistemics lens carves values into two readings: **sound** (quantified over
all of the support — weight-invariant, adversary-proof) and **advised**
(integrated under a named weight `w`). The prior-art lens's recommendation,
which I endorse and want to make precise here, is that the field's zero point is
neither:

> **A third reading — "equilibrium" — whose supplier is a *fixed point* of the
> stage matrix rather than a quantifier or a measure.**

The credal type therefore spans three things, not two:

| reading | supplier is | what the number means |
|---|---|---|
| **sound** | a quantifier (`∀b ∈ S`) | true whatever the opponent does |
| **advised** | a measure `P₀ ∈ Δ(S)` | true if the opponent is `P₀` |
| **equilibrium** | a fixed point `P* = BR(BR(P*))` on the restricted matrix | true if the opponent is rational and *we randomize as prescribed* |

The last clause is not decoration. The equilibrium reading's value is only
attainable by the strategy that attains it — it is a statement about a *pair*
(our mixture, their mixture), which is why it cannot be a member of an axis
whose members all output a pure plan.

**Where this should live: in the epistemics lens's object, not beside it.**
Their `(S, w)` pair already has the right shape — `S` is the support, `w` is the
weight. The equilibrium reading is `w = P*` where `P*` is *computed from* the
value function over `S` rather than supplied. That is a third *constructor* for
`w`, not a second epistemic vocabulary, and it obeys their projection law
unchanged (the number is tagged `(horizon, w = equilibrium@restrictedMatrixId,
basis)`). Building it as a rival stack would be the "no second epistemic
vocabulary" refusal they already wrote down. So:

> **Cross-lens ask (BELIEF).** Add `equilibrium` as a third weight-supplier
> constructor in the `(S, w)` object, whose `w` is the fixed point of the
> restricted stage matrix and whose identity is the matrix's content hash.
> Everything else — the projection tag, the refusal law, the advisory-precision
> machinery — applies with no change.

And the machinery is shared, which is the happy part:

> **The `restrictedGap` instrument (doc 00 §4b, increment R0) already computes
> `P*`.** Solving the restricted matrix for `V_mixed` produces the row mixture
> and the column mixture as a by-product. So the instrument that *measures*
> whether the equilibrium reading is worth anything is the same code that
> *supplies* it if the answer is yes. One LP (or one RM⁺ loop), two uses.

### The type boundary

Five of the ambiguity-axis members leave the search's output type alone: it
stays a `JointPlan`. **The equilibrium reading does not.** A maximin *mixed*
strategy is a distribution over rows, and playing it requires:

1. a private randomization device;
2. a wire that can carry a realized draw whose proved floor is *worse* than the
   pure-maximin plan's — because that is what a mixed strategy is;
3. a human operator who can be told what the bot is doing.

Item 1 we already have, and it is a nice piece of luck. `selection/rng.ts`'s
`matchSeed` is described in `core.ts` as *"the operator's, never on the wire,
and the only input an adversary cannot compute"*. That is precisely the secrecy
property a mixed strategy needs, and because the seed is recorded, replays stay
exact. **Randomization is free; we built the device for another reason.**

Item 2 is a hard contradiction. See §6.

Item 3 is a real product constraint under the Centaur direction and should be
stated rather than discovered: a human co-player cannot act on "play this 40% of
the time". The honest resolution is that mixing belongs at the **seat** level
(this bot, this game, one draw per decision, logged) and never in the operator
surface — the operator sees the realized plan and its provenance, exactly as
today.

> **Finding R-2.** The REDUCTION joint has a type boundary in it. The ambiguity
> axis `{vacuous, CVaR, ε-contamination, model, quantal}` is drop-in: same
> output type, same wire, same ratchet, same operator surface. The
> **equilibrium reading** changes the kernel's output from an argmax to a draw
> and is therefore a *different joint* (or a declared extension of this one)
> with its own laws. Presenting them as one member list — which is the natural
> reading of "solution concept as a plug-in member" — would hide a change to the
> wire contract behind a config field. The composition lens's own rule applies:
> a joint's law must be one law.
>
> And this is exactly why the honest answer to Ruling 13's framing is *two*
> joints, not a dial: **the paranoia dial (calibration) and the reading
> (correctness) are different questions, and only the first is cheap.**

## 5. What today's code is, as a member

Precisely, and with the caveats that make it honest:

- `support`: the bank's rung ladder, resolved per plan by which rungs qualified —
  so **the support restriction is not constant across the plans being
  compared**. `floorFrom`/`floorComplete` record which one won. This is sound
  (each is a valid floor) but it means the comparator is ranking numbers reduced
  over *different* supports, which is a weaker statement than ranking over one.
  The basis machinery catches the assumption-level version of this; the
  rung-level version is not currently a comparison refusal.
- `ambiguity`: **vacuous**, everywhere, with three exceptions that are all
  *implicitly* non-vacuous and none of which declares itself:
  1. `scoreOptions`'s inner min runs over at most 4 enumerated in-cluster enemy
     joints (`enumerateJoints(theirs, 4)`), i.e. a *narrowed support*, and pays
     for it honestly in `theirCoverage → sigmaOfPly.theirMiss`. That is the
     right instinct implemented as a precision penalty rather than as a declared
     member;
  2. `eval/dodge-discount` prices escape options by cover-counting, which is a
     *uniform* reference measure over enemy covers — a `P₀` in everything but
     name;
  3. `posteriorOfBranch(worst, best, est)` folds the interval into a mean, which
     is an ambiguity choice at the belief layer applied *after* a vacuous
     reduction at the bounds layer.
- output type: pure `JointPlan`. Argmax, never a draw.

So: **we are the vacuous member with three undeclared non-vacuous suppliers
leaking in at three different layers, each paid for differently.** That is the
"five places at once" finding, restated with the mechanism named.

## 6. Contradictions with the other syntheses, named precisely

### C-T1 — the ratchet structurally forbids mixed play (TIME lens)

`kernel.ts::stageAndGate` gate 1:

```ts
if (lo < basis.floorLo || value < basis.floorChannel) { refusals["ratchet-floor"]++; return null }
…
if (changed) { if (value <= basis.floorChannel) { refusals["switch-floor"]++; return null } }
```

The wire is **monotone non-decreasing in the proved floor within a basis**, and
a plan *change* requires a strictly better proved value. A mixed strategy draws
a row whose floor is, with positive probability and by construction, below the
maximin row's floor. Every such draw is refused as `switch-floor`. **The
Nash-of-abstraction member is unreachable through today's wire discipline, not
because anyone decided against it but because the ratchet's invariant was
written over the realized row.**

The resolution is available and is small in concept: **restate the ratchet over
the decision's declared reduced value rather than over the realized row's
floor.** `V_mixed` of the restricted matrix *is* monotone as rows and columns
are added within a basis (rows raise it, columns lower it — so the ratchet
becomes "columns may only be added between bases", which is already what an
epoch is). The realized draw then rides the wire as an *instance* of a
certificate about the mixture, not as a claim about itself. That is a genuine
change to the time lens's commitment discipline and it must be theirs to make,
not mine — but it should be on their list, because right now the ratchet
silently forecloses a whole member of a joint another lens is designing.

**Note the ratchet is also why nobody has noticed.** With `ε = 1` every member
the wire can carry is an argmax, so the invariant has never been tested against
a member that needs to go down.

### C-B1 — two paranoia dials, one of which is double-charged (BELIEF lens)

The belief lens's B7 falsifier already suspects this:

> *"check for double-charged pessimism first: hold ε fixed, vary plyCap; if the
> depth-effect rate falls as plies rise, the blended value and sigmaOfPly's
> width terms are discounting the same uncertainty twice."*

Law R1 says *why* it would be double-charged and what the fix is. `sigmaOfPly`
charges `theirMiss` — the fraction of the reply space the min did not cover —
as **precision loss**. An ε-contaminated reduction charges the same ignorance as
**value loss**. Both are reductions of the same ambiguity, applied at different
layers, and they compose multiplicatively rather than being one declared set.

Under R1 the rule is: **one ambiguity set per decision, declared once, and the
composition of two restrictions is the intersection of their sets — never the
sequential application of two reductions.** Operationally that means
`sigmaOfPly`'s `theirMiss` term must either (a) be deleted once the reduction is
non-vacuous over the same replies, or (b) be re-derived as the *width of the
ambiguity set implied by the un-enumerated replies*, which is a different
quantity from the one it computes today. This is a decidable question and it
should be decided before either lens ships a dial.

### C-V1 — the reduction is where "weight-blindness" becomes invisible (VALUE lens)

The VALUE lens's strongest result is that the score decomposes into three
weight-share-folded flows with one constant near unity. Superadditivity (Law R1)
says the reduction of a sum is at least the sum of the reductions — with
**equality only when the same worst-case reply attains the min for every term**.
On a board where one enemy threatens one of our units and a different enemy
threatens another, the vacuous reduction is *strictly* superadditive: the
per-flow floors sum to less than the joint floor. So the decomposition the value
lens validated is exact on `v_a` and **only a bound after the reduction**. That
does not weaken their result — their fit is against realized score, not against
reduced score — but it means:

> **Finding R-3.** The value lens's three-flow decomposition is a statement
> about `v_a(b)` at a *given* reply. Any consumer that folds the flows and then
> reduces gets a different number from one that reduces and then folds, and the
> gap is exactly the non-alignment of the per-flow worst cases. The `k ≈ 1.2`
> constant is fitted on realized outcomes and therefore belongs to the *former*;
> a search that used it as a surrogate inside the bank would be using it in the
> latter position. The fit-provenance rule (Ruling 49) applies: the coefficient's
> provenance includes *which side of the reduction it was fitted on*, and that
> coordinate does not currently exist.

### C-J1 — the composition lens's REDUCTION law needs the ambiguity type

`07-SYNTHESIS.md` gives REDUCTION the law "exactly one — composing two is a
category error". Correct, and Law R1 explains why in one line: two lower
previsions composed is a lower prevision over a set that neither declared, so
the result is a reduction nobody can name and whose pessimism cannot be
compared to either input. The refinement I would ask them to absorb: the law is
not merely "exactly one", it is **"exactly one, and its type is an ambiguity
set, so 'composing two' has a well-defined meaning (intersection) that is
sometimes what you want across layers"** — which turns the prohibition from a
rule into a theorem with an escape hatch for exactly the belief/depth case in
C-B1.

## 7. What to build, cheapest first

| # | increment | cost | what it decides |
|---|---|---|---|
| **R0** | `restrictedGap` on the mechanism report (doc 00 §4b): build the matrix from `BankResult.members` × `witnessList`, run RM⁺ for a fixed iteration count, emit `V_mixed − V_pure` in weight units | µs per decision; no behaviour change; no games | whether the whole mixed-strategy direction is worth anything on OUR boards. A near-zero gap retires it on evidence — which is exactly the Ruling-49-compliant way to retire a direction |
| **R1** | declare the reduction: one `Reduction` record per decision, stamped on `ScoreBounds` beside the basis; today's value is `{support: rung-ladder, ambiguity: vacuous}`. No arithmetic changes | one field, one stamp | makes "which reduction produced this number" answerable, which is the precondition for comparing two |
| **R1½** | split `adjudication.*Decided` by contested-vs-quiet decisions and test Prediction P-1 (§3½) | one grouping on an existing counter | whether the floor really goes flat where it matters. This is the *mechanical* half of the passivity diagnosis and is independent of R0's game-theoretic half |
| **R2** | the supplier becomes observable: implement `τ` (CVaR) as the shipped dial with `τ = 0` reproducing today byte-for-byte, and give `P₀` exactly one member — `cover-counting`, which already exists inside `dodge-discount` and is the canonical measure the support itself induces | small; gated | first measurement in which an opponent model can possibly matter (Finding R-1), **and** the first ordering signal on contested cells (§3½) |
| **R3** | resolve C-B1 before shipping any `τ > 0`: run the belief lens's B7 falsifier | analysis | whether `sigmaOfPly.theirMiss` survives |
| **R4** | *only if R0 says the gap is large*: the equilibrium reading, landed in the epistemics object as a third `w` constructor, with the ratchet restatement C-T1 as its prerequisite | large, cross-lens | — |

R0 is the whole point of this document. It converts a four-times-confirmed
qualitative verdict ("worst-case play is structurally passive") into a number
per decision, computed from data we already have, with no games played and no
behaviour changed — and that number decides whether anything else here is worth
building. R1½ is its cheap mechanical companion: it asks whether the floor is
even *ordering* the options on the boards where the gap is largest, and it costs
one `groupBy` on counters that already exist.
