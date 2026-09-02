# What this design claims, how each claim is held, and what would refute it

Cycle 14 close. Thirty-four documents make a lot of assertions, and they are not
all the same kind of thing. This separates them into **measured**, **verified
against source**, and **assumed** — and gives each assumed one the cheapest
thing that would refute it. A design adopted on authority is a design nobody can
check.

---

## 1. Measured

| claim | number | measured by | window / caveat |
|---|---|---|---|
| kinds capture co-change | **3.10×** within over cross (weighted, sweeps excluded) | this lens, `29` | ~10 days of `src/lobster` history; re-run condition recorded |
| ACTION is not a module at any grain | 7% self-share; `A:order` busy (weighted touch 5.01) with internal pairs only inside large commits | this lens, `29` | the other three sub-modules are too quiet to judge, and are reported as such |
| the per-unit cap binds on sliders only | **100% / 0%**; queen mean 64.4 options against a cap of 4 | value lens, `23` | |
| the discarded set is the *most differentiated* | slider room-spread 21.6–23.7 vs snakes' 6.5–7.1 | value lens, `23` | |
| plans priced then refused at emission | **15–43%** | value lens, `23` | the largest single waste finding in the programme |
| the potion term's support is rare | a potion at a legal destination on **8.17%** of unit-decisions | value lens, `23` | ~92% of that null is a zero no weight can scale |
| the interior fold is complete; the residual is at the boundary | 0.00% attribution gap; game-length dependence **+0.969** in the residual | value lens, `16` | |
| four reduction/ratchet mechanisms never fire | **0 in 192 games** | value lens, `23` | Law R's first exhibit |
| the declared config space is largely unexercised | **6 of 41** coordinates set in an emitted spec; 13 of 41 named anywhere; **28 never named outside their own definition** | this lens, `36` | counts the recorded corpus, not command-line arms nobody wrote down |
| the validator key-checks one of three nested objects | **30 of 42 leaves (71%)** accept an arbitrary key and an arbitrary type | this lens, `36` | run against the shipped `botConfigFromJson`, not read |

## 2. Verified against source (not measured — read)

| claim | where |
|---|---|
| the joint list is enumerated five times | `SlotId`, `BotConfig`, `botConfigFromJson`, `BotStamp`, `promotion-ledger.json` |
| the adjudication rule exists three times and has disagreed three ways | server / harness / bot, with the harness's own comment recording its repair |
| a **pinned sacrifice already plays today** | `matchPin` resolves against `set.prunedLedger`; the bot never unpins |
| commit status is public, a commit is irrevocable, and the turn ends when the last player commits | `firestore.rules` (`moveStatuses` world-readable), `MoveStatus.movedPlayerIDs`, `!hasCommittedForTurn` |
| the bot has **no production binding site** | `firebaseInterfaceConfigFromEnv` never sets `bot` |
| six of seven excluded engine phases are deterministic | read phase by phase against `TeamSnekProcessor.applyMoves` |
| `tier` is an input-only field, so a window cannot advance in the model | `ResolveUnit.tier` in, nothing out |
| both reduced-product operands ship | `grammar.ts` `colourBound`; `bank.ts`'s "parity-exact" argument |
| a `no-restricted-imports` ban exists and **does not fire** | shadowed by a later flat-config block; recorded, still open |
| `colourBound` (bishop-only exact narrowing) has **never run in a measured game** | bishop appears in 0 batch specs; Law R's runtime clause would flag it |
| the slate socket's alternative has **never been in an arm** | `slate` appears in zero specs and zero kit files; `'potion-aware'` is referenced only by the registry that defines it and its own tests |
| the ledger contradicts the code on whether `clusterEnum` is selectable | ledger row says "NOT SELECTABLE… a hard error"; `botConfigFromJson` accepts `search.clusterEnum` — verified by execution |
| the ledger records a coordinate `BotConfig` does not contain | row `TERRITORY_SLIDER_PROFILE` names `TeamDecisionOptions.evaluate` — the second channel found in cycle 2 |
| an arm's treatment is prose, and the tutorial is the same syntax | `bot={"territoryRefine":true}` occurs in four batch-2 specs: the arm in one, the copy-pasted instruction example in three |

## 3. Assumed — and what would refute each

These are the load-bearing claims with no evidence behind them yet. They are the
ones to attack.

| assumption | refuted by | cost of the test |
|---|---|---|
| **the manifest reduces drift** — the central claim of the whole design | after B2, count the enumerations again: if generated artifacts drift from each other, or a sixth enumeration appears within two months, the generation story is wrong | free (a re-audit) |
| **the generator does not introduce a worse failure than it removes** | the independent oracle (`20 §3`) firing on a manifest-caused mismatch that the old duplicated-copies world would have caught earlier | free once the oracle exists — and if it never fires in six months, the oracle itself is the untested thing |
| **`behaviourId` retains measurements across refactors** | a refactor that leaves every decision identical on the probe suite but whose `behaviourId` moves — i.e. the probe suite is too sensitive; or one that changes decisions the suite does not see — too coarse | one probe-suite run per refactor |
| **Law T pays more than it costs** (tightening is the asset, refusal the tax) | count, over a decision: pairs tightened vs comparisons refused. If refusals dominate by an order of magnitude the index is a tax with a rebate | a counter, no batch |
| **the reduced product fires** | instrument `reduceProduct` for a week: if the congruence entry never narrows a live interval, the operands ship but never meet, and the table is dead weight. **Partly settled already**: bishop counts **0** across every batch spec (snake 392, king 121, pawn 85, queen 71, knight 50, rook 32), so the *spatial* congruence's operand is absent from the corpus and the live entry must be **trail-unit step parity** | a counter; the roster half was a grep |
| **the entry floor is worth paying** | unmeasurable honestly; the proxy is time-to-first-correct-change for a contributor who has not read the design. If it exceeds the current tree's, the laws have not paid for themselves | one observation per new contributor |
| **kinds stay stable while modules churn** (the Parnas bet) | re-run the DSM after three months of the new architecture: if the *kind* boundaries move too, the carve was following the work programme rather than the domain | free (a re-mine) |
| **scoped contributions are identifiable at arity 2** | fit one pair term and check the design's rank: if every corpus is rank-deficient at 36 parameters, the arity cap is 1 in practice and the scope machinery is ceremony | one fit |
| **the attention currency is non-fungible in practice** | an operator who wants the bot to spend more compute rather than ask them, or vice versa, with no way to express it. If the refusal to price the exchange makes the surface unusable, the ban is wrong | first live Centaur session |

## 4. Claims I have already withdrawn

Kept visible, because a design that hides its corrections cannot be trusted with
the ones it has not made yet:

| withdrawn | why | cycle |
|---|---|---|
| "admission dominates valuation, structurally" | it is board-conditional — sliders only | 9 |
| "the potion weight null and the ordering win are one fact" | on snake boards the cap never binds; the win is joint-level, not per-unit | 13 |
| "MODEL is the most cohesive kind" | it was bulk fix-round commits; 30% → 6% under weighting | 13 |
| "ACTION splits into four modules" | every sub-module still reads as a bus; it distributes | 13 |
| "one ε everywhere is a theorem of totality" | rectangularity: recursive blending compounds to (1−ε)^d | 13 |
| "the composition law is a free member param" → then → "addition is the law" | both too strong: the law is a **declared scalarization** with a member family, and the second narrowing held only in a regime we are not in | 12, 12 |
| "a plan that cannot be emitted is not admitted and not priced" | destroys accumulation, and sites an ECONOMY constraint in the ACTION closure | 13 |
| "the emission obligation is a premise coordinate" | fails C59; experiment scale already carries it as `regime` | 13 |
| "horizon is the only coordinate without tightening" | `measure.weight` is the second, for a different reason | 14 |
| "Condition 4 (identifiability) binds every scope term" | cold-start censorship — it binds the **fitted** class only | 11 |

Ten withdrawals in six cycles, every one from a lens or a measurement rather
than from re-reading my own text — which is the strongest argument in this
document for the review structure, and the weakest for solo design.

---

## 5. The one claim I cannot test and would most like to

**That the six kinds are the domain's joints rather than this programme's.**
The DSM tests whether they match *our* churn; nothing tests whether a different
team building a different bot for this game would find the same six. The nearest
available evidence is that four of the six were reached independently by other
lenses under other names — and that is suggestive, not decisive, because we all
read the same tree.

The honest position: **the kinds are a good carve of this game as this programme
understands it**, and the manifest is designed so that being wrong about one of
them costs a row rather than a rewrite. That is the property to defend if the
carve turns out to be parochial.
