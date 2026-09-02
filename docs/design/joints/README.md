# Joints and composition — design set

Architecture design, COMPOSITION lens: the joint system itself — configuration,
registries, the engine API, and how strategy collections compose. Design only;
no shipping code on this branch. Anchors verified against
`claude/cluster-lookahead` @ `3090b77`, the kit line @ `639416b`, and
`TacticToes` @ `416d9c8`.

**Start at `07-SYNTHESIS.md`** — it is standalone. The rest are the derivations.

| file | what it settles |
|---|---|
| `00-CORE.md` | the disease (values and premises travelling separately), the four moves, joints as a manifest, bots as expressions over collections, the reachability law |
| `01-PREMISE-LATTICE.md` | the premise as an index and `(S, w)` as the fiber; join / meet / advance; the reducibility tag as the price of the meet; `frame` as a fourth projection coordinate; the config half of the base |
| `02-JOINT-INVENTORY.md` | the eleven joints read off the shipping code with the law each actually uses; the ordering comparator; admission over valuation; the reduction joint in five places; the shipped bot written as a value; four migration increments; §7 absorbs the VALUE lens |
| `03-ENGINE-API.md` | cut at determinism rather than purity: `settleTurn` with an injected spawner, one exported adjudicator, grammar queries shared with the human interface, a resolution record on the wire |
| `04-ADDRESSING.md` | the half-built experiment coordinate system; `botId`; declared versus observed coordinates; what lane (b) can say under addressing |
| `05-ADVANCE-AND-COMMITMENTS.md` | the memoryless-across-turns finding; `advance` as the third operation; the two purchase columns (and why ponder needs both); the carried premise as one object for pins, reference actions, commitments, roles and stances |
| `06-SELECTION-AND-SKETCH.md` | within-bot dynamic selection as a premise change; Law S; the concrete types; the three CI checks; the byte-identity path; the refusal list |
| `14-PRIOR-ART.md` | five systems that industrialised these moves — Nix, Bevy ECS, algebraic effects, Hydra/gin, UCI+MLflow/DVC — and the six design changes their hard lessons force |
| `15-MANIFEST-AMENDMENTS.md` | the shared fitted-data class, the five items owed to the red team's round-2 pass, and scoped contributions adopted with three conditions |
| `16-TERMINAL-BOUNDARY.md` | the value model is a bulk term plus a boundary condition: the exact settling rule as one MODEL member sourced from the engine's adjudicator, the pricing of its approach as ordinary VALUE members, wired as one row |
| `17-COMMITMENTS-AND-SCOPE.md` | the carried premise is an option and the interruption theorem makes its abandonability a dominance result rather than a safety trade; scoped contributions are a k-additive capacity, which supplies the residual form as a definition and identifiability as a fourth condition; and ADVICE's law is submodular set value under a cardinality budget |
| `18-IDENTITY-AND-TRACES.md` | three identities, not one: trace hashes make invalidation short, edges make shared spend accountable, and stable names carry across advance where content hashes cannot |
| `19-ENGINE-SPEC.md` | the engine re-cut in buildable detail: settleTurn's signature with the spawner port, one adjudicator for three callers, the grammar queries, and a seven-step migration with a gate each |
| `20-MEASUREMENT-MIGRATION.md` | the third leg: the validation ledger is still keyed on flags that no longer exist, what replaces it, the independent oracle that keeps a generator honest, and how existing measurements transfer rather than being re-run |
| `21-OWNER-ASKS-TEST.md` | the carve tested against the owner's own named asks: five fit, and interception-deterrence is blocked by ruling 13 rather than by the carve — a quantifier has no response |
| `22-REDUCTION-RETYPE.md` | the reduction returns a SET of (option, dominance condition), collapse moves to the emission barrier, advice gets its input type free; operator attention as a second, non-fungible currency; and meta-Nash support as Law R's upgrade path |
| `23-ADMISSION-REVISED.md` | measurement revises the admission story: three granularities, a fifth cause (15–43% of priced plans refused by the emission rate limiter), my identification withdrawn, and the saturation rule as a generated check |
| `24-RANGE-AND-RULES-ARTIFACT.md` | the range as a measure coordinate with bounds as its sound face, the spawn LAW instead of a sampler, the bijection law instead of type-derivation, and the engine work reframed as building one rules artifact |
| `25-ARGUMENT-HYPOTHESES.md` | arguments have premises too: every soundness argument names its hypothesis, with dissolve-before-assert as the ordering its own evidence forces; and metamorphic relations as the evidence class immune to the oracle problem |
| `26-CLOSURES.md` | red team round 3's five items closed: the unnamed emission collapse gets a site-class row, coalitions keep the arity cap honest, the cold-start clause is fixed by the derived/unfitted/fitted trichotomy, the rules-artifact gate gets three mechanical checks, and vocabulary walls become a named law |
| `27-DSM-AND-BUDGET.md` | the co-change matrix mined from history (kinds capture churn at 1.94x, ACTION is not one module at 7% self-share, one prediction confirmed and one refuted), inversion named as an operator, and a visible-layer budget applied to this survey's own additions |
| `sketch/` | the spine as compiling code — manifest, choices, bots, normalisation, addresses, diff and the checks, 531 lines, with the three findings that only came out of running it |
| `07-SYNTHESIS.md` | the whole factorization, the build order across lenses, the risks, and a checker-clean owner summary |
| `08-FIT-PROVENANCE.md` | ruling 49: a fitted number is a value with the premise it was fitted under; transfer penalty, the two fit laws, and six degrees of freedom the machine expresses that we never tried |
| `09-REDTEAM-RESPONSE.md` | the TIME lens's six breaks against this carve: all six adopted, three with sharper forms (obligation composes by min-deadline; Law K for calibration; per-site reduction bindings that default to broadcast) |
| `11-REDUCTION-BINDINGS.md` | after the rectangularity reversal: the site-class table with its constraint column, blend-at-read, commitments recording their reduction binding, and cross-joint constraints as manifest data |
| `12-EXPRESSIVENESS.md` | answering the dedicated red team: the sacrifice seat, in-game adaptation under Law K, the sixth kind decided, the linearity finding conceded in part with sub-provenance as the answer, the cross-horizon law written, and commit-timing leakage answered from source |
| `13-OWNER-DECISION-PACKAGE.md` | the human boundary as one decision: two worked designs (ADVICE-first vs kernel-law parameterisation), with the decisive code fact that a pinned sacrifice already plays today |
| `10-REDTEAM-BELIEF.md` | adversarial pass on the EPISTEMICS carve: the "touches nothing" claim is a diff test against a regime shift, plus lever preconditions, frozen-slot contention, the tag's non-partition, fog-tracking fear, the oracle's sampling bias and the observer-belief cost model |

Cross-lens: this set adopts the EPISTEMICS lens's support/weight vocabulary
(`design/belief-fog`), the TIME lens's `advance` and anticipatory meet
(`design/time-interruption`), and the VALUE lens's weight-flow currency and
homogeneity diagnostic (`design/value-evaluation`). Where a relayed claim did
not match the source document, the mismatch is named at
`02-JOINT-INVENTORY.md` §7.
