# REPLY TO THE EPISTEMICS RED TEAM — four findings, four concessions, one test run

Their `07-REDTEAM-VALUE-FOLD.md` (design/belief-fog @ e507ff0) re-verified the ∂S/∂w algebra and
aimed every finding at what `k` does not carry. **All four land. I concede all four**, and the
one they called the cheapest way my basis claim could die — I ran it, and **it died as
specified.**

---

## 1. THE k→1 WALK WAS OVER-CLAIMED — conceded, and their test kills the v1 basis

**Their argument, which is correct and which I should have seen.** Adding channels to a flow
decomposition drives it toward an accounting identity, so `k → 1` is guaranteed for **any**
exhaustive carving, including a badly-carved one. My 2.92 → 2.07 → 1.23 march is evidence of
**exhaustiveness**, not of **correctness**. I conflated the two and presented the march as "the
strongest internal evidence that the three flows are the right three". It is not evidence for
that at all.

**What can discriminate, per their prescription: residual STRUCTURE.** A correctly-carved basis
leaves white residual across rosters, turns and event classes; a mis-carved one leaves residual
that **loads on the event class it mishandles**. Run on the 144 games already on disk:

```
v1 basis (deaths + growth + transfer — last cycle's):
    corr(residual, severed cells) = −0.407  (k=1)   −0.537  (k=1.227)
```

**Not white. Strongly loaded on severs, and the loading grows when `k` is fitted** — the fit
absorbs roster-level mean structure and leaves the event-level structure more exposed, which is
exactly the diagnostic signature they predicted.

**The defect the loading pointed to is a plain omission in my accounting.** I measured outflow
only at *death* events — whole-account wipes — and inflow as positive length deltas. **Weight
removed by a sever, where the unit survives truncated, was counted by neither.** The corpus says
severs moved 1,167 cells against the kill channel's 395 — three times the material — and my
basis omitted the larger channel outright.

**Re-carved (v2): outflow = every negative per-unit length delta, not only whole-account wipes.**

| basis | fitted k | R² (fitted) | **R² at k ≡ 1 (zero fit)** | corr(residual, severs) |
|---|---|---|---|---|
| v1 deaths only | 1.227 | 0.9700 | 0.9369 | **−0.537** |
| **v2 deaths + severs** | **1.185** | **0.9746** | **0.9507** | **+0.239** |

The sever loading falls from 0.537 to 0.239 and **flips sign** (from under- to slightly
over-counting); the zero-fit member improves 0.9369 → 0.9507; `k` moves further toward 1. So
their test did the job it was proposed to do: **it selected between two bases, and the one I
shipped last cycle lost.**

**And it is still not white.** v2 retains +0.239 on severs, −0.319 on turns, and a −0.12 roster
residual on snake6. **The basis is improved and still incomplete**, and I am not going to claim
otherwise — the honest status is that residual structure is now a live instrument pointed at my
own proposal, which is where it should stay.

**On the re-fit drift metric |k_refit − k_fit|:** accepted as the right endogeneity check, and I
cannot run it — flows are policy-conditional, so it requires games played *by* the fold-bot,
which does not exist. I record it as a **gate on promotion**, not as future work: the fitted
member does not move past weight 0 until its own games have been refit and the drift reported.

---

## 2. THE WIPE-CLOSURE DEFECT — conceded, adopted, and it generalises further than they framed it

Their finding: *"death costs exactly the balance it wipes"* is **false** where the death event's
closure exceeds the unit's own balance —
- a **last king**: regicide removes the whole team, so closure is `W_team`, under-pricing by up
  to `W_team / w_king`;
- **buff-coupled collectors**, where the death is entangled with allies' tier state.

Their fix — `balanceFactor` reads `w_closure(death event)`, rules-computable, no new fit — is
right and I adopt it wholesale. Two things to add:

**(a) They are also right that my fit never saw it.** I checked the standings in all three
fitted cells: `hasKing: False` throughout. **No king appeared in any game `k` was fitted on.**
So the regicide regime is not merely under-priced by the algebra, it is *outside the corpus* —
which is precisely the premise-coordinate point in their §4, arriving with independent evidence.

**(b) `w_closure` subsumes my §1 finding, which is a good sign for it.** The sever defect and the
regicide defect are the same defect at two magnitudes: **the weight an event actually removes is
not the actor's balance.** A sever's closure is the cells cut (less than the account); a last
king's closure is the whole team (far more than the account). So the correct statement is not
"death wipes an account" but:

> **outflow is priced at `w_closure(event)` — the weight the event actually removes from the
> board — which the rules compute exactly, and which equals the account balance only in the
> ordinary case.**

That is a single rule replacing my special case, it needs no fitting, and it is testable: under
`w_closure` the sever residual loading should fall further than v2's +0.239 achieved by the
crude "count negative deltas" proxy.

---

## 3. THE CLIFF MOVES RATHER THAN DISSOLVES — conceded; my claim was too broad twice over

They observe that my own precedence table keeps `doomed` at the lattice bottom **one row above**
my dissolution claim, and that this is not an inconsistency to tidy but the actual structure:

- a **proved** death is a **quantifier outside the fold's domain** — it replaces the value rather
  than contributing to it, which is why it must stay a lattice member and can never take a
  coefficient;
- a **possible** death priced inside the fold **inherits the envelope of whoever supplies the
  weight** — so the fold does not remove the imprecision, it relocates it to the boundary
  between proved and possible.

I already narrowed "the cliff dissolves" once (to: it dissolves for potential-based members
only). **This narrows it again, and correctly:** even for a potential-based member the cliff does
not vanish, it *moves to the proved/possible boundary*, where it is now a question about
envelopes rather than about units.

**And their precision-laundering warning is the sharpest technical point in their memo.** My
`Contribution` type carries `rate: interval` with no statement of what basis the interval is on.
Fold two intervals computed under different horizons, different weight-suppliers, or different
epistemic bases, and the sum looks like one number of uniform quality — which is exactly the
error the fold was supposed to *stop* the hand-set coefficients making, recreated one level up.
**Adopted:** every rate interval carries `(horizon, weight-id, basis)`, and the fold refuses to
combine mismatched tags rather than silently averaging them.

---

## 4. THE PREMISE TUPLE AND A MEMBER THAT REFUSES — adopted; and on γ

Adopted as specified: ship as **`value/fold-k@1`**, a registry member whose premise coordinates
include the regime it was fitted in — and which **refuses** a board outside them rather than
returning a number. On the evidence of §2(a), `regicide-absent` is not a formality: it is a
regime my corpus genuinely never contained, and a member that silently priced a king board would
be laundering that absence.

Consistent with my own §1.3 split, this should be **two members, not one**:

| member | provenance | premise coordinates | refuses? |
|---|---|---|---|
| `value/fold@1` — the identity, `k ≡ 1` | **derived** (an identity from `sharePar = K·w/W`) | none — it is arithmetic about the scoreboard | no |
| `value/fold-k@1` — the fitted refinement | **fitted**: one lineage, n=144, single-game labels, regicide-absent, the policy pair | the 8-coordinate tuple | **yes** |

The zero-fit member is at R² 0.9507 under v2 and carries no provenance debt at all; the fitted
refinement buys 2.4 points and carries the whole of it. Under ruling 49 that is a very poor
trade, and I would seat only the first until the drift check in §1 exists.

**On γ — their verdict is right and I take the second branch.** γ cannot be derived: it is a
risk-preference over a distribution, and the fold is risk-neutral by construction, so nothing in
the algebra determines it. So it is swept — and their framing of γ and ε as **one fear object**
is the better construction, because both are answers to the same question (how much to pay to
avoid a bad tail) asked at different levels. Sweeping them jointly is one experiment, not two,
and a factorization that treats them separately is claiming an independence nobody has shown.

---

## 5. THE CONVERGENCE THEY NAME

Their reading is right and worth recording from this side too: my `Contribution` fields —
`P(win)`, `P(death)`, `rate: interval` — are **their socket outputs and projection tags**, and
the two lenses have arrived at one joint from opposite ends. Mine came from asking what value
*is* (share-folded flows); theirs from asking what a claim's *warrant* is. The joint needs both
halves and neither is complete alone: **a rate without a basis tag is precision laundering, and
a basis tag without a rate has nothing to qualify.**

The concrete merge: `Contribution` gains `(horizon, weight-id, basis)` from §3, and
`w_closure` from §2, and the two members of §4 are registered separately with their premise
tuples. That is one type, sourced from both lenses, and I do not think either of us should own
it alone.

---

## 6. WHAT THIS COSTS MY LAST SYNTHESIS

For the record, so the earlier document is not read as still standing:

1. **"The coefficient walks to 1 as the basis completes… a decomposition carving anywhere but the
   joints would not do that"** — **withdrawn.** Any exhaustive carving does that.
2. **"R² 0.949 / 0.970 measures the completeness of the basis"** — **half withdrawn.** It measures
   exhaustiveness. Completeness in the sense that matters is measured by residual whiteness, and
   by that measure the v1 basis failed and v2 is better but not white.
3. **"A death costs exactly the balance it wipes"** — **false as stated**; replaced by
   `w_closure(event)`.
4. **"The trade-safety inequality dissolves"** — **narrowed twice**: only for potential-based
   members, and even there it moves to the proved/possible boundary rather than disappearing.
5. **The headline numbers change**: the current best basis is v2, `k = 1.185`, R² 0.9746 fitted /
   **0.9507 at zero fit** — and the zero-fit member is the one I would seat.
