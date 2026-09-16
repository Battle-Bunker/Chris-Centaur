# 06 — LOOKAHEAD: how a deep reading comes home, and how to see that it did

DECISION-LENS, document 6. Inputs: `04-SYNTHESIS.md` (the one lens),
`05-BUILD-ORDER.md` (where this lands), `01-DATA-MODEL.md` §3 and
`03-KERNEL-SURFACE.md` §2 (the row and the reservoir), the search itself
(`src/lobster/**`), and the extracted theory — the BACKUP joint, the pure-saddle
result, the anytime frame, the terminal boundary, the emission rule, the flow
fold and the time carve.

The owner's question, in his words:

> *"I want insight about lookahead beyond the very next turn. I don't yet have my
> head around how information from deeper searching than the very next board
> state of a considered moveset propagates back into an aggregate score for that
> moveset that's commensurate with other candidate movesets this turn, but I want
> that information legible in illuminating summary to inspection of candidate
> movesets."*

Two halves. §1 answers the first: what a depth-`h` reading of a moveset *is* in
this bot's own machinery, what comes back from it, and exactly why one channel
crosses a horizon boundary unharmed while the other does not. §2–§4 answer the
second: the row, the drill-down, what the kernel must keep, and how the display
behaves while an anytime search deepens under an operator's eyes. §5 is what is
still the owner's to decide.

**This document designs a read of a producer that does not exist yet.** The
production search core is not a `Refiner`, so the horizon is 1 on every decision
this bot has ever taken — measured at 125,956 of 125,956 (`VALUE-SYN` §5). That
is not a reason to defer the design; it is the reason to do it now, while the
answer can be *built into* the depth rung rather than retrofitted onto it. §6
says which parts ship before depth does, and why the first honest reading of the
depth column is `h1 ·` on every row.

---

## 0. The answer, on one page

**A depth-`h` reading of a moveset is a tree of settlements**: our cluster's
moves at the root, then the held enemies' claims, then our continuations, then
their claims again, alternating for `h` turns, with the static evaluator at the
leaves. The MAX layers are ours, the MIN layers are theirs, and the whole thing
is one object this codebase already has a name and a type for — `ScoreBounds`,
backed up by `backupMax` / `backupMin` (`bounds/score.ts:229,250`), which are
written, tested, and already used one layer down.

**Three things come back and they are not equals.** The *bounds* come back as
bounds. The *witness line* — the argmin claim at each of their layers and the
argmax continuation at each of ours — comes back as a path, and under the
measured pure-saddle result it is *the* line rather than one of many. The
*estimate* comes back as nothing, because it must not: `est` is an advisory
scalar with no basis, no ledger and no soundness claim, and backing one up
through a horizon boundary composes two undeclared conversions.

**Commensurability is not a new problem; it is the bank's existing rule read one
settlement later.** `bounds/bank.ts:31-38` already says: capping *who* gets
enumerated is free, capping *which* replies a modelled unit has is an assumption
that must be declared. At depth that rule acquires a mirror, because our own
layers are no longer the root:

> **Truncating our own continuations keeps floors sound and breaks ceilings.
> Truncating their claims keeps ceilings sound and breaks floors.** Every layer
> of a deep tree pays on exactly one side, and which side alternates with the
> layer's parity.

A truncation that is *not* declared is unsound; a truncation that *is* declared
becomes a `narrowing` assumption (`bounds/score.ts:360`), which changes the
`BasisKey` (`:77`), which makes `compareFloors` return
`{comparable:false, refusal:'basis_mismatch'}` (`:345`). **So a depth-2 floor
either compares with a depth-1 floor exactly as two depth-1 floors do, or it
refuses to compare at all — and the machinery that decides which is already
written and already load-bearing.** Horizon does not need to enter the basis key,
and putting it there would be wrong: it would refuse precisely the comparisons
that iterative deepening exists to make.

A depth-2 *estimate* and a depth-1 estimate are not commensurable and no field
makes them so. They are two evaluations of two different boards with no declared
discount between them, which is Law H of `07-SYNTHESIS` (*horizons meet only
inside a fold that declares its discount*) and Law B2 of `04-BACKUP` (*a bound
may not be consumed as a mean without a declared conversion*), and there is no
such fold here.

**So the kernel ranks on the proved floor, and it should.** `better()`
(`search/core.ts:410`) is a ladder — witness veto, basis comparability, floor,
est, ceiling, tie — and only the first three of those survive a horizon
boundary. Horizon enters the shipped code at exactly one site, the sticky
stager's `leader.horizon >= incumbent.horizon` guard (`voc.ts:344,353`), and is
absent from the two other sites that compare `est` (F-4 below).

**And depth's leverage is narrower than it looks, which is the useful part.**
The flow fold is potential-based, hence policy-invariant by Ng–Harada–Russell
(`VALUE-SYN` §2), so it telescopes: summing the interior terms along a line gives
the same number as evaluating the line's last board once. **Depth cannot change
the interior; it can only change where the line ends and how wide the bracket
is.** That yields a three-way split of any depth delta that the row can actually
carry:

```
Δ  =  Δ_width          the bracket contracted: proof, not preference
   +  Δ_terminal       the line reached the boundary (elimination; the cap is not seated — F-7)
   +  Δ_residual       everything else — the non-potential terms, named and always drawn
```

and a falsifier an operator can run by eye: *a large depth delta on a line that
never reaches the boundary and did not tighten the bracket is an artifact.*

---

## 1. The backup, in this bot's terms

### 1.1 What a depth-`h` reading of a moveset actually is

Start from what the bot does today, because horizon 1 is already a two-layer
tree and calling it "one ply" hides that.

A moveset `K` is an assignment over one cluster's members. With the complement
fixed, `K` names a complete `JointPlan a` (invariant 1, `search/core.ts:7-11`:
the search never holds a partial assignment). `BoundBank.price(a)`
(`bounds/bank.ts:520`) then builds the enemy layer, four ways at once:

| rung | what it is | direction it may move |
|---|---|---|
| **B0** | one settlement with every uncontrolled unit *held* — its claims treated as a cloud | both endpoints; the floor of last resort |
| **B1** | one enemy's option set enumerated completely, `backupMin` over the branches | may raise the floor **only if the sweep was complete** (`closeGroup`, `bank.ts:727`) |
| **B2** | banked witnesses: concrete enemy joint replies | **ceiling only** — *"a witness is a certificate, never a cover: it may not move a floor"* (`bank.ts:636`) |
| **B3** | the whole gate at once, within a declared product cap | the only rung that can report `exact` |

So horizon 1 = *our move, their reply, evaluate*. The leaf is
`Evaluator.scorePlan` on the settled world one turn later.

Horizon 2 replaces those leaves with subtrees. For each enemy reply `b` the bank
enumerated, the settled board `s(a,b)` is a fresh decision node: **we** choose a
continuation `K'` (a MAX layer), **they** reply `b'` (a MIN layer), and the leaf
moves one turn further out. Horizon `h` is `h` alternations.

**There are two ways to build that and they are not interchangeable.**

*Chained.* Settle turn `t` with `K` and a concrete `b`; take the real resulting
board; settle turn `t+1` with `K'` and a concrete `b'`. Every held unit at each
step has `span = 1`. Each edge is one `settlePartial` call and each layer's
divergences are attributable to a ply.

*Dilated.* One `settlePartial` at `span = 2`: let each held unit's claim cloud
dilate across two turns of unknown movement. One call instead of a product of
calls — and no line at all, because a span-2 claim's `headPossible` is a union
over two turns and its `subStep` index lives inside one of them. You can say
"something could differ", never "at ply 2 this could go differently".

The rewrite's seam supports both natively: `HeldUnit.observedTurn` and
`span(h) = input.turn − h.observedTurn ≥ 1` (`ONE-ENGINE` §1.2–1.3) is exactly
the dilation parameter. **And dilation is already in production, under a
different name: it is staleness.** A unit whose choice we missed last turn
arrives with `span = 2` today. So the display must distinguish depth from
staleness regardless, and the cheapest way to keep them distinct is to build
depth as *chaining* and leave dilation meaning what it already means.

> **Rule L-1 (the line is the deliverable).** A depth reading the lens shows is
> built by chaining span-1 settlements. A dilated reading has no line, and a row
> with a depth number and no line is a number the operator cannot check.

### 1.2 What is backed up, channel by channel

**Bounds.** `backupMax(children)` at our layers, `backupMin(children)` at theirs.
Both already exist and carry three disciplines depth inherits free:

- *Each bound is its own game* (`score.ts:1-6, 229-247`). `worst` and `best` are
  maxed (or minned) independently, over possibly different children. A deep
  reading's floor and ceiling may come from different lines, and the type is
  structurally incapable of assuming otherwise.
- *Per-endpoint ledger citation* (`justifier`, `score.ts:211`). An entry rides
  the result only if it explains a gap the result still has. So a deep reading's
  ledger is a **shrinking** list, and `ledgerSize` is a legible progress axis.
- *Assumptions union over **all** children* (`score.ts:205-209`). A conditional
  child contaminates a min or a max whether or not it set an endpoint. **This is
  the commensurability latch**, and it is why §1.5's argument needs no new code.

**The witness line.** At each MIN layer the child attaining the minimum is a
concrete opponent reply, and `closeGroup` already banks it (`bank.ts:745`) as a
`Witness = { replies, note }` (`contracts.ts`). At each MAX layer the argmax
child is our own continuation. Chain them from root to leaf and you have the
line: *what we would do, what they would do to us, alternating.* It is the same
object `DominanceCondition.refuted-by-witness` already carries at ply 1
(`04 §4.2`) — only longer, and the drill-down of §2.3 is that object drawn.

**The estimate.** Nothing is backed up, and nothing may be. See §1.5 and F-4.

### 1.3 The saddle: whose continuation's value counts

At a MIN layer the node's value is attained at the argmin child; at a MAX layer
at the argmax. In general `max_a min_b V ≤ min_b max_a V`, and the two coincide
exactly when a **pure saddle** exists — a pair `(a*, b*)` where each is a best
reply to the other. When one exists, "the value" is unambiguously the value of
*one line*, and summarising a deep reading as a principal variation is honest
rather than a simplification.

The program has measured this. On the restricted matrix the bank already
computes and discards (`05-SEARCH-SYN` §2.4½ — B2 resolves every priced plan
against every banked witness, keeps `bounds.best`, mins it, throws the rest
away), the finding is that **mixing buys exactly zero on every board that
produced a column**, with `rowSupport = 1` on most decisions (`05-SEARCH-SYN`
§S0, doc 09 v2). So:

1. **The line is the value.** A deep reading may be summarised as one line
   without laundering a mixture into a point. Where `pureDuality > 0` the row
   must say so — *"the value here is not the value of any single line"* is a
   real display state, not an error, and it is the only case in which the
   drill-down honestly has nothing single to draw.
2. **`refutedAt` is a proof and it composes.** The witness veto
   (`search/core.ts:414`) retires a plan whose sound ceiling sits at or below the
   incumbent's proved floor. Under contraction-only refinement that survives
   deepening: a refutation established at ply 1 cannot be undone at ply 2. It is
   the MCTS-Solver mechanism (`04-BACKUP` §6) and today it runs at one ply only.

And one consequence that cuts the other way, which the display must carry:

> **A saturated floor does not un-saturate with depth.** `min_b` on a contested
> cell is attained by the reply that kills the contesting unit; `DEAD` is `−∞`
> (`bounds/score.ts:33`); so every option that enters a contest has the same
> floor and `compareFloors` never fires (`05-SEARCH-SYN` §2.3). The min at ply 1
> dominates every deeper layer, so **depth cannot repair a ply-1 saturation** —
> it can only move `hi` and `est`.

That is the sharpest structural fact in this document. In exactly the posture
where lookahead would matter most — everything reads dead, the governor flips to
FOGGED-VACUOUS and `basis.channel` becomes `est` (`kernel.ts:634-654`,
`postures.ts`) — the channel that adjudicates is the one channel depth cannot
back up soundly. **The row must therefore never present a deep reading under a
vacuous posture as though depth had proved something.** It proved nothing; it
guessed further out.

### 1.4 The horizon-1 term set, and the terminal boundary member

The leaf is `BoundEvaluator.evaluatePlan` (`evaluate/index.ts:139`): resolve
once, fold the non-negatively weighted features, then `finish()` clamps on
terminal verdicts by **replacement, not addition** (`:242-283`). Two parts, and
depth meets them differently.

**The interior.** The VALUE lens's result is that the fold is the *differential
of the score*, not a model of it: with `Φ(s) = K·w/W`,
`dΦ = (K/W)[(1−p)·dw_ours − p·dw_others]`, term for term, so it telescopes; and
Ng–Harada–Russell makes potential-based shaping necessary and sufficient for
policy invariance (`VALUE-SYN` §2, interior basis complete at 100.00%). The
consequence for lookahead is immediate and it is the single most useful thing to
tell the owner:

> **For the policy-invariant part of the evaluator, deepening changes nothing but
> where the line ends.** Sum the interior terms along a two-ply line and you get
> the same number as scoring the line's last board once. Depth has no purchase on
> the path — only on the endpoint, and on how much the bracket around it shrank.

**The boundary.** The fold is defined only in the interior; a terminal state
takes a lattice value (`DEAD` / `WIN`) applied by replacement. `16-TERMINAL` §1
measures 100% of the flow fold's remaining residual at that boundary, carrying
all of the game-length dependence (`corr = +0.969`), with mean |gap| 0.0097 in
games without elimination against 0.1248 where one occurred — 12.9×, where a
data artefact would be equal in both.

So depth's leverage lives in exactly three places, and each has a proxy the row
can compute:

| where | what moves | proxy on the row |
|---|---|---|
| **the bracket** | held claims resolve; ledger entries discharge | `Δlo`, `Δhi`, `ledgerSize` falling, `citedUnits` shrinking, `exact` possibly flipping |
| **the boundary** | the line reaches elimination (or the cap, when seated) | the line's leaf carries a `terminal` verdict |
| **the non-potential terms** | heuristic members that can distort | the residual — `Δ − Δ_width − Δ_terminal` |

which is the three-way split of §0, and it obeys Law A's own shape: a decomposed
aggregate with a **named residual, always drawn, zero included**.

**Finding F-7 belongs here rather than in a list, because it changes what the
split can say.** `terminalVerdicts` (`evaluate/features.ts`, via
`evaluate/index.ts:252`) reads elimination only — `subjectGone` / `othersGone`,
in the worst and best worlds. There is no turn cap: `grep -rn 'maxTurns|turnLimit|turnCap' src/lobster`
returns nothing. So `model/terminal@1` (`16-TERMINAL` §3) is half-seated, and the
missing half is the half that carries the game-length dependence.

> **A bot with no turn cap has no reason to prefer a shorter line, so every deep
> reading is priced as if the game were infinite.** The one channel through which
> depth can move a *level* rather than a *width* is the one channel the evaluator
> cannot see. Until the member is seated the row's `Δ_terminal` can only ever
> mean *elimination*, and everything else lands in the residual — which the
> display must say, in words, rather than by omission.

### 1.5 Why a depth-2 bound is commensurable and a depth-2 estimate is not

**The bound.** `lo` at any horizon is a lower bound on the same quantity: what
this moveset is worth to us, played now. The horizon is a property of the
*proof*, not of the *claim*. Whether a given deep `lo` really is such a bound is
decided by one rule, which the bank already states for its own layer
(`bank.ts:31-38`):

> *"Capping WHO gets enumerated is free (an un-enumerated unit simply stays held
> at a sound bound); capping WHICH replies of a modelled unit is an assumption,
> and the only way to let one move the floor is `declareTruncatedFloor`, which
> names it on the bounds."*

At depth this acquires a mirror, because our own layers are no longer the root:

- **Their layer (MIN).** A min over a *subset* of replies over-estimates the min:
  not a floor. Sound ceiling, unsound floor.
- **Our layer (MAX).** A max over a *subset* of continuations under-estimates the
  max: not a ceiling. Sound floor, unsound ceiling.

Hence the rule of §0. And the enforcement needs no new apparatus:

1. an undeclared truncation is simply a bug, exactly as it would be at ply 1;
2. a declared truncation goes through `withNarrowing` (`score.ts:360`), which
   forces `exact` false and unions a `narrowing` assumption;
3. `basisKeyOf` (`:77`) folds that into the basis key;
4. `compareFloors` (`:342-347`) refuses the comparison —
   `{comparable:false, refusal:'basis_mismatch'}`;
5. `better()` (`search/core.ts:415-416`) reads that refusal and keeps the
   incumbent;
6. and `04`'s Law E already renders it: two rows whose `BasisKey`s differ are
   never in one sorted list.

> **Depth does not add a fiber coordinate; it moves an existing one.** Two rows
> read at different horizons are comparable exactly when their `BasisKey`s agree,
> and a deep reading changes the `BasisKey` if and only if it declared a
> narrowing. The lens therefore needs no `horizon` column in Law E's
> three-coordinate fiber (generation, basis, complement) — it needs the basis
> strip to name *which* assumption depth added.

Note what is **not** claimed. A deep bracket may not be `tighten()`-ed against a
shallow one (`score.ts:289`): that is Law H′ (*across horizons the sound channel
yields the hull, never an intersection*). The deep bracket is legitimate as a
*replacement* only when it was **derived** from the shallow one by backup, since
contraction-only refinement makes it contained by construction, and T4 of the
rewrite's soundness spec (`ONE-ENGINE` §1.3 — `options' ⊆ options ⟹ ledger' ⊆
ledger`, brackets contained) makes that checkable rather than asserted. When the
deep reading came from somewhere else — another context, another epoch — the hull
is what you have. **Hence the `derived` flag of §3, and hence the lens stores two
readings rather than one row that got tighter.**

**The estimate.** `est` carries no basis, no ledger, and no soundness claim. It
is the evaluator's advisory scalar (`evaluate/index.ts:267`), and the bank takes
it from **B0 alone** — `est = b0.est` (`bank.ts:537`), the hold-everything
branch's reading — then clamps it into the final bracket (`:699-702`). It is not
a reduction over replies even at horizon 1. Two `est`s at two horizons are two
evaluations of two different boards, and the only thing that could make them
comparable is a declared discount, which Law H requires and which does not exist.
`04-BACKUP` Finding B-2 is the trap one field away: the arena's depth layer
published a proved floor into a mean slot and consumed it as an unbiased mean,
composing a downward bias (a floor understates by the bracket width) with an
upward one (a max over sampled rows — the optimizer's curse).

> **`lo` and `hi` cross a horizon boundary because they are claims about a
> horizon-independent quantity, proved to different depths. `est` does not,
> because it is a summary *at* a horizon. That is the whole of it.**

### 1.6 What the kernel therefore ranks on

Five sites, in the order a value passes through them:

| # | site | key | horizon-safe? |
|---|---|---|---|
| 1 | `better()` `search/core.ts:410-421` | witness veto → basis → floor → **est** → ceiling → tie | rungs 1–3 yes; **rung 4 no** (F-4) |
| 2 | `pickLeader()` `voc.ts:195-212` | `lo` primary, `est` tie-break; under the `veto` policy **`est` primary** | tie-break **no**; est-primary **no** (F-4) |
| 3 | `rootSlack()` `voc.ts:232` | `max over rivals (R.hi − L.lo)` | yes — both endpoints are bounds |
| 4 | `StickyStager.stage()` `voc.ts:308-358` | F1/F2 under `leader.horizon >= incumbent.horizon` | **yes; the only guard in the codebase** |
| 5 | `gate()` `kernel.ts:1651-1735` | the ratchet on `basis.channel === 'est' ? est : lo` | `lo` yes; `est` **no** (F-8) |

**One sentence: the kernel ranks on the proved floor, and horizon enters at
exactly one of the five sites.** That is very nearly the right answer already —
the floor channel needs no guard, and the one channel that does need one has it
at the last site and not at the first two.

### 1.7 Findings against today's code

Each is a `file:line` claim, checked.

**F-1 — the refiner seam has no producer, so `horizon` is a constant column.**
`makeSearchCore` returns `{ improve, conform, drainRefusals, release }`
(`search/core.ts:761`) — no `refinementView`, no `refine` — so `asRefiner`
(`voc.ts:633-639`) yields null, `run.refiner` is null (`kernel.ts:878`),
`run.lastView` is never assigned (`kernel.ts:1092`, inside the dead branch), and
`absorb` stamps `run.lastView?.horizon ?? 1` (`kernel.ts:1393`). `EmitRecord.horizon`
(`contracts.ts:304`) is therefore `1` always; measured at **125,956 / 125,956**
decisions (`VALUE-SYN` §5, listed there as one of three instrument artifacts).
`KernelReport.leverOrderBinding` is `false` on every production decision
(`kernel.ts:2017`), and `voc.ts:625-627` already says so out loud. This confirms
and extends `04 §2.3`'s refusal of `lastView`.

**F-2 — a plan's horizon is the *slice's*, not the *plan's*.** `absorb` writes
the view's horizon onto **every** plan it absorbs that slice
(`kernel.ts:1393-1401`), while `deepen` names one plan
(`voc.ts:603`: `{ kind: "deepen", planKey: target.key }`). The moment a refiner
exists, the horizon attributed to a moveset is whatever the view reported, not
the horizon that moveset's reading was proved at. **The lens's depth column must
be sourced from the reading, never from this field.**

**F-3 — `EmitRecord.horizon` means two different things on two paths.**
`stageAndGate` passes `decision.horizon` (`kernel.ts:1600`), which
`StickyStager.stage` computes as `Math.min(...rows.map(r => r.horizon))`
(`voc.ts:313`) — the *table's shallowest*. `buildRecord` passes `row.horizon`
(`kernel.ts:1643`) — the *staged row's own*. So the forced path reports the
staged plan's depth and the gated path reports the table's floor. Unobservable
while F-1 stands; a silent disagreement the day it does not.

**F-4 — no horizon-consistent estimate exists, at any depth, and the guard is at
one site of three.** `est` is B0's alone (`bank.ts:537`), clamped
(`:699-702`), never a reduction over replies. It is compared across horizons with
no guard at `search/core.ts:418` (`better()` rung 4) and at `voc.ts:205,209`
(`pickLeader`, as primary key under the `veto` policy and as tie-break under
`adjudicate`). The guard exists only at `voc.ts:344,353`. **One comparison, three
sites, one guard.**

**F-5 — the sticky stager's horizon guard is required on the `est` arm and
conservative on the `lo` arm.** `voc.ts:353` refuses a strictly higher proved
floor from a shallower leader. A floor is a floor whatever proved it —
`compareFloors` reads `worst` and nothing else (`score.ts:346`) — so the refusal
is sound but not required. Its stated motivation, *"≤4-point h=1 refutations that
reversed at h=2"* (`voc.ts:250-251`), is an `est`-channel phenomenon: a
refutation on sound ceilings cannot reverse under contraction. **A decision to
make, not a defect to fix** — the conservative reading has its own virtue
(preferring the better-informed incumbent), and it should be held deliberately
rather than by inheritance.

**F-6 — `DEFAULT_SWITCH_MARGIN` was re-calibrated on the premise that no deep
reading can arrive.** `voc.ts:249-275` says it in as many words: *"On this build
the horizon is always 1 … so the 'refutation that reverses at h=2' the margin was
protecting against cannot occur."* `0.01` is one thousandth of the lightest
unit's material — small enough that **any** deep floor movement restages,
including one that is an artifact of a truncated deep enumeration. The margin and
the horizon guard are one mechanism, calibrated against one another, and they
expire together. Whoever lands the depth rung re-decides both in one commit or
neither.

**F-7 — the terminal boundary member is half-seated, and the missing half is the
half depth needs.** §1.4. `terminalVerdicts` reads elimination only; no turn cap
exists in `src/lobster`.

**F-8 — `RatchetBasis` has no horizon coordinate.** `kernel.ts:634-654`. Correct
on `lo` (a floor is a floor). Wrong on `est` under FOGGED-VACUOUS, where
`basis.channel === 'est'` and the ratcheted `value` is the clamped `est`
(`kernel.ts:1663`). One field, one condition — and the same split as F-4, at the
gate rather than at the comparator.

**F-9 — the rival set is already computed, already unbounded, and already
refused.** With no refiner, `rows()` (`kernel.ts:1563-1588`) builds the staging
table from `run.plans`, a per-decision map holding **every** plan `absorb` ever
saw (`kernel.ts:1391-1401`), uncapped. `rootSlack` could therefore be computed
today; `slackFor` (`kernel.ts:1431-1440`) declines, because its guard is
`run.lastView !== null`, which is never true — so `EmitRecord.slack` degrades to
the incumbent's own bound gap. `04 §5.2 #12` already schedules that repair; the
depth column reads the same source, and the uncapped map is worth a bound of its
own.

---

## 2. What depth changes, and how to show it

### 2.1 The depth delta, defined

Per retained moveset the lens holds **two readings and never merges them**:

- `h1` — the shallowest reading, captured on the row's *first* price;
- `deepest` — the deepest reading obtained under the **same basis and the same
  complement**.

```ts
interface Reading {
  readonly horizon: number                       // proved at. NOT EmitRecord.horizon (F-2, F-3)
  readonly lo: number; readonly est: number; readonly hi: number
  readonly exact: boolean
  readonly ledgerSize: number
  readonly basis: BasisKey                       // the coordinate depth moves (§1.5)
  readonly citedUnits: ReadonlyArray<UnitKey>
  readonly atMs: number                          // kernel clock from t0 — one timeline
  readonly quanta: number                        // slices spent reaching THIS reading
}
```

Four numbers and a verdict come off the pair:

```
Δlo     = deepest.lo − h1.lo                     proof gained on the floor
Δhi     = deepest.hi − h1.hi                     optimism removed
Δwidth  = (deepest.hi − deepest.lo) − (h1.hi − h1.lo)      ≤ 0 whenever derived
rankΔ   = rankAtH1 − rank                        did depth move this row?
```

and the attribution of §0/§1.4:

```
Δ  =  Δ_width  +  Δ_terminal  +  Δ_residual
```

with `Δ_width` read from the bracket movement and the ledger shrink,
`Δ_terminal` present only when the line's leaf carries a terminal verdict (and
therefore, while F-7 stands, only ever *elimination*), and `Δ_residual` **named
and always drawn, zero included** — Law A applied a second time, to the depth
delta itself. A zero residual on a large delta is a finding: it says depth was
pure proof. A large residual is the other finding: it says a non-potential term
moved, and the breakdown panel can name which.

**The rung at which depth changed the ranking.** `better()`'s ladder gives six
rungs and `01 §3.4` already names them (`refuted | basis | floor | est | ceiling
| tie`). Depth's effect on a pair of rows is legible as *which rung decided at h1
and which decides now*. Five transitions are worth a mark of their own:

| transition | what happened | how it reads |
|---|---|---|
| `est → floor` | a guess became a proof | **the best outcome depth can produce.** Worth an alert |
| `tie → anything` | depth broke a salted coin-flip (`order.ts::planTieKey`) | the authority-collapse ask (`02 §3.5`) retires on this row |
| `anything → refuted` | a deep witness retired the row | permanent; composes; survives shallower re-reads (§1.3) |
| `floor → est` | depth's narrowing contaminated the basis; the floor comparison refused and the row fell back to the advisory channel | **a warning, not progress** |
| `floor → basis` | one row deepened and the other did not, with a declared narrowing | **the rows are not sorted against each other at all** (Law E) |

The last two are the ones a naive display would report as improvement.

**Confidence.** Three numbers, all already computed, and one order that must not
be collapsed:

- **bound width** at the deepest reading — the recognizable-quality axis
  (`07-ANYTIME` A-2: `basis.maxGap` is monotone by the ratchet's own rule and has
  never been plotted against time);
- **witness age** — the oldest `Witness` on the line, as a `seq`, and whether the
  epoch has changed since it was banked. Witnesses survive epochs by contract;
  **bounds do not** — CHANGE 2 explicitly refuses to carry `bounds`/`boundsBasis`
  across an epoch (`04 §4.4`). So a deep reading's witness may legitimately be
  older than its bracket, and the row must be able to say that rather than
  imply a single freshness;
- **budget consumed** — slices on this row's deepening, from `PinContextEntry.cursor`
  and `stepCostMs` (`kernel.ts:733-758`), which is `04 §3` Q4's echo applied to
  depth.

And the order: `compareConfidence` (`voc.ts:99-106`) is a **partial** order over
the pair `(horizon, slack)` that answers `incomparable` for deeper-but-looser.
That refusal is one of the two places this architecture declines to invent a
number, and the display must not undo it with a sort. **Deeper-but-looser gets a
glyph, not a rank.**

### 2.2 The one-row summary

The moveset table today (`02 §3.7`):

```
 #  aggregate   Δ     assignment
▸1     12.4     —     C f7 · Q d4 · s1↑ · R b1
```

One cell is added, between the aggregate and the contrastive Δ. It must survive
being read at a glance while the operator is deciding whether to press `Space`.

```
 #  aggregate      depth       Δ     assignment
▸1  12.4 ⌈2.9⌉   h2 ▲+0.6 ◂   —     C f7 · Q d4 · s1↑ · R b1
 2  11.7 ⌈4.1⌉   h1 ·        −0.7   C f7 · Q d4 · s1→ · R b1
 3  11.1 ⌈1.2⌉   h2 ▽−0.4 ↕  −1.3   C f7 · Q g4 · s1↑ · R b1
 4   9.6 ⌈8.8⌉   h2 ✂        −2.8   C f7 · Q d4 · s1↑ · R c1
```

| token | meaning | why this shape |
|---|---|---|
| `h<n>` | the depth of the **deepest** reading | and `h1 ·` when nothing deepened. **The absence of depth is drawn, never omitted** — the same rule as Law A's zero residual, and on today's build every row reads `h1 ·`, which is the honest display of a bot that does not look ahead |
| `⌈w⌉` | bracket width at the deepest reading, beside the aggregate | not new ink: this is `slack` in its honest form (`04 §5.2 #12`), and it is the confidence channel the operator actually needs |
| `▲` / `▽` | the **floor rose** / the **ceiling fell** | two marks, because each bound is its own game (`score.ts:1-6`) and they move independently. Both may appear |
| `+0.6` | `Δlo` if the floor moved, else `Δhi`, signed, in the aggregate's units | one number. The full split lives in the drill |
| `◂` | **depth moved this row's rank against its runner-up** | the mark an operator scans for. It is the answer to "did the extra thinking change anything" |
| `↕` | `compareConfidence` says **incomparable**: deeper but looser | the one glyph that means *do not read this as progress* |
| `✂` | the deep reading **declared a narrowing**; its basis differs and `compareFloors` refuses | the row is present but **not sorted against the others**: `--fixed` grey, aggregate struck, exactly as a stale complement already renders (`02 §1.6`) |
| `⊤` | the deepest line reaches a **terminal** verdict | suffixed to `h<n>`. While F-7 stands it can only mean elimination, and the tooltip says so in words |

Shape carries the meaning and colour only reinforces it (`02 §3.2`): `▲▽◂↕✂⊤`
are distinguishable with the hues collapsed.

The foil line under the table gains one clause, because the foil is the place
depth is most interesting:

```
foil #2 · deciding room(s1) −1.1 · margin 0.7 · at h1 this was #1
```

and the lock affordance is untouched. **Depth changes no determination.** A lock
still pins every differing member (`04 §2.4`) and still stages what is drawn.

### 2.3 The drill-down: the line, ply by ply

`D` opens the LINE panel, which **replaces** the BREAKDOWN panel in the rail
rather than stacking under it — the two answer different questions about the
same row and the rail is one scroll region.

Ply depth is drawn as **opacity, not as a new hue**: ply 1 at full `--lens`
violet, ply 2 at 55%, ply 3 at 30%. Nothing new is claimed in the palette, and
the ink rule holds — violet still means hypothetical, and a deeper hypothesis is
a fainter one.

```
┌ LINE · α#1 · h2 ················· 4 layers · 41q ┐
│ ply  who    move             bracket     ledger  │
│ ▸1   us     C f7 · Q d4      10.9…14.1      7    │
│  1   them   R? → e6 ⚑        10.9…13.2      5    │
│  2   us     C g5             11.8…13.2      3    │
│  2   them   R? → f4 ⚑        11.8…13.0      2    │
│  ── leaf ── 12.4 ⌈2.9⌉ · alive · not terminal    │
│                                                  │
│ Δ floor +0.6 · Δ ceiling −1.1 · Δ width −1.7     │
│   width −1.7 · terminal — · residual +0.00 [why?]│
│ derived from h1 ✓   witness R@e6 · seq 9 · e3=now│
│ [◂ ▸] step ply   [W] why here   [Esc] close      │
└──────────────────────────────────────────────────┘
```

Six rules, each doing work:

1. **One row per *layer*, not per turn.** `us` and `them` alternate; the `⚑` marks
   a MIN layer. That is the min/max structure of §1.1 made visible, and it is the
   only way "whose continuation counts" is answerable by looking.

2. **A held enemy's move is drawn as a claim, never as a move.** On the board:
   a `--refuter` **hollow** arrow from the claim's observed cell to the argmin
   cell, with that claim's `headPossible` set at that sub-step washed behind it.
   A solid arrow would assert we know what they will do; we know only that this
   is the reply that attained the minimum over the set we enumerated. **The set is
   the truth and the arrow is our pick from it**, and the picture must say both.

3. **The `ledger` column is `|Divergence|` at that layer** — the count of points
   where a concrete world could still disagree with this timeline. It must fall
   monotonically down the column when the reading is derived (T4,
   `ONE-ENGINE` §1.3). **If it rises, the deeper reading is not a refinement of
   the shallower one**, the `derived` flag is false, and the panel says `hull, not
   derived` in place of the `✓`. That is Law H′ rendered as a check an operator
   can see failing.

4. **Clicking a ledger count draws the divergences on the board as "this could go
   differently at…" marks.** One mark per `Divergence`, at `(cell, subStep)`,
   shaped by `kind` — `contest | edge | bodyBlock | sever | durable | transit |
   food | potion | exhaustion` (`ONE-ENGINE` §1.2) — and **placed by
   `assumedPresent`**: a divergence that exposes `worst` sits on the floor side of
   the bracket bar, one that exposes `best` on the ceiling side. That field's
   inversion is *"invisible in every aggregate and wrong exactly where a human
   reads the ledger"* (`ONE-ENGINE` §1.2, quoting `bounds/ledger.ts:9-20`), so
   this panel is the only surface in the system that would catch it — which is an
   argument for building it that has nothing to do with lookahead.

5. **A `narrowed: true` divergence is hatched.** It exists only because a
   `HeldUnit.options` narrowing admitted the world. Hatched marks are the `✂`
   glyph's evidence, and a row whose deep reading refuses comparison can be
   audited down to the cells that made it refuse.

6. **`[W] why here` is the foil, one layer down.** At the highlighted MAX layer it
   draws the sibling continuation we rejected in `--foil` dotted hollow, only
   where it differs, with a Δ badge on each differing member — the identical
   vocabulary as the ply-1 foil (`02 §3.5`). **The foil is not a new concept at
   depth; it is the same concept per layer**, which is the whole reason the
   drill-down needs no new ink.

The `⊤` case gets one extra line: when the leaf is terminal, the panel names the
verdict (`our elimination` / `theirs`) and *which world it was read in* — worst
or best — because `terminalVerdicts` reads both independently
(`evaluate/index.ts:252-256`) and a clamp that fires in one world and not the
other is the difference between a warning and a promise.

### 2.4 The vocabulary, unchanged

| lens word | at depth |
|---|---|
| **frame** | unchanged. A depth arrival is a `movesets` frame; there is no depth event kind (§4) |
| **foil** | per layer. `F` at ply 1, `[W]` at any layer, one vocabulary |
| **residual** | the third term of the depth delta, named and always drawn |
| **fiber** | unchanged — generation, basis, complement. Depth *moves* `basis`; it adds nothing (§1.5) |
| **refuter** | the argmin claim at a MIN layer. At ply 1 it is `DominanceCondition.refuted-by-witness`; deeper it is the same object further along the line |
| **stale** | reserved for the complement. **Dilation is staleness; chaining is depth** (Rule L-1), and the two never share a glyph |

---

## 3. What the kernel must retain

Beyond `03`'s reservoir (`k = 5` per `(clusterId, complementKey)`,
`LENS_ROW_CAP = 24` per decision), one column per row.

### 3.1 The types

```ts
interface PlyStep {
  readonly ply: number
  readonly side: 'ours' | 'theirs'
  /** For 'theirs' these are the ARGMIN claim's actions, not observed moves. */
  readonly moves: ReadonlyArray<{ unit: UnitKey; to: CellIndex }>
  readonly lo: number; readonly hi: number     // the bracket AT THIS NODE
  readonly ledgerSize: number
  readonly narrowed: boolean                   // a HeldUnit.options narrowing licensed this layer
  readonly witnessSeq: number | null           // when the refuting reply was banked
}

interface DepthColumn {                        // added to Moveset (04 §4.2)
  readonly h1: Reading                         // ALWAYS present; §2.1
  readonly deepest: Reading                    // === h1 when nothing deepened
  /** deepest was obtained BY BACKUP from h1. False ⇒ hull, not intersection (H′). */
  readonly derived: boolean
  readonly line: ReadonlyArray<PlyStep>        // root to leaf; [] at h1
  readonly lineTruncated: boolean              // LENS_LINE_PLIES bit
  readonly rankAtH1: number
  readonly confidence: 'better' | 'worse' | 'equal' | 'incomparable'   // voc.ts:99
  readonly terminal: 'none' | 'elimination' | 'cap'                    // 'cap' unreachable — F-7
}
```

Two new manifest constants, so changing either changes `botId` and every stored
row says which value produced it (`04 §4.1`):

```ts
const LENS_LINE_PLIES  = 8     // PlySteps per moveset — four alternations
const LENS_DEPTH_BYTES = 800   // the budget a row's depth column may occupy
```

### 3.2 Bytes per moveset per decision

| part | contents | bytes |
|---|---|---|
| two `Reading`s | 2 × (horizon + 3 numbers + `exact` + `ledgerSize` + ~40 B basis key + ≤3 unit keys ≈ 30 B + 2 clock numbers) | **≈ 260** |
| `line` at h2 | 4 `PlyStep`s × (≤3 moves ≈ 24 B + 4 numbers + 2 flags ≈ 40 B) ≈ 65 B each | **≈ 260** |
| `line` capped at h4 | 8 `PlyStep`s | ≤ 520 |
| scalars | `derived`, `lineTruncated`, `rankAtH1`, `confidence`, `terminal` | **≈ 20** |

**≈ 540 B per moveset at h2; ≈ 800 B at the `LENS_LINE_PLIES` cap.** Against
`03 §2.2`'s ~200 B for the row itself, the depth column roughly **quadruples**
the reservoir's per-row cost.

Per decision: `24 × 540 B ≈ 13 KB`, giving **≈ 18 KB total** where `03` budgeted
~5 KB. Set beside `MAX_EXPLAINED_CANDIDATES = 96`'s existing count discipline
and a decision that spends ~470 evaluator nodes at a 150 ms budget
(`tests/local-game.ts:136`), that is affordable — and it is **declared before the
turn starts rather than discovered**, which is the same rule the inspection
reserve is built on.

Storage is much smaller, because §3.3 rule 4 keeps the line only for the staged
row: six numeric columns × 24 rows ≈ 400 B per emission, plus one `line jsonb`
of ≈ 300 B on the staged row.

### 3.3 Where it is cut off — five rules, in the order they bite

1. **The line truncates; the readings never do.** Past `LENS_LINE_PLIES`, keep the
   first `n−1` steps and the leaf and set `lineTruncated`; the panel draws a break
   mark. The two `Reading`s are the row's *number*, and a number without its
   premise is the failure this whole lens exists to prevent.

2. **Only the leader's cluster keeps lines at every emission.** Every other
   cluster keeps its lines at the final emission only, on the telemetry pass
   (`03 §2.5`'s tiering, one level up). A line explains a *rank*, and only the
   leader's rank is contested at every barrier.

3. **`h1` is captured once and never re-derived.** Recomputing the shallow reading
   later would compute it under a different complement, and the delta would then
   be a difference between two questions. This is `complementKey`'s discipline
   (`03 §2.3`) applied to time rather than to the board.

4. **Storage keeps the delta; the line only for `staged = true`.** Under `04 §4.3`'s
   frame-keeping rule, `movesets` gains `h1_lo, h1_hi, deep_horizon, deep_lo,
   deep_hi, derived` plus a `line jsonb` populated on the staged row alone.
   Everything else re-derives on demand from `turn_boards.settlement` +
   `decisions`, badged `rerun` — the lazy path `04 §2.5` already defines.

5. **A stale complement voids the delta, not the readings.** When another cluster
   improves, `complement: 'stale'` already strikes the aggregate through
   (`03 §2.3`). The **delta** must be struck too — it is a difference of two
   numbers under a complement that no longer holds. The two readings stay: each
   was a real bracket of a real plan. **Struck delta, live readings.**

---

## 4. On the operator's timeline

### 4.1 The rhythm depth actually has

`TIME-SYN` §2 measures it: the snake cell saturates at ≤ 500 ms (0.95 agreement
at 125 ms; **zero** staging changes from 500 ms to 4 s across 9,000+ extra priced
plans), while the queen cell **climbs through the top rung** (0.883 at its played
2 s against the 4 s reference; 15% of decisions differ 1 s → 4 s). And the VOC's
depth preview is designed to reach horizon 2 by ~150 work units and regret 0 by
1200 (`voc.ts:12-15`).

So at production budgets a depth arrival is **late, rare, and
high-information** — precisely the shape that churns a display when handled
naively, and precisely the shape worth an explicit mark when handled well.

### 4.2 The event: there isn't one

**Depth is not a new `TurnEventKind`.** A deeper reading of a row is a new
reading of a row, and the reducer already folds that: the `movesets` frame
carries the whole reservoir (Law C — every frame is whole, never a delta). What
is new is one predicate the *renderer* computes from two successive frames:

```
depthArrived(prev, next, movesetKey)  =  next.deepest.horizon > prev.deepest.horizon
```

The timeline lane draws it as a badge on the existing kernel tick — `▲e3ʰ²` —
never as a new lane. One lane, one vocabulary, no schema change, and it survives
scrubbing for free because the frames are whole.

### 4.3 How the row moves, and the churn policy

`04 §4.7`'s standing rule is *additive uncertainty is staged; subtractive
certainty is applied*. Depth is the awkward case because it can be either, so the
rule specialises rather than bends:

| what depth did | uncertainty | policy |
|---|---|---|
| bracket contracted, basis unchanged, **rank unchanged** | subtractive | **apply at once.** Numbers change in place on a 200 ms ease. No banner, no re-sort, no cursor move |
| bracket contracted, basis unchanged, **rank changed** | subtractive but structural | apply, **and mark**: `◂` on the moved rows, footer note `depth reordered #2 and #3 at seq 17`. The cursor keeps its row by identity (`02 §1.5`), so the selection follows its row down |
| **basis changed** — a narrowing was declared | **additive** | **stage behind the widen banner**: same banner, same deadline-scaled timer `min(6 s, 0.25 × (turnExpiryTime − now))`, same suspension while the drill panel is open, same rule that the old table is struck and **never blanked** |
| `confidence === 'incomparable'` | neither | draw `↕` and **do not re-sort.** `compareConfidence` said incomparable; sorting would invent the exchange rate the design refuses (`voc.ts:17-22`) |

Three things keep it quiet, and all three already exist:

1. **The table never re-sorts on `est`.** Its order is the reservoir's, which is
   `better()`'s (`03 §2.2`), which is floor-first. A deep `est` movement therefore
   *cannot* move a row — the design's own answer to F-4, arrived at for a
   different reason.
2. **The rate gate is upstream.** Depth reaches the display only through
   emissions, and emissions are throttled by gate 3
   (`minWriteIntervalMs`, `kernel.ts:1706`). The lens inherits the wire's throttle
   rather than growing a second one.
3. **A deepening in flight is motion, not a number.** While a row's deepest
   reading is being extended, the depth cell reads `h1→` with a 1 px violet
   hairline under the aggregate, sized by `PinContextEntry.cursor` against the
   reserve; when the reading lands the hairline resolves into the glyph. That is
   `04 §3` Q4's echo — the look funds the compute and the operator is owed the
   receipt — applied to depth, and it makes "the bot is thinking harder *about
   this row*" a thing the operator can see rather than infer.

### 4.4 Scrubbing

Stepping back with `,` / `.` shows the row **as it was read then**, with its own
`h`, because the frame is whole. An operator scrubbing across a depth arrival
watches the glyph appear and the bracket close. That is the clearest possible
demonstration of what lookahead bought, it needs no new storage, and it falls out
of Law C rather than being designed.

---

## 5. Open questions for the owner

**Q-L1 — should the estimate be shown at all when horizons differ?** *(the
owner's own).* My recommendation is **no number, but keep the position**: when
`h1.horizon !== deepest.horizon`, the aggregate cell renders the bracket and the
`est` becomes `~`, the existing *estimated* grade (`02 §3.7`). The reason is Law H
plus F-4: there is no fold declaring a discount, so the two numbers answer two
questions, and a scalar whose meaning requires consulting a second field is
exactly what `04 §5.2 #8` deleted `scoreChannel` for. **The counter-argument is
real**: under FOGGED-VACUOUS `est` *is* the adjudicating channel
(`kernel.ts:1663`), so suppressing it hides the number the bot actually used. A
middle member exists — show it struck with the horizon superscripted, `9.8ʰ¹`, so
it is present and unmistakably not comparable. Three members, and it is the
owner's call.

**Q-L2 — chained or dilated?** §1.1 and Rule L-1. Chaining costs a product of
settlements and yields a line; dilation costs one `settlePartial` at `span = h`
and yields no line at all. The lens needs the line. **Is the operator's line worth
the settlement count, or should the row show a dilated deep bracket with an
explicit "no line available" state?** Note the display must distinguish depth from
staleness either way, since dilation is already in production under that name.

**Q-L3 — does the deep reduction match the ply-1 reduction, and is the mirror
rung built?** Law B1 (`04-BACKUP` §3): a search that is worst-case near and
model-based far is two bots spliced at a ply boundary. Their layers already have
the discipline (`closeGroup` refuses to let an incomplete cover move the floor);
**our** layers need its mirror — a rung that refuses to let an incomplete
continuation set move the *ceiling* — and it does not exist, because at horizon 1
our layer is the root and the root makes no ceiling claim. Two members: build the
mirror, or **declare deep ceilings unsound and rank on floors only at depth**. The
second is cheaper and honest and costs the `hi` column past ply 1.

**Q-L4 — is `model/terminal@1` a prerequisite of the depth rung, or a parallel
track?** F-7. My reading is prerequisite: depth's only route to a *level* change
is the boundary, and half the boundary is absent, so a deep reading prices a game
that never ends. The counter is that depth's *width* effect is real and useful
with no terminal member at all, and shipping bracket-contraction first is a much
smaller commit. **A sequencing decision with a real cost either way.**

**Q-L5 — does the evaluator's `reachHorizonTurns = 4` double-count with search
depth?** `calibration.ts:156`, consumed at `evaluate/index.ts:152`. The reach
feature already looks four turns ahead **geometrically, with no adversary**. A
ply-2 search partially replaces that estimate with an adjudicated one, so the leaf
at ply 2 is scored by a feature estimating the span the search just proved.
Should the profile's reach horizon shrink as the search horizon grows
(`reachHorizonTurns = max(0, 4 − h)`), or are the two axes orthogonal? **Nothing
anywhere states an answer, and until one exists the row cannot honestly attribute
a depth delta between `Δ_width` and `Δ_residual`.**

**Q-L6 — which slot does the deep leaf reading occupy, `lo` or `est`?**
`04-BACKUP` Finding B-2 and increment B3: the arena's depth layer published a
proved floor into a mean slot, and the member was never declared. This bot has
not made the choice yet and it is far cheaper to make now — a one-field member
selector with `lo` as today's default, measured by whether the deep reading
changes a plan.

**Q-L7 — a fourth fiber coordinate, or one line in `better()`?** §1.5 argues
against `horizon` as a fiber coordinate: depth moves `basis`, and `compareFloors`
already refuses. The argument fails in exactly one case — two rows at different
horizons under **identical** bases with **equal** floors, where the tie falls to
`est` (F-4). **The cheap alternative is to give `better()` the stager's guard on
rung 4 only**, one line, which makes the coordinate unnecessary. Guard or
coordinate: owner's call. (Either lands behind G2, like CHANGE 1, because it edits
the hottest function in the search.)

**Q-L8 — whose budget pays for a deepening an operator asked for?**
`LENS_INSPECTION_MS` is the operator's reserve (`04 §3` O5), and deepening is
*search*, not inspection — but a deepening that only happens because someone
opened the drill-down is inspection by any reasonable reading. If the reserve pays,
the deepest reading becomes a function of who was watching, which breaks G-L1's
replay-parity gate unless the reserve's spend is itself an event. **Deferrable,
with a trigger:** the first drill-down that would deepen a row the search had not
deepened.

---

## 6. Where this lands, and what ships before depth does

### 6.1 Three tranches

**Now, inside L2** (`05` (c)) — the reservoir already writes at the `better()`
call site, so this is fields on a record that is being created anyway:

- capture `h1` on the row's first price and carry it unchanged;
- source `horizon` from the reading, never from `EmitRecord` (F-2, F-3);
- carry `derived`, `rankAtH1`, `confidence` and `terminal`;
- render the depth cell, which on this build reads `h1 ·` on every row.

Cost: `Reading × 2` and four scalars per row — the `line` stays empty and the
column's whole content is a truthful *no*. **That is the point.** A display that
says "this bot does not look ahead" on every row is strictly better than no
column, because it is the fact the owner would otherwise have to hold in his
head, and it is the fact three of this program's instrument artifacts came from
forgetting.

**At L3, gated on G2** — the two one-liners on the hot path, each its own commit
beside CHANGE 1: F-3's two-meanings repair, and F-4's horizon guard on `better()`
rung 4 (Q-L7). Neither may change a decision; G2 is the only instrument that
would see it if one did.

**When a refiner lands** — the `line`, the drill-down, the `▲e3ʰ²` badge, and the
`Δ_width / Δ_terminal / Δ_residual` split. Every one of those is inert until then
and costs the row about twenty bytes in the meantime.

### 6.2 Keys

`D` opens the LINE panel; `Shift+D` expands every layer's divergences. Both are
free against `02 §3.8`'s verified list, and `\` — freed when `04 §3` Q3 deleted
T5's cluster cycle — stays free.

### 6.3 The seam with the rewrite

Depth extends through `settlePartial`'s held/`observedTurn` seam
(`ONE-ENGINE` §1.2–1.3), and three of its stated properties are load-bearing for
this design rather than incidental:

- **T1 (divergence containment).** `ledger = []` is a *proof* that the held set
  did not matter. So a ply whose `ledgerSize` is 0 is a ply the operator can be
  told is settled — the strongest single sentence the drill-down can say, and it
  is a theorem rather than a heuristic.
- **T3 (coordinate bracketing).** Per-divergence concessions to `lo` and `hi`, per
  coordinate, already tabulated. That is the per-ply bracket of §2.3, itemised,
  specified before it is needed.
- **T4 (monotonicity under narrowing).** `options' ⊆ options ⟹ ledger' ⊆ ledger`
  and every bracket contained. **That is exactly what makes `derived` checkable
  rather than asserted**, and therefore what makes rule 3 of §2.3 — the ledger
  column must fall — a test rather than a hope.

One dependency to declare at rebase: the drill-down's marks read
`Divergence.heldId`, `.assumedPresent`, `.kind` and `.narrowed`, all post-C5
types (`bounds/ledger.ts` 117 → ~55, `04 §6.1`). **Before C5 the line's ledger
column can carry a count and nothing else; after C5 it carries kinds and
polarity.** So the count is the pre-C5 placeholder and the marks are a post-C5
feature, and the panel is designed so the placeholder is not a lie — a count is a
count at either end of the rewrite.

---

## 7. What is settled here, in one place

- A depth-`h` reading is a chained tree of settlements, MAX at our layers and MIN
  at theirs, `backupMax` / `backupMin` at the nodes, the static evaluator at the
  leaves. The functions exist; the tree does not.
- Bounds and the witness line come home; the estimate does not, and must not.
- Commensurability is the bank's own who/which rule read one settlement later,
  with a mirror at our layers: **truncating our continuations keeps floors sound
  and breaks ceilings; truncating their claims keeps ceilings sound and breaks
  floors.** Declared truncations land in the basis key and `compareFloors`
  refuses; undeclared ones are bugs at any depth.
- Depth adds no fiber coordinate. It moves `basis`, which the existing refusal
  already handles.
- The kernel ranks on the proved floor. Horizon enters the shipped code at one
  site of five, and is missing from two that compare `est`.
- Depth's leverage is `Δ_width + Δ_terminal + Δ_residual`, because the interior
  fold is potential-based and telescopes. A large delta on a line that neither
  tightened nor reached the boundary is an artifact, and the row shows enough to
  say so.
- One cell on the row (`h2 ▲+0.6 ◂`), one panel behind `D` (the line, ply by ply,
  with the ledger's divergences as *this could go differently at…* marks), no new
  event kind, no new ink, and no re-sort on a channel that cannot cross.
- ≈ 540 B per moveset at h2, ≈ 13 KB per decision, cut off at five named places,
  with the line stored only for the staged row.
- Nine findings against today's code, of which four (F-1, F-2, F-3, F-9) are
  about a horizon field that has never carried a number other than 1, and one
  (F-7) is about a boundary that carries 100% of the evaluator's residual.
