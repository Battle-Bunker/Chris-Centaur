# PRIOR ART 39 — mixed initiative: the prior art for the two operator lenses

Two new lenses are open — **inbound guidance** (the operator tells the bot
something) and **outbound signals** (the bot tells the operator something). This
domain is their prior art, and the headline is that **they are one decision, not
two**, with a twenty-five-year-old decision-theoretic treatment that the
programme's existing vocabulary maps onto almost term for term.

It also closes **C33** ("ask the operator is a purchasable observation with no row
in the economy") in a stronger form than C33 stated: asking is not a *purchase*,
it is a **strategy** — a conditional sequence with a deadline, a take-back rule,
and a third action neither lens has conceived.

---

## 39.1 The decision both lenses are making, and it has two thresholds

**S72. Horvitz, "Principles of mixed-initiative user interfaces", CHI 1999.**

The core construction. The agent has evidence `E` and is uncertain whether the
user has goal `G`. Four utilities cover the outcomes of acting or not against the
goal holding or not:

    eu(A|E)  = p(G|E)·u(A,G)  + [1−p(G|E)]·u(A,¬G)
    eu(¬A|E) = p(G|E)·u(¬A,G) + [1−p(G|E)]·u(¬A,¬G)

These are two lines in `p(G|E)`; they cross at a **threshold probability `p*`**,
and the rule is: act above it, refrain below it. Then add a **third option —
dialog** — and the picture changes in the way that matters here:

> *"the utility of engaging in a dialog with a user when the user does not have
> the goal in question is typically **greater** than the utility of performing an
> action when the goal is not desired. However, the utility of asking a user
> before performing a desired action is typically **smaller** than the utility of
> simply performing a desired action when the user indeed has the goal. …
> action can be guided by **two new threshold probabilities**: the threshold
> between inaction and dialog, `p*_{A,D}`, and the threshold between dialog and
> action, `p*_{D,A}`."*

Three regions — **do nothing / ask / act** — from four utilities and one belief.
And the line that makes this a *usable* design position rather than a modelling
programme:

> *"Systems for guiding autonomous service do not necessarily need to perform
> explicit computations of expected value. **Thresholds can be directly assessed
> by designers or users.** Such directly assessed thresholds for action imply a
> deeper implicitly assumed expected-utility model."*

Twelve principles accompany it. Four bear directly:

- **(5) Employing dialog to resolve key uncertainties** — *"considering the costs
  of potentially bothering a user needlessly"*.
- **(7) Minimizing the cost of poor guesses about action and timing** — including
  *"appropriate timing out and natural gestures for rejecting attempts at
  service"*.
- **(8) Scoping precision of service to match uncertainty** — *"a preference for
  **doing less but doing it correctly** under uncertainty can provide users with a
  valuable advance towards a solution and minimize the need for costly undoing"*.
- **(12) Continuing to learn by observing.**

---

## 39.2 Asking is a STRATEGY, not a decision — and rigid one-shot asking failed

**S73. Scerri, Pynadath & Tambe, "Towards adjustable autonomy for the real world",
*JAIR* 17 (2002).**

Their diagnosis of the prior work — which is Horvitz's setting — is that it breaks
in exactly our configuration:

> *"domains requiring collaboration between **teams** of agents and humans reveal
> two key shortcomings … First, these approaches use **rigid one-shot transfers of
> control** that can result in unacceptable coordination failures in multiagent
> settings. Second, they **ignore costs** (e.g., in terms of time delays or effects
> on actions) to an agent's team due to such transfers-of-control."*

And, from the deployed evaluation: *"when we applied a rigid transfer-of-control
decision-making to a domain involving teams of agents and users, **it failed
dramatically**."*

Their replacement is a **transfer-of-control strategy**: a pre-defined,
*conditional sequence* of two kinds of action —

  (i) **transfer control** (agent → user, or back), and
  (ii) **change the agent's coordination constraints** — *"rearranging activities
  as needed (e.g., **reordering tasks to buy time** to make the decision)"*.

So a strategy is written like `H D A`: ask the human; take a coordination action
that buys time; if still no answer, act. Single-shot is `H`. Three results:

- **The take-back condition**: the agent *"should eventually make a decision if the
  expected cost of continued waiting exceeds the difference between"* the decision
  qualities — so every viable strategy ends in `A`.
- **`D` actions have a window.** *"`D`s become **valueless after the deadline**,
  when wait costs stop accruing."* And a second `D` is worth less than the first
  when wait costs accelerate, because the first one already slowed the accrual.
- **No strategy dominates.** *"complex strategies are not necessarily superior to
  single-shot strategies … no particular strategy dominates all other strategies
  across all domains"* — but three Lemmas identify the domain conditions
  (wait-cost accrual shape, response-probability model, relative decision quality)
  under which each type wins, and can prune the space **offline**.

---

## 39.3 Inbound advice is a HYPOTHESIS, not a constraint

**S74. Maclin & Shavlik, "Creating advice-taking reinforcement learners",
*Machine Learning* 22 (1996) — the RATLE system.** The observer watches and
*"occasionally makes suggestions"* in a small imperative language; the advice is
compiled into the agent's utility function; and then — the load-bearing part —
*"subsequent reinforcement learning further integrates and **refines** the
advice."*

The architecture's whole point is that advice enters somewhere it can be
**overridden by evidence**. Advice is a prior, not a law. It may be given at any
time, in any amount, and it may be wrong; the system degrades rather than breaks.

---

## 39.4 Mapping onto our joints

### C73. "Ask the operator" is a strategy with a deadline and a take-back, and one-shot asking is the variant that is documented to fail in our configuration

C33 recorded that there are three ways to remove width — deduce, observe, ask —
and that we have the first, lack the second, and have not conceived the third.
This says the third is bigger than C33 made it: **asking is not a purchase with a
price, it is a conditional sequence** whose elements are *(who decides, for how
long, and what to do meanwhile)*.

  And the shortcomings the field names are ours specifically:
  - **We are the team case.** Our units act jointly; a query that stalls one unit's
    decision stalls the joint, and the cost is **miscoordination**, not just delay.
    That is the exact configuration where the paper reports rigid one-shot
    transfers *"failed dramatically"*.
  - **We have a hard deadline**, so the wait-cost structure is not merely rising,
    it is *bounded and cliff-shaped* — which the Lemmas say changes which strategy
    type is optimal.
  - **Every viable strategy must end in `A`.** A design in which a pending operator
    query can leave the bot without a move is not a strategy; the take-back is
    mandatory and its trigger is stated: act when the expected cost of continued
    waiting exceeds the decision-quality difference.

### C74. The third action neither lens has conceived: change the plan to make waiting cheaper

The `D` action — *"reordering tasks to buy time to make the decision"* — is a
**coordination change made in order to extend the window for an answer**, and it is
a first-class action alongside "ask" and "act". Nothing in either operator lens's
framing contains it, and nothing in the ACTION joint does either.

  In our vocabulary it is precise and it is buildable: **prefer a plan whose
  commitment point is later, so the operator's answer arrives before it binds.**
  A slider that advances two cells instead of four; a unit that holds a fork
  instead of resolving it; a re-base that defers the irreversible half. The
  programme already has the taste for this ("keep options open") and no lever for
  it — and here it is the lever, with a decision rule attached rather than an
  aesthetic.

  **Two consequences that make it cheap rather than speculative:**
  - it turns option value from a *virtue* into a **term in the interaction
    decision**, which is where domain 22's Baldwin–Clark option-value pricing has
    been looking for a consumer;
  - it comes with a **window**: `D` actions are *valueless after the deadline*, and
    a second `D` is worth less than the first when wait costs accelerate. So the
    buy-time move is worth exactly one application, early. That is a specific,
    falsifiable design rule, not a general encouragement.

### C75. The outbound signal has no threshold, and it needs two — but the knob is legitimate, which sharpens C69

Whatever rule decides "surface this to the operator" is currently taste. Horvitz's
construction says it is **two thresholds** on one belief, derived from four
utilities: `p*_{A,D}` (below it, stay silent) and `p*_{D,A}` (above it, just act).

  The design consequence is the middle region's *existence*: today the outbound
  surface has "show" and "don't show", and the correct structure has **silence /
  ask / act unilaterally**, with the middle band's width set by how much a needless
  interruption costs relative to a needless mistake.

  **And this sharpens domain 37's C69 rather than contradicting it.** C69 said *a
  fitted constant is not a knob — its value is a claim that won a test*. Horvitz's
  thresholds are the complementary case and the paper states it exactly: they may
  be *"directly assessed by designers or users"*, and doing so *"implies a deeper
  implicitly assumed expected-utility model"*. So the carve is:

  > **A number that encodes a MEASUREMENT belongs in source with its provenance. A
  > number that encodes a PREFERENCE belongs in config — and its provenance is the
  > utilities it is a shadow of.**

  `keepQuiet: 2` and the four caps are on the first side. The outbound thresholds
  are on the second — legitimately a knob, because only the operator knows the four
  utilities. But the obligation transfers: **name the four outcomes the threshold
  is a shadow of**, or the knob is a claim nobody has made after all.

### C76. Both thresholds move with the operator's attention state, and we model no operator state at all

Horvitz is explicit that the four utilities are context-dependent, and gives the
directions:

  - `u(A, ¬G)` — acting when the goal is not wanted — *"can be significantly
    influenced by the status of a user's attention. The utility of unwanted action
    **diminishes significantly with increases in the depth of a user's focus on
    another task**"*, which **raises** the threshold for acting;
  - `u(¬A, G)` — failing to act when the goal is wanted — *"may decrease as a user
    becomes **more rushed**"*, which **lowers** it.

  Our design has **no operator-state variable of any kind**. And in this game the
  two modifiers are not occasional, they are the standing condition: there is a
  clock, so the operator is *always* rushed, and there is a board, so their focus is
  *always* on some particular unit. Both thresholds are therefore always displaced
  from their defaults, in known directions, by an amount nobody is tracking.

  By domain 29's argument this is not a new subsystem — **it is a premise
  coordinate for the interaction decision**, of exactly the same kind as the search's
  premise index, and the cheapest version is two observable proxies the harness
  already sees: *which unit last received a manual command* (focus) and *elapsed
  fraction of the turn deadline* (rush).

### M99. Guidance must enter as a member with provenance, NOT as a closure

Domain 35 established that our closures are **pre-decision shields** and that this
is right for safety, because a shield is not tradeable at any price. Operator
guidance is the case where that architecture would be **wrong**, and the advice-
taking literature is why: advice is *"further integrated and refined"* by
subsequent learning, precisely so that bad advice degrades the agent rather than
crippling it.

  The distinction is worth stating sharply because the two lenses sit next to each
  other and the mechanism looks identical:

  > **A safety closure is a shield: not tradeable at any weight. Operator guidance
  > is a member: admitted with provenance, priced, and overridable by evidence.**

  Concretely: guidance should raise a plan's price, or seed the order, or open a
  hypothesis in the market — never *remove* plans from the admitted set. A wrong
  instruction that removes plans is unrecoverable and, per C70/d38, invisible
  downstream. A wrong instruction that prices plans is recoverable by the same
  mechanism that prices everything else.

### M100. "Do less, but do it correctly" is R-4's Centaur half as an interface rule

Horvitz's principle 8 — *scoping precision of service to match uncertainty*, with
*"a preference for doing less but doing it correctly under uncertainty"* — is a
rule about **the granularity of what the bot commits to**, and it says granularity
should shrink as uncertainty grows.

  For us that is directly implementable and it composes with R-4: under high
  uncertainty, surface and commit to the **coarser** object that is still
  determinate — a direction rather than a cell, a unit's role rather than its path,
  the *set* of non-dominated plans rather than a pick. R-4 says the reduction's
  output is a set with dominance conditions; principle 8 says **how much of that
  set to collapse before showing it**, and the answer is *as little as the
  uncertainty permits*. Domain 33's ε is the dial and this is the rule for setting
  it.

### M101. The overrides are labelled data, and the archive already has them

Principle 12 (*continuing to learn by observing*) plus principle 6 (*efficient
direct invocation and termination*) give a free instrument: **every operator
override is a labelled example of a decision the bot got wrong in the operator's
judgement**, and every non-override in a surfaced situation is a weak positive.

  The replay archive already contains them. Three uses, all cheap:
  - **the outbound thresholds can be fitted rather than guessed** — override rate
    against surfaced-signal rate is precisely the data that identifies `p*_{D,A}`;
  - **override clusters are an instance-space finding** (domain 26): the cells where
    the operator overrides most are the cells the evaluator is worst on, labelled
    by a human for free;
  - and it is the **only** signal in the programme that is about *what the operator
    wanted*, which is the quantity both new lenses are ultimately about and which
    nothing else measures.

### M102. The strategy is a member collection, and the Lemmas prune it offline

*"No particular strategy dominates all other strategies across all domains"*, and
*"choosing the wrong strategy can lead to very poor results"* because a strategy's
expected utility can be very low for some parameter settings. But the three Lemmas
*"can be used off-line to substantially reduce the space of strategies that need to
be searched"*, given the domain's wait-cost accrual shape, response-probability
model, and relative decision qualities.

  That is ruling 49's shape once more — **a member collection with a selection
  rule, not a single design** — and it says the operator-interaction design should
  ship as a small set of named strategies (`A`, `H`, `H A`, `H D A`, …) with a
  stated rule for which applies, rather than as one interaction model. Our three
  parameters are estimable: wait cost is cliff-shaped at the deadline, response
  probability is measurable from the archive, and relative decision quality is what
  the whole evaluation programme measures.

---

## 39.5 The counter-argument

The strongest objection is about **timescale**. Horvitz's LookOut and Scerri's
deployed system operate on human timescales — seconds to minutes — where a dialog
turn is cheap relative to the decision. Our turn deadline is on the order of a
second, and a dialog turn may simply not fit.

That is real, and it *sharpens* rather than removes the findings, in two ways:

1. **It makes C74 the important one.** If a dialog does not fit inside the
   deadline, then the only way to use the operator at all is to **buy time** —
   which is exactly the `D` action, and it moves from "a nice third option" to
   "the enabling mechanism". And the theorem that `D` is valueless after the
   deadline is then the binding constraint rather than a footnote.
2. **It changes which strategy wins, and the Lemmas say so.** Cliff-shaped wait
   costs with a low probability of an in-time response push toward **single-shot or
   no transfer** — so the honest possibility is that the analysis concludes *ask
   rarely, and act*. That would be a finding, not a failure: it would say the
   inbound channel belongs **between** turns (guidance as standing policy) rather
   than **within** one, which is a structural answer to what the inbound lens is
   for.

Second objection: Horvitz's four utilities assume a single user with a goal the
system is uncertain about. Our operator is a **collaborator with a plan**, not a
user with a goal to be inferred — closer to the Centaur framing of domain 10. The
mapping still holds (`G` becomes "the operator would prefer a different plan
here"), but the inference problem is different and probably easier, because the
operator's *previous* commands are strong evidence and the archive has them.

---

## 39.6 Verdicts

- **BOTH OPERATOR LENSES — you are designing ONE decision with THREE outcomes and
  TWO thresholds.** From four utilities and one belief: **stay silent /
  ask / act unilaterally**, with `p*_{A,D}` and `p*_{D,A}` between them. The
  outbound surface currently has "show" and "don't show" and is missing the middle
  band's *existence*, whose width is set by how much a needless interruption costs
  relative to a needless mistake. Neither lens should design its half without the
  other's utilities.
- **INBOUND (C73) — asking is a STRATEGY, not a purchase, and this closes C33 in a
  stronger form.** A conditional sequence of *(who decides, for how long, what to do
  meanwhile)*, and **every viable strategy ends with the agent taking control back**
  — trigger: the expected cost of continued waiting exceeds the decision-quality
  difference. The field's warning is aimed at our configuration exactly: rigid
  one-shot transfers in a domain of **teams** of agents plus a human *"failed
  dramatically"*, because the cost is **miscoordination**, not just delay — and our
  units act jointly.
- **INBOUND / ACTION (C74) — the third action nobody has conceived: change the plan
  to make waiting cheaper.** *"Reordering tasks to buy time to make the decision"*
  is a first-class action beside ask and act. For us: **prefer a plan whose
  commitment point is later**, so the answer arrives before it binds. It turns
  option value from a virtue into a **term in the interaction decision** (the
  consumer d22's option-value pricing lacked), and it comes with a window —
  buy-time moves are **valueless after the deadline**, and the second is worth less
  than the first. Worth exactly one application, early.
- **OUTBOUND (C75), and it sharpens C69 rather than contradicting it:** thresholds
  *"can be directly assessed by designers or users"*, and doing so *"implies a
  deeper implicitly assumed expected-utility model"*. So the carve between the two
  kinds of number is: **a number that encodes a MEASUREMENT belongs in source with
  its provenance; a number that encodes a PREFERENCE belongs in config, and its
  provenance is the utilities it is a shadow of.** The outbound thresholds are
  legitimately knobs — but name the four outcomes, or the knob is a claim nobody
  has made.
- **BOTH (C76) — every threshold moves with operator state, and we model none.**
  Unwanted action costs *more* the deeper the operator's focus is elsewhere (raises
  the threshold); inaction costs more as they become *rushed* (lowers it). In this
  game both modifiers are the standing condition, not the exception. This is a
  **premise coordinate for the interaction decision** (d29), and the cheapest
  version is two proxies the harness already sees: **which unit last received a
  manual command** (focus) and **elapsed fraction of the deadline** (rush).
- **INBOUND (M99) — guidance is a MEMBER, not a SHIELD, and the distinction is the
  whole design.** Domain 35 established our closures are pre-decision shields, and
  that a shield is not tradeable at any weight. Guidance is the opposite case:
  advice-taking systems compile advice somewhere *"subsequent learning further
  integrates and refines"* it, so bad advice degrades rather than cripples.
  Concretely: guidance may **price** plans, seed an order, or open a hypothesis —
  it must never **remove** plans from the admitted set, because a wrong removal is
  unrecoverable and invisible downstream.
- **OUTBOUND (M100) — "do less, but do it correctly under uncertainty"** is R-4's
  Centaur half as an interface rule: **the granularity of what you commit to and
  show should shrink as uncertainty grows** — a direction rather than a cell, a role
  rather than a path, the non-dominated set rather than a pick. Domain 33's ε is the
  dial; this is the rule for setting it.
- **BOTH (M101) — the overrides are labelled data and the archive already has
  them.** Every operator override is a human-labelled example of a decision the bot
  got wrong; every non-override on a surfaced signal is a weak positive. That
  **fits `p*_{D,A}` rather than guessing it**, marks the instance-space cells where
  the evaluator is worst (d26), and is the **only** signal in the programme about
  what the operator actually wanted.
- **INBOUND (M102) — ship a member collection, not one interaction model.** *No
  strategy dominates across domains*, and choosing wrong is expensive — but three
  Lemmas prune the space **offline** from three parameters we can estimate:
  wait-cost shape (cliff, at our deadline), response probability (measurable from
  the archive), relative decision quality (what the whole evaluation programme
  measures). Ruling 49's shape, applied to the interaction design itself.
- **THE HONEST POSSIBILITY, stated up front:** our deadline may be too short for a
  dialog turn. If so the Lemmas point at *ask rarely, and act* — which is a
  **finding**, not a failure: it would say the inbound channel belongs **between**
  turns, as standing guidance, rather than **within** one. Settle that before
  designing a within-turn dialog, because it is the question that decides what the
  inbound lens is for.
