# The commitment agent, the quantum, and the measurement story

Companion to `time-worldline.md` (the factorization) and
`time-worked-timeline.md` (the walkthrough). This document finishes the
three places where the factorization has to survive contact with the parts
of the kernel that are genuinely about obligation and honesty rather than
search: the agent's internals, the quantum's exact definition, and what the
harness and the ledger measure.

---

## 1. Inside the commitment agent

What stays, what moves, and the two subtleties.

**Stays in the agent, unchanged in content:** the five emit gates and their
refusal counters; the StickyStager and switch margins; the rate limit and
gap-improvement rule; the crossfade certificate; rung 0's contract (a
conforming legal plan before any refinement — now against a quanta
allowance instead of a wall span); the final-flush waiver set; the
staged-nothing guarantee; pin auditing (`pin-unreachable` narrowings);
`committedUnits`; the journal. All of it is obligation machinery — promises
to the wire and the operator — and none of it reads search internals beyond
the staging rows.

**Moves to the worldline:** the plans table and beliefs (they are derived
state keyed by ReadSets); the depth surface drain; the VOC orchestrator and
refinement views (they choose WORK, and work is the worldline's); the
session lifecycle (dissolved into hypothesis value-stores); slice-cost
estimation (the exchange rate's fit); the pin-context cache (dissolved into
the hypothesis table).

**Subtlety 1 — the ratchet basis.** Today a basis is (epoch, posture),
where an epoch is a pin-set change. Under the factorization the agent's
basis becomes (promotion generation, posture): a counter the agent bumps
whenever `observe()` reports a kill-or-promote that touched its staging
rows. Same discipline — one live `RatchetBasis`, `newBasis()` replaces it,
no cross-basis map — same code, different bump source. The wire plan
(`run.wirePlan`) stays agent-owned and survives basis changes exactly as
today (the splice-not-rebuild rule).

**Subtlety 2 — the posture governor sits on the seam, and splits.** A
posture is a regime classification of the belief state (support saturated?
floors separating? — the epistemics doc's reading), so its MEASUREMENT
belongs to the worldline; but its CONSEQUENCE is a staging-channel policy
(order by lo vs est) and a basis change, which belong to the agent. Split
accordingly: worldline publishes `PostureConditions` per tranche; the agent
owns the governor, the flip, and the same-evaluator re-measure rule. This
is one honest new seam, and it is the same seam `measure()`
(kernel.ts:1815-1844) already straddles today by reading `lastView`.

**Reaction table (the declared half of event handling, §5 of the main
doc):** per determination source, one of `conform-now` (operator commit,
resolution while attached), `next-tranche` (unpin, tentative pin, dial),
`next-commitment` (goto). p99 time-to-conform per source is the gate
(interruption §3.3), and the operator-latency bound caps tranche size.

---

## 2. The quantum, defined honestly

**One quantum = one resolution-equivalent**, `refinementCost`'s existing
currency (one bounded joint-plan resolution; levers already priced in it;
scout purse already spends it). The bank's B-ladder prices, the repair
loops, the enumeration's per-cluster passes all meter naturally in it
(prices count their resolutions today for the memo stats).

**Where wall-clock nondeterminism goes — the crisp claim.** Today the wall
clock cuts INSIDE work: `budget.shouldStop()` inside a price ladder decides
which rung a price reaches, so box load changes the CONTENT of a slice —
that is the 178/177/178 slice-count family, unlocalizable by construction.
Under the counting cut, tranche content is a pure function of (seeds,
frontier, grant). Wall time influences exactly one thing: HOW MANY grants
the agent issues before its deadline — an integer sequence, logged. All
nondeterminism is squeezed into the one dimension the ledger records.
Replay = replay the grants. That is why Tier-B replay (byte-identical
reports) becomes reachable without ever localizing the old mystery: the
mechanism that produced it is removed, not explained.

**The two honest wall-side residues, kept wall-side on purpose:**

1. **The final-flush reserve.** The agent's promise "something legal is on
   the wire at the deadline" must be true in WALL time, so the agent keeps
   a wall-read guard for its last grant and the flush. This affects grant
   count only — already in the ledger.
2. **Overshoot risk.** A tranche granted N quanta can cost more wall time
   than the fit predicted (contention; a queen-board price spike). Bounds:
   the grant is capped at `latencyCapQuanta()` (the operator bound through
   the fitted rate, with a safety factor — today's `stepSafetyFactor`
   translated), the fit updates on every observed tranche (rises taken
   whole, falls slowly — today's EWMA), and the conformance p99 gate
   measures the result. This is the same exposure today's adaptive slice
   has; it does not get worse, it gets measured in one place.

**The worker pool fits without change of law.** A parcel is a delegated
spend: workers already check `epochLives(parcel.boardEpoch)` between plans
against a shared table the coordinator publishes atomically, keep partial
results, and let the coordinator drop them by epoch. Under the worldline the
published integer becomes the FRONTIER GENERATION (bumped by `observe`), and
"drop by epoch" becomes the same citation pass everything else takes — a
returned evaluation is a completed evaluation of a named world and survives
iff its coords do. Parcels are metered in quanta like any spend; the pool's
existing memo-counter handoff (`noteSession` before release) becomes a
ledger row.

**Prior-art additions to the grant policy** (`time-prior-art.md` §1, §4):
a tranche is a CONTRACT in the anytime-literature sense, and tranche-based
interruptibility carries the classical bounded constant-factor penalty —
the theoretical license for atomicity. Two new ECONOMY rows with engine
precedent: carried-quanta anticipation (Stockfish raises per-move optimum
time 25% when pondering is on — grants may anticipate the window's
subsidy, never rely on it), and instability extension (best-move-flip
telemetry extends the soft grant, bounded by the deadline — the
StickyStager's flip counter is the signal, and Hansen–Zilberstein's
costly-monitoring result says to sweep tranche size as the one axis this
trades on).

**The event-loop yield** stays wall-scheduled (Firestore listeners must
run), INSIDE tranches, and affects only when determinations enter the
queue — which replay takes from logged positions, not from yield timing.

---

## 3. What the harness becomes

`match.ts`'s sequential `await bot.decide(...)` loop is replaced by a
worldline driver per seat:

1. per-seat worldline persists across the game (the object under test IS
   the cross-turn behavior);
2. each turn: attach agent, issue grants from a VIRTUAL exchange rate
   (quanta directly — no wall clock in the loop at all; `msObserved`
   synthesized), deliver scripted determinations at logical positions
   (event track, `eventTrackHash` in the header);
3. between a seat's commit and `resolveFullTurn`: ponder grants per the
   arm's window policy (fixed; or sampled from a recorded live-window
   distribution — the arm says which, the ledger records what);
4. replay rows: the WorldlineLedger verbatim (`{"kind":"grant"}`,
   `{"kind":"determination"}`), additive JSONL;
5. a SYNC-TEST mode (GGPO's backend, our vocabulary): every decision run
   twice from the same ledger, reports byte-compared — the standing
   tripwire that the ledger captures all nondeterminism, cheaper and
   stricter than the cross-build gate for this machinery.

**Denominators (the DILEMMA-4 accounting, restated as the proposal to the
owner):** per-turn metrics denominate over grants with `targetTurn = N`.
`carriedQuanta(N)` = ponder grants targeting N — a new first-class column.
Arms differing in ponder policy are compared twice, and the manifest names
both: at equal refine-quanta (today's question: what does the turn budget
buy) and at equal total-quanta (the new question: what does the compute
buy). A/A floors are re-established under the ledger before any
cross-policy claim — the floors are expected to TIGHTEN, since ledger-cut
work removes the box-load term batch 2 measured (the ×17.76 null-snake6
wall-floor widening).

**Engagement discipline (ruling: authored-but-unplayed is failure):** every
increment's acceptance is a played game with a ledger row proving the new
path fired — `promoted > 0` on the carry test, `phase=ponder` grants > 0 on
the window test, `killed` bounded on the commit test. The miner refuses
unknown schemas rather than defaulting zero (the depth-idle lesson, already
pinned).

---

## 4. The compute-sequencing joint, mapped onto D8

The mandate asks that per-decision compute sequencing become a first-class,
tunable joint. Under the factorization it is FOUR small policies, each a
BotConfig value (lane a), none a flag:

| policy | owner | today's fragments it unifies |
|---|---|---|
| tranche sizing | exchange rate + agent cap | sliceMs, sliceCostFactor, maxSliceFraction, rungZeroFraction |
| allowance split across phases | worldline scheduler | tithe/reserve (scout), speculativePeriod (kernel), window policy (unbuilt) |
| hypothesis market | worldline scheduler | ponder targeting order, speculative-context choice, thread seeding order, focus narrowing (ruling 41: promotion events modulate tithe/depth within the reserve floor), D2 weights when the socket fills |
| reaction table | agent | epoch-now vs next-slice vs next-decision, dial latency (§7 main doc) |

D8's dof-synthesis rows land exactly: budget split = rows 1–2; escalation
triggers = market weight modulation; anytime re-staging cadence = agent
gates (unchanged); commit timing = agent policy; per-enemy exact-modeling
set = hypothesis granularity (which rival clusters get enumerated
hypotheses vs cloud treatment). The depth-effect rate keeps its meaning
(refine-phase, targetTurn=N), and gains siblings: carryEffectRate,
ponderReadAfterRebase, promotion rate — all mineable from the ledger.

---

## 5. The deletion ledger (what the factorization removes)

Per docs/REFACTORING.md, the license is deletion, and a factorization that
only adds modules has failed the mandate. Merged endstate deletes:

- the session map + `sessionKey` + the two-entry LRU and its thrash
  guards (hypothesis stores subsume);
- the speculative-context special path in `pickContext` (a market row);
- the turn-keyed `live` handle and its race documentation (agents route by
  turn on one worldline);
- `abandoned()` plumbing and the `latestTurn` guard (frontier-completion
  detach);
- the wall-cut slice apparatus: `SliceBudget`'s dual-deadline shape,
  `observeSliceCost`'s per-entry EWMA (one fit in the exchange rate),
  the stall rail (a counting loop cannot stall);
- `idleSlices` (they are ponder grants now);
- the scout's private purse conversion (`msPerResolution` moves to the
  exchange rate; the purse spends grants);
- the carry-store, ponder-session, and event-track designs as SEPARATE
  mechanisms (they become rows of the two primitives — this deletes
  design-space complexity before it is ever built, which is the cheapest
  deletion there is).

What is deliberately NOT deleted: the bank and its laws, the door, the
cloud engine, the emit gates, the pin ledger, the belief fold — the
factorization re-keys and re-homes them; their content is untouched.

---

## 6. Falsifiers, stated before building

1. If citation-scoped commit invalidation does NOT recover most of the
   343 ms (i.e. the toll is dominated by something other than re-derivation
   of untouched clusters), the worldline's central economy is wrong —
   increment 1 measures this before anything cross-turn exists.
2. If the counting cut's A/A floors do not tighten relative to wall-cut
   floors on a loaded box, the "content purity" claim is empty — increment
   2's gate.
3. If promoted-hypothesis warm starts do not beat the carry-store's
   scalar-prior bridge on the two-turn acceptance games (time-to-refutation
   at N+1), the hypothesis table should shrink to the carry rows and the
   ponder design reverts to rebase-transfer §6 as written.
4. If tranche overshoot p99 exceeds today's slice overshoot p99 at equal
   latency caps, the quanta fit is too coarse for piece boards and the
   tranche needs a mid-tranche wall check — which reintroduces content
   nondeterminism and must be recorded as a design retreat, not silently.
