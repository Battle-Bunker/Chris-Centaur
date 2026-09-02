# The reduction-binding story, after the rectangularity reversal

Cycle 7 of the COMPOSITION lens. Folds three things into one coherent account:
the EPISTEMICS lens's reversal of its own depth-coupling rule
(`06-RESEARCH-AUDIT.md` §2, Epstein–Schneider rectangularity), the TIME lens's
break 4 (ruling 13 pins ponder targeting), and the VALUE lens's γ colliding with
the single-fear-surface principle. They are one story, and it changes a claim I
made.

---

## 1. What I got wrong, said plainly

`02-JOINT-INVENTORY.md` §4 claimed:

> Under a total bot value there is exactly one binding site for `reduce/accept`,
> so *two different ε values are unrepresentable* — the coupling cannot drift
> because there is nothing to drift from.

That was a correct *mechanism* attached to a claim that has since been
**superseded**: the epistemics lens now shows that running the root's ε
recursively at every ply is the rectangularity construction, whose advised
component decays as `(1−ε)^d`, so deep readings converge to maximin regardless
of the weight's quality — and `sigmaOfPly` is *already* charging model-error
precision per ply, so depth would be discounted twice, once earned and once
structurally. That is the two-compensating-fear-knobs shape the DoF synthesis
forbids, arrived at from the other direction.

Encoding "one ε everywhere" as a theorem of totality would now **bake the
superseded rule into the type system**, which is worse than stating it in prose:
a mistake in a comment gets read, a mistake in a manifest gets enforced. So the
claim is withdrawn and replaced. What survives is the part that was doing the
work — *totality removes silent drift* — reattached to the right object.

---

## 2. The amended law

> **REDUCTION, final form.** The manifest declares a **site-class table**. Each
> row names a reduction site class, what it reduces, and a **constraint**. A bot
> binds one `(supplier, ε)` which is **broadcast to every `free` row**;
> pinned rows take their pinned reduction and ignore the bot's binding; an
> override on a free row is legal and appears in `botDiff`.

| site class | what it reduces | constraint | why |
|---|---|---|---|
| `staging/floor` | the sound rung: min over the modelled reply set | **kernel-pinned to the quantifier** | a floor that integrates is not a floor; the seam rule |
| `read/root-est` | the est rung's reading of a branch's value | **free** | this is *the* ε — one application, at the read |
| `read/deep-fold` | the deep estimate as it is folded at its origin branch | **free, and bound to `read/root-est`** | one blend per projection; see §3 |
| `thread/interior` | a thread's inner reply reduction at depth | **kernel-pinned to maximin** | rectangularity: recursive blending compounds to `(1−ε)^d` and double-discounts depth |
| `ponder/target` | which hypothesis an anticipatory meet is aimed at | **pinned to W0–W2 (ruling 13)** | no learned weight may steer inter-turn compute until the owner opens the socket |

Three properties this shape has that "exactly one" did not:

1. **It admits the two rulings that actually exist** (13's ponder pin, and the
   rectangularity reversal) without a special case at either site.
2. **It keeps the anti-drift property where drift is possible.** Within the free
   rows a bot has one binding by default, so the root reading and the deep fold
   cannot silently disagree; divergence requires an override, and an override is
   a visible diff.
3. **It is not a hack in the fibration.** These sites differ in their
   *observable* and *measure* coordinates (root vs deep-fold vs interior are
   different `h`; the quantifier is `w = ⊥`), so a per-class binding is the
   measure coordinate varying exactly where the premise already varies.

---

## 3. The implementation rule the reversal implies: blend at the read, never persist a blend

`ε` is applied **once, at the root reading of each projection**. In fibration
terms ε is a *transformation applied at projection time*, not a property of a
stored value. So:

> **Law B (blend-at-read).** No stored value is ε-blended. `estAdvised`,
> `estSound`, `lo` and `hi` are stored unblended; a comparator rung declares
> `reads: (h, frame, w, ε)` and computes the blend at the point of comparison.

This is not pedantry — it is the *only* structural defence against the
compounding the reversal just rejected. If a blended value is ever written back
(into a memo, a posterior, a carried plan, a worker result), the next read
blends it again and the `(1−ε)^d` decay returns silently through the cache
rather than through the algorithm. Given that this codebase's evaluation memo,
worker protocol and belief object all persist values, a rule that says *where*
the blend may exist is worth more than the closed form itself.

Cheap check, and it belongs with the value table (B1): assert that every
persisted value's provenance log contains no `blend` entry.

---

## 4. Dynamic inconsistency is a premise mismatch across `advance` — so commitments must record their binding

The reversal deliberately accepts dynamic inconsistency: the plan a deep node
would choose if re-rooted differs from the plan the root's blend implies, and
that is fine because the bot re-decides every turn anyway. Under the composition
carve that acceptance has a precise consequence nobody has yet stated:

**A carried premise formed under one reduction binding may survive into a bot
running a different one.** A potion commitment (arm → collect → spend, three
turns) formed at ε = 0.3 is a plan whose justification does not exist for a bot
at ε = 0.9 — and the operator can move ε *between* turns, because it is the one
legible paranoia dial. The commitment would then be a latched artefact of a
reduction nobody is running: exactly the arena-latch class, one level up.

> **Law C4.** Every `Carried` records the **reduction binding** (and the
> supplier's `fitId`) it was formed under. Its invalidation predicate fires when
> the live binding differs. A commitment may be *re-justified* under the new
> binding — cheaply, because re-justification is one read, not a re-plan — or it
> expires.

This is the general form of the dynamic-inconsistency price: it is not paid by
the search (which re-decides anyway), it is paid by **anything that persists
across `advance`**, and that set is exactly the carried premises. Naming it in
the type means the price is paid once, visibly, instead of surfacing later as a
bot that keeps walking to a potion its own risk posture no longer justifies.

---

## 5. γ and ε are one fear object seen at two joints — cross-joint constraints become manifest data

The VALUE lens's `γ` (risk concentration: `balanceFactor = w_u^γ` on outflows)
is variance-aversion content living in the **VALUE** joint. `ε` is
variance-aversion content living in the **REDUCTION** joint. The DoF synthesis's
rule is that fear is expressed exactly once; my kind carve places them in
different joints; both are right, and that is exactly the situation the
architecture has never been able to express.

They are **not the same operation.** γ changes *denomination* — how weight at
risk converts into the currency, before any quantifier or measure is applied. ε
changes *quantification* — how much of the credal set we refuse to integrate
over, at the read. Two different operations that are **observationally
confounded**, because both shrink the same rankings in the same direction.

The honest architectural answer is neither "merge them" nor "let them both
float". It is to make the coupling **data the tooling enforces**:

```ts
interface JointConstraint {
  readonly kind: 'compensating' | 'pinned' | 'requires' | 'excludes'
  readonly joints: ReadonlyArray<JointId>        // ['value/terms#γ', 'reduce/accept#ε']
  readonly rule: string                          // human-readable, checked below
  readonly enforcement: 'load-time' | 'spec-time' | 'both'
}
```

with one row for this pair:

> `compensating: [value/terms#γ, reduce/accept#ε]` — *a bot that moves either
> from its default must be measured on a **grid** over both; a single-arm claim
> about either alone is refused at spec-generation time.*

Enforcement is cheap and it lands where it matters — **experiment generation**,
not review. `make-specs` refuses to emit a one-axis arm over a constrained pair,
the same way `run-pair` already refuses a single arm. Three more rows exist
immediately, so the mechanism is not built for one case:

| constraint | joints | rule |
|---|---|---|
| `compensating` | `model/replies` × `reduce/accept` | the DoF synthesis's D2×D3 grid rule, with its named falsifier: no interior optimum ⇒ fuse the joints |
| `pinned` | `thread/interior` | maximin, by the rectangularity result — not bot-choosable |
| `requires` | `order/candidates#potion-slot` → `value/terms#potion-lineup` | ordering a pickup that nothing prices is admission without valuation; the pair is the arm |
| `excludes` | dynamic `Choice` on `model/*` or `reduce/*` | Law S, expressed as a constraint row rather than a special case in the loader |

This is the answer to the mandate's question about making cross-joint
interactions explicit instead of accidental, and it is the piece my earlier
cycles were missing: composition laws describe how members combine **inside** a
joint; constraints describe what is true **between** joints. Both are manifest
data; both are generated into the config codec, the diff, and the spec
generator; neither is a convention anybody has to remember.

**Preference on γ, stated for the record.** If γ can be *derived* (the VALUE
lens's own first option — the wipe cliff falls out of `balanceFactor`), derive
it and the constraint row disappears with the knob. A derived quantity is
strictly better than a constrained one. The constraint row is what makes the
undecided state safe, not a reason to leave it undecided.

---

## 6. What changes in the earlier documents

- `02-JOINT-INVENTORY.md` §4: the "theorem of totality" paragraph is superseded
  by §2 here. The mechanism (totality removes silent drift) survives, scoped to
  the free rows of the site-class table.
- `06-SELECTION-AND-SKETCH.md` §1: Law S is unchanged but is now expressed as an
  `excludes` constraint row rather than a bespoke loader check.
- `07-SYNTHESIS.md` B7: becomes *"the site-class table with its constraint
  column, one broadcast binding, ε applied once at the read"*, and gains Law B's
  check (no persisted value carries a blend) as an acceptance condition
  alongside the existing double-discount falsifier — which, note, the reversal
  has now *partly answered from theory*: recursive blending compounds, so the
  falsifier's job narrows to confirming that the one-shot form does not.
