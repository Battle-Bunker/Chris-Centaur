# RED TEAM, round 3 — the R-5 wave, the set-valued retype, the metalevel, the margin, and the fate of scoped contributions

Docket sources: `design/joints-composition` @ tip (docs 15, 17, 22, 23, 24),
`design/search-theory` @ 335abd5 (docs 02, 05, 08), `design/time-interruption`
(time-cpp-spec.md), `design/prior-art` @ fb1de4c (C48 in doc 16/README).
Adjudications verdict-per-item, concessions stated plainly, three new findings
(§1c coverage oracle, §3c the myopic instrument, §5b cold-start censorship).

---

## 1. The R-5 absorption (joints 24 + search 02's D1 exemption)

### 1a. Range as a MEASURE component — CLOSES

The taxonomy argument is sound by their own laws: the range is a measure over
the support *imposed by history*, the weight is a measure *chosen by the bot*;
putting a history-weighted distribution into S would collapse the
support-moves-only-by-deduction law. Seating it beside the weight-supplier in
MEASURE, with a degenerate point-mass today, is the right shape, and the
two-faces table (sound face = opponent counterfactual-value bounds at the
fibre boundary; advised face = a weight at earned precision) matches the
terminal-boundary finding at a second scale, which is the kind of convergence
that indicates a joint rather than a coincidence. One check run and passed:
the re-entry map's value proposition (human pin oscillation walks the same few
addresses) survives the key growth, because the range moves only on realized
history and observations — never on pins — so oscillating premises still
collide on the same range coordinate. Concede fully.

### 1b. The rules-artifact reframe (C35) — CLOSES, mechanism owed

"The vendorable module IS the rules artifact; completeness = no consumer
implements a rule" is the right frame, and the two boundaries (deterministic
and I/O-free inside; policy stays out) make it checkable in principle. But the
gate is described as "a grep-level invariant … checked in CI", and no grep
distinguishes *implementing a rule* from *consuming one*. As written this is a
review discipline wearing CI clothing — the exact promotion (convention →
structure) this lens performs everywhere else is missing at its own new gate.
Owed: the mechanical predicate — e.g. the artifact exports a closed rule
vocabulary and consumers are lint-banned from the primitive operations
(adjudication comparisons, spawn arithmetic, promotion thresholds) outside it,
the same way the scout's import ban is enforced structurally today. One
paragraph, and the difference between an invariant and an aspiration.

### 1c. The D1 exemption — airtight where claimed, and the claim's edge must be quoted with it

**The narrow exemption is airtight, concede plainly.** Burch et al.'s theorem
is about re-solving a subgame *for its value*; under Law D1 cluster results
are proposals, every priced plan is priced by the unconditional whole-board
bank, and a proof about a priced plan cannot be falsified by the existence of
unpriced ones. The floors are safe. The search lens has also already done the
red team's work on the broad claim: D-6 names the steerable-hole mechanism at
the *generator* level, D-7 finds the non-public cut live at ply ≥ 2 today, and
2b.2 correctly identifies the scout import law as the load-bearing wall. Two
demands to keep the exemption honest:

1. **Promote the wall to a law.** The exemption's entire weight rests on
   "nothing in scout/ may write a bound" — currently an import ban plus a
   structural test, described by the search lens as load-bearing "for a reason
   its authors did not name". Name it in the manifest's law table (it is Law
   D1 applied to depth), so no future door relaxes it without tripping the
   review that C-T1-class changes get.
2. **The three creep points get a manifest mark.** `requireSurrogateGain`,
   `offerOrder`'s dispatch weights, and `setRefineScope` each make the priced
   set a function of the decomposition. None touches a bound; all three shape
   evidence. They should carry a declared `coverage-shaping` mark so the
   admission-trace coordinate (round 1, §2.1) picks them up as a class rather
   than as three incidents.

**The round-3 addition — C48-style masking makes the coverage cost
unmeasurable from inside, and the CPP's new margin axis cannot see it.** The
margin-at-the-deciding-rung discriminator separates "saturated because
extracted" from "saturated because the evaluator cannot separate the plans" —
both diagnoses *among priced plans*. Generator blindness is a third diagnosis
outside the dichotomy: when the best plan was never priced at any rung, every
rung agrees, agreement is flat, the margin can be wide, and the profile reads
"extracted" — Thompson's masquerade one level down, hiding in exactly the
place D-6 predicts an opponent can steer toward. Nothing proposed by any lens
measures it, because every proposed instrument conditions on the priced set.

> **Demand (constructive): the coverage oracle.** Once per N decisions, price
> one exogenous probe — a legal joint plan drawn from *outside* the proposal
> distribution (uniform-random legal, or an opponent-model-suggested line),
> through the ordinary unconditional bank — and record whether it beats the
> staged plan under `better()`. The probe-beat rate is a direct, standing
> estimate of generator blindness: ~0 vindicates the enumeration's coverage
> (and finally puts a number under Law D1's "coverage obligation"), and any
> persistent positive rate localises D-6 from conjecture to measurement. Cost:
> one extra pricing per N decisions, no new machinery — the same
> always-on-audit shape as the reappearance oracle, applied to ACTION instead
> of MODEL. The arbitration table in §4 needs this as its third row.

---

## 2. The set-valued REDUCTION retype (joints 22) vs the ratchet (search C-T1)

**The exactly-one defence is genuine, concede.** "One member per site class"
constrains *binding arity*; the retype changes *return arity*. Those are
different quantities, the site-class table is structurally unchanged, and the
consumers gained (ADVICE gets its input type with conditions attached, which
is Miller's point and the Centaur product in one line) are real.

**The ratchet contradiction is resolved de facto and papered de jure.** C-T1's
actual content is that `stageAndGate` is monotone in the *realised* proved
floor, so a mixed draw — staging a sampled row — is refused by construction;
search S15 accordingly blocks set-valued arity on "C-T1's ratchet
restatement". Doc 22 never cites C-T1. Its design happens to evade the
invariant: the collapse still occurs, deterministically, at the emission
barrier, so one row still rides the wire and the gates read that row's floor
as before — no draw, no refusal, the set consumed only by ADVICE, allocation
and ponder targeting. That evasion should be *stated*, and two loose ends make
the silence expensive:

1. **The emission collapse is an unnamed second reduction.** If a bot binds
   `reduce/e-admissible@1`, *something* at the barrier picks the one emitted
   row from the surviving set — and that something is a strategy-bearing
   choice (which admissible survivor do we actually play?) with no member
   name, no site-class row, and no `botDiff` visibility. That is the
   two-channel `??` defect's exact shape, reborn at the barrier on the day
   the first set-valued bot ships. Fix is one row: the site-class table gains
   an `emission-collapse` site (constraint: must produce a total order;
   Γ-maximin-with-tie-key is the launch member), bound like every other site.
2. **Mixed play must be explicitly out of scope.** One sentence in 22: "no
   member may randomise the emitted row until C-T1's restatement (declared
   reduced value, monotone within basis) is adopted" — closing the loop with
   search S15 instead of leaving two branches with incompatible readings of
   whether the block exists.

With those two sentences the retype is clean. Without them it ships the old
disease through the new door.

---

## 3. The metalevel joint (search 08)

### 3a. "alternate() is pairRepair for the metalevel" — a real identification, not a rhyme

The test for a rhyme is whether the mapping predicts anything. Here the shared
structure is exact — both are one-step-greedy ascent (accept the single best
improvement as if it were the last step); both fail on jointly-valuable steps
that are individually worthless (the symmetric pair at the object level, the
precondition chain at the metalevel); both patches are forced diversification
off the greedy path with an acceptance band. And the mapping *predicts*: it
locates the remedy (value the joint step at its joint cost) and its cost
shape, which is finding M-2. One flattening worth a sentence: the two
failures are not isomorphic in structure — the object-level failure is
symmetric simultaneity (a 2-opt neighbourhood problem), the metalevel failure
is asymmetric precedence (a setup-chain problem) — so k-opt and blinkered are
different remedies for siblings, not one remedy twice. Harmless as stated,
worth keeping precise so nobody imports 2-opt's cost analysis into the bundle.

### 3b. The blinkered bundle vs the lever preconditions — the semantics are NOT fully respected as claimed

Doc 08 calls the bundle's value "one existing formula evaluated under the
assumption that the precondition has been met, which is a cheap substitution
rather than a new model". Check it against what catch-up actually does: it
advances a stale cloud through the missed turns, i.e. it *dilates* before it
conditions, so the post-catchup cloud a narrow would operate on can be wider
than the current one — and narrow's value formula reads cloud state
(`cloudSize`, `satRatio`). Evaluating it on the *pre*-catchup state misprices
the bundle in the direction that flatters it (narrow looks cheap and valuable
on the stale, narrower cloud). So the bundle's value is an estimate under a
*forecast* cloud state — the dilation curve gives the forecast cheaply, but it
is a forecast, and under this program's own laws it should say so (tags, and a
place in the M-4 instrument's validation). Second sentence owed:
**bundles are valuations, never commitments** — each slice re-chooses, so the
metalevel stays interruptible and no bundle needs a Carried lifetime. Doc 08's
prefix-determinism caveat is adjacent but does not state this.

### 3c. NEW FINDING — the M-4 instrument is itself myopic, and as specified it will falsify the wrong lever

M-4 records `(family, cost, Δ maxGap)` per applied lever and calls it "a
direct falsification test for `estimates()`". But Δ maxGap per *individual
lever application* assigns ~zero to exactly the levers whose value is
enabling: catch-up moves no bound by itself — its payoff is the narrow it
unlocks — so the measured value-per-cost table will read catch-up ≈ 0,
"empirically" vindicating deletion of the lever the blinkered bundle exists to
save. The instrument reproduces, at the measurement level, the same one-step
myopia the policy level is being repaired for. The repair is the same one:
credit *windows*, not steps — attribute Δ maxGap over a bundle (or over a
k-slice window keyed to the precondition chain) jointly to its members, and
report both columns (per-step and per-window). Cheap, and without it M1's
top-tier instrument is a trap. This is the sharpest thing round 3 found:
**every greedy valuation in this architecture now has a greedy measurement
proposed beside it, and the second silently validates the first.**

M-3 (fourteen unprovenanced constants steering all computation) and M0 (lever
distribution row) are right and cheap; no objection. The currency slot's
refusal (no exchange rate between slack and horizon) is, as the doc says, the
same refusal twice — concede, and it is the pattern that keeps being this
design's best move.

---

## 4. The CPP margin conditional (time-cpp-spec §2¾) — right axis, not yet falsifiable as recorded

The margin axis is the correct discriminator for the two named causes, the
`evalVersion` key (M48) is exactly the premise discipline applied to the
profile itself, and the scoping honesty (true margin needs the runner-up's
value; no current telemetry carries it; lands with increment 2; interim proxy
is direction-only) is a model of how to record a limitation. Concede all of
that. Two failures of falsifiability as recorded:

1. **"Wide" and "near-zero" have no numbers.** The arbitration ("wide margin +
   flat agreement ⇒ fund ponder; near-zero + flat ⇒ fix the evaluator") is a
   band-shaped *procedure*, the same gap as belief band 1 in round 2: until
   cut-points are registered per stratum, any post-hoc reading can be declared
   consistent. The cut-points must ship in the v1 profile spec *before*
   compilation, derived from the margin distribution's own bimodality or a
   declared quantile — and the doc should name who sets them and when, as the
   belief lens now does for its bands.
2. **The dichotomy is missing its third row.** Per §1c above: generator
   blindness produces wide-margin + flat-agreement too — the misfunding case,
   because the prescribed remedy (fund ponder) spends more compute inside the
   same blind proposal set. The arbitration table needs three rows, with the
   coverage oracle's probe-beat rate as the third discriminator: wide margin +
   flat agreement + probe-beats ≈ 0 ⇒ fund ponder; same + persistent
   probe-beats ⇒ the proposal generator, not the ponder ladder and not the
   evaluator, is the binding constraint.

---

## 5. The fate of the linear-laws finding (joints 15 §C + 17 §B)

### 5a. Concessions first

The adoption is better than my proposal in three ways I want on the record:
the **k-additive capacity** identification gives the arity cap a principled
meaning (the manifest is choosing k) instead of my ad-hoc "declare
overlaps"; the **residual form** condition is the Möbius transform's
definition, not a style choice, and I had not stated it — without it my
"disjoint scopes add verbatim" is simply false once a second pair term
exists; and the **Möbius-not-Choquet** precision (signed flows, no
monotonicity) preempts a vocabulary error I could have caused. The shipped
edge-EV surrogate as a running 2-additive precedent with a cost measurement
is the strongest possible form of evidence. The proposal-side withdrawal is
accepted symmetrically. Condition 3 (per-scope engagement) is Law R applied
one level down and right.

### 5b. Two bites, one of them the docket's question

**(i) The arity cap contradicts the adoption's own worked example.** 15 §C
closes with "body-wall architecture becomes one declared second-order term" —
but a wall is {two-to-four wall units + an enclosed region}: arity 3–5
against a cap of "2, or 3 by declared exception". Either walls are the
declared exception (and 3 still doesn't cover a four-unit wall), or the
design needs **compound participants** — a declared coalition ("the wall")
seated as one participant. Compound participants are probably right (the
Carried role map already names such coalitions), but they re-open the fat
question one level up — who audits what is inside a compound participant? —
and need their own rule (a compound participant is a Carried object with a
member-defined membership predicate, so it has an id, a lifetime and an
invalidator). Say which resolution holds; as written the worked example and
the cap cannot both be true.

**(ii) Condition 4 relocates my objection into cold-start censorship — the
docket's question, answered: partially relocated, one sentence from closed.**
Identifiability as written quantifies over all scope terms: *"a scope term may
be seated only if its FitProvenance shows the corpus can identify it"*. But
the terms that matter for ruling 49 are interaction terms of strategies
**nobody has played** — a wall term, a race term — whose identification is
rank-deficient in every existing corpus *by construction*, because the corpus
contains no walls and no deliberate races. Condition 4, applied universally,
refuses at registration precisely the second-order ideas the machine exists to
express: the fat-member problem has become an identification problem, and the
identification machinery inherits the corpus's distortion (the very thing
ruling 49 warns about — the roster's history now gates what is *expressible*,
not just what is believed). The repair is the trichotomy the design already
uses everywhere else, applied here explicitly:

> A scope term is **derived** (coefficients computed live from identities,
> (K/W)(1−p)-style — no fit, no identification requirement), **unfitted**
> (enters at `advisoryPrecision 0`, order-only, exactly the bootstrap
> discipline every unfitted singleton term already gets — no identification
> requirement, because a term that moves no belief can absorb no noise), or
> **fitted** (owes Condition 4 in full — this is where the noise-absorption
> argument actually applies, and it applies only here).

With that sentence, my round-1 objection is closed all the way down: races
and walls enter as unfitted or derived residual terms on day one, are
measurable through per-scope engagement, and graduate to fitted only when a
corpus exists that can identify them — which their own play generates.
Without it, Condition 4 is a censorship valve that deletes "and beyond" at
order two. I believe the authors intend the trichotomy (their own
advisory-precision machinery implies it); it must be written, because the
current sentence forbids it.

---

## 6. Standing table after round 3

| finding | status |
|---|---|
| F1 sacrifice | **STANDS** — still untouched by any lens; still needs the owner |
| F11 operator advice | **CLOSED in structure** — ADVICE kind exists (12 §D3), sharpened to a monotone-submodular law with a cardinality budget (17 §C), fed its input type by the reduction set (22 §1), budgeted in a non-fungible attention currency with the exchange-rate refusal (22 §2). What remains is my round-2 demand's tail: the when-to-commit advice member, now expressible inside ADVICE — an increment, not a gap |
| F3b commitment timing | reactive half closed (round 2); proactive half now has a home in ADVICE; **downgraded to build item** |
| cross-horizon comparison law | **STANDS** — still unwritten anywhere |
| admission-trace coordinate | **PARTIALLY SERVED** — 23's three-granularity revision is the measurement version and is excellent (the cap discards the *most differentiated* options — worse than argued); the premise-coordinate form still owed, now with three granularities + the `coverage-shaping` mark (§1c) to carry |
| linear-laws / fat members | **CLOSED conditional on §5b's two sentences** (compound-participant rule; the derived/unfitted/fitted trichotomy on Condition 4) |
| new (this round) | emission-collapse site row + mixed-play scope sentence (§2); coverage oracle + third arbitration row (§1c, §4); bundle-as-valuation + forecast-priced bundles (§3b); window-credited M-4 instrument (§3c); margin cut-points registered before v1 (§4); rules-artifact mechanical predicate (§1b); scout import law promoted to a named law + creep-point marks (§1c) |

Net judgment, per ruling 50's standard: the wave is converging, and it is
converging by the strongest available mechanism — lenses adopting each
other's laws and finding the same shapes at different scales (the range's two
faces; join-with-recorded-widening inside a joint; the same refusal about
currencies at three sites). The residual risk has changed character
accordingly: it is no longer missing structure, it is **unnamed collapses at
seams** (the emission barrier, the bundle forecast, the margin cut-points) and
**instruments that share the bias of the thing they measure** (§3c, §1c).
Those are cheaper to fix than what round 1 found, and every one of them is a
sentence or a column, which is what convergence should look like.
