---
name: Player-name enrolment & login gate
description: How operator identity works on the play page — mandatory unique names, cookie pre-fill, arrival-ordered stable colours.
---

# Player-name enrolment

Rule: entering an ACTIVE game requires a per-game-unique player name via the login gate; finished games load the replay with no gate. The server's `addConnectedUser(gameId, userId, name)` is the single race-safe uniqueness check (synchronous map check+write); the client's `/api/play/game/:id/players` pre-check is advisory only.

**Why:** two tabs (sessionStorage → distinct userIds) can race the same cookie-prefilled name; only the synchronous server-side enrolment prevents duplicates. Colours must survive refresh/reconnect, so they are stamped onto the game-lifetime enrolment — which is never released on disconnect — at the moment it is created.

**How to apply:**
- Enrolments (`game.playerNames`, keyed by lowercased name) live for the whole game — never free a name or colour on disconnect; same userId + same name reclaims exactly.
- Colour = `PLAYER_PALETTE[arrivalIndex]` (src/shared/player-palette.ts), where `arrivalIndex` is `game.playerNames.size` at enrolment time — i.e. the enrolment sequence, the server's only authoritative arrival signal. First to join is always palette[0], second always [1]: same order ⇒ same colours, every game. The colour is NOT a function of the name; a name hash could seat two players on the palette's two closest entries as readily as its two furthest, which is exactly what used to happen.
- The palette is a fixed ORDERED list whose prefixes are the maximally-separated subsets, and every entry clears the board's own colours (fertile yellow, hazard red, food orange, selection purple, orientation-eye blue, white/black/grey). src/tests/player-palette.test.ts pins those properties — change a hex and it will tell you what you broke.
- The name cookie (`centaurPlayerName`, 1 year) holds the LAST name successfully enrolled; only update it on `game-subscribed` with an accepted name.
- `subscribe-game` must enrol BEFORE setting client.gameId/userId; a rejected name answers `enrol-error` (with `enrolledNames`) and must not become a subscribed operator.
- There is no nickname edit path anymore — the user dot is display-only.
