# Rollup stragglers — the five items of 19-per-lens-rollup §A not yet folded

Targeted pass over the librarian's per-lens rollup (design/prior-art @
b58a473, section A). Already folded and marked so there: VOI/QMDP (14 §2),
equilibrium third reading (12 §4), dilation + L2-G + terminology + weight-half
scope (14 §1), CSP/minesweeper + M37 (01 §5c), solution counting (02 §4c —
and MEASURED, 15-doc: canonical-weight claim refuted at v0), one-sided POSG
(12 §4), DESPOT ([?] in the rollup — settled by the 14 §5 commitment). The
five below were not.

## 1. [C] Γ-maximin cannot express "I now know more" (Troffaes, d3) — accepted, and the set already exists

Troffaes' point lands precisely: E-admissibility, maximality and interval
dominance shrink their optimal SET as beliefs sharpen; Γ-maximin selects a
single act even under complete ignorance, so a Γ-maximin reduction carries no
incentive anywhere to learn. Our ladder is Γ-maximin-SHAPED at the end: it
already computes the maximality-style object — the FLOOR-UNDOMINATED set
(the witness veto is literally interval dominance; `refutedAt(ceiling,
floor)` is the textbook test) — and then collapses it to one staged move by
est/tie. So the architecture has both halves and the collapse point between
them is now NAMED: everything upstream of the est rung is set-valued and
information-responsive (the set shrinks as S narrows and precision rises);
the single-move collapse is where Γ-maximin enters and where the two escapes
attach — the VOI flow (14 §2) rewards learning in the ACTION value, and the
maximality dual (12 §4's Centaur output: undominated plans with dominance
regions) keeps the set visible to the operator instead of collapsing it.
Consequence made explicit for the mechanism report: the SIZE of the
floor-undominated set per decision is the information-responsiveness
instrument (a set stuck at 1 under widening fog = the Troffaes symptom,
measurable for free from the adjudication counters).

## 2. [M] ε as a ledger, not a dial (Ganzfried & Sandholm, d15) — adopted as the APPETITE denomination

The rollup is right that this beats both options put to the owner in the old
dilemma 2 — and it slots into the post-ε-law shape (11 §A) better than into
the dilemma it was aimed at. After the ε law, ε̂ is a fitted calibration
constant (how much to trust w) and the one remaining dial is APPETITE. G&S
safe exploitation gives appetite its denomination: deviation from the floor
is financed by BANKED ADVANTAGE — `realised share − floor share`, one more
account in the currency the value lens already runs — and the operator's
control becomes a stake cap on that account ("you may risk at most X of
what the floor says we have already won"), which has an interpretable unit
where "what is your ε?" never did. The floor upgrades from a veto to the
ZERO OF A RISK ACCOUNT. Premise caveats, declared before anyone leans on the
guarantee: G&S's theorem is two-player zero-sum repeated play; ours is
multi-team and largely single-episode, so the imported object is the
ACCOUNTING IDENTITY and the cap semantics, not the exploitability bound —
within one game "banked" means the current sound floor's margin over par,
which is computable per turn from numbers the bank already holds. Interacts
with, never replaces, ε̂: calibration says how good the weight is; the
ledger says how much of the proven cushion may be staked on it.

## 3. [M] The gift detector (d15) — adopted as an instrument, ruling-13-clean

Deviation licensing needs the observable event: the enemy played something
that is no best response to any of our equilibrium-consistent options —
i.e., a GIFT. The rollup's implementation note is the important part: test
against OUR FLOOR COMPUTATION (re-price the enemy's played move against
their own security value with the bank we already have), not against a
dominated-move threshold, or most gifts are missed. Adopted as a
measurement: a `giftRate` column in the harness/replay-mining family (the
wire records every applied move; the bank can price it), feeding item 2's
ledger as its licensing event stream. Detection is instrument work on
logged data; ACTING on gifts is exploitation and stays parked under ruling
13 with the rest of the adaptation rungs.

## 4. [M] The public state as the only legal game-decomposition boundary (d12) — folded into the M37 rider

M37 (01 §5c) split decomposition-of-inference (exact, by shared variables)
from decomposition-of-game (approximate, by geometry). d12 sharpens the
second half: once positions are sets, GEOMETRY is not even a well-defined
cut — two units whose clouds overlap are entangled wherever their true
positions are, and the only boundary that survives fog is the PUBLIC STATE
(what all players commonly observe). For the game side this is the search
lens's D4 to own; the belief-side obligation folded here: the entanglement
inputs the partition reads (`influenceOf` on clouds) must come from the
store's hulls, and the partition's premise records the conditioning depth
those hulls had — which the C-B2 disposition (12 §7: narrowed → coarse
stays sound, refresh on observation) already gives the machinery for. One
sentence added to 01 §5c to carry the pointer.

## 5. [M] Belief(observer) indexed on the operator (Miller, d10) — accepted as the deferred framework's hook

Miller's finding: the explainee's beliefs are part of the explanation. The
constructor Belief(observer) exists for an adversarial reason (the enemy's
S over our hidden units); the observer axis costs nothing to leave OPEN,
and `observer = operator` is precisely the hook the deferred
human-legibility framework (owner ruling 44's LATER) will need: what the
operator has been shown and can currently believe is a belief object over
the same worlds, and briefing becomes conditioning THAT object rather than
printing state. Nothing is built now — recorded so that when the
legibility framework lands it arrives as a CONSUMER of an existing
constructor rather than as new epistemics, which is the same reuse test
the enemy-mirror passed (03 §3).
