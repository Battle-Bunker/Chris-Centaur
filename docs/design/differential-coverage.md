# Differential coverage: what the two encodings are actually held to

This bot carries two encodings of the game rules. `src/engine-vendor/` is a
byte-for-byte copy of the server's own module — `settleTurn`, `resolveTurn`,
`turnEngine`, `moveGrammar` — and `src/partial-engine/` is the vendored
possibility-cloud engine, whose `engine.ts`, `grammar.ts` and `contest.ts`
restate those rules and whose `cloud.ts` / `field.ts` / `exact.ts` /
`bounds.ts` add a layer of uncertainty on top: unmodelled units are HELD as
claim clouds, the optimistic timeline treats a merely-possible occupant as
empty, and a ledger entry is recorded wherever the truth could differ.

The plan is to get to ONE encoding and delete every restatement. What follows
is the safety net that gating is done against: three suites, what each one
proves, and — the part that matters when someone is deciding whether a
deletion is safe — what each one still does not.

    npx jest src/tests/partial-engine-differential.test.ts \
             src/tests/partial-engine-held-soundness.test.ts \
             src/tests/partial-engine-grammar-parity.test.ts

3,200 settled boards, 11,491 enumerated worlds, 333,396 staged intents and
3,000 contests. 7.2 s warm and in-band; about 3.7 s of that is test execution
the suite did not have before, against a 113 s full run of all 101 suites.

---

## 1. The whole-turn differential — `partial-engine-differential.test.ts`

**Proves.** On 2,000 seeded 9×9 boards (short trails, mixed pieces, staged
destinations that are only sometimes legal) the possibility-cloud engine and
the vendored engine agree coordinate for coordinate: survivors and their cells,
health and weight; every death with its cell, sub-step and cause; every typed
clash with its participants, victims and survivor; every severed cell. 914 of
those boards kill something, 23 sever, 20 end in a mutual annihilation, 1,362
carry a weight-stacked piece (the case that separates a correct wire-adapter
weight collapse from a silently wrong one), and 1,192 typed events are compared.

The oracle is `settleTurn`, not `resolveTurn`. A second, separately-seeded set
of 1,200 boards carries potion cells (placed on staged destinations, because a
pickup needs an arrival), a turn number, a pickup window and opening buffs and
debuffs whose levels sum to each unit's adjudication tier. 214 collect a
potion, 466 issue an ally buff, 41 cancel one, 537 expire an effect, 592 carry
a negative tier. On those boards the board half is compared exactly as above —
which is where a tier the two encodings disagreed about would surface first,
since the contest is ordered on tier before anything else — and the settlement
coordinates are checked by five laws stated at `settlementDiff` in
`partial-engine-oracle.ts`: `tiers` names exactly the survivors the cloud
engine independently left standing; the potions settlement removed are exactly
the ones under a survivor's head; every survivor's settled tier equals the sum
of the effects it was left with; nothing due at or before this turn outlives
it, and no effect outlives its owner; and a turn with nothing to settle comes
out byte-identical. A sixth test shows `settleTurn`'s board half identical to
`resolveTurn`'s on 400 potion boards, which is what makes switching the oracle
a safe substitution rather than a change of subject.

**Does not prove.** The pickup arithmetic itself is single-encoded — the cloud
engine has no settlement layer — so nothing here is a two-sided differential of
"the collector takes −1 and each living ally takes +1". A change that moved a
tier and its effect together, in the same wrong direction, satisfies every law
above. The inert-turn law is the guard against that and it is a weaker guard
than a second encoding would be. Also unproven: regicide (`regicideTeamIDs` is
always empty), `maxHealthPerKind` (one flat maximum), pawn promotion and the
orientation rewrite (both deliberately outside the vendored module, both
implemented by the cloud engine, neither compared), boards wider than 9×9, and
`potionsEnabled: false` beyond the 10% of the potion set that draws it.

## 2. Held-unit soundness — `partial-engine-held-soundness.test.ts`

**Proves.** One to three units are HELD, the turn is priced once through
`resolveBounded`, and then every legal thing the held units could have done is
enumerated through the engine's own `enumerateActions` and settled through the
vendored `settleTurn` — 11,491 concrete worlds over 294 boards, with pieces,
snakes, food and hazards, and a second pass carrying potions and non-zero
tiers. Products past 200 worlds are skipped and counted (35 boards), never
truncated. Four laws: every concrete world's subject-frame score lies inside
`[bounds.worst, bounds.best]`; `Fate.Alive` and `Fate.Dead` hold in every
world; the survival trit `resolveBounded` folds a held unit in at does not say
"yes" about a unit some world kills nor "no" about one some world spares; and
where a world differs from the optimistic timeline on a live unit, the ledger
names that unit. 180 of 299 single-hold boards are proved outright by an empty
ledger — every world agreeing with the optimistic timeline, unit for unit.

**It found two false proofs**, both in the vendored uncertainty layer, both
pinned as minimal two-unit repros marked `test.failing` (green while the
property is violated, red the day it holds):

- **H1 — the hazard is read a turn late.** `Cloud.deathPossible` tests
  `bbIntersects(prev.everPossible, terrain.hazard)` (`cloud.ts:718-723`, and
  again in the saturation short-circuit at `:582`) — the cumulative reach as of
  the *previous* turn — while its sibling term `couldHitWall`, three lines
  above, dilates from `prev.headPossible` and so covers the turn being
  resolved. A hazard a held unit can first enter this turn is invisible for
  exactly one turn, the claim returns `deathPossible: false`, and
  `resolveBounded` prices the unit certainly alive. Repro: a knight held at
  (7,2) with health 99, a hazard at (5,3) doing 100 — one L-jump away. The
  world where it dies scores above the reported ceiling.
- **H2 — the footprint only looks one way.** `mayHaveDied`'s footprint half is
  `cloud.possible ∩ touched`, and `touched` holds the *live* movers' origins
  and landings. A live trail unit's standing body is neither, and a cloud is
  branch-independent by construction so it cannot know the body is there. A
  frozen unit that walks into one dies unforeseen ("yes", killed); a
  higher-tier one SEVERS the live unit, changing its material with an EMPTY
  LEDGER, against the discharge theorem in as many words. Repro: a snake at
  (3,3)-(5,3) stepping west, a knight held at (6,4) — whose eight landings
  include the snake's standing body and neither its origin nor its landing —
  jumping onto (4,3).

Worlds exhibiting either mechanism are counted (H1: 299, H2: 957) rather than
asserted on; a violation by any other mechanism is a hard failure, which is
what keeps the four laws live. The counters are asserted non-zero, so the day
either bug is fixed upstream this suite says so twice.

**Does not prove.** Held sets larger than three, or boards whose product
exceeds 200 worlds — 35 boards were skipped, and they are the crowded ones.
Nothing about a unit held for MORE THAN ONE TURN: every record here is stamped
at the current turn, so multi-turn cloud dilation, the tier interval's
widening, promotion mid-freeze and the food relaxation are all untested. The
ledger law is per-live-unit and would not catch a difference that is named for
the wrong unit, only one named for nobody. `narrowedTo` (declared narrowings)
is never exercised, and neither is `projectExact` — this suite enumerates the
world set itself rather than through the engine's own projection.

## 3. Grammar and contest parity — `partial-engine-grammar-parity.test.ts`

**Proves.** `grammar.ts` and `contest.ts` are the two files the one-engine
plan deletes first, and this is the claim a deletion makes. Every kind, every
interior origin, every orientation, every destination on the board, against
`moveGrammar.ts` `planUnitAction` — 333,396 staged intents over three
pawn-target sets, compared as a triple (legal or not, which action, which path
or facing), because two grammars that agree on legality and disagree on the
path are the worse failure. 37,186 legal: 32,482 moves, 1,176 pawn rotations,
3,528 stays. Zero disagreements. Plus the default action on every origin and
facing, the legal orientation set per kind, the property table (trail, edge
traversal, stay, wall entry) against the vendored predicates, and the single
promotion threshold.

The contest runs through `runTurnEngine` rather than a copy of its comparator
— `strictMaximum` is module-private, so the honest way to ask it who won is to
stage a co-arrival at one cell and read the clash record the engine writes.
3,000 random participant sets of two to five units, tiers −1..2 and weights
1..4: same survivor or same tie every time, same victim list. 312 ties, 1,842
decided on tier, 846 on weight, so both orderings of the lexicographic
comparator are exercised rather than assumed. `REASON` matches key for key.

**Does not prove.** One board size (9×9) and one terrain (perimeter walls, no
interior walls) — `planUnitAction` never consults a wall list, so a board with
interior walls is exactly where the two would part company, and it is untested.
Custom kinds registered through `registerKindProfile` are outside the vendored
grammar entirely. `pawnTargetsInto` is fed to both sides as one set here, so
the two constructions of that set are only compared indirectly, through the
whole-turn differential. And the contest is tested at a single cell with
simultaneous single-step arrivals: edge exchanges, durable piles and sever
adjudication reach `strictMaximum` by other routes that only suite 1 covers.

---

## What none of the three covers

`tierAtArrival` in `src/logic/simulator.ts` is a three-line re-encoding of
effect expiry that nothing here compares against `settleTurn`'s `tiers`; it is
the smallest remaining restatement of a settlement rule in this repo and the
cheapest one to delete. The bot's own layers above the engine — the substrate,
the bound bank, the evaluator — are covered by `src/lobster/**`'s own suites,
which price at a different altitude: `src/lobster/bounds/soundness.test.ts`
pins floor ≤ truth ≤ ceiling at the BANK, against its testkit substrate, while
suite 2 above pins the same shape one layer down, against the vendored
resolver. Neither subsumes the other.
