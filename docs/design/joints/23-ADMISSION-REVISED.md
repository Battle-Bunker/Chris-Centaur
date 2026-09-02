# Admission, revised by measurement — three granularities, a fifth cause, and my identification refuted

Cycle 9 close. The VALUE lens's M3 run (`design/value-evaluation` @ `bffb6fd`)
measures what I argued from code reading. It confirms the general claim, refutes
my specific attribution, and adds a cause I did not have. Supersedes
`02-JOINT-INVENTORY.md` §2.3/§7.4 and `12-EXPRESSIVENESS.md` §D4's verdict.

---

## 1. What the measurement says

| finding | number |
|---|---|
| the per-unit cap binds on **slider decisions only** | 100% of slider decisions, **0%** of snake/leaper |
| a queen's options against the cap | mean **64.4** vs cap **4** — ~94% discarded before anything is priced |
| what the discarded set looks like | the **most differentiated** options: slider room-spread 21.6–23.7 cells against snakes' 6.5–7.1 |
| plans priced then refused by the **emission rate limiter** | **15–43%** of every plan priced |
| potion term's support | a potion sat at a legal destination on **8.17%** of unit-decisions — the term is identically zero on ~92% |
| switch-dominance, switch-floor, both ratchet refusal reasons | **exactly zero** in 192 games |

---

## 2. The general claim survives and sharpens; my attribution does not

**Survives.** "Admission dominates valuation where the cap binds, and that is
slider-specific" is now measured rather than argued: 100% versus 0%, with 94% of
a queen's options never priced. And the sharpening is worse than I guessed —
**the discarded set is the most differentiated one.** The cap is not merely
binding; it binds on exactly the options whose values spread most, which is the
worst possible place for a weight-blind comparator to be making the cut.

**Refuted.** I wrote that the potion 4×-weights null and the potion ordering win
were "one fact measured twice" — weights inert because admission had not put the
pickup in the set. On snake boards **the cap never binds**, so per-unit
admission cannot explain the ordering win there. The correct account is that
admission operates at **three granularities**, and I conflated the first with
the others:

| granularity | mechanism | binds where |
|---|---|---|
| **per unit** | `candidateCap` / `sliderCandidateCap` | sliders only (measured: 100%/0%) |
| **per cluster joint** | the enumeration's 512-joint product cap, plus which incumbent is carried | everywhere, including snakes — and this is what the ordering win rides on snake boards |
| **per emission** | the rate limiter (§3) | everywhere, after pricing |

So the ordering win on snake boards is **joint-level admission plus incumbency
support**, not per-unit admission. The general thesis — *what is admitted
dominates what is valued* — is strengthened by having three mechanisms instead
of one; my specific identification was wrong and is withdrawn. **k5 stands as
the only measurement bearing on potion value.**

---

## 3. The fifth cause, and it is an architecture finding

A weight can be inert for five reasons, and the fifth is new:

| cause | shape | remedy |
|---|---|---|
| (a) per-unit admission | the option is not in the priced set | ordering / cap (sliders) |
| (b) no gradient | the term is constant across the plans compared (a team-level `max`) | re-denominate per plan |
| (c) **sparsity** | the term's support is rare — 8.17% of unit-decisions | not a weighting problem: either raise *reach* (planning toward the resource) or accept rarity and stop measuring the term on boards where it is zero |
| (d) joint-level admission | the plan never enters the 512-joint enumeration, or loses to the carried incumbent | enumeration ration / seeding / incumbency policy |
| (e) **the plan is priced and cannot be emitted** | 15–43% of priced plans are refused by the emission rate limiter | **ECONOMY-obligation**, and no evaluator weight at any setting can move it |

**(e) is the composition finding.** Between 15% and 43% of all pricing work is
spent on plans the emission stage will refuse — because the emission constraint
is **not visible upstream**. Under this manifest that is not a bug to patch, it
is a missing declared read:

> **The emission obligation is a premise coordinate, and admission and pricing
> must read it.** The rate limit belongs in the observable group's
> provenance-of-computation (`12 §D6`), so a plan that cannot be emitted this
> slice is not admitted and not priced. That is exactly the shape of
> `09 §BREAK 1`'s obligation law — ECONOMY's second law — and this measurement
> is its cost in wasted work: between a seventh and nearly half of everything
> priced.

It also settles a question the TIME lens and I had left open: whether
`economy/emit` deserves a member surface at all. A stage that discards 15–43% of
the work upstream stages perform is not a kernel constraint nobody needs to see;
it is a joint whose policy is load-bearing.

---

## 4. The zero-firing mechanisms are Law R's runtime twin, with an exhibit

`switch-dominance`, `switch-floor` and both ratchet refusal reasons are
**exactly zero in 192 games**. That is precisely the case Law R's second clause
(`09 §BREAK 6`) exists to force: *reachable in config **and** engaged in a
validated run, or seated so it can be, or deleted.*

And the three-way disposition the VALUE lens asks for — *dead code, wrongly
gated, or waiting for a board class we have not run* — is the same three
outcomes the law already prescribes:

| finding | disposition under Law R |
|---|---|
| dead | delete, with the negative record kept on the member that replaces it |
| wrongly gated | a defect: fix the gate, then it engages |
| waiting for a board class | an **engagement waiver** naming the blocking condition, self-retiring when that class enters the roster (`15 §B4`) |

A zero that means "never fired" and a zero that means "fired and did nothing"
are different verdicts with opposite remedies, which is the same distinction
`MechanismReport.loop` was retrofitted to make. This is the first exhibit where
the law would have forced the question before the measurement did.

---

## 5. The saturation rule, adopted as a generated check

Their new instrument law, beside conservation: **any bounded statistic is
checked against its own bound before reporting** — caught after their flood-fill
proxy saturated, the programme's fourth instrument artifact.

Under the manifest this is not a discipline to remember; it is a column
property:

> A manifest column declares its bound (`cells`, `1.0`, `budgetMs`, …). The
> generated miner asserts every reported value against its declared bound and
> **flags saturation rather than reporting the value**. A statistic at its bound
> is an instrument reading, not a measurement.

That belongs beside the two rules already there — refuse an unknown column
(`20 §5`), never default an absent one — and it is the third member of what is
becoming the miner's own small law set. Three of the four instrument artifacts
in this programme's history would have been caught by one of these three rules.

---

## 6. Corrections to earlier documents

- `02-JOINT-INVENTORY.md` §2.3 — "board-conditional, slider-specific" is
  **confirmed with numbers**; the three-granularity table above replaces the
  single-mechanism account.
- `02-JOINT-INVENTORY.md` §7.4 and `12-EXPRESSIVENESS.md` §D4 — the
  "same fact measured twice" identification is **withdrawn**. The ordering win
  on snake boards is joint-level admission and incumbency, not per-unit
  admission.
- `07-SYNTHESIS.md` finding 6 — gains cause (c) sparsity and cause (e) emission
  refusal, and the note that the discarded set is the most differentiated one.
- `09-REDTEAM-RESPONSE.md` §BREAK 1 — the obligation law's cost is now measured:
  15–43% of priced plans.
