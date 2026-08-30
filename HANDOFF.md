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

### The policy behind the batches — read it once

**`docs/BRANCHING.md` on `claude/cluster-lookahead` is the binding policy for how
a change reaches the bot** (owner ruling 2026-08-30). It is not on this branch —
this branch carries the harness, not the engine — and it is worth one fetch,
because it is what your batches are now deciding.

Two lanes, and nothing else:

- **(a) A strategy candidate at an existing decision joint** is a member of that
  joint's collection, in the tree, chosen by bot config. Adding one is a normal
  commit and needs no branch of its own.
- **(b) An architecture change** — which joints exist, how they compose, what the
  kernel/search may conclude — gets its own `feature/<name>` branch cut from the
  validated baseline, is validated by benchmarks **plus a long-running paired
  batch** (yours), and is then **merged**. Branches may be retained in parallel
  as test arms while that is decided.

**Your batches are the validation half of lane (b).** A branch-versus-branch
arm here is not a curiosity — it is how an architecture change earns its merge.
`P11` in batch 2 is the first one specified that way.

**Vocabulary, since it appears in what you write back:** the words are **merged**,
**validated**, and **selectable / in-collection**. "Dark" and
"promoted / promotion" are banned in owner-facing text by the same ruling. The
stored ledger statuses and the `promotion-ledger.json` path keep their old
spelling as internal identities — a path is not prose — and the rendered page is
now titled *Validation status*, with `VALIDATION-STATUS.md` pointing at it.

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

### The branch roles, as of 2026-08-30

Under the branching ruling the two engine branches are no longer peers, and the
spec files now name them by role rather than by nickname:

| branch | role | the arm name specs use |
|---|---|---|
| `claude/mid-turn-collision-logic-mkxurg` | **the validated baseline** — the primary branch, what the bot *is* | `baseline` (was `integrated`) |
| `claude/cluster-lookahead` | **the search-architecture feature branch** — depth, the entry registry, the per-branch belief; the deep layer and the cluster enumeration always-built | `search-arch` (was `perf-substrate`) |

`sim/worker-kit` — this branch — is the harness and carries no engine change.

**A branch-versus-branch pair is the normal case here, not an exception.**
`build-bot.sh` resolves any git ref to a bundle, `run-pair.js` launches the arms
at the same instant in separate processes, and the pairing is by `gameId`
afterwards. You have already run one: batch 1's **P1** raced `integrated` @
`66904d2` against `perf-substrate` @ `8059b86` and paired 144 games with 0
dropped and 0 pairing problems.

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
   own spec with the config merged onto **the seat it names**, and leaves
   `sweepId`, `cells`, `seeds` and `rotateSeats` byte-identical, so the pairing
   guarantee holds: same boards, same seeds, same seat rotation, two
   differently-configured bots. A spec can also declare contenders by name:

   ```json
   "contenders": { "refiner": { "base": "lobster-territory",
                                "bot": { "territoryRefine": true } } },
   "bots": ["refiner", "lobster-territory", "reflex"]
   ```

### A BOT CONFIG REACHES ONE SEAT — 20260830

**Until 2026-08-30 an arm's `bot=` was merged into every lobster contender the
spec seated.** On a spec that seats one lobster that is invisible. On a spec
that seats two it is a measurement defect and a silent one: the treatment arm
becomes two ablated lobsters against a control arm of two intact ones, so if the
knob is worth the same to both seats **the within-game contrast cancels exactly**
and the arm reports a null it never had the power to tell from a real result.
Only a seat the config did not touch — a `reflex` seat — stays unconfounded, and
reading a lobster question off the reflex seat is a detour, not a design.

Two spellings now, and the second is the one a multi-lobster spec must use:

```sh
# THE SUBJECT SEAT — allowed only when exactly one seat can be meant.
--arm 'treat=<bundle>,bot={"sampledCap":true}'

# THAT SEAT, BY NAME. Repeatable; each config lands on its own seat and no other.
--arm 'treat=<bundle>,bot@noGain={"candidates":{"gainOrdering":false}}'
--arm 'treat=<bundle>,bot@gainOff={...},bot@refineOn={...}'
```

- A bare `bot=` on a spec that seats **two or more** configurable contenders is
  a **REFUSAL**, printed with both candidate seats and the `bot@` line that
  fixes it. It fires before anything launches, so a refused pair leaves no half
  batch on disk.
- `bot@<seat>=` reaches **any** seated seat whose base is a lobster
  (`lobster-material` included). A seat the spec does not seat, or one whose
  base is `reflex`/`legacy`/`neutral`, is refused rather than silently ignored.
- The two forms may not be mixed in one arm.
- **Every spec in `tools/simworker/specs/` and `tools/learnloop/specs/batch2/`
  seats exactly one reachable contender, so every batch-2 arm line is unchanged
  and still resolves to `lobster-territory`.** Nothing you already had planned
  needs retyping.
- `arm.json` and the batch manifest now record `seatConfigs` — the RESOLVED
  seat → config map — beside the older `botConfig`, and `verify-null.js` checks
  it: two arms carrying the same config aimed at different seats are two
  different games, not an A/A pair.

The gate:

```sh
node tools/simworker/bin/selftest.js                    # the transform, 24 assertions
node tools/simworker/bin/selftest.js --bundle <dir>     # + a real two-contender pair
```

With `--bundle` it plays two lobster contenders carrying different configs in
one game and reads the per-seat `health[].mechanism.flags` stamp — the bot the
engine actually resolved — asserting each seat shows its own config and neither
shows the other's. Without a bundle that layer **skips loudly**; a transform
that looks right and a stamp that reads right are different claims.

### SEATING BOTH CONTENDERS IN ONE GAME — the cheapest design available

**The roster-ladder pattern.** When the question is "does A beat B", and both A
and B are bots you can seat, put them in the **same game** instead of in two
arms. The 20260830 sandbox resolved a five-rung roster ladder in 144 games this
way; the same question as paired arms costs several times more.

```json
"bots": ["lobster-territory", "lobster-material", "reflex"]
```

Then the treatment reading is **within-game**:

    G = sharePar(lobster-territory) − sharePar(lobster-material)

computed per game and blocked over seeds, with no arm pairing needed for it at
all.

**The pairing semantics, which are different from a treatment pair and must not
be confused with one.**

- **The two arms are IDENTICAL — it is an A/A pair, and it is self-flooring.**
  One paired run buys two things at once: the A/A floor on this cell, at this
  block count, on this box; and the treatment reading G, whose own run-to-run
  floor is *the between-arm difference of G*. That is the floor to quote — not
  the floor on either seat's sharePar separately.
- **The contrast is between SEATS, not between arms.** `aggregate.js --subject`
  reads one seat; the ladder needs both, so read the per-seat rows and difference
  them yourself, pooled over both arms.
- **Seat rotation is what makes it legal.** `rotateSeats` puts every bot in
  every seat exactly once per block, so G is not a statement about board
  position. Never run this pattern with `rotateSeats: false`.
- **The seats interact, and that is the point and the limit.** A within-game G
  measures A against B *in each other's presence*. It is the right instrument for
  "which of these should we field" and the wrong one for "what would A score
  alone", because the third seat's fate is part of both numbers. Say which you
  measured.
- **`sharePar` is share-of-end-weight × teams, par 1, so the seats SUM to the
  team count.** A within-game G is therefore mechanically anti-correlated
  between the two seats: one seat's gain is partly the other's loss. Read it as
  a contrast, never as two independent effects.
- **A config arm on top of this seating must be targeted.** This is exactly the
  two-lobster shape, so `bot=` is refused; write `bot@<seat>=`.

Where it applies, it is the recommended design. Where it does not — a
branch-versus-branch merge decision such as P11, where the two things being
compared are whole BUNDLES and cannot share a board — the paired-arm design is
the only one available, and it is priced accordingly.

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

**THE SEARCH-LAYER TEARDOWN HAS LANDED TOO (20260830) — there are no flags
left.** The paragraph that used to stand here listed six "still flags" and is
superseded. Nothing on `claude/cluster-lookahead` reads `process.env` in a
decision, and the `1|on|true` trap no longer exists because there is no parser
left to trap anyone.

| gone flag | what happened to it |
|---|---|
| `CENTAUR_CLUSTER_ENUM` | **DELETED, no replacement and no off switch.** The cluster partition and the exact enumeration are unconditional machinery. `botConfigFromJson` refuses a `clusterEnum` field by name |
| `CENTAUR_SCOUT` | **DELETED, and `ScoutMode` with it.** The deep layer always runs and its readings land in the branch's belief. What a bot configures is depth's RATION: `bot={"depth":{"plyCap":0}}` is the depthless arm — the same layer with an empty purse, not a second build |
| `CENTAUR_EDGE_EV` | config: `bot={"candidates":{"edgeEv":true}}` (plus `candidates.edgeEvTuning`) |
| `CENTAUR_SAMPLED_CAP` | config: `bot={"sampledCap":true}` |
| `CENTAUR_MULTISTART_SEED` | config: `bot={"multistartSeed":true}` |
| `CENTAUR_CLUSTER_SEED` | **DELETED** — the greedy seed, its flag and its tests. It is `live-failed` and the code is now gone |

**This changed batch 2, so pull before you run it.** `P8/P9-joint` is
**WITHDRAWN** — the enumeration has no off arm in any configuration of the
shipped engine and its joint partner is deleted code, so neither arm is
buildable — and its spec file is **pruned** from `tools/learnloop/specs/batch2/`
by the generator. P11 is respecified as `default` vs `depthless`
(`bot={"depth":{"plyCap":0}}`); P7F, P9, P10 and P12 carry config-named arms.
Every generated spec now prints an **ARM CONFIGS** block with the exact `--arm`
lines to type. The batch is **11 specs, 2,472 games**, and because every
scheduled spec is a two-arm pair for the first time, that total is exact rather
than an undercount.

**THAT PENDING OWNER DECISION HAS BEEN TAKEN — 20260830, and not by either
option as it was posed.** The depth landing turned the cluster enumeration and
the deep layer on by default; both are still `probe-passed` and neither has ever
been raced live. The question was "does the default bot keep carrying them, or
do they go config-off until a sweep validates them?" The ruling answered
neither: it declared `claude/cluster-lookahead` a **feature branch**, so the two
features' fate is the branch's, and **P11 is the merge decision for it** —
`baseline` against `search-arch`, two bundles, both shipped defaults. The
findings stay recorded verbatim on both ledger rows and are now marked
resolved-by-ruling in `PROMOTION-STATUS.md`. **Nothing you run pre-empts
anything; running P11 is what settles it.**

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
  separation worth escalating to a full 16-block cell; never enough for
  placement.
- Seeds nest: a 16-block run contains the 8-block run's seeds, so adding blocks
  is strictly stronger rather than a different experiment.
- **One A/A null cell per batch, sized like the treatment cells.**

**16 IS A MINIMUM, NOT A SUFFICIENT SIZE, AND TWO CELLS ARE NOW KNOWN TO NEED
MORE — 20260830.** The 16-block rule was a convention. Two measurements from the
20260830 sandbox program turned it into a floor that some cells sit well above:

- **A piece-bearing cell may not floor at 8 blocks at all.** An A/A null on a
  piece-bearing potions-ON hazard cell — two IDENTICAL bundles, identical
  configs, identical seeds — returned sharePar **+0.271 [0.037, 0.506]**. It
  excludes zero. **A cell whose own null excludes zero has no floor, and every
  delta on it is UNREADABLE rather than null.** All-snake cells at the same size
  floored cleanly at ±0.10. Extrapolating the widest measured piece half-width
  (±0.234 at 8 blocks) puts a ±0.10 floor at ~44 blocks per piece cell — and the
  crossover has never been measured, which is a batch-3 item.
- **A cross-branch pair needs ~73 blocks per cell.** Cross-bundle paired spread
  was ±0.303 at 8 blocks against a ±0.10 floor, so 8 × (0.303/0.10)² = 73.

So: **report the A/A null per cell, never pooled**, and **never borrow a floor**
— not the snake cell's for a piece cell, and not one bundle's for the other. The
same cell floored ±0.120 on one bundle and ±0.234 on the other in one night. A
piece cell whose null does not contain zero is written up as an INSTRUMENT
EVENT, and no verdict comes out of that cell.

Batch 2 ships at 16 blocks anyway, with those limits written into every spec it
affects. `tools/simworker/COORDINATION-20260830.md` says what a 16-block run may
and may not claim, and `tools/learnloop/specs/batch2/README.md` prices the
alternative in nights on this box.

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

### Batch 2's headline, and the one spec whose shape is new

**P11 is a cross-branch pair and it is the merge decision for
`claude/cluster-lookahead`.** Two bundles from two refs, both running their
shipped defaults, **no `bot=` on either arm**:

| arm | built from | what it is |
|---|---|---|
| `baseline` | `origin/claude/mid-turn-collision-logic-mkxurg` | the validated baseline |
| `search-arch` | `origin/claude/cluster-lookahead` | depth + cluster enumeration, always-built |

Three things to get right, and the spec's own `ARM CONFIGS` and `BUNDLES` blocks
carry all three:

1. **Do not add a `bot=` to either arm.** The baseline bundle predates the
   20260829 teardown and has no `src/lobster/bot-config`; `checkContenders`
   would refuse the spec — correctly, because such a bundle would ignore the
   config and play its shipped bot under your arm's name. With no config
   declared, that check never fires and both arms simply play what they ship.
2. **The A/A null is two builds of the `search-arch` bundle.** One bundle,
   twice, as always — `verify-null.js` asserts an identical bundle SHA in both
   arms. It is the `search-arch` one because that is the bundle the rest of the
   batch shares, which is the same convention batch 1 used when it floored on
   `integrated`. **P11's `baseline` arm therefore has no floor of its own**; the
   null spec says so, and a second null pair on the baseline bundle is the
   cheapest box time in the batch if you have room for it.
3. **Engagement is read on the `search-arch` arm only**, from
   `belief.deepestPlies` / `deepBranches`. `0` there is a **broken arm** and must
   be reported as a refusal, not as a null. The `baseline` arm has no counter to
   read because the deep layer is not in that build at all — which is why it
   cannot fail silently.

**Record the resolved SHA from each `bundle.json` in `findings.md`.** A
branch-versus-branch verdict that quotes branch names and not SHAs is a claim
nobody can reproduce.

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

**A cross-branch pair — batch 2's P11, and the shape every lane-(b) merge
decision takes:**

```sh
tools/simworker/build-bot.sh origin/claude/mid-turn-collision-logic-mkxurg \
    ~/lobster/bundles/baseline --fetch
tools/simworker/build-bot.sh origin/claude/cluster-lookahead \
    ~/lobster/bundles/search-arch --fetch

BATCH=~/lobster/results/20260830-batch2
node tools/simworker/bin/run-pair.js --batch $BATCH \
  --spec tools/learnloop/specs/batch2/p11-scout.json \
  --arm  baseline=~/lobster/bundles/baseline \
  --arm  search-arch=~/lobster/bundles/search-arch \
  --workers 2 --note "P11: the merge decision for claude/cluster-lookahead"

# the mandatory null — ONE bundle, twice, and it is the search-arch one
node tools/simworker/bin/run-pair.js --batch $BATCH \
  --spec tools/learnloop/specs/batch2/n0-aa-null.json \
  --arm  nullA=~/lobster/bundles/search-arch \
  --arm  nullB=~/lobster/bundles/search-arch --workers 2

node tools/simworker/bin/verify-null.js --batch $BATCH --null nullA,nullB
node tools/simworker/bin/aggregate.js   --batch $BATCH --base baseline
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
