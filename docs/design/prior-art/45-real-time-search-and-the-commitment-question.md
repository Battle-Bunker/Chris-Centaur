# PRIOR ART 45 — real-time heuristic search: pathology's third cause is our commitment rule

Domain 40 established that "deeper is better" is a hypothesis with a checkable
condition. This is the same question in the family whose defining constraint is
**ours**: *a constant bound on planning per move, independent of problem size* —
an agent that must act before it has finished thinking, repeatedly, while carrying
what it learned.

The literature has measured the pathology directly, decomposed it into **three
causes**, and one of those causes is not about the evaluator at all. **It is about
how often you re-plan** — which is the commitment question the re-base window and
ADVANCE already answer implicitly, without anyone having priced the answer.

The numbers are unusually direct and they are not comfortable.

---

## 45.1 The measurement

**S89. Bulitko & Luštrek, "Lookahead pathology in real-time path-finding", AAAI
2006** (with Bulitko, Li, Greiner & Levner, "Lookahead pathologies for single agent
search", IJCAI 2003).
**S90. Bulitko & Lee, "Learning in real-time search: a unifying framework", *JAIR*
25 (2006)** — the LRTS framework: four design dimensions (local search space, local
learning space, learning rule, control strategy) and three control parameters
(lookahead depth, optimality weight, backtracking quota), with the named algorithms
as points in that space.
**S91. Hernández & Baier, "Avoiding and escaping depressions in real-time heuristic
search", *JAIR* 43 (2012).**

**The headline table.** Percentage of problems on which a *deeper* lookahead
produced a *worse* result:

| experiment | no pathology | pathological |
|---|---|---|
| **on-policy** (the agent walks the path it plans, updating as it goes) | 42.3% | **57.7%** |
| **off-policy** (no learning) | 95.7% | 4.3% |

**More than half of problems are pathological when the agent learns while it
acts.** The paper then decomposes the gap into three causes, verifying each two
ways:

1. **Learning.** Re-measuring the on-policy error *without* the heuristic updates
   drops pathology to 20.2%. *"Learning is indeed responsible for the pathology."*
   And the mechanism is quantified: the **volume of updates falls from 4.1 at
   `d = 1` to 1.4 at `d = 10`** — shallow search learns more per move, so
   comparing depths compares two different amounts of learning.
2. **(the residue after removing learning)** — 20.2% still exceeds off-policy's
   4.3%, so a second cause remains.
3. **Compute normalisation, and this is the one that transfers.** On-policy, a
   search of depth `d` is performed **every `d` moves**, so states generated *per
   move* is `on(d) = off(d)/d`. *"This means that lookahead depths in the basic
   on-policy experiment are closer to each other with respect to the number of
   states generated … Since the number of states generated can be expected to
   correspond to the quality of decisions, cases where a deeper lookahead actually
   performs worse than a shallower lookahead should be more common."*
   **Verified: searching every move instead of every `d` moves drops pathology from
   57.7% to 13.1%.** The node counts make it concrete — about 8 at `d=1`
   everywhere; at `d=10`, off-policy and search-every-move reach **~1,550**, while
   basic on-policy reaches only **146.3**.

**And the remedy, with its numbers:**

| policy | average path length |
|---|---|
| best **fixed** lookahead depth (which is **`d = 1`**) | **175.4** |
| optimal depth chosen **per problem** | **107.9** |
| optimal depth adapted **per move** | 113.3 — *and* nodes/move fall from 59.3 to **34.0** |

*"The improvement in path length is quite significant and motivates research into
automated methods for lookahead depth selection."* Determining the optimal depth
for every state pair is infeasible (7.6 × 10⁷ pairs on an 8,743-state map), so they
use **state abstraction**: compute the optimal depth for one representative per
abstract state. That recovers most of the benefit while pre-computing optimal
depths for **0.004% of all state pairs**.

**Heuristic depressions** (Hernández & Baier) are the structural cause of the
trapping: *"bounded areas of the search space in which the heuristic function is
inaccurate compared to the actual cost to reach a solution"*, in which LRTA*-style
agents *"easily become trapped … since the heuristic values of their states may
need to be updated multiple times, which results in costly solutions."* Two fixes:
**mark-and-avoid** and **move-to-border**.

---

## 45.2 Mapping onto our joints

### C92. The dominant cause of pathology is ON-POLICY LEARNING, and our architecture is on-policy learning by design

**57.7% pathological with learning; 4.3% without.** That is a factor of thirteen,
and it is the single largest effect in this domain.

  Our architecture learns while it acts, everywhere and deliberately: the bounds
  carry across turns, ADVANCE carries a payload, attention carries, the hypothesis
  market carries its state, the memo persists. **Every one of those is on-policy
  learning in exactly this sense** — the updates are concentrated on the trajectory
  the agent actually took, and a different lookahead depth would have taken a
  different trajectory and learned different things.

  So domain 40's C77 (pathology needs sibling-value independence) is **not the only
  route in**. This is a second, mechanically different route, and it does not
  require anything about our evaluator's error structure: **the interaction between
  learning-while-acting and lookahead depth is sufficient on its own.** And it is
  the route our architecture is most exposed to, because carrying state across
  turns is the design's central efficiency claim.

  The quantified mechanism transfers directly: **the volume of updates falls with
  depth** (4.1 → 1.4). In our terms, a shallow-and-frequent policy accumulates more
  carried state per turn than a deep-and-rare one, so **comparing rungs compares two
  different amounts of accumulated learning**, not two amounts of search.

### C93. Pathology's third cause IS our commitment rule, and it says the CPP is comparing the wrong thing

This is the finding to act on, because it is not about the evaluator, the
opponents, or the game. It is about **arithmetic**:

> a search of depth `d` performed every `d` moves generates `off(d)/d` states per
> move — so **deeper lookahead with longer commitment is the same compute
> rearranged, not more compute.**

  Their control experiment is decisive: **searching every move instead of every `d`
  moves cut pathology from 57.7% to 13.1%**, with node counts at `d=10` rising from
  146.3 to ~1,550. The "deeper is worse" effect was, to a large extent, **"deeper
  was given the same budget spread thinner"**.

  **We have exactly this structure.** The re-base window, the commitment horizon and
  ADVANCE all decide *how many turns a plan is committed for*, and a longer
  commitment with a deeper search is precisely the on-policy arrangement. So:

  > **The CPP must compare rungs at equal TOTAL WORK across the committed span, not
  > at equal per-decision depth.** A profile that shows deeper rungs saturating may
  > be showing that deeper rungs are re-planned less often — an artifact of the
  > commitment rule, not a fact about the search.

  **This is a second, independent argument for d37's C68** (denominate the budget in
  a deterministic work unit rather than milliseconds), reached from a completely
  different direction: C68 said wall-clock is machine-dependent; this says
  *per-decision depth* is commitment-dependent. **The same fix answers both**, and
  two independent arguments for one cheap change is the strongest case the survey
  can make.

### C94. The best FIXED depth was 1, and per-instance selection was worth 38% — the value is in VARYING depth, not in buying it

> best fixed lookahead depth: **`d = 1`**, path length **175.4**
> optimal depth per problem: **107.9**

  Two things follow, and the first is uncomfortable for the flagship framing.

  **(a) "Buy depth" may be the wrong verb.** On this benchmark the best *constant*
  depth was the shallowest available, and the entire benefit — **38%** — came from
  *varying* the depth by instance. If that shape holds for us even directionally,
  the economy's job is not to purchase more depth but to **allocate depth
  differentially**, which is what the CPP's premise conditioning was built to do and
  what a single saturation point cannot express.

  **(b) That 38% is a VBS−SBS gap, for depth.** Domain 14's C42 established that the
  virtual-best-solver minus single-best-solver gap is the falsifier for
  per-instance selection, and complained that we have never measured our own. Here
  is the same instrument pointed at a different axis, with a published value for a
  comparable problem class. **We can measure ours on the existing archive**: replay
  each archived decision at every rung, take the per-decision best, and compare to
  the best single rung. Large gap ⟹ the economy's premise conditioning is where the
  value is. Small gap ⟹ a fixed rung is fine and the allocation machinery is
  overhead. **Either answer redirects real work, and the measurement is a replay
  sweep.**

  **(c) The cheaper policy was also nearly as good.** Per-*move* adaptation gave
  113.3 against per-problem's 107.9 while **cutting nodes per move from 59.3 to
  34.0** — adaptivity was not only better than a fixed depth, it was *cheaper*. That
  is the shape the time economy hopes for and has never had evidence for.

### M114. We already hold a depression map, computed for another purpose

A **heuristic depression** is *"a bounded area of the search space in which the
heuristic function is inaccurate compared to the actual cost"*, and the failure is
specific: the agent enters, the heuristic must be corrected many times, and the
corrections are paid one increment at a time.

  **The value lens has already located ours.** Domain 31 §31.5: king-present cells
  have mean |residual| **1.946** against no-king's **0.201** — `corr(king,
  residual) = +0.954`. That is a bounded region of the state space in which the
  evaluator is systematically inaccurate. **It is a heuristic depression, measured,
  and named for a different reason.**

  The literature's response is a *behaviour*, not a fix to the heuristic:
  **depression avoidance** — `mark-and-avoid` (record the depression and prefer
  plans that do not enter it) and `move-to-border` (if inside, head for the edge
  rather than re-deriving in place). Both are cheap and neither requires the
  evaluator to improve.

  Two readings for us, and they should be held apart:
  - as an **interim** measure while the wipe closure is unfixed, biasing away from
    regions where the evaluator is known to be wrong is defensible and cheap;
  - but it is **not** a substitute for the fix, and it has an obvious hazard —
    avoiding the cells where we evaluate badly means avoiding the cells where the
    game is decided (d40's C77). **Mark-and-avoid on a decisive region is a policy,
    not a search heuristic**, and it would belong in ACTION with a stated cost, not
    quietly in the search.

### M115. State abstraction makes per-instance depth selection tractable, and it is the instance space we already have

Pre-computing the optimal depth for every state pair is infeasible (7.6 × 10⁷ pairs
on an 8,743-state map). **Clique abstraction** reduces it to one representative per
abstract state and recovers most of the benefit at **0.004% of state pairs**.

  Our analogue exists and is already built for another purpose: **domain 26's
  instance space and the cell taxonomy**. The abstraction that makes per-instance
  depth selection affordable is *the cell*, and the CPP is already keyed on it. So
  the expensive-sounding recommendation in C94(b) reduces to: **fit one optimal-rung
  value per cell, not per decision** — which is the CPP with one more column, on a
  key that already exists.

---

## 45.3 The counter-argument

1. **Single-agent path-finding is not an adversarial game.** No opponent, no
   simultaneity, and the heuristic is admissible in a way ours is not. The
   *learning* cause (C92) and the *compute-normalisation* cause (C93) are both
   independent of the adversary — they are about the agent's own update and budget
   structure — so they transfer. The **depression** results depend more on the
   single-agent structure and should be read as suggestive.

2. **`d = 1` being the best fixed depth is a property of their benchmark.** Grid
   path-finding with an admissible initial heuristic (true distance on an empty
   map) is unusually favourable to shallow search. The transferable claim is **the
   gap between best-fixed and per-instance-optimal**, not the location of the
   optimum — which is exactly why C94 recommends measuring ours rather than
   adopting theirs.

3. **Our bounds are sound; their heuristic updates are not.** As in domain 40, a
   sound interval narrowing cannot be pathological. The exposure is in the
   **advised** channel and in the **carried** state, not in the bank's floor — which
   again argues for keeping the two readings separate and for being careful about
   what exactly ADVANCE carries (d12's C38 already says the carried object needs a
   bound).

---

## 45.4 Verdicts

- **TIME / SEARCH (C92) — pathology's dominant cause is ON-POLICY LEARNING, and we
  are on-policy by design.** **57.7% of problems pathological with learning versus
  4.3% without** — a factor of thirteen, the largest effect in this domain. The
  bounds carry, ADVANCE carries, attention carries, the market carries, the memo
  persists: **every one is learning concentrated on the trajectory actually taken**,
  and a different rung would have taken a different trajectory. So this is a
  **second, mechanically different route into pathology** that requires nothing
  about our evaluator's error structure — and it is the route our central efficiency
  claim is most exposed to. Quantified mechanism that transfers: **the volume of
  updates falls with depth (4.1 → 1.4)**, so comparing rungs compares two different
  amounts of accumulated learning, not two amounts of search.
- **TIME (C93) — pathology's third cause IS our commitment rule, and it says the CPP
  is comparing the wrong thing.** A depth-`d` search run every `d` moves generates
  `off(d)/d` states per move: **deeper lookahead with longer commitment is the same
  compute rearranged, not more compute.** Their control is decisive — **searching
  every move instead of every `d` moves cut pathology from 57.7% to 13.1%**, with
  node counts at `d = 10` rising from 146.3 to ~1,550. **So the CPP must compare
  rungs at equal TOTAL WORK across the committed span, not at equal per-decision
  depth**; a profile showing deeper rungs saturating may be showing that deeper
  rungs are re-planned less often. **This is a second, independent argument for
  C68's work-unit denominator**, reached from a completely different direction —
  and two independent arguments for one cheap change is the strongest case
  available.
- **TIME / OWNER (C94) — the best FIXED depth was 1, and per-instance selection was
  worth 38%.** `175.4 → 107.9`. If that shape holds even directionally, **"buy
  depth" is the wrong verb**: the economy's job is to *allocate depth
  differentially*, which is what premise conditioning is for and what a single
  saturation point cannot express. **And that 38% is a VBS−SBS gap for depth** —
  d14's C42 instrument pointed at a new axis, measurable on our archive by replaying
  each decision at every rung and comparing per-decision-best to best-single-rung.
  Large ⟹ the conditioning is where the value is; small ⟹ a fixed rung is fine and
  the allocation machinery is overhead. **Either answer redirects real work.** Note
  also that **per-move adaptation was cheaper as well as better** (nodes/move
  59.3 → 34.0) — the shape the economy hopes for, with evidence for the first time.
- **VALUE / SEARCH (M114) — we already hold a depression map, computed for another
  purpose.** A heuristic depression is a bounded region where the evaluator is
  systematically inaccurate; **d31 §31.5's king-present cells (|residual| 1.946 vs
  0.201, `corr = +0.954`) are exactly that**. The literature's response is a
  *behaviour* — `mark-and-avoid`, `move-to-border` — that requires no evaluator
  improvement. Defensible as an **interim** measure, with an obvious hazard held in
  view: avoiding the cells where we evaluate badly means avoiding the cells where
  the game is decided (d40's C77), so **mark-and-avoid on a decisive region is a
  policy, not a search heuristic**, and belongs in ACTION with a stated cost rather
  than quietly in the search.
- **TIME (M115) — state abstraction makes per-instance depth selection affordable,
  and it is the instance space we already have.** They reduced 7.6 × 10⁷ state pairs
  to **0.004%** by computing the optimal depth per *abstract* state. Our abstraction
  is **the cell** (d26), and the CPP is already keyed on it — so C94(b)'s
  recommendation reduces to **one optimal-rung value per cell**, i.e. the CPP with
  one more column on a key that already exists.
