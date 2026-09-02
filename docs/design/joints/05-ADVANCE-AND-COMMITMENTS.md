# Advance and commitments — the third operation, and the objects that survive it

Cycle 4 of the COMPOSITION lens. Absorbs the TIME lens's `advance` operation and
its anticipatory-meet correction; verified against `team-decision-engine.ts`,
`pins.ts`, `search/core.ts` @ `3090b77`, and `$SP/rebase-transfer-design.md`.

---

## 1. The finding: the bot is memoryless across turns, by construction

Cross-turn state on the engine is five things
(`team-decision-engine.ts:413-443`): the pin ledger, `stepCostMs`,
`latestTurn`, `dropsReported`, `matchSeed`. Everything value-bearing dies with
the decision — the search session is keyed by basis *and* requires the same
substrate object, and a new turn marshals a new substrate. The pin ledger
itself is turn-scoped by design: *"A new turn voids every pin and every commit
from the old one."*

So the bot has **no representation of anything that spans turns.** Five separate
asks on the record need exactly that one missing object:

| ask | source | what it needs to survive a turn |
|---|---|---|
| potion arm → collect → spend | DoF synthesis D6 ("nothing COMMITS to it"); owner rulings 9–10 | a 3-turn plan with precommitted targets |
| unit roles with hysteresis | DoF synthesis D5 (primary Centaur dial) | a unit→role map that does not re-shuffle every turn |
| per-enemy stance / truce | DoF synthesis D7 (second primary dial) | a stance vector keyed by team |
| within-game opponent adaptation | D2's adaptation machinery | a posterior over an opponent's habits |
| **re-entry after human indecision** | owner, verbatim: *"instantly recover where we left off … if the state pinned by human decisions returns to one that we had already done lots of computation on"* | an addressed map of what was already computed |

Five asks, one gap. That is the signature of a missing abstraction rather than
five missing features.

---

## 2. `advance` is a third operation, and it is not join or meet

`01-PREMISE-LATTICE.md` gave the lattice two operations: **join** (widening —
total, sound, free, lossy) and **meet** (narrowing — partial, priced). The TIME
lens is right that turn resolution is neither: it **transports every fiber to
the next turn's lattice**. Adopted, with its law:

> **advance(p, resolution) → p′.** Values never survive transport; identity,
> incumbency and attention do. A fiber contradicted by the resolution dies.
> Transport is one operation in one place — a per-store improvised transport is
> the smuggling bug class.

The precedent is already in the kernel, one level down: on a committed pin the
kernel replaces the basis object, clears `run.plans` outright ("plans proved
under the old pins are not comparable under the new ones"), repairs the wire
plan by splicing rather than rebuilding, and resumes a cached pin context when
the new pin set matches one it has seen. **Values dropped, identity and
attention retained, repair before refinement** — the shape the cross-turn design
needs, already implemented for the smaller boundary.

So the composition algebra is three operations, not two:

| operation | direction on the lattice | totality | price | what crosses |
|---|---|---|---|---|
| **join** (widen) | weaker | total | free | values, soundly |
| **meet** (narrow) | stronger | partial | §3 | nothing crosses — you recompute |
| **advance** (transport) | sideways, to next turn's lattice | total | free | identity, incumbency, attention — never values |

---

## 3. The meet has two purchase columns (TIME lens correction, adopted)

`01-PREMISE-LATTICE.md` §2 said an unpurchasable meet has no price row, so the
economy never offers that work item. Applied naively **that forbids ponder
entirely**, because every ponder target sits under a simultaneity narrowing
nothing can buy before resolution. The correction is theirs and it is right:

| purchase | what you buy | price | when unavailable |
|---|---|---|---|
| (a) **the narrowing itself** | move to the stronger premise for real | compute | impossible for `observation` and `none` rows — my original rule, unchanged |
| (b) **the anticipatory meet** | compute *under* the un-bought narrowing, held **conditional in the stronger fiber** | ordinary compute | never — but the value is reaction-latency × hypothesis weight, so it competes on the same ratio as everything else |

The reason (b) is sound needs no new machinery, and this is the strongest
confirmation the base/fiber split earns its keep: **an anticipatory meet is
exactly "conditioning without evidence"** — the operation §1 of the premise
doc identified as the thing `S` alone cannot express and the *index* must
carry. Its result is labeled with the premise it assumed, so the cross-fiber
refusal keeps it out of every unconditional comparison automatically, until
reality supplies the meet for free and the label is discharged by `advance`.

Consequences worth stating:

- **Ponder stops being a mechanism.** It is the economy choosing anticipatory
  meets when no commitment deadline is attached. There is no ponder module, no
  ponder flag, no ponder lifecycle — there is a work item whose premise carries
  a hypothesis.
- **The VOI table needs both columns or ponder is undefined.** A single-column
  table silently prices every anticipatory work item at zero.
- **The two columns explain the potion window.** "Arm now, spend in three
  turns" is an anticipatory meet whose hypothesis is our own future commitment —
  which is why it cannot be priced by a one-turn evaluator no matter how loudly
  the term speaks.

---

## 4. One object: the carried premise

Everything in §1's table is the same shape — **a self-imposed premise with a
lifetime and a transport rule**:

```ts
interface Carried {
  readonly id: CarriedId              // addressable; measurements attach here
  readonly author: 'operator' | 'bot' | 'rules'
  readonly coordinate: PremiseDelta   // WHICH premise coordinate it narrows
  readonly born: Turn
  readonly lifetime:                  // how advance treats it
    | { kind: 'decision' }            // reference actions — dies at the emission
    | { kind: 'turn' }                // operator pins today
    | { kind: 'turns'; n: number }    // a potion window: 3
    | { kind: 'until'; predicate: MemberId }   // a role, a stance, a truce
  readonly invalidate: MemberId       // the predicate that kills it early
  readonly soundness: 'conditional'   // ALWAYS — see the law below
}
```

Four things become instances rather than mechanisms:

- **operator pin** = `author: operator`, `lifetime: turn`, invalidated by the
  human (humans always win — unchanged, non-negotiable 3).
- **reference action** = `author: bot`, `lifetime: decision` — already exists as
  `Assumption.reference-action`; it is a carried premise with the shortest life.
- **potion commitment** = `author: bot`, `lifetime: {turns: potionWindowTurns}`,
  invalidated when the target dies or the collector is refuted.
- **role / stance** = `author: operator|bot`, `lifetime: {until: predicate}` —
  hysteresis is *the predicate*, not a separate smoothing hack.

### The two laws that make this safe

> **Law C1 (conditional labeling).** A carried premise narrows `S` without
> evidence. Every value computed under one is therefore labeled with it, and the
> cross-fiber refusal applies. A commitment can never launder itself into an
> unconditional number.

> **Law C2 (the seam rule, applied to commitments).** A commitment may change
> ORDER and SPEND. It may never change a bound, a refusal or a safety decision.
> The unconditioned sound channel keeps running beside it, so a commitment can
> never walk the bot into a proved death — it can only make it *prefer* the
> committed line among plans the floors tie, and *spend* its compute there.

C2 is what makes commitment cheap to abandon, which is the property the DoF
synthesis's D6 needs and the property a Centaur operator needs: the bot may
plan three turns of potion play and still be structurally incapable of ignoring
a certain-death staging on turn two.

### And the law that keeps it out of Frankenstein territory

> **Law C3.** A carried premise is DATA produced by a member, never a code path.
> Its author is a member id; its invalidation predicate is a member id; its
> lifetime is a param. So a commitment kind that no roster bot can produce fails
> the reachability law like anything else (`00-CORE.md` §5).

---

## 5. The search map is the same object

The owner's re-entry ask is a carried premise whose content is *attention*:

```
map : ⟨ board , PremiseId ⟩  →  { incumbency, candidate identities, attention weights }
```

Never values — `advance` forbids it, and the rebase-transfer design gives the
three independent reasons a `Bound`, a witness or a memo entry must not cross.
What crosses is what the pin-context cache already crosses one level down:
which lines were interesting, which were refuted, where the argmax sat.

Two properties fall out of the addressing rather than being designed:

1. **Human oscillation is cheap.** A human toggling a pin walks the same few
   premise addresses back and forth; each is a lookup. Today each is a full
   re-derivation, and the interruption design measured what that costs: an
   operator commit pays the full first-plan re-open.
2. **The map is bounded by the address space, not by a policy.** Entries whose
   premise cannot recur (the board advanced past them) are unreachable by
   construction — `advance` retires them, no eviction heuristic needed.

---

## 6. Cross-lens absorptions in this cycle

**From the TIME lens.** `advance` as the third operation, and the two purchase
columns (§3). Both adopted verbatim; their "improvised per-store transport is
the smuggling bug class" is exactly the argument for one operation in one place,
and it is the same argument my §5 makes for one map instead of five stores.

**From the VALUE lens** (`design/value-evaluation`, `value-algebra.md`),
absorbed into `02-JOINT-INVENTORY.md` §7 rather than here: their weight-blind
`captureRank` finding, their homogeneity diagnostic, and the narrowing of my
"the composition law is a free member param" claim.

**From the EPISTEMICS lens.** Already absorbed in cycles 2–3; §3's anticipatory
meet is the operation their support/weight object needs in order to hold a
*hypothetical* conditioning without contaminating the proved support, and their
`plausibleMoves` support constructor is what an anticipatory meet's hypothesis
ranges over.

---

## 7. Falsifiers

1. **If nothing valuable survives `advance`**, the whole object is a cache with
   extra ceremony. **CORRECTED (`09 §BREAK 5`)** — as first written this
   falsifier conflated two populations and would have deleted a healthy
   mechanism, because cross-turn *address recurrence* is ≈ 0 **by design**:
   - **within-turn** (human pin oscillation): gate the map on the exact-address
     re-entry rate and the compute it saves against a full re-open;
   - **cross-turn**: gate on **decisions changed** — carry-effect rate and
     time-to-refutation at N+1 — **never** on recurrence.
   The key is also `⟨name, trace hashes⟩` rather than `⟨board, premise⟩`
   (`18 §3`): a content hash can only match exact recurrences, which is the
   population that is near zero.
2. **If C2 makes commitments inert**, the potion doctrine gets nothing. The
   acceptance test is behavioural and already specified by the capability
   ledger's standard: on a seeded board the committed bot walks to the potion
   three turns early and lands the cut; the uncommitted bot does not. If a
   commitment that may only reorder floor-ties cannot produce that, then the
   commitment must reach *spend* (compute allocation) as well as order — which
   C2 already permits, and which is then the load-bearing half.
3. **If lifetimes need to be dynamic** (a commitment that extends itself), the
   `until` predicate covers it, but a predicate that always returns true is an
   immortal premise and a soundness hazard. Cap: every carried premise has a
   hard maximum age, and the cap is a param with a default of the potion window.
