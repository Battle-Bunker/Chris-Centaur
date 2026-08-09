# Chris-Centaur — Team Snek Bot

A TypeScript bot (and human-in-the-loop "centaur" server) for
[TacticToes](https://github.com/Battle-Bunker/TacticToes) Team Snek. It plays
through TacticToes' **Firebase bot interface**: the bot signs in to the game's
Firebase project as a bot principal, discovers its games through Firestore
listeners, and stages moves by writing Firestore documents. There is no
Battlesnake-style HTTP interface — Firebase is the single source of truth for
staged moves.

## How it plays

- **One identity, many snakes.** A single bot identity can own several snakes
  in a Team Snek game (the original + clones). The interface computes and
  stages a move for every owned snake each turn.
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
- **Submit All (manual commit).** The UI's Submit All button (or Enter) marks
  every snake staged for the current turn as *done* in Firebase
  (`moveStatuses.movedPlayerIDs`), letting the game server resolve the turn
  early once every alive player has committed. It never fires on its own,
  it doesn't change what is staged, and it can't be undone for the turn.
- **Centaur play.** The web UI (served on `PORT`, default 5000, at `/play`)
  lets humans select snakes, stage exact moves, draw premove paths and
  waypoints, or leave snakes on bot auto-pilot. Whatever the human does is the
  same write-through staging path the bot uses.

## Configuring the Firebase connection

The bot needs four values; without all four it starts in UI-only mode and
cannot play.

| Env var | What it is | Where it comes from |
| --- | --- | --- |
| `TACTICTOES_BOT_ID` | The bot's document id in the TacticToes `bots` collection | Shown when you create the bot in TacticToes |
| `TACTICTOES_BOT_API_KEY` | The bot's API key (`ttb_…`) | Returned **once** by the TacticToes `createBotApiKey` callable — the bot owner calls it (e.g. from the web app) with `{ botId }`; calling again rotates the key |
| `TACTICTOES_FIREBASE_PROJECT_ID` | The TacticToes Firebase project id | e.g. `tactic-toes` (or your own staging project) |
| `TACTICTOES_FIREBASE_API_KEY` | The Firebase **Web API key** of that project | Firebase console → Project settings → General. This is a public client identifier, not a secret |

Optional:

| Env var | Default | Purpose |
| --- | --- | --- |
| `TACTICTOES_FUNCTIONS_REGION` | `us-central1` | Region of the TacticToes Cloud Functions (for the `exchangeBotApiKey` callable) |

Set them in the deployment environment (Replit secrets, `.env` via your own
tooling — note there is no dotenv loader; the process reads `process.env`
directly).

### What happens at startup

1. The bot calls the public `exchangeBotApiKey` callable with
   `{ botId, apiKey }` and receives a Firebase custom token (uid
   `bot:<botId>`, claims `{ bot: true, botId }`).
2. `signInWithCustomToken` establishes the session; the Firebase SDK
   refreshes it automatically. If the process restarts it simply re-exchanges.
3. It listens to `bots/{botId}/games` — TacticToes writes an invite doc there
   at every game start — and opens a listener on each live game document.
4. Each new turn is translated into per-snake board views, the decision
   engine runs, and each snake's move is staged via a `privateMoves` write.
   Firestore security rules only accept writes for snakes the game's `botMap`
   assigns to this bot identity.

Rotating the API key (calling `createBotApiKey` again) invalidates the old
key for future sign-ins — update `TACTICTOES_BOT_API_KEY` and restart.

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
