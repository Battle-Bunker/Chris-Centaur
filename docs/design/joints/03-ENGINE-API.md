# The engine API — cut at determinism, not at purity

Cycle 3 of the COMPOSITION lens. Verified against `TacticToes` @ `416d9c8`:
`functions/src/gameprocessors/engine/{resolveTurn,turnEngine,moveGrammar}.ts`,
`engine/VENDOR.md`, `TeamSnekProcessor.ts`, `frontend/src/`.

The engine is shared with human play. **Every proposal here is additive**: a new
export, an injected port whose default reproduces today's behaviour, or a new
wire field. Nothing changes what a human game does.

---

## 1. The module is right; the boundary is drawn one phase too early

`engine/VENDOR.md` states the module's own law:

> Every file in this directory may import only from this directory and from
> `@shared/types/Game`. … Nothing in here may read a clock, a random number, or
> the network. … **If you need something from outside, pass it in as an input
> field instead.**

and the guard (`engineVendor.spec.ts`) enforces it by failing on `require(`,
`Math.random`, `Date.now`, `fetch`. So the *enforced* criterion is already
**determinism and I/O-freedom**, not "game-level state". But the stated
exclusion list is drawn on the other criterion, and the two disagree on five
phases:

`TeamSnekProcessor.applyMoves` runs, in order:

| # | phase | deterministic? | needs only | in the module? |
|---|---|---|---|---|
| 2 | `resolveTurn` — grammar, collisions, food/growth, exhaustion, sever, regicide | yes | its input | **yes** |
| 3 | ally-buff expiry on vulnerable collision | yes | effects, team map, turn | no |
| — | orientation rewrite | yes | origin cells, final cells, `legalOrientations` (**already in the module**) | no |
| 4a | **potion collection** | yes | potion cells, effects, tiers, team map, turn, window length | no |
| 4b | food + potion **spawn** | **NO — `Math.random`** | RNG, fertile tiles, free cells | no, and must not be |
| 4c | effect expiry | yes | effects, turn | no |
| 5 | **pawn promotion** | yes | weights, `pawnPromotionWeight`, unit types | no |
| 6 | winners / adjudication | yes | alive teams, weights, `maxTurns` | no |

**Six of the seven excluded phases are deterministic functions of the settled
board plus configuration.** Each needs only wire state and setup constants —
precisely what VENDOR.md says to pass in as input fields. Only spawn is
genuinely out, because only spawn is random.

### Why this costs the bot exactly the capability the owner cares most about

The bot's substrate must mirror phases 3–6 to look ahead through a potion
window, and it does not: *"partial engine never writes tier on resolve …
missing = COLLECTION in the substrate layer above the vendored resolver"* — the
potion branch's recorded design wall. So on a potion board the bot searches a
game in which **nobody ever picks up a potion**, which is the game the owner
says is the interesting one. Two more consequences of the same cut:

- The **window length is a magic `currentTurnNumber + 3`** inside the
  unvendorable half. The queued top experiment is an `effectTurns 3/8/20` value
  sweep — a game-design lever for the owner. Under the re-cut it is an input
  field, and the sweep is a config change on both sides at once instead of an
  engine patch the bot cannot mirror.
- **Promotion is a horizon the bot cannot see across.** `pawnPromotionWeight`
  is setup data; a search that cannot promote a pawn cannot price the meal that
  promotes it.

---

## 2. Ask 1 — `settleTurn`, with spawn as an injected port

```ts
// engine/settleTurn.ts — new file in the vendorable module
export interface SettleInput extends ResolveTurnInput {
  turn: number
  teamOf: { [unitID: string]: string }        // already available at both call sites
  potions: number[]
  effects: ActiveEffect[]                      // wire type, unchanged
  tiers: { [unitID: string]: number }
  potionWindowTurns: number                    // TODAY'S HARDCODED 3, now an input
  potionsEnabled: boolean
  pawnPromotionWeight: number
  maxTurns: number | null                      // null = explicit unlimited (416d9c8)
}

export interface Spawner {                     // the ONLY nondeterminism, injected
  food(state: SettledState): number[]
  potions(state: SettledState): number[]
}
export const NO_SPAWN: Spawner                 // the bot's default

export function settleTurn(input: SettleInput, spawn: Spawner): Settlement
// Settlement = TurnResolution
//            + { tiers, effects, potions, food, promotions, orientations,
//                outcome: Outcome | null }
```

The server injects its RNG spawner and gets today's behaviour phase-for-phase.
The bot injects `NO_SPAWN` and gets, for the first time, a forward model that
**closes tier windows, expires effects, promotes pawns and adjudicates** — the
three-turn commitment object the DoF synthesis says potion doctrine needs
becomes representable, because the states it plans over now exist in the model.

The vendor guard stays green by construction: `settleTurn` reads no clock, no
RNG and no network; the RNG is behind the port, at the caller.

**Increment order** (each independently shippable, each byte-identical on the
server by construction because the code moves rather than changes):
1. effect expiry + ally-buff cancellation (pure bookkeeping over wire types);
2. potion collection (the capability unlock; `potionWindowTurns` becomes an input);
3. orientation rewrite (the module already owns `legalOrientations`);
4. promotion;
5. adjudication (§3).

---

## 3. Ask 2 — one adjudicator, because the rule is implemented three times

| implementation | file | history |
|---|---|---|
| server | `TeamSnekProcessor.calculateWinners` / `calculatePreviousTurnTeamOutcome` | the authority |
| harness | `harness/lib/match.ts` `placementsOf` | **got it wrong until 2026-08-29**: every eliminated team carries zero material on the final board, so a mutual wipe read off that board was always a tie, and the tie-break "was vacuous exactly where it was supposed to bite" |
| bot | `evaluate/mutual-wipe.ts` | priced a winning mutual trade as a flat LOSS, so the bot *refused winning trades* |

One rule, three encodings, three different answers — the three-way
disagreement is on the pin record. And it is not a rare corner any more: the
turn limit now defaults to 100 (`416d9c8`), so **the adjudication branch runs at
the end of every game**.

```ts
export function adjudicate(s: SettledState, turn: number, maxTurns: number | null): Outcome | null
export function sharePar(o: Outcome, teams: number): { [teamID: string]: number }
```

The harness's `placementsOf` becomes a caller; the bot's terminal pricing
becomes a caller; the server becomes a caller. The harness's careful prose
about *how it reproduces the game's rule* is then a test, not an
implementation — which is the honest place for it.

---

## 4. Ask 3 — grammar queries, shared by the bot and the human UI

The grammar already computes everything needed and exports none of it in query
form. Two consumers pay for that:

**The bot re-derives legality and cover, and got it wrong.** The dodge-discount
build notes record: `legalMoves` never read `Terrain.hazard`; trail-unit walls
under-filtered; a pawn attacker covered nothing because it read one orientation
where the union of four was meant. Each is a rules re-implementation drifting
from the rules.

**The human UI derives nothing at all.** `frontend/src/` imports
`@shared/types/Game` for wire types and never touches `moveGrammar`. A player
clicks a cell; if the click is not legal for that kind, the server silently
substitutes the kind's default action (`resolveTurn` step 1, `planned ??
defaultAction`). The board renderer draws an orientation eye and no legality, no
path, no reach.

```ts
export function legalTargets(u: ResolveUnit, board: BoardShape): number[]
export function pathOf(u: ResolveUnit, target: number, board: BoardShape): number[] | null
export function coverOf(u: ResolveUnit, board: BoardShape): number[]   // cells it could contest
```

All three are thin wrappers over `planUnitAction` / `defaultAction` /
`legalOrientations`. The payoff is disproportionate to the size:

- the bot deletes its parallel legality/cover derivation and one bug class with it;
- the UI can show a human what a piece may do, where a slider would actually
  stop, and what it covers — **the missing primitive of the Centaur surface**,
  and the one that makes bot advice and human intuition talk about the same
  objects rather than two parallel models of the rules;
- `coverOf` is the exact support constructor the opponent-weight socket needs
  (the EPISTEMICS lens's `plausibleMoves` extraction) — one function, three
  consumers, no third mirror.

---

## 5. Ask 4 — a resolution record on the wire, with commit times

The interruption design already names it; the premise lattice says why it is
more than convenience. Today the bot must *re-derive* what happened last turn
from the new board, which is a narrowing it performs rather than an observation
it receives — so its reconstruction and the server's truth are two values whose
premises are not proved equal, and any mismatch is silent.

```ts
Turn.resolution?: {
  applied:  { [unitID: string]: number }     // the cell each unit actually ended on
  deaths, clashes, severedCells, exhaustions  // already computed, already discarded
  collected: { [unitID: string]: 'food' | 'potion' }
  effects:   ActiveEffect[]                   // as settled
  committedAt?: { [playerID: string]: number } // arrival time of each commit
}
```

Everything but `committedAt` is *already computed and thrown away*
(`TurnResolution` is folded into game state and the record dropped). Two uses:

- **Observation instead of inference.** Under Law P the record arrives with its
  premise attached ("this is the truth, not a model"), which is the strongest
  possible fiber: no join needed, no reconciliation, no silent mismatch.
- **The only honest way to measure a ponder/re-entry loop.** Commit arrival
  times are what tell you how much thinking time the opponent's indecision
  actually bought, and they are unrecoverable after the fact.

This is also the ingestion hook the EPISTEMICS lens's cross-turn fog needs: when
invisibility lands, the record is where *partial* facts are carried, and their
support-conditioning applies at ingestion instead of only inside search.

---

## 6. What the re-cut does NOT ask for

- No change to `turnEngine.ts` or the collision rules. The differential-testing
  record says leave it alone.
- No change to the wire's existing fields, no removal, no rename.
- No engine awareness of bots, slates, telemetry or scoring policy. `sharePar`
  is arithmetic over an `Outcome`; the engine does not learn what a bot is.
- No RNG inside the module, ever. The spawner port is the boundary and the
  vendor guard remains the enforcement.

---

## 7. Falsifiers

1. **If a moved phase turns out to need mutable game state the wire does not
   carry**, the phase stays out and the re-cut argument weakens for that phase
   only. Read against the source, phases 3, 4a, 4c, 5 and 6 read exactly:
   effects list, tiers, potion cells, team map, weights, turn number,
   `pawnPromotionWeight`, `maxTurns`. All wire or setup data. The orientation
   rewrite additionally needs origin squares, which the caller already captures
   (`captureOriginSquares`).
2. **If the bot's substrate cannot use a settlement it did not build**, the
   unlock is smaller than claimed. Test: the potion-window acceptance game —
   the bot walks to a potion three turns early, the window opens *in the
   model*, and the cut lands. That test cannot pass today at any budget.
3. **If `adjudicate` cannot express the harness's cap ending**, the
   consolidation is incomplete. `terminal: 'decisive' | 'cap'` is a property of
   the `Outcome`, not a second rule — but if it needs harness-only inputs, say
   so rather than bending the engine.
