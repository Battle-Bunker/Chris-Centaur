# M3 — THE ADMITTED-SET INSTRUMENT: first table and reading

No games played. Instrument: `tools/m3-instrument.py` (geometry, from the move grammar + board)
plus the per-decision **refusal spectrum**, which turned out to exist in telemetry already and is
the better half of the measurement.

---

## 1. THE TABLE

**Geometry — 5,227 unit-decisions sampled (every 7th turn, 10 games per cell, 4 cells).**

| cell | class | n | legal moves | surviving | **capBinds (a)** | allDoomed | mean room | **room spread** | zero | ≤2 |
|---|---|---|---|---|---|---|---|---|---|---|
| snake6 | snake | 1368 | 2.83 | 2.24 | **0%** | 8% | 21.3 | **6.52** | 3% | 18% |
| snake5-queen | snake | 822 | 2.61 | 1.63 | **0%** | 19% | 17.0 | **6.87** | 4% | 21% |
| snake5-queen | **slider** | 306 | **64.38** | 53.21 | **100%** | 1% | 31.4 | **23.71** | 0% | 0% |
| snake5-rook | snake | 976 | 2.60 | 1.49 | **0%** | 21% | 16.6 | **7.12** | 4% | 19% |
| snake5-rook | **slider** | 274 | **36.64** | 28.99 | **100%** | 6% | 29.4 | **21.57** | 0% | 1% |
| snake5-knight | snake | 1141 | 2.54 | 1.21 | **0%** | 32% | 16.3 | **7.05** | 4% | 21% |
| snake5-knight | leaper | 340 | 6.38 | 4.66 | **0%** | 0% | 28.5 | **10.51** | 2% | 8% |

**Refusal spectrum — exact, every decision in all 192 games.** Refusals sum to **1.000×
`plansEvaluated`**, so this is a complete partition of what happened to every plan the search
priced:

| cell | bot | plans/dec | **worth** | **rate** | bounds-inv | all other reasons |
|---|---|---|---|---|---|---|
| snake6 | material | 5179 | 58% | 42% | 0 | **0** |
| snake6 | territory | 4100 | 57% | 43% | 0 | **0** |
| snake5-queen | material | 2774 | 75% | 25% | 0.5 | **0** |
| snake5-queen | territory | 1663 | 85% | 15% | 61.8 | **0** |
| snake5-rook | material | 4218 | 81% | 19% | 0 | **0** |
| snake5-rook | territory | 2756 | 82% | 18% | 49.5 | **0** |
| snake5-knight | material | 4783 | 59% | 41% | 0 | **0** |
| snake5-knight | territory | 3904 | 60% | 40% | 0 | **0** |

`switch-dominance`, `switch-floor`, `ratchet-floor`, `ratchet-gap`, `nonconforming`, `crossfade`,
`sink`, `pin-unreachable` are **exactly zero in every cell**. Only three reasons are ever live and
two of them carry everything.

**Joint-space size** (product of per-unit capped option counts) against `maxJointsPerCluster: 512`:
median 9–486, **over 512 on 0–45%** of decisions (snake6 territory 45%, snake6 material 0%,
others 7–21%).

---

## 2. WHICH CAUSE DOMINATES WHERE

**The answer is board-class-specific, and the two classes are governed by different causes.**

### Sliders → cause (a), overwhelmingly and unconditionally

`sliderCandidateCap: 4` against a mean of **64.4 legal options for a queen** and **36.6 for a
rook**. `capBinds` fires on **100%** of slider decisions: **94% of a queen's options and 89% of a
rook's are discarded before anything is priced**, by a comparator (`gainOrderKey`) in which
nothing scales with weight. And the discarded set is not homogeneous — surviving-move room spread
is **21.6–23.7 cells**, the widest in the table. **The options being thrown away are the ones that
differ most.**

### Snakes and leapers → NOT cause (a), and NOT cause (b) either

`capBinds` is **0%** — with 2.5–2.8 legal moves against a cap of 8, every legal move is admitted
and priced. And the term is not flat: room spread across the compared set is **6.5–7.1 cells** for
snakes and **10.5** for the leaper, with zero spread on only **3–4%** of decisions.

So for the majority unit class, an inert weight is explained by neither admission nor absent
gradient. **What remains is the gates**, and the refusal spectrum says exactly which: `worth`
(57–85%) and `rate` (15–43%).

### And a cause nobody had: (e) RATE THROTTLE

**19–43% of every plan the search prices is refused by an emission rate limiter, not by a value
judgement at all.** No evaluator weight, at any setting, can move a plan refused for `rate`. This
is a fifth cause and it belongs in the taxonomy beside (a)/(b)/(c):

> **(e) RATE-THROTTLED — the plan may have been better; it was refused because the bot had emitted
> too recently.**

It is also the cheapest thing on this list to test: the throttle is a policy, not a discovery.

---

## 3. THE POTION DECOMPOSITION — the number that decides two remedies

**Exact, no proxy: a potion sat at a legal destination on 427 of 5,227 unit-decisions = 8.17%.**
(Every sampled decision had at least one potion on the board, so this is not a scarcity-of-potions
artefact — it is a scarcity of *reachable* potions.)

And `mechanism.flags` confirms `potionOrdering: false` for both bots in **all four cells**, so this
corpus is exactly the pre-ordering condition the 4×-weights sweep ran in.

**Therefore the 4×-weights null decomposes as: ~92% cause (b), by sparsity.** On 91.8% of
decisions the potion term has *identically zero* spread across the candidate set, because no
candidate destination holds a potion. A weight multiplying a term that is zero on every option is
inert at any multiple — flat at 1×, flat at 4×, flat at 100×.

**This corrects an earlier convergence, and the correction changes a remedy.** I had accepted the
identification that the weights-null and the potionOrdering win are the same admission fact. **On
snake boards that is wrong**: the per-unit cap never binds there, so a potion destination is
already in the priced set whenever it is legal. Admission is not what was failing.

What `potionOrdering` can therefore change on snake boards is **not per-unit admission** but (i)
which joint gets enumerated under the 512 cap — live on 0–45% of decisions — and (ii) which plan
becomes the incumbent, since the incumbent is what survives when `worth` refuses everything else.

**Remedies for the two standing verdicts:**

| verdict | cause | remedy |
|---|---|---|
| "4× potion weights do nothing" | **(b) sparsity — the term is zero on 92% of options** | Not a weight problem and not an admission problem. The only way a potion term can matter is if potions are *reached more often*, which is what seeking does. Withdraw "volume is not the lever" as untested; the sweep was measuring a term with no support. |
| "potionOrdering wins +55% pickups, free" | changes joint enumeration / incumbency, not per-unit admission | Keep as a **support** finding. Its own value question was then answered by k5 — and consistently: raising reachability raises pickups, and the windows had no fat account to spend on. |

The two results are consistent and neither is evidence about potion *value*. **k5 remains the only
measurement that bears on value, and it stands.**

---

## 4. WHAT THIS INSTRUMENT CANNOT DO — and one artefact I caught in it

**Caught and fixed before publishing.** My first `room` proxy was a bounded flood fill capped at 60
cells. On an open 25×25 board almost every destination reaches the cap, so it reported **93–100%
zero spread** — which would have said cause (b) dominates everywhere. That was **cap saturation,
not flatness**. Replacing it with a horizon-4 strict-first-arrival count (the actual shape of
plane-1 `room`) reverses the reading to 3–4% zero spread. This is the fourth instrument artefact
found in this program's numbers, and the third in mine; the conservation-style defence I proposed
after the clock bug would not have caught it, but a **saturation check — does the statistic ever
hit its own bound?** — would. I would add that to the same standing rule.

**Genuine limits, stated so the table is not over-read:**

1. **`room` here is a proxy.** The shipped feature is two-plane with held-unit exemptions and piece
   displacement. Spread magnitudes are indicative; the *pattern* across classes (sliders ≫ snakes,
   near-zero rare) is robust to the proxy, the absolute cell counts are not.
2. **I cannot separate (b) from (c) inside the `worth` bucket.** That needs per-plan margins at the
   point of comparison, which only bot instrumentation gives. What I can say is that (b) is largely
   excluded for territory (spread is real) and largely confirmed for potions (spread is zero on
   92%), so the residual inside `worth` is (c) for territory.
3. **The geometry is sampled** (every 7th turn, 10 games/cell); the refusal spectrum is not — it
   covers all 192 games.

---

## 5. THE ONE-LINE READING

> **Admission is a slider problem and only a slider problem** — 100% of slider decisions discard
> ~90% of their options, and the discarded ones are the most differentiated. **For snakes and
> leapers nothing is discarded and the territory gradient is real, so their inert weights die at
> the gates instead** — `worth` (57–85%) and, unexpectedly, a `rate` throttle nobody had in the
> taxonomy (15–43%). **The potion weights null is neither: it is a term with no support**, zero on
> 92% of options, and no weight can scale a zero.
