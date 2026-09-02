# PRIOR ART — the survey, its contradictions, and what to do about them

Branch `design/prior-art`. Commissioned under **ruling 50** ("this deserves
hours of academic research and inspection of expert open-source implementations
of the paradigms in use") and read against **ruling 49** ("fitted numbers enter
as members with provenance; the mandate is a joint-carving core machine").

Eight domains, surveyed against the four lens syntheses as they stood at
`origin/design/{time-interruption,belief-fog,value-evaluation,joints-composition}`.
Nothing here is a summary of a paper. Every entry is a mapping: *what the
experts decided, why, and whether our carve agrees, contradicts, or misses the
case.*

| # | domain | file |
|---|---|---|
| 1 | simultaneous-move search and the joint-action blowup | `01-simultaneous-move-search.md` |
| 2 | anytime algorithms and metareasoning vs the time economy | `02-anytime-and-metareasoning.md` |
| 3 | imprecise probability vs the (S, w) object | `03-imprecise-probability.md` |
| 4 | game-engine evaluation architecture | `04-engine-evaluation-architecture.md` |
| 5 | configuration, addressing and composition systems | `05-config-and-composition-systems.md` |
| 6 | rollback netcode and incremental computation | `06-rollback-and-incremental-computation.md` |
| 7 | community practice as a member mine | `07-community-practice-member-mine.md` |
| 8 | partial observability, POMDPs and one-sided POSGs vs the fog programme | `08-partial-observability-and-posgs.md` |

---

## The three things that recur across unrelated literatures

When four fields that have never heard of each other say the same thing about
our design, that is worth more than any single citation.

**R-1. Record what you read, not just where you read it (early cutoff).**
Domain 5 (build systems: only non-deep traces early-cut), domain 6 (Salsa:
backward flooding stops at an unchanged result), domain 4 (KataGo's graph search:
values shared without edge accounting stop being revised), and Nix RFC 062
(input-addressing rebuilds what cannot have changed) all land on the same
correction. Our declaration record names coordinates; it must also carry the
**hash of each value read and of the result**. Without that, citation-scoped
invalidation is narrow but never short, and `feature/commit-scope` recovers less
than it should.

**R-2. Sharing sub-results breaks compositional accounting unless edges are
first-class.** Zilberstein's local-compilation optimality theorem requires a
**tree** (global allocation over a DAG is NP-complete in the strong sense);
KataGo's `GraphSearch.md` shows transposed nodes silently freezing their parents'
estimates; Salsa and Adapton both track dependency *edges* rather than node
membership. Our manifest shares values by design (memo namespaces, one spend
serving several hypotheses). Either declare and prove the allocation projection
is a tree, or drop the optimality claim and make citations per-edge.

**R-3. Every restriction of the option set must be adaptive on value or carry a
bound on what it removed.** Double-oracle restricts by best response *and carries
the value gap*; CMAB naive sampling restricts by a per-variable bandit updated on
realised reward; Prismata's HPS restricts by named portfolio scripts; Texel
learned by losing ~39 Elo that a principled-looking filter must be measured on
what it discards. `sliderCandidateCap: 4` is static, value-blind, weight-blind,
and unbounded — on the unit holding 80–91% of team weight.

---

## Contradiction register

Ordered by how much they should change lens work. **C** = contradicts our carve;
**M** = covers a case we missed.

| id | lens | one line |
|---|---|---|
| **C1** | BELIEF | ε=1 is the *pure security level*, not "the adversarial zero point". In a simultaneous-move game the field's zero point is the stage matrix's **NE**, solved by LP — a distribution, not a scalar worst case. No ε reaches the correct answer. Needs a third reading beside sound/advised: **equilibrium**. |
| **C5** | TIME | An economy with prices and no goods: **no performance profile exists anywhere**. Zilberstein's conditional performance profile `Pr(quality \| time, input quality)` is the missing object; our premise coordinates are already an input-quality index, and the owner's escalated denominator question dissolves once it exists. |
| **C12** | BELIEF / VALUE | Γ-maximin's optimal set **does not shrink as beliefs sharpen** (Troffaes) — it returns one option even under complete ignorance. That is the one property a Centaur option-surfacer must have. **Maximality** returns it natively. Strongest architectural argument for the Centaur direction in the survey. |
| **C25** | BELIEF | **Nothing in the architecture makes information valuable.** No action is ever valued for what it reveals — VOI sits half in ECONOMY and half nowhere — which is QMDP's named failure mode. Prediction: under invisibility potions the bot will never spend a move to scout. C12 is the dual (the reduction cannot express "I now know more"); two mechanisms, one symptom, in the programme whose flagship feature is fog. |
| **C26** | BELIEF | **Marginal clouds cannot store what the conditioning ladder computes.** C1 (item-vanish) is a *disjunction across units* and C2 a *joint exclusion*; per-unit marginals hold neither, so both rungs evaporate at the moment of storage and will measure as worthless when they are merely unstorable. The trace needs a constraint store; marginals are the query surface, not the state. |
| **C9/C10** | BELIEF / JOINTS | Our ε class is Walley's linear-vacuous mixture, and **that class dilates**: conditioning can widen the credal set *for every possible observation*. So `meet = narrow` holds for S (deduction only) and **fails for w**. You can pay for an observation that provably makes you less certain. |
| **C7** | COMPOSITION | "Law per joint kind" **is** Zilberstein's local compilation — a theorem whose optimality hypothesis is a **tree**. Our manifest is a DAG. Declare the allocation projection or drop the claim. |
| **C8** | TIME / BELIEF | The hypothesis market lacks its second factor. Russell & Wefald: a computation's value comes entirely from its ability to **change the chosen action**. `P(refinement flips better())` is computable from interval overlap at the deciding rung, which `BankResult` already carries. Corollary: narrowing an uncontested rung is worth exactly zero. |
| **C16** | COMPOSITION | `botId` is a **deep constructive trace** — the one rebuild strategy that provably cannot early-cut. Behaviour-preserving config edits cold every memo; two identical bots get different addresses. Fix: Nix's **resolved derivation** (address the resolved closure). |
| **C21** | COMPOSITION / TIME | **Identity-for-reuse and equality-for-dedup are two keys with opposite laws**, and `botId`/premise ids are doing both. A name must be stable across the change you want to be incremental in; a content hash must not be. Every cross-turn mechanism (attention carry, warm promotion, ADVANCE) is a reuse problem, not a dedup problem. |
| **C19** | TIME | `observe()` **kills eagerly**; Adapton/Salsa **dirty then verify on demand**. Eager invalidation spends the scarcest compute at the worst moment (operator commit, deadline approaching) on work this turn may never demand. |
| **C13** *(corrected against source)* | VALUE / TIME | The un-incrementalisable object is **`partitionOf`**, not the fold. `(K, W, p)` is a per-turn constant, so the derived fold is *more* updatable than the shipped evaluator. But `partitionOf` is a whole-board set-cover over every admitted unit, recomputed per reading, so one unit's plan changes every unit's cell count. `feature/commit-scope`'s 343 ms therefore rests on **cluster/reading-granularity** invalidation, not per-term incrementality — coarser and more fragile than the design's language suggests. NNUE's analogue fix (observer-local basis + declared refresh trigger) is an uncosted design option. |
| **C2/C3/C4** | COMPOSITION / TIME | `sliderCandidateCap` is the one thing no serious implementation does (see R-3). Enumerate-then-cap is also the wrong *order* — the field grows the arm set lazily, which is what makes it natively anytime. Our above-budget fallback (ICM) is Portfolio Greedy Search, the algorithm the RTS follow-ups exist to beat. |
| **C6** | COMPOSITION / TIME | **"Naive composition destroys interruptibility, even when every component is interruptible."** `contract \| interruptible` must be a manifest column. Our greedy incumbent is the undesigned interruptibility witness — three literatures now say so (Zilberstein, `cluster-enum.ts`, a1k0n's ply boundary). |
| **C23** | TIME | A per-turn checksum detects divergence but cannot **localise** it, and GGPO's named desync causes are our hazards verbatim ("iteration over an unordered collection"). Promote `subStepCount` + per-sub-step checksums out of "additive polish". |
| **C24** | OWNER / VALUE | The winner of the closest public tournament (Tron) states that **a better evaluation always beats a deeper search** in this family, and names the mechanism: deep search over a wrong leaf is self-deluding. Our evaluator is measured as weight-blind and definitionally wrong on three teams; depth is the flagship. Testable free on the existing corpus. |
| **C14** | COMPOSITION | KataGo's graph-search corruption: a shared value updated through one path leaves the other parents' estimates frozen, and the exploration rule then prefers the wrong child indefinitely. Second independent statement of R-2. |
| **C15** | MEASUREMENT | Texel paid ~39 Elo for a principled-looking filter he never measured on what it removed. We have four such filters and have measured none of them that way. |
| **C17** | TIME | Declared access buys **safety, not order** (ECS). Fine-grained keys are unstable under refactoring — coarsen deliberately; deliberate ambiguity needs a first-class annotation or the checker becomes noise people disable. |
| **C11** | BELIEF | Terminology collision: we use "dilation" for dynamics-driven spread; the field reserves it for the conditioning pathology. Anyone reading both will believe we have addressed it. Rename ours to **spread**. |
| **C27** | BELIEF / TIME | The observation-side restriction has no bound. DESPOT restricts to **K sampled scenarios with all action branches retained** and carries a **regret bound**. R-3 in the one dimension where we have not committed; committing now is far cheaper than retrofitting a cap. |
| **C18/C20/C22** | COMPOSITION / TIME | Reachability should be stated over the *resolved* closure; the re-base window needs a hard cap with defined over-cap behaviour (GGPO stalls by design); interval dominance is sound at the leaf and unsound propagated up the deep channel. |

### Cases we missed, ranked by cheapness

| id | one line |
|---|---|
| **M11** | **Paired seat-swapped scenarios + pentanomial scoring** (Fishtest). The pentanomial-vs-trinomial gap is *itself an estimate of the population's bias* — the closest thing found to an instrument for ruling 49's distortion worry. |
| **M13** | **Per-unit flows as standing telemetry.** KataGo's ownership head exists for credit assignment from few samples. Promoting our mining scripts to a per-game column turns 144 games into thousands of unit-observations at zero play cost — the cheapest answer to "the space is explored at low density". |
| **V-3** | **The checkerboard parity bound** (a1k0n) — sound, free, strictly tighter than a cell count, and we lack it. |
| **V-2** | **`room` should count edges, not cells.** a1k0n's mined fit: edges carry ~3.5× the weight of nodes. Reproducible on our archive this week with the value lens's existing tooling. |
| **M14/M19** | **Verifying traces** and **Salsa durability** — the built, named answers to early cutoff and to composition risk 1 respectively. |
| **M1** | **The serialized-equilibrium pre-check**: if the two serialized games agree, the stage game has a pure equilibrium and the LP/joint machinery can be skipped. A free per-cluster reclassifier. |
| **M18** | The hypothesis market's free baseline is "the enemy repeats" (GGPO's predictor carries an entire genre). |
| **M5** | Geometric tranches, ratio 2, penalty ≤4 — **proved optimal**, a fitted value whose provenance is a theorem rather than a sweep (a provenance class ruling 49 does not yet name). |
| **M20** | From-scratch consistency, sampled in production — generalises the replay-rebase differential test from the engine to the incremental value layer. |
| **R-1 (V-4)** | The **articulation-point chamber tree**: 12–1 in the ancestor game, and largely re-use of our existing component decomposition. |
| **M21** | **PWLC**: the value over belief space is a max over α-vectors — natively a **set of plans with dominance regions**, which is maximality's object (domain 3) reached from a third direction, and it is exactly the Centaur output. Also: α-vectors stay valid over belief *regions*, a far stronger cross-turn carry than a scalar bridge. |
| **M17** | The weight-supplier socket wants **effect-handler semantics** — handler installed by the decision context, unhandled = type error. The structural fix for "ε = 1.0 chosen by nobody". |
| **R-1 (REDUCTION)** | REDUCTION gets its second and third members — {paranoid, MaxN, share-weighted asymmetric fold} — satisfying "no joint with one member" and turning the three-team balance bug into a member selection. |

---

## What the survey corroborates

Not everything is a contradiction. Four of our moves are independently confirmed
by people who ship:

1. **The replay-rebase design is the GGPO contract, correctly derived** — send
   inputs, re-simulate locally, checksum to detect divergence, fall back on
   mismatch, and get a free live differential test. Rollback developers treat
   that last property as a main benefit of the architecture.
2. **Per-unit weight accounts are KataGo's ownership head**, arrived at
   independently, down to the board-area normalisation (`w_o = 1.5/b²` ≈ our
   `K/W`). KataGo supplies the argument our VALUE lens has not made: the payoff
   is *credit assignment from few samples*.
3. **`cluster-enum.ts`'s order-2 Möbius surrogate is strictly stronger than the
   naïve assumption** `μ(X) ≈ Σᵢ μᵢ(Xᵢ)` that the whole CMAB family rests on. We
   do exact inference on small clusters where the literature samples
   approximately. The design docs should say so.
4. **Prismata's Hierarchical Portfolio Search is the closest shipped precedent
   for the joints carve** — a commercial simultaneous-move, combinatorial-action
   game AI whose stated rationale for the portfolio architecture is *robustness
   to balance changes*. That is ruling 49's mandate, validated by a product.

---

*Nothing in this directory is final. Sources are named so every claim can be
checked, and every fitted number quoted carries its provenance.*
