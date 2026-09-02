# Reconciliation with the premise lattice (design/joints-composition), and the anticipatory-meet correction

Cycle-4 note. Reads `docs/design/joints/01-PREMISE-LATTICE.md` on
`design/joints-composition` and adopts its vocabulary (premise as index,
fiber as content, join = widening, meet = priced narrowing) as it adopted
the epistemics lens's. This note does three things: places the worldline's
objects in their lattice, contributes the TIME axis their base space lacks,
and issues one correction without which the lattice forbids ponder.

---

## 1. Placement — the identification, tested from the time side

| worldline object (time lens) | premise-lattice object (joints lens) | verdict |
|---|---|---|
| hypothesis (frontier + assumed determinations) | a premise point stronger than the actual one | **same thing** — `basisOf` is the id serialization both name |
| hypothesis table | the populated fibers | same thing |
| promotion (assumed became fact) | reality supplying a meet at price zero | same thing, and their frame names it better (§2) |
| citation `coords` | the SUPPORT-INDEX coordinates of the declared read-set | same thing |
| `evalVersion` (§7 of time-worldline) | CONFIG-INDEX (`bot`) | same thing — dial demotion is a CONFIG-coordinate change |
| `frame` (computed-term set) | their §3 fourth tag | **theirs is a real gap in my ReadSet — adopted**, sketch updated |
| tranche/grant/ledger | absent from their base | **my contribution back** — the MEASUREMENT-INDEX of when/what was spent is what makes fibers replayable |
| `observe`/advance/door | absent — their lattice is per-decision static | **my contribution back** — §3 |

## 2. The correction: a meet has TWO purchases, and ponder is the second

The lattice's price list (their §2) assigns the reducibility tag rows:
compute-purchasable (VOI prices it), observation ("not purchasable this
turn, at any budget"), simultaneity ("never; only the measure coordinate
can move") — and concludes an unpurchasable meet has NO price row, so "the
economy simply never offers that work item."

Applied naively, that rule forbids the entire ponder programme: every
ponder target is a fiber under a simultaneity narrowing (an enemy reply
premise) that nothing can purchase before the resolution. Yet pondering it
is the owner's named priority and demonstrably coherent. The resolution of
the tension is that a meet supports two DISTINCT purchases:

1. **Buying the narrowing itself** — making the world smaller in fact.
   Priced by the reducibility tag; genuinely impossible for the
   observation and simultaneity rows. Their rule is exactly right here:
   VOI-as-narrowing is undefined for those rows and must never be offered.
2. **Computing under the un-bought narrowing** — populating the fiber
   BEFORE its premise is met, holding the results conditional. Always
   available, at ordinary compute price; pays off only if reality later
   supplies the meet (promotion), so its value is discounted by the
   hypothesis weight AND denominated in a different good: not width
   removed but REACTION LATENCY gained (the branch is explored when the
   determination lands).

Call the second an **anticipatory meet**. The economy's table then reads:

| tag | narrowing purchasable? | anticipatory compute? | value currency |
|---|---|---|---|
| compute | yes — VOI | (identical to buying) | width removed |
| observation (fog) | no | yes, across candidate reveals | reaction latency × weight |
| simultaneity | no | yes, across reply hypotheses — THIS IS PONDER | reaction latency × weight |

Two structural notes that keep this honest under ruling 13: the weights for
the simultaneity row come from the W0–W2 rungs today (witnesses,
cover-counting — no learned model), and anticipatory value NEVER enters the
fiber it anticipates as sound content before promotion (the lattice's own
fiber discipline enforces this for free: the results live in the stronger
premise's fiber and comparison across fibers is refused).

Without the two-purchase distinction, the lattice and the ponder design
contradict; with it, ponder is not a mechanism at all — it is the economy
choosing anticipatory meets when no agent is attached and refine meets when
one is. One economy, one table, both columns.

## 3. The time axis: the lattice needs a third operation

Join widens within a turn's lattice; meet narrows within it. A turn
resolution is NEITHER: it transports every fiber to the NEXT turn's
lattice — clouds dilate (join-like on the support), realized facts arrive
(meet-like, price zero), and the value function's board moves (the horizon
label decrements on carried readings). That transport is exactly
`continueFrom` (the door), and its algebra is the rebase-transfer rules:
values do not survive transport (re-walk, never splice); attention and
identity do; sigma ledgers pop the resolved ply; fibers whose premise the
transport contradicts die.

AMENDED by the prior-art pass (`time-prior-art.md` A1.1, the AlphaZero
tree-reuse / KataGo re-denomination precedent): the no-values rule is
scoped, not absolute — a value crosses ADVANCE iff its premise is
point-exact at the new frontier (an exactly-matched full-joint hypothesis,
ply-1-resolved), its evalVersion is unchanged, and no citation names a
spawn-patched cell. Everything with clouds, advisory ceilings or I7/I8
residue in its premise — i.e. everything rebase-transfer's three reasons
actually cover — still carries attention only.

Naming ADVANCE as a first-class third operation matters for the same
reason join and meet mattered: every existing cross-turn behavior is an
instance (ponder harvest, carry matching, fog dilation-and-intersection,
stepCost carry-forward), and code that improvises transport per store is
the bug class the lattice exists to forbid — a fiber silently compared
across a turn boundary is the exact smuggling rebase-transfer DILEMMA 1
documents as guarded only by convention. The declared read-set's `coords`
carry turn indices precisely so ADVANCE can be mechanical: transport keeps
a store iff its coords survive (positions re-derived, actions resolved,
spawn cells patched), demotes horizon labels, and otherwise kills.

## 4. What the merged discipline looks like (one record, five readers)

Adopting their four coordinate groups plus this document's two:

    Declared read-set = ⟨ SUPPORT-INDEX (incl. per-coord turn stamps),
                          OBSERVABLE-INDEX (horizon, frame),
                          MEASURE-INDEX (weightId | quantifier | α),
                          CONFIG-INDEX (evalVersion/bot, seat, schema),
                          TIME-INDEX (hypothesisId, targetTurn, phase) ⟩

Readers: comparison refusal (their L4, the bank's teeth); invalidation on
observe (time lens); ADVANCE transport (§3); dial demotion (CONFIG bump);
the measurement miner (refuse-unknown-coordinate — the depth-idle lesson
generalized). Five readers, one declaration, no second table anywhere.
