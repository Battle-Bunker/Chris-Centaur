---
name: Firebase-only game transport + status surfacing
description: The bot's sole game transport is the TacticToes Firebase interface; connection status must be loud in the UI.
---

The Battlesnake HTTP webhooks (/start, /move, /end) are gone: games arrive exclusively via the TacticToes Firebase interface (invite listener on `bots/{botId}/games`, Firestore gRPC listeners — no websocket, no inbound HTTP for gameplay).

**Why:** the bot is 100% nonfunctional without its Firebase connection, and the initial `exchangeBotApiKey` sign-in can fail with an opaque `functions/internal`, leaving the bot silently blind.

**How to apply:**
- Connection state is tracked in `TacticToesFirebaseInterface` (getStatus/onStatusChange/retryConnect) and surfaced via `/api/firebase-status`, `POST /api/firebase-retry` (10s cooldown — public endpoint), a WS `firebase-status` push, and the shared red banner `src/web/firebase-status-banner.js` on every page.
- The banner must NEVER interval-poll (autoscale billing): fetch on load + visibilitychange only; live pages get pushes over their existing WS.
- All connect paths (start, watchdog rebuild, manual retry) serialize through one `connectOp` promise; failed starts must tear down the partial Firebase app or each retry leaks one.
- The invite listener needs its own error callback → rebuild: the game-doc watchdog only covers watched games, so with zero live games a dead invite feed would otherwise report 'connected' forever.
