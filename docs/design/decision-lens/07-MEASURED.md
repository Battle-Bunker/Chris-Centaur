# 07 — MEASURED: the O1 instrumentation run

DECISION-LENS, document 7. `05-BUILD-ORDER.md` §(d) gate 9 asks for one
instrumented run and says what it must settle: *"`LENS_TOPK`, `LENS_ROW_CAP`
and the storage budget are then either confirmed against the numbers or
changed, **in the commit message**, before merge. Three of the five measured
questions of 04 §3 close here."*

This is that run, and what it closed.

**How to reproduce it.** `node scripts/lens-measure.js --turns 30 --nodes 550`.
Both scenarios, seed 1, thirty board turns, three teams deciding per turn — 90
decisions per scenario. The lens rides on `KernelInput.lens` through the same
sink production uses (`ingestLensEvents` through a `SeqWriter`, the
substrate-to-wire translation, the `movesets` projection re-folded per frame),
because measuring a second assembly would report the second assembly's numbers.
Bytes are the STORED form — `encodeEventRow` then the JSON that reaches
`turn_events.payload` — not the process's heap.

---

## 1. The numbers

| | `mixed` | `snakes` |
|---|---|---|
| decisions / board turns | 90 / 30 | 90 / 30 |
| **emissions per decision** | mean 3.03 · p50 3 · p90 4 · **max 4** | mean 2.32 · p50 2 · p90 3 · **max 3** |
| **emissions per board turn** | mean 9.1 · p90 10 · **max 10** | mean 6.97 · p90 9 · **max 9** |
| **clusters per decision** | mean 1.81 · p90 3 · max 3 | mean 1.97 · p90 2 · max 2 |
| cluster size (n=326 / 354) | mean 1.34 · p50 1 · p90 3 · max 3 | mean 1.01 · p50 1 · max 2 |
| **movesets retained per cluster frame** | mean 2.60 · p50 2 · p90 5 · **max 5** | mean 2.67 · p50 3 · **max 3** |
| projection rows per decision | mean 12.89 · p50 12 · p90 17 · **max 23** | mean 4.51 · p50 5 · **max 6** |
| **`turn_events` per board turn** | mean 36.5 · p50 36 · p90 43 · **max 45** | mean 24.2 · p50 26 · **max 27** |
| **bytes per board turn** | mean 73.2 KB · p90 85.3 KB · **max 88.4 KB** | mean 32.9 KB · p90 39.7 KB · **max 40.6 KB** |
| coverage `planDistance(staged, nearest retained row)` | **0** on 90 of 90 | **0** on 77 of 90; 13 retained nothing |
| `refusal` frames, whole run | 107 | 94 |
| `dominance: refuted-by-witness` | 0 of 1,566 stored rows | — |
| `conditional` frames / `promote` hits / epoch changes | 0 / 0 / 0 | 0 / 0 / 0 |

The persisted form of the same run — 1,821 `turn_events` rows and 1,566
`movesets` rows over 180 decisions — is what gate 8 was run against:
`DELETE FROM movesets`, `npm run lens:rebuild`, `npm run lens:check` reports
*no drift: 1566 row(s) fold exactly to what is stored*.

---

## 2. What the numbers settle

### Q5 — emission cadence: **tens.** The lane's decimation stays unbuilt.

04 §3 assumed tens and named the fallback: *"if the measurement exceeds 100 per
turn the lane decimates with a visible 'showing 40 of N'"*. The measurement is
**7 to 10 emissions per board turn, maximum 10** — an order of magnitude under
the trigger. Every emission is a tick an operator can land the playhead on, the
scrubber needs no snapping, and the decimation fallback is designed and
correctly not built.

### §3.3 #3 — `LENS_TOPK = 5` and `LENS_ROW_CAP = 24`: **confirmed, and not by a hair.**

Both caps bind exactly where they were meant to and neither is wasted:

- retained rows per cluster frame **max out at 5**, which is `LENS_TOPK`
  exactly, so the cap is reached and is doing work;
- projection rows per decision **max out at 23** against a `LENS_ROW_CAP` of
  24 — the per-decision cap is reached but never exceeded, on the busiest
  board this bot plays.

And the coverage curve — the question the caps were really about — is **0 on
every decision that retained anything at all**. `planDistance(staged, nearest
retained row)` is zero: the cluster restriction that was actually staged is in
the reservoir, every time, on both scenarios. 03 §7.3's failure case (*"a staged
plan at distance 4 from every retained row means the reservoir contributed
nothing"*) does not occur once in 180 decisions. **No re-tune. Gate 9 does not
send work back.**

One caveat worth writing down rather than rounding away: 13 of 90 `snakes`
decisions emitted no `movesets` frame at all. Those are singleton clusters that
never got a second priced restriction to rank — the reservoir had nothing to
retain, which is honest emptiness rather than a miss.

### O1 — the counts themselves, and a storage budget that needed revising.

The per-turn counts are in §1 and they are the answer to O1. The budget is the
part that moved, and it moved twice.

**The first reading was 542 KB per turn, and 98% of it was noise.** `refuse()`
is called on every rejected candidate write inside the hot loop, and it emitted
a `refusal` frame each time: **18,586 refusal frames over twenty `snakes`
turns**, against 425 frames of everything else. Storage, the wire envelope and
the client's whole-turn hold were all being sized by a counter.

The count was never what the lens added — `KernelReport.refusals` already
carries it, exactly — the **moment** was. So the frame is now emitted **once per
reason per emission barrier**: the barrier because that is the timeline lane's
own unit, a tick the operator can actually land on. 18,586 became 94, the
information is the same, and the numbers in §1 are the post-fix reading.

**The revised budget: 33–73 KB per board turn, 88 KB at the worst turn
measured.** 04 §4.5 says the client holds the current turn's events and calls
that "kilobytes, bounded by the deadline". It is **tens of kilobytes**, and that
is the number to design against: the whole-turn hold and the local-fold scrub
are still right (88 KB is nothing to hold and nothing to fold), and seeking
still does not belong on the wire. What is now clear is where the bytes are —
`partition` carries the whole partition and `movesets` the whole reservoir, both
by design (a delta folds wrongly in replay) — so the budget is content, not
overhead, and the 30-day fold that drops refusals and non-staging emissions is
what keeps it bounded over a game rather than a turn.

---

## 3. What this run could **not** settle, and why

Two of 04 §3's five measured questions are still open, and neither is open for
want of a run — both need a **human**, and a bot playing itself has none.

### §3.3 #6 — `promote` hits vs epoch changes: **still open.**

The run recorded **0 conditionals, 0 promote hits, 0 epoch changes.** Nothing
inspected and nothing pinned, so [CHANGE 2]'s counter has no denominator. This
is not a null result about the question; it is the absence of the only actor
that can produce one.

**Trigger:** the first recorded session with operator pins in it. The counter
ships (`lens-measure.js` reads it off the `conditional` frames' context keys),
so the number arrives with the first watched game rather than needing a new
instrument.

### Q8 — the widen banner's auto-accept timer: **not measurable here at all.**

It is a distribution over human reaction times — banner shown to accept — and
`min(6 s, 0.25 × (turnExpiryTime − now))` stands as the formula meanwhile. The
event pair is on the timeline and costs nothing to collect, so this closes on
operator sessions too.

### O8's trigger, observed in passing

`dominance: refuted-by-witness` is **0 of 1,566 stored rows**. O8's trigger is
scoped to *"rows an operator actually opened"*, so it does not fire — but the
witness channel is empirically empty in bot-only play, and that is worth knowing
before anyone leans on it as the refuter's source. Re-read this line when the
first operator sessions land alongside §3.3 #6.

---

## 4. What the run found that nobody asked it to

Gate 9 is a measurement, but running the shipped sink against real Postgres for
the first time is also the first time several seams were exercised end to end.
Three defects fell out, and all three are fixed in the commits that carry this
document.

1. **Every stored `movesets` frame named emission `-1`.** `ingestLensEvents`
   tracked the turn's last emission in a local, and production calls it once per
   frame, so the local was reset before every call. The writer spans the turn
   and the local did not; it is read off the log now.

2. **The `movesets` rebuild failed outright on a real session.** `hi` is `+∞`
   until something is proved above the incumbent — an ordinary reading on this
   scale — and `JSON.stringify(Infinity)` is `null`, on the socket and in
   `jsonb` alike. The projection is derived from the stored event and its `hi`
   column is `NOT NULL`, so gate 8 could not run at all. Non-finite numbers are
   named on the way out and restored on the way in now, by one codec both hops
   share; 215 of the 1,566 rebuilt rows carry `hi = +∞` through Postgres.

3. **`at_work_ms` was an `integer` column.** The kernel's clock is fractional by
   construction — `nodes × NODE_COST + reads × READ_COST` — and the first three
   frames of a real decision are at 0.01, 2.04 and 2.05. Postgres refused the
   write rather than truncating the axis that replays. The column is
   `double precision`; `at_wall`, which is a wall-clock reading and genuinely a
   whole millisecond, is rounded at the sink instead.

---

## 5. What one inspection costs, and what the ranking on top of it costs

Added on `lens-4`, with the fix for 10 §4 O1. §1's table is a BOT-ONLY run —
`conditional frames: 0`, and nothing here changes that — so the cost of an
inspection was never in it. It is here now, because O1's cause turned out to be
a cost question and the answer decides what the panel can draw.

**How to reproduce it.** `mixed`, seed 1, turn 1, 550 nodes, under the node
clock (`nodes × 1 + reads × 0.01`), with an operator that asks for a
conditional on the cluster at every emission — which is what
`src/tests/lens-walkthrough-server.ts` scripts and what
`src/lobster/__tests__/lens-reserve.test.ts` and
`src/tests/lens-inspection-cost.test.ts` gate.

| | `mixed` (cluster of 3) | `snakes` (singleton cluster) |
|---|---|---|
| the reserve, `LENS_INSPECTION_MS` | 20 | 20 |
| **the head** — `conform(ctx ⊕ lock, wirePlan)` | **20.59** work units · **20 evaluator calls** | 1.02 · 1 evaluator call |
| **the ranking** — every other row, `conform(ctx ⊕ lock ⊕ v↦c)` | **0.09** work units · **0 evaluator calls** (4 rows) | 0.01 · 0 calls (0 rows) |
| the served answer | 20.69 of a 20 reserve · **5 rows** | 1.05 · 1 row |
| asks after it | refused `reserve-spent` (2 of 3 emissions) | served — the reserve still has room |

Three readings, and each one settles something:

**THE FIRST CONFORM UNDER A PIN PRICES THE REPAIR; EVERY ONE AFTER IT IS
MEMO-SERVED.** 20 evaluator calls, then zero: the bank's memo holds the
resolutions the first one established, so a second conform under a different
pin costs two clock reads. That is why (a) filtering the retained rows was
never the cheap option it looked like and (b) ranking the rest of the cluster
is nearly free once the operator's own question has been answered.

**THE RESERVE IS SIZED AT ONE CONFORM, AND ON `mixed` IT IS SPENT BY ONE.**
20.59 against 20 — 03 §3.1 sized `LENS_INSPECTION_MS` at *"one `price()` — ~18
ms at 26 units — plus slack"*, and that is exactly what it buys. A ranking
bounded by what the reserve has LEFT is therefore a ranking that never runs,
which is O1's cause: the panel drew the head and nothing else. `LENS_RANK_MS`
is the declared floor the ranking gets on top of it — 1 work unit, 5% of the
reserve, and by the row above it cannot buy a `price()` on any board this bot
plays. The whole cost of the table an operator reads is `20.69`, and the
SEARCH DEADLINE IS NOT MOVED: the carve is `LENS_INSPECTION_MS` and nothing
else, which is gate 7(i) and still passes unchanged.

**A LIST OF ONE IS STILL REACHABLE, AND ON `snakes` IT IS THE TRUTH.** A
singleton cluster with its one unit locked has nothing left to vary, so the
ranking has no rows to add and says nothing — no truncation, no refusal, one
row. That is the honest list of one, and it is now distinguishable from the
one O1 was about.

**§3.3 #6 is still open and this does not close it.** These are a scripted
operator's asks, not a human's; `promote` hits still need the first recorded
session with real pins in it.
