# SEARCH-THEORY lens

The search algorithm itself: how joint moves are proposed, how the
simultaneous-move structure is handled game-theoretically, how clusters
decompose the board, how deep lines are explored and backed up — and which
computation runs next, which is a search problem too and which no lens had
claimed. The four earlier lenses carved time/economy, belief/fog, value and
composition; none of them owned this.

**Start at `05-SYNTHESIS.md`.** It is standalone. Its §7 is the owner-facing
summary (piped through `tools/principal-glossary/check-briefing.js` on
`claude/cluster-lookahead`: 0 blocking, 0 owed, exit 0).

| doc | question | headline |
|---|---|---|
| `00-WHAT-THIS-SEARCH-IS.md` | what is our search, in the literature's terms? | pure maximin over a factored row space by better-response dynamics on a floor, with the column-generation half of a double oracle and no mixed solve. The acceptance relation admits a 3-cycle once depth speaks — demonstrated against the shipped arithmetic |
| `01-REDUCTION.md` | is the solution concept a plug-in member? | three axes, not one: ambiguity (calibration) × reading (correctness) × arity (point vs set). Law R1: every member is a lower prevision. Γ-maximin makes compute invisible in the output |
| `02-DECOMPOSITION.md` | when is the factorization sound; should boundaries be searched? | Law D1: generate only, never value — which is exactly what exempts us from the imperfect-information decomposition theorem. Law D2: cuts at public-state boundaries only, geometry being the full-observability case. Boundaries ARE searched today — at depth, on a cut that is already not public |
| `03-PROPOSAL.md` | what does the literature say about basin coverage? | eight operators, nine constants, no socket, no record. Law P1: restrictions must be adaptive on value or bounded. The missing operator is an ejection chain |
| `04-BACKUP.md` | how does our max-min backup compare to the standard rules? | implicit-minimax-backups shaped with a strictly better combiner. A floor folded into a mean slot, over an odometer prefix that collapses on slider boards |
| `06-THE-COLUMN-SET.md` | what does the double-oracle half we DID build cost? | the restricted matrix is already computed cell by cell and thrown away; `price()` cost drifts upward within a decision because the witness set only grows; workers generate columns and discard them. Contains the full S0 specification |
| `08-METAREASONING.md` | which computation runs next, and who says so? | `voc.ts` is meta-greedy in Russell & Wefald's sense, with its known failure live and patched by hand. `alternate()` is `pairRepair()` for the metalevel — the same myopia, twice, at two levels, patched twice, never named once. Fourteen unprovenanced constants decide what gets computed before anything is compared |
| `10-CANDIDATE-LIFECYCLE.md` | the candidate set has no owner — what does the pipeline become? | a PROTOCOL, not a module of members: types, a stage registry, and one ledger that hides exactly one decision (what the stages are and in what order). Nothing relocates. The emission obligation becomes a read of the METALEVEL, not of the comparator. `proposedBy`, the coverage oracle and D-1 collapse into reads of one ledger |
| `09-RESTRICTED-GAP-RESULT.md` | **MEASURED.** is the pure argmax already optimal on our boards? | `pureDuality = 0` on every board that produced a column, at all three readings — an exact pure saddle, so mixing buys zero — and NOT vacuous: 4–9 weight units of span with 3–5 distinct security values. Five of nine boards produce no columns at all. Retires the mixed-strategy direction; leaves the set-valued/Centaur direction standing alone. Corrects three of my own claims |
| `07-ANYTIME-STRUCTURE.md` | what does the search promise about being interrupted, and what does prefix determinism cost? | we have a *proved* recognizable-quality measure (`maxGap`) and have never plotted it against time — which is the missing input to every allocation question. Prefix determinism is maintained across six sites for one analysis the critic discounted; Law I says an invariant is addressed like a member |

`probes/restricted-gap.probe.ts` — the S0 measurement of doc 09. Drop into
`src/lobster/__tests__/` on `claude/cluster-lookahead` and run under the repo's
jest; it builds the restricted matrix from the real `BoundBank`'s witnesses and
real bounded resolutions, and prints the table in doc 09 §2.

`probes/accept-cycle.probe.ts` — drop into `src/lobster/__tests__/` on
`claude/cluster-lookahead` and run under the repo's jest. It imports the real
`posteriorOfBranch` / `foldObservation` / `precisionOfSigma` / `refutedAt` and
demonstrates the cycle in `05-SYNTHESIS.md` §2.1.

## What to build first

One item is a pure win with nothing to decide, and it should go first because the
member it fixes has not been seated yet:

0. bound the seed's sample count by the size of the space it samples, and return
   the unspent budget (S0½) — today a five-option group draws ~909 samples

Then seven instruments, **none of which change behaviour**, each answering a
question about our own boards from data we already hold:

1. ~~`restrictedGap`~~ — **DONE, doc 09.** The verdict is in: mixing buys exactly zero on the searched set. What remains worth shipping from S0 is `pureDuality` as a standing row (exact, solver-free) plus `colSupport` when it is nonzero, for W-1's column pruning
2. `maxGap` against elapsed time — the proved anytime quality axis nobody has plotted (S0¾)
3. `(family, cost, Δ maxGap)` per applied lever — is the metalevel's model right (S0⅞)
4. `proposedBy` — which of eight operators proposed the accepted trial (S1)
5. `planDistance(staged, nearestProposal)` — does the enumeration reach what we play (S2)
6. `adjudication.*Decided` split by contested-vs-quiet — does the floor go flat where it matters (S3)
7. round-robin vs odometer on slider boards, and accept-events per plan key (S4, S5)

Plus one fixture that costs nothing and prevents a future silent break:
a law-suite subject with a **set-valued position** (S2½).
