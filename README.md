# Chris-Centaur — Team Snek Centaur

A TypeScript centaur (AI engine + human-in-the-loop server) for
[TacticToes](https://github.com/Battle-Bunker/TacticToes) Team Snek. It plays
through TacticToes' **Firebase centaur interface**: the centaur signs in to
the game's Firebase project as a centaur principal, discovers its games
through Firestore listeners, and stages moves by writing Firestore documents.
There is no Battlesnake-style HTTP interface — Firebase is the single source
of truth for staged moves.

## How it plays

- **One identity, one team of snakes.** A centaur controls every snake on its
  team (`snakesPerTeam` of them, lettered A, B, C…). The interface computes
  and stages a move for every owned snake each turn.
- **Requested → confirmed → final.** Every staging action — the engine's
  recommendation, a human picking an exact move in the centaur UI, a "go to"
  waypoint or premove-queue step, or cancelling human intervention and
  reverting to the recommended move — becomes the snake's **requested move**
  and is immediately published to Firebase. The server then reads back what
  Firebase actually holds (a `privateMoves` listener per snake) and
  **republishes until the confirmed staged move matches the request**. The UI
  shows the confirmed move as the solid arrow and the requested move as a
  ghost arrow whenever they differ, so what you see solid is always what the
  game server would play. The double (committed) arrow appears only when the
  snake's commit is actually **observed in Firebase**
  (`moveStatuses.movedPlayerIDs` via the server's subscription) — never
  inferred from timers — so it is fully reliable. A committed snake with a
  confirmed staged move shows that move; a committed snake with provably
  nothing staged shows the engine's deterministic **default** (continue the
  previous move) — exact, because only this server can write the snake's
  `privateMoves`. Turns that resolve by timeout without a commit simply
  advance without a double arrow. The game server resolves each turn with
  the **last staged move received before the turn deadline**; nothing is
  committed automatically.
- **Submit All (manual commit, binding).** The UI's Submit All button (or
  Enter) marks every snake staged for the current turn as *done* in Firebase
  (`moveStatuses.movedPlayerIDs`), letting the game server resolve the turn
  early once every alive player has committed. Commitment is **binding**:
  the Firestore rules reject any further staging for a committed snake, so
  its confirmed move at commit time is guaranteed to play. To never freeze
  the wrong move, a snake commits immediately only when its requested move
  is already Firebase-confirmed; otherwise the commit defers and fires
  automatically the instant the confirmation lands (and is cancelled if you
  stage a different move first). It never fires on its own and can't be
  undone for the turn.
- **Centaur play.** The web UI (served on `PORT`, default 5000, at `/play`)
  lets humans select snakes, stage exact moves, draw premove paths and
  waypoints, or leave snakes on engine auto-pilot. Whatever the human does is
  the same write-through staging path the engine uses.

## Chess pieces

TacticToes games can mix chess pieces (pawn, knight, bishop, rook, queen,
king) with snakes on the same board. The centaur supports them as a
pragmatic v1:

- **Rendering.** Pieces render with their chess glyph (♟♞♝♜♛♚) instead of a
  team letter, with a small weight badge when their weight (stack size) > 1
  and a facing triangle for pawns. A piece arrives from the wire as a 1-cell
  unit whose `length` is its weight.
- **Commanding.** Right-click a destination square (the goto waypoint) —
  that IS the piece's staged move. If the target is a legal single move
  (mirroring the server's `pieceMoves.ts` legality, including pawn facing,
  the side-square rotation encoding and diagonal-only-onto-target), the
  destination's full-board index is staged and published through the normal
  requested → confirmed → final pipeline; anything illegal stages the
  piece's own square (= stay). Staging a pawn's side square spends the turn
  rotating to face that way. The 4-way keypad / Space staging doesn't apply
  to pieces.
- **Not automated.** The minimax engine drives **snakes only**: own pieces
  get no engine recommendation — an uncommanded piece stages nothing and the
  server defaults it to stay (Submit All still works: it publishes an
  explicit stay and commits once Firebase confirms it). In lookahead, enemy
  and allied pieces are approximated as **stationary 1-cell snakes** (they
  never enter the simulated move sets), so the engine plans around where
  pieces stand, not where they could jump. Decision logs and death markers
  stay snake-only.

## Configuring the Firebase connection

The centaur needs four values; without all four it starts in UI-only mode and
cannot play.

| Env var | What it is | Where it comes from |
| --- | --- | --- |
| `TACTICTOES_CENTAUR_ID` | The centaur's document id in the TacticToes `centaurs` collection | Shown when you create the centaur in TacticToes |
| `TACTICTOES_CENTAUR_API_KEY` | The centaur's API key (`ttc_…`) | Returned **once** by the TacticToes `createCentaurApiKey` callable — the centaur owner calls it (e.g. from the web app) with `{ centaurId }`; calling again rotates the key |
| `TACTICTOES_FIREBASE_PROJECT_ID` | The TacticToes Firebase project id | e.g. `tactic-toes` (or your own staging project) |
| `TACTICTOES_FIREBASE_API_KEY` | The Firebase **Web API key** of that project | Firebase console → Project settings → General. This is a public client identifier, not a secret |

Also required:

| Env var | Purpose |
| --- | --- |
| `TACTICTOES_FUNCTIONS_REGION` | Region of the TacticToes Cloud Functions (for the `exchangeCentaurApiKey` callable). **Required, no default** — must match the region where the TacticToes project you point at deploys its functions. If the four vars above are set but this one is missing, startup fails with an error |

Set all of these as **Replit Secrets** (Workspace secrets for development,
deployment secrets in the Publishing UI for production). Project policy: no
Replit environment variables — they are written into the committed `.replit`
file, and config values must not live in source code. There is no dotenv
loader; the process reads `process.env` directly.

### What happens at startup

1. The centaur calls the public `exchangeCentaurApiKey` callable with
   `{ centaurId, apiKey }` and receives a Firebase custom token (uid
   `centaur:<centaurId>`, claims `{ centaur: true, centaurId }`).
2. `signInWithCustomToken` establishes the session; the Firebase SDK
   refreshes it automatically. If the process restarts it simply re-exchanges.
3. It listens to `centaurs/{centaurId}/games` — TacticToes writes an invite
   doc there as soon as the centaur is added to a lobby (`status: 'pending'`)
   and overwrites it at game start (`status: 'started'`; a missing status
   means started).
4. A **pending** invite gets no game-doc listener (no game exists yet):
   the centaur acks it by writing
   `sessions/{s}/setups/{g}/centaurStatus/{centaurId}` =
   `{ centaurId, ready: true, respondedAt }` (this drives the lobby's
   presence chip) and follows the setup doc so `/play` can show the lobby as
   an orange, non-clickable "pending" bubble with its live settings. When
   the invite flips to started the normal flow takes over; if it is deleted
   (team removed) the pending bubble is dropped.
5. For started games, each new turn is translated into per-snake board
   views, the decision engine runs, and each snake's move is staged via a
   `privateMoves` write. Firestore security rules only accept writes for
   snakes the game's `centaurMap` assigns to this centaur identity.

Rotating the API key (calling `createCentaurApiKey` again) invalidates the
old key for future sign-ins — update `TACTICTOES_CENTAUR_API_KEY` and
restart.

## Development

```bash
npm install
npm run dev        # node --watch, serves the UI on PORT (default 5000)
npm test           # jest
npm run lint
npm run build      # tsc → dist/
```

`DATABASE_URL` (Postgres) is used for decision logs, game history and config
storage — see `replit.md` for the full architecture, including the
never-destroy-data rule for that database.

## Key modules

- `src/firebase/firebase-interface.ts` — auth, game discovery, turn intake,
  staged-move publishing (the game transport).
- `src/firebase/translate.ts` — TacticToes board ⇄ Battlesnake-shaped views
  (perimeter strip + y flip, identical to the server's own translation).
- `src/server/active-game-manager.ts` — per-game state, snake intents
  (manual / queue / waypoint / heuristic), the fatal-move consent gate, and
  the single `stageMove` writer that write-through publishes every staged
  move to Firebase.
- `src/logic/piece-moves.ts` — chess-piece movement legality, mirrored from
  the TacticToes engine (keep in lockstep with the server's `pieceMoves.ts`).
- `src/server/websocket-server.ts` + `src/web/` — the centaur UI.
- `src/logic/` — the decision engine (Voronoi territory strategy).
