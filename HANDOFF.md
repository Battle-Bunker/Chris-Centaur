# HANDOFF — the local simulation session's standing mandate

> **If you started from `HANDOFF-NOW.md`, this document replaces it. Your
> results protocol is unchanged.**

You are a Claude Code session running on the owner's own machine. Your job is
long-running bot-versus-bot simulation on their hardware, pushed to branches a
cloud session mines later. This document is your mandate. Read it before you
run anything, then read `tools/simworker/context/METHODOLOGY.md` — it is short,
and every rule in it was bought with a wasted measurement.

---

## 1. Mission

The owner's words, verbatim:

> "comparing versions of our bot across a diversity of game configurations in
> long running simulations with significant compute time each, like 2s turns,
> 3 teams * 6 units each, 25x25 boards"

That is the shape everything here is built around, and it is deliberately at the
top of the supported range in every dimension at once — 25 is the harness's
maximum board size, and 2000 ms is double the longest budget this program has
ever measured at. Nothing in the existing corpus tells you what happens there.
That is precisely why it is worth the compute.

Your output is not a winner. It is **evidence**: paired measurements, each with
the null that makes it readable, each traceable to a git SHA, written up so a
session that was not present can act on them. A batch nobody can interpret
without you is a batch that gets thrown away. The cloud session will mine what
you push, and it can only mine what you made self-describing.

You have one advantage the cloud session does not: **a quiet machine you
control**. This whole program has been fighting wall-clock noise on a shared
four-core box — measurements retracted because three concurrent searchers did
not get equal service. Guard that advantage. It is the reason your numbers can
be better than anything already in the record.

---

## 2. Setup

### Clone

The sims run **in-process from Chris-Centaur**. TacticToes is optional — clone
it only if you need to read the upstream game rules; nothing here executes it.

```sh
mkdir -p ~/lobster && cd ~/lobster
git clone https://github.com/Battle-Bunker/Chris-Centaur.git
git clone https://github.com/Battle-Bunker/TacticToes.git      # optional, reference only
cd Chris-Centaur
git fetch --all --prune
git checkout sim/worker-kit
```

### WSL notes

You are on WSL Ubuntu. These five things matter and the rest does not.

1. **Keep everything on the Linux filesystem.** Clones, bundles, replays — all
   under `~/`, never under `/mnt/c`. The Windows mount is drastically slower;
   it would crawl on `npm ci` and, far worse, it would inject filesystem stalls
   into wall-clock-bounded decisions and corrupt the very thing you are
   measuring.

2. **Node via nvm.** Verified working on **v22.22.2**; use Node 22 LTS. The
   repo pins no version (`package.json` has no `engines` field and there is no
   `.nvmrc`), so nothing will stop you using something else — but 22 is what
   every number in the corpus was produced on.

   ```sh
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   exec $SHELL -l
   nvm install 22 && nvm use 22 && node --version
   ```

3. **Git auth.** HTTPS clones will prompt on push. Pick one:
   ```sh
   gh auth login                                    # easiest
   git config --global credential.helper store      # then push once with a PAT
   # or switch to SSH:
   git remote set-url origin git@github.com:Battle-Bunker/Chris-Centaur.git
   ```
   You need **push rights** — you will be pushing `sim-results/*` branches and
   opening draft PRs.

4. **Memory.** WSL2 gives the VM the host's cores by default but caps memory at
   about 50% of RAM. If a big batch hits the cap, raise it in
   `C:\Users\<you>\.wslconfig` and `wsl --shutdown` to apply:
   ```ini
   [wsl2]
   memory=24GB
   ```
   Record `nproc` and `free -g` yourself anyway — `batch-manifest.js` captures
   core count and total memory into every manifest, but a note in findings.md
   costs nothing.

5. **Sleep kills overnight batches.** Windows sleeping suspends the whole VM.
   Disable sleep while a batch runs (`powercfg /change standby-timeout-ac 0`,
   or the Settings UI).

   **What survives an interruption, precisely:** the runner appends a manifest
   row per *finished game*, so every completed game is on disk and intact — you
   never lose more than the games in flight. `--resume` reads the manifest back
   and plays only what is missing. It is **not** mid-game checkpointing: a game
   that was running when the VM suspended is lost and replayed.

   **Resume both arms of a pair together, or neither.** Resuming one arm alone
   re-runs its remainder under a load its partner never saw, and the pair stops
   being a pair. `run-pair.js --resume` does both.

### Install and build

```sh
cd ~/lobster/Chris-Centaur
npm ci

# build a bundle: any git ref -> a self-contained, fully built bot
tools/simworker/build-bot.sh origin/claude/mid-turn-collision-logic-mkxurg ~/lobster/bundles/integrated --fetch
tools/simworker/build-bot.sh origin/claude/cluster-lookahead              ~/lobster/bundles/perf-substrate
```

`build-bot.sh` resolves the ref to a **SHA** and builds that, stamping
`bundle.json`. It shares one `npm ci` per lockfile across bundles, so the second
build is fast. It compiles to plain JavaScript — never ts-node — because the
legacy path's worker pool only spawns real threads when `decision-worker.js`
exists next to it; under ts-node it silently falls back to single-threaded
evaluation and hands every lobster arm a three-thread handicap production never
gives it. The script checks for that file by name and fails if it is absent.

**tsc will report 6 type errors. That is expected** — pre-existing drizzle
errors in `src/logic/decision-logger.ts` and `src/routes/activity.ts`, neither on
any path this harness uses. The build fails on a *missing artifact*, not on
tsc's exit code. If it says `OK ->`, you are fine.

### Smoke test — MUST PASS before any real run

```sh
node tools/simworker/bin/run-pair.js \
  --batch /tmp/smoke \
  --spec  tools/simworker/specs/smoke.json \
  --arm   nullA=~/lobster/bundles/integrated \
  --arm   nullB=~/lobster/bundles/integrated \
  --workers 1

node tools/simworker/bin/verify-null.js --batch /tmp/smoke --null nullA,nullB
node tools/simworker/bin/aggregate.js   --batch /tmp/smoke --base nullA
```

Four games total, a few seconds. It must end with `VERDICT: nullA vs nullB is a
valid A/A null.` If it does not, stop and report — do not start a real batch on
a toolchain that cannot pass its own smoke.

---

## 3. The bot-version map

Verified against the actual branches on 2026-08-27. **SHAs move — always
re-resolve and record your own.** `claude/cluster-lookahead` moved twice during
the hour this document was written.

### Contenders

**A CONTENDER IS A BUILD PLUS A BOT CONFIG.** As of 2026-08-29 the engine has
no feature flags — the owner had the whole system torn out — so an arm is either
a different BUNDLE or a different `BotConfig`, and never an exported variable.
See "How to select an arm" below for the mechanics.

| name | branch | SHA when verified | how to select |
|---|---|---|---|
| `integrated` | `claude/mid-turn-collision-logic-mkxurg` | `66904d2` | build it; run defaults |
| `perf-substrate` | `claude/cluster-lookahead` | `8059b86` | build it; run defaults |
| `legacy` | any branch | — | `bot={"engine":"legacy"}` |
| `lobster-territory` | any branch | — | bot name `lobster-territory` |
| `lobster-material` | any branch | — | bot name `lobster-material` |
| `lobster-slider` | integrated **or** perf-substrate | — | bot name `lobster-slider`, or a contender with `{"evaluator":"territorySliderEvaluator"}` |
| `admission` | `arch/s2` | `724d83f` | **UNBUILDABLE — see below** |

`integrated` carries: gainOrdering on by default, staging-safety `auto`, the I4
expiry threading, I6, the o-p3 room fix, and I2's slider repair.

### How to select an arm

Two mechanisms, and the distinction still matters:

1. **A different bundle.** `build-bot.sh <ref> <dir>`, then `--arm
   name=<dir>`. This is how a whole branch is raced.
2. **A different `BotConfig`.** `--arm 'name=<dir>,bot={"territoryRefine":true}'`
   — inline JSON, or a path to a `.json` file. The runner writes that arm its
   own spec with the config merged into every lobster contender, and leaves
   `sweepId`, `cells`, `seeds` and `rotateSeats` byte-identical, so the pairing
   guarantee holds: same boards, same seeds, same seat rotation, two
   differently-configured bots. A spec can also declare contenders by name:

   ```json
   "contenders": { "refiner": { "base": "lobster-territory",
                                "bot": { "territoryRefine": true } } },
   "bots": ["refiner", "lobster-territory", "reflex"]
   ```

Some fields reach a deployable configuration (`engine`, `stagingSafety`,
`workers`); `evaluator` reaches `TeamDecisionOptions.evaluate`, a harness-only
seam with no production path. A finding about the second kind is a finding
about a capability, not about a deployable configuration. **Say which kind you
measured.**

### Bot config fields — verified in code

`src/lobster/bot-config.ts`. Every field optional; a contender is a DIFF from
the shipped bot, and the shipped bot is the default of every row.

| field | values | default | what it does |
|---|---|---|---|
| `engine` | `lobster` \| `legacy` | `lobster` | which engine drives the full pass |
| `stagingSafety` | `off` \| `auto` \| `guard` \| `full` | `auto` | `auto` = `full` when the board bears a piece, else off |
| `territoryRefine` | `true` \| `false` | `false` | Door C's contested reach/room refiner |
| `candidates.unitFatality` | `true` \| `false` | `false` | rung-0 fatality classifier |
| `candidates.tierSafeStaging` | `true` \| `false` | `true` | the tier-window filter (with `selfDebuffOrdering`) |
| `workers` | `off` \| `auto` \| `0..8` | `off` | evaluation worker pool; `auto`=`min(cores-1,3)` |
| `workersAudit` | `true` \| `false` | `false` | recompute worker results on main thread; throws on disagreement |
| `evaluator` (contender field, not `bot`) | an export name | — | e.g. `territorySliderEvaluator` |

**A BAD FIELD IS A REFUSAL, NOT A SILENT OFF** — which is the single biggest
practical difference from the flags. `botConfigFromJson` rejects an unknown
field and a bad value; `run-pair.js` parses and validates the config before it
launches anything; and `checkContenders` refuses a spec whose bundle has no
`bot-config` module at all (i.e. one built from a pre-teardown branch, which
would ignore the config and play the shipped bot under your arm's name).

### THE FLAGS ARE GONE — 20260829, by owner ruling

Every `CENTAUR_*` strategy flag has been deleted from the engine. Setting one
now does nothing at all, so an arm that sets one plays the SHIPPED bot under a
treatment's name and the batch reports an A/A pair as a null.
`run-pair.js` refuses them by name and prints the replacement.

| gone flag | what happened to it |
|---|---|
| `CENTAUR_ENGINE` | config: `bot={"engine":"legacy"}` |
| `CENTAUR_STAGING_SAFETY` | config: `bot={"stagingSafety":"guard"}` |
| `CENTAUR_TERRITORY_REFINE` | config: `bot={"territoryRefine":true}` |
| `CENTAUR_UNIT_FATALITY` | config: `bot={"candidates":{"unitFatality":true}}` |
| `CENTAUR_TIER_DEFENSE` | config: `bot={"candidates":{"tierSafeStaging":false,"selfDebuffOrdering":false}}` |
| `CENTAUR_WORKERS` / `_AUDIT` | config: `bot={"workers":"auto"}` — deployment, judged by benchmarks |
| `CENTAUR_TIER_TRUTH` | **deleted, premise is now `full` unconditionally.** A correction. P4 is closed by decision; see the spec's own comment |
| `CENTAUR_MUTUAL_WIPE_AWARD` | **deleted, the award is unconditional.** A correction |
| `CENTAUR_ROYAL_MARGIN` | deleted; the reading is a `CriterionProfile` param and the correction it is owed has NOT been made |
| `CENTAUR_COHORT_POLICY` | code already gone; measured live-null |
| `CENTAUR_WASM` | removed earlier, 20260829, by the same ruling |

`--legacy-env` overrides the refusal for exactly one legitimate case:
re-running batch 1 against the ORIGINAL pre-teardown bundles, which do still
read those variables. It stamps `legacyEnv: true` on the arm and the batch
manifest prints a warning. Say so in `--note`.

**STILL FLAGS, pending the search-layer teardown:** `CENTAUR_CLUSTER_SEED`,
`CENTAUR_MULTISTART_SEED`, `CENTAUR_EDGE_EV`, `CENTAUR_CLUSTER_ENUM`,
`CENTAUR_SAMPLED_CAP`, `CENTAUR_SCOUT`. These are still environment variables
and still carry the old trap: **they parse only `1`, `on`, `true`**, with no
validation warning and no `off` keyword — every other value, including `yes` or
`ON`, is silently off. Set their off arm by **omitting** the variable, and
check `envAtRun` in the batch manifest afterwards.

### TERRITORY_SLIDER_PROFILE — selectable, and how

**It is selectable.** Verified by construction on both bundles.

Nothing in production selects it: `TeamDecisionOptions.evaluate` is the only
seam that reaches it, and the harness holds that seam. Select it with the bot
name **`lobster-slider`** in a spec's `bots` array (`lobster-slider-royal` is
the royal-exclusion ablation, meaningful only on a cell fielding a king), or
name the same seam as data on a contender:

```json
"contenders": { "slider": { "evaluator": "territorySliderEvaluator" } }
```

Because the arms then differ by seat contents rather than by build or env,
`aggregate.js` needs the substitution **declared**:

```sh
node tools/simworker/bin/aggregate.js --batch <dir> --base base \
     --subject-map base=lobster-territory,treat=lobster-slider
```

Every other seat must still match exactly; that check stays on.

### `admission` / arch/s2 — BLOCKED, and do not work around it

`arch/s2` exists only on the cloud session's machine. It is **not on GitHub**:

```sh
git ls-remote --heads origin 'arch/*'    # verified 2026-08-27: prints nothing
```

`build-bot.sh` will refuse the ref rather than guess. **Do not substitute a
branch that happens to build.** Skip P6, and write one line in findings.md
saying it was skipped because the branch is unpublished. Re-check before each
batch — if it appears, P6 becomes runnable with no other change.

---

## 4. The simulation program

### The headline shape

`25x25`, 3 teams x 6 units, `budgetMs: 2000`, `turnCap: 120`, anchored
placement. Every cell in `tools/simworker/specs/` is that shape with one axis
moved.

**Rosters** (6 a side) — piece class is the axis on which this program's
verdicts most often *sign-flip*, so it is the axis worth spending on:

| roster | units |
|---|---|
| `snake6` | 6 snakes — **the inert null roster** |
| `snake5-pawn` | pawn + 5 snakes |
| `snake5-knight` | knight + 5 snakes |
| `snake5-queen` | queen + 5 snakes |
| `mix-king` | king, queen, rook, knight, snake, snake |

`snake6` is not just one more roster. Treatments gated on piece class — I2's
slider profile, the staging guard — are **bit-identical to their baseline**
there. Any delta it shows is the noise floor, measured inside the same batch,
on the same box, in the same hour.

**Conditions:** potions {off, on} x hazards {none, interior} x food {normal,
sparse}. Interior hazards are `cross` at `damageRatio 0.15` — a deterministic
pair of bands every team must cross or route around, priced as a cost rather
than a wall. **Move one axis at a time.** At these block counts there is no
power to interact them, and a cell that moves two cannot say which one acted.

### Block counts

- **16 blocks minimum for a placement claim.** A block is one seed through all
  3 seat rotations = 3 games. 16 blocks = 48 games per arm per cell.
- **4-8 blocks for mechanism-first exploration.** Enough to spot a mechanism
  separation worth promoting; never enough for placement.
- Seeds nest: a 16-block run contains the 8-block run's seeds, so adding blocks
  is strictly stronger rather than a different experiment.
- **One A/A null cell per batch, sized like the treatment cells.**

### Priority order

Run a **pilot first**, then work down. Each item is one paired batch with its
null and its findings stub.

| P | question | arms | spec |
|---|---|---|---|
| **P0** | how long does one real game take *on this box*? | either bundle, 2 blocks | `p0-pilot.json` |
| **P1** | does the perf substrate change **strength**, not just speed? | `integrated` vs `perf-substrate` (two bundles, defaults) | `p1-substrate-headline.json` |
| **P2** | the deployed-relevant re-baseline at the target shape | one bundle, `CENTAUR_ENGINE` lobster vs legacy | `p2-legacy-rebaseline.json` |
| **P3** | I2's budget gradient, 1000 ms -> 2000 ms | one bundle, `lobster-territory` vs `lobster-slider` | `p3-slider-2000.json` |
| **P4** | tier-truth `full` vs `expiry`, potion-rich | one bundle, `CENTAUR_TIER_TRUTH` | `p4-tiertruth-potions.json` |
| ~~**P5**~~ | ~~the WASM flip gate~~ | **RAN IN BATCH 1; CANNOT BE RERUN** — the flag and the layer under it were removed 20260829 by owner ruling | `p5-wasm-arena.json` |
| **P6** | the admission governor | **BLOCKED** — arch/s2 unpublished | `p6-admission.json` |
| **P7** | CL1's two promotion gates | perf-substrate, `CENTAUR_CLUSTER_SEED` and `CENTAUR_UNIT_FATALITY`, each alone then both | `p7-cl1-gates.json` |

Each spec's `_comment` block carries the full reasoning, the traps, and what to
look at. **Read it before running the spec.** Notably:

- **P2** is at 2000 ms for a reason: legacy's chunk dispatch is not preemptible.
  Below ~1000 ms it plays its *fallback move* and its own telemetry says so
  (`statesEvaluated: 0`, `deadlineHit: true`). 2000 ms is the first shape where
  the comparison is honest.
- **P5** ran in batch 1 and is not rerunnable: the flag was eliminated by owner
  ruling on 20260829 and its rerun (P5R) is withdrawn from batch 2. The reading
  it left behind is kept, because it is the exhibit behind a standing rule — a
  null could equally have meant "the arm never engaged", since the wasm path
  refused itself silently, per partition, whenever inputs were not resident.
  "Engaged and did not help" and "never engaged" are different findings, and
  that is why the ledger now refuses a result whose arm cannot be shown to have
  run. See `tools/learnloop/promotion-ledger.json`, `CENTAUR_WASM`.
- **P7** measures each flag **separately** before both together. Two features
  behind one flag is an experiment that measures their sum. Watch for CL1's own
  honest negative: final floors were slightly *worse* on 14 of 26 replay
  positions, and the live arm is what adjudicates that against a mechanism story
  of fatal stagings 41->0 and teammate kills 25->4.

### Running a paired cell

```sh
BATCH=~/lobster/results/20260827-p1
node tools/simworker/bin/run-pair.js \
  --batch $BATCH \
  --spec  tools/simworker/specs/p1-substrate-headline.json \
  --arm   integrated=~/lobster/bundles/integrated \
  --arm   perf-substrate=~/lobster/bundles/perf-substrate \
  --workers 2 \
  --note  "P1: does the perf substrate change strength?"

# the mandatory null, same box, same night
node tools/simworker/bin/run-pair.js \
  --batch $BATCH --spec tools/simworker/specs/n0-aa-null.json \
  --arm nullA=~/lobster/bundles/integrated \
  --arm nullB=~/lobster/bundles/integrated --workers 2

node tools/simworker/bin/verify-null.js    --batch $BATCH --null nullA,nullB
node tools/simworker/bin/aggregate.js      --batch $BATCH --base integrated
node tools/simworker/bin/batch-manifest.js --batch $BATCH
```

An env-flag arm carries the flag in the arm string:

```sh
--arm expiry=~/lobster/bundles/integrated \
--arm full=~/lobster/bundles/integrated,CENTAUR_TIER_TRUTH=full
```

`run-pair.js` **refuses a single arm.** That is deliberate; see §5.

---

## 5. Methodology laws

Full text: **`tools/simworker/context/METHODOLOGY.md`**. Read it once, properly.
The five that will bite you first:

1. **A concurrent null cell is mandatory, and sized like the treatment.** I4's
   null showed outcome CIs excluding zero *on a provably inert path* at 4
   blocks. I6's single-game null of two byte-identical bots reported a placement
   delta of −0.500 with intervals excluding zero. A batch without a null
   produces no claimable numbers.

2. **Paired seeds, 3-seat rotation, and the BLOCK is the unit.** Board geometry
   is asymmetric; a block puts every bot in every seat once and every *pair* in
   every seat-pair once. Resampling games instead of blocks divides the standard
   error by √3 for free and manufactures significance out of seat geometry.

3. **Mechanism metrics are primary; placement resolves to ~±0.10 at 16 blocks.**
   A smaller placement delta is not a small effect — it is no effect this design
   can see. Mechanism moves first and often sits 5-25× outside the null band
   where placement has not moved at all.

4. **Budget noise is part of the experiment.** One arm pair at a time. Launch
   arms simultaneously, same `--workers`, record loadavg. Do **not** run three
   experiments at once to fill cores — fill them by giving one pair more
   workers. An arm was retracted from this program because three concurrent 1 s
   searchers on four cores did not get equal service.

5. **`boundsInversions` and `plansEvaluated` are RETIRED.** Base 86 / null 8075
   / mine 1197 **on identical binaries**. They diagnose a broken arm; they never
   carry a verdict.

And the one that saves the most nights: **anything measurable without a race
should be measured without a race.** Take a position out of a replay, fix one
plan, price it both ways under an unbounded budget, report the paired
difference. No anytime noise exists in that number. METHODOLOGY §6 has the
pattern.

---

## 6. Results protocol

### Branch and layout

**A NEW branch per batch, from `sim/worker-kit`:**

```sh
cd ~/lobster/Chris-Centaur
git fetch origin
git checkout -b sim-results/local-20260827 origin/sim/worker-kit
```

Name: `sim-results/local-<YYYYMMDD>`. Layout:

```
results/<batch-id>/
  manifest.json        # batch-manifest.js — schema v1
  findings.md          # verdict lines + tables + honest nulls
  analysis.json        # aggregate.js
  analysis.md          # aggregate.js
  pairs/<sweep>.json   # run-pair.js — arms, host, loadavg trace
  arms/<arm>/
    arm.json           # bundle stamp + env overrides
    <sweep>/manifest.jsonl     # one summary row per game — NEVER pruned
    <sweep>/spec.json          # spec as run + provenance + resume records
    <sweep>/*.jsonl.gz         # replays
```

`manifest.json` is the deliverable. It carries: schema version, batch id, **git
SHA of every bot build**, resolved cell configs, arms and their env, seeds,
block counts, cap rates, integrity counters, host and CPU, the loadavg trace,
and the replay-sampling record. Generate it with `batch-manifest.js`; do not
hand-write it.

### Size cap

**~200 MB per batch.** Over that:

```sh
node tools/simworker/bin/batch-manifest.js --batch $BATCH --prune --keep-per-cell 6
```

Pruning keeps a **documented, paired sample** of replays (the same gameIds in
both arms, so the sample stays usable for board-level probes) and records
exactly which gameIds kept a replay and which did not. **The per-game summary
rows in `manifest.jsonl` are never pruned** — they carry placement, health
counters and shape facts, which is most of what an aggregation reads. A pruned
batch is still fully analysable; it just cannot be re-mined at the turn level
outside the sample.

### Push and PR

```sh
git add results/
git commit -m "Sim results: <batch-id>"
git push -u origin sim-results/local-20260827

gh pr create --draft --base sim/worker-kit \
  --title "Sim results: <batch-id>" \
  --body-file results/<batch-id>/findings.md
```

**Draft PR, base `sim/worker-kit`, title exactly `Sim results: <batch-id>`.**
That title is how the cloud session finds your work.

### Hard rules

- **NEVER push to any branch outside `sim-results/*`.** Not `sim/worker-kit`,
  not `main`, not a bot branch.
- **NEVER modify bot source.** Not to fix a build, not to add a counter, not
  "just to try". If a build fails on this machine, **that is the finding** —
  report it in findings.md with the error.
- Tooling-only commits under `tools/` **are** allowed on a results branch if a
  runner bug blocks you. Document the change in that batch's findings.md,
  including what it means for numbers taken before it.

### findings.md per batch

Every batch gets one. Minimum:

- **Verdict lines** — one sentence per question, with the number and its
  interval, and **the null it was read against**.
- The aggregate tables (paste from `analysis.md`).
- **The nulls, honestly.** If the A/A null excluded zero, say so at the top and
  state that the batch cannot resolve effects of that size. That is a real
  result, not a failure.
- Host, loadavg range, what else was running, whether any sweep was resumed.
- **What went wrong.** Crashed cells, non-zero exits, skipped priorities and why.
- SHAs. Every one.

---

## 7. Cadence and scaling

**Fill cores with PAIRED arms — always. Never treatment-only.**

Both arms get the same `--workers`. To use more of the machine, raise `--workers`
on *both* arms of one pair; do not start a second experiment.

```
cores available      suggested
4                    --workers 1   (2 concurrent games)
8                    --workers 2   (4 concurrent games)
16                   --workers 3-4 (leave headroom; contention is not free)
```

Leave real headroom. The decision worker pool wants threads of its own, and a
box at 100% utilisation is a box where the two arms stop getting equal service —
which is the failure mode that retracted an entire arm from this program.

**Size the batch from the pilot, not from hope.** Run `p0-pilot.json` first and
read `games/hour` off the runner. Then:

```
games per arm = cells x blocks x 3
```

A 16-block, 3-cell cell is 144 games per arm, 288 for the pair. At the headline
shape a game is minutes, not seconds — 3 teams x 2000 ms is 6 s of pure decision
time per turn before any other cost. **Expect roughly one priority cell per
overnight batch on a 4-core box**, more with more cores. That is the owner's
"significant compute time each" working as intended.

Long overnight batches are fine and expected. Record host specs in findings.md
(`nproc`, `free -g`, CPU model) — `batch-manifest.js` captures most of it, but
say what else the machine was doing.

---

## 8. What NOT to do

- **No pushes outside `sim-results/*`.** Ever.
- **No bot-source edits.** A failing build is a finding, not a task.
- **No unverified claims.** Every number with its null. If there is no null,
  there is no claim.
- **No single-arm "just to see" runs feeding a table.** `run-pair.js` refuses
  them; if you use `run-sweep.js` directly for throughput, keep its outcome
  numbers out of every table.
- **No substituting a branch that happens to build** for one that does not exist.
- **No reviving `boundsInversions` or `plansEvaluated`** as evidence.
- **No re-running only the arm that failed.** That unpairs the cell. Rerun the
  pair, or document the loss.
- **No quiet renaming, retuning, or "fixing" of a cell mid-batch.** Finish it,
  document it, cut a new cell.

---

## 9. How the cloud session picks results up

The owner tells it a batch landed, or it finds your **draft PRs** titled
`Sim results: <batch-id>` against base `sim/worker-kit`.

It will not have your machine, your terminal, or your memory of the night.
**Keep every batch self-describing**: `manifest.json` for the facts,
`findings.md` for the reading, `analysis.md` for the tables, replays (or a
documented sample) for re-mining. If a batch needs you present to be understood,
it is not finished.

---

## 10. FAQ

**The branches moved since this document was written.**
Expected — `claude/cluster-lookahead` moved twice in the hour it was written.
`git fetch --all`, rebuild the bundle, and **record the SHA you actually built**
(`build-bot.sh` stamps it; `batch-manifest.js` lifts it into the manifest).
Never quote a branch name as provenance. If a SHA in this document disagrees
with what you built, yours is right — note the difference in findings.md.

**A cell crashed mid-batch.**
Document and continue. Completed games are already on disk (a manifest row per
finished game). Note it in findings.md with the error, then either rerun **the
whole pair** with `--resume` — both arms together — or drop the cell and say so.
`aggregate.js` intersects gameIds across arms and reports how many it dropped,
so a partial cell degrades honestly rather than silently.

**The A/A null came back significant.**
That is the finding. Report it at the top of findings.md, state that the batch
cannot resolve effects of that size, and do **not** report a treatment effect of
comparable magnitude from it. Then quieten the box, or add blocks, and rerun.

**The arms finished different numbers of games.**
`run-pair.js` warns; `aggregate.js` pairs only the intersection and reports the
drop. Say so in findings.md. If the gap is large, the pair is compromised —
rerun rather than reporting it.

**`build-bot.sh` fails on `npm ci`.**
Report it. Do not edit `package.json` or `package-lock.json` to work around it.

**tsc printed errors.**
6 errors in `decision-logger.ts` and `routes/activity.ts` are expected and
harmless. Any other error, or a missing artifact, is a real failure — the script
distinguishes them and tells you which you have.

**Can I add a spec?**
Yes. Edit `tools/simworker/bin/make-specs.js` and regenerate, so the axes stay
consistent across cells, then commit both the generator change and the specs on
your results branch. Do not hand-edit a spec JSON — the next regeneration
silently overwrites it.

**Should I run P6 against a different branch since arch/s2 is missing?**
No. Skip it, one line in findings.md, re-check `git ls-remote --heads origin
'arch/*'` next batch.
