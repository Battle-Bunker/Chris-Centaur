# The economy gets its goods — CPPs, flip-priced meets, and the denominator dissolved

Integration of the librarian's C5/C6/C8/M4–M7 (design/prior-art,
02-anytime-and-metareasoning.md) into this branch. The librarian is right
that the economy as drafted had prices and no goods; this document supplies
the goods model, merges it with the Lc0 funding rule into ONE denominator
resolution (an owner proposal, not a question), corrects the market's meet
pricing, and pins two laws. SUPERSEDES: the "equal total-quanta column"
proposal (synthesis §1Q4, agent doc §3) and the market weights as drafted
(scheduler sketch §3).

---

## 1. The goods model: the conditional performance profile, fibered

**The object.** `CPP: Pr(quality | quanta, premise-coords)` — a
distribution, not a mean (S4's own insistence), conditioned on the premise
coordinates, which are exactly S4's "input quality" axis. The joints
lens's fibration is the TYPE of this object; it fibers over the lattice
for free, and the cross-lens join costs nothing because both sides were
already built to the same index.

**Quality, denominated.** For a decision, quality = the staged move's
expected regret against the converged decision, in sharePar units —
operationally: re-run recorded decisions at a quanta ladder (the harness
replays boards; the two-budget prefix-determinism property makes the
ladder cheap since a larger budget's sequence EXTENDS a smaller one's) and
score each rung's staged move against the top rung's. Compilable OFFLINE
from the replay archive, no new games (ruling 49-clean: every CPP is a
member with fit provenance — corpus id, lineage, board-class strata; the
geometric-ratio-2 tranche default enters with provenance class THEOREM,
a provenance kind the manifest must be able to express).

**What reads it.** The allowance split (how much a phase buys), the
exchange-rate's target (below), the settled-early test's expected-gain
side, the instability extension, and the measurement layer. The market
reads its derivative — the marginal quality of the next tranche — jointly
with §3's flip factor.

## 2. The denominator resolution — one object seen from two sides (owner proposal)

The question escalated to the owner ("what denominates per-turn
measurement once ponder carries compute across the boundary?") dissolves,
because funding and measurement are the same CPP read in two directions:

- **Funding (the Lc0 PR1195 shape):** per turn,
  `grant = clamp(CPP-target(turnBudget, premise) − carriedQuanta, min, cap)`
  — budget the move's TOTAL expected quality including reused work and
  fund the difference. Lc0 states the same difficulty list we have (moves
  left unknown, noisy rate, unknown reuse fraction, early stops) and this
  is their shipped answer.
- **Measurement (the librarian's C5):** compare arms at equal EXPECTED
  QUALITY, not equal quanta. The ledger + the arm's CPP price every
  decision's expected quality; cross-policy arms report (a) strength at
  equal wall budget — the deployment truth, unchanged, headline — and (b)
  the quanta cost of reaching equal expected quality — the efficiency
  claim. `carriedQuanta` stops being a denominator problem and becomes a
  funding input; the previously proposed "equal total-quanta" comparison
  column is RETIRED (it compared costs without a goods model, which is
  exactly the disease).

Stamping rule (ruling 49): every quality-denominated verdict stamps the
CPP member it priced with; two verdicts under different CPP members do not
compare silently (the refusal law's fifth reader gets a sixth tag —
cheaper: the CPP member id is part of the CONFIG coordinate already).

Proposal to the owner in one sentence: *adopt expected-quality
denomination for cross-policy comparisons, keep equal-wall strength as
the headline number, and fund refine grants to the CPP target net of
carried work — one fitted object, two readings, no new denominator.*

## 3. Meet pricing corrected: the flip factor (C8, and credit where due)

Russell & Wefald: a computation's value is
`P(it changes the chosen action) × E[utility difference | change]` —
width without decision-relevance is worth nothing. The program DERIVED
this once (core-redesign §2.3's boundary-straddle VOI) and then never
computed it; my market spec repeated the omission by weighting hypotheses
only by realization probability. Corrected market weight:

    w(h, work) = P(h realizes)                       — belief/witness side
               × P(work flips better() | h realizes) — THE FLIP FACTOR
               × E[improvement | flip]               — from the CPP

The flip factor is cheaply computable HERE because `better()` is a
lexicographic comparator over bounded quantities: the deciding rung is
already telemetry (mechanism.advisory's floor/depth/est/tie rows), and
P(flip) is a function of interval overlap AT THAT RUNG, which BankResult's
envelope already carries. Corollary adopted verbatim: narrowing a bound
whose rung is not contested has value ZERO — width-priced spending
systematically overspends away from decision boundaries (a candidate
mechanism for the VALUE lens's "inert weight, cause (b)": the term was
fine, the spending was misdirected).

## 4. Two laws pinned (C6, M4/M7)

- **The incumbent is the interruptibility witness.** The decision pipeline
  is a composition containing native CONTRACT stages (cluster enumeration,
  ladder pricing), and naive composition destroys interruptibility even
  from interruptible parts; what rescues the pipeline today is the
  standing conforming incumbent — rung 0's contract, undesigned as such.
  Law: the incumbent is the pipeline's advertised interruptible type; no
  refactor may remove, bypass, or lazily defer it without re-typing every
  consumer. `contract | interruptible` becomes a declared column on
  ECONOMY/ACTION members (composition lens's manifest carries it).
- **Metareasoning is metered.** The ledger, the market, the declaration
  checks and the monitor points consume decision time; the economy carries
  its own overhead as a ledger row, and the anti-latch law extends: *the
  economy may not spend more on choosing how to spend than the spread it
  can recover.* First measurement (M4): the variance of per-tranche
  quality improvement — if it is low, the right design is FEWER monitor
  points and larger contracts, which is the opposite of the reflex.

## 5. What this changes elsewhere on the branch

- synthesis §1Q4/§3: the owner question becomes the §2 proposal; the
  equal-total column is retired; increment 2 gains "compile the first CPP
  from the existing replay archive" as its second deliverable (offline,
  no new games, immediately useful for the exchange-rate target).
- scheduler sketch §3: market weights gain the flip factor; the
  settled-early test's "dominance proved" arm gains the cheap pre-check
  "deciding rung uncontested ⇒ marginal refine value ≈ 0".
- agent doc: monitoring rows (monitorChecks, per-tranche improvement
  variance, economy overhead) added to the ledger schema.
