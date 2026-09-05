# The opponent bench — what the default plays like against somebody else

Every measurement in this repo before this document was taken against a mirror.
`docs/design/BEHAVIOUR-AUDIT.md`, `BEHAVIOUR-AUDIT-2.md`, `contest-classA.md` and
`WEIGHT-SWEEP.md` all run both sides on `DEFAULT_WEIGHTS`, so "deaths fell" meant
"deaths fell in a game where the enemy shares every one of our blind spots". The
single exception, `--opponent=material-only`, is a profile built for a different
purpose — the 1 ms reflex rung and the explicit back-out path — that happens to
be non-mirror, and it is degenerate in a specific way: it names ZERO for every
ordering term and a reach horizon of 0, so among material ties it is the search's
tie-break and nothing else. It cannot punish a mistake about food, about room or
about contest, because it cannot see any of the three.

So this document does two things. It defines a bench of opponents that can
(`src/tests/opponents.ts`), and it reports what happened when the default played
all of them (`scripts/round-robin.sh`).

**The owner's warning is the reason it exists**: do not over-optimise to mirror
self-play. Nothing here proposes a weight change on its own authority — see §5
for the one proposed change and the falsifier that would kill it.

---

## 1. The bench

Five entries, plus the one that already existed. Four are WEIGHT TABLES over the
same twelve features the production evaluator folds — same search, same
generator, same substrate, same rules — because that is the cheapest way to get a
genuinely different playing style without a second bot to maintain. One is a
policy, because no weight table can express it.

Every table passes `checkWeights` through the same `parseBotSpec` seam production
validates a stored binding with, and every weight clears the cliff inequality
`w × (the term's own constructed range) < 10 × 1` against the term's declared
range. None of them is a member of `BUILTIN_BOTS`: that catalog is the set a
stored `config_store` row may point a LIVE game at, and none of these is a bot
anybody should be able to bind a real game to by typing its name.

| arm | the table, where it differs from `DEFAULT_WEIGHTS` | what it plays like | recorded inequality broken |
|---|---|---|---|
| `material-only` | everything but `material` at 0, horizon 0 | no opinion about anything but material; the search's tie-break | — (it is a shipped profile) |
| `aggressive` | contest **0**, reach 4, command 5, room 1, energy 1, energyEconomy 0.25, kingMargin 0, food 3 | walks at enemies along its widest front; will not decline a square it loses on arrival | none in the letter — `contest` has left the ordering entirely |
| `territorial` | room **4.5**, reach 4, contest 4, food **1**, command 3 | land-grabber; maximises held ground and escape space and refuses to fight for either | **`contest < food`** — even a starving unit declines a contested meal |
| `cautious` | contest **6**, room 4.5, food **0.25**, energyEconomy 2, kingMargin 1, reach 1, command 1, tier 1, potion 0.5 | plays not to die and accepts that it will not grow | **`contest < food`**, harder: a unit at 1 health starves rather than take a contested meal |
| `glutton` | food **9**, contest 0.5, energy 0.5, reach 0.5, room 0.5, momentum 0.5, tier 0.5, potion 0.5, kingMargin 0 | takes a contested meal at full health from a heavier enemy | `contest < food` holds in the letter (0.5 < 9) and is inverted in spirit; `energy`'s hold-versus-move relation (`w × cost > 0.5`) becomes unreachable |
| `random-legal` | **not a table** — uniform over each unit's own legal action set, no evaluator call | the floor of competence | n/a |

`reachHorizonTurns`, the `command` knobs and `energyReserveRatio` are the
production values on all four tables, deliberately: the bench is a sweep over the
weight table and nothing else, so a difference between two arms is a difference in
what the opponent VALUES and never a difference in how far it can see.

### Why `random-legal` is a policy and not a table of zeros

A profile with every weight at zero still runs the search, and the search still
returns the generator's ordered first offer. That is a systematic policy —
`seedKept` would read 100% and the play would be whatever `candidates.ts` happens
to order first — and it is not random at all. The only way to get uniform play is
to not consult the evaluator, so `random-legal` is a switch in `runGame`'s
opponent branch (`randomLegalDecision`), reachable only for a team that is not the
decider's, drawing from `legalTargets` — the grammar's own answer, masked by the
perimeter, by occupancy and by the pawn-target set — and from a generator seeded
separately from the game's, so it cannot move the food or potion respawn schedule.
Each unit draws independently: it is uniform over the product of the units' own
action sets, not over coordinated joint plans, and it has no plan at all, which is
the point.

**It is the floor every other number is read against.** A class where the
default's margin over `random-legal` is small is a class where the default's
*search* is not buying much, whatever the weights say — a different defect with a
different repair.

---

## 2. How the round robin is measured

    npx tsc -p . && npm run round-robin -- --out .round-robin
    npm run round-robin:report -- .round-robin --md

`mixed`, `snakes`, `potions` and `sparse`, seeds 1–6, 60 turns, `--nodes` at the
calibrated 550, so every counter is a function of (build, class, seed, arm, seat)
and nothing else. `sparse-lean` is left out: it is `sparse` with a leaner meal and
has never recorded a death or a contest, so it would add 84 games and no
distinguishing power.

**Both seats, always.** `--decider=N` says which team keeps the default profile.
A matchup measured from one seat is a fact about that seat: `mixed` gives red a
snake, a pawn and a knight and blue a snake, a queen and a pawn; the food is not
placed symmetrically; and the turn loop decides teams in ALPHABETICAL order, so
blue moves before green moves before red at every turn. Seat 0 is byte-identical
to every run taken before the swap existed.

**The outcome column is WEIGHT AT THE CAP.** `git fetch origin` finds no
win/draw/loss counter on any branch — the endgame worker's outcome counter has
not landed — and every game here runs to the turn cap and stops, so there is no
adjudicated result to report. The proxy is the total occupancy of the units still
standing when the cap stopped the game, per side, which is the same number
`substrate.ts` reads a unit's material off. Material is what the game is won with
and the only quantity the cliff is denominated in.

It is reported as a **share**, `ours / (ours + theirs)`, and never as a
difference, because `mixed`, `snakes` and `potions` seat ONE default against TWO
opponents and a raw difference there is negative for a bot that is winning. The
baseline is the **mirror arm's own share on the same class and the same seat** —
not ⅓, and not ½ on `sparse`: the seats are not symmetric and the mirror's own
share is not the roster fraction. `Δ` is the matchup's share minus that baseline,
and it is the only column that answers "did the default do better or worse than it
does against itself".

`wiped them` / `wiped us` count the seeds that ended with one side holding no
living unit — the only unambiguous outcomes the corpus contains.

---

## 3. The matchup table

<!-- ROUND-ROBIN-TABLE -->

---

## 4. What the games say

<!-- FINDINGS -->

---

## 5. The proposed change, and what would kill it

<!-- PROPOSAL -->

---

## 6. Which arm should join the standing gate

<!-- GATE -->
