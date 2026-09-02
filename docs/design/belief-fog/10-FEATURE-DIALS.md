# Invisibility feature dials — every game-design decision the fog programme needs, in one table

Consolidation of the decisions scattered through docs 01/03/06/09, for the day
the owner specs the invisibility potion. Each row: the dial, the
recommendation, and the priced cost of the alternative. Nothing here is a bot
decision — these are GAME rules; the bot design (docs 00–09) runs under any
setting, but the settings move fog depth, bot complexity, and how much of the
conditioning ladder pays.

| # | dial | recommendation | alternative, priced |
|---|---|---|---|
| 1 | Item boards (food/potions) truthful under fog? | TRUTHFUL — board state is public even when an invisible unit changes it (its meal makes food vanish publicly) | Lying/stale item boards turn the item premise into a belief object of its own: refuel/tier bounds inflate board-wide, clouds saturate turns faster, the C1 channel (the strongest conditioner) dies, and invisibility strictly dominates as a strategy (03-doc §7) |
| 2 | Deaths of hidden units public? | PUBLIC — a death row un-hides (the cloud becomes a corpse) | Masked deaths force alive-conditional clouds for the full effect duration; every exclusion becomes conditional-on-alive (machinery exists — deathPossible gating — but every floor pays the width) |
| 3 | Clash/sever attribution against hidden units | PARTIAL: report the event, cell, and visible victim; redact the hidden actor's id only if multiple hidden units could have acted | Full redaction (no event) removes C1's sever-geometry rung (position + tier floor in one event); full attribution makes severs a free tracking beacon and weakens the feature |
| 4 | Hidden-unit promotion (pawn → queen) | MASKED with the rest of the unit's row — accepting that the kindSet fork returns to production duty (03-doc §6) | Publishing promotions of hidden units keeps the fork dormant (simpler bot) at the price of leaking the single most consequential hidden development |
| 5 | Invisibility × invulnerability interaction | Separate effect families, stackable; invulnerability effects on a hidden unit stay PUBLIC (tier is a contest-law input others must be able to reason about) | Hiding tier too pushes every contest involving the unit to endpoint bounds; legal but widens every floor near it |
| 6 | effectTurns of invisibility | A SWEEP AXIS from day one (the effectTurns 3/8/20 potion-value lesson: duration is the value lever) — start 4–6 | A fixed duration chosen by feel repeats the invulnerability lesson (worth less than the tempo to reach it, discovered only by sweep) |
| 7 | Who sees the pickup | EVERYONE (the pickup event and effect row are public; position goes concealed from pickup+1) | A silent pickup removes the FrozenRecord constructor (mask.hiddenUnits' lastSeenTurn) and forces existence-uncertainty — a categorically harder belief problem the design deliberately excludes |
| 8 | View storage | Per-team view docs under turns/{n} (the privateMoves precedent), written by the processor via the SHARED applyMask (05-doc §1) | Client-side masking is not masking (the full doc is world-readable today — rules:237); field-level read rules do not exist in Firestore |
| 9 | Spectator/replay access | Full record retained at turns/{n}; views are additive | Nothing — this is what keeps replays, scoring, and the reappearance-oracle audits exact |
| 10 | Own-team visibility | NEVER masked to itself (asymmetry is the feature's point) | — |

Interaction note (rows 1+7): with truthful item boards and public pickups, a
hidden unit's food/potion consumption is a TELL. That is a design feature,
not a leak — it gives the hiding player a real trade-off (concealment vs
fuel; 03-doc §3 prices it) and gives the tracking player the C1 channel that
keeps clouds from saturating. Choosing both alternatives simultaneously (rows
1-alt + 7-alt) produces a fog so deep the sound bot's honest posture is
near-permanent FOGGED-VACUOUS — playable, but the game becomes est-ordered
guesswork, which is worth knowing BEFORE choosing the rules rather than
after (09-doc §1's prerequisite exists precisely for that regime).
