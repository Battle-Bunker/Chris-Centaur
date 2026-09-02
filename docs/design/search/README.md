# SEARCH-THEORY lens

The search algorithm itself: how joint moves are proposed, how the
simultaneous-move structure is handled game-theoretically, how clusters
decompose the board, how deep lines are explored and backed up. The four
earlier lenses carved time/economy, belief/fog, value and composition; none of
them owned this.

**Start at `05-SYNTHESIS.md`.** It is standalone. Its §7 is the owner-facing
summary (piped through `tools/principal-glossary/check-briefing.js` on
`claude/cluster-lookahead`: 0 blocking, 0 owed, exit 0).

| doc | question | headline |
|---|---|---|
| `00-WHAT-THIS-SEARCH-IS.md` | what is our search, in the literature's terms? | pure maximin over a factored row space by better-response dynamics on a floor, with the column-generation half of a double oracle and no mixed solve. The acceptance relation admits a 3-cycle once depth speaks — demonstrated against the shipped arithmetic |
| `01-REDUCTION.md` | is the solution concept a plug-in member? | three axes, not one: ambiguity (calibration) × reading (correctness) × arity (point vs set). Law R1: every member is a lower prevision. Γ-maximin makes compute invisible in the output |
| `02-DECOMPOSITION.md` | when is the factorization sound; should boundaries be searched? | Law D1: generate only, never value. Boundaries ARE searched today — at depth, where it is least useful. Four sub-joints, three at their null member |
| `03-PROPOSAL.md` | what does the literature say about basin coverage? | eight operators, nine constants, no socket, no record. Law P1: restrictions must be adaptive on value or bounded. The missing operator is an ejection chain |
| `04-BACKUP.md` | how does our max-min backup compare to the standard rules? | implicit-minimax-backups shaped with a strictly better combiner. A floor folded into a mean slot, over an odometer prefix that collapses on slider boards |

`probes/accept-cycle.probe.ts` — drop into `src/lobster/__tests__/` on
`claude/cluster-lookahead` and run under the repo's jest. It imports the real
`posteriorOfBranch` / `foldObservation` / `precisionOfSigma` / `refutedAt` and
demonstrates the cycle in `05-SYNTHESIS.md` §2.1.

## The six things to build first, none of which change behaviour

1. `restrictedGap` — the value of the matrix the bank already holds (S0)
2. `proposedBy` — which of eight operators proposed the accepted trial (S1)
3. `planDistance(staged, nearestProposal)` — does the enumeration reach what we play (S2)
4. `adjudication.*Decided` split by contested-vs-quiet — does the floor go flat where it matters (S3)
5. round-robin vs odometer on slider boards — is the deep max scanning one coordinate (S4)
6. accept-events per plan key inside one `improve` — is the cycle realised (S5)
