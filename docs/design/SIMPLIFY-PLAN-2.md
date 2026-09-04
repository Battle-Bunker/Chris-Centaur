# SIMPLIFY-PLAN-2 — the second pass, ranked

An audit of `audit2` @ `3198ec0`, after `docs/design/SIMPLIFY-PLAN.md` was
executed in full (`git log --oneline stable/one-engine-lens-v2..3198ec0`), and
after the four things that landed since: the decision lens (`src/lens/**`), the
threat map and the loud subset (`bounds/loud.ts`), the potion member
(`evaluate/potion.ts`), and the depth preconditions (`search/core.ts`'s refiner,
`evaluate/terminal.ts`).

The standing directive is unchanged:

> *"Any time you can delete complexity by factoring the code better so that
> there are fewer special cases and more straightforward parameterization of
> powerful abstractions, pursue it."*

**Judged the way round 1 asked to be judged.** Round 1's executors added helpers
where they removed duplication, so the net line delta on `candidates.ts` and
`evaluate/**` was near zero while every one of its items landed. The ranking
below therefore leads with SPECIAL CASES REMOVED and ABSTRACTIONS PARAMETERISED;
the Δ columns are honest arithmetic, not the ordering key. Item 1 is first
because it is 34 copies of five functions; item 2 is second on 55 lines because
those lines are five separate statements of one soundness rule.

Every item is **behaviour-preserving**. Nothing proposes a different move on any
board. Genuine defects found are in §5 and are NOT counted as simplifications.

Method: `git grep` symbol and import sweeps, per-export consumer counts, a
6-line normalised cross-file duplicate scan, and reading. Line numbers are
`file:line` on this worktree at `3198ec0`.

---

## 0. The gates

Unchanged from round 1, plus one the lens brought.

| gate | how to run it | what it catches |
|---|---|---|
| **BYTE-IDENTICAL RUNNER** | `npx tsc && node dist/tests/local-game.js sum all 60 5 --nodes --json=X.jsonl --label=after` in the changed tree and a clean one, then `node scripts/ab-compare.js before.jsonl after.jsonl` — an all-zero diff is the pass. Smoke version: `npx jest src/tests/local-game-determinism.test.ts` (it compares the whole summary **as a string**). | any change to which move the bot plays, on three board classes × five seeds, under the node clock |
| **SOUNDNESS SWEEP** | `npx jest src/lobster/bounds/soundness.test.ts` | `floor ≤ true worst ≤ ceiling` broken by a bank/bound edit, against exhaustive enumeration (`soundness.test.ts:1-30`) |
| **LENS DETERMINISM** | `npx jest src/tests/lens-determinism.test.ts src/tests/lens-replay-parity.test.ts src/tests/lens-schema.test.ts` | a reordering inside `better()` / the reservoir / the frame fold; G2's prefix property |
| **PROJECTION REBUILD** | `npm run lens:check` | the materialised `movesets` table disagreeing with the event stream |
| **A NAMED TEST** | as cited per item | the local contract that item touches |

---

## 1. The ranking

| # | item | Δ lines | risk gate | kind |
|---|---|---|---|---|
| 1 | [One test board harness](#1) — 34 copies of five fixture factories across `src/tests/**` | **−455 / +95** | the suites themselves + `npx tsc` | **MECHANICAL** |
| 2 | [`ourUnitTerm` absorbs `tier` and `potion`](#2) — one soundness rule, written five times | **−55 / +25** | byte-identical runner + soundness sweep + `evaluate.test.ts` | **MECHANICAL** (`tier`) / **JUDGEMENT** (`potion`) |
| 3 | [One arrival field](#3) — `ContestField` and `potion`'s `Horizon` are the same reducer, twice | **−50 / +30** | byte-identical runner + `evaluate.test.ts`, `potions` scenario | **MECHANICAL** |
| 4 | [One piece term table](#4) — six weighted terms restated four times in `active-game-manager.ts` | **−45 / +25** | named test (`piece-staging`, `contest-tie-and-sever-outcomes`) | **MECHANICAL** |
| 5 | [One unit-ascent step](#5) — `sweep` / `conform`'s repair / `repairSelfHarm` are one double loop | **−33 / +18** | byte-identical runner + lens determinism | **MECHANICAL** |
| 6 | [The lens kernel's placeholder half, and `record.ts` goes home](#6) — a barrel with no production importer that drags the test runner into `src/lens/**` | **−26 / +1**, and −321 lines out of the production graph | `npx tsc` + lens determinism | **MECHANICAL** |
| 7 | [One sweep for the bank's rungs](#7) — round 1's item 11, re-judged: B0/B1/B2/B3 are one walk at four list shapes | **−45 / +26** | **soundness sweep** across every bank config + `bank.test.ts` | **JUDGEMENT** |
| 8 | [One plan-part encoder](#8) — `${unitId}>${to}:${path}` hand-written in four modules | **−30 / +12** | lens determinism + `lens-conditional.test.ts` | **MECHANICAL** |
| 9 | [The runner's counters as a table](#9) — five hand-maintained lists of the same counter names | **−66 / +40** | `local-game-determinism.test.ts` (string compare) | **MECHANICAL** |
| 10 | [The projection's columns as a table](#10) — 30 columns written out four times | **−60 / +35** | `npm run lens:check` + `lens-schema.test.ts` | **MECHANICAL** |
| 11 | [One acceptance ladder](#11) — `better()` and `leaderOf` are the same order, and they disagree | **−25 / +14** | byte-identical runner + lens determinism | **JUDGEMENT** |
| 12 | [The substrate's dead surface](#12) — `assessments`, `coverOf`, `claimOf`, and the `pathFor` alias | **−45 / +0** | `npx tsc` + `substrate.test.ts` | **MECHANICAL** |
| 13 | [One veto-then-argmax](#13) — the snake's and the piece's degrading pools | **−25 / +14** | named test (`waypoint`, `piece-staging`) | **JUDGEMENT** |
| 14 | [`withTransport` stops delegating eight members to change two](#14) | **−27 / +8** | `lens-sources.test.ts`, `lens-view-model.test.ts` | **MECHANICAL** |
| 15 | [One moveset list key](#15) — the store writes it, the view rebuilds it, neither imports the other | **−6 / +2** | `lens-widen.test.ts` | **MECHANICAL** |
| | **total** | **≈ −990 / +350, net ≈ −640** | | 11 MECHANICAL, 3 JUDGEMENT, 1 mixed |

Round 1's two partial items are re-judged rather than re-listed: **item 11's
B1/B3 fold is item 7 here**, restated against what the bank looks like at
`3198ec0`; **item 12's hub types are finished** — §4 shows why the three round 1
left behind should all stay, which is a correction to round 1 rather than a
leftover.

§2 is the items. §3 records five things that look like leftovers and are **held
on purpose** — including three the brief pointed at. §4 records five of the
brief's and round 1's hypotheses the evidence did **not** support, and one of
round 1's own items that came back. §5 records two defects found and NOT
proposed as simplifications.

---

## 2. The items

<a name="1"></a>
### 1. One test board harness — `src/tests/**`

**−455 / +95 · MECHANICAL · gate: the touched suites + `npx tsc`**

Round 1 §4 checked test-helper duplication between `lens-fixtures.ts`,
`bounds/testkit.ts` and `local-game.ts` and correctly found it mostly shared.
It did not look at the 30 `*.test.ts` files around them. A 6-line normalised
duplicate scan over `src/**` (excluding `engine-vendor`) returns test fixtures
as the top 20 hits, and they are not near-copies — most are byte-identical.

| factory | copies | lines | where |
|---|---|---|---|
| `makeSnake` / `makeSnakeUnit` | **16** | 270 | `fatal-consent-and-reversal.test.ts:18`, `waypoint.test.ts:24`, `team-decision-engine.test.ts:36`, `lobster-trio.test.ts:50`, `verify-operator-advice.test.ts:46`, `verify-operator-conformance.test.ts:57`, `contest-tie-and-sever-outcomes.test.ts:53`, `marshal-tier-schedule.test.ts:32`, `turn-oracle.test.ts`, `claim-collision-ceiling.test.ts`, `settle-partial-sever-pile.test.ts`, `staged-move-turn.test.ts`, `team-staging.test.ts`, `canonical-pipeline.test.ts`, `bot-binding.test.ts`, `verify-operator-turn-boundary.test.ts` |
| `makeGameState` | **7** | 55 | `fatal-consent-and-reversal.test.ts:38`, `waypoint.test.ts:52`, `staged-move-turn.test.ts:33`, `team-staging.test.ts:41`, `piece-hold.test.ts:99`, `piece-bot-route.test.ts:56`, `piece-staging.test.ts:68` |
| `makeTurnData` | **6** | 54 | `fatal-consent-and-reversal.test.ts:49`, `staged-move-turn.test.ts:59`, `team-staging.test.ts:51`, `canonical-pipeline.test.ts:42`, `waypoint.test.ts`, `piece-bot-route.test.ts:66` |
| `recordingContext` | **3** | 60 | `canvas-resolution.test.ts:29`, `clash-affordance.test.ts:32`, `lens-ink.test.ts:31` |
| `comparable(frame)` | **2** | 16 | `lens-replay-parity.test.ts:316`, `lens-view-model.test.ts:57` |
| | **34** | **455** | |

Five of the sixteen `makeSnake`s are byte-identical to the character
(`marshal-tier-schedule.test.ts:32`, `verify-operator-conformance.test.ts:57`,
`lobster-trio.test.ts:50`, `team-decision-engine.test.ts:36`,
`verify-operator-advice.test.ts:46` — that last one differs only in the name).
The one genuine variation across all sixteen is `squad: 'A'` versus `squad: ''`,
which the `extra: Partial<Snake>` parameter every copy already takes covers.

There is a further 13-copy rig — `mgr = ActiveGameManager.getInstance()` with
`jest.useFakeTimers()` and `mgr.setMoveSubmitter(...)` in a `beforeEach`
(`fatal-consent-and-reversal.test.ts:68`, `piece-staging.test.ts:100,547`,
`staged-move-turn.test.ts:86`, `team-staging.test.ts:83,299`,
`canonical-pipeline.test.ts:150,235`, `piece-hold.test.ts:183`,
`piece-bot-route.test.ts:91`, `waypoint.test.ts:296`,
`contest-tie-and-sever-outcomes.test.ts:437`, `player-palette.test.ts:190`) —
not counted in the 455 because the published-move recorder differs enough per
suite to be worth checking one at a time.

**The parameterisation.** One `src/tests/board-fixtures.ts`, beside the
`src/tests/lobster-harness.ts` that already exists for the kernel's stubs:

```ts
export function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake;
/** The head-and-length form the manager suites use. */
export function makeSnakeAt(id: string, head: Coord, length?: number, extra?: Partial<Snake>): Snake;
export function makeGameState(gameId: string, turn: number, snakes: Snake[], youId: string, over?: Partial<GameState>): GameState;
export function makeTurnData(gs: GameState, botMove: CentaurMove | null, over?: Partial<TurnData>): TurnData;
export function recordingContext(ops: Op[]): CanvasRenderingContext2D;
export function comparableFrame(frame: LensFrame): unknown;
```

Each is one of the existing copies verbatim, with the `Partial<…>` seam the
copies already carry hoisted into the signature.

**Special case removed.** Thirty-four separate definitions of what a `Snake`,
a `GameState`, a `TurnData` and a canvas mock *are*. Every wire-shape change —
a new required field on `Snake`, a rename on `TurnData` — is today a
sixteen-file edit that the type checker will catch, plus a twelve-file edit of
default values it will not. `piece-staging.test.ts:610` even re-states
`active-game-manager.ts:3117`'s weight table by hand (item 4).

**Abstraction parameterised.** None invented — the `extra: Partial<Snake> = {}`
override the copies already share IS the abstraction; this makes it the only
one.

**Gate.** These are fixtures, not assertions, so the suites are the whole gate:
`npx jest src/tests src/lobster/__tests__` plus `npx tsc`. No production code
is touched, so the byte-identical runner is not needed — but do run
`local-game-determinism.test.ts` anyway, because `local-game.ts` sits in the
same directory and an accidental import cycle would show up there first.

---

<a name="2"></a>
### 2. `ourUnitTerm` absorbs `tier` and `potion` — `src/lobster/evaluate/`

**−55 / +25 · MECHANICAL (`tier`) / JUDGEMENT (`potion`) · gate: byte-identical runner + soundness sweep + `npx jest src/lobster/__tests__/evaluate.test.ts`**

Round 1 item 2 landed: `ourUnitTerm` exists at `bound.ts:143-166`, and
`contest.ts:235`, `momentum.ts:148` and `energy.ts:174` call it. Round 1 left
folding `tier` in as JUDGEMENT, and `potion` did not exist yet. **Both are now
tractable, and `tier`'s is mechanical.**

`tier.ts:220-281` is `ourUnitTerm` re-typed:

| `bound.ts` (the fold) | `tier.ts` (the copy) |
|---|---|
| `148-150` count our live non-held units, `point(0)` if none | `222-224` |
| `156` skip a unit dead in both readings | `238-239` |
| `158-161` the four signed accumulations | `273-276` |
| `163-165` divide by the count, `envelope` | `279-281` |

and the accumulation lines are character-for-character the same four:

```ts
if (vLo < 0 && s.bestAlive) worst += vLo;
if (vLo > 0 && s.worstAlive) worst += vLo;
if (vHi > 0 && s.bestAlive)  best  += vHi;
if (vHi < 0 && s.worstAlive) best  += vHi;
```

Round 1's stated reason for calling this JUDGEMENT — *"`tier` counts `ours`
before its own `tierIsLive` gate"* — does not survive reading the two orders
side by side. `tier.ts:220` returns `point(0)` when `!tierIsLive`, then counts
(`:222-223`), then returns `point(0)` when `ours === 0` (`:224`). `ourUnitTerm`
counts (`bound.ts:148-149`), returns `point(0)` when the count is zero
(`:150`), then consults `gate` and returns `point(0)` when it refuses (`:151`). Both return `point(0)` in all four combinations of the two
predicates, so the orders are observationally identical. The rest of
`tier.ts:225-270` — `field`, `arrival`, `window`, `after`, `pickupCertain`,
`windowValue` — is loop-invariant setup a closure captures:

```ts
evaluate(ctx) {
  const sub = ctx.sub; /* … the seven hoisted constants, unchanged … */
  return ourUnitTerm(ctx, (s) => { /* :240-269 verbatim */ return [vLo, vHi]; },
                     () => tierIsLive(sub));
}
```

`potion.ts:398-435` (`tradeFor`) is the same fold with **one extra conjunct**:
the credit half is paid only where the ally *and the collector* live
(`:431-432`, `if (s.worstAlive && collector.worstAlive) worst += value`), and
the cost half (`:403-404`) is the same signed rule applied to the collector
alone. That is the fold with a *conditioned* alive-pair, which is a parameter:

```ts
export function ourUnitTerm<S>(ctx, valueOf, gate?, aliveOf?: (s: S) => readonly [best: boolean, worst: boolean]): Bound
```

defaulting to `(s) => [s.bestAlive, s.worstAlive]`; `potion` passes
`(s) => [s.bestAlive && collector.bestAlive, s.worstAlive && collector.worstAlive]`.
JUDGEMENT, because `potion`'s divisor `ours` is counted at `:312-314` OUTSIDE
`tradeFor` and shared across the collector bracket at `:334-342`, so an executor
must check that hoisting the count into the combinator does not change which
collectors the walk admits. It does not — the count does not depend on the
collector — but it must be checked, not assumed, and the soundness sweep is the
instrument (26 `ScoreBounds` inversions on `potions` seed 5 is what a wrong
reading of this term cost last time, `potion.ts:264-271`).

**Same edit, unconditional:** `potion.ts:246-248` defines

```ts
function heldAt(tier: number, expiresAtTurn: number | null, turn: number): number {
  return expiresAtTurn !== null && turn >= expiresAtTurn ? 0 : tier;
}
```

which is `contest.ts:134`'s exported `frozenTier` **byte for byte**. This is
round 1 item 7 coming back: the potion member re-introduced the duplicate that
item 7 removed, five months of commits later, in a third file. Import
`frozenTier` and delete `heldAt`. −5 lines, and it is the cheapest evidence in
this document that a rule with two names has two futures.

**Special case removed.** The alive-set polarity rule — *"costs over the
SUPERSET, credits over the subset, in the worst reading; the other way round in
the best"* — is currently stated **five** times in prose (`bound.ts:133-135`,
`tier.ts:198-204`, `tier.ts:271-272`, `potion.ts:288-292`, `potion.ts:400-403`)
and **three** times in code. After this it is stated once in each. A sixth
member inherits it from a type signature instead of from a paragraph.

---

<a name="3"></a>
### 3. One arrival field — `contest.ts` and `potion.ts`

**−50 / +30 · MECHANICAL · gate: byte-identical runner + `npx jest src/lobster/__tests__/evaluate.test.ts` + the `potions` scenario under `ab-compare`**

`computeContestField` (`contest.ts:162-189`) and the inner loop of `windowRead`
(`potion.ts:216-236`) are the same reducer over the same three parallel typed
arrays:

```ts
const reached = new Uint8Array(cells);
const tier    = new Int32Array(cells);
const weight  = new Int32Array(cells);
// …for each arrival at `cell` with (t, w):
if (reached[cell] === 0) { reached[cell] = 1; tier[cell] = t; weight[cell] = w; continue; }
const seen = tier[cell] as number;
if (t > seen) { tier[cell] = t; weight[cell] = w; }
else if (t === seen && w > (weight[cell] as number)) { weight[cell] = w; }
```

`potion.ts:215-217` says so in a comment: *"THE BEST ARRIVAL, exactly as
`contestField` builds it: the highest tier any enemy could bring, and the
heaviest weight among the enemies at that tier."* The two differ only in where
the arrivals come from — `sub.actionsOf(unit.unitId)` for the horizon-1 field,
`claim.everPossible` per horizon for the window read — and the result types are
the same triple under two names: `ContestField` (`contest.ts`) and `Horizon`
(`potion.ts:124-130`).

The readers are the same shape too: `edgeAt` (`tier.ts:138-144`), `costOf`
(`contest.ts:193-208`) and `beatenAt` (`potion.ts:251-255`) are three spellings
of *"is `winsContest(ours, theirs-at-this-cell)` true where anything arrives?"*.

**The parameterisation.** One type and one builder, in `contest.ts` (it already
owns `winsContest` and `frozenTier`):

```ts
/** Where an opponent can arrive, and the best arrival at each cell. */
export interface ArrivalField { readonly reached: Uint8Array; readonly tier: Int32Array; readonly weight: Int32Array }

export function arrivalField(
  cells: number,
  arrivals: Iterable<{ readonly cells: Iterable<CellIndex>; readonly tier: number; readonly weight: number }>
): ArrivalField;

/** True where something arrives here and we do not beat it. */
export function beatenAt(field: ArrivalField, tier: number, weight: number, cell: number): boolean;
```

`ContestField` becomes `ArrivalField` (a type alias keeps every importer
compiling); `contestField` becomes `perBoardPerTeam(FIELDS, …, () =>
arrivalField(cells, enemyArrivals(sub, asTeam)))`; `potion.ts`'s per-horizon
build becomes `arrivalField(cells, enemyClaims(claims, asTeam))` with the
ally-`ground` accumulation left exactly where it is — that half is potion's own
and must not move.

**Special case removed.** The "highest tier, then heaviest weight at that tier"
tie-break — the rule the engine's `strictMaximum` is read through — written
twice, and read three ways. Round 1 item 10 (`perBoard`) removed the duplicated
*keying* comment for these two caches; this removes the duplicated *contents*.
Note the memo keys stay exactly as they are (both are already keyed on
`sub.marshalled`, `contest.ts:158` and `potion.ts:139`).

**Byte-identity argument.** Both loops fill the arrays in arrival order and the
tie-break is order-independent given the same arrival sequence; the sequences
are unchanged because the iteration sources are unchanged. Prove it with the
runner including the `potions` scenario, which is the only one that reaches
`windowRead`.

---

<a name="4"></a>
### 4. One piece term table — `src/server/active-game-manager.ts`

**−45 / +25 · MECHANICAL · gate: `npx jest src/tests/piece-staging.test.ts src/tests/contest-tie-and-sever-outcomes.test.ts src/tests/piece-bot-route.test.ts`**

Six weighted terms — `healthLoss`, `deaths`, `kills`, `allyCasualty`,
`regicide`, `enemyRegicide` — are written out **four** times, in four different
shapes, in two functions ~100 lines apart:

| site | shape |
|---|---|
| `:3011-3017` | the score: `DEFAULT_CONFIG.k * value` summed |
| `:3107-3115` | the raw values on `breakdown` |
| `:3116-3124` | `breakdown.weights`: `k: DEFAULT_CONFIG.k` |
| `:3125-3133` | `breakdown.weighted`: `kScore: DEFAULT_CONFIG.k * value` |

and a fifth time as a test fixture at `piece-staging.test.ts:610-616`. The
`weights`/`weighted` pair also carries the same `...(candidate.kind ? {…} : {})`
conditional-spread three times (`:3123`, `:3132`, `:3134`).

**The parameterisation.** A term table beside `PieceCandidateScore`:

```ts
const PIECE_TERMS = [
  { key: 'healthLoss',    weight: DEFAULT_CONFIG.healthLoss,    of: (c: PieceOutcome) => c.healthCost },
  { key: 'deaths',        weight: DEFAULT_CONFIG.deaths,        of: (c) => (c.fatal ? 1 : 0) },
  { key: 'kills',         weight: DEFAULT_CONFIG.kills,         of: (c) => c.casualties.kills },
  { key: 'allyCasualty',  weight: DEFAULT_CONFIG.allyCasualty,  of: (c) => c.casualties.allyCasualty },
  { key: 'regicide',      weight: DEFAULT_CONFIG.regicide,      of: (c) => c.casualties.regicide },
  { key: 'enemyRegicide', weight: DEFAULT_CONFIG.enemyRegicide, of: (c) => c.casualties.enemyRegicide },
] as const;
```

from which all four sites derive: the score is `Σ weight × of(c)` plus the
waypoint term, and `breakdown`, `weights` and `weighted` are three
`Object.fromEntries` over the same table. The waypoint term (`weight × stat`,
keyed `${kind}Progress`) is the one row whose key is dynamic and it stays a
separate, named append — it is the only place the conditional spread is
load-bearing.

**Special case removed.** Four hand-maintained lists of one term set, in a
file whose §5 defect last round was *a breakdown key a reader asked for that no
producer wrote*. This makes "a term the score charges but the breakdown does
not report" unrepresentable, which is the exact failure the `weighted`/`weights`
tables exist to prevent and currently only document.

**Note, not part of the edit:** `piece-staging.test.ts:610` should then import
the table rather than restate it — that is item 1's business.

---

<a name="5"></a>
### 5. One unit-ascent step — `src/lobster/search/core.ts`

**−33 / +18 · MECHANICAL · gate: byte-identical runner + `npx jest src/tests/lens-determinism.test.ts src/lobster/search/core.test.ts`**

Three functions carry the same double loop — *for each unit in a list, for each
of its top candidates, price the swap, judge it with `better()`, observe it,
take it if it wins* — with the same four-line body:

```ts
const trial = s.bank.price(withMove(<base>.plan, candidate));
const verdict = better(trial, <base>);
observe(trial, <base>, verdict);
if (verdict.accept) <base> = trial;
```

| site | lines | unit list | per-unit cap | extra |
|---|---|---|---|---|
| `sweep` | `:630-646` | `dangerOrder(…)` | `cfg.candidateCap` | skips the incumbent candidate (`:639`) |
| `conform`'s legality repair | `:891-902` | `disturbedBy(…)` | `cfg.conformRepairPerUnit` | — |
| `repairSelfHarm` | `:942-966` | `ourCasualties(…).slice(0, cfg.rungZeroRepairVictims)` | `cfg.conformRepairPerUnit` | tolerates a missing `CandidateSet` (`:951`) |

The two "extras" are the only differences, and neither is a choice: the skip in
`sweep` is a cost optimisation over a trial that would be `withMove(plan, plan's
own candidate)`, and the missing-set tolerance in `repairSelfHarm` is defensive
where the other two use `as CandidateSet`.

**The parameterisation.**

```ts
/** One coordinate-ascent pass: each unit's top options against the incumbent. */
const climb = (
  s: Session,
  budget: SearchContext['budget'],
  start: BankResult,
  units: Iterable<UnitId>,
  perUnit: number,
  skipIncumbent: boolean
): BankResult
```

with the three sites becoming one call each. `rung` stays where it is — it is
ambient by design (`:523-529`) and each caller sets it before calling, exactly
as today.

**Special case removed.** Three copies of *"acceptance is `better()` and nothing
else"*. `repairSelfHarm`'s docstring makes that claim in prose
(`:936-939`: *"this cannot lower the floor: a repair that does not strictly
improve on the proved floor is refused"*) about a body that has to be read to be
believed; after this it is the combinator's signature. A fourth ascent — and the
refiner work will want one — inherits the rule.

**Byte-identity argument.** The trial order per unit is `topCandidates` order,
unchanged; the unit order is each caller's own list, unchanged; `observe` is
called on exactly the same trials in the same sequence, which is what the lens
determinism gate pins.

**Also in this edit, three lines:** the "price, observe as ACCEPT, remember"
preamble appears verbatim at `:764-766`, `:893-895` and `:908-910`. One
`seat(s, plan)` helper.

---

<a name="6"></a>
### 6. The lens kernel's placeholder half, and `record.ts` goes home

**−26 / +1, and −321 lines out of the production module graph · MECHANICAL · gate: `npx tsc` + `npx jest src/tests/lens-determinism.test.ts src/tests/lens-replay-parity.test.ts src/tests/lens-frame-fold.test.ts src/tests/lens-view-model.test.ts`**

`src/lens/kernel/index.ts` is the K track's barrel. **It has no production
importer.** `kernel.ts:84-92` says why in as many words — *"THE LENS, imported
LEAF-WISE and never through the barrel: the barrel also carries the recorded-run
driver, which reaches back into the local runner, which imports this file"* —
and `team-decision-engine.ts:50` imports `../lens/kernel/keys` directly for the
same reason. Every importer of `../lens/kernel` is a test.

Three things follow.

**(a) The two placeholders are dead.** `attachLens` (`:58-60`) has **zero**
callers anywhere in `src/` (`websocket-server.ts:142`'s `attachLensPort` is a
different function on a different object). `explainMoveset` (`:62-67`) throws
`'not implemented: L3'` — and L3 landed: the real one is
`kernel.ts:2817-2823`/`:2916`, reached through the `LensInspectionPort` at
`store/sources.ts:240-247`. So the barrel exports a stub that shadows the
shipped implementation under the same name, and `NOT_IMPLEMENTED` (`:51`) exists
only for it. Delete all three and the now-unused `KernelInput`/`LensSink`/
`MovesetBreakdown`/`MovesetKey`/`LensRefusal`/`UnitKey` imports at `:17-24`.

**(b) `record.ts` belongs in `src/tests/`.** `src/lens/kernel/record.ts` is 321
lines whose job is stated in its own first line — *"THE RECORDED RUN — G1 and
G2's instrument"* — and whose only consumers are four test files. It imports
`DecisionClock`, `MIXED_SCENARIO`, `SNAKE_SCENARIO`, `SPARSE_SCENARIO`,
`buildBoard`, `decideTeam`, `meteredEvaluator` and `stepGame` from
`../../tests/local-game` (`:43-53`), which is the only `src/lens/** →
src/tests/**` edge in the repo. Move the file to `src/tests/lens-record.ts`,
drop `:42`'s re-export, and point the four tests at it. Pure relocation, zero
net lines — and the comment at `kernel.ts:84-87` that exists to warn a reader
away from the barrel can then be deleted too, because the hazard is gone.

**(c) `speculativeKeyFor` un-exports.** `conditional.ts:104` is used at
`conditional.ts:221` and nowhere else; the `export` exists only to reach the
barrel (`index.ts:47`).

**Special case removed.** A barrel that production is forbidden to import, a
stub that shadows a shipped function, and a test harness inside the module it
tests. After this the K track's public surface is what the leaves export and the
import rule is "import the leaf", with nothing to remember.

---

<a name="7"></a>
### 7. One sweep for the bank's rungs — `src/lobster/bounds/bank.ts:549-670`

**−45 / +26 · JUDGEMENT · gate: SOUNDNESS SWEEP across every bank configuration + `npx jest src/lobster/bounds/bank.test.ts`**

Round 1's item 11 shipped its mechanical half (`pickBy`, now at `:678-692`) and
left the fold. Re-read at `3198ec0`, the fold is bigger than round 1 described:
**all four rungs are one walk at four list shapes.**

| rung | lines | lists | leaves | closer |
|---|---|---|---|---|
| B0 | `:550-562` | `[]` | 1, no replies | a hand-built `MemberReport` with `complete: true` |
| B3 | `:570-611` | all gated units | the cross-product | `closeGroup("B3", null, …, true, …)` |
| B1 | `:614-641` | one gated unit, once per enemy | that unit's options | `closeGroup("B1", enemy, …, complete, …)` |
| B2 | `:644-670` | one fixed tuple per witness | 1, replies known | a hand-built `MemberReport` with `complete: false, floor: null` |

B1's inner loop (`:625-634`) is a hand-inlined degenerate `walk` of B3's
(`:588-605`), and both end in `ceilingBranches.push` per leaf followed by one
`closeGroup`.

**The parameterisation.**

```ts
private sweepLists(
  view: View, base: JointPlan, rung: Rung,
  lists: ReadonlyArray<{ id: UnitId; options: ReadonlyArray<Candidate> }>,
  evalNs: EvalNamespace
): { leaves: Branch[]; swept: boolean }
```

B3 is one call with the whole gate; B1 is one call per enemy with a
single-element list. **B0 and B2 are then the same call at `lists = []` and at a
fixed tuple** — but their `MemberReport`s are hand-built and differ in exactly
the way that matters (see below), so fold only the *leaf production*, never the
closer.

**Why JUDGEMENT, restated with what the code now says.** Four differences must
survive the fold, and each of them is a soundness statement:

1. **The `complete` argument to `closeGroup` is not the same argument.** B3
   passes a literal `true`, justified by the `eligible` computation at
   `:578-583` (`coversEverything && lists.every(l => l.complete && l.options.length > 0) && product <= productCap`); B1 passes the per-unit `complete` from
   `optionsFor`; B2 passes `false` with `floor: null` because *"a witness is a
   certificate, never a cover: it may not move a floor"* (`:665`). Getting this
   wrong lets an incomplete sweep raise a floor, which `bank.ts:30-39` names as
   the fatal bug class.
2. **The stop behaviour differs.** B1 sets `finished = false` and **breaks the
   enemy loop** on `!swept` (`:637-640`); B3 sets `b3Covered = false` and falls
   through to B1 (`:609-610`); B2 breaks on `shouldStop` before pricing
   (`:647-650`).
3. **B3's preamble computes `loud`** (`:584`, `loudReadingOf`) and it must run
   whether or not the walk fires — it is the depth verdict's instrument
   (08 §5 step 1) and it is measured on the DECLINED occasions.
4. **B3 gates on `product <= cfg.productCap`** before walking; nothing else does.

Keep all four at the call sites. The shared part is the recursion, the
`budget.shouldStop()` check, the `replies` map construction and the
`ceilingBranches.push` loop.

Run the soundness sweep across **every** bank configuration
(`soundness.test.ts:17-24`: the property under test is that the *mixture* is
sound), not the default alone.

**Bonus, same shape, different file:** B3's `walk` (`:588-605`) and
`jointPolish`'s `walk` (`search/core.ts:705-720`) are the same recursive
cross-product enumerator with the same `[...acc, option]` allocation and the
same budget check. They are in different modules with different leaf actions, so
one shared `crossProduct(lists, budget, onLeaf)` is a genuine win — but it is a
second JUDGEMENT call about allocation on the hottest path in the system, and it
should be a separate commit with its own runner check.

---

<a name="8"></a>
### 8. One plan-part encoder — `voc.ts`, `kernel.ts`, `lens/kernel/conditional.ts`

**−30 / +12 · MECHANICAL · gate: `npx jest src/tests/lens-determinism.test.ts src/lobster/__tests__/lens-conditional.test.ts` + byte-identical runner**

The kernel's plan-key format — `${unitId}>${to}:${path.join('.')}` — is written
out by hand in **six** places across **four** modules:

| site | what it builds |
|---|---|
| `voc.ts:69` | `candidateKey` |
| `voc.ts:78` | `planKey`'s part |
| `kernel.ts:2546` | `cutPlan`'s part, for the cluster restriction and its complement |
| `conditional.ts:269` | the conditional head row's `key` |
| `conditional.ts:282` | its `complementKey` |
| `conditional.ts:287` | its `witness` |

`kernel.ts:2535-2539` explains that `cutPlan` reproduces `planKey`'s sort so
that splitting the sorted list per cluster *"produces exactly
`planKey(restriction)` and `planKey(complement)`"* — a correctness argument that
depends on a string format stated in a different file and never imported.

**The parameterisation.** One exported primitive beside `planKey` in `voc.ts`:

```ts
/** One plan entry, in the KERNEL's spelling. The bank spells it differently
 *  and on purpose — see search/core.ts:70-73. */
export const planPart = (unitId: UnitId, c: Candidate): string =>
  `${unitId}>${c.to}:${c.path.join('.')}`;
```

`candidateKey` becomes `planPart(c.unitId, c)`; `planKey` maps it; `cutPlan`
maps it; `conditional.ts`'s three become `.map((m) => planPart(id, m))`.
Behaviour-preserving by construction — the produced strings are identical.

**Special case removed.** Six independent statements of one wire format, one of
which (`cutPlan`) has a written correctness argument that another
(`conditional.ts`) can silently break. §5 records that one of the six already
disagrees with the others about sort order.

**Do NOT also unify with `bounds/plan.ts:73`.** See §3.

---

<a name="9"></a>
### 9. The runner's counters as a table — `src/tests/local-game.ts`

**−66 / +40 · MECHANICAL · gate: `npx jest src/tests/local-game-determinism.test.ts` (it compares the summary AS A STRING) + `node scripts/ab-compare.js` on a before/after pair**

The brief asks whether the 1,905-line runner should be factored. Its four
sections are real and separable (clock+counters `:86-350`, the game loop
`:430-1030`, the scenarios `:1370-1495`, summary+CLI `:1495-1905`) — but
splitting the FILE buys little: every section is imported as a unit by
`lens/kernel/record.ts` and the four determinism suites, and the seam that
actually costs maintenance is inside section 4.

**One counter set is written out five times:**

| site | shape | rows |
|---|---|---|
| `GameMetrics` (`:1032`) | the fields | ~24 |
| `RunSummary.counters`, the type (`:1523-1547`) | `readonly k: number` | 24 |
| `summaryOf`'s `counters` (`:1587-1610`) | `k: metrics.k` | 24 |
| `summaryOf`'s `rates` (`:1612-1625`) | `kPer100: per(metrics.k)` | 12 |
| `summarise`'s `totals` (`:1655-1671`) | `k: 0`, then summed by name | 16 |
| `summarise`'s report line (`:1703-1716`) | `k=${totals.k}` | ~14 |

A counter added to the metrics is today five further edits, three of which fail
silently (it is absent from the JSON, absent from the rates, absent from the
aggregate) and one of which — `totals` — reads it through
`(r.metrics as unknown as Record<string, number>)[k] ?? 0` at `:1687`, i.e. an
`any` cast whose whole job is to make a missing name a zero rather than an
error.

**The parameterisation.** One table, in the file's own order:

```ts
const COUNTERS = [
  { field: 'turns',      as: 'turns' },
  { field: 'unitTurns',  as: 'unitTurns' },
  { field: 'foodEaten',  as: 'meals',     rate: 'mealsPer100', total: true, say: 'food/100' },
  …
] as const;
```

`counters`, `rates`, `totals` and the aggregate line all derive from it. The
JSON's key order is the table's order, so `ab-compare` and the string-compare
determinism test both hold — provided the table is written in the current field
order, which is the executor's one obligation here.

**Special case removed.** The `as unknown as Record<string, number>` cast at
`:1687`, and four hand-maintained lists of one vocabulary. The
`LoudHistogram` beside them is already the right shape (`countLoud:255-266`
buckets through two named functions and `addLoud:269` folds by
`Object.keys`) — this makes the ordinary counters as safe as the instrument
that was added last.

**Not proposed:** splitting the file. The CLI (`:1739-1905`) and the scenarios
(`:1374-1492`) are each self-contained and could move, but nothing imports
either independently, so a split would be motion without a consumer.

---

<a name="10"></a>
### 10. The projection's columns as a table — `src/lens/store/persistence.ts`

**−60 / +35 · MECHANICAL · gate: `npm run lens:check` + `npx jest src/tests/lens-schema.test.ts src/tests/lens-replay-parity.test.ts`**

`writeMovesetRows` (`:241-271`) and `readMovesetRows` (`:291-321`) write out the
same **30** columns by hand, in two directions, and `database/schema.ts:176-215`
declares them a third time. The file's own docstring (`:229-232`) states the
stake: *"a partial update would be a second way to arrive at a row, and a second
way is how a materialised table starts disagreeing with its source."*

Of the 30, 26 are identity in both directions; 4 are `sql\`${lensStringify(x)}::jsonb\`` on write and `reviveLens` on read; 8 carry a `?? default` on read
only. That is exactly the shape of a column table:

```ts
const MOVESET_COLUMNS = [
  { name: 'decisionId' },
  …
  { name: 'moves',  json: true },
  { name: 'witnessPlanKey', readDefault: '' },
  { name: 'line',   json: true, nullable: true },
] as const;
```

from which both maps derive, and against which `lens-schema.test.ts` can assert
the drizzle table's own column set — turning "a column added in one place and
forgotten in another" from a silent data loss into a type error.

**Special case removed.** Three restatements of one column list, and eight
read-side defaults that exist because the write side and the read side were
written at different times.

Lower confidence than items 1-5: `sql` template literals do not survive being
built generically without care, and an executor who cannot make the write side
generic **cleanly** should do the read side only and stop. Half of this is still
worth having.

---

<a name="11"></a>
### 11. One acceptance ladder — `src/lobster/search/core.ts`

**−25 / +14 · JUDGEMENT · gate: byte-identical runner + `npx jest src/tests/lens-determinism.test.ts src/lobster/search/core.test.ts`**

`better()` (`:575-626`) and `leaderOf()` (`:1069-1093`) are the same order over
the same rows, written twice, and `leaderOf`'s own comment says they must not
diverge:

> *"The acceptance ladder, restricted to what a row carries… the ladder here
> declines exactly where `better()` declines"* (`:1070-1073`)
> *"THE SAME GUARD, on the same rung (08 F-10)… the view's leader and the
> search's incumbent must not disagree about a plan"* (`:1084-1087`)

They already do diverge. See §5.

**The parameterisation.** One comparator over the two fields both rows carry:

```ts
interface Ranked { readonly bounds: ScoreBounds; readonly est: number; readonly horizon: number; readonly plan: JointPlan }
/** The acceptance order: floor (under basis comparability), est, ceiling,
 *  salted tie. `est` and `hi` are HORIZON-LOCAL rungs (06 F-4, 08 F-10). */
const prefer = (a: Ranked, b: Ranked): Verdict
```

`better()` becomes `refutedAt(…) ? REFUSED.witness : prefer(trial, incumbent)`;
`leaderOf` becomes a fold with `prefer(rows[i], rows[best]).accept`.

**Why JUDGEMENT.** Two of the three differences are load-bearing and must be
preserved at the call sites, not merged:

1. `better()` opens with the witness veto (`:579`); `leaderOf` has no such rung,
   and it must not gain one — `refinementView` computes `refuted` per row
   separately at `:1144` and reports it rather than acting on it.
2. `better()` returns a typed `Verdict` whose refusal reason the reservoir turns
   into a `DominanceCondition` (`:558-573`); `leaderOf` needs only the boolean.
3. The `est` rung's horizon guard. `better()` skips it across horizons
   (`:598-600`); `leaderOf` does not (`:1080-1083`). **Preserve both behaviours
   by making the guard a parameter** — do not "fix" `leaderOf` in this edit,
   because that is a behaviour change. Make the difference a named argument, so
   the next reader sees a decision instead of an omission, and take the
   discrepancy to §5 as its own question.

**Special case removed.** One ordering, stated twice, with three comment blocks
asking a human to keep them in step.

---

<a name="12"></a>
### 12. The substrate's dead surface — `src/lobster/substrate.ts`

**−45 / +0 · MECHANICAL · gate: `npx tsc` + `npx jest src/lobster/__tests__/substrate.test.ts`**

The brief asks for `substrate.ts` methods with a single caller. Consumer counts
outside the file, over `src/**/*.ts` and `src/web/**/*.js`:

| method | lines | consumers |
|---|---|---|
| `assessments()` | `:538-540` (+ `assessCount` at `:368`, `:1067`) | **0** |
| `coverOf(unitId)` | `:696-698` | **0** (the `coverOf` hits elsewhere are the vendor query and `logic/staging-legality.ts:220`'s own import of it) |
| `claimOf(unitId)` | `:775-779` | 1, a test (`closing.test.ts:372`) |
| `pathFor(unitId, to)` | `:629-631` | 30, all of which could say `pathOf` |

`assessments()` is a counter with a writer and no reader — the exact construct
round 1 item 5 deleted three of, and `telemetry.ts:214-216`'s rule applies
verbatim: *"a column that is structurally constant is not telemetry, it is
furniture."* Delete the method, the field and the increment.

`coverOf` is a one-line delegate to `queries.ts`'s `coverOf` with nobody calling
it. Delete.

`claimOf` is reached only by one assertion. It is a legitimate reduction of
`claimsOf()` and one test uses it; **keep it**, but the executor should note that
it is one deletion away from `assessments`'s category.

`pathFor` (`:629-631`) is documented as *"the name this repo has always used for
`pathOf`."* Two names for one method is the special case: the `Substrate`
contract declares only `pathOf` (`contracts.ts:491`), so every `pathFor` call
site is silently bound to the concrete `EngineSubstrate` rather than to the
contract. Only **two** of the thirty are production (`evaluate/laws.ts`, twice);
the other 28 are tests (18 in `evaluate.test.ts`). Rename all thirty and delete
the alias.

**Special case removed.** A method the contract does not know about, standing in
for one it does; and two members of a public class that nothing calls.

**Checked and NOT proposed:** `settleInputFor` (`:853-855`) and
`settleScratchFor` (`:858-868`) look like near-copies and are not — the second
is a deliberate allocation-free re-point of a scratch object on the hottest path
(`:828-835`), and merging them would put an allocation back.

---

<a name="13"></a>
### 13. One veto-then-argmax — `src/server/active-game-manager.ts`

**−25 / +14 · JUDGEMENT · gate: `npx jest src/tests/waypoint.test.ts src/tests/piece-staging.test.ts src/tests/piece-bot-route.test.ts`**

The brief asks what folds in after the goto fix, without touching the UI. This
does.

Two functions implement *"narrow the pool by a veto, but never to nothing, then
take the best"*:

| site | vetoes | pool rule | argmax |
|---|---|---|---|
| `argmaxSurvivingMove` (`:2027-2039`) | `fatal` | `nonFatal.length > 0 ? nonFatal : candidates` | max `score` |
| `bestPieceCandidate` (`:2870-2887`) | `casualties.regicide !== 0`, then `fatal && !enemyRegicide` | twice, the same way (`:2871-2874`) | max `score`, ties by shorter `dist`, and `score <= 0` skipped |

`argmaxSurvivingMove`'s docstring already names the relationship: *"This is the
snake counterpart of `bestPieceCandidate`'s veto ladder"* (`:2022-2023`), and
`bestPieceCandidate`'s reciprocates at `:2844-2846`.

**The parameterisation.**

```ts
/** Narrow by each veto in turn, never to nothing, then take the best. */
function bestSurviving<T>(
  items: ReadonlyArray<T>,
  vetoes: ReadonlyArray<(t: T) => boolean>,
  better: (a: T, b: T) => boolean
): T | null
```

The snake call passes one veto and `(a, b) => a.score > b.score`; the piece call
passes two and the score-then-`dist` comparator, keeping its `score <= 0` skip
as a third, final filter at its own site.

**Why JUDGEMENT.** The `score <= 0` skip is NOT a veto — it can legitimately
return null when the whole pool fails it (*"an unreachable target pulls nowhere
and the piece stays put"*, `:2840-2842`), where a veto never empties the pool.
Keep it outside the combinator, and keep the order (regicide first, then fatal,
`:2855-2869` explains why at length).

**Special case removed.** Two statements of the degrade-rather-than-empty rule,
each of which is a paragraph of prose in front of four lines of filter. The two
scales stay separate — the piece path is on `DEFAULT_CONFIG` (300) and the snake
path is on `LOBSTER_WEIGHTS` (4) since the goto fix (`:1988-1999`) — and this
edit must not touch either. Only the *shape* folds.

**NOT proposed, still:** `computeIntendedMove` (`:2130-2164`) and
`computePieceStagedMove` (`:2764-2836`) are the same rung ladder
(manual/hold → waypoint → bot → fallback) over two move types, and could be one
`firstRung<M>` fold for ~−20. But the asymmetries are all load-bearing and
written down — the piece's `hold` rung is sourced `'manual'` on purpose
(`:2780-2787`), the snake reports `'bot'` truthfully even with a waypoint set
(`:2148-2155`) — and folding them puts four documented decisions behind one
generic. The drives fold is where this belongs; see `SIMPLIFY-PLAN.md` §5.

---

<a name="14"></a>
### 14. `withTransport` — `src/lens/view/index.ts:110-137`

**−27 / +8 · MECHANICAL · gate: `npx jest src/tests/lens-sources.test.ts src/tests/lens-view-model.test.ts src/tests/lens-replay-parity.test.ts`**

27 lines of hand-written delegation forward **eight** `DecisionSource` members in
order to override **two**. `makeReplayDecisionSource` (`:158`) then calls it with
`undefined`, so the replay source pays the whole wrapper to change nothing.

The file's own header (`:93-108`) is the argument for the edit: *"So these are
wrappers and not implementations. A second fold living up here is precisely the
fork this module was written to delete."* Eight forwarded members is that fork
in miniature — a member added to `DecisionSource` is silently dropped by the
live source until someone remembers this file.

**The parameterisation.**

```ts
const withTransport = (base: DecisionSource, transport: LensTransport | undefined): DecisionSource =>
  transport === undefined ? base : Object.create(base, {
    breakdown:   { value: (m: MovesetKey) => transport.breakdown(m) },
    conditional: { value: (r: ConditionalRequest) => transport.conditional(r) },
  }) as DecisionSource;
```

**`Object.create`, NOT a spread.** `at` is a getter (`:114-116`,
`store/sources.ts:101-103`) that must stay live — a spread would evaluate it
once and freeze the cursor, which is the one bug this edit could introduce and
the reason `lens-view-model.test.ts` is in the gate.

**Special case removed.** Eight forwarding methods that exist to be identical,
and a no-op wrapper on the replay path.

---

<a name="15"></a>
### 15. One moveset list key — `store/index.ts:206` and `view/cursor.ts:120`

**−6 / +2 · MECHANICAL · gate: `npx jest src/tests/lens-widen.test.ts src/tests/lens-view-model.test.ts`**

The brief's "two ways to key a moveset" is this, and it crosses the store/view
seam:

```ts
// src/lens/store/index.ts:206 — the WRITER
function conditionalKey(cluster: ClusterId, unit: UnitKey, to: CellIndex): string {
  return `${cluster}|${unit}|${to}`;
}
// src/lens/view/cursor.ts:120 — the READER
export function movesetListKey(cluster: number, unit: UnitKey, to: CellIndex): string {
  return `${cluster}|${unit}|${to}`;
}
```

Neither imports the other. The reader's only use is
`frame.movesets[movesetListKey(…)] ?? []` (`cursor.ts:132`) — so if either
spelling changed, the panel would render an empty conditional list and nothing
would throw. `lens-widen.test.ts:99,187` hard-codes the string a third time.

Export one (the store's, since the store writes it) and have `cursor.ts` import
it.

**Special case removed.** An untyped string contract between two tracks whose
violation is invisible. Note the two shapes in the keyspace are deliberate and
documented (`store/index.ts:199-201`) — this does not merge them, it merges the
two spellings of one of them. See §4 for what the audit found about the other.

---

## 3. What LOOKS like a leftover and is HELD on purpose

Five, three of which the brief pointed at directly. Each is recorded with its
guard so the next pass does not spend the search again.

| thing | why it looks dead | why it is held |
|---|---|---|
| **The two `planKey`s** — `voc.ts:76` (`to:path`) and `bounds/plan.ts:73` (`to#path`), plus two `candidateKey`s | two exported functions with one name and one job, in one layer, producing different strings for the same plan | **Deliberate, and the difference is the point.** `search/core.ts:70-73`: *"The KERNEL's plan key, not the bank's. The two spell a plan differently (`to#path` against `to:path`) and the view's rows are handed to the kernel, which compares them against `run.plans`; a key that is nearly the same is worse than one that is obviously different."* `bounds/plan.ts:36-95` is additionally a hot-path implementation (a scratch array, a sortedness watch, three `WeakMap`s) tuned for 153 000 plans per sweep. Item 8 folds the SIX copies of the kernel's spelling; it must not touch the bank's. |
| **`DepthColumn` and everything it names** — `PlyStep.witnessSeq` (`types.ts:223`, zero writes and zero reads), `lineTruncated` (`:269`, written `false` three times), `rankAtH1` (`:270`), `DepthDelta.voided` (`:250`), `DepthAttribution` (`:229-233`), `confidence` (`:272`) | a whole family of type fields written as constants by all three producers (`kernel.ts:2635-2645`, `conditional.ts:361-371`, `lens-fixtures.ts:211-221`) and read by nobody | **Depth scaffolding, exactly as round 1 §3 ruled for `confidence`, and the same citation covers the family.** `kernel.ts:2573-2578`: *"the column is carried as DATA now… so that depth, when it lands, fills fields rather than adding them."* `06-LOOKAHEAD.md` §3.1 specifies `LENS_LINE_PLIES` and the line. `witnessSeq` is the weakest of them — it is the only one with no producer at all — but it is one field inside a type the others make load-bearing. Do not cut. |
| **`src/lobster/evaluate/closing.ts`** | still no importer outside its own test | Unchanged from round 1 §3. `closing.test.ts:783-831` asserts that nothing imports it, and says why. |
| **`voc.ts`'s `compareConfidence` / `worstJoin` / `bestJoin` / `stagingRowOf` / `demandOf` / `StagingDecision` / `LeverFamily`** | test-only, ~130 lines | Unchanged from round 1 §3, and now **less** cuttable, not more: the refiner seam landed (`search/core.ts:1039-1160`) and `06-LOOKAHEAD.md` §1's primitives are the ones a continuation layer will reach for first. Still the strongest remaining deletion candidate in `voc.ts`, still only after someone checks them against `06-LOOKAHEAD.md` §1. |
| **`substrate.ts:853-868`, `settleInputFor` / `settleScratchFor`** | two near-identical five-line builders of one input object | The second is a deliberate allocation-free re-point of a shared scratch, with the measurement in the docstring above it (`:828-835`). Merging them puts a whole-object allocation back on the settlement path. |

---

## 4. Hypotheses the evidence did not support

Recorded so the next audit does not re-open them.

| hypothesis | finding |
|---|---|
| *"the placeholder index files"* (plural) | **There is one, and it is item 6.** `src/lens/kernel/index.ts` carries two dead placeholders. `src/lens/store/index.ts` (1,173 lines) and `src/lens/view/index.ts` (785) are not barrels at all — they are the store's reducer and the view's renderer, and their names are a directory convention. `src/lobster/bounds/index.ts` (62 lines) is a live barrel with real importers including `lens/types.ts:40`. Nothing to do to any of the three. |
| *"`src/web/lens-view.js` duplicates `src/lens/view/`"* | **It is generated.** `scripts/build-lens-view.js` produces it and `npm run lens:check` (`scripts/lens-rebuild.js --check`) is the gate that it matches. Every apparent duplicate pair (`frameAtSeq`, `clusterGlyph`, `emptyStateLine`, `widenAutoAcceptMs`, the `${cluster}|${unit}|${to}` key at `lens-view.js:124,487`) is the projection, not a fork. Do not edit it by hand and do not count its lines. |
| *"`search/core.ts` has dead paths after the refiner change"* | **One, and it is not dead enough to cut.** `cfg.rungZeroRepair ?? resolveStagingSafety(stagingSafety(), false) === 'full'` (`:884-885`) is the fallback the comment at round 1 item 6 called unreachable — and it still is on the shipped path, because `rigFor` (`candidates.ts:335`) always sets it, and round 1 item 6 landed at `2502ac9`. But `makeSearchCore()` with no tuning is called bare 20+ times in `lobster-trio.test.ts` and `verify-operator-*.test.ts`, so the fallback IS the default those suites run under. Deleting it changes what they test. Leave it. `refine` (`:1166-1169`) ignoring its lever is likewise not dead — its docstring (`:1161-1165`) argues the ignore is the honest answer while `depthMax` is 1. |
| *"test helpers duplicated across `lens-fixtures.ts`, `bounds/testkit.ts`, `local-game.ts`"* | **Confirmed already shared, again — and it was the wrong three files.** `lens-fixtures.ts:23` imports `buildBoard` and `GameSpec` from `local-game.ts`; `local-game.ts:34` now imports `mulberry32` from `testkit.ts` (round 1 item 13, landed); `testkit.ts`'s `makeTestBoard` and `local-game.ts`'s `buildBoard` remain two different levels of one pipeline and must not be merged. The duplication is one directory over, in the 30 `*.test.ts` files — item 1. One residue in the named three: `lobster-trio.test.ts:110` and `:116` hand-roll `unboundedBudget()` and `expiredBudget()`, which `testkit.ts:586,628` export. −12/+2, do it as a tail on item 1. (`local-game.ts:623`'s `FOREVER` is NOT one of these — its `now` is a counter rather than a clock, on purpose, `:628-631`.) |
| *round 1 item 12, "single-consumer types leave the hub" — three symbols left* | **It is finished, and round 1 was wrong about all three that remain.** `PinAdvice` moved (`ea15580`) and that was the only movable one. `RiskCause` (`contracts.ts:145-155`) is the element type of `EncounterVerdict.causes` (`:164`), and round 1 itself ruled `EncounterVerdict` a real seam — a field type of a seam type is not a single-consumer type. `TrialObservation` (`:644-672`) is the argument type of `TrialSink` (`:673`), which round 1 ruled stays because `SearchContext` references it in the same file; same argument, one link down. `objectIdentity` (`:61-67`) is not single-consumer at all: `structuralIdentity` (`:85-113`) calls it three times (`:98`, `:100`, `:107`), in the same file, and `structuralIdentity` is `evaluate/index.ts:137`'s — so the pair is a genuine evaluate↔bounds hub member. Nothing to move. Do not re-open. |
| *round 1 item 7, "the tier-freeze triplicate"* | **It came back.** `potion.ts:246-248`'s `heldAt` is `contest.ts:134`'s `frozenTier` byte for byte, written afresh by the potion member three commits after item 7 deleted the last copy. Folded into item 2. Worth recording as the only measured recurrence in this audit, and as the argument for preferring a shared *export* over a shared *comment*. |

---

## 5. Defects found, deliberately NOT proposed as simplifications

Repairing either changes behaviour, so both are out of scope — but both are why
their items matter, and both should be read before anyone touches the code
around them.

### 5.1 `leaderOf` compares `est` across horizons; `better()` refuses to

`better()` skips the `est` rung whenever the two plans were proved to different
depths (`search/core.ts:596-600`), and the comment above it (`:581-596`) is the
longest argument in the file: `est` is *"the evaluator's advisory scalar taken
from B0 alone, with no basis, no ledger and no soundness claim, and two ests at
two horizons are two evaluations of two different boards with no declared
discount between them. Comparing them is Law H's forbidden fold."*

`leaderOf` compares them unconditionally:

```ts
// search/core.ts:1080-1083
if (a.est !== b.est) {
  if (a.est > b.est) best = i;
  continue;
}
```

It applies the F-10 guard on the very next rung (`:1084-1090`, `if (a.horizon === b.horizon && a.bounds.best !== b.bounds.best)`) and its docstring claims
*"the ladder here declines exactly where `better()` declines"* — so this is an
omission, not a decision.

**Inert on this build**, which is why it is not urgent and why item 11 must
preserve it: `depthMax` is 1 (`:1151-1156`), nothing produces a horizon above 1,
and `deepHorizon` is written only when a carried incumbent claims one
(`:753-759`). The moment a continuation layer lands, `refinementView`'s leader
and the search's incumbent can name different plans, and the disagreement will
be invisible — it fires at an equal floor, where nothing else is watching, which
is the exact sentence F-10 was written about.

Repair is one `&&` and it is a behaviour change under any build with depth. It
belongs with the depth work, gated on `lens-determinism.test.ts` and the
byte-identical runner.

### 5.2 The two `complementKey` producers sort differently

`Moveset.complementKey` is produced in two places:

```ts
// kernel.ts:2546-2557 — parts sorted LEXICOGRAPHICALLY, then split per cluster
parts.sort((a, b) => (a.part < b.part ? -1 : a.part > b.part ? 1 : 0))
// lens/kernel/conditional.ts:282-285 — entries sorted NUMERICALLY by unit id
.sort((a, b) => a[0] - b[0]).map(([unitId, c]) => `${unitId}>${c.to}:${c.path.join('.')}`)
```

The same row's `key` and `witness` in that same object literal
(`conditional.ts:269-271`, `:287-290`) sort lexicographically, matching
`cutPlan`. So `conditional.ts` disagrees with `cutPlan` — and with itself — on
one field of three.

The two orders differ whenever a plan spans unit ids of different digit counts
(units 2 and 10: lexicographic gives `10…|2…`, numeric gives `2…|10…`).
`complementKey` is the second half of the reservoir's grouping key
(`reservoir.ts:143`, `keyOf(cluster, complementKey)`) — Law E's *"rows from two
generations of complement are never in one list"* — so two spellings of one
complement are two groups.

**No live path was found where the two producers' keys meet**: conditional rows
are emitted on their own event (`store/index.ts:299-303`) and do not enter the
reservoir's groups. That is why this is a §5 note and not an item. It is
latent, it is one `.sort()` from being live, and item 8 makes the three
`conditional.ts` spellings one — which does NOT fix this by itself, because the
sort is outside the encoder. Fixing it changes a persisted string, so it needs
its own decision and a `lens:check` rebuild.

---

## 6. Suggested order

1. **Item 1** first and alone. It touches no production code, it is the largest,
   and every later item's gate runs faster in a tree where the fixtures compile
   from one place. One commit per five-or-so suites, not one commit of 30 files.
2. **Item 6** next — it is a deletion and a move, it unblocks reading the lens,
   and `npx tsc` is the whole gate.
3. **Items 12 and 15**: two small deletions, one commit, `npx tsc` plus the two
   named suites.
4. **Item 2**, then **item 3** — both in `evaluate/`, byte-identical runner
   *and* soundness sweep between them, and run the `potions` scenario explicitly
   because `mixed` does not reach `windowRead`.
5. **Item 5**, then **item 8**, then **item 11**. All three are in the search and
   the kernel's keying; run the lens determinism gate between them, because it
   is the one that sees a reordering.
6. **Item 4**, then **item 13** — both in `active-game-manager.ts`, both gated
   on the piece suites, and item 4 first because item 13 reads the score item 4
   re-derives.
7. **Items 9, 10, 14**: instrument and store plumbing. Item 9 needs the
   string-compare determinism test; item 10 needs `npm run lens:check`.
8. **Item 7 last**, with the soundness sweep across every bank configuration —
   and its `crossProduct` bonus as a separate commit after it, or not at all.

Run the byte-identical runner **between** items, not once at the end: an
all-zero `ab-compare` diff after ten stacked edits tells you they cancelled, not
that each was sound.
