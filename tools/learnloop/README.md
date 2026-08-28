# learnloop — the promotion ledger and the batch that follows from it

The last stage of the cluster-lookahead ladder is not a feature. It is the loop
that decides which of the eleven dark flags ever gets turned on, and it is built
around one finding the program paid for in full:

> `CENTAUR_CLUSTER_SEED` passed its deterministic ship gate outright — fatal
> stagings 41 → 0, teammate kills 25 → 4 — and then **failed live**: snake6 win
> rate 1.00 → 0.15, exhaustion deaths ×1.9. The collapse arrived through travel
> economy, a channel the probe does not measure and could not have measured,
> because the probe scores positions and the failure is about the shape of a
> whole game.

So: **a deterministic probe is necessary and never sufficient.** Only a live
paired sweep, with a concurrent verified null and a treatment arm whose
engagement is *shown*, may promote anything. That rule is not a convention here;
it is code, in `lib/ledger.js`, and `bin/selftest.js` asserts it by trying to
break it.

## The three commands

```sh
# What should the PC run next? — from the ledger, not from judgement.
node tools/learnloop/bin/make-promotion-batch.js --dry
node tools/learnloop/bin/make-promotion-batch.js --out tools/learnloop/specs/batch2

# A batch came back. Check its null, read its instrument, update the ledger.
node tools/learnloop/bin/ingest.js --batch results/<batch> \
     --null nullA,nullB --pair base=treat \
     --flag CENTAUR_WASM --engagement wasmRuns [--write]

# Re-render the human view. --check fails if it has drifted from the ledger.
node tools/learnloop/bin/render-status.js
```

And the gate:

```sh
node tools/learnloop/bin/selftest.js          # 53 assertions, no dependencies
```

Plain node, no build step, no `node_modules` — the same discipline
`tools/simworker/bin/` runs on, because all of it has to work from a fresh clone
on the owner's box before anything is installed.

## What is in here

```
promotion-ledger.json   THE ARTIFACT. Per flag: status, every measurement with
                        its batch id, CIs, null band and power arithmetic, and
                        the next decisive experiment.
PROMOTION-STATUS.md     Generated view of the above. Never edited by hand.
lib/ledger.js           The schema and the refusals — the rules by which a
                        measurement is allowed to move a status.
lib/extract.js          Reads a results checkout. Two directory layouts, one
                        per-game row schema.
lib/drift.js            Detector-drift and instrument-hygiene tables, per batch.
lib/stats.js            Block CIs and the power arithmetic.
lib/cells.js            The cell vocabulary, shared with make-specs.js.
bin/ingest.js           Null → instrument → treatment → ledger, in that order.
bin/make-promotion-batch.js   The ledger → the next batch's specs.
bin/render-status.js    The ledger → the markdown view.
bin/selftest.js         The gate.
fixtures/               A synthetic mini-batch with planted answers.
specs/batch2/           The current generated proposal.
```

## Topology: where this lives, and why it lives there twice

Two branches need this directory and they cannot merge:

- **`claude/cluster-lookahead`** is the engine branch. It is where the flags
  live, where their promotion gates were written, and where the ledger's claims
  can be checked against the code that makes them. It is the **home** of
  `promotion-ledger.json`.
- **`sim/worker-kit`** is cut from `66904d2` and carries `tools/simworker/`.
  It is the branch the owner's local sim session fetches, and the only branch it
  fetches. A ledger the local session cannot read is a ledger that does not do
  its job, because the local session is the consumer that decides what to run.

Three topologies were possible and two are worse:

1. *Ledger only on the engine branch, referenced from the kit.* The local
   session would have to fetch a second branch to know what to run. It is one
   more step in a protocol that already has several, and the step would be
   skipped.
2. *Ledger only on the kit branch.* The claims in it are about engine code that
   is not on that branch, so nothing in it could be checked where it lives.
3. **What is done here: `tools/learnloop/` is mirrored VERBATIM onto both
   branches, and the engine branch is the source of truth.** The mirror carries
   a `mirroredFrom` stamp naming the commit it was copied from, so a reader on
   the kit branch can always tell whether they are looking at a current copy.
   The directory is dependency-free plain node, so a verbatim copy is
   executable on both sides — which matters, because the local session should be
   able to run `make-promotion-batch.js` itself rather than waiting to be told.

**The mirror rule, in one line:** edit on `claude/cluster-lookahead`, copy the
whole directory to `sim/worker-kit`, update `mirroredFrom`. Never the other way
round. A divergence is resolved by re-copying, never by merging — one of the two
copies is the record and the other is a convenience.

`tools/simworker/bin/make-specs.js` on the kit branch gains a `--promotion-batch`
mode that delegates here, so the kit's own entry point answers "what next?"
without the operator having to know this directory exists.

## The rules the ingest enforces, and why each one is there

| refusal | the exhibit that bought it |
|---|---|
| A probe may raise `dark → probe-passed` and no further. | CENTAUR_CLUSTER_SEED. |
| A live measurement with no verified concurrent null moves nothing. | An A/A pairing on a provably inert path produced d P(first) +0.167 [0.056, 0.306] — a "significant" difference between a build and itself. |
| A live measurement on an arm whose engagement is not shown moves nothing — and the tri-state means `null` (*cannot say*) is refused exactly like `false`. | P5: `CENTAUR_WASM` is refused per partition, silently, whenever an input is not resident. Its null could equally have meant the arm never ran. Refusing only on `false` made *cannot say* mean *said yes*, and every pre-CL7 batch says *cannot say*. |
| A delta outside the floor is scored by the metric's OWN GOOD DIRECTION, never by its sign; a metric with no good direction is recorded `outside-null-unscored` and moves nothing. | CENTAUR_CLUSTER_SEED failed live through exhaustion deaths **+36** on a `family: mechanism` gate. Scored by sign, the founding failure of this whole ledger reads `supports-promotion`. Polarity lives in `lib/polarity.js` as data, and the selftest proves the table is total. |
| A CONTROL cell — one the design requires to read zero — enters no effect channel and cannot move a status in either direction. | `TERRITORY_SLIDER_PROFILE`'s inert control at *exactly* 0 against a measured ±0.0324 floor, filed as placement, demoted the flag `supported → live-null`. The better the control, the harder it demoted: a rule that punished the practice it exists to encourage. |
| A `live-null` from a cell the ledger itself stamped `underpowered` is not a decision, and its next experiment stays schedulable. | `CENTAUR_UNIT_FATALITY`'s P7F was written out in full and then silently never ran — its null is 16 blocks against the 58 its own dispersion demands. |
| A placement verdict from a cell with fewer blocks than its dispersion demands moves nothing. | 80% power at MDE 0.25 needs ~58 blocks pooled; MDE 0.10 needs 362–1,447. Mechanism metrics move at n≈8. |
| A metric with no floor in the A/A cell is `unreadable`, not `null`. | An absent instrument is not a finding. |
| A null row does not rehabilitate a `live-failed` flag. | A flag that lost a cell is rehabilitated by a root cause and a repaired arm, not by other cells declining to reproduce the loss. |
| `engagement`, `audit`, `cost` and `shape` rows never move a status. | Running is not helping; a cost is one side of a trade. |
| A frozen cell is re-opened by a mechanism claim, never by a p-value. | A3 §4.2 item 3: re-fitting cells that conditioned to null is fitting noise with extra steps. |
| The A/A null is mandatory, sized like the treatment, and its cells are DERIVED from the union of what the batch runs. | A null at 4 blocks beside a treatment at 16 understates the floor — the direction that makes a treatment look significant when it is not. And a hard-coded cell pair floored 2 of batch 1's 8 cells, leaving the other 6 unreadable by the ledger's own rule, including the slider's only win cell. |
| The exploration slice is never dropped for space. | Today's policy selects tomorrow's corpus. A promoted flag with no opposite-branch slice can never be revised back. |

## What this loop cannot do yet

Named in the ledger's `openInstrumentItems`, and worth reading before trusting
any table it prints:

- **The detector flip rate does not exist.** A3 §4.4's hysteresis signal needs
  `{policy, detectors, profile}` on every emission and no producer emits it. The
  ingest computes a *paired outcome* flip rate and labels it a proxy. Closing
  this is a decision-path change, which is why CL7 did not do it.
- **`CENTAUR_EDGE_EV`'s primary metric is not counted.** Uncontested meals
  staged, split by contest class, is in the committed replays and not in the
  manifest rows.
- **The `arch/s2` cohort governor publishes no counter**, so P6's null is
  engagement-unverified by construction.
- **`ports.env` does not reach the five search-side flags** or the two candidate
  knobs; they read `process.env` directly. Harmless for the sim harness, which
  sets process-level environment per bundle. A trap for any in-process paired
  arm.
