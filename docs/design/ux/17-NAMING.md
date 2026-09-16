# 17 — NAMING: every entity, named for a human

> "Please ensure that piping of human readable names is provided to the UI so
> every entity can be named with something meaningful to humans. Long obscure
> IDs are negative information to a human." — the owner, third report.

The reported surface: a staging game whose stage line read

    Bot stages MtFzgU4gnzeINlv1b6AN → right · MtFzgU4gnzeINlv1b6AN#2 → up · …

under a header that read `Game akV8HcVRCwPbMN9WDy26`.

Two client-side attempts had already failed (`LensPanel.setNames` /
`unitDisplayName`: a regex that rewrote any 16+ character token in rendered
text). They passed on the walkthrough harness and failed on every real game,
for the reason recorded in §4. **Both are deleted.** A safety net that hides
the defect where you are looking is worse than no net at all.

---

## 1. The real field shape

A TacticToes game document (`src/firebase/tactictoes-types.ts`) carries:

| entity | fields on the document | shape in a real game |
| --- | --- | --- |
| team | `TTTeam { id, name, color }` | `id` **is the centaur's 20-char document id**; `name` is the human name; `color` is a hex string |
| unit | `TTGamePlayer { id, teamID, letter, unitType? }` | the team's FIRST unit is keyed by the bare `team.id`; the rest are `` `${team.id}#${k}` ``; `letter` is `A…Z` by index within the team |
| operator | `ConnectedUser` / `PlayerEnrolment` (`active-game-manager.ts`) | `{ userId, name, color }`; `userId` is opaque |
| game | the game document | **has no title field at all** |

`src/firebase/translate.ts` turns that into the wire `Snake`
(`src/types/battlesnake.ts`), which has room for all three readings:
`name`, `letter` and `teamName`.

So the names EXIST. Every place below is a place they were dropped.

## 2. Where each name was lost

1. **`translate.ts buildSnake`** — `name: team && gamePlayer ? \`${team.name}
   ${gamePlayer.letter}\` : playerID`, and `if (gamePlayer) snake.letter = …`.
   A unit with no `gamePlayers` row got **the raw player id as its name** and
   **no letter at all**. The wire's `name` field could therefore BE a key.
2. **`src/lens/store/index.ts unitRowsOf`** — `letter: snake?.letter ?? ''`,
   and **no `name` field on `UnitRow` at any point**. The lens frame could
   carry a unit's health, weight and orientation but not what to call it.
3. **`boardOf(anchor)`** — an anchor without an in-memory settlement folds to a
   0×0 board. `logStoredEvent` drops the settlement on the way to Postgres, so
   every replayed turn, every late joiner and every review had `letter: ''` for
   every unit, by construction.
4. **`src/lens/view/index.ts stageSummary`** — `letter: row?.letter || unit`.
   **This printed the key.** It is the line in the screenshot.
5. **`StagedMoveView`** (both the manager's and the lens's) was an opaque
   `Record<string, unknown>` — it carried a move and a colour, never a name.
6. **`TurnEvent.actor`** has a `name` field, and the manager filled it `null`
   for every `board.arrived`; `authorOf` then returned an `OperatorId` and the
   rail read it out as prose ("a constant of cluster 0, by u7").
7. **The page header** — `pageTitle.textContent = \`Game ${gameId}\``. There
   was nothing else to say, because nothing composed a title.
8. **`review.js`** printed `m.unit` directly in seven places.

## 3. One naming authority — `src/logic/naming.ts`

Dependency-free (types only), so the server, the lens reducer and the browser
bundle all run the same assignment.

* **unit** → `` `<team name> <letter>` ``. The letter is the game server's when
  it supplies one and is otherwise **assigned deterministically per team, in
  unit order, skipping letters the server already claimed** (`A B C …`, then
  `AA`).
* **team** → its `name`; failing that a prettified id; **never** a raw 20-char
  id (`isOpaqueKey` decides, at 16 characters).
* **operator** → the connected user's display name, else the enrolment's.
* **game** → `gameTitleOf(teams, turn)` → `"Chris vs Charlie, turn 41"` when
  the document has no title.

`unitName` / `unitLetter` / `operatorName` are **total**: the worst answer they
can give is `Unit MtFz…#2`, which is short enough that the guard in §5 passes
and honest enough that nobody mistakes it for a name.

## 4. Why the harness could not see the defect

`src/tests/local-game.ts makeUnit` hand-wrote `name: \`${teamId} ${letter}\``,
`letter` and `teamName`, over ids like `red-A` — five characters. The regex
boundary never even fired there, and every field the page assumed was present
because the fixture had written it by hand.

The fixture no longer writes any of them: `buildBoard` runs its roster through
`assignNames` + `applyNames`, the same two calls `translate.ts` makes. **A
harness board can no longer carry a field a real board lacks.**

## 5. Where the names travel

`board.arrived` carries a `NameDirectory` (`BoardArrivedPayload.names`),
written by `ActiveGameManager.namesFor()`. The anchor is the one event a fold
cannot do without, so a frame that has an anchor has every name — including for
units the board has since dropped.

From there:

* `LensFrame.names` (required) and `UnitRow.name` (required).
* `StagedMoveView` carries `name` + `letter`, on the wire and in the fold.
* `stageSummary`, `panel.focus`, `panel.movesets.row`/`.fixed`,
  `timeline.tick`, the widen note and `dominanceClause` all emit names.
* `lens-panel.js`, `review.js` and `alerts.js` read `.name`; the page header
  reads the directory's `title`.
* **Keys remain in `data-` attributes, handler arguments and map keys** — an id
  is an address, a name is content.

## 6. The structural guard

`src/tests/lens-naming.test.ts` builds a frame **through the production
translation** from a `TTGameSetup` with realistic ids (20-char player ids and
`#n` suffixes), renders the rail, the lane, the stage line, the review headline
and the header, and asserts that no token matching
`/[A-Za-z0-9_-]{16,}(#\d+)?/` appears in visible text. The walkthrough drill
(`scripts/lens-walkthrough.js`) runs the same assertion against the live DOM.
