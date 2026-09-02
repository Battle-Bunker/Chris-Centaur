# The range coordinate, the spawn law, the bijection, and the rules artifact

Cycle 10. Four items from the librarian's R-5 register, adjudicated. Two change
specifications I had written (`19`), one adds a coordinate to the premise index,
and one is a sharp self-referential critique of the manifest itself that I
mostly accept.

---

## 1. C37 — memoising by ⟨board, premise⟩ is unsound under fog; the range is the missing coordinate

**Their finding.** Under imperfect information a state's value depends on the
**range** — how the players played *to reach* it. Two identical premises reached
by different histories have different values, so a cache keyed on
⟨board, premise⟩ returns a plausible wrong number. The literature's remedy is
DeepStack/CFR-D style: carry the opponent's counterfactual-value **bounds** at
the subgame boundary.

**Adopted. One taxonomy correction and one structural gain.**

The object is needed. Whether it is a *fifth group* or a *component of an
existing one* matters, because the groups are individuated by the laws their
coordinates obey:

> The range is a **measure over the support**, so it belongs in the **MEASURE**
> group, beside the weight-supplier and distinct from it. The two are both
> measures and they differ in **who chooses them**: the weight is *chosen by
> the bot* (a supplier member, ruling-13-pinned today), the range is *imposed by
> history* (a fact about the path taken). Support stays a set that moves only by
> deduction; putting a history-weighted distribution in it would collapse two
> laws into one.

The structural gain is that the range has the **same two faces as everything
else in this design**, which is a good sign it is in the right place:

| face | object | channel |
|---|---|---|
| sound | opponent counterfactual-value **bounds** at the fibre boundary (CFR-D's constraints) | the bank's channel — bounds, not beliefs |
| advised | the range as a weight over the support | the est channel, at earned precision |

So the imperfect-information literature's "you cannot solve a subgame in
isolation" arrives as *"a subgame's value is a fibered value, and the fibre's
boundary conditions are bounds"* — which is the terminal-boundary finding
(`16`) one level in: **a value defined on an interior needs its boundary
supplied, not extrapolated.** Two independent lenses have now found the same
shape at two scales.

**Timing, per their own note.** It bites at fog step 5. Add the coordinate now
with its **degenerate full-observability value** (a point mass — history implies
nothing extra when everything is public), which costs one field today and
prevents a cache that will silently lie the day masks arrive.

---

## 2. C34 — expose the spawn LAW, not an injected sampler (revises `19 §2`)

**Their finding.** OpenSpiel's chance-player pattern: expose
`chance_outcomes()` — the distribution — rather than a sampler. With a sampler
the bot searches **one sampled future**; with the distribution it prices the
walk without needing the window to open in that sample.

**Adopted; it is a strict improvement and my `19 §2` is amended.**

```ts
export interface SpawnLaw {
  /** The chance node: outcomes with probabilities, given the settled state. */
  outcomes(s: SettledState): ReadonlyArray<{ cells: ReadonlyArray<number>; p: number }>
  /** The server's path, DERIVED from the same law — one artifact, two uses. */
  sample(s: SettledState, rng: () => number): ReadonlyArray<number>
}
export const NO_SPAWN: SpawnLaw     // outcomes = [{cells: [], p: 1}]
```

Three reasons this is better than the port I specified:

1. **My own acceptance test is the separating case.** `19`'s gate — the bot
   walks to a potion three turns early and the window opens *in the model* —
   passes under `NO_SPAWN` only if a potion is already standing. Under a sampler
   it passes or fails by luck. Under the distribution the three-turn walk is
   *priced* whether or not any particular future contains the spawn, which is
   what the owner's potion doctrine actually needs.
2. **`sample` derived from `outcomes` removes a drift risk I had not flagged.**
   With an injected sampler, the server's spawn implementation and the bot's
   model of it are two encodings of one rule — the exact defect class this whole
   engine section exists to remove, reintroduced in the port's name.
3. **It is cheap, because the law is simple and known**: the potion rule is
   `floor(rate)` guaranteed plus one more with probability `rate − floor(rate)`,
   placed uniformly on free cells. Writing `outcomes()` exactly is a few lines,
   not a model.

**Side effect they name, and it is real.** The EPISTEMICS lens's time-indexed
`CloudPremise` (their §4.3: *"item spawning is gated off while anything is
frozen"* is a simulation covenant, false in production) becomes **derived from
this interface** rather than restated as a premise that can go stale. One
source, two consumers.

---

## 3. Ludii's bijection versus my generator oracle — and the self-referential bite

**Their finding.** Ludii derives its manifest from the types with a checked
1:1 mapping, and the argument turned on me is sharp: **a hand-maintained
manifest is a sixth home for the joint list and will drift like the other
five.**

**Adjudication: I take the bijection and refuse the type derivation, and I
record why.**

*What is actually hand-maintained in my design is small.* Members are already
code objects whose params are taken **by reference** from the shipped constants
(the registry's existing discipline — *"never retyped, so the registry cannot
drift away from what runs"*), with fingerprint tests pinning them. The
hand-written part is the **joint list**: six to eleven rows that change rarely.

*But "small and rare" is exactly the argument that produced the other five
enumerations*, so it is not a defence. The defence has to be a **total check**:

> **The bijection law.** CI asserts a 1:1 mapping between manifest rows and the
> kernel artifacts they name: every joint has at least one member and a
> primitive that implements its codec; every registered primitive is named by
> exactly one joint; every member's joint exists; every generated artifact class
> round-trips. A row with no implementation, or an implementation no row names,
> fails the build.

That is the reachability law one level up, and it is the part of Ludii's lesson
that transfers. What does not transfer is deriving the manifest *from the
types*: TypeScript's types are erased, so derivation needs a compile-time
metaprogram — **another compiler**, added to answer a complaint about a
compiler. The repo's own precedent points the other way: a *checked*
declaration (params by reference, fingerprints, identity tests) has held up,
and a derived one would move the trust from a check I can read to a codegen pass
I cannot.

**And the oracle stays**, because the bijection and the oracle catch different
things: the bijection catches a manifest row that names nothing, the
observation-built stamp (`20 §3`) catches a manifest row that names the *wrong*
thing — a slate declared and a different evaluator constructed. The second is
the defect that actually happened.

---

## 4. C35 — the defect class is "no single rules artifact", and `19` should be framed as building one

**Their finding.** "The adjudication rule is written three times" is a symptom;
the class is **there is no single rules artifact**, and exporting one function
per discovered defect discovers them one at a time.

**Adopted, and it changes the acceptance criterion, which is why it matters.**
`19`'s seven steps stay, but the frame and the gate change:

> **The vendorable module IS the rules artifact.** Its completeness test is not
> "does `adjudicate` exist" but: **no consumer implements a rule.** A grep-level
> invariant — no rule logic in the harness, the bot, or the interface, only
> calls — checked in CI, on all three repositories' consumers.

Under that frame the seven steps are the sequence by which the artifact absorbs
what currently lives outside it, and the invariant would have caught the
triplication *before* it happened rather than after three implementations
disagreed. Two boundaries stated so the invariant is checkable rather than
aspirational:

- **What the artifact may hold** is bounded by its own vendor guard:
  deterministic, I/O-free. Which is why item 2 matters — the spawn *law* can
  live inside (a distribution is deterministic), only the *draw* stays out.
- **What is not a rule** stays out and must not be swept in: which bot plays,
  which knobs are set, which members are seated. Policy is not rules, and a
  rules artifact that grows policy becomes the monolith this design exists to
  prevent.

---

## 5. Net changes

| change | source | affects |
|---|---|---|
| MEASURE group gains a **range** component, degenerate under full observability; its sound face is opponent counterfactual-value **bounds** | C37 | `01`, `05 §5` (the map's key), `18 §3` |
| `Spawner` → **`SpawnLaw`** with `outcomes()` primary and `sample()` derived | C34 | `19 §2`, `19 §6` |
| the **bijection law** in CI; type-derivation refused, with the reason recorded | Ludii | `07 §3` law table, `20 §3` |
| `19` reframed as **building the rules artifact**, with "no consumer implements a rule" as the completeness gate | C35 | `19` |

Two of the four are corrections to specifications I wrote this week, and the
range coordinate is the second time in two cycles that an outside lens has found
a boundary condition I had treated as an interior problem.
