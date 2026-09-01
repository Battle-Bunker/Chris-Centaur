# SYNTHESIS — the time factorization

The standalone summary of the design/time-interruption line. Details and
derivations: `time-worldline.md` (the factorization and its verification),
`time-worked-timeline.md` (two turns walked through the primitives),
`time-agent-and-measurement.md` (the agent split, the quantum, the harness),
`time-premise-reconciliation.md` (cross-lens algebra), `worldline.sketch.ts`
(the seams as types), `realized-resolution.sketch.md` (the replay
constructor's case analysis), `time-red-team.md` (the minimal-path
alternative, the slab law, default policy numbers). Grounded on `claude/cluster-lookahead` @ `47c983e`,
`primary` @ `66904d2`, TacticToes @ `416d9c8`.

---

## 1. The answers to the lens's four design questions

**Q: What is the true joint between wall-clock budget, search progress, and
commitment?** Three different things, currently fused in the kernel, that
the domain itself separates. SEARCH PROGRESS is compute spent — measured in
quanta (resolution-equivalents), whose sequence is a pure function of
(seeds, frontier, allowance) once no clock is read inside work.
WALL-CLOCK BUDGET is an obligation about when commitments may still change —
it belongs to the per-turn commitment agent and touches search through
exactly one adapter (the exchange rate, which converts deadlines into
allowance grants and is the only module that reads a clock). COMMITMENT is
the wire discipline — gates, ratchet, conformance, flush — and consumes
search products without owning search state. The joint between them is the
ALLOWANCE GRANT: one logged integer per tranche, the single point where wall
time can influence what the search becomes.

**Q: Are anytime slices, ponder, mid-turn interruption, and re-basing the
same operation parameterized differently?** Yes — two operations, and every
mechanism is a parameterization:

- `spend(tranche, hypothesis)` — refine beliefs under a (possibly
  hypothetical) determination frontier. Anytime slice = spend on the actual
  frontier with an agent attached; speculative pin context = spend on
  frontier + assumed pin; scout thread = spend on frontier + assumed cluster
  joint; ponder = spend with no agent attached, on frontier + assumed enemy
  reply (our own commits are now facts, which is why ponder needs no new
  simulation concept).
- `observe(determination)` — advance the frontier; kill exactly the state
  whose declared coordinates the determination touched; promote hypotheses
  whose assumptions became fact. Operator commit = observe determining one
  action (kills one cluster's values, keeps the rest — the structural end of
  the 343 ms toll); turn resolution = observe determining all actions plus
  spawns, followed by ADVANCE (transport to the next turn: door semantics,
  attention carries, values re-walk); partial observation under future fog =
  the same observe determining a subset, clouds intersecting — the general
  case, with today's full observability the degenerate limit.

In the premise-lattice vocabulary the three lenses now share: spend buys
meets (including ANTICIPATORY meets — computing under a narrowing nothing
can purchase yet, which is what ponder is); observe is conditioning; advance
is the third lattice operation, transport between successive turns' lattices.

**Q: What engine-API change makes this natural?** Less than the program
believed, and the pending game-server ruling dissolves. Verified: the
TacticToes `Turn` document already carries the resolution record's content
(authoritative deaths with cause+subStep, typed clashes, severedCells,
per-unit end squares including truncated-slider stops, piece paths,
orientation, promotions, effects), and the bot's own
`PartialEngine.resolve(state, orders)` returns exactly the `Resolution` the
door consumes, with the order vocabulary (destinations, holds, rotation
codes) sufficient to express any realized turn. So re-basing reconstructs
the resolution by REPLAYING the realized joint move through the bot's own
differentially-tested engine — movement/collision half replayed, game-state
half (spawns, tiers, promotion, orientation) copied from the doc — with the
wire doc as a per-turn CHECKSUM and today's marshal path as the fallback on
any mismatch. The wire's role inverts from constructor to verifier; a free
differential test of the partial engine runs every live turn; the harness
already exposes the same record locally (`resolveFullTurn`'s
`outcome.events`). Remaining engine-API items are additive polish
(subStepCount, settled exhaustions, optionally a state hash) plus — for the
fog programme — the epistemics lens's ObservationRecord (facts/mask/events),
into which this design plugs without change: hidden units' orders stay
unknowable, so they stay held, and the same advance path carries them.

**Q: How does per-decision compute sequencing become a first-class, tunable
joint?** As four small policies, all ordinary config (lane a), no flags:
tranche sizing (exchange rate + the operator-latency cap); allowance split
across phases (unifying the scout's tithe/reserve, the kernel's
speculativePeriod, and the unbuilt ponder-window policy into one table);
the hypothesis market (which conditional frontier earns the next tranche —
unifying ponder targeting, speculative contexts, thread seeding, ruling-41
focus narrowing, and the future D2 socket, whose output plugs in as market
weights); and the reaction table (conform-now / next-tranche /
next-commitment per determination source — "humans always win" is one row,
the dial promise is another). Every one is sweepable as a batch arm; the
ledger makes each measurable (carriedQuanta, promotion rate,
ponderReadAfterRebase, carryEffectRate beside the standing depthEffectRate).

## 2. What is new relative to the standing designs

The rebase-transfer and interruption designs stand; this line changes their
foundations in four places:

1. **Their five pending dilemmas shrink to one.** Resolution-record emission
   (dissolved — §1Q3); dial latency (dissolved into "next tranche, softly"
   via evaluator-version demotion — old values become advisory shadows, the
   wire re-conforms immediately, re-pricing flows through ordinary
   spending); ponder determinism (dissolved into the allowance ledger — both
   fixed and opportunistic grants replay exactly from one logged integer per
   window). Still genuinely needing the owner: the measurement denominator
   under carried compute (proposal: per-turn metrics keep their denominator
   via targetTurn stamps; carriedQuanta becomes a first-class column;
   cross-policy arms compared at equal refine-quanta AND equal total).
2. **Event scope is derived, not declared.** The three-axis DecisionEvent
   classification keeps only its reaction axis; invalidation scope falls out
   of declared read-sets (merged with the epistemics projection tags and the
   joints lattice's frame coordinate into one record, five readers), so
   citation completeness inherits the refusal law's existing teeth.
3. **The carry store, the ponder session, and the event track stop being
   three mechanisms.** They are rows of spend/observe/advance — the cheapest
   deletion in the programme is this design-space complexity deleted before
   it is built. Where a pondered hypothesis matched reality EXACTLY, its
   promotion is a warm-context resume (strictly stronger than the carry
   store's scalar bridge); the carry rows remain the fallback for partial
   matches, per rebase-transfer unchanged.
4. **The slice-count nondeterminism is removed rather than explained.**
   Wall cuts inside work (the shouldStop points) become counting cuts;
   wall time influences only the number of grants, which the ledger records.
   Verified feasible: five shouldStop consultation points in the bank, all
   via the injected handle; countingBudget already in the testkit.

## 3. The build path (feature branches, each standalone, ordered by value)

1. **feature/commit-scope** — citation-scoped commit invalidation over the
   toll fix's per-cluster seam + reaction table + the first operator event
   ever fired in a harness game. Falsifier: if it does not recover most of
   the 343 ms, the central economy is wrong — stop here.
2. **feature/allowance-ledger** — quanta accounting, exchange rate, ledger
   replay rows, harness virtual clock. Falsifier: A/A floors must tighten
   on a loaded box.
3. **feature/replay-rebase** — realizedResolution + checksum + divergence
   counter. Standalone: the free live differential test.
4. **feature/worldline** — the per-game object absorbing GameState_, the
   hypothesis table, attention carry, ponder tranches on the
   everythingPinned condition. Falsifier: warm promotion must beat the
   scalar carry bridge on the two-turn acceptance games.
5. **feature/evaluator-version** — version stamps + soft re-price + the
   dial acceptance game.

Anti-latch law throughout: the worldline holds knowledge and appetite,
never calibration — the only cross-turn mutable scalars are the
exchange-rate fit (turn-stamped), attention rows (rootTurn-tripwired,
plies-bounded), and the seed position.

Vocabulary note for future briefings: the engineering term "hypothesis
promotion" in these documents is internal; owner-facing text renders it as
a hypothesis being CONFIRMED by reality and its work CARRIED warm (the
checker blocks the internal word, correctly).

## 4. Owner summary (vocabulary-checked: 0 blocking; ≤8 bullets)

- Wall-clock time and search work are separated at exactly one point: the
  clock is read only to grant the search an allowance of work units, and
  every grant is logged — so a game replays from its log, whichever way the
  humans and opponents moved the clock.
- The search becomes one continuous per-game process; each turn a small
  per-turn agent attaches to it, owning the deadline, the wire, and every
  emission gate unchanged.
- An operator commit now invalidates only the work that actually depended
  on that unit's choice — the bot stops paying a full re-open for every
  human intervention, and the more the human intervenes the more the bot
  keeps thinking.
- Thinking between turns needs no new machinery: with our moves committed
  they are facts, enemy replies are explored exactly the way the deep
  search already explores them, and whatever reality confirms is carried
  warm into the next turn's first work.
- The game server change previously thought necessary is not: the turn
  document already publishes what happened in enough detail for the bot to
  replay the turn through its own rules engine, using the wire as a
  per-turn correctness check — which also audits the engines against each
  other in every live game for free.
- Invisibility potions ride the same path: whatever the turn document hides
  simply stays held as a possibility cloud across the boundary — full
  visibility is the special case, not the design.
- A dial change takes effect at the next work grant: the wire re-conforms
  immediately under the new pricing, old values drop to advisory ordering
  hints, and full re-pricing flows through ordinary work.
- One accounting question needs a ruling before the first between-turns
  experiment: per-turn measurements keep their denominator by stamping each
  work grant with the turn it serves, and carried compute becomes its own
  reported column — arms with different between-turns policies get compared
  both at equal per-turn work and at equal total work.
