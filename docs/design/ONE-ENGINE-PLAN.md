# ONE ENGINE — the plan to make `settleTurn` the only rules code in either repo

Design document, 2026-09-02. Verified against `TacticToes` @ `d494019` and
`Chris-Centaur` @ `19739d2` (`.claude/worktrees/**` ignored). Every claim about
current code carries a `file:line`. Where a claim depends on work an agent is
landing concurrently (spec steps E5–E7 of
`scratchpad/19-ENGINE-SPEC.md`) it is marked **[E-pending]** and the design
assumes the spec's end state.

---

## 0. Where the two repos actually stand

Facts this plan is built on, each checked today rather than taken from the
audit inventory.

| Claim | Evidence |
|---|---|
| E1–E5 have landed upstream. `settleTurn` already does effects, potions, orientation, promotion **and adjudication** | `engine/settleTurn.ts:309` lines; `outcome` at `settleTurn.ts:121,297,307`; `engine/adjudicate.ts` (195) exists and is listed in `engine/VENDOR.md:17` and `engineVendor.spec.ts:25` |
| E6 (spawner) has **not** landed: the RNG is still in the processor | `TeamSnekProcessor.ts:424,497,508,535,549` all call `Math.random()` |
| E7 (grammar queries) has **not** landed: `engine/` exports no `legalTargets`/`coverOf` | `moveGrammar.ts` exports `planUnitAction:149`, `defaultAction:228`, `legalOrientations:76` and nothing else |
| The vendored copy in the bot is **behind**: it has no `adjudicate.ts` | `src/engine-vendor/engine/` holds 4 files (1420 lines); upstream holds 5 (1579) |
| The contest rule exists twice | `turnEngine.ts:173` `strictMaximum` vs `src/partial-engine/contest.ts:46` `cmpLex` / `:58` `uniqueStrictMax` |
| The grammar exists three times | `moveGrammar.ts:149`; `src/partial-engine/grammar.ts` (781); `src/logic/piece-moves.ts` (217, header says "MIRRORED from moveGrammar") |
| The resolver exists twice | `resolveTurn.ts`+`turnEngine.ts` (884) vs `src/partial-engine/engine.ts` (2761) |
| **The partial engine has no upstream any more.** `packages/engine/src/partial/` does not exist in `Cyphid-Academy/snek-centaur-platform` | checked at `/home/user/cyphid-academy/snek-centaur-platform` @ `edeebc5`: the subtree is absent; `scripts/sync-partial-engine.js:44` points at it |
| The bot's search is built on the partial engine's API, not on the rules | 17 files under `src/lobster/` import `../partial-engine/index`; `contracts.ts:6` names it as one of the two allowed cross-module dependencies |
| The legacy path is not fully dead: one legacy module runs on **every** turn regardless of the flag | `firebase-interface.ts:1448` calls `quickSafeMove`, which at `:1601-1602` builds a `BoardGraph` and calls `MoveAnalyzer.analyzeMoves` — inside the fast staging pass, above the `centaurEngine()` branch at `:1504` |

### 0.1 The end state, in one paragraph

`engine/` in TacticToes holds `settleTurn` (the whole turn), `settlePartial`
(the same turn with some units' moves unknown), `claims` (what an unknown unit
could be doing), `adjudicate`, `moveGrammar` + its three query wrappers,
`resolveTurn`, `turnEngine`. Nothing else in either repo computes a legal move,
a contest, a path, a tier, a promotion, a food pickup, an exhaustion or a
winner. The bot vendors that directory byte-for-byte through one script, and
everything above `src/lobster/substrate.ts` talks to it through one type,
`PartialSettlement`.

---

## 1. Partial advance as a mode of the one engine

### 1.1 Why it is a mode and not a second engine

The possibility-cloud engine exists because `resolveTurn` demands a staged move
for every unit and a search does not have one. That is a *shape* problem, not a
*rules* problem: the rules for a turn in which three units' moves are unknown
are the same rules, run against a set of boards instead of one board. The
present split pays for that shape difference with 9,262 lines that re-encode
the grammar (`grammar.ts`, 781), the contest (`contest.ts`, 75) and the
resolver (`engine.ts`, 2,761) — three encodings whose agreement is asserted by
a 2,000-board differential (`src/tests/partial-engine-differential.test.ts`)
that covers only fully-modelled, potion-free boards, i.e. exactly the case in
which the partial engine's own reason for existing is switched off.

So: one function, in the vendored directory, that takes the same input as
`settleTurn` plus a held set.

### 1.2 The signature

Two new sibling files inside `functions/src/gameprocessors/engine/`.

```ts
// engine/claims.ts — what an unknown unit could be doing.

/** A unit in `units` whose staged move is NOT known. Its `stagedMove`/`path`
 *  are ignored; its occupancy, health, tier, orientation and type are the
 *  OBSERVATION, taken at `observedTurn`. */
export interface HeldUnit {
  readonly id: string
  /** The turn its record was observed. `input.turn - observedTurn` is how many
   *  turns of unknown movement the claim has to cover; 1 is the common case
   *  (a unit on this very board whose choice we are not modelling). */
  readonly observedTurn: number
  /**
   * Optional narrowing: the staged destinations this unit is assumed to be
   * choosing among on its FIRST unknown turn. Undefined = every legal one.
   * A narrowing is an ASSUMPTION, echoed on every ledger entry it licensed
   * (`Divergence.narrowed`), so a caller can never mistake it for a proof.
   */
  readonly options?: ReadonlyArray<number>
}

/** Where one held unit could be, and how strong it could be, at each sub-step
 *  of the turn being settled. A pure function of (record, board geometry,
 *  walls, hazards, food, potions, effects, turn span, options) — of nothing
 *  any particular assignment does, which is what makes it memoisable. */
export interface Claim {
  readonly id: string
  readonly teamID: string
  /** Kinds it could be. More than one only when a held pawn's weight interval
   *  crosses `pawnPromotionWeight` — promotion is the only kind change
   *  (`settleTurn.ts:242-262`), and a queen's grammar is not a pawn's. */
  readonly kinds: ReadonlyArray<UnitType>
  /** Head cells it could occupy, per sub-step index (0-based). */
  readonly headPossible: ReadonlyArray<ReadonlyArray<number>>
  /** Trail cells it could occupy, per sub-step. Empty for pieces. */
  readonly bodyPossible: ReadonlyArray<ReadonlyArray<number>>
  /** Cells it occupies in EVERY world in which it is still alive — the neck
   *  argument: a trail unit's `occupancy[0 .. len-2]` is occupied whatever it
   *  chooses, because it must step and its body follows. Same fact
   *  `staging-safety.ts:38-46` states and measured (1295/1295 vs 0/3385). */
  readonly certainIfAlive: ReadonlyArray<number>
  /** Earliest sub-step at which its head can reach a cell; `NEVER` elsewhere.
   *  This is what gates an entanglement in time. */
  readonly earliestSubStep: Int32Array
  /** Frozen strength interval — the only two coordinates a contest reads
   *  (`turnEngine.ts:173-179`). */
  readonly weightMin: number; readonly weightMax: number
  readonly tierMin: number; readonly tierMax: number
  /** The scalar tier it carries into THIS turn's adjudication if nothing it
   *  could reach moved it — `record.tier` lapsed against `input.effects`. */
  readonly tierAtArrival: number
  readonly healthMax: number
  /** It is dead in every world (walked into a wall it could not avoid, ran
   *  out of health with no reachable food, ...). */
  readonly certainlyGone: boolean
  /** It could be dead — from terrain, exhaustion, its own body, or another
   *  CLAIM. The last half is why claims are computed as a set, not one at a
   *  time (today: `field.ts:73-88` `contestedClaims`). */
  readonly deathPossible: boolean
}

export function computeClaims(input: PartialSettleInput): ReadonlyArray<Claim>
```

```ts
// engine/settlePartial.ts — the whole turn, with some movers unknown.

export interface PartialSettleInput extends SettleInput {
  readonly held: ReadonlyArray<HeldUnit>
}

export type DivergenceKind =
  | "contest"    // a live unit ended a sub-step where a claim could stand
  | "edge"       // a claim could cross the same edge the other way
  | "bodyBlock"  // a claim's trail could hold this cell
  | "sever"      // a claim could sever the live unit, or be severed by it
  | "durable"    // a claim could have DIED here, leaving a pile
  | "transit"    // a slider's ray crossed the cell rather than ending on it
  | "food"       // a claim could have eaten the food this unit ate
  | "potion"     // a claim could have taken the potion this unit took
  | "exhaustion" // health spent here depends on whether a claim blocked

export interface Divergence {
  readonly cell: number
  readonly subStep: number
  /** The HELD unit whose unknown choice creates the difference. */
  readonly heldId: string
  /** The unit in the optimistic timeline whose outcome could change. */
  readonly liveId: string
  readonly kind: DivergenceKind
  /**
   * WHICH ENDPOINT RIDES ON IT.
   * `false` — the optimistic timeline read the cell EMPTY. The held unit has
   *   only to have moved there for this to bite; it is `worst` that is exposed.
   * `true`  — the timeline PLACED the held unit here on the neck argument, so
   *   it is here in every world where it lives; it is `best` that is exposed.
   * Getting the two backwards is invisible in every aggregate and wrong
   * exactly where a human reads the ledger (`bounds/ledger.ts:9-20`).
   */
  readonly assumedPresent: boolean
  /** Could the claim, at ANY strength its interval permits, beat `liveId`
   *  here? False means the contact is real but the live unit wins it in every
   *  world — a divergence in timing, not in survival. */
  readonly couldBeat: boolean
  /** True when this entry exists only because a `HeldUnit.options` narrowing
   *  admitted the world. The basis, carried on the entry. */
  readonly narrowed: boolean
}

export type Fate = "alive" | "dead" | "contingent"

export interface PartialSettlement extends Settlement {
  /** Every point at which a concrete world could differ from this timeline.
   *  Deduplicated, ordered by (subStep, cell, kind, heldId, liveId). */
  readonly ledger: ReadonlyArray<Divergence>
  /** Per LIVE unit. `dead` and `alive` are proofs; `contingent` is a work
   *  list and the ledger names why. */
  readonly fates: Readonly<Record<string, Fate>>
  /** The claims this settlement adjudicated against, so a caller need not
   *  recompute what it is about to price. */
  readonly claims: ReadonlyArray<Claim>
}

export function settlePartial(
  input: PartialSettleInput,
  spawn: Spawner,
  claims?: ReadonlyArray<Claim>,   // hoisted by the caller; see §1.6
): PartialSettlement
```

`settlePartial` runs the **optimistic timeline**: it calls the same
`resolveTurn`/`turnEngine`/`settleTurn` machinery, with each held unit's
*merely-possible* occupancy treated as **empty** and its *certain-if-alive*
occupancy treated as **present**, and it records a `Divergence` at every point
where a concrete world could disagree. It writes no separate resolver: the
sub-step loop is `turnEngine.ts`'s, with a claim overlay consulted at exactly
the five adjudication tiers it already has (`turnEngine.ts:329` edges, `:369`
walls, `:377` self, `:387` arrivals, `:436` bodies) plus the food phase
(`resolveTurn.ts:222`) and the potion phase (`settleTurn.ts:139`).

### 1.3 The soundness property, stated precisely

Fix an input `I` with held set `H`. For `h ∈ H` write `span(h) =
I.turn − h.observedTurn ≥ 1`, and let `Hist(h)` be the set of **legal
histories** of `h`: sequences of `span(h)` staged actions, each legal for the
kind that `h` is at that point under `moveGrammar.planUnitAction` /
`defaultAction`, applied to the board as `h` alone would move on it, and with
the first action restricted to `h.options` when given. A **concrete assignment**
`σ` picks one history per held unit. Write `settle(σ)` for
`settleTurn(I ⊕ σ, NO_SPAWN)` — the ordinary, total settlement of the board in
which every held unit really did move that way.

**T1 — Divergence containment.** For every `σ ∈ Π Hist(h)`: if `settle(σ)` and
`settlePartial(I)` disagree about the *disposition* of unit `u` at sub-step `s`
— where disposition is the tuple (occupies cell `c`, alive, health, severed at
index `k`, ate at `c`, took a potion at `c`) — then `settlePartial(I).ledger`
contains an entry `d` with `d.cell = c`, `d.subStep ≤ s`, `d.liveId = u` or
`d.heldId = u`, and `d.kind` naming the adjudication phase in which the two
timelines *first* differ.

*Corollary (the whole point).* `ledger = []` ⟹ `settlePartial(I).board`,
`.deaths`, `.tiers`, `.potions`, `.food`, `.orientation`, `.unitTypes` and
`.outcome` equal `settle(σ)`'s for **every** `σ`. An empty ledger is a proof
that the held set did not matter; a non-empty one is a work list.

**T2 — Fate soundness.** `fates[u] = "dead"` ⟹ `u` is dead in `settle(σ)` for
every `σ`. `fates[u] = "alive"` ⟹ `u` is alive in `settle(σ)` for every `σ`.
`fates[u] = "contingent"` implies nothing about any `σ` and requires at least
one ledger entry with `liveId = u`.

**T3 — Coordinate bracketing.** For each surviving unit `u` and each coordinate
`x ∈ {weight, health, tier}`, define from the optimistic settlement plus the
ledger:

| ledger entry naming `u` | concedes to `lo` | concedes to `hi` |
|---|---|---|
| `contest`, `edge`, `durable`, with `couldBeat` | `u` dead: `weight 0`, `alive false` | — |
| `contest`, `edge`, `durable`, `!couldBeat` | `u` halts one cell earlier: `health + 1` | — |
| `bodyBlock` | `u` dead if `tier ≤ claim.tierMax`, else halts | — |
| `sever` (u is owner) | `weight − (weight − k)` for the shallowest ledgered cut index `k` | — |
| `sever` (u is the arriver) | halts at `cell` | — |
| `food` | `weight − 1`, `health` unrestored | — |
| `potion` | `tier − 1` if `u` is the would-be collector; `tier + 1` per ledgered ally pickup | mirror |
| `exhaustion` | `health − hazardDamage` | `health + costPerCell` |

Then `lo_x(u) ≤ x_σ(u) ≤ hi_x(u)` for every `σ`. Symmetrically for a **held**
unit `h`, `[claims[h].weightMin, weightMax]` and `[tierMin, tierMax]` bracket
its coordinates in every `σ`, and `certainlyGone`/`deathPossible` bracket its
survival.

**T4 — Monotonicity under narrowing.** If `options'(h) ⊆ options(h)` for every
`h`, then `ledger(options') ⊆ ledger(options)` up to the entries' identity, and
every bracket of T3 under `options'` is contained in the one under `options`.
This is what makes branch-and-refine sound: narrowing may only tighten, so the
bot's bound bank can mix a rung that narrowed with one that did not, provided
both declare their basis (`bounds/score.ts:20-26`, law 4).

**T5 — Reduction to the total case.** `H = ∅` ⟹ `settlePartial(I, s) ≡
settleTurn(I, s)` with `ledger = []`, `fates` all `alive`/`dead` per `deaths`,
`claims = []`. This is the property the retired differential was proving, and
it becomes a two-line assertion inside the new engine spec rather than a
2,000-board harness in the bot.

### 1.4 What survives, what moves, what dies

| Present concept | Where it lives after |
|---|---|
| Claim clouds (`cloud.ts` `Cloud.headPossible`/`bodyPossible`/`certain`) | **Engine concept.** `Claim.headPossible`/`bodyPossible`/`certainIfAlive`, as sorted `number[]` per sub-step. Computed from `moveGrammar`, not from a second grammar. |
| n-turn frozen premise (`FrozenRecord.heldAtTurn`, `CloudTimeline.advanceTo`) | **Engine concept.** `HeldUnit.observedTurn`; the reach is dilated turn by turn from `observedTurn + 1` to `input.turn`. |
| Tier intervals for held units (`StrengthBounds.tierMin/Max`, `cloud.ts:770-790`, ceiling half at `field.ts::build`) | **Engine concept.** `Claim.tierMin/tierMax`, computed from `input.potions`, `input.potionsEnabled`, `input.effects` and the pickup rule as `settleTurn.ts:139-186` writes it. There is no second polarity to keep in step (`cloud.ts:56-66` names that risk). |
| Promotion forks (`cloud.ts` `kindSet`) | **Engine concept.** `Claim.kinds`; reach is the union over the set. Promotion is a rule (`settleTurn.ts:242-262`). |
| Claim-versus-claim mutual death (`field.ts:73-88` `contestedClaims`, `Resolution.mayHaveDied`) | **Engine concept.** Folded into `Claim.deathPossible`. It is what keeps a *ceiling* honest (`engine.ts:306-315`). |
| The neck argument (certain-conditional-on-alive) | **Engine concept.** `Claim.certainIfAlive`. |
| `bounds.ts` interval algebra: `ScoreBounds`, `GapAttribution`, `backupMax/Min`, `dominance`, `confidence` (455) | **Bot-side, already duplicated.** `lobster/bounds/score.ts` (380) is the same algebra; `contracts.ts:20-40` calls the pair "three dialects of one interval". One dialect survives. |
| `exact.ts` branch-and-join over a held unit's options (794) | **Bot-side.** The engine keeps only `HeldUnit.options`; the join is `bounds/bank.ts`'s B1/B3 rungs, which already do it (`bank.ts:31-52`). |
| `risk.ts` `RiskAssessor.assessPath` per-cell trit grading (966) | **Bot-side**, as `lobster/pathrisk.ts` (~260): a fold over one one-mover `settlePartial` per ray, reading `traversed`, `deaths`, `fates` and the ledger entries at each cell. The verdict types (`EncounterVerdict`, `TraversalVerdict`) move into `lobster/contracts.ts` unchanged, so `candidates.ts` keeps its shape. |
| `narrow.ts` (157) `Narrower`, `refine.ts` (227) `refinementCost`/`residue` | **Bot-side search policy.** Fold into `lobster/search/order.ts` and `bounds/bank.ts`; `residueOf` already exists at `bounds/ledger.ts:86`. |
| `field.ts` `FieldSlot`/`SlotMask`/`MAX_FROZEN = 32` (588) | **Deleted as an arena artefact.** Claims are indexed by unit id. `TooManyHeldError` (`substrate.ts:202`) and the two guards at `substrate.ts:1196,1215` go with it, and so does `team-decision-engine.ts:46`'s `MAX_FROZEN` import. |
| `grammar.ts` (781) | **Deleted.** Second grammar. |
| `contest.ts` (75) | **Deleted.** Second contest rule. `turnEngine.ts` gains `export const outranks = (a, b) => …` extracted from `strictMaximum:173-179`, so the two bot callers that need a comparator (`staging-safety.ts:80`, `evaluate/territory.ts:82`) ask the rule instead of restating it. |
| `engine.ts` (2761) | **Deleted.** Second resolver. |
| `bitgrid.ts` (308) | **Deleted.** The engine is allocation-conscious, not arena-optimised (§1.6). |
| `twin.ts` (272) | **Deleted as a file**; its role — an independent walker to property-test claims against — becomes the T1–T3 enumeration test in §4b, run against `settleTurn` itself. |
| `checks.ts` (211) containment audits | **Deleted as a file**; the three audits (grammar containment, displacement axiom, T1 cloud containment) become assertions inside the same test. |
| `index.ts` (210), `wire-adapter.ts` (243), `VENDOR-MANIFEST.json` (66) | **Deleted.** Packaging. |

Net: 9,328 lines of `src/partial-engine/` out; ~900 lines of engine code in
(`claims.ts` ~380, `settlePartial.ts` ~520); ~390 lines of bot code in
(`pathrisk.ts` ~260, `bounds/material.ts` ~130).

### 1.5 Purity, and the one nondeterminism

`settlePartial` reads no clock and no RNG. This is not a convention — it is
grepped: `engineVendor.spec.ts:53-58` fails the build on
`require(`, `Math.random`, `Date.now`, `new Date(`, `fetch(`, and
`:44-49` fails on any import that is not a sibling or `@shared/types/Game`.
`settlePartial.ts` imports `./settleTurn`, `./claims`, `./moveGrammar`,
`./turnEngine` and `@shared/types/Game`, and `claims.ts` imports `./moveGrammar`
and `./turnEngine`. Spawning stays behind the injected `Spawner` (spec §2, E6);
the bot passes `NO_SPAWN` and inherits its stated under-model (spec §6).

The one place partial mode could smuggle in nondeterminism is ledger ordering.
It is fixed: `(subStep, cell, kind, heldId, liveId)`, ascending, deduplicated —
the same discipline `turnEngine.ts:582-589` applies to clashes, and the reason
a ledger can be part of a bound's identity (`bounds/score.ts:99` `ledgerKey`).

### 1.6 Allocation, and where the bot memoises instead

The engine allocates per call: one `Int32Array(cells)` per claim for
`earliestSubStep`, and `subSteps × 2` small `number[]`s per claim. It reuses
nothing across calls and owns no arena. That is deliberate — the arena is what
made `substrate.ts` carry a 60-line slab-lifecycle contract
(`substrate.ts:44-50`, `:966-1030`, `contracts.ts:408-414`) whose only symptom
when broken is "the engine getting slower".

The expensive half is `computeClaims`, and it is a pure function of
`(held records, board geometry, walls, hazards, food, potions, effects, turn)`
— of nothing a plan does. So it is hoisted, and `settlePartial`'s third
parameter is where the bot hands it back. Four memoisation points, all
bot-side, three of which already exist:

| memo | key | today |
|---|---|---|
| `computeClaims` for the sweep's fixed held set | `(gameId, turn, sorted held ids, options?)` | `substrate.ts:52-62` already calls this "the one performance discipline" and builds the field once per decision |
| `settlePartial` per plan | `planKey` | `bounds/memo.ts` (220) `memoizeSubstrate`, unchanged |
| grammar queries `legalTargets`/`pathOf`/`coverOf` | `(unitId, from, orientation, boardHash)` | `substrate.ts` `targetsBoard()` + geometry cache `:288-297`, unchanged in shape |
| the evaluation fold | evaluator identity + plan | `bounds/evalmemo.ts` (165), unchanged |

A one-mover `settlePartial` (the `pathrisk` call, once per ray —
`candidates.ts:620` already enforces "one per ray, not per candidate") reuses
the sweep's hoisted claims and allocates only its own sub-step scratch.

---

## 2. The bot's new seam

### 2.1 `Substrate`, method by method

The interface keeps its names (`contracts.ts:423-455`) so `kernel.ts` (2093),
`search/core.ts` (762) and `evaluate/*` change only their imports. What changes
is what is behind each name.

| method | today | after |
|---|---|---|
| `resolveBoundedFor(plan, asTeam)` | fork arena → `applyHoldSet` → `resolveBounded` (`substrate.ts:983-1006`) | one `settlePartial({...marshalled, units: plan applied, held: complement}, NO_SPAWN, hoistedClaims)` |
| `releaseResolution`, `withResolution`, `outstanding`, `release` | slab lifecycle (`substrate.ts:1023-1035`) | **removed from the contract.** There are no slabs. `withResolution` survives one commit as a pass-through, then goes. |
| `actionsOf`, `pathOf` | `enumerateActions` / `planAction` (`substrate.ts:846-897`) | `legalTargets(u, board)` / `pathOf(u, target, board)` — the E7 queries |
| `influenceOf` | cloud union (`substrate.ts:1142`) | `coverOf(u, board)` ∪ the unit's own path cells |
| `entangled(cells)` | scans `claimField().slots` bitboards and `headSubStepLBOf` (`substrate.ts:1048-1072`) | scans `PartialSettlement.claims[]`: `bodyPossible` hit ⇒ entangled; `headPossible` hit gated by `earliestSubStep[cell] ≤ probe.toSubStep` — the identical gate, on arrays |
| `claimField()`, `assessor()`, `freshAssessor()` | engine objects (`substrate.ts:905,925`) | **removed.** Replaced by `claimsOf(): ReadonlyArray<Claim>` and `assess(unitId, path): TraversalVerdict` (the `pathrisk` fold) |
| `tiersAfterPickupBy` | already one vendored `settleTurn` probe (`substrate.ts:818-845`) | **unchanged in substance**, memo kept |
| `withModelled` | `Proxy` + the narrower-sibling `SharedClaimViewError` guard (`substrate.ts:1103-1160`, `:481`) | plain object. The guard existed because the claim field was cached on the parent from the *parent's* modelled set; with claims derived per call from the plan's complement, a narrower sibling is simply correct. `CLAIM_QUESTIONS` (`substrate.ts:469`) and `SharedClaimViewError` are deleted. |

`substrate.ts`: **1253 → ~470, rewritten.**

### 2.2 What `lobster/bounds/*` needs from a ledger

Read against `bounds/ledger.ts` (117), `score.ts` (380), `bank.ts` (806),
`witness.ts` (82), `soundness.test.ts` (466) and the contract types at
`contracts.ts:393-401`, the bounds layer needs exactly five things, and
`PartialSettlement` supplies four of them directly:

| need | today | after |
|---|---|---|
| ledger entries keyed by **held unit id**, with polarity | `Entanglement.frozen` is a `SlotMask`; `ledger.ts:28-32` `frozenUnitBySlot` decodes it; `:51-69` `entriesOfOne` walks the bits | `Divergence.heldId` is the id. `frozenUnitBySlot` **deleted**; `entriesOfOne` collapses to a map. `ledger.ts` 117 → ~55 |
| the polarity itself | `assumedPresent` ⟹ `if_absent`, else `if_present` (`ledger.ts:11-18`) | identical, from `Divergence.assumedPresent` |
| the held roster + its teams | `heldUnitsOf`/`heldUnitsOfTeam`/`teamOfHeld` walk `state.field.slots` (`ledger.ts:34-47`) | one-liners over `PartialSettlement.claims[].id/.teamID` |
| survival trit per unit | `Resolution.fates` + `mayHaveDied` mask, folded in `exact.ts:182-211` | `PartialSettlement.fates` + `Claim.certainlyGone`/`deathPossible` — the same fold, without the mask decode |
| **per-team `[worst,best]` and subject-frame material `ScoreBounds`** (`contracts.ts:397-400`) | computed inside `resolveBounded` (`exact.ts:186-212`) from `UnitValueBounds` | **moves bot-side** into a new `lobster/bounds/material.ts` (~130). It is scoring, not rules: "what is a team's material worth" is the bot's question. |

That last row is the one real judgement call in this section, and it is the
reason `partial-engine/bounds.ts` (455) can be deleted rather than ported. The
engine gives `fates`, `board` (concrete weights) and `claims` (weight
intervals); `material.ts` folds them into `perTeam` and `bounds` using
`bounds/score.ts`'s existing `makeScoreBounds`/`backupMax`/`withNarrowing`.
Consequence: `contracts.ts:20-40`'s "three dialects of one interval" becomes
two — `Bound` (with the advisory `est`) and `ScoreBounds` — and
`EngineScoreBounds` disappears from the contract entirely.

**The soundness harness's requirement is unchanged and must stay unchanged.**
`soundness.test.ts:11-15` insists the property is checked "against EXHAUSTIVE
enumeration through the SAME ground-truth resolver the bounds are computed
with, never against a second encoding". After the cut there *is* only one
resolver, so `trueWorstCase` (`bounds/testkit.ts`) enumerates every joint reply
and calls `settlePartial` with `held = ∅` — i.e. `settleTurn`. That is
strictly stronger than today, where `trueWorstCase` enumerates through
`partial-engine`.

### 2.3 What `candidates.ts` needs from the grammar queries

`candidates.ts` (1442) takes its option set from `enumerateActions` and its
per-cell verdicts from `RiskAssessor.assessPath` (`candidates.ts:14-20`,
`:725-740`). After the cut:

| need | source |
|---|---|
| the option set for a unit | `legalTargets(u, board)` |
| the cells a staged destination enters (incl. a slider's stop cell) | `pathOf(u, target, board)` |
| cells a unit could contest next turn (threat maps, `influenceOf`) | `coverOf(u, board)` |
| per-cell `{survival, defeat, halt, causes, deathCells}` along a ray | `lobster/pathrisk.ts` `assessPath` — one `settlePartial` per ray with only that unit modelled, folded to the existing `EncounterVerdict`/`TraversalVerdict` shape |
| `profileOf(kind).mayEnterWall`, `.oriented`, `.costPerCell` | `moveGrammar.leavesTrail(type)` (`moveGrammar.ts:22`), `legalOrientations(type)` (`:76`), and a new `costPerCell(type)` exported beside them |
| the contest comparator | `turnEngine.outranks(a, b)` (extracted from `strictMaximum:173`) |

The three **exact** prunes (`candidates.ts:26-31`) all descend from
first-contact termination, and `settlePartial` reports it directly:
`traversed[u]` is where the mover actually got to, and a `Divergence` with
`couldBeat: false` at the truncation cell is exactly "certain stop, no death".
So suffix-collapse and certain-edge-horizon become reads off the settlement
rather than reads off a risk fold, and health-horizon is
`healthSpent` bracketed by T3's `exhaustion` row.

`candidates.ts`: **1442 → ~1330, edited** — the import block, `assessPathOf`
(`:725-740`), and the `profileOf`/`scalarOf` call sites. Not a rewrite: its
policy (what prunes, what is exact, the two rules at `:47-60`) is untouched.

### 2.4 What `staging-safety.ts` and `tier-window.ts` reduce to

**`staging-safety.ts` (335 → ~210).** Its reason for existing —
`RiskAssessor.assessPath` assumes the caller pre-filtered walls and
self-collisions (`staging-safety.ts:7-19`) — survives verbatim, because
`pathrisk.assessPath` inherits the same assumption. What goes is its four
partial-engine imports (`:80`): `bbTest` → a `Set<number>`; `profileOf` →
`leavesTrail`; `scalarOf`/`cmpLex` → `outranks`. `certainlySelfFatal`,
`allyBodyCollision` and `killsOwnKing` keep their bodies and their measured
justifications (`:44-46`, `:57-63`).

**`tier-window.ts` (384 → ~180).** Its whole premise (`:16-31`) is that
`FieldSlot.bounds` gives a tier *interval* that is the wrong input to a safety
verdict, so it must re-derive the *held* tier lapsed at expiry. After the cut
`Claim.tierAtArrival` is that scalar, computed inside the engine from
`input.effects` — the same schedule `settleTurn.ts:188-196` expires against —
so `tierAtTurn` and the `FrozenRecord` walk go. `threatsFor` becomes a query
over `claims`; `selfDebuffOf` is already a `tiersAfterPickupBy` diff
(`:44-59`). `gradePath` becomes a fold over `pathrisk`'s verdict.

**`tier-truth.ts` (94 → 0), deleted outright.** Both seams it gates cease to
exist: `tierExpiryEnabled` because the engine always reads the real `effects`
(there is no "permanent-tier lie" to switch back on), and `potionBoardEnabled`
because `Claim.tierMin/tierMax` are computed from `input.potions` +
`input.potionsEnabled` with no way to feed an empty board. The third export,
`TIER_DEFENSE` (a *policy* knob for `candidates.ts`, correctly distinguished at
`tier-truth.ts:81-90`), moves to `lobster/postures.ts`. **Note for the
implementer:** deleting `potionBoardEnabled` ships the widening that
`tier-truth.ts:33-46` deliberately held back over an unre-measured "858-inversion
interaction storm". That is a real behaviour change and it must be its own
commit with its own soundness run (§4c, C6).

### 2.5 Every bot file: deleted / rewritten / unchanged

**Deleted outright** (26,309 lines, counting the test bulk from §4a):

| path | lines | why |
|---|---|---|
| `src/partial-engine/**` (16 `.ts` + manifest) | 9,328 | the second engine |
| `src/lobster/tier-truth.ts` | 94 | both seams cease to exist (§2.4) |
| `src/logic/decision-engine.ts` | 844 | legacy decision path |
| `src/logic/voronoi-strategy.ts` | 328 | legacy decision path |
| `src/logic/decision-chunk.ts` | 129 | legacy chunking |
| `src/logic/decision-worker.ts` | 22 | legacy worker |
| `src/logic/decision-worker-pool.ts` | 161 | legacy worker pool |
| `src/logic/board-evaluator.ts` | 678 | legacy heuristics, re-encodes rules |
| `src/logic/simulator.ts` | 181 | legacy forward model |
| `src/logic/board-graph.ts` | 994 | passability re-encoding |
| `src/logic/multi-source-bfs.ts` | 736 | territory re-encoding |
| `src/logic/move-analyzer.ts` | 200 | move safety re-encoding |
| `src/logic/piece-moves.ts` | 217 | "MIRRORED from moveGrammar" |
| `src/logic/piece-threats.ts` | 432 | contest copy at `:7` |
| `src/config/centaur-engine.ts` | 114 | the switch |
| `scripts/sync-partial-engine.js` | 312 | no upstream (§5) |
| test bulk (36 files) | 11,539 | §4a |

**Rewritten** (~18,500 lines touched):

| path | lines | change |
|---|---|---|
| `src/lobster/substrate.ts` | 1253 → ~470 | §2.1 |
| `src/lobster/candidates.ts` | 1442 → ~1330 | §2.3, edit |
| `src/lobster/contracts.ts` | 653 → ~600 | drop `StateHandle`/`Resolution`/`EngineScoreBounds`; adopt `PartialSettlement`, `Claim`, `Divergence`, `TraversalVerdict` |
| `src/lobster/bounds/bank.ts` | 806 → ~760 | `Resolution` → `PartialSettlement`; B1/B3 branch through `HeldUnit.options` |
| `src/lobster/bounds/ledger.ts` | 117 → ~55 | §2.2 |
| `src/lobster/bounds/testkit.ts` | 751 → ~520 | boards built through `marshalBoard`, not `UnitSpec`/`toUnitSpecs` |
| `src/lobster/staging-safety.ts` | 335 → ~210 | §2.4 |
| `src/lobster/tier-window.ts` | 384 → ~180 | §2.4 |
| `src/lobster/evaluate/features.ts` | 945 → ~890 | `Fate`/`FieldSlot`/`Resolution`/`ScoreBounds`/`UnitKind` (`:48-55`) → contract types |
| `src/lobster/evaluate/shells.ts` | 324 → ~300 | `FrozenRecord`/`CloudTimeline`/`NEVER` (`:40-53`) → `Claim` |
| `src/lobster/evaluate/territory.ts` | 572 → ~540 | `Grid`/`Terrain`/`bbPopcount`/`scalarOf` (`:79-84`) → plain arrays + `outranks` |
| `src/lobster/evaluate/{momentum,food,bound}.ts` | 547 | one import line each |
| `src/lobster/search/order.ts` | 185 | `Resolution` type swap (`:12`) |
| `src/lobster/team-decision-engine.ts` | 1252 → ~1240 | drop `MAX_FROZEN`/`NEVER` (`:46`) |
| `src/logic/waypoint-pathing.ts` | 381 → ~260 | `BoardGraph` (`:28,149,332,361`) → new `logic/route.ts` |
| `src/logic/decision-logger.ts` | 966 → ~930 | drop the `cellOwnership` column plumbing (`:216,391-413,488`) or repoint it at `territory-view` |
| `src/firebase/firebase-interface.ts` | −~120 | drop `VoronoiStrategy`/`MoveAnalyzer`/`BoardGraph` (`:64-66`), `quickSafeMove` (`:1600-1614`) → a ~40-line `legalTargets`+`pathrisk` quick move; delete the `centaurEngine()` branches (`:1399`, `:1504`, `:1534-1585`) |
| `src/server/active-game-manager.ts` | −~90 | `piece-moves` (`:15,2342,2364,2485`) → grammar queries; `BoardGraph` (`:7,1687,1869,1961,2514`) → `logic/route.ts`; `CellOwnership` (`:27,101,124,3145,3153`) → `logic/territory-view.ts` |
| `src/index.ts` | −~25 | drop `VoronoiStrategy` (`:5,45`), `DecisionWorkerPool` (`:8,168,261`) |
| `src/config/heuristics.ts` | 501 → ~380 | prune the weights only `board-evaluator` read (verify at cut time) |
| tests: 11 files rewritten | ~7,100 | §4b |

**New** (~910 lines of source):

| path | lines | replaces |
|---|---|---|
| `src/lobster/pathrisk.ts` | ~260 | `partial-engine/risk.ts` (966) |
| `src/lobster/bounds/material.ts` | ~130 | `partial-engine/bounds.ts` (455) |
| `src/logic/staging-legality.ts` | ~140 | `logic/piece-moves.ts` (217) — a thin adapter from api coords to `legalTargets`/`pathOf`/`legalOrientations` |
| `src/logic/territory-view.ts` | ~180 | `multi-source-bfs.toCellOwnership` + `board-graph` for the UI (§3) |
| `src/logic/route.ts` | ~200 | `board-graph`'s passability for waypoint pathing (§3) |

**Unchanged** (no edit at all): `src/lobster/kernel.ts` (2093),
`search/core.ts` (762), `search/basis.ts` (94), `voc.ts` (661), `pins.ts` (409),
`postures.ts` (297, gains `TIER_DEFENSE`), `telemetry.ts` (906),
`evaluate/{contest,tier,laws,closing,calibration,index}.ts` (1849),
`bounds/{score,witness,plan,memo,evalmemo,substrate-ext,index}.ts` (1076),
`logic/turn-oracle.ts` (807 — `marshalBoard` is the one translation and stays),
`logic/{turn-timeline,team-detector,game-registry,server-event-logger,command-logger,pending-game-registry,decision-telemetry}.ts` (1,126),
`wire/**`, `web/**`, `database/**`, `routes/**`.

---

## 3. The legacy path

### 3.1 The delete list

`CENTAUR_ENGINE=legacy` and every module reachable only from it. The switch
itself: `config/centaur-engine.ts` (114) — `CENTAUR_ENGINE_ENV:81`,
`centaurEngine():112` — plus its three read sites
(`firebase-interface.ts:1399,1504`, and `centaur-engine.ts` is also imported by
`decision-pass-rejection.test.ts`).

| module | lines | last consumer outside tests |
|---|---|---|
| `decision-engine.ts` | 844 | `active-game-manager.ts:17` (`pickBestMove`, used only inside the waypoint re-bias at `:1875`) and `firebase-interface.ts:1542` (legacy branch) |
| `voronoi-strategy.ts` | 328 | `index.ts:45`, `firebase-interface.ts:477,1163,1542` (legacy branch) |
| `decision-chunk.ts` | 129 | tests only |
| `decision-worker.ts` | 22 | none |
| `decision-worker-pool.ts` | 161 | `index.ts:8,168,261` (shutdown hooks only) |
| `board-evaluator.ts` | 678 | tests only |
| `simulator.ts` | 181 | tests only |
| `board-graph.ts` | 994 | `active-game-manager.ts:7`, `firebase-interface.ts:65` — **live, see §3.2** |
| `multi-source-bfs.ts` | 736 | `active-game-manager.ts:27` (`CellOwnership` type on `TurnData`) — **live, see §3.3** |
| `move-analyzer.ts` | 200 | `firebase-interface.ts:66,459,1602` — **live, see §3.4** |
| `piece-moves.ts` | 217 | `active-game-manager.ts:15` — **live, see §3.2** |
| `piece-threats.ts` | 432 | tests only (`simulator.ts:3` goes with it) |

Total 4,922 + 114 = **5,036 lines**, of which four modules have a live UI
consumer that must be replaced first.

### 3.2 What the live UI still takes, and what replaces it

**Staging legality** — `active-game-manager.ts:15` imports `planPieceAction`,
`legalPieceDestinations`, `canHold` from `piece-moves.ts`, and uses them at
`:2342` (validating an operator command), `:2364` (planning the staged action)
and `:2485` (the candidate list broadcast to the web board). The file's own
comment at `:2238` says `piece-moves.ts` mirrors the server's grammar, and
`:2337` says the bot recommendation is "validated through the SAME
planPieceAction". Replacement: `src/logic/staging-legality.ts` (~140) — an api-
coordinate adapter over `legalTargets` / `pathOf` / `legalOrientations`
(E7 + `moveGrammar.ts:76`). Behaviour change to expect: `piece-moves.ts` is a
mirror, so any place it drifted is a place the UI's offered destinations change.
`piece-staging.test.ts` (747) and `piece-bot-route.test.ts` (344) are the gates.

**Waypoint pathing** — `active-game-manager.ts:1687,1869,1961,2514` all build a
`BoardGraph` purely so `waypoint-pathing.ts` (`:149,332,361`) has a passability
oracle, and `:1961` additionally uses `graph.isInBounds` /
`passabilityIdxFor` for a hazard-survivability check. Replacement:
`src/logic/route.ts` (~200) — a BFS over the engine's board with passability
derived from `walls`, `hazards`, `Claim.certainIfAlive` and
`turnEngine.outranks`. Nothing about routing is a rule; what *was* rule-shaped
in `board-graph` (severability, hazard health arithmetic) is answered by
`settlePartial` instead.

### 3.3 Territory rendering

`firebase-interface.ts:1565` puts `result.cellOwnership` (from
`VoronoiStrategy`, itself `multi-source-bfs.toCellOwnership` at
`voronoi-strategy.ts:175`) on `TurnData`; it rides through
`active-game-manager.ts:101,124,3145,3153` to `websocket-server.ts:956`
("`cellOwnership` stays: it feeds the Alt-click …") and into
`decision_logs.cell_ownership` (`database/schema.ts:79`).

Replacement: `src/logic/territory-view.ts` (~180), computing the same
`{sources, owner, distance}` shape from the engine's board. It is a thin
extraction of a partition the bot **already computes soundly** —
`lobster/evaluate/territory.ts:12-30` is the two-plane rule (trail units
partition by earliest arrival; a piece displaces only when it wins the
stationary contest through the resolver's own comparator), and `:52-62` is the
set-cover sweep that yields the per-unit ownership planes "for free". So the UI
gets a *better* territory map than `multi-source-bfs` gave it, from the same
code the search scores with, and `unit-inspection.test.ts:97-122` (which asserts
`cellOwnership.sources`) is the shape gate.

### 3.4 The fast staging pass

`firebase-interface.ts:1448` calls `quickSafeMove` for every alive snake on
**every** turn — above the `centaurEngine()` branch, so it runs under
`lobster` too. At `:1601-1602` it builds a `BoardGraph` and calls
`MoveAnalyzer.analyzeMoves`. Its contract (`:1597-1599`) is "a cheap (~1ms) safe
move: prefer continuing straight when that is safe, else the analyzer's first
safe move, else a risky one".

Replacement (~40 lines, in `firebase-interface.ts`): `legalTargets` for the
option set, `staging-safety.certainlySelfFatal` for the refusal (which is
already the rules-certain filter, `staging-safety.ts:31-35`), preference for
the orientation-continuing step. No `settlePartial` call — the pass must stay
~1ms. This is the only legacy consumer that is on a latency budget, and it is
the one to measure.

---

## 4. The test plan, in the owner's order

### (a) Bulk delete — 36 files, 11,539 lines, before anything else

**Partial-engine differential and oracle** (2,461):

| file | lines | why it goes |
|---|---|---|
| `partial-engine-differential.test.ts` | 341 | proves two encodings agree; after the cut there is one |
| `partial-engine-oracle.ts` | 256 | the differential's harness |
| `partial-engine-api.test.ts` | 147 | pins the `PartialEngine` surface |
| `partial-engine-landing.test.ts` | 217 | pins `RiskAssessor` landing sets |
| `partial-engine-seams.test.ts` | 262 | pins the hold/fork/release seams |
| `partial-engine-adjudication.test.ts` | 302 | pins the second contest rule |
| `partial-engine-vendor-sync.test.ts` | 195 | guards a vendor with no upstream (§5) |
| `arrival-shell-drift.test.ts` | 34 | asserts the drift block is wired into the above |
| `arrival-shell-differential.ts` | 262 | cloud-vs-shell differential |
| `wire-adapter.test.ts` | 308 | pins `toUnitSpec`, which goes with `partial-engine/` |
| `potion-tier-bounds.test.ts` | 137 | imports `partial-engine/field` directly (`:1`) |

**Simulator / forward-model tests** (1,824): `settlement-forward-step.test.ts`
(205), `severing-move-simulation.test.ts` (573),
`pawn-promotion-simulation.test.ts` (224), `health-mechanics.test.ts` (423),
`frozen-unit-contract.test.ts` (256), `invulnerability-severability.test.ts`
(143). All pin `logic/simulator.ts` + `board-graph` behaviour; every rule they
assert is now an engine golden replay (§4b).

**piece-moves / threat tests** (1,592): `piece-moves.test.ts` (264),
`piece-contest.test.ts` (343), `piece-hold.test.ts` (399),
`piece-threat-map.test.ts` (383), `unit-threat-map.test.ts` (203). They pin the
mirrored grammar and the copied contest rule; the grammar-query tests replace
them.

**Legacy engine tests** (5,662): `voronoi-strategy.test.ts` (380),
`decision-iterative.test.ts` (187), `board-graph-adjacency.test.ts` (286),
`board-graph-stacked-head.test.ts` (118), `trap-survival.test.ts` (434),
`friendly-fire-regicide.test.ts` (512), `safety.test.ts` (150),
`space-detection.test.ts` (419), `fatal-path-projection.test.ts` (668),
`starvation-vacate.test.ts` (286), `territory.test.ts` (1115),
`territory-slider.test.ts` (513), `centaur-engine-flag.test.ts` (450),
`decision-pass-rejection.test.ts` (144). Each pins a legacy module's structure
or the `CENTAUR_ENGINE` switch.

**Bounds tests coupled to partial-engine types** — these are **rewritten, not
deleted**, because they encode the property that matters:
`bounds/soundness.test.ts` (466), `bounds/bank.test.ts` (612),
`bounds/testkit.ts` (751). Their coupling is to `StateHandle`/`UnitSpec`/
`resolveBounded` (`testkit.ts:46-59`), not to the property.
`bounds/score.test.ts` (190) and `bounds/evalmemo.test.ts` (323) are pure
algebra and survive untouched.

### (b) The new boundary tests, written BEFORE the cut

**Engine-side, in TacticToes** (~600 new lines):

| test | what it pins |
|---|---|
| `engine/settleTurn.golden.spec.ts` | one byte-identical turn-by-turn replay per phase: effects+ally-cancel, potion collect at window 3 and at 8, orientation (incl. the pawn exception, `settleTurn.ts:210`), promotion (weight collapse, queen health clamp, `:242-262`), adjudication's four branches incl. the mutual wipe on `previous`. These are spec E1–E5's own gates, kept as regression fences. |
| `engine/settlePartial.soundness.spec.ts` | **T1–T5 by enumeration.** Random 7×7–9×9 boards, 2–5 units, 1–2 held with `span ∈ {1,2}`, seeded. For every board: enumerate every `σ ∈ Π Hist(h)` (bounded to ≤ 4,000 by construction), run `settleTurn(I ⊕ σ)`, and assert (T1) every disposition disagreement is ledgered; (T2) `dead`/`alive` fates hold in every σ; (T3) every coordinate lies in its bracket; (T5) `held = ∅` reproduces `settleTurn` exactly. Then re-run with a narrowing and assert (T4) containment. This is the `twin.ts` role and the `checks.ts` audits, discharged against the real rules. |
| `engine/claims.spec.ts` | reach containment (every σ's occupancy ⊆ `headPossible ∪ bodyPossible`), `certainIfAlive` correctness for trail units, tier-interval endpoints against a reachable potion, the promotion fork's `kinds`, `earliestSubStep` monotonicity |
| `engine/grammarQuery.spec.ts` | `legalTargets` = `{d : planUnitAction(d) ≠ null}` for all 7 kinds on a board with walls, hazards, trail units and food; `pathOf` = `planUnitAction(...).path`; `coverOf` = ⋃ `pathOf` over `legalTargets`. The three known bot bugs (hazard terrain, trail-unit walls, pawn cover — spec §4) are asserted *as the engine has them*. |
| `engineVendor.spec.ts` | one line: the directory listing gains `claims.ts`, `settlePartial.ts`, `grammarQuery.ts` |

**Bot-side, in Chris-Centaur** (~2,400 new lines, replacing 7,100 rewritten):

| test | what it pins |
|---|---|
| `lobster/__tests__/substrate.test.ts` (rewrite of 684) | the `Substrate` contract against `PartialSettlement`: plan domain = modelled set; a plan naming everything has an empty ledger and `fates` all determinate; `entangled` never under-reports (checked against `claims` directly); `withModelled` narrower-sibling is now *correct* rather than refused; no slab assertions |
| `lobster/bounds/soundness.test.ts` (rewrite of 466) | unchanged property (`:1-15`), new ground truth: `trueWorstCase` enumerates through `settlePartial(held = ∅)`. Same cross-product: boards × staged sets × bank configurations × clock regimes |
| `lobster/bounds/bank.test.ts` (rewrite of 612) | B0/B1/B2/B3 over `Divergence` ledgers; `residueOf` ordering; the which-truncation refusal (`bank.ts:36-44`) |
| `lobster/bounds/ledger.test.ts` (new, ~120) | polarity: `assumedPresent` ⟹ `if_absent`; every `Divergence.kind` maps to a `LedgerEntry` note; `narrowed` entries force `exact: false` |
| `lobster/__tests__/candidates.test.ts` (rewrite of 959) | **candidate legality equals engine legality**: for every unit on every fixture board, `new Set(candidatesFor(...).map(c => c.to)) ⊆ new Set(legalTargets(...))`, and with all knobs off the two are equal. Plus: no exact prune removes a candidate that resolves differently (checked by settling both). |
| `lobster/__tests__/pathrisk.test.ts` (new, ~300) | for a one-mover plan, `assessPath`'s per-cell trits agree with the settlement: `survival = 'no'` ⟺ the unit is in `deaths`; `'maybe'` ⟺ `fates = contingent`; `halt` ⟺ `traversed` is shorter than the staged path |
| `lobster/__tests__/staging-safety.test.ts` (rewrite of 851) | `certainlySelfFatal` ⟹ the settlement kills the mover, on every fixture; `killsOwnKing` stays a *declared* prune |
| `lobster/__tests__/tier-window.test.ts` (rewrite of 460) | `Claim.tierAtArrival` equals the wire's lapsed level; `selfDebuffOf` equals the `tiersAfterPickupBy` diff |
| `src/tests/engine-vendor-sync.test.ts` (edit of 106) | the vendored tree matches upstream's `VENDOR.md` file table byte-for-byte, now 8 files |
| `src/tests/staging-legality.test.ts` (new, ~200) | the api-coord adapter round-trips `legalTargets`/`pathOf`; every destination the UI offers is one the server accepts |
| `src/tests/territory-view.test.ts` (new, ~180) | `{sources, owner, distance}` shape (the assertion `unit-inspection.test.ts:97-122` made); owner partition matches `evaluate/territory.ts`'s plane 1 |
| `src/tests/basic-intelligence.test.ts` (326) | **survives as the merge bar.** Food gets eaten, nothing starves beside a meal, no unit undoes itself, no piece spends the game rotating, nothing walks into a wall it did not have to (`:9-16`) |
| `src/tests/local-game.ts` (767, rewrite of its `piece-moves` import at `:31`) | **survives as the merge bar.** The 30-turn read-by-eye runner over the shipped decision path |

### (c) The cut — nine commits, two repos

Each commit is a coherent state. The column says which tests that commit is
expected to pass; a blank means "the suite does not compile and that is the
point".

| # | repo | commit | expected green |
|---|---|---|---|
| **C0** | TT | **[E-pending]** E6 `Spawner` + `NO_SPAWN`; E7 `grammarQuery.ts` (`legalTargets`/`pathOf`/`coverOf`); processor injects its RNG | full server suite; `engineVendor.spec.ts`; a full-game replay byte-identical |
| **C1** | TT | `engine/claims.ts` + `engine/settlePartial.ts` + the four new specs; `turnEngine` exports `outranks`; `moveGrammar` exports `costPerCell`; `VENDOR.md` gains three rows | full server suite (untouched); the four new engine specs; the standalone `tsc` vendorability check in `VENDOR.md` |
| **C2** | CC | **bulk delete**: the 36 test files of §4a, and nothing else | the remaining suite, in full — this commit changes no source |
| **C3** | CC | the new boundary tests of §4b, written against types that do not exist yet | *nothing new.* `engine-vendor-sync`, `score.test`, `evalmemo.test` and the untouched half of the suite still pass; everything else fails to compile |
| **C4** | CC | re-vendor: `npm run sync-engine` pulls 8 files; retire `sync-partial-engine.js`, `VENDOR-MANIFEST.json` (§5) | `engine-vendor-sync.test.ts` |
| **C5** | CC | **the seam**: new `substrate.ts`, `pathrisk.ts`, `bounds/material.ts`, `bounds/ledger.ts`, `bounds/testkit.ts`; `contracts.ts` retyped; **delete `src/partial-engine/**` and `tier-truth.ts`** | substrate contract; bounds soundness; bank; ledger; pathrisk; `score`/`evalmemo` |
| **C6** | CC | candidates / staging-safety / tier-window / evaluate rewire. **Own commit, because it is a behaviour change**: the three known grammar bugs are fixed, and the tier-potion widening ships (§2.4) | candidate legality = engine legality; staging-safety; tier-window; evaluate; search core; kernel |
| **C7** | CC | **the legacy rip**: delete the 12 modules + the switch; add `staging-legality.ts`, `territory-view.ts`, `route.ts`; rewire `active-game-manager`, `firebase-interface`, `index` | the whole suite except the behavioural gates |
| **C8** | CC | green: `basic-intelligence.test.ts`, telemetry/soak, lint, and the 30-turn `local-game` read | **everything** |

**What must be true before C2.** (i) C0 and C1 are merged upstream and the
vendorability check is silent — the bot cannot be mid-flight against an engine
that is itself mid-flight. (ii) The `develop` branch is at a known-green
baseline with the current suite recorded (file count, test count, duration), so
the C8 comparison is against a number and not a memory. (iii) The three
behavioural gates have a *recorded* pre-cut reading: `basic-intelligence`'s
counters, and one 30-turn `local-game` transcript per scenario
(`SNAKE_SCENARIO`, `MIXED_SCENARIO`) saved to the scratchpad. Without (iii),
C6's deliberate behaviour change has nothing to be compared against.

**What `develop` requires before it takes the branch.** Full suite green;
`npm run lint` clean; `basic-intelligence.test.ts` green with counters no worse
than the pre-cut recording on every gate; two 30-turn `local-game` transcripts
read by a human and judged not-stupid; and one recorded regression run of the
tier widening C6 shipped (the "858-inversion interaction storm" of
`tier-truth.ts:33-46` re-measured — bounds inversions counted per decision, and
the count must be zero, because `bounds/score.ts:37-44` throws rather than
clamping).

---

## 5. Repo mechanics

**Where partial mode lives.** Two **sibling files inside the same vendored
directory**: `engine/settlePartial.ts` and `engine/claims.ts`, not new code in
`engine/settleTurn.ts`. Three reasons:

1. `engineVendor.spec.ts:25-40` asserts the exact directory listing, so a
   sibling costs one line there and one row in `VENDOR.md`'s table — and any
   file that lands in `engine/` without that edit fails the build, which is the
   guard working.
2. The server never calls `settlePartial`. Keeping it out of `settleTurn.ts`
   keeps the processor's hot path free of the claim machinery, and keeps
   `settleTurn.ts` readable at ~309 lines rather than ~1,200.
3. The import rule is satisfied trivially: `settlePartial.ts` imports
   `./settleTurn`, `./claims`, `./moveGrammar`, `./turnEngine` and
   `@shared/types/Game`; `claims.ts` imports `./moveGrammar`, `./turnEngine`
   and the wire types. `engineVendor.spec.ts:44-49` accepts exactly that shape.

**Why rule-shaped code the server never runs belongs in TacticToes anyway.**
"Where could that unit get to, given the grammar, over n turns" is a grammar
question. The owner's directive is that nothing rule-shaped lives outside the
one engine *in either repo*; putting reach-over-n-turns in the bot is putting a
second grammar in the bot, which is the exact thing this whole plan deletes.
And there are already two other callers named in the spec (§4): the human
interface's legality overlay, and the harness's opponent-support constructor.

**The one sync script.** `scripts/sync-engine.js` gains three entries in
`VENDORED_FILES` (`sync-engine.js:38-45`) — `adjudicate.ts` (already missing
today), `settlePartial.ts`, `claims.ts`, `grammarQuery.ts` — bringing the
vendored tree to 8 files. `engine-vendor-sync.test.ts` (106) already asserts
the vendored tree matches `VENDOR.md`'s table exactly, so a file added upstream
surfaces as a failing test rather than a silent omission; that property is what
makes the addition safe.

`VENDOR.md` gains: a row per new file in the "Files that constitute the module"
table; a short section **"Partial settlement"** stating (i) the signature,
(ii) the T1 corollary in one sentence ("an empty ledger is a proof; a non-empty
one is a work list"), (iii) that `Claim` is a pure function of its inputs and
therefore memoisable by the caller, and (iv) the same warning `tier` already
carries at `VENDOR.md:103-108`: *a caller that computes a held unit's reach for
itself has written the grammar a second time — read `claims`.*

**Retirement.** `scripts/sync-partial-engine.js` (312),
`src/partial-engine/VENDOR-MANIFEST.json` (66) and
`src/tests/partial-engine-vendor-sync.test.ts` (195) are deleted at C4, along
with `src/tests/arrival-shell-drift.test.ts` (34), which exists only to assert
that the arrival-shell block is wired into the vendor-sync test (`:4,20`). The
`sync-partial-engine` entry in `package.json`'s `scripts` goes with them.

**Snek-Centaur-Platform is not a source for anything any more.** Verified
today: `Cyphid-Academy/snek-centaur-platform` @ `edeebc5` has no
`packages/engine/src/partial/` subtree — the path
`sync-partial-engine.js:44,47` points at does not exist upstream. The vendored
copy in `src/partial-engine/` is therefore unreachable from its origin and
cannot be re-synced, re-checked against a source, or patched upstream. It is
not a vendored package; it is 9,262 orphaned lines with a header claiming
otherwise. No future step in this plan, and no future work in either repo, may
treat that repo as a source. The one thing it is still good for is *reading*,
while `claims.ts` and `settlePartial.ts` are being written — the design ideas
in `cloud.ts:12-30`, `field.ts:10-17` and `engine.ts:1283-1296` are worth
transplanting; the code is not.

---

## 6. Sizing and parallelism

### 6.1 Lines per step

| step | repo | added | deleted | net |
|---|---|---|---|---|
| C0 (E6+E7) | TT | ~180 | ~60 | +120 |
| C1 (claims + settlePartial + specs) | TT | ~1,490 | ~4 | +1,486 |
| C2 (test bulk delete) | CC | 0 | 11,539 | −11,539 |
| C3 (new boundary tests) | CC | ~2,400 | 0 | +2,400 |
| C4 (re-vendor, retire partial sync) | CC | ~1,700 | ~800 | +900 |
| C5 (the seam) | CC | ~1,900 | ~11,100 | −9,200 |
| C6 (candidates / safety / tier / evaluate) | CC | ~1,100 | ~1,600 | −500 |
| C7 (legacy rip) | CC | ~700 | ~5,300 | −4,600 |
| C8 (green) | CC | ~200 | ~100 | +100 |
| **totals** | | **~9,670** | **~30,500** | **−20,830** |

C4's "added" is the vendored bytes (8 files, ~2,600 lines with headers) minus
the 4 files already vendored; its "deleted" is `sync-partial-engine.js` +
manifest + the two vendor-drift tests.

### 6.2 Tracks, and what may run in parallel

Four tracks. Within a track, order is strict; across tracks, the table says
what may run concurrently in a separate worktree and which files are the
conflict surface.

| track | commits | may start when | touches | conflicts with |
|---|---|---|---|---|
| **E** — engine | C0, C1 | now | `TacticToes/functions/src/gameprocessors/**` only | the concurrent E5–E7 agent: **must be the same agent or strictly serialised**, since both edit `settleTurn.ts`/`VENDOR.md`/`engineVendor.spec.ts` |
| **T** — tests | C2, C3 | C1 merged | `Chris-Centaur/src/tests/**`, `src/lobster/**/__tests__/**`, `src/lobster/bounds/*.test.ts` | none — deletes and adds test files only |
| **B** — bot seam | C4, C5, C6 | C2 merged (C3 may land in parallel) | `src/engine-vendor/**`, `src/partial-engine/**`, `src/lobster/**`, `scripts/`, `package.json` | T on `bounds/testkit.ts` (a test helper that is also source) — assign it to **B** |
| **L** — legacy + UI | C7 | C2 merged | `src/logic/**`, `src/server/**`, `src/firebase/**`, `src/index.ts`, `src/config/**` | B on `src/config/heuristics.ts` and `src/tests/local-game.ts` (`:31` imports `piece-moves`) — assign both to **L** |

**Order.** E → T → { B ∥ L } → C8.

B and L are the parallel pair, and they are genuinely disjoint: B owns
`src/lobster/**` and the vendored trees; L owns `src/logic/**`,
`src/server/**`, `src/firebase/**`. The only three shared files are named
above, and each is assigned to exactly one track. Merge L first (it is smaller
and it unblocks `local-game.ts`, which C8's behavioural gate runs), then B,
then C8 on the merge.

**Two things that must not be parallelised.** C5 and C6 look separable — one
deletes the second engine, the other rewires the consumers — but C6's
behaviour change (the three grammar bug fixes and the tier widening) is only
measurable against a working substrate, so C6 must follow C5 in the same
worktree. And C2 must not overlap anything: it is the commit whose whole value
is that it changes no source, so that a suite failure at C3 is unambiguously
about C3.

---

## 7. The three decisions most likely to be wrong

1. **Putting `claims.ts` and `settlePartial.ts` inside the vendored TacticToes
   directory.** It roughly doubles the module (1,579 → ~2,500 lines), and the
   server runs none of the new code, so the review pressure that keeps
   `settleTurn.ts` honest does not apply to it. The alternative — a bot-side
   claim layer over the vendored `settleTurn` — is cheaper and is what the
   present architecture already is, and it is exactly the architecture that
   produced 9,262 orphaned lines. The plan takes the directive literally.
2. **Moving the `[worst, best]` material fold out of the engine into
   `lobster/bounds/material.ts`.** Today the fold is welded to the resolver
   (`exact.ts:186-212`), so a rules change that alters survival alters the
   bound in the same commit. Bot-side, the weld becomes a theorem checked only
   by `bounds/soundness.test.ts`. It buys the deletion of
   `partial-engine/bounds.ts` and collapses "three dialects of one interval" to
   two; it costs the guarantee that the bound and the rule move together.
3. **Deleting `risk.ts` (966) and re-deriving its per-cell trits from one-mover
   `settlePartial` folds.** `candidates.ts` prunes on those trits, so this
   changes which moves the bot considers, and no differential can catch it —
   the old grading has no successor to be differenced against. The only gates
   are `basic-intelligence.test.ts` and a human reading 30 turns, which is why
   §4c insists on a recorded pre-cut transcript before C2 and why C6 is its own
   commit.
