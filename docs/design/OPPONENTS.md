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

**Both seats, always.** `--side=N` says which team keeps the default profile —
and `--decider=N`, the name this bench and `scripts/round-robin.sh` were written
against before the endgame instrument landed the same option, is an ALIAS for it:
same slot, same `side` field on the wire, refused if it disagrees with an
explicit `--side`. One seat index, one spelling in the JSON.
A matchup measured from one seat is a fact about that seat: `mixed` gives red a
snake, a pawn and a knight and blue a snake, a queen and a pawn; the food is not
placed symmetrically; and the turn loop decides teams in ALPHABETICAL order, so
blue moves before green moves before red at every turn. Seat 0 is byte-identical
to every run taken before the swap existed.

**And that last sentence is checked, not asserted.** `sum all 60 3 --nodes` — the
five scenarios, seeds 1–3, no `--opponent` and no `--decider` — run on this build
and on `a4583a4` (the commit before the bench existed) and compared with
`scripts/ab-compare.js` is ALL-ZERO on every metric and every board, with the
cross-board count reading `up on 0/5, down on 0, flat on 5`. Field for field, the
two builds' JSON summaries differ in exactly fourteen keys, and all fourteen are
the side split this branch ADDED (`oursMeals`, `theirsDeaths`, `oursWeight`, …).
Every field both builds carry is identical. The bench, the policy switch and the
colour swap are reachable only through `--opponent` and `--decider`, and a run
that passes neither takes the path it always took.

**The outcome column is WEIGHT AT THE CAP, and the corpus predates the counter
that would replace it.** When these 336 games were played, `git fetch origin`
found no win/draw/loss counter on any branch; the endgame worker's `adjudicate`
instrument (`metrics.outcome`: result, kind, winners, `weightByTeam`, lead,
`sharePar`, and a lead trajectory) landed in the merge AFTER the sweep, and the
merge also changed the bot — the working head's engine and evaluator commits move
play on `mixed` seed 3, so this corpus is a snapshot of `4681263`'s build and not
of the current one. §6 says what to do about that, and it is the first thing the
next worker on this row should do. Every game here runs to the turn cap and
stops, so at the time there was no
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

336 games: 4 classes × 7 arms × 2 seats × 6 seeds, 60 turns, `--nodes=550`, one
`RunSummary` per game under `.round-robin/<class>__<arm>__seat<N>.jsonl`. The
`mirror` row is the control; `Δ vs mirror` is this arm's weight share at the cap
minus the mirror's own share **on the same class and the same seat**.

`ourDeaths`/`theirDeaths`, `ourMeals`/`theirMeals`, `ourSeed%`/`theirSeed%` and
the share are the side split (`oursX`/`theirsX`), so "ours" is always the decider
team and "theirs" is every other team pooled. `wiped them`/`wiped us` count the
seeds that ended with one side holding no living unit.

### `mixed`

| arm | seeds | ourDeaths | theirDeaths | ourMeals | theirMeals | ourSeed% | theirSeed% | share | Δ vs mirror | seat0 Δ | seat1 Δ | wiped them | wiped us |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mirror | 12 | 13 | 15 | 352 | 540 | 45.3 | 43.9 | 0.384 | — | — | — | 0 | 0 |
| material-only | 12 | 14 | 34 | 402 | 321 | 39.6 | 69.2 | 0.568 | +0.184 | +0.185 | +0.168 | 0 | 0 |
| random-legal | 12 | 1 | 60 | 189 | 16 | 38.4 | 0.0 | 1.000 | +0.616 | +0.859 | +0.373 | 12 | 0 |
| glutton | 12 | 14 | 25 | 341 | 570 | 45.1 | 44.7 | 0.386 | +0.002 | +0.035 | -0.001 | 0 | 0 |
| aggressive | 12 | 15 | 33 | 363 | 426 | 44.0 | 44.3 | 0.475 | +0.091 | +0.026 | +0.128 | 0 | 2 |
| territorial | 12 | 16 | 26 | 348 | 517 | 43.8 | 44.2 | 0.406 | +0.022 | +0.023 | +0.020 | 0 | 0 |
| cautious | 12 | 13 | 31 | 380 | 500 | 45.9 | 46.5 | 0.456 | +0.072 | +0.068 | +0.090 | 0 | 0 |

### `snakes`

| arm | seeds | ourDeaths | theirDeaths | ourMeals | theirMeals | ourSeed% | theirSeed% | share | Δ vs mirror | seat0 Δ | seat1 Δ | wiped them | wiped us |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mirror | 12 | 10 | 22 | 215 | 419 | 56.5 | 58.1 | 0.356 | — | — | — | 0 | 2 |
| material-only | 12 | 4 | 29 | 275 | 140 | 57.2 | 88.4 | 0.684 | +0.328 | +0.375 | +0.280 | 2 | 0 |
| random-legal | 12 | 0 | 48 | 22 | 0 | 34.3 | 0.0 | 1.000 | +0.644 | +0.695 | +0.593 | 12 | 0 |
| glutton | 12 | 10 | 24 | 238 | 452 | 57.4 | 61.5 | 0.364 | +0.008 | +0.020 | -0.007 | 0 | 0 |
| aggressive | 12 | 8 | 13 | 183 | 325 | 54.8 | 53.5 | 0.332 | -0.024 | +0.010 | -0.065 | 0 | 2 |
| territorial | 12 | 10 | 14 | 177 | 328 | 54.8 | 53.2 | 0.316 | -0.040 | +0.033 | -0.111 | 0 | 1 |
| cautious | 12 | 5 | 15 | 206 | 336 | 54.0 | 54.3 | 0.393 | +0.037 | +0.082 | -0.009 | 1 | 0 |

### `potions`

| arm | seeds | ourDeaths | theirDeaths | ourMeals | theirMeals | ourSeed% | theirSeed% | share | Δ vs mirror | seat0 Δ | seat1 Δ | wiped them | wiped us |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mirror | 12 | 9 | 19 | 362 | 562 | 45.2 | 43.1 | 0.402 | — | — | — | 0 | 0 |
| material-only | 12 | 12 | 28 | 409 | 311 | 42.8 | 71.6 | 0.549 | +0.147 | +0.026 | +0.242 | 0 | 0 |
| random-legal | 12 | 2 | 57 | 285 | 18 | 39.0 | 0.0 | 0.976 | +0.574 | +0.758 | +0.391 | 9 | 0 |
| glutton | 12 | 19 | 19 | 331 | 571 | 41.6 | 43.3 | 0.362 | -0.040 | -0.053 | -0.005 | 0 | 1 |
| aggressive | 12 | 14 | 21 | 342 | 532 | 43.3 | 43.4 | 0.387 | -0.016 | -0.033 | -0.001 | 0 | 1 |
| territorial | 12 | 18 | 23 | 346 | 503 | 45.7 | 42.1 | 0.402 | +0.000 | -0.075 | +0.084 | 0 | 2 |
| cautious | 12 | 15 | 22 | 349 | 501 | 46.0 | 44.5 | 0.410 | +0.007 | -0.039 | +0.030 | 0 | 0 |

### `sparse`

| arm | seeds | ourDeaths | theirDeaths | ourMeals | theirMeals | ourSeed% | theirSeed% | share | Δ vs mirror | seat0 Δ | seat1 Δ | wiped them | wiped us |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mirror | 12 | 0 | 0 | 101 | 101 | 44.7 | 44.7 | 0.500 | — | — | — | 0 | 0 |
| material-only | 12 | 1 | 1 | 140 | 12 | 42.8 | 99.3 | 0.715 | +0.215 | +0.165 | +0.264 | 0 | 0 |
| random-legal | 12 | 0 | 24 | 7 | 0 | 35.3 | 0.0 | 1.000 | +0.500 | +0.468 | +0.532 | 12 | 0 |
| glutton | 12 | 2 | 2 | 109 | 97 | 46.9 | 42.9 | 0.518 | +0.018 | -0.005 | +0.041 | 0 | 0 |
| aggressive | 12 | 1 | 2 | 97 | 54 | 47.0 | 39.6 | 0.587 | +0.087 | +0.111 | +0.066 | 0 | 0 |
| territorial | 12 | 1 | 1 | 93 | 39 | 43.2 | 37.9 | 0.600 | +0.100 | +0.094 | +0.107 | 0 | 0 |
| cautious | 12 | 0 | 0 | 92 | 43 | 45.9 | 41.9 | 0.588 | +0.088 | +0.083 | +0.094 | 0 | 0 |

Two readings the table cannot show, printed by the report on their own:

```
=== seats that disagree in sign (the pooled row is not a matchup result) ===
  mixed vs glutton: seat0 +0.035, seat1 -0.001
  snakes vs glutton: seat0 +0.020, seat1 -0.007
  snakes vs aggressive: seat0 +0.010, seat1 -0.065
  snakes vs territorial: seat0 +0.033, seat1 -0.111
  snakes vs cautious: seat0 +0.082, seat1 -0.009
  potions vs territorial: seat0 -0.075, seat1 +0.084
  potions vs cautious: seat0 -0.039, seat1 +0.030
  sparse vs glutton: seat0 -0.005, seat1 +0.041

=== matchups the default is BEHIND its own mirror on (share Δ < 0) ===
  mixed seat1 vs glutton: -0.001      snakes seat1 vs glutton: -0.007
  snakes seat1 vs aggressive: -0.065  snakes seat1 vs territorial: -0.111
  snakes seat1 vs cautious: -0.009    sparse seat0 vs glutton: -0.005
  potions seat0 vs glutton: -0.053    potions seat1 vs glutton: -0.005
  potions seat0 vs aggressive: -0.033 potions seat1 vs aggressive: -0.001
  potions seat0 vs territorial: -0.075
  potions seat0 vs cautious: -0.039
```

### What is instrumented per side, and what is not

Only six counters are split: `meals`, `deaths`, `unitTurns`, `seedKept`, `weight`
at the cap and `survivors`. `deathsByCause`, `enemyOccupiedEntries[Lost]`, the
entrapment counters and every potion counter are **board-wide** — they are a sum
over both players and they move when either one changes. Every claim in §4 is
made from the split counters; where a board-wide number is quoted it is named as
board-wide and carries no attribution. That gap is the largest single limitation
of this corpus and §6 says what to do about it.

---

## 4. What the games say

### 4.1 The floor is a long way down, and it is nearest on `potions`

The default wipes `random-legal` out on 12/12 seeds of `mixed`, `snakes` and
`sparse` and holds share 1.000 on all three. Whatever else is true, the search
and the fold together are worth an enormous amount against no policy at all.

The one class where the floor is closer is `potions`: 9/12 wipes and share 0.976,
and two of our own deaths where the other three classes give up 0 or 1. It is the
first of four separate signs in this corpus that `potions` is where this bot is
weakest, and the only one visible without an opponent that plays well.

### 4.2 `material-only` was a soft opponent, and every earlier claim rests on it

`material-only` hands the default +0.147 to +0.328 of share on every class — the
largest margins in the table after `random-legal`. It is not a control for
anything except "does the fold do something at all". `theirSeed%` says why: it
keeps the generator's first offer on 69–99% of its unit-turns, because with every
ordering weight at zero the search has nothing to reorder with. Any claim in this
repo whose evidence is a win over `material-only` should be read as unproven
against a player with opinions.

### 4.3 No fixed table beats the default outright — two beat it on one class

Across four classes and both seats there is no arm that is ahead of the default
everywhere, and no arm that is ahead of it on more than one class. Three of the
five bench entries lose to the default on all four classes from both seats.

Two are ahead on exactly one class, from **both** seats, which is what makes them
matchup results rather than seat results:

| arm | class | pooled Δ | seat 0 | seat 1 |
|---|---|---|---|---|
| `glutton` | `potions` | **−0.040** | −0.053 | −0.005 |
| `aggressive` | `potions` | −0.016 | −0.033 | −0.001 |

and both of them lose to the default on `mixed`, `snakes` and `sparse`. So the
finding is: **the default is not beaten outright by any fixed weight table, and
it is beaten on `potions` by the two tables that price food or aggression above
the arrival-turn verdict.**

Everything else in the "behind" list is one-seated and reverses at the other
seat — `snakes` vs `territorial` is −0.111 at seat 1 and +0.033 at seat 0,
`potions` vs `territorial` is −0.075 at seat 0 and +0.084 at seat 1 — and a
matchup that changes sign with the colour is a fact about the colour.

### 4.4 The weakest matchup: `potions` vs `glutton`, and its mechanism

It is the largest two-seat-consistent loss in the corpus, and the share
understates it badly. The side-split deaths:

| `potions` | our deaths | their deaths | our weight | their weight | share |
|---|---|---|---|---|---|
| seat 0 vs mirror | 7 | 7 | 85 | 350 | 0.195 |
| seat 0 vs `glutton` | **10** | 7 | 66 | 398 | 0.142 |
| seat 1 vs mirror | 2 | 12 | 265 | 170 | 0.609 |
| seat 1 vs `glutton` | **9** | 12 | 255 | 167 | 0.604 |

**The opponents die exactly as often as the mirror's opponents do — 7 and 12,
unchanged at both seats — and the default dies three and seven more times.** All
of the extra dying is ours. At seat 1 the weight share moves −0.005, which is
noise, while our deaths go from 2 to 9: the share proxy is under-reading the
damage by a factor the owner's own rule cares about most, because deaths are the
currency and meals and territory are what may be spent.

The mechanism is the recorded `contest < food` relation being exercised by
somebody else. `calibration.ts` sets `contest` (3) under `food` (4), whose pull
reaches 1 for a starving unit, precisely so "a hungry unit still takes a contested
meal and a healthy one declines it". `glutton` names `food` 9 against `contest`
0.5, so it is at the contested meal in far more turns than a mirror opponent is —
and the default's own licence to take a contested meal is therefore exercised far
more often, against a player that is not going to give way. Board-wide, the
class's `contest` deaths go from 12 (mirror) to 16 at seat 1, and five `edge`
deaths — a head-on exchange lost — appear at seat 0 where the mirror has none.

The limit of the claim, stated rather than glossed: `deathsByCause` is board-wide,
so "our extra deaths are contest deaths" is an inference from the side-split
totals plus the board-wide causes, not a measurement. §6 names the counter that
would settle it.

### STATUS — THE MECHANISM ABOVE IS REFUTED BY THE TRANSCRIPTS (`glutton-class`)

**Read the games before re-deriving anything from this section.**
`docs/design/GLUTTON-CLASS.md` §1 reads all nineteen of our deaths in the twelve
`glutton` games and all nine in the mirror control, at the death turn and back to
the last turn `contest` said anything at all, with a per-candidate `explainPlan`
vector against the plan the search chose.

**Not one of the 19 is a unit taking a contested meal.** The staged destination
held a meal on none of them; the dying unit's hunger scale runs 0.00–0.26, so
every one is between 74% and 100% of its maximum energy, and there is not one
starvation death in the 24 games. `food`'s per-option spread at the death turn is
0.00–0.16 against `contest`'s 0.00–1.00. The `contest < food` licence is
exercised in ZERO of the extra deaths, and the paragraph above — an inference
from the board-wide cause counters, as it says — does not survive.

What the deaths ARE: 12 of 19 are `contest-gap.md`'s class B (every offered
option beaten, the member FLAT across all of them), 4 forced, 1 outranked by a
search that ranked its own choice 5th of 9, 2 other; and 17 of 19 took a square
the member read as FREE and were inside a closed fan one ply later. **The
mirror's nine deaths are the same shape, 9 of 9.** `glutton` opens no new class.
It produces more of the one `contest-gap.md` §2 already named and already failed
to close, because it out-eats us five to one at seat 0 and every meeting the
mirror gives us a capture in it gives the kill.

§5's proposed change is unaffected by this — it is about
`enemyOccupiedEntriesLost`, not about food — but its stated motive ("squares
whose arrival-turn verdict was already lost when the move was staged") should be
read against GLUTTON-CLASS §1.3: at the death turn every offered option is
already lost on 12 of 19, so a veto there has nothing left to choose between.

§6's gate proposal STANDS and is strengthened: the two seats' death counts on
this build are 10 (seat 0) and 9 (seat 1), reproduced, and `glutton` on
`potions` remains the only two-seat-consistent loss. `mixed` (9→10, 4→4) and
`snakes` (6→5, 4→5) move inside the seed noise, so the class is `potions` alone.

One rule was built against the corrected diagnosis and REFUSED at three doses —
the contested-meal discount, `GLUTTON-CLASS.md` §2. It closes the seat-1 finding
outright (our deaths 9 → 2, the mirror's own number) and it is refused because
mirror deaths rise on `mixed` and `potions` at every dose and the meals bill runs
to −37%.

**Why the mirror could never have found this.** Against a mirror, both sides hold
`contest < food` on the same numbers, so both sides decline and take the same
contested meals and the deaths split evenly (7/7 at seat 0). The relation only
costs something when the opponent's ratio is different from ours, and a mirror
opponent's never is.

### 4.5 The `snakes` mirror baseline is inflated by the mirror's own blunders

`snakes` is the class where the biggest one-seat losses live, and the reason is
in the control rather than the matchups. The mirror arm's six games produce 16
deaths, **seven of them `self`** — a unit walking into its own body. The same six
seeds against `territorial` produce 11 deaths, two of them `self`; against
`aggressive` at seat 1, six deaths and none.

So a large part of the default's weight share against its own mirror on `snakes`
is a dividend on deaths its clone inflicts on itself, and it does not transfer to
an opponent that does not make them. It is not that the default plays `snakes`
badly against `territorial`; it is that the baseline it is being read against is
too kind. This is the single clearest illustration of the owner's warning that
mirror self-play is not a measurement, and it argues for the mirror baseline being
retired on this class rather than for any weight change.

### 4.6 The seat effect is larger than every matchup effect on `potions`

The mirror's own share on `potions` is 0.195 at seat 0 and 0.609 at seat 1 — a
gap of 0.414, ten times the largest matchup Δ on that class. `mixed` is the same
shape (0.242 / 0.627). Any future `potions` or `mixed` claim taken from one seat
is worth nothing; both seats or nothing. The colour swap earned its place here.

---

## 5. The proposed change, and what would kill it

**One weakness class emerged**: on `potions`, against an opponent whose
`food`-to-`contest` ratio is far above the default's, the default's own deaths
rise while the opponent's do not, and the extra deaths are concentrated in the
board-wide `contest` and `edge` causes — squares whose arrival-turn verdict was
already lost when the move was staged.

**Proposed change.** A staged destination that `winsContest` says we lose at the
turn we arrive is not an ordering question; it is a terminal outcome, and
`calibration.ts` already says how those are handled: *"Terminal outcomes need no
protection at all, because DEAD is a lattice bottom applied by replacement and
never by addition."* The `contest` term instead prices that case by ADDITION, at
weight 3, where the `food` term is licensed to reach 4 — so a certain loss is
being traded against a meal. The proposal is to move that ONE sub-case, `lost` in
the `enemyOccupiedEntriesAt` sense (enemy's turn-start head cell, `winsContest`
false at current tier and weight), out of the additive fold and into the same
replacement path `DEAD` uses, and to leave the `contest` weight and every other
sub-case exactly as they are. It is not a weight change and it does not touch the
recorded `contest < food` relation: a hungry unit still takes a contested meal it
can survive.

**What would kill it**, in the order it should be checked:

1. **The diagnosis.** Run `potions`, both seats, vs `glutton` and `aggressive`.
   If the board-wide `enemyOccupiedEntriesLost` does not fall to near zero, the
   change did not do what it says and the losses are not staged-into-a-known-lost
   square — they are arrival-order effects the turn-start board cannot see, and
   the repair is somewhere else entirely.
2. **The point of it.** If `enemyOccupiedEntriesLost` falls but OUR deaths on
   `potions` vs `glutton` do not fall below 10 (seat 0) and 9 (seat 1), the
   contested entries were not the death channel: the bot is simply dying
   somewhere else and the change buys nothing. Revert it.
3. **The cost.** `enemyOccupiedEntries` is an OPPORTUNITY, not a blunder —
   BEHAVIOUR-AUDIT D1 says taking a square off a lighter enemy is a capture — so
   if entries fall by more than the lost ones do, the veto is too wide and is
   refusing captures. Revert it.
4. **The rest of the corpus.** If our deaths rise on any of `mixed`, `snakes` or
   `sparse` against ANY arm including the mirror, revert it. Deaths are the
   currency.

Nothing here is proposed on this document's own authority: it is one hypothesis
with four ways to fail, and it is written down so that the next worker can kill it
cheaply rather than inherit it.

---

## 6. Which arm should join the standing gate

**`glutton`, on `potions`, both seats.** It is the only arm that beats the
default from both seats of a class, it reaches the default through a RECORDED
inequality (`contest < food`) rather than through a seat asymmetry, and it costs
two cells — twelve games, about ten minutes — which is affordable on every run.

The gate should assert two things, and the second matters more than the first:

* **our deaths** on `potions` vs `glutton`, both seats, at or below today's 10
  (seat 0) and 9 (seat 1). This is the number the matchup actually moved.
* **the weight share** at or above today's 0.142 / 0.604, as a coarse guard only.
  §4.4 is the reason it is second: at seat 1 the share moved −0.005 while the
  deaths more than quadrupled, so a share-only gate would have slept through the
  whole finding.

Two arms it should NOT be. `random-legal` is a floor and not a gate: a regression
would have to be enormous to move it, and the one class where it is informative
(`potions`, 9/12 wipes) is the class `glutton` already covers. `territorial` is
the most interesting player on the bench and the worst gate, because its result
changes sign with the seat on both classes it is interesting on.

**Re-run the sweep first.** The outcome counter this document says it lacks has
now landed, and the merge that brought it also moved the bot's play. Both facts
point the same way: the table above is a snapshot of the build it was taken on,
`npm run round-robin -- --out .round-robin --force` re-takes it, and the W/D/L
the runner now prints is a stronger reading than weight at the cap on every row.
§4.4 is the reason to keep the death columns anyway: at seat 1 the share moved
−0.005 while our deaths quadrupled, and a win rate could hide that too.

**Two follow-ups this corpus asks for and cannot do itself.** First, split
`deathsByCause` and `enemyOccupiedEntries[Lost]` by side; today they are
board-wide, and §4.4's mechanism is an inference rather than a measurement
because of it. Second, when the `endgame` worker's win/draw/loss counter lands,
re-run the sweep — the outcome column here is weight at the cap because there was
no adjudicated result to report when it was taken, and §4.4 is a live
demonstration that share and deaths can point in different directions.
