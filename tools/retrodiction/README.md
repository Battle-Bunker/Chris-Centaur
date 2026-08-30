# Mechanism retrodiction — asking a heuristic about games we already played

A retrodiction harness replays a committed corpus and asks whether a candidate
heuristic **would have seen the events the mechanism actually produced**. It is
the cheapest bar in the evidence ladder: it costs compute and no games, it can
kill a mis-signed or mis-scaled term outright, and it cannot promote anything.

**It is not a promotion measurement.** No arm is run, no flag is varied, nothing
is played. Nothing here writes to `tools/learnloop` or to
`tools/learnloop/promotion-ledger.json`, and a number out of this directory is
never a promotion signal — the standing bar for that is a paired live arm with
engagement proof.

## `slider-attack-retrodiction.js`

Measures `src/lobster/evaluate/slider-attack-vector.ts` (and through it the
ray-crossing primitive it is built on) against the committed batch-1 replays.

```
node tools/retrodiction/slider-attack-retrodiction.js \
  --replays <dir containing *.jsonl.gz> \
  --out report.json \
  [--every 40] [--limit N]
```

Three measurements, all reported per experimental cell and pooled:

1. **the denominator** — every sever in the corpus, split by who landed it
   (slider or not, ours or not) and by who suffered it, so the share the term
   can claim is visible rather than assumed;
2. **the retrodiction** — at each sever, where the played move ranks in the
   term's own ordering of that slider's whole action set;
3. **the false-positive mirror** — over every slider decision, when the term
   reads the staged move as a cut, whether the resolution recorded one, at both
   endpoints of the term's realized interval.

Deterministic: no clock enters any reported number (the cost line aside), and
the sampling for the option-surfacing rate is every Nth decision in sorted file
order.

Headline result on `sim-results/local-20260827` (2,592 replays, 2026-08-29):
given the term can see a cut at the decision it ranks it above every
non-cutting alternative **105 times in 105**; its pessimistic endpoint fired
**73 times with zero false positives** while its optimistic endpoint was false
**20.5%** of the time; **4.34 µs** per valuation. The full write-up, including
what the run does *not* establish, is the `slider-attack-retrodiction.md`
findings file in the sweeps working set.

## `potion-terms-retrodiction.js`

Measures `src/lobster/evaluate/potion-seek.ts` and
`src/lobster/evaluate/potion-control.ts` (and through them `attack-window.ts`)
against the committed batch-1 replays.

```
node tools/retrodiction/potion-terms-retrodiction.js \
  --replays <dir containing *.jsonl.gz> \
  --out report.json \
  [--every 4] [--limit N]
```

Only the **192 potions-on** replays are in scope, and there is no choice about
it: a body cut needs a strictly higher tier, tier comes only from a potion, and
the other 2,400 replays contain zero severs. The report states the potions-off
denominator anyway, so the restriction is visible rather than assumed.

Reach is read from the same arrival machinery the evaluator would use —
`CloudSource` dilates each unit's shells and `earliestShells` stamps
`earliest[c]` off them. The miner builds no reach of its own, so a term that
passes here passes on the numbers the live evaluator would have seen.

Four measurements:

1. **what enabled each sever** — for all 282, whether a collection inside the
   three-turn window preceded it, on the severer's team (the ally buff) or on
   the victim's (the collector's own −1);
2. **the timing retrodiction** — each of the 485 collections scored at the turn
   it was decided, cross-tabbed against whether that team landed a sever inside
   the three turns the pickup bought. The unit of account is the COLLECTION, not
   the sever, because two severs out of one window are one decision;
3. **the missed windows** — over a deterministic sample of team-turns, how often
   the term found a pickup worth making and the bots did not make it;
4. **control against outcome** — the mid-game control reading against end-game
   weight share, reported alongside the mid-game material share it is 0.83
   collinear with, and with that share partialled out.

Deterministic: no clock enters any reported number (the cost lines aside), and
the sample is every Nth turn row in sorted file order.

Headline result on `sim-results/local-20260827` (2026-08-30): every one of the
282 severs is accounted for by a collection inside the window; a pickup the term
priced above zero converted **57.0%** of the time against **26.6%** for one it
priced at zero (+30.4 points [20.7, 40.1]); the collector-exposure half is a
near-tautology at **99.6%** and is not usable as an ordering channel yet; and
potion control adds **0.17** over the material share it mostly restates. The
full write-up is `potion-terms-retrodiction.md` in the sweeps working set.
