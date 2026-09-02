# Bot identity and bot binding

Two questions this answers that the centaur could not answer before:

1. **Which bot played this turn?** Every `decision_logs` row now carries
   `botId` and `behaviourId` in its decision block.
2. **Which bot should this game play?** A per-(game, centaur) binding read from
   the existing `config_store` table, resolved at the decision seam.

---

## 1. The two identities

Stamped on every decision row (`decision.botId`, `decision.behaviourId`) and on
the `TurnData` frame the UI receives (`bot`).

### `botId` — the configuration

`<engine>:<profile name>@<12 hex>`, e.g.

```
lobster:lobster-territory@6d2c0e5b9a41
```

The digest is `sha256` over a canonical serialisation of every
behaviour-relevant field of the bot: engine, criterion profile (its name **and**
its weights, reach horizon, command knobs, health reserve), candidate-layer
knobs, and the configured staging-safety **level**. Derived in
`src/config/bot-identity.ts`.

Consequences, all of them deliberate:

- Two processes holding the same configuration derive the same `botId` without
  coordinating — the id is a function of content, not of a registry.
- Any knob change changes it, including a weight moved by a tenth. `engine` and
  `profile` names do not move under such a change, which is exactly why they
  were not enough.
- The operator's **label** for a binding is *not* in the hash: a rename is not a
  new bot.
- The **board-resolved** staging-safety level (`auto` → `full` on a piece board,
  `off` on a snake-only one) is *not* in the hash. That is a consequence of the
  board, not a choice in the configuration; folding it in would make one bot
  into two depending on what it was playing.

### `behaviourId` — the build

In descending order of what it proves (`src/config/build-identity.ts`):

| Reading | When |
| --- | --- |
| `git:<sha12>` | a commit was published to the environment at build time |
| `pkg:<version>+dist:<sha12>` | no commit; the compiled `dist/*.js` is hashed instead |
| `pkg:<version>+dist:none` | running from TypeScript source (ts-node, jest) |
| `unknown` | nothing readable |

Set **`CENTAUR_BUILD_COMMIT`** at build time to get the strong reading.
`GIT_COMMIT`, `SOURCE_VERSION`, `RAILWAY_GIT_COMMIT_SHA` and
`VERCEL_GIT_COMMIT_SHA` are also read, so a host that already publishes its
commit needs no configuration. Derived once per process and memoised: an
identity that changed mid-game would split one game's rows across two
behaviours and lie about both.

### Where the stamp is *not*

Only on the decision rows and the live turn frame. The `games` table has no
`jsonb` column, and the task's constraint is no schema change — so there is no
honest once-per-game place to put it. `turn_states` has `jsonb` columns but they
are board-scoped shared truth written by the canonical pipeline, not per-seat
facts. A game's bot is therefore read off its decision rows (they are
per-`(game, snake, turn)` and every one of them carries it) or, live, from
`GET /api/play/game/:gameId/bot`.

---

## 2. Binding a bot

Resolution order at the decision seam, most specific first:

| Source | `config_store` key | Scope |
| --- | --- | --- |
| `game` | `bot.game.<gameId>` | one game |
| `centaur` | `bot.centaur.<centaurId>` | every game that centaur plays |
| `store-default` | `bot.default` | this deployment |
| `env-default` | `CENTAUR_BOT`, else the shipped bot | the floor — today's behaviour |

With an empty table and an unset `CENTAUR_BOT` the resolved bot is exactly the
configuration that shipped, so nothing moved when this was introduced.

`<centaurId>` is `TACTICTOES_CENTAUR_ID` — the same value the game's snakes
carry as their `teamID`.

### Value shapes

Any of these may be the value of a binding key:

```jsonc
// 1. a bot by name (a built-in, or a member of bot.catalog)
"material-only"

// 2. a named bot plus an operator's dial excursion
{ "bot": "lobster-territory", "candidates": { "gainOrdering": false } }

// 3. a profile written out in full
{
  "name": "arm-b",
  "profile": {
    "name": "arm-b",
    "weights": { "material": 10, "reach": 1, "room": 1, "healthEconomy": 1,
                 "kingMargin": 1, "command": 1, "food": 1, "momentum": 1,
                 "contest": 1 },
    "reachHorizonTurns": 4,
    "command": { "ground": 1, "food": 20, "royal": false },
    "healthReserveRatio": 0.5
  },
  "stagingSafety": "full"
}
```

Optional on every object form: `candidates` (any subset of `CandidateKnobs`),
`stagingSafety` (`off` | `auto` | `guard` | `full`), `engine`
(`lobster` | `legacy`), `name` (the label).

### Built-in bots

`lobster-territory` (the default), `lobster-territory-a` (the royal-command
ablation arm), `material-only`. `bot.catalog` adds more:

```jsonc
// key: bot.catalog
{ "quiet-arm": { "bot": "lobster-territory", "candidates": { "gainOrdering": false } } }
```

### Binding a bot in practice

```sql
-- one game
INSERT INTO config_store (key, value, updated_at)
VALUES ('bot.game.<gameId>', '"material-only"', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- every game this centaur plays, with a dial excursion
INSERT INTO config_store (key, value, updated_at)
VALUES ('bot.centaur.<centaurId>',
        '{"bot":"lobster-territory","candidates":{"gainOrdering":false}}', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```

The stored `value` is a **JSON string** (the column is `text` and the store
`JSON.parse`s it), which is why the bare name above is quoted.

No redeploy. The registry reloads on a 60 s TTL, so a new binding takes effect
on the next decision after that; it is loaded once at boot before the first turn
can arrive.

### Refusals

Every stored binding is parsed structurally and then run through `checkWeights`
— the same construction-time check every shipped profile passes. It catches a
silent failure: a weight table missing a folded feature does **not** fold at
zero, it folds at whatever default that feature's author chose, and a typo'd key
is a number that does nothing while looking like it does something.

A binding that fails is **refused whole**, logged as
`[bot-binding] REFUSED <key>: <reason>`, listed in the `refusals` field of the
read-only routes, and the lookup falls through to the next level. It is never
partially applied.

A store that cannot be read keeps the bindings already loaded — a transport blip
must not silently re-bind every live game mid-experiment.

---

## 3. Reading it back

```
GET /api/play/game/:gameId/bot
```

```jsonc
{
  "gameId": "…",
  "observed": true,          // true = what the decision seam actually resolved
  "botId": "lobster:material-only@…",
  "behaviourId": "git:8be9bf1…",
  "name": "material-only",
  "engine": "lobster",
  "profile": "material-only",
  "stagingSafety": "auto",
  "candidates": null,
  "source": "game",          // game | centaur | store-default | env-default
  "key": "bot.game.…",
  "refusals": []
}
```

`observed: false` means no turn has been decided for this game yet, so the
answer is what the *next* decision would resolve to.

```
GET /api/bots
```

lists every bindable bot (built-ins plus `bot.catalog`) and the process's
`behaviourId`.

Both are read-only on purpose: an endpoint that could re-bind a live game's
objective function from an unauthenticated GET surface is not something this
server should own. Bindings are changed by writing a `config_store` row.
