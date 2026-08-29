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
