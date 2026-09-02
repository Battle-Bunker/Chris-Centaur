# PRIOR ART 7 — Battlesnake and Tron community practice, as a member mine

Domain: the closest living relatives of our game — competitive snake bots and
Tron/light-cycle bots — read not for architecture but for **members**: concrete,
seatable functions for the ACTION, VALUE and REDUCTION joints, each with a
community track record and a stated rationale. Per ruling 49 these are exactly
what the joint machinery is supposed to be able to hold.

It also contains one finding that argues against the program's recent direction.

---

## 7.1 Load-bearing sources

**S19. a1k0n (Andy Sloane), *Google AI Challenge (Tron) post-mortem*, 2010** —
the winner's writeup. Voronoi evaluation, regression-fitted node/edge
coefficients mined from historical games, the checkerboard parity bound, and the
articulation-point chamber tree.

**S20. Battlesnake official *Useful Algorithms* guide + the competitive-bot
corpus** (`xtagon/awesome-battlesnake`; coreyja's *Minimax in Battlesnake*;
tournament winners such as Orion's Fang, RBC 2023 — "paranoid Minimax with
alpha-beta, up to 7 steps ahead, flood fill and **edge control** scoring").

---

## 7.2 The members, with rationale and provenance

### V-1. Voronoi territory difference (VALUE — reach family)

For each cell, decide which player reaches it first; the heuristic is the
difference in counts. a1k0n's phase-2 evaluation, and the standard
space-evaluation in Battlesnake. **Status in LOBSTER:** we have this
(`reach`/voronoi). Confirmed as the right family by the winner of the direct
ancestor tournament.

### V-2. Nodes AND edges, with fitted coefficients (VALUE — new, and it
contradicts a shipped number)

a1k0n mined "hundreds of thousands of historical games" and fitted

    predicted endgame difference  ≈  K₁·(N₁ − N₂)  +  K₂·(E₁ − E₂)

with **K₁ ≈ 0.055 (nodes/cells) and K₂ ≈ 0.194 (edges)** — the *edge* term
carries ~3.5× the weight of the cell term. The interpretation: raw reachable-cell
count over-values a wide-open region and under-values *connectivity*; degrees of
freedom predict the endgame, not area.

**This is a direct hit on `room`.** Our `room: 3` is a cell count. The VALUE lens
established that its *coefficient* is wrong by a computable factor
`(K/W)(1−p)·w_u`. a1k0n's result says the *quantity being counted* is also wrong:
the predictive object is (cells, edges) with the edge term dominant. Two
independent corrections to the same term, from two different directions, neither
of which knows about the other. And note the methodology matches ours exactly —
regression on a mined replay archive, no new games — so it is reproducible on our
corpus this week. His own honesty note travels with it: the model was "pretty far
from absolutely great, and only a little predictive."

### V-3. The checkerboard parity bound (BOUNDS — sound, free, and we lack it)

Movement alternates between the two colours of a checkerboard, so a snake
starting on a red cell can visit at most `min(R, B) + 1`-ish cells in a chamber,
not `R + B`. Counting the two colours separately gives a **strictly tighter upper
bound** on reachable territory at no cost. This is not a heuristic; it is a
*proof*, and it belongs in the bounds bank's B-rung family rather than in an
evaluator. It applies to every trail unit on our board and is one of the few
free improvements in this entire survey.

  (Caveat to check against our rules: our board has sliders, jumps and
  wrap/edge rules that may break the bipartite argument for non-trail units.
  The bound is for trail units, where movement is 4-adjacent.)

### V-4. The articulation-point chamber tree (VALUE/ACTION — the biggest single
member)

Find the cut vertices of the free space; the removal of a cut vertex decomposes
the remaining region into **chambers**; evaluate the chamber tree recursively.
a1k0n's rule, quoted: *"if a chamber borders the opponent (a battlefront), ignore
its full size but count steps to enter it; otherwise, count the full chamber."*
He reports the version with the chamber tree beat the version without it **12–1**.

**Why this fits our carve unusually well:** we already compute a component
decomposition of the board — `cluster-partition.ts` / `ConflictIndex` — for a
different purpose (joint enumeration). The chamber tree is the same class of
object (a decomposition by connectivity) evaluated for a different question
(how much space is really reachable). Building it is largely re-use, and it
supplies the missing *shape* of the `room` family that V-2 says is wrong.

### V-5. Tail-chase as a hard invariant (ACTION — closure, kernel-side)

The community's canonical safety rule: keep a path to your own tail. It is a
*set closure*, not a preference — a plan with no path to the tail is (modulo
food-growth timing) a delayed self-kill. It belongs in the same category as our
`tier` (safe/atRisk/doomed) lattice bottom, which the VALUE lens correctly
refuses to give a coefficient. Worth checking whether our staging-safety layer
has an equivalent; if not, it is a member of the ACTION closure family.

### R-1. Paranoid vs MaxN (REDUCTION — the second member the joint needs)

The multiplayer reduction question in its standard form. **Paranoid**: all
opponents are assumed to be coordinating against me (i.e. a two-player zero-sum
projection). **MaxN**: each player maximises its own score; the tree returns a
vector. Battlesnake bots ship both; the winners tend to ship paranoid with
alpha-beta because it prunes and MaxN does not (MaxN's pruning is weak — a
known result).

**Why this matters here:** the composition lens's chief refusal is "no joint with
one member", and REDUCTION currently has exactly one. This supplies a second,
with a track record, and it lands precisely on the VALUE lens's finding that the
symmetric `(ours − theirs)` balance is *definitionally* wrong on three-team
boards. Paranoid and MaxN are two different answers to that same question, and
the asymmetric share fold `(K/W)(1−p)` vs `(K/W)p` is arguably a *third* — a
share-weighted MaxN. Seating all three as members of one joint is the clean
carve, and it turns the value lens's M1 from "a bug fix" into "a member
selection".

### A-1. Time management at the ply boundary (ECONOMY — third statement of the
contract/interruptible law)

a1k0n: when the time budget expires, *"you have to throw away the ply you're in
the middle of searching and use the best move from the previous ply."* That is
Zilberstein's contract-algorithm behaviour observed in the wild, from a
tournament winner, arrived at by necessity. It is the third independent
appearance of domain 2's C6 (see also the greedy incumbent in `cluster-enum.ts`)
and it should settle the question: **the incumbent-from-the-last-completed-level
is the interruptibility witness, and it is load-bearing, not a fallback.**

---

## 7.3 The finding that argues against the program's direction

**C24. The Tron winner's stated conclusion is that evaluation beats depth in this
game family — and he gives the mechanism.** a1k0n: *"a better evaluation
heuristic will always beat deeper minimax searches"*, because deep searches over
a flawed evaluation make **self-deluding decisions about opponent behaviour** —
the search finds a line that looks good only because the leaf evaluation is
wrong, and then commits to it with more confidence the deeper it went.

Set this against the program's record: the depth landing was named "the session's
core goal"; `chosen.horizon == 1` in every telemetry record across all three
cells, 5,000+ decisions per bot per cell; and the VALUE lens's own finding is
that the shipped evaluator is weight-blind, mis-scaled by ~15× on `room`, and
definitionally wrong on three-team balance. **In the one game family with a
public tournament record, the winner's verdict is that our current ordering of
investments is backwards**, and the mechanism he names (deeper search amplifying
a wrong leaf) is a *specific prediction* about what depth would do to our current
evaluator, not a general preference.

This does not say depth is wrong to build — it says the ordering of the
falsifiers matters. It is testable cheaply on the existing corpus: hold the
evaluator fixed and vary `plyCap`; if the depth-effect rate is flat or falls, the
leaf evaluation is the binding constraint, exactly as he predicts. That is
*already* the composition lens's B7 falsifier, written for a different reason
(double-charged pessimism). One experiment, now three hypotheses — and if the
depth-effect rate falls with plies, all three literatures (a1k0n, the
interval-dominance-under-dynamics result from domain 3, and B7's
double-pessimism) predicted it.

Two honest counterweights, stated so this is not overclaimed:
- Tron is a *pure* space game; our board has material, potions, promotion and
  three teams, which are precisely the features a shallow evaluator cannot see
  and depth can. His result may not transport past the space channel.
- His endgame *did* use iterative-deepening exhaustive search, so his claim is
  about the midgame heuristic phase, not about search in general.

---

## 7.4 Verdicts the lens agents can act on

- **VALUE (three concrete members, one reproducible today):**
  - Refit `room` as `K₁·cells + K₂·edges` on our replay archive; a1k0n's
    coefficients (0.055 / 0.194, edges 3.5× nodes) are the prior. This is the
    same methodology as the k fit and needs no new games. If the edge term
    dominates on our corpus too, the `room` correction is *two* corrections, not
    one, and the value lens's M4 is incomplete as written.
  - Add the **checkerboard parity bound** to the bounds bank for trail units. It
    is sound, free and strictly tighter than a cell count.
  - Build the **articulation-point chamber tree** on top of the existing
    component decomposition; a1k0n reports 12–1 for it in the ancestor game, and
    it is the shape the `room` family is missing.
- **COMPOSITION:** REDUCTION gets its second and third members —
  {paranoid, MaxN, share-weighted asymmetric fold} — which satisfies the chief
  refusal and turns the value lens's "definitionally wrong balance" from a bug
  into a member selection with an experiment attached.
- **TIME:** a1k0n's ply-boundary rule is the third independent statement that the
  last-completed-level incumbent is the interruptibility witness. Stop treating
  it as a fallback.
- **OWNER-FACING (C24):** the winner of the closest public tournament states that
  in this game family a better evaluation beats a deeper search, and names the
  mechanism (deep search over a wrong leaf is self-deluding). Our evaluator is
  measured as weight-blind, mis-scaled and definitionally wrong on three teams,
  and our depth work is the flagship. The existing B7 experiment (hold ε and the
  evaluator fixed, vary `plyCap`) tests this for free and should be run before
  more depth investment.
