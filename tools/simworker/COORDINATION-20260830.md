# Coordination — 2026-08-30: pull before you run batch 2

**Two changes on `sim/worker-kit` that a session already holding a
checkout will not have. One of them changes what a batch-2 result is allowed to
claim, and the other changes what a `--arm` line means.**

Neither adds a game. **The batch is still 11 specs / 2,472 games**, the same
cells, the same seeds, the same five floored boards. No status moved, no
measurement row was added or edited, no verdict changed.

```sh
git fetch origin && git checkout sim/worker-kit && git pull --ff-only
node tools/simworker/bin/selftest.js          # the new gate; 24 assertions, no bundle needed
node tools/learnloop/bin/selftest.js          # 135 assertions
```

---

## 1. P11 is undersized, by a measured factor of about four

**P11 needs ~73 blocks per cell to resolve to ±0.10; it ships at 16.**

A sandbox program ran 660 live games on 20260830, and one of them was this exact
pair: `baseline` @ `66904d2` against `search-arch` @ `c74f0a1`, both shipped
defaults, 8 blocks. It returned **sharePar −0.01 [−0.31, +0.29]** — and the arm
was **fully engaged**: 800 scout threads, 370 scout plies and 2,873 cluster
joints per game. That is *engaged and unresolved*, not *engaged and did not
help*, and the two are different findings.

Cross-bundle paired spread was **±0.303 at 8 blocks** against an A/A floor of
±0.10 on the same cells — three times the floor. Half-width scales as 1/√blocks:

    8 x (0.303 / 0.10)^2 = 73 blocks per cell
                         = 219 games per arm per cell
                         = 1,314 games for the spec

**At the emitted 16 blocks the expected half-width is about ±0.21 sharePar.**

### What that means for the night you run it

- **THE MERGE MAY NOT BE DECIDED FROM A 16-BLOCK P11, IN EITHER DIRECTION.** An
  effect of +0.2 sharePar sits inside that interval. A null there is **not**
  evidence the branch does not help, and writing it up as one would be the most
  expensive mistake available in this batch.
- **The engagement gate is a real pass/fail at any block count**, and it is the
  best thing 16 blocks buys: `deepestPlies > 0` and `deepBranches > 0` on the
  `search-arch` arm, on at least the piece-bearing cells. **Zero there is a
  broken arm and is reported as a REFUSAL, not as a null** — it means the bundle
  came from the wrong ref or the deep layer never opened a thread. Record the
  resolved SHA of both bundles from `bundle.json` in `findings.md`.
- **The mechanism rows are readable at this size** — `deepestPlies`,
  `deepBranches`, `depthEffectRate`, `worstWallMs`, `decisions` are per-decision
  counts, not per-game outcomes.
- **Quote any sharePar interval with its half-width and label it UNDERPOWERED
  FOR THE MERGE DECISION.**

**If the night has room for more than 2,472 games, spend it on ONE cell of P11
at 73 blocks rather than on breadth.** One cell that can answer the question
beats three that cannot. Note that raising it drags the mandatory A/A null with
it — `make-promotion-batch.js` refuses a null narrower than its largest
treatment, correctly — which is what makes it expensive: the priced options are
2,472 games as shipped, 3,498 with P11 at 73 and the null left behind (REFUSED
by the generator), 5,208 with the null following, 7,560 with the piece specs
raised too. `tools/learnloop/specs/batch2/README.md` has the table and the
nights-on-the-box column.

## 1b. The same night measured a second sizing fact

**An 8-block piece-bearing cell failed its own A/A null: +0.271 [0.037, 0.506]
on two IDENTICAL bundles with identical configs and identical seeds.** It
excludes zero. A cell whose own null excludes zero has no floor, and every
treatment delta on it is **UNREADABLE**, not null. All-snake cells at the same
size floored cleanly at ±0.10.

So, when the batch comes back:

- **Report N0 per cell, never pooled.** The batch floors five cells and four of
  them bear pieces.
- **Never borrow a floor.** Not the snake cell's for a piece cell, and not one
  bundle's for the other — the same cell floored ±0.120 on one bundle and
  ±0.234 on the other in one night.
- A piece cell whose null does not contain zero is written up as an
  **instrument event**, and no verdict comes out of that cell.

Every affected spec carries this in its own `POWER` block and `REQUIRES` line,
and `n0-aa-null.json` carries it where the floor is actually measured.

---

## 2. A bot config now names the seat it configures

**Until today an arm's `bot=` was merged into every lobster contender the spec
seated.** On a spec that seats one lobster that is invisible. On a spec that
seats two it cancels the contrast: the treatment arm becomes two ablated
lobsters against a control arm of two intact ones, and the arm reports a null it
never had the power to tell from a real result.

```sh
# THE SUBJECT SEAT — allowed only when exactly one seat can be meant.
--arm 'treat=<bundle>,bot={"sampledCap":true}'

# THAT SEAT, BY NAME. Repeatable; each config lands on its own seat and no other.
--arm 'treat=<bundle>,bot@noGain={"candidates":{"gainOrdering":false}}'
```

**Nothing you already had planned needs retyping.** Every spec in
`tools/simworker/specs/` and `tools/learnloop/specs/batch2/` seats exactly one
reachable contender, so every batch-2 arm line still resolves to
`lobster-territory`, unchanged. What changed is that a spec seating **two**
configurable contenders now **refuses** a bare `bot=` and prints both candidate
seats plus the `bot@` line that fixes it — before anything launches, so a
refused pair leaves no half batch on disk.

Also new, and worth knowing when you read a finished batch:

- `arm.json` and the batch manifest record **`seatConfigs`** — the resolved
  seat → config map — beside the older `botConfig`.
- `verify-null.js` checks it. Two arms carrying the same config aimed at
  different seats are two different games, not an A/A pair.
- The launch banner prints `bot@<seat>: {...}` per seat rather than a bare
  config, because the banner is the last place you can notice a config landing
  somewhere you did not mean.

### And the design it unlocks, which is the cheap one

`HANDOFF.md` gains **SEATING BOTH CONTENDERS IN ONE GAME**. When both sides of a
question are bots you can seat, put them in the same game and read
`G = sharePar(A) − sharePar(B)` within-game; the sandbox resolved a five-rung
roster ladder in 144 games that way. The arms are then **identical** — an A/A
pair, self-flooring — and **the floor to quote is the between-arm difference of
G**, not either seat's own floor. Read the section before using it; the pairing
semantics are not the same as a treatment pair's.

---

## Where the detail lives

| what | where |
|---|---|
| the isolation rule and its refusals | `tools/simworker/lib/arm-spec.js` |
| the gate that asserts it, including a live per-seat stamp | `tools/simworker/bin/selftest.js` |
| arm mechanics, and both-sides-in-one-game seating | `HANDOFF.md` §3 |
| the sizing trade, priced, in nights on your box | `tools/learnloop/specs/batch2/README.md` |
| per-experiment power arithmetic | each spec's `POWER` block; `PROMOTION-STATUS.md` |
| what earns resources after this batch | `tools/learnloop/specs/batch3-candidates.md` |
