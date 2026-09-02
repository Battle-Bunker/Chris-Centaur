# RED TEAM — the TIME lens, from the empiricist's chair

Adversarial pass on `design/time-interruption` / `time-SYNTHESIS.md`. My assignment: **what
measurement would falsify the worldline claims, and are their falsifiers actually decisive?**

Verdict up front, in one line: **the factorization is good and I am not attacking it; the
falsifier set is not, because every one of the five tests the plumbing rather than the
payoff — and a measurement that bears directly on the payoff has already been taken by this
program and points against it.**

---

## 1. THE CENTRAL PROBLEM: FIVE MECHANISM FALSIFIERS, ZERO OUTCOME FALSIFIERS

Their build path, with the stated falsifiers:

| # | feature | stated falsifier |
|---|---|---|
| 1 | commit-scope | "if it does not recover most of the 343 ms, the central economy is wrong — stop here" |
| 2 | allowance-ledger | "A/A floors must tighten on a loaded box" |
| 3 | replay-rebase | *(none stated — "the free live differential test")* |
| 4 | worldline | "warm promotion must beat the scalar carry bridge on the two-turn acceptance games" |
| 5 | evaluator-version | *(none stated — "the dial acceptance game")* |

Every stated falsifier is of the form *"does the machinery do the thing the machinery is for"*.
Not one asks *"does the game come out differently"*.

**This program has been burned by exactly this distinction, repeatedly and recently.**
`potionOrdering` raised pickups 30–51%, monotonically, with the mechanism fully traced — and
returned a clean null on score at every `effectTurns` (k5). The mechanism telemetry was built
precisely to separate "the arm never engaged" from "the arm engaged and did not help". **All
five time falsifiers live entirely on the first side of that line.** Passing all five is
consistent with the time architecture working perfectly and changing nothing that matters.

That is not a hypothetical worry here. It is the measured base rate for this codebase.

---

## 2. THE DECISIVE MEASUREMENT ALREADY EXISTS, AND IT POINTS AGAINST THEM

`sweeps/bl-findings.md` — the budget ladder, 132 games, budgets 150 / 500 / 1500 ms.

> **"The deficit is not budget starvation. The heuristic is wrong about these boards — and
> the evaluator ordering is invariant across a 10× budget range."**

The specifics, because they are stronger than the headline:

- At 1500 ms territory evaluates a **median 83–140 plans per joint decision**, with **0–1% of
  decisions below the starvation boundary** — against 97% and 75% below it at 150 ms. It is
  nowhere near starved. The slider deficit is still **−0.222 [−0.361, −0.056]**, excluding
  zero. *"Ten times the wall clock and twenty to thirty times the plans does not fix it."*
- **500 → 1500 ms — a 3× compute increase and ~4× the plans — moves the deficit the WRONG
  way** (−0.188 → −0.222). Paired: **−0.056 [−0.306, +0.194]**. Null.
- Paired 150 → 1500 across all four cells: **+0.042 [−0.083, +0.194]**. Null.
- On the no-slider cells the advantage does not grow with budget; it very slightly *shrinks*
  (**−0.083 [−0.139, −0.028]** for 500 → 1500).

**Now put the time lens's deliverables against that scale.** Every item on the build path is
a machine for converting wall-clock into more or better-allocated effective compute:
commit-scope recovers 343 ms of a 2000 ms budget (**≈17%**); the allowance ledger accounts for
it; ponder adds between-turn compute; carry/warm-promotion stops discarding it.

> **A 17% recovery cannot plausibly pay when a 200% increase demonstrably does not.**

This is the measurement my assignment asked for, and the uncomfortable part is that it has
already been run. **None of the five falsifiers references it.** The build path proposes to
spend five feature branches before anything asks the question the ladder already answered
once, in the negative.

---

## 3. THE STEELMAN — and it is strong enough that I want it stated, not dismissed

There is one good reply, and the time lens should make it explicitly because it changes the
whole shape of their case:

> *"The ladder scaled BREADTH at horizon 1. We are buying DEPTH. Those are different goods,
> and the ladder cannot speak to depth because depth has never engaged."*

That reply is correct on its facts, and the facts are worse than the ladder suggests. From
`arch-synthesis.md`, verified in-repo:

- `horizon == 1` in **125,956 / 125,956** census decisions is ***literally the `?? 1`
  fallback*** at `kernel.ts:1384` (`run.lastView?.horizon ?? 1`).
- The only `refinementView` implementer anywhere is the **test double**
  (`src/tests/lobster-harness.ts:319`); the production factory returns no refiner.
- **The lookahead machinery has never engaged in production.**

So the budget ladder measured *more breadth at depth 1*, which really is not the good the
time lens is selling. I accept that, and it materially strengthens their case.

**But it converts their case into a conditional one, and the condition is not theirs to
meet.** The same source names four prerequisites before depth can engage at all: P-A
(no execution semantics exist for the `deepen`/`advance` levers), P-B (**"a door from a
resolved state back to an enumerable substrate… this is the real blocker and probably an
owner-visible architecture decision, not a patch"**), P-C (ply-2 root world-set under
contingent own-unit fates), P-D (`advance` gated behind `depthMax`).

Credit where due: **the time design plausibly dissolves P-B.** Its Q3 answer — replay the
realized joint move through the bot's own `PartialEngine.resolve`, with the wire doc as a
per-turn checksum — is exactly a door from a resolved state back to an enumerable substrate.
If that holds it is the most valuable thing on the build path, and it is currently ranked
**third** and labelled as a free differential test rather than as the unblocking of the entire
depth programme.

**So the honest statement of their own value proposition is:**

> Our payoff is zero unless depth engages. Depth has never engaged, and is blocked by P-A–P-D.
> Our `replay-rebase` item may dissolve the hardest of those. Therefore our first falsifier
> must be *"does depth engage, and does engaged depth change the score"* — not *"do we recover
> 343 ms"*.

That is a re-ordering of their build path, not a rejection of it.

---

## 4. ARE THE FALSIFIERS DECISIVE? ONE BY ONE

**#1 commit-scope — "recover most of the 343 ms".** Decisive *as stated*, cheap, and I would
keep it — but it is mislabeled. It is a **necessary-but-not-sufficient gate**, and calling it
"the central economy is wrong — stop here" implies the converse (recover it and the economy is
right), which does not follow. Two further problems:
- **Is 343 ms a fixed cost or a proportional one?** It is 17% of the 2000 ms owner shape but
  would exceed 100% of the 200 ms potion-cell budget. If fixed, it dominates at small budgets
  and vanishes at large ones — which inverts where the time lens pays, and the ladder says
  large budgets are where the score is insensitive anyway. This should be measured before the
  branch, not after.
- The recovery is only realised **when an operator actually intervenes.** In bot-vs-bot
  measurement — the only measurement the program runs at scale — the operator-commit path
  fires *never*. So falsifier #1 cannot be evaluated in the harness that produces every other
  number, and the doc does not say how it will be.

**#2 allowance-ledger — "A/A floors must tighten on a loaded box".** **This is the best
falsifier in the set and it is buried at number two.** It is decisive, cheap, and — critically
— it is a claim about **measurement quality, not bot strength**, so it is immune to §2's
objection entirely. Given `STATE.md`'s documented history (the shared box, the duplicate
`run-pair` incident where *"the damage does not show up in the log, it shows up as less search
per decision, which is precisely the quantity the experiment is measuring"*), determinism
under contention may be worth more to this program than any strength gain.

Under ruling 49 — bot-vs-bot numbers are potentially distortionary — **anything that makes the
instrument sharper outranks anything that makes the bot stronger.** I would promote this to
first and re-title the whole line accordingly. It is the one item whose value does not depend
on the depth programme succeeding.

**#3 replay-rebase — no falsifier stated.** It should have the strongest one, because it is
plausibly the P-B unblock. Proposed: *does the replayed resolution match the wire doc on
100% of turns across N live games, and if not, is the divergence in the partial engine or the
doc?* That is decisive, runs free in every game, and its failure kills the depth programme's
only door.

**#4 worldline — "warm promotion must beat the scalar carry bridge".** **Not decisive**, for
the §1 reason: it compares two carry mechanisms against each other, so it is guaranteed to
return a winner whether or not either matters. The measurement it needs is a third arm —
**no carry at all** — and the quantity is sharePar, not promotion rate. As written it cannot
return "neither is worth building".

**#5 evaluator-version — no falsifier stated.** The dial's own latency promise ("visible in
the very next decision, never later") is measurable and should be the falsifier, with
`refoldCostMs` as the instrument. Note the dial surface has **no operator to move it** in any
harness game, so like #1 this is unevaluable in the standard rig.

---

## 5. WHAT WOULD ACTUALLY FALSIFY THE WORLDLINE CLAIMS

Four measurements. The first two need no new code.

**F1 — The compute-value curve at the owner shape. I RAN IT; it is a null.** Early-game
(turns 5–20) mean `plansEvaluated` per decision is near-exogenous — all teams still hold six
units, positions are near-symmetric, so most of the variation is box contention. Correlating
it with that game's final `sharePar`, per bot per cell, n=48 each, partialling out mean units
alive:

| cell | compute spread within cell | corr(sharePar, plans) — material | territory | partial (units controlled) |
|---|---|---|---|---|
| snake6 | 50–55% | −0.051 | +0.011 | −0.043 / −0.002 |
| snake5-queen | 266–329% | −0.202 | −0.187 | −0.188 / −0.186 |
| snake5-knight | 70–100% | +0.067 | +0.138 | +0.072 / +0.186 |

**A 50–330% within-cell swing in compute per decision produces no consistent effect on the
outcome.** Every |r| is far below the ~0.28 needed for significance at n=48, and the signs
disagree across cells (negative on the queen board, positive on the knight board). This
corroborates the budget ladder *at the owner shape* and *on exactly the quantity the time lens
sells*. **The 343 ms has no measurable price.**

**F1b — and the same run turned up something the time lens should want.** Plans per decision,
same 2000 ms budget, both seats using their full `wallMs ≈ 1960`:

| cell | territory plans/decision | material |
|---|---|---|
| snake6 | 3,458 | 3,234 |
| snake5-knight | 2,992 | 3,471 |
| **snake5-queen** | **216** | **402** |

**Search throughput collapses 10–16× on the queen board** — the board where weight concentrates
into one unit (80–91% of team score) and the game is decided by whether it survives. The cause
is not the toll: it is that units are *large* (a weight-30 queen occupies 30 cells, and the
partition, ray walks and occupancy indexing all scale with it) and slider branching is wide.

This cuts both ways and the time lens should take the half that helps them: **there is a real
compute crisis, but it is not where they are aiming.** A 17% toll recovery against a 16×
deficit is noise. If the line wants to sell compute, it should sell it where compute is
actually scarce — 216 plans per decision on the board that decides games — and measure it
there, not on snake6 where the same budget buys 3,458. That is a *better* motivating case than
the 343 ms, and it is theirs for the taking.

**F2 — Does depth exist to be bought? (no new code).** Before any allowance policy, confirm
whether *any* production decision has ever had `horizon > 1`. The census says the field is a
constant fallback. Until a single real horizon-2 decision exists, every downstream policy —
tranche sizing, hypothesis market, ponder targeting — is being designed against an unobserved
regime.

**F3 — The depth-value experiment, and it is the one that decides the line.** Once P-A–P-D are
met: hold wall-clock fixed and vary only *how* it is spent (breadth-only vs depth-enabled),
same seeds, rotated seats, outcome = sharePar. **If depth-enabled at equal wall-clock does not
beat breadth-only, the entire worldline programme is instrumentation, however elegant.** This
is the measurement the build path currently has no equivalent of.

**F4 — The operator-in-the-loop measurement, which is the only place #1 and #5 can be
evaluated.** Both the commit-scope recovery and the dial latency fire only when a human acts.
The program has no such rig. Either build the smallest possible one (a scripted operator that
commits a pin on a fixed schedule — enough to exercise the path deterministically) or state
plainly that those two items ship on mechanism evidence alone.

---

## 6. TWO SMALLER THINGS I WOULD PUSH BACK ON

**The measurement-denominator question is the right open question and it is understated.**
Their §4 asks the owner for a ruling on comparing arms under carried compute. This is not
bookkeeping: **an arm that ponders has strictly more total compute than one that does not, so
"equal per-turn work" and "equal total work" are different experiments with different
answers**, and the honest comparison for a *product* claim is equal wall-clock. Their proposal
(both denominators, `carriedQuanta` as a column) is right; it deserves to be a falsifier, not a
footnote, because getting it wrong makes every ponder result unfalsifiable after the fact.

**Determinism claims need a determinism test, not a design argument.** "Wall cuts become
counting cuts" and "a game replays from its log" are checkable properties: run the same seed
under artificial load and assert bit-identical decision sequences. That test should exist
before the ledger is trusted, because the current nondeterminism is exactly what makes the
box-contention problem invisible in the logs.

---

## 7. WHAT I AM NOT ATTACKING

To be clear about scope, since a red team that reads as a rejection is a bad red team:

- **The factorization itself looks right to me.** `spend` / `observe` / `advance`, with
  anytime slices, ponder, speculative contexts and re-basing as parameterizations, is the kind
  of collapse the mandate asked for, and "three mechanisms become rows of one" is real
  complexity deleted before it is built.
- **The engine-API dissolution is a genuine finding** and appears well-verified against the
  wire doc.
- **The anti-latch law** (the worldline holds knowledge and appetite, never calibration) is
  exactly the right invariant, and it is the sort of thing that is much cheaper to state now
  than to retrofit.

My objection is confined to the evidence plan. **A good factorization with a falsifier set
that cannot return "this does not matter" will get built and then be impossible to retire** —
which is the failure mode the capability ledger was created to prevent, and the ledger's own
load-bearing column ("does a configured bot DO this in a real game") is the standard I am
holding this to.
