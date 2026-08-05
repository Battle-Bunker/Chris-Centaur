---
name: Player-name enrolment & login gate
description: How operator identity works on the play page — mandatory unique names, cookie pre-fill, name-keyed stable colours.
---

# Player-name enrolment

Rule: entering an ACTIVE game requires a per-game-unique player name via the login gate; finished games load the replay with no gate. The server's `addConnectedUser(gameId, userId, name)` is the single race-safe uniqueness check (synchronous map check+write); the client's `/api/play/game/:id/players` pre-check is advisory only.

**Why:** two tabs (sessionStorage → distinct userIds) can race the same cookie-prefilled name; only the synchronous server-side enrolment prevents duplicates. Colours must survive refresh/reconnect, so they are derived deterministically from the name (hash into DISTINCT_COLORS + probe past colours used by other enrolled names) and stored on a game-lifetime enrolment that is never released on disconnect.

**How to apply:**
- Enrolments (`game.playerNames`, keyed by lowercased name) live for the whole game — never free a name or colour on disconnect; same userId + same name reclaims exactly.
- The name cookie (`centaurPlayerName`, 1 year) holds the LAST name successfully enrolled; only update it on `game-subscribed` with an accepted name.
- `subscribe-game` must enrol BEFORE setting client.gameId/userId; a rejected name answers `enrol-error` (with `enrolledNames`) and must not become a subscribed operator.
- There is no nickname edit path anymore — the user dot is display-only.
