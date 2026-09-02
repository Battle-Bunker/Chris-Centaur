# PRIOR ART 42 — abstract interpretation: the bounds bank has a formal identity, and its domain is the field's canonical weak one

The bounds bank carries `[worst, best]` per option, propagates them through
`backupMax` / `backupMin`, joins independent statements with `tighten`, relaxes
with `BOUND_EPSILON`, and conditionally tightens with `withNarrowing`.

That is not a bespoke construction. It is a **numeric abstract interpreter**, and
every one of those pieces is a named object in a fifty-year-old framework with
theorems attached — including a **cost/precision ladder** whose bottom rung is the
one we are on, and a **composition operator** that is strictly stronger than the
one `tighten` implements, whose textbook illustrating example we already hold both
halves of.

This composes with domain 23 (the dependency problem) and domain 38 (the
annotation's semiring): the bank has three formal identities and had been given
none of them.

---

## 42.1 The framework, and the ladder

**S81. Cousot & Cousot, "Abstract interpretation: a unified lattice model for
static analysis of programs by construction or approximation of fixpoints", POPL
1977**, and "Systematic design of program analysis frameworks", POPL 1979.
**S82. Miné, "The octagon abstract domain", *Higher-Order and Symbolic
Computation* 19 (2006).**
**S83. Rival & Mauborgne, "The trace partitioning abstract domain", *TOPLAS* 29
(2007).**

An abstract interpretation needs *"an **abstract domain**, which is a practical
representation of the invariants we want to study, together with a fixed set of
operators and transfer functions (union, intersection, **widening**, assignment,
guard, etc.)"*. Soundness comes from an abstraction/concretisation pair and a
per-operator obligation: each abstract transfer function must over-approximate its
concrete counterpart. **Soundness of the whole analysis then follows from the
per-operator obligations** — the composite never has to be argued about separately.

**The numeric domains form a cost/precision ladder**, and Miné states the whole
point of his paper in terms of it:

| domain | invariants | cost |
|---|---|---|
| **intervals** | `v ∈ [c₁, c₂]` | *"very efficient — linear memory and time cost — **but not very precise**"* |
| **octagons** | `±x ± y ≤ c` | **O(n²) memory, O(n³) time** (Difference-Bound Matrices + a shortest-path closure normal form) |
| **polyhedra** | `α₁v₁ + … + αₙvₙ ≤ c` | *"much more precise"*, exponential |

*"In terms of cost and precision, the octagon domain is in between the well-known
fast but imprecise interval domain and the costly polyhedron domain."*

**Widening** exists because fixpoint iteration in an infinite domain need not
terminate; it *trades precision for a termination guarantee*. **Narrowing** is its
partner, recovering some of the precision widening threw away.

**The reduced product** (Cousot & Cousot 1979) composes two abstract domains so
that **each one's information sharpens the other's**. It is strictly more precise
than the *direct* product, which merely runs both and keeps each answer separately.
The textbook illustration is intervals × congruences: an interval says `x ∈ [3,5]`,
a congruence says `x` is even, and the reduced product says `x = 4` — a conclusion
neither domain reaches and the direct product does not either.

**Trace partitioning** answers a different precision loss: when control paths merge,
the merged abstract state is weaker than either branch's. The fix is to keep the
abstract state **partitioned by a bounded abstraction of the trace that reached the
point**, rather than merging.

---

## 42.2 Mapping onto our joints

### C83. We are on the ladder's bottom rung, and the value model above it is RELATIONAL

The bank's domain is **intervals** — the field's canonical *"fast but imprecise"*
example, and the one whose imprecision has a name (domain 23's dependency problem:
interval arithmetic cannot see that `x − x = 0`).

  The mismatch is sharper than "we could be more precise", and it is visible in one
  line of our own source. `cluster-enum.ts` computes the order-2 Möbius surrogate

      Ṽ(x) = Σ φ_u(x_u) + ½ Σ φ_uv(x_u, x_v)

  — an explicitly **pairwise-relational** value model. The bound that travels with
  it is `[worst, best]` per option, which is **non-relational by construction**. So:

  > **The value model is pairwise; the bound model cannot express a pair.** The
  > bank is structurally unable to represent the very couplings the search is
  > organised around.

  And the domain designed for exactly that regime has exactly that shape: the
  octagon's constraint form is `±x ± y ≤ c`, which reads directly in our
  vocabulary as *"unit A's gain plus unit B's gain is at most `c`"* (they contest
  the same cells) or *"A's share minus B's share is at most `c`"*. **Octagons are
  the abstract domain of a pairwise factor graph**, and they cost `O(n²)` memory
  and `O(n³)` time in the number of variables — which for a cluster of 3–6 units is
  27 to 216 operations, against the `729` enumeration that d17 measured a 6-unit
  component costing.

  The honest scoping: this is a *design option with a stated price*, not a defect.
  Intervals may be enough. But the design has never registered that it is standing
  on the bottom rung of a ladder whose next rung is cheap at our variable counts,
  and the pairwise/non-relational mismatch is a specific, checkable symptom to look
  for — **wherever the bound is much looser than the surrogate's own pairwise term
  implies, that is the dependency problem, and it is fixable by construction rather
  than by tuning.**

### C84. `tighten` is the DIRECT product, and we already hold both halves of the textbook case where the reduced product is strictly stronger

The bank's `tighten` is documented as *"two INDEPENDENT sound statements about the
SAME quantity, joined into the tightest one: floor rises to the better floor,
ceiling falls to the better ceiling"*. That is precisely the **direct product** —
componentwise meet, each domain's answer kept as-is.

  The field's result is that the **reduced product** is strictly more precise,
  because it lets each domain *refine* the other before the meet. And our situation
  is not merely analogous to the textbook example — **it is the textbook example**:

  - domain 7's **V-3** is the **checkerboard parity bound** (a1k0n's) — a
    *congruence* constraint: the reachable count has a known parity;
  - the cell-count bound is an **interval**.

  Intervals × congruences is the canonical reduced-product illustration, and the
  direct product of `[3,5]` with "even" is `([3,5], even)` — from which the bank
  reports `[3,5]`. The reduced product reports `[4,4]`. **We hold both operands and
  compose them with the weaker operator.**

  The generalisation is the finding: **every time the bank gains a second,
  structurally different bound (parity, a conservation identity, a monotonicity),
  the question is not only "is it tighter" but "does it let the other bounds get
  tighter".** `tighten`'s "same basis required" refusal is exactly right for
  soundness and says nothing about this; the reduction step is a separate,
  additional operation that the bank does not have.

### C85. `BOUND_EPSILON` is a widening, and its termination argument has never been written

`BOUND_EPSILON` / `BOUND_RELATIVE_EPSILON` relax a bound to absorb measured
rounding divergence. In the framework's vocabulary that is a **widening**: a
soundness-preserving loss of precision, and in this framework a widening is present
for exactly one reason — **to guarantee that a fixpoint iteration terminates.**

  Our bounds are refined iteratively, and increasingly so: tranches tighten them
  within a turn, and re-base carries them across turns. The questions the framework
  forces, none of which the design has asked:
  - **does the refinement iteration have a fixpoint, and does it reach one?** With a
    finite option set and monotone tightening, yes within a turn. Across turns with
    re-base and carry, it is a genuine loop and nobody has argued it terminates.
  - **is `BOUND_EPSILON` doing widening's job accidentally?** If the cross-turn loop
    converges only because each pass relaxes by an epsilon, then the epsilon is
    load-bearing for termination and is documented as a rounding fix. That is R-6
    in its purest form: a correctness property resting on a constant introduced for
    an unrelated reason.

  **And a terminology collision, of the C11 kind.** `withNarrowing` does not do what
  narrowing does. In the framework, narrowing *recovers precision that widening
  discarded*; in the bank, `withNarrowing` *conditionally tightens a bound and
  records the condition as an assumption*. Both are precision-recovery operations,
  which is why the name is tempting, but anyone reading both will expect the
  fixpoint-iteration partner of widening and find something else. Rename or
  document, as C11 recommends for "dilation".

### M110. Trace partitioning is C37's fifth coordinate, arrived at from static analysis

Domain 12's **C37** is one of the survey's strongest results: memoising by
⟨board, premise⟩ is unsound under imperfect information, because a value depends on
the **range** — how play arrived — and the fix is one more coordinate on the
premise index.

  Static analysis has the same problem and the same fix, under its own name.
  Merging abstract states where control paths join loses precision; **trace
  partitioning** keeps the abstract state indexed by a *bounded abstraction of the
  trace that reached the point* rather than merging. Two things transfer:

  - **the coordinate must be a bounded abstraction, not the trace.** Partitioning by
    the full history is unbounded and useless; the whole engineering content is in
    choosing a small abstraction that separates the cases that matter. C37 asks for
    "reach/range"; this says the design question is *which* bounded abstraction of
    the history, and it is a first-class design choice with a literature.
  - **partitioning is a lattice of choices, and the choice can be made per site.**
    Trace partitioning is parameterised — you partition where precision is needed
    and merge where it is not. So the range coordinate need not be carried
    everywhere: **carry it where the memo is hot and the histories differ, merge
    elsewhere**, which is a far cheaper answer than adding a coordinate to every
    key.

  This is now the **third** independent field to arrive at C37's conclusion
  (imperfect-information decomposition, provenance's "which inputs and how", and
  static analysis), which is worth stating because C37 asks for a change to the
  cache key and cache keys are the kind of thing that get defended on performance
  grounds.

### M111. Soundness is a per-operator obligation, and that is R-6 with the proof shape supplied

The framework's soundness discipline is: state the abstraction, then discharge
**one obligation per abstract operator** — the abstract function must
over-approximate the concrete one. Soundness of every composite then follows.

  Our bank argues soundness **per site**, in prose, in module headers — which is
  exactly the pattern R-6 identifies as the disease (*"prose does not fail"*). The
  framework supplies the shape of the fix and it is unusually cheap here, because
  the operator set is tiny: `backupMax`, `backupMin`, `tighten`, the epsilon
  relaxation, `withNarrowing`. **Five obligations, stated once, and every composite
  bound in the system is covered.**

  And it interacts with domain 41's M109 in a useful way: the min-node operator's
  obligation is *where the REDUCTION member's identity becomes a soundness
  statement*. Writing the five obligations forces the member to be named, which is
  the assertion M109 asks for.

---

## 42.3 The counter-argument

1. **Static analysis over-approximates a set of reachable states; we bound a
   value.** The lattice is different (numbers under `≤` versus sets under `⊆`), and
   some of the machinery — the guard/assignment transfer functions, the
   interprocedural apparatus — has no analogue. **True, and it does not touch the
   three findings that matter**, because intervals, the reduced product and
   widening are all statements about *numeric* abstract domains, which is precisely
   what we have.

2. **Octagons cost `O(n³)` and our `n` is a cluster's unit count, but the
   constraints we care about are between *plans*, not units.** This is the real
   objection to C83. A cluster of 5 units with 8 candidates each has 40 plan
   variables, not 5 — and `40³` is 64,000, which is worse than the enumeration.
   **So the domain has to be applied at the right granularity**: one variable per
   *unit's contribution*, with the octagon constraining pairwise sums of
   contributions, not one variable per plan. That is exactly the shape of
   `φ_uv(x_u, x_v)`, so the granularity that makes octagons cheap is the one the
   surrogate already uses — but it needs saying, because the naive application is
   the expensive one.

3. **We may not need more precision.** Entirely possible, and the finding is
   scoped accordingly: **C83 is a design option with a measurable trigger** (bounds
   much looser than the surrogate's pairwise term implies), not a recommendation to
   rewrite the bank. **C84 and C85 are different** — the reduced product is free
   precision we are declining on operands we already hold, and the widening's
   termination argument is missing regardless of whether precision is adequate.

---

## 42.4 Verdicts

- **SEARCH / COMPOSITION (C83) — the bank is an interval abstract interpreter, and
  the value model above it is RELATIONAL.** `cluster-enum.ts` computes an
  explicitly **pairwise** surrogate `Σφ_u + ½Σφ_uv`; the bound that travels with it
  is `[worst, best]` per option, **non-relational by construction**. So the bank
  cannot represent the couplings the search is organised around. The domain the
  field designed for exactly that regime has exactly that shape — the **octagon**,
  `±x ± y ≤ c`, which reads as *"A's gain plus B's gain ≤ c"* — at `O(n²)` memory
  and `O(n³)` time in the number of variables. Apply it **per unit-contribution,
  not per plan** (the granularity the surrogate already uses), or it is more
  expensive than enumeration. Trigger to look for: **bounds much looser than the
  surrogate's own pairwise term implies** — that is the dependency problem (d23),
  and it is fixable by construction rather than by tuning.
- **SEARCH (C84) — `tighten` is the DIRECT product, and we hold both halves of the
  textbook case where the REDUCED product is strictly stronger.** *"Floor rises to
  the better floor, ceiling falls to the better ceiling"* keeps each domain's answer
  as-is; the reduced product lets each **refine** the other first. Intervals ×
  congruences is the canonical illustration — and **d7's V-3 checkerboard parity
  bound is a congruence, the cell-count bound is an interval**. Direct product of
  `[3,5]` with "even" reports `[3,5]`; reduced product reports `[4,4]`. Generalised:
  every time a second, structurally different bound arrives (parity, a conservation
  identity, monotonicity), ask not only *is it tighter* but **does it let the others
  get tighter** — a separate operation the bank does not have.
- **SEARCH / TIME (C85) — `BOUND_EPSILON` is a WIDENING, and a widening exists to
  guarantee that a fixpoint iteration terminates.** Within a turn, monotone
  tightening over a finite option set converges. **Across turns, re-base and carry
  make it a genuine loop and nobody has argued it terminates** — and if it converges
  only because each pass relaxes by an epsilon, then a constant introduced as a
  rounding fix is load-bearing for termination. R-6 in its purest form. Also a C11-
  style **terminology collision**: `withNarrowing` is not narrowing (which recovers
  precision a widening discarded); rename or document.
- **BELIEF / COMPOSITION (M110) — trace partitioning is C37's fifth coordinate,
  and it makes the coordinate cheaper than C37 implied.** Static analysis has the
  same defect (merging at joins loses what the path knew) and the same fix, with two
  transferable refinements: the coordinate must be a **bounded abstraction of the
  history**, not the history — the engineering is entirely in choosing it; and
  partitioning is **parameterised per site**, so carry the range coordinate *where
  the memo is hot and the histories differ* and merge elsewhere, rather than adding
  a coordinate to every key. **Third independent field to reach C37's conclusion**,
  which is worth having when the recommendation is "change the cache key".
- **ALL (M111) — soundness is a PER-OPERATOR obligation and our operator set is
  five.** State the abstraction once, then discharge one obligation per abstract
  operator (`backupMax`, `backupMin`, `tighten`, the epsilon relaxation,
  `withNarrowing`) — soundness of every composite follows, and the prose-per-site
  arguments R-6 warns about become unnecessary. It also forces d41's M109: **the
  min-node operator's obligation is where the REDUCTION member's identity becomes a
  soundness statement**, so writing the five obligations produces the assertion M109
  asks for as a by-product.
- **THE BANK NOW HAS THREE FORMAL IDENTITIES and had been given none:** its
  **values** are an interval abstract interpretation (here), its **annotations** are
  a why-provenance semiring (d38), and its **min node** is a multi-player backup
  whose member determines what may be pruned (d41). Each supplies theorems the
  design has been re-deriving informally, and each names a cheap assertion that
  would keep the derivation honest.
