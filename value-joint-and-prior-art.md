# THE VALUE JOINT — members, provenance, and what four expert traditions already know

Second pass, written to rulings 49 and 50. The first pass (`value-algebra.md`, `SYNTHESIS.md`)
argued for a fold and fitted a coefficient. **Ruling 49 is right that this is not the
deliverable**, and this memo demotes it accordingly: the fold and `k` become *members* of a
VALUE joint with stamped provenance, seated beside the hand-set evaluator, not replacing it.

Sources inspected this cycle: KataGo (`searchparams.h`, `Search::getScoreUtility`, the
self-play paper's re-centering rule, shipped configs), Stockfish NNUE (accumulator, HalfKP,
refresh, Finny tables), Ng–Harada–Russell potential-based shaping and its follow-ups,
Texel/Gaviota/Ethereal tuning practice, and the Battlesnake corpus (docs, competitive bots, and
Schier & Wüstenbecker's maxn paper).

---

## 1. THE MEMBER SCHEMA — three provenance coordinates

The joint is not "which evaluator wins". It is a registry in which heterogeneous members
coexist and are *comparable because their provenance is explicit*. Three coordinates do the
work, and each of them earns its place by separating members that behave differently under
pressure.

```
Member {
  contribution   how it scores a position
  denomination   weight-share | cells | weight×10 | boolean      -- §1.1
  invariance     potential-based | heuristic | lattice           -- §1.2
  provenance     derived | fitted(corpus, lineage, n) | hand-set(rationale) | operator
}
```

### 1.1 Denomination — why the cliff inequality exists

Members in different units cannot be summed without a conversion, and when nobody supplies one
a hand-set guard appears to stop one outbidding another. That is exactly what
`CLIFF_MATERIAL_WEIGHT` is (`calibration.ts:106`): `material` is in weight×10, `reach`/`room`
are in cells, and the inequality is the missing unit conversion wearing a strategy costume.
Denomination is therefore a first-class coordinate: **two members in the same denomination add;
two members in different denominations need a declared conversion, and the joint should refuse
to fold them silently.**

### 1.2 Invariance — a type distinction with a theorem behind it

This is the coordinate I did not have last cycle, and it is the strongest thing in this memo.
See §2. Three values:

- **potential-based** — the contribution is `Φ(s′) − Φ(s)` for some state function `Φ`.
  Policy-invariant: *safe at any weight, on any board.*
- **heuristic** — an ordinary state feature. Its weight **can** change the optimal policy.
  This is the class that needs a trade-safety guard.
- **lattice** — not a number at all (`SafetyTier`'s `doomed`; `DEAD` as a bottom applied by
  replacement). Cannot take a coefficient without a category error.

### 1.3 Provenance — and my own member is demoted by it

Ruling 49's concern is that a number fitted on one bot lineage's games carries that lineage's
distortions. Applying it honestly to my own work splits it in two:

| part of my proposal | provenance | ruling-49 exposure |
|---|---|---|
| the fold's coefficients `(K/W)(1−p)` on ours, `(K/W)p` on theirs | **derived** — an identity from `sharePar = K·w/W`, confirmed at exactly 2.00 on three cells | **none.** No games were used to obtain it; games could only have contradicted it |
| `k = 1.227` | **fitted** (corpus: R1 ladder; lineage: one; n = 144) | **full.** This is precisely what ruling 49 should distrust |

**So I tested the version with no fitted content at all.** Forcing `k ≡ 1` — a pure accounting
identity, zero parameters, nothing learned from any game:

| model | R² | snake6 resid | queen resid | knight resid |
|---|---|---|---|---|
| **k ≡ 1 (zero fitted content)** | **0.9371** | +0.272 | +0.079 | +0.013 |
| k = 1.227 (fitted, one lineage) | 0.9703 | −0.035 | −0.025 | +0.002 |

**The zero-parameter member captures 93.7% of the variance; the entire fitted contribution is
the remaining 3.3 points.** That is the ruling-49-compliant form: seat the identity member with
no provenance debt, and seat the fitted refinement *beside* it as a separate member carrying its
corpus, lineage and n — so that a later, more diverse corpus can retire the second without
touching the first.

I would go further and say this is the general shape the joint should prefer: **decompose a
proposed member into its derived part and its fitted part, and register them separately.** The
derived part is not a strategy at all — it is arithmetic about the scoreboard — and it should
never be hostage to the credibility of a regression.

---

## 2. THE FOLD IS A POTENTIAL FUNCTION — and Ng's theorem then gives a safety guarantee

Define the state potential

    Φ(s) = K · w_ours(s) / W(s)          — i.e. the CURRENT sharePar.

Differentiate: `dΦ = K[dw/W − w·dW/W²] = (K/W)[dw − p·dW]`, and with `dW = dw + dw_others`,

    dΦ = (K/W)[ (1−p)·dw_ours − p·dw_others ]

**That is exactly the fold, term for term.** The fold is not a model of the score; it is the
differential of the score. Which means the per-turn contributions **telescope**:

    Σ_t dΦ_t  =  Φ(terminal) − Φ(initial)  =  sharePar − (a constant)

This explains the high R² properly, and it is a better explanation than "the basis is
complete": the fold is a path integral of the objective, and the residual is second-order
curvature plus the elimination discontinuities. I should have seen this last cycle and said so.

**Now the theorem.** Ng, Harada & Russell (1999) prove that shaping a reward with
`F(s,s′) = γΦ(s′) − Φ(s)` is **necessary and sufficient for policy invariance**: the optimal
policy, and the ordering of policies by return, are unchanged. Our case is the cleanest
possible instance — `γ = 1`, and the true reward is sparse (zero until the terminal `sharePar`).
Because `R_terminal = Φ(s_T)` *exactly*, the dense fold used **alone, with no terminal bonus**,
telescopes to the true objective up to the constant `Φ(s_0)`. (The usual episodic caveat —
potential-based shaping is only exactly equivalent when `Φ(terminal) = 0` — is satisfied here
in the stronger form that the terminal potential *is* the terminal reward, so the substitution
is exact rather than merely unbiased.)

> **Result. A member whose contribution is the share-fold is policy-invariant: it cannot change
> optimal play at any weight, on any board. What it changes is only the quality of
> finite-horizon approximation.**

Three consequences that matter for the joint machine, not just for my member:

1. **It gives the joint a safety classifier that is a theorem rather than a convention.** A
   potential-based member is safe to dial to any value — no trade-safety inequality needed,
   because it provably cannot reorder optimal policies. A heuristic member is not, and the
   cliff exists for it. That is what the `invariance` coordinate buys.
2. **It says precisely what the fold is *for*, and it is not "being a better evaluator".** At
   infinite depth it does nothing at all — that is the theorem. Its entire value is at *finite*
   depth, where a dense potential carries information a sparse terminal reward cannot. Given
   `horizon == 1` throughout production, **this system is the maximally myopic case, which is
   exactly the regime where potential-based shaping pays most.** That is a much better argument
   for the fold than my R² was, and it is an argument from theory rather than from one lineage's
   games.
3. **It bounds the claim honestly.** Policy invariance means the fold cannot make the bot play a
   *different* optimal strategy — so anyone hoping it will unlock new behaviour should not.
   It makes a myopic searcher approximate the true objective better. Nothing more.

**And it hands the hand-set evaluator a real defence, which ruling 49 asks me to take
seriously.** `reach`, `room` and `command` are *not* potential-based. That is not a defect: a
non-potential member can encode knowledge the potential cannot see — specifically,
*predictions* about flows that have not happened yet. The fold prices weight that has **already
moved**; `room` predicts weight that is **about to move**. Those are complementary, and the
right architecture seats both. A joint containing only potential-based members would be a
perfect accountant with no foresight.

---

## 3. KataGo — the tradition that already lives with our exact metric

KataGo optimises a utility over *score margin*, not just win probability. That is our
sharePar-vs-winning tension, in a mature engine, and the shape of their solution is
instructive because it is not what a first-principles reading suggests.

From `searchparams.h` and `Search::getScoreUtility`:

```cpp
winLossUtilityFactor       // scaling for [-1,1] win/loss
staticScoreUtilityFactor   // [-1,1] score value, centered at 0
dynamicScoreUtilityFactor  // [-1,1] score value, centered at RECENT EXPECTED SCORE
dynamicScoreCenterScale    // 1.0 ≈ score cared about up to board-size

staticScoreValue  = expectedWhiteScoreValue(scoreMean, scoreStdev, 0.0,               2.0);
dynamicScoreValue = expectedWhiteScoreValue(scoreMean, scoreStdev, recentScoreCenter, dynamicScoreCenterScale);
return staticScoreValue*staticScoreUtilityFactor + dynamicScoreValue*dynamicScoreUtilityFactor;
```

Four things they do that we do not, each answering a pathology:

1. **Score utility is BOUNDED, not linear.** `expectedWhiteScoreValue` squashes score into
   [−1,1]. A linear score objective will trade arbitrary risk for arbitrary margin; bounding it
   is what stops that.
2. **It is RE-CENTERED every search.** From the paper: *"At the start of each search, the
   utility is re-centered by setting x₀ to the mean μ̂ₛ of the neural net's predicted score
   distribution at the root node."* This is the fix for the pathology a bounded utility
   creates — saturation. Far ahead or far behind, a static bounded utility is flat and gives no
   gradient, so the engine plays slack moves. Re-centering restores an O(1) local gradient
   wherever the game actually is.
3. **It integrates over the score DISTRIBUTION, not a point estimate** — `scoreMean` *and*
   `scoreStdev` both enter.
4. **Score is a MINORITY of the utility.** Shipped: `staticScoreUtilityFactor = 0.1`,
   `dynamicScoreUtilityFactor = 0.3` for play (`0.0 / 0.3` in self-play training), against a
   win/loss factor of order 1. Roughly a quarter of the utility, and the *dynamic* term carries
   three times the *static* one.

**What this says about our fold, and it is a real criticism of it:**

- **Our fold is linear and has no variance term.** `scoreStdev` has no analogue. Given that I
  measured the score's dominant nonlinearity to be elimination — a discontinuity — two positions
  with equal `E[share]` and different variance are genuinely different, and the fold cannot tell
  them apart. This is the most concrete gap KataGo exposes.
- **Our fold does have a form of dynamic centering already**, and I under-appreciated it: the
  `(1−p)` and `p` factors *are* state-dependent re-weighting, recomputed from the live board
  each turn. That is structurally KataGo's dynamic center rather than their static one — which,
  note, is the term they weight three times higher.
- **But it still saturates in one direction.** As `p → 1`, `∂S/∂w_ours = (K/W)(1−p) → 0`: a
  dominant bot loses almost all incentive to grow, and its value landscape flattens into
  noise-dominated move ordering. That is precisely KataGo's slack-move pathology, and it is
  reachable in our games — territory scored exactly 1.000 in the no-slider budget cells, and
  `bl-findings` flagged that as *"a saturated measurement"*. The saturation is in the utility,
  not only in the scoreboard.
- **And the minority-weighting is a live warning.** The mature engine in this space gives its
  score term ~25% of the utility and keeps a win/loss term dominant. Seating a pure-share member
  at weight 1 with nothing beside it is not the configuration the prior art converged on.

**Member candidates this yields:** `share-recentered` (the fold, rescaled so the local gradient
is O(1) at the current `p` — KataGo's dynamic center, transplanted); `share-variance` (a member
reading the spread of terminal share, not its mean); `elimination-probability` (our analogue of
their win/loss term — the discontinuity, priced directly rather than through its effect on the
mean).

---

## 4. NNUE — and the answer to a measured negative result in this program

NNUE's efficiency comes from one architectural commitment: the first layer's output (the
*accumulator*) is **incrementally updated** on each move, because only a tiny fraction of input
features change. HalfKP features are king-relative, so a **king move invalidates every feature
and forces a full refresh** — accepted deliberately, because king moves are rare enough that the
average update cost stays low. When refreshes did start to hurt, Stockfish did not abandon
incrementality; it added **Finny tables** (per-thread caches of accumulators bucketed by king
square, so a refresh *diffs against the nearest cached entry* instead of rebuilding from
scratch).

Map that onto the flows:

| quantity | changes per candidate plan | NNUE-shaped? |
|---|---|---|
| per-unit account balances `w_u` | one unit's balance | **yes — exactly the accumulator case** |
| share state `(K, W, p)` | one add/subtract per changed balance | **yes, trivially** |
| ray crossings from a destination | one unit's rays | **yes** |
| the territory partition | **~70% of the board changes owner** | **no — this is the king move** |

This matters because the program has a measured negative on incrementality: *"every one of our
units moves in every candidate plan, so ~70% of the board changes owner between plans, and 11–13
tower swaps at 0.8–1.9 µs each cost more than the 3.6–11.5 µs full fold."* **That measurement is
about the partition specifically, and it has been generalised too far.** The account-balance
half of the value computation is the sparse case, is exactly NNUE-shaped, and has never been
measured.

And for the partition — the dense case — NNUE's own answer is not "recompute": it is Finny
tables. **Cache the partition for a reference joint plan and diff each candidate against it**,
rather than choosing between full recompute and incremental-from-previous. Given `mine16`'s
finding that the queen board runs at 216 plans/decision against snake6's 3,458, this is where
throughput is actually scarce and where the technique would pay.

One more transplant: NNUE keeps **one accumulator per perspective** (side to move / not). Our
analogue is one per **team** — three of them — since share is inherently a per-team quantity and
the transfer channel needs the other teams' balances anyway.

---

## 5. TEXEL TUNING — how engines solved ruling 49's problem decades ago

Ruling 49 says bot-vs-bot numbers are potentially distortionary: one lineage, low config
density, scoring-path dependence. Computer chess hit this in exactly this form and the practices
that emerged are directly transplantable.

The base method (Österlund, 2014; Ballicora 2009 earlier): take a large corpus of positions
labelled with game outcomes, and minimise
`E = (1/N) Σ (result_i − sigmoid(qScore(pos_i)))²` over the eval coefficients. What matters for
us is not the regression but the **four hygiene rules around it**, each of which is an
anti-distortion measure:

1. **Do not draw positions only from your own lineage.** Practitioners pull from CCRL, CEGT and
   other engines' game archives — heterogeneous opponents by construction. mACE's writeup is
   explicit: *"I collected a large set of games from the internet (CCRL, CEGT and others)."*
   **Our analogue, and we can have it without a second engine:** manufacture position diversity
   rather than opponent diversity — random-legal rollouts, perturbed openings, scripted
   adversaries, and the `reflex` agent (which is genuinely not the same lineage as the
   searchers). Position diversity is the thing being bought; another engine is only one way to
   buy it.
2. **Label with a stronger signal than the thing being tuned.** Grant's method samples
   positions, runs a *high-depth* search from each, and labels with the terminal position of the
   principal variation — so the label does not inherit the shallow eval's errors. **Our
   analogue:** label a position with the mean outcome of *many* rollouts, or of a
   longer/deeper one — never with the single game it came from, which is what my own k = 1.227
   regression did.
3. **Quiet positions only.** Exclude positions where tactics dominate, because the eval is not
   meant to be right there. **Our analogue is already named in our own vocabulary:** exclude
   positions where a `SafetyTier` lattice-bottom is doing the work. The value function should be
   fitted where value, not fatality, decides.
4. **Enormous N, and expect the per-position signal to be tiny.** 64,000 games, ~8 million
   positions. The recorded folk wisdom — *"tuning via self-play is extremely slow… chess can
   need up to 100,000 self-play games"* — is a direct warning about the scale at which our
   144-game regressions sit.

**Applying rule 2 to my own number, honestly: `k = 1.227` violates it.** It is fitted against
single-game outcomes from the same lineage that produced the positions. §1.3's `k ≡ 1` member is
immune to all four rules because it fits nothing; the fitted refinement should not be promoted
until it can be refitted under rules 1–3.

---

## 6. BATTLESNAKE — member candidates the joints must be able to express

The competitive corpus is a source of members, and the value of reading it is that it is a
*different* lineage than ours — the one thing ruling 49 says we lack.

| member | what it is | expressible in the flow algebra? |
|---|---|---|
| **flood fill / reachable space** | *"detect and avoid enclosed spaces a snake may not escape"* | yes — outflow (entrapment hazard) |
| **Voronoi** | BFS from all heads simultaneously; area controlled | yes — inflow; this is our partition |
| **food ownership** | Voronoi restricted to food cells | yes — inflow, per-food |
| **tail-chasing / coiling** | *"follow own tail when trapped in small space"* | **yes, but we have no member for it** — see below |
| **"fewest open spaces" packing** | prefer moves whose neighbours are tight, to fill space efficiently | yes — an inflow-efficiency member |
| **Safe / Risky / Lethal classifier** | labels every move **before** scoring | **not a flow — a lattice member** |

Three observations worth carrying:

- **Tail-chasing is a real member we lack, and it is sound in our rules.** A snake's body cells
  vacate as it advances (unless it just grew), so following your own tail is a provably
  non-terminating survival loop. It is *the* canonical snake-game survival primitive and there is
  no analogue anywhere in our evaluator. In flow terms it is a member that drives outflow hazard
  to ~0 at the cost of ~0 inflow — a pure survival floor, and under §3.1's account structure it
  is worth `(K/W)(1−p)·w_u` per turn to a *fat* account and almost nothing to a thin one. That
  makes it a strong candidate specifically on queen boards, which is where our measured
  weakness is.
- **A strong independent implementation puts a categorical safety classifier ahead of scoring**,
  exactly as our `SafetyTier` does and exactly as §1.2 argues it must. Independent convergence on
  the lattice member is decent evidence that the distinction is real and not an artefact of our
  codebase.
- **Others search deeper than we do.** Competitive bots run *"Minimax + α-β, depth 5–8"*; the
  academic treatment (Schier & Wüstenbecker, SKILL 2019) uses iterative deepening with **maxⁿ**
  for the N-player case plus a *locality* restriction — searching only players near the acting
  agent. Two things follow for us: our production `horizon == 1` is far below what this genre
  achieves; and with **three teams we are in maxⁿ territory, where α-β pruning is known to be
  much weaker than in two-player minimax** — a structural reason depth is expensive here that
  is worth handing to the TIME lens, since it bounds what their depth programme can buy.

---

## 7. WHAT I GOT WRONG LAST CYCLE

Stated plainly, since the mandate is iteration and not defence.

1. **I framed the fold as an empirical discovery. It is a derivative.** §2's telescoping is the
   honest explanation of the R², and it is both more powerful (a theorem attaches) and more
   deflationary (the fit was never the evidence) than what I wrote.
2. **I let `k` carry more weight than its provenance supports.** One lineage, 144 games,
   single-game labels — a violation of standard tuning hygiene that has been understood since
   2009. The `k ≡ 1` member at R² 0.937 is the version that should be seated.
3. **I proposed the fold as a replacement for hand-set coefficients.** Ruling 49 corrects this,
   and §2 supplies the reason it is *technically* wrong too: a potential-based member is
   policy-invariant, so it **cannot** do the job the heuristic members do. It prices weight that
   has already moved; they predict weight that is about to. The joint needs both.
4. **I claimed the trade-safety inequality dissolves under the currency.** Partly right, and now
   properly bounded: it dissolves *for potential-based members*, where the theorem removes the
   need for it. It does **not** dissolve for heuristic members, which is most of the existing
   evaluator. My earlier statement was too broad.
5. **My caveat "horizon 1 binds everything" cited the telemetry number as a measurement.** It is
   `?? 1`, a fallback constant (`kernel.ts:1384`), and the only `refinementView` implementer is a
   test double. The conclusion stands — there is no lookahead in production — but I quoted an
   artefact as evidence, which is the exact error this program keeps having to correct.

---

## 8. WHAT WOULD FALSIFY THIS PASS

- **§2's theorem is checkable, not rhetorical.** If a share-fold member is seated and changes
  the *ranking of policies* on any board — rather than only the ranking of moves under a finite
  horizon — then either the implementation is not `Φ(s′) − Φ(s)`, or `Φ` is not a pure state
  function. Both are testable directly.
- **§1.3's claim that the zero-fit member is enough.** If `k ≡ 1` and `k = 1.227` produce
  different *play* (not different R²), the fitted part is doing real work and its provenance
  problem must be solved rather than sidestepped.
- **§4's NNUE claim.** Measure incremental vs full recomputation for **account balances alone**,
  not for the partition. The existing negative result does not cover it. If balances are also
  cheaper to recompute, the accumulator analogy is dead.
- **§6's tail-chasing member.** Retrodict it: on the corpus, how often was a unit that died by
  entrapment or exhaustion one legal move from a tail-follow that would have survived? If the
  answer is ~0, the member is inert here regardless of how well it works in Battlesnake.

---

## 9. TAIL-CHASING RETRODICTED — a null, and the reason is structural

§8 pre-registered the falsifier: *"on the corpus, how often was a unit that died by entrapment one
legal move from a tail-follow that would have survived? If the answer is ~0, the member is inert
here regardless of how well it works in Battlesnake."* Run over all 144 games, snakes only,
counting a tail-follow as **available** when the unit's own tail cell is orthogonally adjacent to
its head and not occupied by another unit (an upper bound on "would have survived", since a third
party may contest the cell):

| cell | snake entrapment deaths | tail-follow available | share | weight preserved |
|---|---|---|---|---|
| snake6 | 373 | 23 | **6.2%** | 72 / 1321 = 5.5% |
| snake5-queen | 292 | 8 | **2.7%** | 30 / 962 = 3.1% |
| snake5-knight | 325 | 10 | **3.1%** | 38 / 1052 = 3.6% |

**The member is near-inert here, and the falsifier fires.** I would not build it.

**The reason is structural and worth keeping, because it generalises to the rest of the
Battlesnake borrow.** Snake death causes in our corpus, snakes only:

```
snake6         bodyBlock 142 | edge 108 | exhaustion 75 | wall 72 | contest 59 | self 51
snake5-queen   contest  275 | bodyBlock 190 | exhaustion 76 | edge 64 | self 25 | wall 13
snake5-knight  bodyBlock 182 | exhaustion 140 | edge 90 | contest 75 | self 37 | wall 16
```

Tail-chasing solves **self**-entrapment, which is 51 of 373 entrapment deaths on the null roster
and 25 of 292 on the queen board. Two shape differences drive it:

1. **Our snakes are short.** Mean final length 4–6, max 10, against Battlesnake snakes that grow
   past 20. A tail is adjacent to its own head only in a tight coil, which a length-5 snake rarely
   forms.
2. **Our boards are crowded with *foreign* bodies.** 18 units on 25×25, against 1–4 in
   Battlesnake. The dominant death mode is running into *someone else* (`bodyBlock`) or being
   hunted (`contest`, 275 on the queen board), neither of which a tail-follow addresses.

**The transferable lesson is about the borrow, not about this member.** A heuristic canonical in a
neighbouring game can be near-inert here for reasons of roster and board shape rather than of
quality, and the retrodiction cost nothing and settled it without a game. **Before importing any
of §6's other members, retrodict it the same way** — flood-fill and Voronoi are already ours in
some form, but "fewest open spaces" packing and the food-ownership variant should each face this
test first. On present evidence I would expect packing to fail for the same reason tail-chasing
did, and food-ownership to survive, since the growth channel is real and crowded boards make food
contested rather than irrelevant.
