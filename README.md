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
  the same write-through staging path the engine uses. Selecting a unit also
  opens the **decision lens** (below), which is where the bot's own reasoning
  about that unit is read.
- **Hold (`h`).** A standing "stand your ground" order for units that *can*
  hold. Movement costs health under the rules and standing still does not, so
  a piece with no food and no worthwhile target within reach should not be
  spending health shuffling: `h` on the selected unit stages its **stay** —
  same square, same orientation — through the ordinary requested → confirmed
  path, outranking the engine's recommendation exactly as any manual
  intervention does, and **re-stages it on every new board** until it is
  lifted. Pressing `h` again toggles it off; `Del` (cancel intervention)
  clears it like any other command; a goto/near/manual command **replaces**
  it, because a unit's commands are one intent and the newest one wins. It
  ends by itself when the unit dies. Only chess pieces can hold — a snake's
  head must vacate its square every turn, so there is no stay to stage for
  one, and `h` on a snake says so instead of doing anything. A held unit
  wears a **shield above its head** on the board, live and in replay.

## The decision lens

The centaur's inspection surface. It answers **"why is this unit moving
there?"** — and the answer stopped being a list of heuristic components some
time ago, because the bot stopped deciding that way. It solves **clusters** of
interacting units jointly and emits **movesets**: one assignment of a move to
every member of a cluster, scored as a whole. A per-unit table of thirty
weighted terms is not a lossy view of that decision; it is a view of a decision
nobody takes any more.

- **Four levels, one cursor.** Selecting a unit opens its **cluster** — the
  other units the bot is solving jointly with it — and the top **movesets** for
  that cluster, conditional on the candidate under the cursor. Descend with
  `[` `]` (moveset) and `B` (a member's terms); every level below the deepest
  one you chose fills itself in, so a selected unit is never left staring at an
  empty panel.
- **Scored as best-of-cluster.** The number beside a candidate is what the
  whole cluster can do *if this unit plays that move* — not what the move is
  worth on its own. A candidate whose conditional list was never computed shows
  a grade (`~` estimated, `·` unpriced) and never a bare number.
- **The joint row is mandatory.** A member's contribution is a delta against a
  fixed reference action, and the part of the total that is nobody's alone is
  drawn as its own row — **even when it is zero**, because a zero cross term is
  a finding, and omitting a zero residual and omitting a large one are the same
  bug.
- **Violet means hypothetical.** Cluster tethers, chips and implied moves are
  violet; nothing else on the board is. **Only disagreement draws**: a member
  whose implied move equals what is already staged gets a ring on the existing
  arrowhead rather than a second arrow, so walking the moveset list lights up
  exactly what would change. `F` draws the runner-up in teal, dotted, only
  where it differs.
- **`Space` stages what is on the screen.** The lock pins the focused unit plus
  every member whose move differs from what is staged — the exact set that
  makes the displayed moveset the one the kernel stages — and the count is on
  the affordance *before* the press, with no `≤`. On rank 1 that is one pin,
  yours, which is precisely what `Space` always did: the gesture is not
  re-taught, it is re-explained. `Shift+Space` pins every member.
  Cross-owner pins are refused at the client and named, never issued.
- **The turn has a timeline.** `,` `.` step the events *within* the current
  turn, `Shift+,` `Shift+.` jump emission to emission, `N` returns to now.
  Stepping back is loud: the ink fades and every determination is refused,
  because locking against a frame whose ordering has moved would stage
  something other than what is drawn.
- **One display, two sources.** Live play and replay are the same fold over the
  same event type — `src/lens/view` consumes a `LensFrame` and emits a draw
  transcript, and `src/web/lens-panel.js` turns that transcript into the rail
  and the board's ink. There is no live-versus-replay branch anywhere in the
  render path; what differs is whether determinations are legal, and that is a
  label on one affordance.
- **One implementation, bundled.** The fold, the cursor machine and the
  renderer are TypeScript under `src/lens/`, and the page runs *that* module:
  `npm run build:lens` bundles it to `src/web/lens-view.js`, and
  `lens-bundle.test.ts` fails if the checked-in bundle drifts from its source.
  Run it after changing anything under `src/lens/`.

Gone with it: the per-unit heuristic table, the Voronoi territory overlay and
its switch, the grey recommendation hint arrow (the bot's recommendation *is*
the rank-1 moveset's assignment now), per-candidate quality tints, and the two
"no data" panels — replaced by one honest sentence that names what has happened
and at which `seq`.

## Chess pieces

TacticToes games can mix chess pieces (pawn, knight, bishop, rook, queen,
king) with snakes on the same board. The centaur supports them as a
pragmatic v1:

- **Rendering.** Every unit — snakes and pieces alike — draws its unit icon
  upright, plus an eye on the cell edge it faces (`Turn.orientation`), live and
  in replay. The eye takes the orientation vector's true angle, so the eight
  compass directions and knight L-offsets each get their own facing. A piece
  arrives from the wire as a 1-cell unit whose `length` is its weight (stack
  size), shown in its unit tag.
- **Commanding.** Click a candidate square or steer with the keyboard
  (facing-relative arrows, absolute numpad — see the schema in
  `play-game.html`), then Space to stage; or right-click a destination
  square (the goto waypoint) — that IS the piece's staged move. If the
  target is a legal single move (mirroring the server's `pieceMoves.ts`
  legality, including pawn orientation, the side-square rotation encoding and
  diagonal-only-onto-target), the destination's full-board index is staged
  and published through the normal requested → confirmed → final pipeline;
  anything illegal stages the piece's own square (= stay). Staging a pawn's
  side square spends the turn rotating to face that way. `h` toggles a
  standing **hold** on the piece (see *Hold* above) — the one command that
  needs no target, since its answer is the same square every turn.
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
- `src/server/websocket-server.ts` + `src/web/` — the centaur UI, and the
  seven lens envelopes (`lens-frames` out; `lens-conditional`,
  `lens-breakdown`, `lens-lock`, `lens-cancel` in, each answered or refused in
  the type of its own reply).
- `src/lens/view/` — the decision lens's view-model: the cursor state machine,
  the two sources, and the renderer that turns a `LensFrame` into a draw
  transcript. `src/web/lens-panel.js` is the only thing that reads that
  transcript, and it holds no lens logic of its own.
- `src/logic/` — the decision engine (Voronoi territory strategy).
