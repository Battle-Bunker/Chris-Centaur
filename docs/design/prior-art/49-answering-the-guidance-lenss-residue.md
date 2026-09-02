# PRIOR ART 49 — answering the guidance lens's residue: two of the three are covered, and one of the two says do not want an exchange rate

The operator-guidance lens did its own prior-art pass
(`design/operator-guidance` @ `90fd424`), found seven bodies of precedent
including shielding (independently reaching domain 35's conclusion), and closed
with a **residue** — three things it searched for and did not find. That is a
direct request to this desk, and it is the cleanest kind of librarian task.

**Two of the three are covered, one of them by a result that says the design
should not want what it is looking for; the third is partly covered by this
survey's own domains and partly stands as genuinely ours.**

---

## 49.1 Residue 1 — "simultaneous-move worst-case floors under guidance"

> *"the shaping and shaping-adjacent results assume MDP argmax, not Γ-maximin over
> a restricted matrix."*

**Half of this is covered, and the covered half is the half they were worried
about.**

**S95. Devlin & Kudenko, "Theoretical considerations of potential-based reward
shaping for multi-agent systems", AAMAS 2011.** Two results:

- **potential-based shaping does not alter the Nash equilibria of a stochastic
  game — only the exploration of the shaped agent.** So Ng, Harada & Russell's
  guarantee (d32's S57) *does* generalise beyond MDP argmax, and what is preserved
  in the multi-agent case is **the equilibrium set**, not "the optimal policy".
- and, *"unlike some other approaches, shaping rewards of this form cannot be
  reduced to parameter initialization"* (contra Wiewiora 2003).

  **Why the first result is the right shape for this design specifically:** domain
  1's **C1** established that the zero point of a simultaneous-move stage game is
  its **Nash equilibrium**, not a scalar security level. So the invariant Devlin &
  Kudenko preserve is *exactly the object our REDUCTION's zero point is*. A
  potential-shaped guidance payload therefore cannot move the equilibrium — which is
  the strongest available statement of A0 purity at the value layer, and it is a
  theorem rather than a design intention.

  **The second result answers a question the lens raised elsewhere**: an attention
  payload of this form is **not** re-expressible as a warm start / parameter
  initialisation. That matters because "it is just a warm start" is the natural
  objection to A0's separateness, and it is now refutable by citation.

**The honest half that is NOT covered, and their claim stands.** Γ-maximin over a
restricted matrix is **not an equilibrium concept** — it is a decision rule over a
credal set, and Devlin & Kudenko say nothing about it. So:

- the **shaping** half of residue 1 is answered;
- the **restriction** half — the widen-only A2 law, and what guidance may do to a
  *floor* rather than to a *preference* — is not, and the nearest thing this survey
  found is domain 3's Troffaes ordering, whose relevant content is **C12**:
  Γ-maximin's optimal set **does not shrink as beliefs sharpen**. That is a
  constraint on what guidance can achieve through a floor at all, and it is worth
  having in the A2 discussion even though it is not the precedent they wanted.

  **So: cite Devlin & Kudenko for the shaping law; keep the widen-only law as
  yours-to-falsify, with C12 as the nearest external constraint.**

---

## 49.2 Residue 2 — "two-currency economies (compute + operator attention, no exchange rate)"

> *"metareasoning literature prices compute; mixed-initiative literature prices
> interruptions qualitatively; **nothing prices both without a scalar**."*

**There is a literature, and its answer is that you should not want an exchange
rate.** Three pieces, and they compose into a design rather than a citation.

**S96. Ghodsi, Zaharia, Hindman, Konwinski, Shenker & Stoica, "Dominant Resource
Fairness: fair allocation of multiple resource types", NSDI 2011.** DRF exists
*precisely* for the case the lens describes: multiple resource types that are **not
substitutable**, so no exchange rate exists. It generalises max-min fairness by
allocating on each consumer's **dominant share** — the largest fraction of any one
resource that consumer holds — and it comes with four axioms:

- **sharing incentive** — no consumer is better off under an equal partition;
- **strategy-proofness** — *a consumer cannot increase its allocation by lying about
  its requirements*;
- **envy-freeness**;
- **Pareto efficiency**.

  **The axiom that earns its place here is strategy-proofness**, and it bears
  directly on d43 §7.3's surface tithe. A **fixed partition share per ADVICE
  member** is safe against misreporting *because it ignores demand* — but it also
  cannot adapt, so a member with a genuinely quiet turn cannot lend its share to a
  member with a loud one. The moment the tithe becomes demand-responsive, members
  have an incentive to overstate, and **DRF is the known allocation that is both
  demand-responsive and strategy-proof without an exchange rate.** That is a concrete
  upgrade path for the tithe with the failure it prevents named.

**The second piece is one the lens already has and may not have connected: the
ε-constraint form** (domain 24). Where a weighted sum of two objectives reaches only
the **convex hull** of the Pareto front, the ε-constraint form — *fix one resource
as a constraint, optimise the other* — reaches **all** of it. Applied here:
**attention is the constraint, compute is optimised inside it**, and no exchange
rate is ever formed.

**The third piece is this survey's own R-15** (domain 47), which says the same thing
from the other end and gives the *window*:

> several of the architecture's most important quantities are properties of a **set**
> of decisions and have no per-decision meaning; hold them as a **constraint over a
> window**, measure them over that window, and let the per-decision rule optimise
> inside.

  **Attention is exactly such a quantity**, and domain 44's C90 supplies the specific
  windowed statistic: the surfaced set's **positive predictive value**, which is a
  portfolio property and which collapses the channel when it is allowed to drift.

  **So the constructive answer to residue 2, in one line:** *the attention currency
  is a windowed constraint, not a priced good; compute is optimised subject to it
  (ε-constraint form); and if the constraint must be shared out among competing
  ADVICE members on demand rather than by fixed share, DRF's dominant-share rule is
  the strategy-proof way to do that without inventing an exchange rate.* The
  ECONOMY law does not have to stand on the programme's own argument alone.

---

## 49.3 Residue 3 — "guidance provenance as premise coordinates"

> *"appears nowhere found; it follows from this program's Law P, and it is the piece
> that makes operator influence **measurable**, which the human-guidance literature
> mostly laments lacking."*

**Partly covered — by two domains of this survey, applied to a token the guidance
lens introduced.**

- **Domain 38 (provenance semirings)** is the general machinery: annotate an input
  with a token, propagate it through the computation with the two operations, and
  *"which of these numbers did the operator influence, and how"* becomes a **query**
  rather than a bookkeeping discipline. Their `guidanceId` is a provenance token in
  exactly the technical sense.
  - **And the universality theorem is the actionable part**: `N[X]` is universal, so
    annotating **with structure** now makes every coarser reading — *was this
    influenced at all* (Boolean), *how much* (a valuation), *by which guidance*
    (which-provenance) — a **homomorphic image computable later**. Collapsing to a
    boolean "operator-touched" flag now is a **one-way door**. This is d38's C70 in
    a new place, and it is much cheaper to get right before the field exists than
    after.
- **Domain 43's C88 (closed-loop feedback)** is *why* it must be measurable, and it
  supplies the instrument: the propensity log and randomised holdout. Their own
  observation that the human-guidance literature *"mostly laments lacking"* this is
  right, and the reason is instructive — **the literature laments it because
  measuring influence requires the counterfactual**, and the counterfactual only
  exists if something was withheld at random. The provenance token records *that*
  guidance was used; only the holdout says *what would have happened otherwise*.
  **Two mechanisms, and the design needs both.**

**What genuinely stands as theirs:** *guidance provenance as a coordinate of the
premise index* — i.e. not merely an annotation on a value, but a dimension on which
values are keyed and compared. Neither of the two domains above says that, and it
is the right move under d29's surviving core (*do not build a seventh parallel key;
extend the one index*). **It also inherits d48's amendment**: the coordinate earns
its seat with a **recorded witness** — a concrete pair of values at one address with
different truths — which for guidance is easy to produce and should be produced.

---

## 49.4 `[+]` On their §6 correction, which is correct and has two independent supports

> *"bounty-only guidance changes work distribution, never a staged plan — **that is
> true only past saturation.** Under a finite budget, attention changes which
> subtrees have evidence at the deadline, and therefore can change the staged
> plan."*

**This is right, and it is the same statement as two findings elsewhere in the
survey**, which is worth knowing because it means the restated falsifier is on firm
ground:

- **d45's C93**: under a finite budget, *where* you spend **is** *what* you compute.
  A depth-`d` search run every `d` moves is the same compute rearranged — the budget
  makes allocation and outcome the same variable. Their "starved board" is exactly
  the regime where that identity bites.
- **d37's `highBestMoveEffort`**: Stockfish reads the **share of nodes spent under
  the current best move** as a signal about whether to stop. That is an engine
  treating work *distribution* as decision-relevant information, in production — so
  the claim that attention is behaviourally live under a budget is not merely a
  theoretical concession, it is something a shipped engine relies on.

  Their per-stratum restatement — **byte-identity on saturated cells, work-shift
  plus emit-record provenance on starved ones** — is the right shape, and it is
  **R-11's discipline** (report stratified before pooled) applied to a *falsifier*
  rather than to a measurement. Worth naming as such: a falsifier that holds only on
  one stratum must say so, or it will be quoted as holding everywhere.

---

## 49.5 Verdicts

- **OPERATOR-GUIDANCE (residue 1) — half covered, and it is the half you needed.**
  **Devlin & Kudenko (AAMAS 2011): potential-based shaping does not alter the Nash
  equilibria of a stochastic game, only the exploration of the shaped agent.** So
  Ng's guarantee generalises past MDP argmax, and what is preserved is **the
  equilibrium set** — which is exactly the object d1's C1 says our zero point is. A
  potential-shaped guidance payload provably cannot move it: the strongest statement
  of A0 purity available, and a theorem rather than an intention. Their second
  result — shaping of this form **cannot be reduced to parameter initialisation** —
  refutes "it is just a warm start" by citation. **The Γ-maximin / widen-only half
  genuinely stands as yours**; the nearest external constraint is d3's **C12**
  (Γ-maximin's optimal set does not shrink as beliefs sharpen), which limits what
  guidance can achieve through a floor at all.
- **OPERATOR-GUIDANCE (residue 2) — there is a literature, and it says you should
  not want an exchange rate.** Three pieces that compose into a design: **DRF**
  (Ghodsi et al., NSDI 2011) exists precisely for **non-substitutable** resources
  with no exchange rate, allocating by **dominant share** under four axioms — of
  which **strategy-proofness** (*a consumer cannot increase its allocation by lying
  about its requirements*) is the one that bears on the surface tithe: a **fixed**
  share is safe because it ignores demand and therefore cannot adapt, and **DRF is
  the known demand-responsive allocation that is still strategy-proof**. The
  **ε-constraint** form (d24) says *fix attention as a constraint and optimise
  compute inside it*, reaching all of the Pareto front where a weighted sum reaches
  only its convex hull. And **R-15** supplies the window, with d44's C90 supplying
  the statistic (surfaced-set PPV). **The ECONOMY law does not have to stand on the
  programme's own argument alone.**
- **OPERATOR-GUIDANCE (residue 3) — partly covered, and the covered part has a
  one-way door in it.** `guidanceId` is a **provenance token** in d38's technical
  sense, and d38's universality theorem is the actionable part: **annotate with
  structure now**, because every coarser reading (influenced-at-all / how-much /
  by-which) is a homomorphic image computable later, while collapsing to a boolean
  flag is irreversible. And d43's **C88** says why it must be measurable and supplies
  the missing half: **the token records that guidance was used; only a randomised
  holdout says what would have happened otherwise.** The literature "laments
  lacking" this because measuring influence requires a counterfactual. **What stands
  as genuinely yours** is guidance provenance as a *coordinate of the premise index*
  rather than an annotation — right under d29's surviving core, and it inherits
  d48's amendment: **earn the coordinate's seat with a recorded witness.**
- **OPERATOR-GUIDANCE `[+]` — your §6 correction is right and has two independent
  supports.** Under a finite budget, *where* you spend **is** *what* you compute
  (d45's C93 — a depth-`d` search run every `d` moves is the same compute
  rearranged), and a shipped engine already treats work distribution as
  decision-relevant (d37's `highBestMoveEffort` reads the share of nodes spent under
  the incumbent). Your per-stratum restatement is **R-11's discipline applied to a
  falsifier** — worth naming, because a falsifier that holds only on one stratum
  will otherwise be quoted as holding everywhere.
