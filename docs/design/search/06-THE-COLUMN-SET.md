# 06 — The column set: the half of the double oracle we did build

SEARCH-THEORY lens, document 6. Doc 00 §2.1 established that `bounds/bank.ts`
runs the **column-generation half of a double oracle** and skips the mixed solve.
This document is about the column set itself — how it grows, what it costs, what
we throw away, and the exact specification of the `restrictedGap` instrument
(increment S0), which is the highest information-per-millisecond item this lens
found.

Everything here is read off `bounds/bank.ts`, `bounds/witness.ts`,
`search/core.ts::speculate` and `parallel/{protocol,worker-entry}.ts`.

---

## 1. What a witness is, and why the law that keeps it sound is the right law

`witness.ts`'s header is correct and worth quoting because the rest of this
document depends on it:

> A witness is a CONCRETE opponent joint reply that was found to punish some
> plan. Because the security value is a minimum over every reply, a witness's
> value is an UPPER bound certificate: `SV(a) ≤ V(a, w)` for every witness `w`,
> whatever plan `a` is. That is why a witness found while examining one plan is
> still meaningful against another, why the set survives restarts and pin-context
> switches, and why it is the cheapest possible memory a search can carry between
> corners.
>
> THE LAW: the ascent may not choose a plan a witness refutes without the witness
> being RE-PRICED against that plan. Refutation is not a property of the witness —
> it is a property of the (plan, witness) pair, and reusing a verdict computed
> against a different plan is how a double oracle silently turns into a restricted
> game it has forgotten it restricted.

That law is exactly right and nothing below proposes relaxing it. What follows
are consequences of it that nobody has priced.

**Where columns come from.** `closeGroup` banks the minimiser of every B1 and B3
group:

```ts
let worstLeaf = leaves[0]
for (const leaf of leaves) if (leaf.bounds.worst < worstLeaf.bounds.worst) worstLeaf = leaf
if (worstLeaf.replies !== null) this.addWitness({ replies: worstLeaf.replies, note: … })
```

So a column is generated exactly when an enumerated group is closed — the
opponent's best response *within that group*, against that row. That is textbook
column generation, restricted to the group's scope.

## 2. The matrix is already computed, cell by cell, and discarded

The B2 rung, verbatim:

```ts
if (cfg.b2 && this.witnessList.length > 0) {
  for (const witness of this.witnessList) {
    …
    const branch = this.priceBranch(view, withMoves(base, [...witness.replies.values()]), "B2", …)
    ceilingBranches.push(branch)
    members.push({ rung: "B2", …, complete: false, floor: null, ceiling: branch.bounds.best })
  }
}
```

For **every plan the search prices**, the bank resolves it against **every banked
witness** and computes a full `ScoreBounds` — then keeps `bounds.best`, feeds it
into a `min`, and drops the rest.

> **That is one complete row of the restricted payoff matrix, computed in full
> and reduced to its row-minimum on the spot.**

Retaining the row costs one number per cell. On the measured 23×23 three-team
board a ten-second decision priced **152 distinct plans**; the witness set is
whatever distinct replies accumulated. A 152 × 50 matrix of doubles is 60 KB.
**Zero additional resolutions.**

The standard objection to "solve the matrix game" — that it costs simulations we
cannot afford — simply does not apply. The simulations are already spent. What
we have never done is keep the numbers.

## 3. Finding W-1: `price()` gets monotonically more expensive within a decision

`WitnessSet` and the bank's `witnessList` have **no capacity and no eviction
policy**. Witnesses are de-duplicated by key, carried across restarts and pin
contexts by `adoptWitnesses` (deliberately, and rightly — that is what makes them
memory), and never removed for the life of the decision.

The B2 loop is therefore `O(|witnesses|)` resolutions **per priced plan**:

> **Finding W-1.** The cost of one `price()` grows linearly in the number of
> distinct opponent replies the decision has discovered so far. A decision that
> prices 152 plans does not price them at 152 equal costs; the last costs
> materially more than the first, and the growth is unbounded and unmeasured.

Three consequences.

**(a) It is a latency drift with a compute cause — a TIME-lens item.**
`kernel.drive` sizes each slice from `entry.stepCostMs * sliceCostFactor`, a
*measured* cost. If that cost drifts upward through the turn, slices get longer
late in the decision for a reason that has nothing to do with the board. Events
are drained **between** slices and never inside one, so the operator-pin latency
worsens through the turn. The time lens's operator-latency cap is stated in
milliseconds against a quantity that moves under it.

The comment that sizes the slice already knows the phenomenon exists —
*"at production team sizes one bank `price()` is most of a 25 ms slice"* — but
attributes it to roster size, which is constant within a decision. Witness count
is not.

**(b) A real double oracle prunes columns; we never do.** The standard algorithm
solves the restricted game and drops columns outside the equilibrium support.
We keep every column for the decision's life. **Solving the matrix produces that
support as a by-product**, so the instrument that measures the pure-vs-mixed gap
is also the thing that lets the bank shed columns. The diagnostic pays for
itself in the same LP.

Note carefully *why* this pruning is sound where reusing a verdict is not. The
witness law forbids reusing a refutation computed against a different plan. It
does not forbid **not asking a question the opponent's best mixture would never
pose**. A column outside the equilibrium support is one the opponent's optimal
mixed reply plays with probability zero; dropping it changes the restricted
game's value not at all, by the LP's own complementary slackness. Any pruning
rule that is not "outside the support" — least-recently-effective, oldest,
weakest ceiling — *is* the forbidden kind, because it drops a column that might
have been the minimiser for a row not yet priced.

**(c) A cheap intermediate exists if the LP is judged too much.** Cap the set and
evict by a *sound* rule: a witness whose ceiling has been strictly above every
priced row's floor for the last `k` rows cannot have vetoed anything. That is
weaker than support-based pruning and still not "least recently used".

## 4. Finding W-2: the parallel seam ships columns down and never brings any back

`search/core.ts::speculate`:

```ts
// THE WITNESS SET GOES DOWN WITH THE PARCEL, and it is what makes the parcel
// worth sending. … Nothing comes back the other way — see `WitnessWire`.
const witnesses = s.bank.witnesses.map(w => ({ note: w.note, replies: [...w.replies.values()] }))
```

`parallel/worker-entry.ts`:

```ts
// The coordinator's witnesses, so this worker's B2 rung prices the same
// branches the coordinator's will. Deduplicated and additive inside the bank;
// nothing goes back the other way. See `WitnessWire`.
session.bank.adoptWitnesses(…)
```

A worker prices rows the coordinator has not reached. Its bank runs B1/B3 and
`closeGroup` banks **new minimisers** — real opponent replies that punish plans
the coordinator has never seen. Those columns die with the parcel.

> **Finding W-2.** In a double oracle, column generation is the half that
> transfers: a witness is an upper-bound certificate against **every** plan, by
> the law quoted in §1. We parallelise the *row* side and discard the *column*
> side, which is the wrong way round for the only artifact that is
> plan-independent.

The return channel would be tiny — a witness is a handful of
`(unitId, to, path)` tuples — and its effect is free pruning: more columns means
lower ceilings on the coordinator's side, which means `refutedAt` retires more
trials permanently.

**The counter-argument, stated fairly, because it is almost certainly the real
reason for the one-way rule.** Adding a witness changes the B2 set, which changes
what every subsequent `price()` computes. A witness arriving at a
worker-determined time would make the coordinator's decision depend on worker
timing, destroying the property this subsystem works hardest for:

> *"the dispatch sequence is decided by the seeded sampler on the coordinator
> BEFORE any worker runs, and is a pure function of (seed, board, epoch, slice),
> never of worker timing."*

That is a good reason and the rule is defensible. But **the determinism cost is
avoidable by the discipline the evaluation channel already uses.** `foldParallel`
brackets the slice and folds returned evaluations at a deterministic point in a
deterministic order. Returned witnesses can be folded the same way: buffered,
sorted by `witnessKey`, and adopted **at a slice boundary** (or at the start of
the next epoch), so the coordinator's witness set at slice `n` is a function of
which parcels had *completed* by slice `n` — still timing-dependent — or, for
strict determinism, at the *epoch* boundary, where the basis is being rebuilt
anyway and nothing is comparable across it.

> **So the one-way rule is a determinism decision, not a value decision**, and
> the two are separable with machinery that already exists. Whether it is worth
> separating depends on how many distinct columns workers actually find, which
> is one counter on the parcel result.

## 5. Increment S0, specified

The instrument, in enough detail to build.

**Collect.** In `price()`, alongside `ceilingBranches.push(branch)` in the B2
loop, record `(planKey, witnessKey, branch.bounds.worst, branch.bounds.best)`
into a per-decision table. B1/B3 leaves also carry `replies`, so they are cells
too and should be recorded on the same terms — they are the columns that were
generated *this* row, and including them makes the matrix denser at no cost.

**Constraints, from the basis discipline.**

- **One basis per matrix.** Cells whose `bounds.assumptions` differ by
  `basisKeyOf` are not two answers to one question. Partition the table by basis
  key and solve each partition separately; a decision that changed epoch mid-way
  produces two matrices, which is correct and is what `run.basisHistory` already
  records.
- **Use the `worst` endpoint for both readings.** `V_pure` and `V_mixed` must be
  computed on the *same* entries or their difference measures nothing. `worst`
  makes every cell a sound floor at that reply.
- **The matrix is ragged.** Not every plan meets every witness (a plan priced
  before a witness existed has no cell for it). Two honest options: restrict to
  the complete sub-matrix of plans priced after the last witness arrived
  (smaller, exact), or impute the missing cell with that plan's B0 floor (a
  sound lower bound on the cell, so `V_mixed` computed with it is a lower bound
  on the true restricted mixed value — conservative in the direction that
  matters, since it *understates* the gap). Prefer the second; report which was
  used.

**Solve.** Regret matching⁺ (Tammelin 2014) for a fixed iteration count — 500 is
generous at these sizes and is a few hundred microseconds of scalar arithmetic
on a 152 × 50 matrix. No LP solver dependency, no external library (the CDN and
dependency constraints of this program make that a real consideration), about
forty lines. Alternating updates with linear averaging converge fast enough that
the residual is far below the weight-unit resolution we care about.

**Emit, on the mechanism report.**

| field | meaning |
|---|---|
| `restrictedRows`, `restrictedCols` | matrix shape — also the first honest measure of the double oracle's actual scale |
| `vPure` | `max_i min_j M[i,j]` on the recorded cells |
| `vMixed` | value of the same matrix as a mixed game |
| `restrictedGap` | `vMixed − vPure`, in weight units |
| `rowSupport`, `colSupport` | support sizes of the two equilibrium mixtures. `colSupport ≪ restrictedCols` is the pruning opportunity of §3(b); `rowSupport = 1` means the pure argmax *was* optimal on this board and there is nothing to buy |
| `imputed` | fraction of cells filled by the B0 floor |
| `bases` | number of basis partitions the decision produced |

**How to read it, stated carefully so nobody over-claims.** `V_mixed` on the
*restricted* matrix is neither an upper nor a lower bound on the true game's
value: adding rows raises it, adding columns lowers it. It is a
**within-the-searched-set** measurement of how much structure the pure reduction
discards. Reporting it as "how much we are losing" would be the laundering the
basis discipline exists to prevent. Report it as what it is, and read the
distribution rather than the mean:

- `rowSupport = 1` on most decisions ⇒ the pure argmax is already optimal on our
  boards; **the whole mixed/equilibrium direction is retired on evidence**, at a
  cost of one afternoon and zero games. That is the Ruling-49-compliant way to
  close a direction, and it is a real possible outcome.
- `restrictedGap` of several weight units on contested boards ⇒ the passivity
  verdict has a price tag, denominated in the same units as a unit's life, and
  the equilibrium reading (doc 01 §4) is worth its cost.
- `colSupport ≪ restrictedCols` ⇒ Finding W-1's pruning is available regardless
  of what the gap says, which means S0 is worth building even if the answer to
  the gap question is "nothing to see".

That last line is the argument for building it first: **three of the four things
it measures are useful whatever the others say.**
