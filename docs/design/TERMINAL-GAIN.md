# TERMINAL-GAIN — reading the four deaths, and the two knobs the member does not have

`docs/design/TERMINAL-SOUND.md` §4.2 closed with a number and a caveat:

> **Four deaths across 40 games, all of them `contest`, all on the two
> piece-bearing classes.** … **This is reported, not tuned.**

This row is the tuning pass that number licensed. It asks two questions —
*is the end priced too keenly (the gain), or is it the wrong shape (a step at
the cap where a ramp over the last N turns belongs)* — and the first thing it
found is that the four deaths are not ours.

---

## 1. The four deaths, read one at a time

### 1.1 The reproduction

The A/B is TERMINAL-SOUND §4.1's, re-recorded here so the deaths can be
attributed rather than counted: **A** = the capless head `488b76a`, **B** = the
head with the cap live (`ef8696a`), 60 turns, `--nodes`,
`--opponent=material-only`, `--side=0` and `--side=1`,
`mixed`/`snakes`/`sparse`/`sparse-lean` seeds 1–3 and `potions` seeds 1–8: 40
games an arm, one game at a time. `ab-compare.js`'s outcome section reproduces
§4.1 exactly — `deltaWinRate` flat on 10/10 arms, `deltaLead` up on 4, down on
1 (`potions/side=1` −2.13), flat on 5 — so this is the same experiment and not
a near neighbour of it.

Board-wide deaths reproduce too: **95 → 99, +4.**

### 1.2 The split the summary counter cannot make

`deathsByCause` in the JSON summary is a BOARD-WIDE count. It pools the units we
lose with the units we kill, and at the turn cap those two move in opposite
directions. Split by team — ours is `outcome.team`, and every `DEATH` line in
the trace carries the team that owns the unit:

| | A (capless) | B (cap live) | Δ |
|---|---|---|---|
| **our** deaths, 40 games | 26 | **25** | **−1** |
| **their** deaths, 40 games | 69 | **74** | **+5** |
| board-wide (what §4.2 counted) | 95 | 99 | +4 |

**The sign reverses.** The cap-aware bot loses one unit fewer and kills five
more. There is no keenness to price down.

### 1.3 Every death that moved, and when

Eight deaths move across the 40 games. Every one of them is on turn **59 or 60**
of a sixty-turn game — the cap turn or the turn before it — and every one is
`contest`. Nothing at all moves before turn 50: the per-decade lead trajectories
of all 40 games are identical through `turn: 50` and differ only at `turn: 60`.

| game | ours | Δ death | turn | unit | cells | lead A → B |
|---|---|---|---|---|---|---|
| `mixed` 1 side 0 | red | **−** green-A | 60 | theirs | 5 | +4 → **+2** |
| `mixed` 1 side 1 | blue | **+** red-C | 60 | theirs | 1 | +45 → **+53** |
| `mixed` 3 side 0 | red | **+** blue-A | 59 | theirs | 6 | −20 → **−14** |
| `mixed` 3 side 0 | red | blue-C moved 60 → 59 | 59 | theirs | 1 | — |
| `potions` 1 side 1 | blue | **+** green-B | 60 | theirs | 1 | +49 → **+53** |
| `potions` 2 side 0 | red | **+** blue-C | 59 | theirs | 1 | −14 → **−9** |
| `potions` 3 side 0 | red | **−** red-A | 60 | **OURS** | **15** | −29 → **−14** |
| `potions` 5 side 0 | red | **+** blue-A | 60 | theirs | 7 | −41 → **−32** |
| `potions` 6 side 0 | red | **+** blue-C | 59 | theirs | 1 | −36 → **−32** |

Read down the "ours" column: **six deaths are added and all six are enemy
units; two are removed and one of those is the only unit of ours that moves at
all** — `potions` seed 3 side 0, a fifteen-cell snake that used to die at turn
60 in a `contest` and now does not. That game is also the largest lead move in
the whole table (+15) and the arm TERMINAL-SOUND §4.1 singles out as the only
significant result it has (`potions/side0` +4.75, sign 8/0, p = 0.008). The two
are the same event.

The lead improves on seven of the eight games. The one that does not is
`mixed` 1 side 0: a win either way, +4 → +2, where we no longer kill a
five-cell green-A on the last turn.

### 1.4 The classification

The brief offered three classes — a keen gain at a comfortable lead, a ramp that
starts too late or too early, or a `possibleWinners` shape making a coin-flip
look like a win. **The deaths are none of the three.** They are an attribution
artefact of a board-wide counter, and the behaviour underneath is the one
TERMINAL-SOUND §4.2 named and could not sign:

> That is the shape of a bot that has started to CONTEST near the boundary: at
> the cap, weight is the score, a trade that is even on material is a win if it
> leaves us heavier, and a bot that could not see the cap declined it.

Measured per team, those trades come out five-for-one in our favour, on the two
classes that carry pieces, on the last two turns, with outcomes flat on all ten
arms and the lead better on four of them and worse on one.

**Two of the three offered classes could not have been found here anyway**, and
that is §2.

---

## 2. There is no gain, and the ramp is not a weight

### 2.1 The gain does not exist, and building one is a refused change

`model/terminal@1` has no weight, no multiplier and no entry in
`DEFAULT_WEIGHTS`. It does not enter the fold at all: it is not a feature, it
never appears in `parts`, and `finish` REPLACES the fold's ends with lattice
elements (`bound.ts`, `clampTo`). `capVerdicts` returns one of four verdicts and
`finish` turns them into `DEAD` = −∞ and `WIN` = +∞ and nothing else.

So "turn the gain down" means "make DEAD a large finite number", and that is a
change this repo has already made, measured and refused — `calibration.ts`
calibration fact 3, and `bound.ts`'s own header:

> A large finite death penalty inverts the cliff the moment some other term
> outgrows it (a 40×40 room count exceeding −1000 did exactly that), and it
> makes terminal states tradeable against material, which they are not.

A finite terminal would also break the fold's contract in a checkable way rather
than a stylistic one: the cliff inequality (`CLIFF_MATERIAL_WEIGHT`) is stated
as "terminal outcomes need no protection at all, because DEAD is a lattice
bottom applied by replacement and never by addition", and every ordering term's
weight is calibrated against that sentence. **A gain knob is not swept here
because it is not a knob; it is the removal of the lattice.**

### 2.2 What a "ramp over the last N turns" can be, and what it cannot

The member has no weight to ramp, so the only ramp the shape admits is a
**window**: how many turns before the cap the member is allowed to speak at all.
That is a real knob and it is sound at every setting, which is not obvious and
is worth stating exactly.

`capVerdicts`' first line is a COST gate and not a soundness gate:

```ts
const limit = ctx.sub.marshalled.maxTurns;
if (limit === null || ctx.sub.arrivalTurn < limit) return NO_CAP;
```

The corner derivations below it (TERMINAL-SOUND §2.1) use only one fact about
the board — `ended(kinds)`, *no world this settlement admits leaves the game
running* — and never `arrivalTurn >= limit`. The turn test is there because "the
evaluator runs tens of thousands of times per decision and this member must cost
nothing on every board but the last one". So widening the window cannot make the
member unsound; it can only make it look at boards where `ended` is almost
always false and pay for the look.

**And that is why a ramp cannot do what the brief hoped for.** Before the cap
the game has not ended on the count, `adjudicate` returns `continues`, `ended`
is false, and the member abstains — at every window width. The only pre-cap
boards it can speak on are the ones that have ended some OTHER way (a wipe),
and those are `terminalVerdicts`' own, checked first in `finish`, reading the
same adjudication. A window is therefore a knob whose dose is measured below and
whose predicted effect is *nothing*: there is no sound reading of the boundary
at turn 55 of a 60-turn game, because at turn 55 the game does not end.

`§3` measures the window rather than arguing it.

---

## 3. The sweep — one knob, three widths, and a knob that changes nothing

### 3.1 What was built

`TERMINAL_READ_AHEAD_TURNS` (`calibration.ts`), read by one subtraction in
`capVerdicts`' turn gate:

```ts
if (limit === null || ctx.sub.arrivalTurn < limit - READ_AHEAD_TURNS) return NO_CAP;
```

Zero is the head's behaviour exactly. `CENTAUR_TERMINAL_READ_AHEAD` overrides
it per process — read once at module load, because a `process.env` lookup on
the hot path of every leaf was measured at 1.4% of self time for the
`royalReachers` flag next door — so the sweep is three runs of one build rather
than three builds. A negative or non-integer width is refused at load: it is the
one direction that could narrow the window PAST the cap and leave an ended board
scored by the interior fold, which is `ENDGAME.md` §1's hole. The corner
derivations and the bound algebra are untouched — `git diff 119b23c --
src/lobster/evaluate/terminal.ts` is empty in the shipped tree, and was empty
below the gate line while the knob was in.

The build is `e8d7193`. It is not in the tree; §3.5 says why.

### 3.2 The corpus, three widths

40 games an arm, one at a time: 60 turns, `--nodes`, `--opponent=material-only`,
`--side=0` and `--side=1`, `mixed`/`snakes`/`sparse`/`sparse-lean` seeds 1–3 and
`potions` seeds 1–8. Plus the twenty `long` arms — `mixed` to 120 turns, seeds
1–10, mirror and `material-only` — at the widest setting.

| | W = 0 (head) | W = 4 | W = 12 |
|---|---|---|---|
| games whose TRACE differs from W = 0 | — | **0 / 40** | **0 / 40** |
| games whose SUMMARY differs from W = 0 | — | **0 / 40** | **0 / 40** |
| `long` arms whose trace differs from W = 0 | — | not run | **0 / 20** |
| nodes, 40 games | 2,389,043 | 2,389,043 | 2,389,043 |
| reads, 40 games | 89,695,954 | 89,695,954 | 89,695,954 |
| slices, 40 games | 1,232,915 | 1,232,915 | 1,232,915 |
| law sweep `terminal.lo` / `terminal.hi` | 0 / 0 | — | **0 / 0** |
| law sweep everything else | `totalLo=0 totalHi=9`, seven classes | — | unmoved |
| `long` games with `crashed != null` | 0 / 20 | — | **0 / 20** |

Byte-identical means byte-identical: every `DEATH`, every `top3`, every counter,
every outcome and every lead, at both widths, on every class. The only lines
that differ anywhere in 100 recorded games are the wall-clock fields, and those
are noise on a machine shared with eight other workers — the summed
`worstDecisionMs` over the 40 games is 39.0 s at W = 0, 26.2 s at W = 4 and
29.7 s at W = 12, i.e. the *narrowest* setting timed slowest, which is the clock
saying it cannot resolve this.

So there is no outcome table to print per width, and no per-class death table
either: **W/D/L, lead and deaths are the same numbers three times.** The keep
gate is met at every width and discriminates nothing, which is the result.

### 3.3 Why it is inert, and why that is a proof rather than a shrug

The window moves the COST gate. Every corner below it derives from `ended` —
"no world this settlement admits leaves the game running" — and a board short of
its limit has not ended on the count, so `adjudicate` returns `continues`,
`ended` is false, and the member abstains for that reason instead of for the
turn count. `src/lobster/__tests__/terminal-window.test.ts` asserts both halves,
and it asserts the second on the `OutcomeBracket` itself: one, three and ten
turns short of a STATED limit, `possibleKinds` contains `continues`; at the
count it does not. That is a fact about what `settlePartial` reports, so it
holds whatever `terminal.ts` chooses to read, and it is what makes "no width
could have changed the answer" a proof and not a sweep artefact.

The only pre-cap boards a wider window can reach are the ones that ended some
OTHER way — a wipe — and those are `terminalVerdicts`' own, checked FIRST in
`finish`, reading the same `adjudicate`. Whatever the window is set to, the
answer is either the same one or none.

### 3.4 The verdict

**REVERT.** Neither knob the brief named survives contact with the member:

* **The gain does not exist and must not.** The boundary is a lattice
  replacement, not a weighted term (§2.1). Giving it a finite scale is the
  change `bound.ts` and `calibration.ts` fact 3 already record a measured
  inversion for, and every ordering weight in the fold is calibrated against the
  sentence it would delete.
* **The ramp cannot exist here.** The shape is forced by the bracket, not
  chosen: there is nothing sound for the boundary to say at turn 55 of a
  60-turn game, at any width, because at turn 55 the game does not end (§3.3).
* **And the +4 deaths it was to answer are not a defect.** Split by team they
  are our deaths 26 → 25 and theirs 69 → 74, on the last two turns of the two
  piece-bearing classes, with outcomes flat on all ten arms (§1).

What the brief's second option was reaching for — *let the bot convert a lead
without walking into contests* — is a real want, and the measurement says it is
somebody else's: it is a weight that is a function of the STANDING and the
turns remaining, which is `ENDGAME.md` §5's `drive/lead-protection@1` and
`drive/beware-entrapment@1` on `origin/feature/drives-preferences`, whose
framework already carries the row shape and needs a `schedule` field. A single
terminal knob was allowed here; a standing-conditioned risk appetite was not,
and the reason is now measured rather than assumed — the boundary member has no
schedule to be a function of, because it fires on exactly one board.

`ENDGAME.md` §3.3's board is still the test those two rows owe. Nothing in this
row moves it: the fold scored walking into an eight-cell pocket at 200.92 with a
22-cell snake and three turns left, and it will keep doing so, because turn 57
of a 60-turn game is a board the cap does not see and cannot soundly be made to.

### 3.5 What stayed, and what did not

* **Reverted**: `TERMINAL_READ_AHEAD_TURNS`, the `CENTAUR_TERMINAL_READ_AHEAD`
  override and the subtraction in the turn gate. `terminal.ts` and
  `calibration.ts` are byte-identical to `119b23c`. An inert knob is a scaffold
  for a refuted rule, and this repo's standing answer to a refuted rule is a
  paragraph beside the record.
* **Kept**: `src/lobster/__tests__/terminal-window.test.ts`, which pins the
  mechanism without the scaffold — the member abstains on a board whose limit is
  stated and not reached (a case `terminal-sound.test.ts` does not cover: it
  tests a board with no limit at all), and the bracket on those boards still
  carries `continues`.
* **Kept**: this document, and `BEHAVIOUR-AUDIT-3.md` §W1's closing paragraph.
* **Not re-pinned**: nothing. No fixture moved, because no decision moved.

---

## 4. Reproductions

```sh
# §1 — the A/B, attributed by team. One game at a time.
for sd in 0 1; do
  for s in 1 2 3; do for c in mixed snakes sparse sparse-lean; do
    node dist/tests/local-game.js $c 60 $s --nodes --opponent=material-only \
        --side=$sd --json=$c-$s-side$sd.jsonl > $c-$s-side$sd.log; done; done
  for s in 1 2 3 4 5 6 7 8; do
    node dist/tests/local-game.js potions 60 $s --nodes --opponent=material-only \
        --side=$sd --json=potions-$s-side$sd.jsonl > potions-$s-side$sd.log; done
done
node scripts/ab-compare.js capless/ head/      # outcome section == TERMINAL-SOUND §4.1
# ours vs theirs: `outcome.team` from the summary against the team on each DEATH
# line of the trace. `deathsByCause` alone cannot make this split.

# §3 — the sweep. Same corpus, one build, three widths.
git show e8d7193 -- src/lobster/evaluate/terminal.ts src/lobster/evaluate/calibration.ts
CENTAUR_TERMINAL_READ_AHEAD=12 node dist/tests/local-game.js mixed 60 1 --nodes \
    --opponent=material-only --side=0 --json=w12.jsonl > w12.log
diff <(grep -v 'Ms"' w0.log) <(grep -v 'Ms"' w12.log)     # empty

# §3.2 — the harness at the widest width
CENTAUR_TERMINAL_READ_AHEAD=12 npx jest src/lobster/evaluate/law-sweep.test.ts
#   boards=240 capBoards=231 capWorlds=8588 totalLo=0 totalHi=9, no terminal.* class

# §3.3 — the mechanism, without the knob
npx jest src/lobster/__tests__/terminal-window.test.ts
```
