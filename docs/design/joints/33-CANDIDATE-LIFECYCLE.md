# The candidate set, given an owner — the missing abstraction, specified

Cycle 14. `29 §2` named the abstraction the co-change data implies: **the
candidate set has no owner.** Its lifecycle runs across six modules and nothing
sees the whole pipeline, which is why admission turned out to operate at three
granularities nobody had enumerated and why 15–43% of every plan priced is
refused at the far end. This specifies the owner.

---

## 1. The evidence that this is one object

Three independent findings, each of which is a symptom of the same absence:

| finding | what it shows |
|---|---|
| admission operates at **three granularities** (per unit, per cluster joint, per emission) that nobody had enumerated until they were measured (`23 §2`) | no reader had all three in view, because no module holds them |
| **15–43% of priced plans are refused at emission** (`23 §3`) | a lifecycle whose last stage is invisible to its first |
| **ACTION has 7% self-share** and its split does not rescue it; `A:order` is busy and its internal pairs appear only in large commits (`29 §2`) | the stages do not co-change with each other — they co-change with their *consumers* |

The third is the one that says *owner*, not *module*: these stages belong with
their consumers, so the object that unifies them is a **value that flows
through** them, not a package that contains them.

---

## 2. The object

```ts
/** The candidate set at one stage of its life, carrying what happened to it.
 *  It is a VALUE that flows; the stages stay where they are. */
interface CandidateSet {
  readonly scope: UnitId | ClusterId
  readonly options: ReadonlyArray<Candidate>

  /** THE ADMISSION TRACE — the coordinate `12 §D6` demands, now produced by
   *  the object that knows it rather than reconstructed by a miner. */
  readonly trace: {
    readonly generated: number
    readonly closed: ReadonlyArray<{ by: MemberId; removed: number; lossy: boolean }>
    readonly ordered: { by: MemberId; law: 'lexicographic' | 'additive' }
    readonly truncated: { cap: number; dropped: number; spread: number } | null
    readonly sampled: { width: number; drawn: number } | null
  }

  /** The premise coordinates this set's contents depend on — so a downstream
   *  value can declare the set it was chosen from (`30 §4`). */
  readonly at: PremiseRef
}
```

Two properties make it worth having, and neither is "tidiness":

1. **The admission trace is produced, not reconstructed.** Today the only way to
   know where truncation occurred is to mine it; `23` had to measure the cap's
   binding rate to discover it was slider-specific. As a field on the object it
   is a **declared coordinate at both scales** — decision-scale for
   comparability, experiment-scale so a miner cannot pool across two coverage
   shapes (`26 §5`).
2. **`truncated.spread` is the diagnostic that was missing.** The measurement
   that mattered most in `23` — *the discarded set is the most differentiated
   one* — is a property of the cut, computable at the cut, and currently
   computable nowhere. Recording the spread of the dropped options at the moment
   they are dropped turns the sharpest finding of that cycle into a standing
   column.

## 3. The stages stay where they are

The lifecycle is `generate → close → order → truncate → sample → admit → emit`,
and the co-change data says the stages belong to their consumers. So the owner
is not a new module; it is a **discipline on one value**:

| stage | stays in | what changes |
|---|---|---|
| generate | `candidates.ts` | returns a `CandidateSet`, not an array |
| close | `fatality.ts`, `staging-safety.ts` | each closure appends to `trace.closed` with its member id and whether it was lossy |
| order | `search/order.ts` | records the law it used (`28`'s scalarization member) |
| truncate | `search/core.ts` | records cap, dropped count and **spread** |
| sample | `selection/` | records width and draws |
| admit | the search's frontier | reads the trace; may not re-derive it |
| emit | the kernel barrier | prices against the emission window (`31`); never gates admission |

**Nothing moves modules.** What lands is a value with a growing record, which is
why this is compatible with the finding that made it necessary: a distributed
kind with a shared object, rather than a package fighting the churn structure.

## 4. What it makes possible that is not possible now

- **The five causes of an inert weight become separable in the data**
  (`23 §3`, `28 §5`): not-admitted (trace.closed), no-gradient (spread at the
  comparison), sparse (support count), joint-level (cluster trace), emission
  (the window), non-convex (the jump signature). Today they are distinguishable
  only by argument.
- **The homogeneity diagnostic becomes a column** rather than an analysis:
  per-feature spread across the admitted set, measured where the set exists.
- **`potionOrdering`'s slot position becomes measurable**: the ordering member
  and its law are recorded per set, so an arm that moves the pickup slot is
  visible in the trace rather than in a commit diff.
- **Coverage shapers are visible to the ambiguity detector** (`26 §5`), because
  they now write a declared field instead of mutating an array in place.

## 5. Increment

| # | step | gate |
|---|---|---|
| **L1** | `CandidateSet` as a wrapper with an empty trace; every stage passes it through | byte-identical decisions; the type change is mechanical |
| **L2** | closures and the ordering record their member ids | the trace reproduces, on a replay corpus, the prune ledger that already exists |
| **L3** | truncation records cap, dropped, **spread** | the slider/snake binding split (100%/0%) is reproduced *from the trace* rather than from a bespoke mine |
| **L4** | the trace becomes a premise coordinate at both scales; the miner refuses to pool across coverage shapes | a deliberately mixed pool is refused |
| **L5** | the five-cause separation runs as a standing report | each cause is demonstrable on a seeded board |

L1–L3 change no behaviour. L4 changes what may be *pooled*, which is a
measurement change and will invalidate some existing pooled numbers — that is
the point of it, and the honest cost is that a few published deltas will need
re-reading against the shapes they actually spanned.

## 6. What this is not

- **Not a new joint.** ACTION's members keep their joints; this is the value
  they operate on.
- **Not a new kind.** No composition law is added.
- **Not a package.** The DSM says the stages belong with their consumers, and
  putting them in one module would fight the data that motivated the object.
- **Not free of the fat-member risk.** A `CandidateSet` that grows behaviour
  rather than record becomes exactly the monolith this design avoids. The rule
  that keeps it honest: **the object carries data and never decides** — every
  field is written by a named member, and the object itself has no policy.
