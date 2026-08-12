# Chris-Centaur — Team Snek Centaur

## ⛔ CRITICAL — NEVER DESTROY DATA SILENTLY

**Absolute rule; overrides convenience, deadlines, or "just the dev DB". When in doubt, STOP and ask.**

- **NEVER** run an operation that loses information (`DELETE`/`TRUNCATE`/`DROP`, drop-and-recreate migrations, overwriting data files) without the user's explicit, informed consent.
- **A schema mismatch is NOT a license to wipe rows.** Use data-preserving migrations: `RENAME COLUMN`, or add nullable → backfill → set `NOT NULL`.
- **If blocked without a data-preserving path, PAUSE** and ask the user with options and tradeoffs before doing anything irreversible.

## Overview

Chris-Centaur is a TypeScript centaur for TacticToes **Team Snek**: an AI engine (Voronoi territory analysis) plus a human-in-the-loop web UI driving one team of snakes per game. Humans can watch, override, or leave any snake on engine auto-pilot; every game is played over the TacticToes Firebase interface. The engine uses team-based coordination and focuses on maximizing controlled territory through Voronoi diagrams while avoiding fatal collisions, particularly head-to-head encounters with larger snakes.

## Game Rules

**Team Snek Scoring System:**
- **All snakes are equivalent** — no privileged snake exists. Every snake on a team counts.
- **Control (Centaur):** any snake can be driven by a human or the engine in the same game, so strategy applies per-snake, not to one privileged snake.
- **Teams:** each team belongs to one centaur; its snakes are lettered A, B, C… (`snakesPerTeam` per team) and share the team colour. A snake's display name is `<team name> <letter>`.
- **Scoring:** a team's final score is the **sum of the lengths of that team's snakes still alive at game end**. Dead snakes contribute nothing.
- **Game end:** at the **turn limit declared by the server in the game settings**; if no turn limit is declared, the game ends when **only one team remains**.

**Strategic Implications:**
- **Survival matters**: A dead snake scores zero, so keeping every snake alive protects the team's score.
- **Conservative play**: Avoid risky confrontations, especially head-to-head collisions with larger snakes.
- **Maximize food collection**: Since score = summed length, collecting food directly increases the team's score.
- **Territory control**: Controlling food-rich territory is essential for sustained growth across all of a team's snakes.
- **Food proximity vs. consumption**: The engine distinguishes between:
  - Being near food (proximity) - important for positioning
  - Actually eating food - directly increases score and should be highly rewarded

## Configuration Policy — Replit Secrets only, no env vars

- **All runtime configuration lives in Replit Secrets** (per-environment: Workspace secrets for dev, Publishing UI deployment secrets for prod). This includes non-sensitive values like `TACTICTOES_FUNCTIONS_REGION` and `GAME_ENGINE_HOST`.
- **Never use Replit environment variables** (`setEnvVars` / the env-vars pane): they are written into `.replit`, which is committed source code — config values must not live in source. They also silently shadow same-key deployment secrets.
- **No config values or fallback defaults in source code.** Missing config must fail loudly ("not configured"), never fall back to a hardcoded default.

## User Preferences

- Preferred communication style: Simple, everyday language.
- **Technical Debt Policy**: Prioritize minimizing technical debt over backwards compatibility. Clean, maintainable code is more important than supporting deprecated features since there are no external users.

## System Architecture

### Backend
- **Express + TypeScript + Node.js** — serves the centaur web UI and its REST APIs, with a WebSocket server (`ws`, path `/ws`) attached to the same HTTP server for centaur play. There are NO Battlesnake protocol endpoints — games are driven exclusively through the TacticToes Firebase interface below.
- **Async decision logging** — non-blocking queued logging to PostgreSQL; bounded queue, batching, retries with backoff, graceful-shutdown flush.

### Core Game Logic
- **`BoardGraph`** — single source of truth for passability (walls, snake bodies, hazards, tail-growth timing); all collision checks defer to it. Supports tiered clearance (static / conservative / optimistic) based on when body segments will vacate.
- **`MultiSourceBFS`** — single-pass Voronoi territory computation with tie-awareness.
- **`MoveAnalyzer`** — single source of truth for move enumeration ({safe, risky} sets).
- **`BoardEvaluator`** — unified scoring (territory, food control, space/survival heuristics, hard `trapped` veto for fatal pockets).
- **`DecisionEngine`** — orchestrates enumeration → candidate selection → simulation → evaluation → aggregation → decision, time-bounded to respect the response deadline.
- **`VoronoiStrategy`** — swappable main strategy using the components above.
- **`TeamDetector`** — team identification via squad fields with color-matching fallback; degrades gracefully to individual play.

### TacticToes Firebase Interface (the sole game transport)
Direct-to-Firestore transport for the TacticToes server (`src/firebase/`). Configuration is documented in `README.md`.
- Requires `TACTICTOES_CENTAUR_ID`, `TACTICTOES_CENTAUR_API_KEY`, `TACTICTOES_FIREBASE_PROJECT_ID` and `TACTICTOES_FIREBASE_API_KEY` (see `.env.example`); without them the process serves the web UI only and cannot play.
- **Auth**: exchanges the centaur API key for a Firebase custom token via the server's `exchangeCentaurApiKey` callable, then `signInWithCustomToken`; the SDK auto-refreshes.
- **Game discovery**: listens to `centaurs/{centaurId}/games` invite docs written by the server at game start; opens one game-doc listener per live game and stops when the game has winners or all owned snakes are dead.
- **Multi-snake**: one centaur identity drives its whole team (every gamePlayer whose `teamID` is the centaur's id), building one per-snake `GameState` view per turn via `src/firebase/translate.ts` — the exact perimeter-strip + y-flip transform the TacticToes server applies, so the engine sees identical boards (invariant-tested in `src/tests/firebase-translate.test.ts`).
- **Requested → confirmed → final pipeline**: `ActiveGameManager.stageMove` — the single writer of every snake's REQUESTED move — funnels EVERY staging action (bot recommendation, manual selection, queue step, waypoint step, revert-to-heuristic, kill-all) into `ensureStagedPublished`, which writes the request to Firestore via the injected `MoveSubmitter` and republishes (1s backstop) until the CONFIRMED staged move — fed back by a per-snake `privateMoves` read-back listener (`setConfirmedStagedMove`) — matches the request. Firebase is the single source of truth; the server mirrors requested/confirmed/final purely for UI broadcasts (ghost arrow = requested ≠ confirmed, solid = confirmed, double = final). Turn finalization (`finalizeTurnMove`) fires from the interface ONLY when a snake's commit is observed in `moveStatuses.movedPlayerIDs` AND its outcome is knowable from Firebase state — never a local-clock/deadline guess. The outcome is either the confirmed staged move, or (when the read-back proves nothing is staged and no unconfirmed request is outstanding) the engine's deterministic default: continue the previous head−neck direction (`continuationDirection`). The default inference is exact because Firestore rules make this server the only possible writer of its snakes' `privateMoves`. Turns that resolve by timeout without commits never show a double arrow. The game server resolves each turn with the last staged move before its own deadline and records every player's applied move (defaults included) in the next turn's `moves` map, which `deriveLastMoves` now prefers over head-delta reconstruction.
- **Submit All (manual commit, BINDING)**: commitment freezes the snake's staged move for the turn — Firestore rules reject privateMoves creates for a committed snake — so `movedPlayerIDs` represents true commitment and a committed snake's move is knowable immediately. `commitAllStaged` therefore commits a snake immediately only when its requested move is already Firebase-confirmed; otherwise it sets `pendingCommitTurn` and the commit fires automatically in `setConfirmedStagedMove` the moment the confirmation matches (cancelled if a different move is staged first). Post-commit, `stageMove` freezes the staged record (intent changes only apply from the next turn) and the publish pipeline stops. Triggered only by explicit user action (Submit All button / Enter); deduped per turn; skips stale-turn records.
- **Resolution bookkeeping**: when the next turn arrives, the moves the server actually applied are derived from the board delta (`deriveLastMoves`) and fed to `applyResolvedMoves` — decision-log update, premove-queue advancement, and UI `move-committed` events — before the new board is applied.
- **Listener watchdog**: silence is only evidence of a dead game-doc listener once a snapshot was actually DUE — i.e. past the current turn's `endTime` (`listenerLooksDead`). A turn is quiet by design until it resolves, so the old fixed 8s window condemned every healthy turn 0 (60s) repeatedly. Each spurious rebuild tore down the per-turn read-back listeners and never rebuilt them (the replayed snapshot doesn't advance the turn number), leaving the centaur blind to its own staged moves for the rest of the turn: writes still landed and still played, but nothing confirmed and nothing finalized. `rebuildClient` now re-opens the turn watch explicitly (`restoreTurnWatch`).
- **Turn 0 is not special**: TacticToes writes each turn exactly once, deadline included, and `turns` only ever grows — so `if (turnNumber <= lastProcessedTurn) return;` is the whole same-turn story, and there is no turn-0 branch anywhere in `firebase-interface.ts`. The read-back mirrors the server's resolution rule exactly (latest server-acked `privateMoves` write with `timestamp <= endTime`), so a solid arrow means "this is the move the server will use", not merely "Firebase accepted a write". The turn-0 symptoms that looked like client bugs — the deadline jumping, the solid arrow never arriving — were game starts re-creating turn 0 with a fresh random board; fixed in the TacticToes start transaction, not worked around here.

### Centaur Play Mode
Human-in-the-loop mode: multiple users can view and control snakes in the same live game via RTS-style click-to-select.
- **`/play`** — lobby listing one card per game with its controlled snakes.
- **`/game/:id`** — unified game viewer serving both live games (WebSocket) and finished games (decision-log replay) from the same page.
- Server keeps active game state in an in-memory singleton; unselected snakes run on engine auto-pilot; selections, move staging, and per-turn evaluations flow over per-game WebSocket subscriptions. Every staging action a human takes is write-through published to Firebase as that snake's staged move.
- A WebSocket connection debugger logs all connection events (server file + `/connection-debug` viewer) for diagnosing client disconnects.

### Server Activity Page
- **`/activity`** — audit page for autoscale behavior: horizontal bands (green = active with users/game traffic, amber = up but idle, gaps = scaled to zero) with zoom/pan and inspectable event markers. No auto-refresh timers — data loads only on user actions.
- **`server_events` table** records boot, shutdown (written on SIGTERM with a bounded flush), and woke / went-idle transitions (WebSocket connection count 0↔1, plus inbound `/start`/`/move` traffic with a 60s activity window so engine-only games count). Periods with no shutdown event (crash/force-kill) are implicitly closed by the next boot and rendered as "end unknown".

### Database
- **PostgreSQL (Neon)** stores per-move decision logs for analysis and replay.
- **Schema is owned by Drizzle**: `src/database/schema.ts` is the source of truth, there is no startup DDL; dev sync via `npm run db:push`, production via the Publish schema diff.

### Deployment
- Autoscale with max 1 machine (single instance required for WebSocket + in-memory game state).
- Port configurable via `PORT` (default 5000); static web assets served from `src/web`; TypeScript compiled to `dist/` for production; database env vars provided by Replit.
- The HTTP server exposes only the web UI and its read APIs; game traffic flows through the outbound Firebase connection (no inbound webhook endpoints).
