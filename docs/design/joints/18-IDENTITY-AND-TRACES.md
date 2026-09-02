# Three identities, not one — traces, edges, and the names that must not churn

Cycle 9 of the COMPOSITION lens. Reconciles the librarian's cycle-2 register
(`design/prior-art`) into the manifest and identity design. Three items, and the
third is a conceptual bug in what I had, not an addition to it.

---

## 1. R-1 — record what you READ, with hashes, or invalidation is narrow but never short

**Their finding.** Four independent sources converge: build-systems-à-la-carte's
**non-deep traces**, Salsa's backward flooding, KataGo's graph search, and Nix
RFC 062. All of them carry, in the record, the **hash of each value read** and
**the hash of the result** — not merely which inputs were consulted.

**What I had.** Declared read-sets (`Law D`) that name *which coordinates* a
comparator reads, and `behaviourId` (cycle 8, from Nix) as an
output-addressed identity over a canonical probe suite. That gives early cutoff
**at the bot level**: a re-fit that changes no decision on the probe suite keeps
its measurements.

**What they are right about.** Bot-level cutoff is too coarse for the two
mechanisms that need it most — the evaluation memo and the search map across
`advance`. Naming a coordinate says *what could invalidate*; hashing the value
read says *whether it actually did*. Without the hashes, invalidation is
**narrow but never short**: you correctly limit which entries are suspect, and
then you still recompute all of them.

**Adopted.** The declaration record gains value hashes:

```ts
interface TraceRecord {
  readonly reads: ReadonlyArray<{ readonly coordinate: string; readonly valueHash: string }>;
  readonly resultHash: string;
}
```

with the reuse rule stated as the literature does: **if every read's `valueHash`
matches, the result is reusable, whatever else changed.** That is what makes
`behaviourId` more than a coarse gate — it becomes the top of a hierarchy whose
lower levels are per-computation.

**The cost, and the boundary I draw.** Hashing every read on the hot path is not
free, and this codebase measures the evaluator at 45–64% of a decision's self
time. So traces are recorded **at the seams** — memo entries, worker results,
search-map entries, telemetry rows — and not per comparator call. That is the
same boundary `01 §6`'s falsifier already names, now with a reason rather than a
hedge: the seams are exactly where the four expensive defects lived, and they are
where a trace pays for itself by *avoiding* work rather than merely by catching a
bug.

---

## 2. R-2 — sharing breaks compositional accounting, so edges become first-class and one optimality claim is dropped

**Their finding.** Zilberstein's compilation results for anytime algorithms
assume a **tree**; our design shares sub-results by construction (memo
namespaces, one spend serving several hypotheses, a cluster evaluated once and
read by many plans). KataGo's transposition-freeze pathology is what silent
sharing costs: parents frozen while selection prefers the wrong child
indefinitely.

**Where it hits me.** ECONOMY's allocation law is *"partition of quanta over
purchasable and anticipatory meets"*. A partition is an accounting claim, and it
is **false under sharing**: a spend charged to one branch may benefit three, so
the partition either over-charges the payer or lets the free-riders look cheap.
Every allocation projection built on it inherits the error, and — worse — the
VOI comparison that decides the *next* spend reads those numbers.

**Adopted, in the form that keeps the DAG.** Two changes and one honest
subtraction:

1. **Edges are first-class.** A spend is credited to the **edge** (consumer →
   sub-result), not to the node. A shared sub-result carries the set of edges
   that consumed it; its cost is attributed across them by a declared credit
   rule (default: equal shares among consumers at the time of the spend, which
   is the only rule that needs no counterfactual).
2. **The allocation law is restated.** ECONOMY-allocation partitions **edge
   credits**, not node costs. Shares still sum to ≤ 1 of the budget; what
   changes is that the summands are edges.
3. **The dropped guarantee, stated rather than hidden.** Local compilation
   optimality (Zilberstein) does not transfer to a sharing DAG. We keep sharing
   — the memo is worth more than the theorem — and we record that the schedule
   is a heuristic over a DAG rather than an optimal compilation over a tree.
   This is exactly the standard I have been holding other lenses to: name the
   foregone guarantee at the point where you forgo it.

**And the pathology has a name here too.** KataGo's frozen parent is our
premise-blind memo: a shared evaluation reused across branches whose *frame*
differs. The fibration already forbids it (`06 §1.2`: the frame belongs in the
**per-branch** key, not the wholesale namespace) — R-2 is the same failure seen
from the accounting side rather than the soundness side, which is a good sign
for both.

---

## 3. C16 / C21 — the conceptual bug: content hashes and stable names obey opposite laws, and I was asking one object to do both

**Their finding, and it is the sharpest of the three.** Build-systems taxonomy:
`botId` is a **deep constructive trace** — the one strategy that provably cannot
early-cut. Nominal Adapton's thesis goes further: first-class **names must be
stable** across exactly the changes you want incrementality across, while
**content hashes must not be** — opposite laws. My `behaviourId` answers half
(equivalence for dedup); the other half has no object.

**Why this is a bug and not a gap.** I keyed the search map on
`⟨board, PremiseId⟩` and said it delivers the owner's re-entry ask. But the
whole point of `advance` is that **content changes while identity persists** —
"the same line, one turn later", "the same cluster", "the same commitment". A
content hash cannot express that, by construction. So the map as designed can
only ever match *exact* recurrences, which is precisely the population the TIME
lens told me is ≈ 0 across turns — and I accepted their correction about the
falsifier without noticing that it also indicted the key.

**The third identity.**

| object | law | used for | churns when |
|---|---|---|---|
| **content hash** (`botId`, `premiseId`, `valueHash`) | changes whenever content changes | dedup, memo keys, arm addressing, A/A pairing | any content change — *by design* |
| **behaviour hash** (`behaviourId`) | changes only when observable behaviour changes | early cutoff for measurement reuse | a decision changes on the probe suite |
| **stable name** (`Name`) | **does not change** across the revisions we want reuse across | attention carry, warm promotion, transport across `advance`, commitment identity, incumbency | the thing itself is gone |

A `Name` is *structural and content-free*: a line named by its cited units and
their relative plan rather than by the board it sat on; a cluster named by its
member set; a commitment named by its warrant target; an attention row named by
region-and-units. Under `advance`, names survive and hashes do not — which is
exactly the rebase-transfer design's own sentence (*"values are dropped;
identity, incumbency and attention are retained"*) with "identity" finally
having a type.

> **Law I (identity separation).** Content hashes and names are never
> interchanged. A cache keyed by name is a bug; a carry keyed by hash is a bug.
> Every carried object declares its name; every cached value declares its hash;
> the search map is keyed by **⟨name, trace hashes⟩** — the name finds the
> candidate, the hashes decide whether it is still valid.

That last clause is the reconciliation of all three items in one line: **names
find, hashes validate.** R-1 supplies the hashes, C21 supplies the names, and
the map that the owner asked for needs both — which is why keying it on either
alone produced either a map that never hits (hashes) or a map that lies (names).

---

## 4. What I refuse

- **I refuse to make names content-derived.** A name derived from content churns
  with content and stops being a name; the temptation will arrive the first time
  someone wants "a unique name" and reaches for a hash.
- **I refuse to make hashes stable.** A hash that survives a content change is a
  lie told to a cache, and it is the mechanism by which a stale value re-enters
  wearing a fresh identity.
- **I refuse names for values.** Only *computation sites* and *carried objects*
  get names — a line, a cluster, a commitment, an attention row. A value with a
  name is how a dead number crosses `advance` disguised as identity, which is
  the incumbency-laundering finding one level down.
- **I refuse to restore tree structure to recover Zilberstein's optimality.**
  Sharing is worth more than the theorem here, and the honest move is to record
  the loss, not to cripple the memo to keep a guarantee we do not need.
- **I refuse per-call trace hashing.** Seams only, until a measurement says the
  hot path can afford more.

---

## 5. What changes in the earlier documents

- `04-ADDRESSING.md`: three identity classes rather than two, with Law I; the
  arm address is unchanged (content hashes are right for arms).
- `05-ADVANCE-AND-COMMITMENTS.md` §5: the map is keyed `⟨name, trace hashes⟩`.
  The corrected falsifier (within-turn re-entry rate; cross-turn on decisions
  changed) survives and now has a mechanism that can actually hit across turns.
- `07-SYNTHESIS.md` §2: ECONOMY-allocation partitions **edge credits**; the
  dropped compilation-optimality claim is recorded beside it.
- `14-PRIOR-ART.md` §A: `behaviourId` is the middle of a three-level hierarchy,
  not the whole answer to Nix's early cutoff.
