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

## Configuring the Firebase connection

The centaur needs four values; without all four it starts in UI-only mode and
cannot play.

| Env var | What it is | Where it comes from |
| --- | --- | --- |
| `TACTICTOES_CENTAUR_ID` | The centaur's document id in the TacticToes `centaurs` collection | Shown when you create the centaur in TacticToes |
| `TACTICTOES_CENTAUR_API_KEY` | The centaur's API key (`ttc_…`) | Returned **once** by the TacticToes `createCentaurApiKey` callable — the centaur owner calls it (e.g. from the web app) with `{ centaurId }`; calling again rotates the key |
| `TACTICTOES_FIREBASE_PROJECT_ID` | The TacticToes Firebase project id | e.g. `tactic-toes` (or your own staging project) |
| `TACTICTOES_FIREBASE_API_KEY` | The Firebase **Web API key** of that project | Firebase console → Project settings → General. This is a public client identifier, not a secret |

Optional:

| Env var | Default | Purpose |
| --- | --- | --- |
| `TACTICTOES_FUNCTIONS_REGION` | `us-central1` | Region of the TacticToes Cloud Functions (for the `exchangeCentaurApiKey` callable) |

Set them in the deployment environment (Replit secrets, `.env` via your own
tooling — note there is no dotenv loader; the process reads `process.env`
directly).

### What happens at startup

1. The centaur calls the public `exchangeCentaurApiKey` callable with
   `{ centaurId, apiKey }` and receives a Firebase custom token (uid
   `centaur:<centaurId>`, claims `{ centaur: true, centaurId }`).
2. `signInWithCustomToken` establishes the session; the Firebase SDK
   refreshes it automatically. If the process restarts it simply re-exchanges.
3. It listens to `centaurs/{centaurId}/games` — TacticToes writes an invite
   doc there at every game start — and opens a listener on each live game
   document.
4. Each new turn is translated into per-snake board views, the decision
   engine runs, and each snake's move is staged via a `privateMoves` write.
   Firestore security rules only accept writes for snakes the game's
   `centaurMap` assigns to this centaur identity.

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
- `src/server/websocket-server.ts` + `src/web/` — the centaur UI.
- `src/logic/` — the decision engine (Voronoi territory strategy).
