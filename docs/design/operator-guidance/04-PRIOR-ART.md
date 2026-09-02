# 04 — Prior art: what the literature and shipped systems say about the ports

OPERATOR-GUIDANCE lens, fifth document (ruling 50: academic research +
expert implementations). Seven bodies of prior art, each mapped to a port
or a law of the carve; one correction to 01-doc falls out (§6).

---

## 1. Potential-based reward shaping → the value-field's compiled form

Ng, Harada & Russell (1999), "Policy invariance under reward
transformations": additive shaping terms of the form
`F(s, s') = γΦ(s') − Φ(s)` — potential differences — are exactly the class
that preserves the optimal policy, and the paper's own worked constructions
are **distance-based and subgoal-based potentials**, i.e. the goto ramp.

Two borrowings, one in each direction:

- **Telescoping = depth-fair guidance.** A per-step "progress bonus" summed
  along a line grows with path length; a potential-difference term
  telescopes, so a deep line's guidance credit depends only on its
  endpoints. When value-fields enter the multi-ply search (01 §3.1), the
  constructor MUST compile them in potential form
  (`Φ(end-state) − Φ(root)`), or depth and guidance double-count — the same
  hazard class as the ε-per-ply compounding the belief lens killed (their
  thread-reply reversal), arriving through the operator door. The shipped
  horizon-1 ramp is the degenerate case (one step, forms coincide), which
  is why the hazard is invisible today and will not stay invisible.
- **The invariance theorem read backwards is the deference property we
  want.** In the infinite-horizon optimal limit a potential term changes
  nothing; at shallow effective depth it dominates the empty gradient. So a
  potential-form guidance field is *provably strongest exactly where the
  search knows least, and provably fades as real value information arrives
  at depth*. That is the correct trust contract for operator guidance —
  steer the myopic bot hard, defer to the deep bot — and we get it from the
  form, not from a tuned schedule.

## 2. Policy shaping & TAMER → human input is labels about decisions, not value

Knox & Stone's TAMER treats human signal as a reward-like scalar; Griffith
et al. (NeurIPS 2013), "Policy Shaping", shows treating human feedback as
**direct evidence about the policy** (Bayes-combined with the agent's own)
outperforms reward shaping, action biasing and control sharing, and is
robust to infrequent, inconsistent feedback.

Mapping: this is the literature's version of the carve's central move —
**do not launder every human input through the value function**. "Do this"
/ "never that" are policy-level statements (A4/A3 ports); "this matters" is
attention (A0); only genuine taste is value (A1). The platform's original
Drive interface routes everything through reward-shaped scoring; the
lesson (their measured one and our port carve) is that this wastes the
information in imperative human statements. The robustness result also
backs the wire's stance on conflicting operators (03 H7): inconsistency is
data to be combined and displayed, not an error.

## 3. Mixed-initiative planning: MAPGEN / TRIPS → pin-and-repair is the load-bearing loop

MAPGEN (Ai-Chang et al., NASA Ames — daily tactical activity planning for
the Mars Exploration Rovers) is the strongest fielded precedent: human
planners **pin** activities they insist on; the automated planner
**repairs** the rest of the plan around the pins, continuously, with the
human able to inspect why constraints fight. TRIPS/TRAINS (Ferguson &
Allen) established the same division at the dialogue level.

Mapping: pins → `conform()` — our epoch-conformance path is MAPGEN's repair
step, and the shipped rule "the only thing the search does about a pin is
pay for it" is their doctrine. What MAPGEN adds that we lack and 00 M5
asks for: **the explanation surface is not optional** — mixed-initiative
systems live or die on the human seeing *why* the machine resisted a pin
(their constraint-conflict display). The frustration signal is that
display; prior art says build it with the port, not after.

## 4. UCI (chess engine protocol) → four ports have shipped for twenty years

The standard engine protocol already carries the carve, one option each:

| UCI affordance | our port |
|---|---|
| `searchmoves e2e4 d2d4` — restrict the root search to listed moves | A4 determination over a SET (03 A-2), per-decision, exactly |
| `MultiPV k` — maintain k best lines for the GUI | the OUT twin: set-valued reduction surfaced to the human |
| `Contempt` / draw-score dials | appetite (risk posture as a read-time dial) |
| `go movetime / depth / ponder` | deadline + economy rows |
| engine self-declares its options at startup (`option name … type … min … max`) | the generated constructor/knob schema — the UI renders what the engine declares, never a hand-written twin |

Legitimacy point: none of these change the engine's evaluation soundness;
all are operator-side and per-session; analysts use `searchmoves` daily as
exactly the "consider only these" affordance H4 types. The joints lens
already named its knob schema UCI-style; guidance constructors ride the
same declaration channel.

## 5. CP search annotations (MiniZinc) → A0 has an exact-solver precedent

Constraint-programming systems accept user **search annotations** —
variable/value ordering heuristics that direct exploration while provably
never changing the solution set (plus warm starts). This is the attention
port in a domain with proofs: guidance over *where to look first* is
routine, separable, and sound in systems whose output is certified. Their
discipline matches Law D1's shape (ordering may never masquerade as
pruning) and gives A0 its cleanest external statement.

## 6. MCTS priors / progressive bias → the honest limit of "spend-only", a CORRECTION

Progressive bias (Chaslot et al.) and PUCT priors (AlphaGo lineage) inject
external knowledge into *selection*, decaying as visit counts grow —
knowledge steers early, evidence overrides late (the same trust contract as
§1's telescoping, implemented as a schedule instead of a form).

The correction this forces on 01-doc falsifier 2 ("bounty-only guidance
changes work distribution, never a staged plan"): **that is true only past
saturation.** Under a finite budget, attention changes which subtrees have
evidence at the deadline, and therefore can change the staged plan — the
prior-art systems *rely* on exactly that. The honest statement of A0
purity: an attention payload never re-orders any *priced comparison* and
never moves a bound; it selects which comparisons get priced. On saturated
boards (snake6 at ≥500ms — the CPP result) the byte-identity falsifier
holds; on starved boards (queen cell) A0 guidance is behaviourally live,
and that is its value, not a leak. Falsifier 2 is restated per-stratum:
byte-identity on saturated cells, work-distribution shift plus emit-record
provenance on starved ones.

## 7. Shielding (safe RL) → A3's two signs are both shields

Alshiekh et al. (2018): a runtime **shield** overrides unsafe actions,
always visibly, leaving the learner otherwise free. Our kernel closures are
shields the bot imposes on itself; an A3 restriction is an operator-added
shield; an A3 license is a scoped hole in one, logged. The literature's
insistence that shields be minimal-interference and auditable maps onto the
A3 rules (named closure, scope, condition, expiry, telemetry) and onto Q11's
symmetry recommendation.

---

## 8. What the prior art does NOT cover (our residue)

- Simultaneous-move worst-case floors under guidance: the shaping and
  shaping-adjacent results assume MDP argmax, not Γ-maximin over a
  restricted matrix; the widen-only A2 law and the guidance-vs-floor budget
  rule have no external precedent found — they are ours to falsify.
- Two-currency economies (compute + operator attention, no exchange rate):
  metareasoning literature prices compute; mixed-initiative literature
  prices interruptions qualitatively; nothing prices both without a scalar.
  The ECONOMY law stands on the program's own argument.
- Guidance provenance as premise coordinates (guidanceId in the fibration)
  appears nowhere found; it follows from this program's Law P, and it is
  the piece that makes operator influence *measurable*, which the
  human-guidance literature mostly laments lacking.
