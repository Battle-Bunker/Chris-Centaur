# BRANCHING — how a change gets into the LOBSTER program

**Status: BINDING. Owner ruling, 2026-08-30. This replaces the paradigm in which
unvalidated work accumulated on one long-lived branch behind configuration
defaults.**

Written for agents. If you are about to start work, the first question is not
"which file" — it is **which lane**, because the lane decides the branch, the
evidence you owe, and the words you are allowed to use about it.

---

## 0. The ruling, in the owner's own frame

Two lanes, and nothing else:

> **(a) JOINT COLLECTIONS.** Strategy candidates at the decision joints live
> in-tree as data — chosen at bot-config time AND available for dynamic
> within-bot selection (every evaluator is a member of a collection). Adding a
> member to a collection = normal commit.
>
> **(b) EVERYTHING ELSE** (architecture: which joints exist, how they compose,
> kernel/search semantics): FEATURE BRANCHES built by delegated agents in their
> own worktrees, validated (benchmarks + long-running paired batches; multiple
> branches may be retained in parallel for testing), then MERGED to the
> session's primary branch. Say MERGE, never "promote"; never "dark".

And the vocabulary ban that goes with it:

> **"dark", "promoted/promotion" in owner-facing communication. Use:
> in-collection/selectable; validated; merged.**

The thing the ban bites is **architecture landing on a default without a live
paired result** — the depth landing is the exhibit. It does *not* bite a
collection member that is merged and simply not selected yet: that is lane (a)
working exactly as designed.

---

## 0.1. The refactoring licence — read `docs/REFACTORING.md`

A second owner ruling, **2026-09-01**, sits alongside the lane ruling and is
equally binding:

> **Radical refactoring of architecture is entirely allowed and encouraged and
> legacy structures can and should be thrown away to make room for the new more
> powerful approaches to be implemented more elegantly without being encumbered
> by the need to do awkward backwards compatibility to interfaces and
> dependencies that no longer make sense.**

Deletion is preferred over compatibility: no deprecated-but-kept fields, no
shims, no dual writes. The per-unit candidate-move heuristic analytics table was
deleted under it, and **the human-legibility / signalling framework that
replaces it will be designed later**, once the new architecture settles — until
then, prefer deletion over accumulating mess rather than preserving the old
surface through a refactor.

The licence changes **what you may throw away**. It does not change **which lane
you are in** or what evidence you owe: everything below still applies, and a
refactor that moves joints, composition or kernel semantics is lane (b).

Full text, the refusals that bound it, and the 2026-09-01 worked example:
**`docs/REFACTORING.md`**.

---

## 1. The boundary rule

> **Lane (a) if the change adds or edits a MEMBER of a collection that already
> exists at a joint that already exists. Lane (b) if the change alters WHICH
> joints exist, HOW they compose, or what the kernel/search is allowed to
> conclude.**

The one-question test: **could the shipped bot select this by configuration
alone, with the rest of the engine byte-identical?** If yes → lane (a). If
answering it requires the words "and also the search now …" → lane (b).

### Lane (a), with this repo's examples

The joints are the registry's five slots (`src/lobster/registry.ts`,
`SLOT_IDS`): `move-selector`, `evaluator-selector`, `evaluator`, `aggregator`,
`scheduler`. A candidate is a `StrategyEntry` — identity, priors, cost model,
empirical record — and a bot runs the members a `Slate` names.

The potion doctrine is the worked example, and it has now been through both
halves of the lane. Four evaluator members were merged and named by no slate:

| member | file | joint |
|---|---|---|
| `eval/dodge-discount@1` | `src/lobster/evaluate/dodge-discount.ts` | `evaluator` |
| `eval/potion-seek@2` | `src/lobster/evaluate/potion-seek.ts` | `evaluator` |
| `eval/potion-control@1` | `src/lobster/evaluate/potion-control.ts` | `evaluator` |
| `eval/attack-window@1` | `src/lobster/evaluate/attack-window.ts` | `evaluator` |

Those four were **not** the banned pattern. They were merged, they were members
of the evaluator collection, nothing on the production path imported them, and
the registry throws on a name it does not hold — so a member becomes live by
being **configured in** and in no other way. That is the owner's own model of
lane (a), and it is why "these are dark" would be both banned wording and
factually the wrong description.

**What was missing was the selection half, and its cost was measurable.** With
`SlateId` at one member no `BotConfig` could name a slate holding them, so no
configurable bot read a potion at all: every potions-on game the program had
played was played by a potion-unaware bot, and every potion arm in the roster
was unrunnable rather than merely unrun. "Merged and unselected" was, in
practice, a synonym for unmeasurable.

`SLATE_POTION_AWARE` closes that. It is the shipped evaluator lineup plus the
four terms, seated at `eval/attack-window@2`, `eval/potion-seek@3`,
`eval/potion-control@2` and `eval/dodge-discount@2` — new ids, because seating
a term means a non-zero weight and the params tree is part of an entry's
fingerprint, so under the identity law that is a new entry and never an edit of
a measured one. Every seated term is **advisory**: it reaches `est` through
`evaluate/bound.ts`'s `advisoryEst`, orders plans the floor ties and can move
no bound, no ceiling and no refusal. `DEFAULT_BOT_CONFIG.slate` is still
`legacy` and the byte-identity gates still assert it, so in owner-facing text
the potion doctrine is now **merged and selectable, selected by no default**.

`BotConfig` (`src/lobster/bot-config.ts`) is the other half of the same lane:
`slate`, `territoryRefine`, `candidates.unitFatality`, `depth.plyCap`,
`sampledCap`, `edgeEv` and `search.clusterEnum` are all selections among
members, expressed as data, per seat. A new field there, or a new row in a
collection, is a **normal commit on the primary branch**.

**What lane (a) still owes, stated plainly:** config-time selection works today
and now has more than one thing to select. *Dynamic within-bot* selection among
entries — the scheduler buying an evaluator invocation on value per microsecond
rather than running a fixed lineup — is the registry's next increment and is
not built yet. That gap is lane (a) work: it adds no joint. Until it lands,
"available for dynamic selection" is a design commitment, not a shipped
capability. Do not describe it as done.

### Lane (b), with this repo's example

**The depth wiring is lane (b) and is the exhibit for why the lane exists.**
Commits `50ffc84 → 4fd22cf → 4b85bd3` did not add a member to a collection. They
changed what the search *is*: cluster threads continue past the turn over the
door, the advanced board is priced through the same evaluator in the same units,
and a deepened line is **published into the origin branch's belief at the
precision it earned**, where `better()` and the stager then resolve among
floor-undominated candidates on that belief. Which joints exist, how they
compose, and what the kernel may conclude all moved. There is no configuration
of the pre-depth engine that selects it.

The same landing is the exhibit for the failure mode: it switched two
never-raced features on by default (cluster enumeration and the deep layer) and
the change was legible only because the distiller caught it. Under this policy
that lands on `feature/<name>`, is raced as a batch arm, and is **merged on
validation** — not defaulted on inside an accumulating branch.

### Cases that look ambiguous and are not

| change | lane | why |
|---|---|---|
| new evaluator term, in no slate | **a** | member of an existing collection |
| a new SLATE naming existing members | **a** | a collection member, not a joint |
| new `BotConfig` field selecting among existing members | **a** | selection is data |
| a field that turns an existing pass off for a configured bot | **a** | a budget statement, provided no default moves and the dependency is published |
| retuning a member's params (mints `@2` per the identity law) | **a** | same joint, new member identity |
| a new registry SLOT | **b** | a joint that did not exist |
| changing what a bound may be written from | **b** | kernel semantics |
| changing how belief resolves between candidates | **b** | composition |
| performance work that changes how many plans a budget prices | **b** | throughput that moves strength is a strength change (this is P1's founding argument) |

When you genuinely cannot tell: **treat it as lane (b).** A lane-(b) change run
through lane (a) is unvalidated architecture on the primary branch, which is the
thing the ruling forbids. A lane-(a) change run through lane (b) costs one
branch and one batch arm.

---

## 2. The branches as they stand, 2026-09-01 (owner ruling, twelfth message)

| branch | role |
|---|---|
| `primary` | **THE PRIMARY / VALIDATED-BASELINE BRANCH, going forward.** Cut at the `claude/mid-turn-collision-logic-mkxurg` tip on 2026-09-01. Every `feature/<name>` is cut from here; every merge lands here. This is the name to use in all new work and all owner-facing text. |
| `claude/mid-turn-collision-logic-mkxurg` | **HISTORICAL ALIAS of `primary`.** Kept, not deleted or moved, so that PR #11 and the PR-base relationships built on it stay valid. Retired once its open PRs close; do not cut new work from it — cut from `primary`. |
| `claude/cluster-lookahead` | **THE SEARCH-ARCHITECTURE FEATURE LINE.** Depth + the entry registry + per-branch belief, accumulated before this policy existed. Declared what it factually is. Its merge decision is the pending cross-branch batch (below). Its successor work is named `feature/<name>`, cut from `primary` like every other lane-(b) change — `claude/cluster-lookahead` itself is not a place to keep adding new architecture once its own pending decision resolves. |
| `sim/worker-kit` | **THE HARNESS BRANCH.** `tools/simworker/` — the local sim session fetches this branch and only this branch. Not an engine branch; it carries no lane-(a) or lane-(b) engine change. |
| `coordination` | **DATA BRANCH, not a code branch.** Cut from `primary`; carries `coordination/` — synced snapshots of the coordinating agent's scratchpad knowledge artifacts, for owner access if the box that holds the live scratchpad becomes unreachable. Not intended to merge; see `coordination/README.md`. |

`claude/cluster-lookahead` is a **retained parallel test arm**, which the ruling
explicitly permits ("multiple branches may be retained in parallel for
testing"). It is not a second primary and nothing may be cut from it.

### The pending decision

**Batch 2's P11 is the merge decision for `claude/cluster-lookahead`.** It is a
branch-versus-branch paired sweep: a bot built from the baseline branch tip
against the default bot from the feature branch tip, which carries depth and the
cluster enumeration always-built. The spec is
`tools/learnloop/specs/batch2/p11-scout.json`, generated from the
`CENTAUR_SCOUT` row of `tools/learnloop/promotion-ledger.json`.

That shape **dissolves** the question that was open before the ruling — "does
the default bot carry the two unraced features, or do they go config-off until a
sweep validates them?" There is no default to argue about: the branch either
merges on the evidence or it does not.

---

## 3. Going forward — the lane (b) procedure

1. **Cut** `feature/<name>` from the primary branch tip (`primary` — historical
   alias `claude/mid-turn-collision-logic-mkxurg`). Not from another feature
   branch.
2. **Build it in your own worktree**, on your own temp branch, pushing with
   `git push origin HEAD:feature/<name>` and a rebase-retry on rejection. Never
   work in the main checkout.
2b. **PUSH-EARLY RULE (owner ruling, 2026-09-01, twelfth message).** Push your
    branch at its FIRST commit (`git push -u origin HEAD:feature/<name>`, or
    `HEAD:<branch>` for non-feature work) and again after every cycle — a green
    run or an explicitly WIP-marked state is fine to push, an unpushed branch is
    not. Work must live on GitHub continuously: usage exhaustion or a container
    interruption can lock the owner out of any one box, and a branch that only
    exists on disk there is a branch the owner cannot see or hand to anyone
    else. This applies to every branch an agent creates, feature or otherwise —
    not only the ones this document's lane procedure names.
3. **Benchmark it.** Deterministic probes, the engine suite, and the paired
   deterministic measurements the change's own claims need. Necessary, never
   sufficient — see `tools/learnloop/README.md` for the exhibit that bought that
   rule.
4. **Race it as a batch arm.** The kit builds a bundle per git ref
   (`tools/simworker/build-bot.sh <ref> <bundle-dir>`) and `run-pair.js` launches
   the arms at the same instant in separate processes, so two arms from two
   different refs in one paired sweep is the harness's normal case, not an
   extension of it. Batch 1's P1 ran exactly that shape: `integrated` at
   `66904d2` against `perf-substrate` at `8059b86`, 144 games paired, 0 dropped.
   The arm looks like:

   ```sh
   tools/simworker/build-bot.sh origin/primary ~/lobster/bundles/baseline --fetch
   tools/simworker/build-bot.sh origin/feature/<name>                          ~/lobster/bundles/<name>  --fetch

   node tools/simworker/bin/run-pair.js --batch $BATCH \
     --spec tools/learnloop/specs/batch2/<spec>.json \
     --arm  baseline=~/lobster/bundles/baseline \
     --arm  <name>=~/lobster/bundles/<name> --workers 2
   ```

   The mandatory A/A null pairs **like with like** — one bundle, twice — and it
   is sized like the treatment.
5. **Merge on validation.** A branch that clears its arm against the verified
   null merges into the primary branch and its ledger row is recorded as
   **validated**. A branch that does not, does not merge; it stays a retained
   arm or it is deleted, and the reason is written down.
6. **Retire the branch.** A merged feature branch is not kept alive to receive
   more work. The next change is the next `feature/<name>`, cut fresh from the
   new primary tip. Long-lived accumulation is the pattern this policy exists to
   stop.

### The refusals, so an agent can check itself

- **Never default-on architecture that has not been raced live.** If a lane-(b)
  change must ship a default to be testable, that default is the treatment arm
  of a batch, on a feature branch — not a commit to the primary branch.
- **Never cut a feature branch from another feature branch.** Two unvalidated
  parents make a result that cannot attribute its own effect.
- **Never merge a feature branch on a deterministic probe alone.**
- **Never write "promote", "promoted", "promotion" or "dark" in owner-facing
  text.** Use **merged**, **validated**, **selectable / in-collection / not yet
  selected**. Internal identifiers, historical ledger row names and file paths
  keep their spelling — `promotion-ledger.json` is a filename, not a claim — and
  `tools/principal-glossary/` holds both words as `corrected` with the
  replacements prescribed, so `check-briefing.js` will block a draft that uses
  them.

---

## 4. Where the machinery lives

| what | where |
|---|---|
| the joints and their members | `src/lobster/registry.ts` |
| config-time selection among members | `src/lobster/bot-config.ts` |
| the validation record and the next batch | `tools/learnloop/` (home: `claude/cluster-lookahead`, mirrored verbatim to `sim/worker-kit`) |
| the human view of that record | `tools/learnloop/PROMOTION-STATUS.md` (alias: `VALIDATION-STATUS.md`) |
| bundles, arms, paired sweeps, the null | `tools/simworker/` on `sim/worker-kit` |
| the local session's mandate | `HANDOFF.md` on `sim/worker-kit` |
| owner-facing vocabulary enforcement | `tools/principal-glossary/` |
| the licence to delete legacy structures | `docs/REFACTORING.md` |
