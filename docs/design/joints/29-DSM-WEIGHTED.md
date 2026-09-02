# The weighted co-change pass — a sharper signal, one reversal, and ACTION distributed rather than split

Cycle 13. Librarian domain 25's three follow-ups to the cycle-12 mining. Both
passes run. The weighting sharpens the headline, **reverses one of my readings**,
and answers their distinguishing test in the direction they thought least
likely — which changes what cycle 12 proposed.

---

## 1. The two passes, and what they change

**Method.** Merges dropped (0 present), mechanical sweeps dropped by subject
(4 commits: rename / lint / vendor-sync / doc), and **commit-size weighting**:
each commit contributes total weight 1 across its files and 1 across its pairs,
so a 2-file commit is strong evidence for one pair and a 15-file pass is
1/105th of the evidence per pair. 76 usable commits.

| pass | within-kind | cross-kind | ratio |
|---|---|---|---|
| cycle 12 (unweighted, robust) | 0.420 | 0.217 | **1.94×** |
| **cycle 13 (weighted, sweeps excluded)** | **0.207** | **0.067** | **3.10×** |

**The headline sharpens: 1.94× → 3.10×.** Separating "coupled" from "someone did
a pass" makes the kinds look *better*, not worse — the cross-kind mean falls by
more than the within-kind mean, which is exactly what you expect if bulk passes
were manufacturing spurious cross-links.

### The reversal I have to report

Self-share by kind, weighted:

```
VALUE 39%   ECONOMY 26%   REDUCT 23%   SPINE 17%   MODEL 6%   ACTION 6%
```

**MODEL was 30% in cycle 12 and is 6% here.** Its apparent cohesion was bulk
fix-round commits touching many `partial-engine/` files at once — precisely the
artefact the weighting exists to remove. So my cycle-12 sentence *"MODEL's huge
diagonal"* was reading a work programme, not a design structure, and I withdraw
it. VALUE moves the other way (24% → 39%) on strong small-commit evidence:
`features + index` 8×, `calibration + index` 8×, `calibration + features` 6×.

The lesson generalises past this table, and it is one this programme keeps
paying for: **an unweighted co-change matrix measures what people worked on.**
The weighted one measures what has to change together.

---

## 2. Their distinguishing test, run — and the answer is DISTRIBUTE

Their test: split ACTION into `order` / `closure` / `factorisation` / `sampling`
and ask whether each sub-module shows internal cohesion. If yes → split. If no →
**distribute**: each part belongs with its consumers, and the cluster was an
artefact of naming the law rather than the code.

Splitting changes nothing at the top (3.09× vs 3.10×), and every sub-module
reads as a bus. But a 0% self-share can mean *"never co-changed"* or *"too few
observations"*, and this programme has already been burned once by reading a
zero as a measurement — so the pairs are counted before the conclusion:

| sub-module | files | possible pairs | observed | weighted touch | reading |
|---|---|---|---|---|---|
| `A:order` | 4 | 6 | 3, **each only once and only inside large commits** (w ≈ 0.01) | **5.01** — busy files | **positive evidence of non-cohesion**: these files are active and still never move together in a small commit |
| `A:factor` | 5 | 10 | 3 (one at w = 0.33) | 1.59 | weak evidence, leaning non-cohesive |
| `A:sample` | 6 | 15 | 12, all tiny (max w = 0.11) | 1.36 | quiet cluster; unjudgeable |
| `A:closure` | 2 | 1 | **0 — never co-changed** | 0.89 | quiet **and** independent; either way, not a module worth naming |

**Verdict: distribute, not split.** The one sub-module with enough activity to
judge (`A:order`, weighted touch 5.01) shows positive evidence of *non*-cohesion:
its files are among the busiest in the tree and their internal pairs appear only
inside large commits. The rest are too quiet to judge, and I say so rather than
counting their zeros as evidence.

### What that does to cycle 12's proposal

`27 §3` proposed *"ACTION splits into four modules while remaining one kind"*.
That is **wrong as stated** and is superseded:

> **ACTION is a kind with no module of its own.** Its members are hosted in the
> modules of their consumers — ordering with the search core, closure with the
> safety floor, factorisation with the cluster machinery, sampling with the
> lottery. A kind spans modules; that is *why* `kind` and `module` are two
> fields, and this is the first case that needs both.

The data therefore argues for the field split more strongly than cycle 12 did:
under one field, ACTION would have to be either a bad module or a bad kind. It
is a good law over code that lives elsewhere.

### The missing abstraction, named

Their framing says a distribute-case cluster usually means a **missing
abstraction**. Here it is nameable, and two of this lens's own findings are its
symptoms:

> **The candidate set has no owner.** Its lifecycle — generate → order → close →
> factor → sample → admit → *emit* — is spread across `candidates.ts`,
> `search/order.ts`, `fatality.ts`, `staging-safety.ts`, `search/cluster-*.ts`
> and `selection/*`, and **nothing sees the whole pipeline**. That is why
> admission turns out to operate at three granularities nobody had enumerated
> (`23 §2`), and why **15–43% of every plan priced is refused at emission**
> (`23 §3`) — a lifecycle whose last stage is invisible to its first.

So the honest reading of ACTION's bus is not "these four should be one module"
but "these four are stages of an object that does not exist". Naming that object
is a code-structure change, not a manifest one: **no visible-layer budget charge**
(`27 §5`) — no coordinate, no kind, no law, no `Choice` form.

---

## 3. The citations, adopted — and the direction of travel matters

The kind/module split is not a field I invented; it is Parnas's standing
position, and the field has said so for four decades:

- **Parnas, "Designing Software for Ease of Extension and Contraction" (1979)** —
  the module structure exists to make the likely changes local, which is the
  criterion `27 §3` reached by measurement rather than by argument.
- **Parnas, Clements and Weiss, "The Modular Structure of Complex Systems"
  (1985)** — a system needs **several distinct structures**, and the module
  structure (what hides what) and the uses structure (what depends on what) are
  different structures over the same code. **Conflating them is a standard
  error**, and ACTION is a textbook instance: one law, four uses, no hiding
  unit.

Adopted with the direction of travel recorded, because it is the part worth
keeping: **we arrived from measurement and landed on the field's standing
position.** That converts the change from "we added a field" into "we adopted a
four-decade-old distinction with our own data confirming it in our own tree" —
and it makes the third structure worth watching for. This design already has one
in flight: the *uses* structure is what Law D (delivered reads) and the
ambiguity detector operate on, and it is not the same as either the kind or the
module.

---

## 4. Net changes

| # | change | affects |
|---|---|---|
| 1 | weighted, sweep-excluded pass is the reference result: **3.10×**; the unweighted matrix measures what people worked on | `27 §2` |
| 2 | **MODEL's cohesion reading withdrawn** (30% → 6%; it was bulk fix rounds); VALUE confirmed at 39% on small-commit evidence | `27 §2` |
| 3 | **ACTION distributes rather than splits** — supersedes `27 §3`; a kind with no module of its own, hosted in its consumers' modules | `27 §3`, manifest |
| 4 | the missing abstraction named: **the candidate set has no owner**, with the three-granularity admission finding and the 15–43% emission refusal as its symptoms | `23`, code structure |
| 5 | Parnas 1979 and Parnas/Clements/Weiss 1985 cited as the standing position; the third (uses) structure named as what Law D and the detector operate on | `27 §3`, `07 §2` |
