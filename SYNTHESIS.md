# VALUE LENS — SYNTHESIS

Current state of the lens, superseding all earlier versions of this file. Written after two
external red teams (epistemics, search-theory), one composition merge, and a self-inflicted
instrument bug.

**Read in this order.** `basis-audit.md` (what is actually established) → `adjudication-member.md`
(the missing member and the engine's real rule) → `value-joint-and-prior-art.md` (the member
schema and the Ng theorem) → `reply-to-epistemics-redteam.md` (four concessions) →
`rook-forecast-scored.md` (the out-of-sample test) → `red-team-TIME.md` (my red team of another
lens) → `value-algebra.md` (the original long argument, now largely superseded) → `tools/`
(every number here is reproducible; `tools/VALUE-LENS-TOOLS.md` indexes them and states the clock
rule).

---

## 1. THE ANSWER TO THE MANDATE

**Value is `E[terminal weight share]`. Weight is held in per-unit accounts. Every heuristic is an
estimator of a flow into or out of one, and the fold that converts flows to score is the
differential of the score itself.** But the model is **two objects, not one**:

| | what it is | status |
|---|---|---|
| the **flow fold** | a potential-based accounting of weight movement in the **interior** of a game | complete and validated; needs no fitting |
| the **terminal boundary** | the settling rule — cap, last-team-standing, same-turn annihilation | **absent from every design so far**; carries 100% of the remaining residual |

That split is the lens's cleanest result, and it closes its own first finding: cycle 1 said the
score's dominant nonlinearity is elimination and a linear fold cannot express a step; cycle 5b
located that step precisely, at the boundary, and showed the interior is otherwise exactly
accounted.

---

## 2. WHAT IS ESTABLISHED

**The fold is the differential of the score, not a model of it.** With `Φ(s) = K·w/W` (the current
sharePar), `dΦ = (K/W)[(1−p)·dw_ours − p·dw_others]` — the fold term for term. So it telescopes.
**Ng–Harada–Russell then applies: potential-based shaping is necessary and sufficient for policy
invariance**, so a fold member cannot change optimal play at any weight, on any board. Its whole
value is at *finite* depth — and with lookahead never engaged in production, this is the maximally
myopic case, the regime where shaping pays most. This is the lens's strongest claim and it rests
on a theorem, not on a fit.

**The interior basis is complete.** On one clock, per-unit flow events account for **100.00%** of
interior weight movement, and the telescoped sum reproduces the last observed board's share
exactly.

**Everything unexplained is at the boundary.** `corr(residual, terminal gap) = +0.969`. And the gap
is the *rule*, not a data artefact: mean |gap| is **0.0097** in games with no elimination against
**0.1248** where one occurred (12.9×), where an unobserved-last-turn artefact would be equal in
both.

**The share derivative is asymmetric, and every `(ours − theirs)` balance is calibrated for a
two-team game.** `∂S/∂w_ours = (K/W)(1−p)` and `∂S/∂w_theirs = −(K/W)p` coincide only at p=0.5.
Regressing each team's sharePar on its own weight lost vs the other teams' gives **exactly 2.00 on
all three cells**, with third-party losses **positive** — so third-party damage helps us, and
`potion-control.ts`'s header caveat is signed backwards. This is an identity, so a symmetric
difference (`territory.ts:648`, `potion-control.ts:281`) is *definitionally* wrong on three-team
boards; no sweep can repair it.

**The fold predicts spread, not only level.** `SD(sharePar) ≈ (K/W)·SD(terminal weight)` at ratios
0.969 / 1.020 / 0.883. This makes the search-theory lens's softmax-temperature remedy derivable:
`K/W` varies 2.2× across cells, so one absolute-weight `t0` is a different temperature on every
board.

**The coefficient transports out-of-sample.** `k` fitted on three rosters predicts the fourth
(rook) at **+0.399 against +0.424 measured — 6% error**, inside the CI.

---

## 3. WHAT THE R1 LADDER ACTUALLY MEASURED

- **Territory's behavioural edge is identical on both piece boards** (total deaths T−M: −0.271
  queen vs −0.167 knight, CIs overlapping). The knight/queen asymmetry is a *score-conversion*
  asymmetry, not an evaluation one.
- **The knight cell is a dead instrument.** The knight is unblockable by rule
  (`moveGrammar.ts:27`) and dies once per 48 games, so elimination becomes impossible: 48/48 games
  hit the cap, `elim(T−M)` is exactly 0.000, all contenders within 0.14 of par. No evaluator could
  have scored positive there. Rank cells by measured sharePar SD (0.898/0.998/0.582) before
  spending blocks.
- **The queen board is one binary variable.** The queen holds 80–91% of team weight; sharePar given
  queen-alive is 1.881 vs 0.362 dead. Survival rates of 96% vs 84% reconstruct ~88% of the effect.
- **The ladder seats the piece-blind profile.** `DEFAULT_WEIGHTS.command = 0` is what
  `lobster-territory` uses, and pieces are excluded from plane 1 by construction, so **no territory
  feature gives a piece any signal at all**. `lobster-territory-x` ships and was never seated.
- **The caps bind by unit class.** `enumCandidateCap: 8` essentially never fires on snakes (census:
  ≤3 options in 98.9% of team-turns); the binding cap is **`sliderCandidateCap: 4`**, discarding
  ~94% of a queen's ~71 options via a comparator in which **nothing scales with weight**. Both
  defects — flat `room: 3` and the balance-blind comparator — land on the same unit, the one
  holding 80–91% of the score.

---

## 4. THE MEMBER SCHEMA, AND MY OWN MEMBER'S DEMOTION

```
Member { contribution; denomination; invariance; provenance }
   denomination  weight-share | cells | weight×10 | boolean
   invariance    potential-based (policy-invariant, dialable freely)
                 | heuristic (can distort; needs the trade guard)
                 | lattice (not a number; a category error to weight)
   provenance    derived | fitted(corpus, lineage, n, …) | hand-set | operator
   domain        where it is defined — and it REFUSES outside it
```

Nine of `gainOrderKey`'s eleven slots are value flows the currency subsumes. The survivors are not
value: `tier` (a lattice bottom — a doomed move is outside the value function's domain, not a low
number), `contingencies` (conceded to ECONOMY: it is bound width, i.e. value of information), and
`candidate.to` (determinism). Two residents, both type-level.

**My own proposal splits, and only half of it should be seated:**

| member | provenance | seat? |
|---|---|---|
| `value/fold@1` — the identity, `k ≡ 1` | **derived**; games could only have contradicted it | **yes** |
| `value/fold-k@1` — the fitted refinement | **five defects**: single lineage, single-game labels, regicide-absent regime (no fitted cell had a king), clock-mixed extraction, pre-reduction fit side | **no**, not until refit by someone re-deriving the extraction |

---

## 5. WHAT I GOT WRONG

Kept prominent, because the corrections are more useful than the claims were.

1. **The k→1 march was not basis evidence.** Any exhaustive carving produces it. Withdrawn.
2. **My outflow omitted severs** — the larger channel (1,167 cells vs the kill channel's 395).
   Caught by the epistemics lens's residual-structure test: loading −0.409, falling to +0.063 when
   the channel is added.
3. **I mixed two clocks** (`standings[t] == board[t+1]`), inflating "unattributed weight" to 54–88%.
   Corrected numbers are *worse* than I published (zero-fit R² 0.9101, not 0.9507).
4. **I published a rook forecast on an unconverged input** (12 of 48 games; flow +0.063 vs the
   converged +0.324). The formula passed; the number I registered was wrong by 5×.
5. **"Every measurement is of a surrogate"** — measured and withdrawn. Margins are wide (median
   top-2 margin 25.7–42.2% of W; only 6–17% of games within 2 weight) and argmax and sharePar
   agree on the ranking in all four cells.
6. **"The trade-safety inequality dissolves"** — narrowed twice: only for potential-based members,
   and even there it *moves* to the proved/possible boundary.

**Three instrument artifacts have now been found in this program's numbers** — `horizon == 1` in
125,956/125,956 decisions (a `?? 1` fallback), the corpus potion-rarity figure, and my clock
mixing. All three would have been caught by one cheap defence, which I propose as a standing rule:
**assert the conservation law inside the extraction, not afterwards.**

---

## 6. WHAT TO DO, RANKED

| # | action | cost | why |
|---|---|---|---|
| **M1** | Seat `model/terminal@1` sourced from the engine's exported `adjudicate()`; give the fold a declared **interior** domain that refuses terminal states | small | carries 100% of the residual; the rule existed 3× and disagreed 3 ways, making the bot refuse winning trades |
| **M2** | Form `(K, W, p)` once per turn; replace both symmetric balances with the asymmetric fold | one pass over `roster()` | the current form is *definitionally* wrong on three-team boards |
| **M3** | Point-of-comparison feature spread, **by unit class** | one counter, **no games** | separates four causes of an inert weight; may reframe the whole additive-channel record |
| **M4** | Re-seat `lobster-territory-x` on the piece cells | two cells | the piece verdict measures a profile with its piece term off |
| **M5** | Rank cells by measured sharePar SD before spending blocks | free | the knight cell was never going to resolve anything |

---

## 7. OPEN, AND FALSIFIABLE

- **Composition's falsifier**: seat the terminal member, leave the fold alone; the +0.969 must move
  into explained variance, else the boundary model is *wrong* rather than missing. I verified it is
  safe to run (§2).
- **The turn-limit razor**: three turns from the cap, a terminal-seated bot must decline a trade a
  capless bot accepts. Unrepresentable today at any weighting.
- **`γ`**: cannot be derived (it is a risk preference over a distribution and the fold is
  risk-neutral). Sweep it jointly with `ε` as one fear object.
- **KataGo's gap**: our fold is linear and has **no variance term** — no analogue of their
  `scoreStdev`. Given the elimination discontinuity, two positions with equal `E[share]` and
  different variance are genuinely different and the fold cannot tell them apart.
- **NNUE's untested claim**: incremental update was measured dead *on the partition*; account
  balances are the sparse, NNUE-shaped case and have never been measured. For the dense case their
  answer is Finny tables — diff against a cached reference plan — pointed at the queen board, where
  throughput collapses to 216 plans/decision against snake6's 3,458.
- **Retrodict every borrowed member before importing it.** Tail-chasing — canonical in Battlesnake —
  is a measured null here (available at 2.7–6.2% of entrapment deaths) because our snakes are short
  and our boards crowded with foreign bodies. It cost nothing and settled without a game.
