# Engine spec — `settleTurn`, `adjudicate`, and the grammar queries, in buildable detail

Cycle 9 of the COMPOSITION lens. `03-ENGINE-API.md` argued the re-cut; this is
the specification a builder can start from. Verified against `TacticToes` @
`416d9c8`: `engine/{resolveTurn,turnEngine,moveGrammar}.ts`, `VENDOR.md`,
`TeamSnekProcessor.ts`.

**Every change is additive.** The server's behaviour must be phase-for-phase
identical after each step; the vendor guard must stay green; the wire gains
fields and loses none.

---

## 1. What moves, and exactly what each phase reads

`TeamSnekProcessor.applyMoves` phases 3–6, with their real inputs read off the
source:

| phase | reads | already in the module? |
|---|---|---|
| ally-buff cancel on vulnerable collision | `vulnerableCollided` (**already a `TurnResolution` field**), team map, `activeEffects`, turn | half |
| orientation rewrite | origin squares, `traversed` (**already a `TurnResolution` field**), `unitTypes`, `boardWidth`, `legalOrientations` (**already in `moveGrammar`**) | almost entirely |
| potion collection | head cells (`board[*].occupancy[0]`), potion cells, `playerInvulnerabilityLevel`, `activeEffects`, team map, turn, window length (**hardcoded `+3`**), enabled flag | no |
| effect expiry | `activeEffects`, turn, alive list | no |
| pawn → queen | occupancy length, `unitTypes`, `pawnPromotionWeight`, `maxHealth.queen` (**already an input**) | no |
| adjudication | alive/pieces view, team map, turn, `maxTurns`, **previous turn's board** (the all-eliminated branch) | no |

Two of the six are mostly there already, and none needs mutable game state: the
inputs are wire data plus four setup constants. That is the whole re-cut
argument, in a table.

---

## 2. `settleTurn` — the signature

```ts
// engine/settleTurn.ts  (new file in the vendorable module)

export interface SettleInput extends ResolveTurnInput {
  /** The turn being resolved. Effect expiry and window arithmetic read it. */
  readonly turn: number
  /** unit id → team id. The processor already builds this from gameSetup. */
  readonly teamOf: Readonly<Record<string, string>>

  // ── items and effects ───────────────────────────────────────────────────
  readonly potions: ReadonlyArray<number>
  readonly potionsEnabled: boolean
  /** TODAY'S HARDCODED `currentTurnNumber + 3`, now an input — which is what
   *  makes the queued effectTurns 3/8/20 value sweep a config change on both
   *  sides instead of an engine patch the bot cannot mirror. */
  readonly potionWindowTurns: number
  readonly effects: ReadonlyArray<ActiveEffect>
  /** Per-unit tier at the start of the turn. Already `ResolveUnit.tier`; named
   *  here because settlement now RETURNS it too, which is the unlock. */

  // ── promotion and terminal ──────────────────────────────────────────────
  readonly pawnPromotionWeight: number
  readonly maxTurns: number | null           // null = explicit unlimited (416d9c8)
  /** Previous committed turn's standings; only the all-eliminated branch reads
   *  it, and it is the branch three implementations already disagreed on. */
  readonly previous?: BoardView
}

/** The only nondeterminism in the game, injected. */
export interface Spawner {
  food(state: SettledState): ReadonlyArray<number>
  potions(state: SettledState): ReadonlyArray<number>
}
export const NO_SPAWN: Spawner        // the bot's default: settle, spawn nothing

export interface Settlement extends TurnResolution {
  readonly tiers: Readonly<Record<string, number>>      // SETTLED, not input
  readonly effects: ReadonlyArray<ActiveEffect>
  readonly potions: ReadonlyArray<number>
  readonly unitTypes: Readonly<Record<string, UnitType>>  // after promotion
  readonly orientation: Readonly<Record<string, Orientation>>
  readonly promoted: ReadonlyArray<string>
  readonly outcome: Outcome | null                      // null = game continues
}

export function settleTurn(input: SettleInput, spawn: Spawner): Settlement
```

**Why the returned `tiers` is the unlock.** Today `tier` is an input only: the
partial engine never writes it on resolve, so a simulated turn cannot advance a
window and a three-turn potion plan is unmodellable — the potion branch's
recorded design wall. With settlement returning tiers, the bot's forward model
closes the loop, and "arm → collect → spend" becomes a state sequence the search
can actually walk.

---

## 3. `adjudicate` — one rule, three callers

```ts
export interface BoardView {
  readonly alive: ReadonlyArray<string>
  readonly pieces: Readonly<Record<string, ReadonlyArray<number>>>
}

export type EndKind = 'continues' | 'last-team' | 'all-eliminated' | 'turn-limit'

export interface Outcome {
  readonly kind: EndKind
  readonly winners: ReadonlyArray<string>      // team ids; may be several (draw)
  readonly weightByTeam: Readonly<Record<string, number>>
  /** Which board decided it: the settled one, or the previous committed turn's
   *  on an all-eliminated ending. The distinction the harness got wrong. */
  readonly decidedOn: 'settled' | 'previous'
}

export function adjudicate(
  board: BoardView, previous: BoardView | undefined,
  teamOf: Readonly<Record<string, string>>,
  turn: number, maxTurns: number | null
): Outcome

/** score = share of end weight × team count. Par 1, continuous in the margin. */
export function sharePar(o: Outcome, teams: number): Readonly<Record<string, number>>
```

Callers: the server (`calculateWinners` becomes a call), the harness
(`placementsOf` becomes a call, and its careful prose about *reproducing* the
game's rule becomes a test), and the bot (`model/terminal@1`, whose only
legitimate implementation source this is — `16-TERMINAL-BOUNDARY.md`).

The branch structure is already written down; it is being moved, not designed:
zero alive teams → previous-turn outcome; one alive → that team; turn limit
reached → max weight, with a draw among ties; otherwise continue.

---

## 4. Grammar queries

```ts
export interface BoardShape {
  readonly boardWidth: number; readonly boardHeight: number
  readonly walls: ReadonlyArray<number>; readonly hazards: ReadonlyArray<number>
  readonly occupancy: ReadonlyArray<{ readonly id: string; readonly cells: ReadonlyArray<number> }>
  readonly food: ReadonlyArray<number>        // pawn targets
}

/** Every destination this kind may legally be staged to from here. */
export function legalTargets(u: ResolveUnit, b: BoardShape): ReadonlyArray<number>
/** The path it would actually walk — a slider's stop cell included. */
export function pathOf(u: ResolveUnit, target: number, b: BoardShape): ReadonlyArray<number> | null
/** Cells it could contest next turn: the union over its legal targets' paths. */
export function coverOf(u: ResolveUnit, b: BoardShape): ReadonlyArray<number>
```

Thin wrappers over `planUnitAction` / `defaultAction` / `legalOrientations`.
Three consumers, no fourth mirror: the bot (which re-derives these today and got
hazard terrain, trail-unit walls and pawn cover wrong), the human interface
(which derives *nothing* — a player clicks and the server silently substitutes
the default action), and the opponent-weight socket's action-support constructor
(the EPISTEMICS lens's `plausibleMoves`).

---

## 5. Migration order, with the gate for each step

Each step moves code without changing it; the server's phase order is preserved
exactly; `engineVendor.spec.ts` (which fails on `require(`, `Math.random`,
`Date.now`, `fetch`) must stay green throughout.

| # | step | gate |
|---|---|---|
| E1 | effect expiry + ally-buff cancel move in; `effects`, `turn` join the input; `effects` joins the output | server suite green; a golden turn-by-turn replay of a potions-on game is byte-identical |
| E2 | potion collection moves in; `potions`, `potionsEnabled`, `potionWindowTurns` join the input; `tiers`, `potions` join the output | same replay byte-identical **with `potionWindowTurns: 3`**; and a second run at 8 differs only in expiry turns — the value sweep becomes runnable |
| E3 | orientation rewrite moves in (it already has `traversed` and `legalOrientations`) | piece replays byte-identical, including the pawn exception |
| E4 | pawn → queen moves in | a promotion replay byte-identical: weight collapses to 1, health clamps to the queen max, the unit survives |
| E5 | `adjudicate` + `sharePar` exported; server calls them; harness calls them; bot's `model/terminal@1` calls them | the mutual-wipe corpus (10 rows / 7 games in 13,245) re-adjudicates identically in all three callers — the first time that has ever been checkable |
| E6 | `Spawner` port; server injects its RNG, `NO_SPAWN` exported | full-game replay byte-identical; the bot builds its first multi-turn potion window |
| E7 | grammar queries exported; bot deletes its re-derivations; UI gains legality | the bot's dodge-cover tests reproduce, minus the three known bugs, which is a behaviour change and must be its own commit |

**One risk worth naming.** E2 changes what `tier` means in the module's contract
— from "an input the caller computed" to "an input **and** an output". The
vendored copy in `Chris-Centaur` must be re-synced in the same change, and its
partial-engine layer must stop synthesising tiers, or two encodings exist again
for one turn's length. That is the exact failure mode the three-copies history
is made of, so E2 is the step to review hardest.

---

## 6. What the bot does with a settlement

The substrate's forward step becomes: `resolveBounded` for the sound channel
(unchanged, differential-tested), and `settleTurn(..., NO_SPAWN)` for the
*state* channel. Three capabilities become expressible that are not today:

1. **Tier windows across plies** — the arm→collect→spend commitment
   (`05`'s carried premise) has states to plan over.
2. **Promotion as a horizon** — a pawn's meal that promotes it is finally a
   different state, not the same state with a heavier stack.
3. **Terminal awareness** — `outcome` is non-null when the line ends, so the
   turn-limit razor is representable at all: three turns from the cap a bot
   seated with `model/terminal@1` declines a trade a capless bot takes.

And one non-capability, stated so nobody expects it: **`NO_SPAWN` is a
deliberate under-model.** Food and potions really do spawn (0.15/turn for
potions, always on), so a multi-turn line assumes a board barer than the real
one. That is the conservative direction for a *gain* term and the optimistic
direction for a *denial* term, and the honest fix — a distributional spawner
whose cells enter the support as a cloud — is a MODEL member for later, not part
of this cut. The EPISTEMICS lens has already flagged the same premise gap from
its own side ("item spawning is gated off while anything is frozen" is a
simulation covenant, false in production).
