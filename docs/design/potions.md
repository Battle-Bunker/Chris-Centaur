# Potions: a member that was built, measured three ways, and deleted

> "Intentionality about collecting potions — more likely when it is profitable
> for our team and the collector is not in great danger."

This is the negative-result record for that member. It is written down rather
than merely reverted because the argument for the term is a good one, the term
was cheap to build, and the next person to have the idea should get to start
from the measurement instead of from the idea.

## What the rules make a pickup worth

The pickup rule is INVERTED (`settleTurn.ts` phase 2): the collector takes
**−1**, every LIVING ally takes **+1**, and both lapse at
`turn + potionWindowTurns`. A tier does exactly one thing —
`strictMaximum` (`turnEngine.ts`) takes the highest frozen tier before it looks
at weight — so a tier is worth precisely the contests it flips.

Before the member there were two potion levers and neither could decline a
pickup on the team's behalf:

* `candidates.ts::tierRisk` (`selfDebuffOrdering`) moves a self-debuffing
  destination down the list the anytime path walks. It is an ORDERING key; it
  refuses nothing.
* `evaluate/tier.ts` prices the window a unit HOLDS, at the one cell that unit
  stands on this turn. Right for a buff in hand, nearly blind for a pickup: the
  ally's +1 is priced only if that ally happens to be standing on a contested
  square this turn, and the collector's −1 only if its own landing square is
  contested — so a unit walking onto a potion in the open paid nothing.

## The member, and what was measured

`src/lobster/evaluate/potion.ts`, seated at the end of `FEATURES` at weight 2,
identically zero on any board with potions off or none standing (asserted over
the whole law corpus, so the three potion-free scenarios were byte-identical on
every counter in both arms — verified, not assumed).

Each unit's GROUND is every cell its own grammar lets it end a turn on, from
the engine's own enumerator (`EngineSubstrate.actionsOf`) — the same set
`contestField` stamps the enemy roster onto. Against the best enemy arrival at
each of those cells the contest rule is asked twice, at the tier now and at the
tier `substrate.tiersAfterPickupBy` says settlement will leave the unit on.

    profit = min(1, Σ over allies (share of that ally's ground the +1 wins))
    peril  = the collector's own exposure once the −1 lands
    potion = (profit − 2 × peril) / |ours|

The instrument is a new runner counter, `profitablePickups`
(`src/tests/local-game.ts`): a pickup is profitable when, inside the window it
opens, an ALLY of the collector — never the collector, whose tier went DOWN —
is named in a tier-decided clash (`contest`, `edge` or `sever`) by the engine's
own `Clash.playerIDs`. That is the whole of "the pickup bought the team
something" under these rules.

Three arms, `potions`, five seeds x 30 turns, `--nodes` (deterministic):

| arm | pickups | profitable | share | tierUps | deathsWhileDebuffed | deaths | meals/100 |
|---|---|---|---|---|---|---|---|
| **A** no member (HEAD) | 29 | 8 | **27.6%** | 66 | 1 | 11 | 16.31 |
| **B1** peril as marginal flips | 36 | 10 | **27.8%** | 83 | 1 | 12 | 17.20 |
| **B2** peril as exposure | 22 | 6 | **27.3%** | 48 | 2 | 12 | 18.35 |

## The reading

**The term changes how many potions the bot takes and does not change which
ones.** The profitable share is 27–28% in all three arms; profitability tracks
the pickup count and nothing else. B2 declined seven of A's pickups, of which
five were unprofitable — 71%, against a base rate of 72%. That is the
definition of no discrimination.

The pre-registered gate was "pickups per 100 should move toward profitable ones,
`deathsWhileDebuffed` 0, `tierUps` not lower, meals not lower beyond noise". The
share did not move in either direction; `deathsWhileDebuffed` went 1 → 1 → 2.
So the member is deleted, and this file is what is kept.

### Why B1 was not the end of it

B1 priced the collector's peril as the mirror of the profit — the cells the −1
NEWLY loses. The trace said what that does: on seed 1, `red-A` took a potion on
turns 8, 16 and 22, and `red-C` on two consecutive turns, 24 and 25. The
mechanism is the rule read correctly and the wrong question asked of it. A unit
already at −1 loses every contested cell to a tier-0 enemy ALREADY, so the
marginal step to −2 flips nothing and a second pickup is charged **zero** — the
deepest hole on the board is the one a marginal reading prices free.

B2 asked the question the brief actually poses: how much of its own ground can
an enemy BEAT the collector at while it carries the debuff. Absolute, not
marginal, so a unit already in a fight is exactly the unit refused. It cut
pickups 36 → 22 and moved the share by −0.5 points.

### What a future attempt would have to fix

1. **The geometry is one turn and the liability is a window.** Both halves read
   `contestField`, which is where an enemy could end THIS turn. The debuff runs
   three. Widening only the peril half to the window's own dilation is the
   change with an argument behind it: an ally can decline a square it still
   loses, and a debuffed collector carries its −1 wherever it is pushed.
2. **The ally's ground is read from its turn-start position, not from where the
   plan puts it.** That is what makes the whole trade memoisable per collector
   per decision (one `tiersAfterPickupBy` probe, one enumerator pass), and it is
   also why the term cannot tell two plans with the same collector apart.
3. **The instrument has almost no power.** Twenty-two to thirty-six pickups over
   five seeds, six to ten of them profitable, is not a sample that could resolve
   a ten-point shift in the share. Sixty-turn runs, or a counter that records
   the enemy tier at each pickup rather than waiting for a clash to happen,
   would be the first thing to fix — before the member, not after it.

### What is kept

`profitablePickups` stays in the runner. It measures a real property of the
game, it costs nothing on a potion-free board, and it is the number any future
attempt has to move. `src/lobster/__tests__/evaluate.test.ts` keeps the `tier`
suite it always had; the potion suite went with the member.
