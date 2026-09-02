# The co-change test, the inversion operator, and a budget for the visible layer

Cycle 12. Librarian domain 22's three items. The middle one asked for a
measurement; I ran it, and it says something specific enough to act on.

---

## PART I — C52: the design-structure matrix, mined

### 1. What was measured, and the window's honest size

Co-change over `src/lobster` and `src/partial-engine`, from
`claude/cluster-lookahead`: 391 commits in the repo (2026-06-30 → 09-01), of
which **100 touch these paths and 78 are usable** (2–15 files; larger commits
dropped as bulk-edit noise). Files are assigned to kinds by path. Similarity is
cosine co-change, `n(a,b)/√(t(a)·t(b))`.

**The window is not four months.** `src/lobster`'s history *on this branch*
starts 2026-08-23 — about ten days — because the layer's earlier history sits on
the pre-teardown branch. So this is a weak instrument, and its results are
reported as such. A robust pass (each file touched ≥ 3 times, killing the
cosine-1.0 pairs that come from files touched once, together) is the one to read.

### 2. The result

```
robust pass (files touched >= 3):  326 pairs
  within-kind  97 pairs, mean 0.420
  cross-kind  229 pairs, mean 0.217        ratio 1.94x

kind coupling (summed cosine)         self-share = diagonal / that kind's total
           MODEL  VALUE  REDUCT ACTION ECONOMY SPINE  |
MODEL        9.9    3.3    4.7    1.2    1.2    2.4   |  30%
VALUE        3.3    7.7    4.1    1.4    1.5    5.4   |  24%
REDUCT       4.7    4.1   11.9    1.4    6.5    7.1   |  25%
ACTION       1.2    1.4    1.4    0.4    0.3    1.5   |   7%   <--
ECONOMY      1.2    1.5    6.5    0.3    7.0    6.1   |  23%
SPINE        2.4    5.4    7.1    1.5    6.1    3.7   |  12%
```

Four readings, in order of confidence:

1. **Kinds do capture co-change, weakly: 1.94×.** Files in one kind change
   together about twice as often as files across kinds. The carve is not
   orthogonal to the design's churn structure, but it is not a clean partition
   of it either.
2. **ACTION is the outlier, and it is a real finding: 7% self-share.** Its files
   co-change with almost everything *except each other*. Under Parnas's
   criterion ACTION is not one module — and looking at what I put in it, that is
   obviously right: ordering (`candidates.ts`, `order.ts`, `edge-ev`), set
   closure (`fatality`, `staging-safety`), factorisation (`cluster-*`) and
   sampling (`selection/*`) are four things that share a *law* and nothing else.
3. **Their first prediction is confirmed; their second is refuted.**
   REDUCT×ECONOMY = **6.5** is the largest non-spine cross-coupling — the accept
   ladder and the scheduler really do move together, which is the ε/deep-value
   coupling they named. ACTION×ECONOMY = **0.3**, the *smallest* cell in the
   matrix: in this window, progressive widening and budget-dependent closure did
   **not** make admission and the clock co-change.
4. **SPINE co-changes with everything** (12% self-share; 7.1 / 6.1 / 5.4 against
   REDUCT / ECONOMY / VALUE). That is what a visible layer *is* — and it is the
   empirical case for Part III's budget, arriving from the same measurement.

### 3. The verdict, argued rather than unnoticed

The carve is a **law carve**, not a **change-locality carve**, and the two
coincide at about 2× for four kinds and diverge for one. That difference should
be argued, and here is the argument:

> **Kinds answer "how do these compose"; modules answer "what hides what".**
> A composition law is stable because it follows the domain (simultaneity does
> not stop making value a function over enemy actions); a module boundary is
> chosen to absorb churn, and churn moves with what we happen to be building.
> Conflating them is what produced ACTION: I gave one law to four things whose
> changes have nothing to do with each other.

The design change this forces is small and it is a strict addition to the
manifest:

```ts
interface Joint<M> {
  readonly kind: JointKind      // the composition law   — the domain's joint
  readonly module: ModuleId     // the hiding unit       — the design's joint
  …
}
```

with two consequences: composition laws read `kind`, the ambiguity detector and
the co-change audit read `module`, and **ACTION splits into modules** (`order`,
`closure`, `factor`, `sample`) while remaining one kind. And a falsifier that
keeps the second field honest: **if `module` ends up equal to `kind` for every
joint, the field is dead weight and should be deleted.** Today's data says it
would not be.

**Re-run condition.** This instrument gets strong when the window covers the
lobster layer's full history (the pre-teardown branch) or three months of the
new architecture. The verdict above should be re-derived then; the ACTION
finding is the one I expect to survive, because it is structural rather than
programme-shaped.

---

## PART II — M60: INVERSION, named

Baldwin and Clark's operators are splitting, substituting, augmenting,
excluding, **inverting** and porting. Inversion hoists a function implemented
redundantly inside several modules into a shared visible one. Every
"written N times" defect on this programme's record is a missing inversion:

| implemented N times | N | inverted by |
|---|---|---|
| adjudication (server / harness / bot) | 3 | `19 §3`'s exported `adjudicate` |
| move legality and cover (bot's re-derivation; the UI derives none) | 2–3 | `19 §4`'s grammar queries |
| the joint list (SlotId / BotConfig / codec / BotStamp / ledger) | 5 | the manifest (`00 §3`) |
| opponent treatment (dodge / exposure / thread replies / `theirMiss`) | 4 | the weight-supplier socket |
| staleness convention | 2 | one premise coordinate |

**Adopted as a named operator in the synthesis**, and with one addition that
makes the question mechanical rather than occasional:

> **The inversion audit is the ambiguity detector, read the other way.** The
> detector reports member pairs in different modules that touch a common
> coordinate with no declared ordering (`14 §B`). Filter those to pairs whose
> *primitives are distinct code sites computing the same coordinate*, and the
> report is a list of **inversion candidates**. The scan the programme has been
> doing by accident — four defects found that way — becomes a generated report.

And the tension worth stating, because it is the reason Part III exists:
**every inversion enlarges the visible layer.** Hoisting is not free, and
without a budget "invert everything" is as damaging as "invert nothing".

---

## PART III — M61: a visible-layer budget, argued as a total

The librarian raises this against their own contributions, which is the right
instinct: this survey alone proposed five additions to the visible layer, each
individually justified. So did I — the laws list in `07 §3` reached thirteen
entries without anyone arguing the total.

### 4. What the visible layer is, and what it costs

The visible layer here is: the **premise coordinates**, the **kinds and their
laws**, the **`Choice` forms**, the **member interface fields**, the **manifest
columns**, and the **named laws** every contributor must not violate. Its cost
is not paid once — the co-change matrix shows the spine changing with every
kind, so an addition to it is a change surface for all of them, forever, and the
entry floor for readers rises with it (`07 §7`, risk 3).

### 5. The budget

| dimension | today | cap | rule |
|---|---|---|---|
| coordinate components | 9 (`support`×2, `observable`×2 with 4 sub-parts, `measure`×2, `config`×4 — counted as groups+components) | **12** | an addition must fit under the cap **or name what it replaces** |
| named laws | 13 | **15** | same |
| kinds | 6 | **6** | a seventh requires deleting one |
| `Choice` forms | 4 | **4** | closed by Law N |
| member interface fields | ~10 | **12** | same |

The rule is the point, not the numbers: **an addition to the visible layer is
argued against the total, and an addition that cannot fit must name its
replacement.** The numbers are chosen to leave roughly one addition of headroom
per dimension, so the next proposal is debated rather than absorbed.

### 6. The budget applied to this survey's own five additions

| proposed addition | verdict |
|---|---|
| fifth coordinate (**range**) | **in** — and it cost one *component*, not a group: `24 §1` placed it inside MEASURE precisely because it is a measure over the support |
| **hypothesis assertions** (Law A) | **in**, and it is the largest single charge in this survey: one law plus a manifest column. Justified by five recorded defects, and narrowed by the dissolve-first ordering so it does not also add assertions everywhere |
| **value hashes** (trace records) | **in** at no coordinate cost — they are a *record field at the seams*, not a premise coordinate (`18 §1`) |
| **interruptibility column** | **REFUSED as a duplicate** — `Choice.transport` (`09 §BREAK 2`) and `Carried.lifetime`/`invalidate` (`05 §4`) already carry it. Adding a third spelling of the same property is exactly the drift the manifest exists to remove |
| **durability levels** | **FOLDED, not added** — into `Carried.lifetime`, which already ranges over decision / turn / n-turns / until-predicate. If a level cannot be expressed as a lifetime, that is the argument to hear; the level itself is not a new dimension |

Two of five refused or folded, on the first application. That is the budget
doing its job, and it is the answer to *"nothing says the visible layer should be
small"*: something does now, and it binds me first — my own thirteen laws sit two
under the cap I just wrote.

---

## 7. Net changes

| # | change | affects |
|---|---|---|
| 1 | `Joint.module` beside `Joint.kind`; ACTION splits into four modules while staying one kind; the falsifier is that `module == kind` everywhere would make the field dead | manifest schema, `07 §2` |
| 2 | the co-change verdict recorded with its window's honest size, its two confirmations and its one refutation, and a re-run condition | this document |
| 3 | **INVERSION** named as an operator, with the ambiguity detector doubling as its candidate scanner | `07 §3`, `14 §B` |
| 4 | a **visible-layer budget** with caps and the name-your-replacement rule; applied immediately, refusing one addition and folding another | `07 §7` |
