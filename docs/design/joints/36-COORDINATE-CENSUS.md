# The coordinate census — how much of the declared config space has ever been used

Cycle 15. Two zero-firing mechanisms were found by accident in two cycles (four
reduction/ratchet mechanisms, 0 fires in 192 games; `colourBound`, whose only
operand kind appears in 0 batch specs). Two accidents of the same shape are an
instruction to run the census deliberately. This is that census, over the
surface my lens actually owns: **the configuration space**.

The result is worse than the mechanism cases, and it exposes a live defect the
config module was written specifically to prevent.

---

## 1. Method

Three enumerations, counted against each other:

1. **Declared** — every leaf field reachable from `BotConfig`:
   `bot-config.ts` (12 top-level keys, 3 of them containers),
   `SearchSelections` (3), `CandidateKnobs` (16, one a container),
   `EdgeEvTuning` (3), `ScoutTuning` (12). Leaves: **42**, of which `name` is
   an identifier rather than an axis, leaving **41 strategy/deployment
   coordinates**.
2. **Exercised** — every `bot={…}` string anywhere in the kit, separated by
   where it appears: an emitted spec's arm, versus a tool's usage text, a
   selftest, a handoff doc, or a not-yet-run batch-3 proposal.
3. **Validated** — which leaves `botConfigFromJson` will refuse a bad key or a
   bad type for. Measured by running it, not by reading it.

## 2. The numbers

| tier | coordinates | share of 41 |
|---|---|---|
| set as a treatment in an **emitted spec** | **6** — `territoryRefine`, `sampledCap`, `candidates.unitFatality`, `candidates.edgeEv`, `engine`, `depth.plyCap` | **15%** |
| named anywhere in the tooling corpus, including tutorials, selftests and batch-3 proposals | 13 (the six above plus `multistartSeed`, `workers`, `workersAudit`, `stagingSafety`, `candidates.tierSafeStaging`, `candidates.selfDebuffOrdering`, `candidates.gainOrdering`) | 32% |
| **never named outside their own definition** | **28** | **68%** |

The 28 include **every `search.*` field**, 9 of 15 candidate knobs, and 11 of
12 depth-ration knobs — and `slate`.

## 3. Four findings, in ascending order of seriousness

### 3.1 The socket alternative has never played a measured game

`slate` appears in **zero** specs and zero files in the kit. `'potion-aware'`
and `'potion-aware-bold'` are referenced only inside the bot repo — the
registry that defines them, the five evaluator terms they select, and their own
unit tests.

`bot-config.ts` says of `slate`, verbatim: *"the first selectable alternative at
the evaluator socket, and the field's whole reason for existing."* The socket
mechanism, the slate mechanism and the config field were all built for this one
alternative, and the alternative has never been in an arm. It is the third
zero-engagement exhibit and the most consequential, because it sits on the
owner's stated first priority.

This is not an argument to delete it. It is an argument that **"selectable" and
"selected" are different states and only one of them is currently recorded**.

### 3.2 The treatment lives in prose, and the tutorial is the same syntax

An arm's `BotConfig` is not a field of a spec. It is a fragment of a shell
command inside the spec's `_comment` array:

```
"ARM CONFIGS: --arm 'sampled-cap=<bundle>,bot={\"sampledCap\":true}'"
```

Consequences, all of them structural rather than stylistic:

- the independent variable of an experiment is **not in the experiment's data
  model**, so it cannot be validated at spec time, diffed, or joined to a
  result;
- the spec corpus cannot answer "which coordinates has this programme priced?"
  — I had to grep six file formats to write §2;
- and the spec's own comment concedes the whole problem: *"Read the per-game
  rows' `mechanism.config` stamp — the bot that actually resolved — not the
  spec."* The spec is documentation of an intent; the stamp is the only record.

The sharpest form: `bot={"territoryRefine":true}` occurs in **four** batch-2
specs. In **one** (`p10-territory_refine.json`) it is the arm. In the other
three it is the copy-pasted example inside the *"HOW AN ARM IS SELECTED"*
instruction paragraph. **No parser can tell them apart** — same syntax, same
field, same file. The paragraph containing the boilerplate exists to warn
against the silent A/A that voided P5; it delivers the warning in the medium
that caused it.

### 3.3 The ledger is a sixth enumeration, keyed on deleted names, and it now contradicts the code

`promotion-ledger.json` carries 14 `flags` rows keyed on `CENTAUR_*`
environment-variable names that **no longer exist anywhere in the source**. The
live coordinate is named in each row's `selection` field — as prose. So the
ledger is a name-indexed table whose names find nothing (Law I: names find,
hashes validate; these names find nothing at all).

Two specific defects follow from the staleness, and the second reverses a
verdict:

- **A coordinate the ledger records is not in `BotConfig` at all.** Row
  `TERRITORY_SLIDER_PROFILE` names `TeamDecisionOptions.evaluate`, reachable
  "as a contender field `{"evaluator": "territorySliderEvaluator"}`". That is
  the second channel this lens found in cycle 2 (`this.options.evaluate ??
  defaultEvaluator`). The ledger therefore proves, in its own row 12, that
  **a bot is not fully described by a `BotConfig`.**
- **The ledger and the code disagree about whether `clusterEnum` is
  selectable.** Row `CENTAUR_CLUSTER_ENUM` states: *"NOT SELECTABLE — THERE IS
  NO SWITCH, IN EITHER DIRECTION… `botConfigFromJson` refuses a `clusterEnum`
  field by name, so an arm that names it is a hard error."* The code accepts
  `search.clusterEnum` as a boolean and has a long comment explaining the
  measurement that bought it. Verified by execution (§3.4). A reader trusting
  the ledger would believe a valid arm is a hard error.

### 3.4 The validator key-checks one of three nested objects — and this is executable

Run against the shipped `botConfigFromJson`:

```
top-level typo   territoryRefne          REFUSED  unknown bot config field "territoryRefne"
candidates typo  unitFatalty             ACCEPTED {"unitFatalty":true}
depth typo       plyCapp                 ACCEPTED {"plyCapp":0}
search typo      clusterEnumm            REFUSED  unknown bot config field "search.clusterEnumm"
candidates type  unitFatality:"yes"      ACCEPTED {"unitFatality":"yes"}
search.clusterEnum: false                ACCEPTED (the ledger says this is refused)
```

**30 of the 42 leaf coordinates — 71% — accept an arbitrary key with no
refusal**, and every one of them accepts an arbitrary type. Only the 9
top-level scalars and the 3 `search` fields are checked.

The file's own header states the design goal this violates: *"a contender whose
`engine` is misspelled must not silently become the default bot wearing an arm's
name"*, and the `search` sub-object carries a comment congratulating itself on
exactly the check the other two lack: *"an unknown key inside it is refused, so
a misspelled `clusterEnumeration` cannot quietly become the default bot wearing
an arm's name."* One nested object got the check. The two carrying 30 of the 42
coordinates did not.

So `bot={"candidates":{"unitFatalty":true}}` is today a **silent A/A wearing a
treatment's name** — the precise failure that voided P5, that the environment
teardown was performed to eliminate, and that four of the six exercised
coordinates are reached through (`candidates.*` and `depth.*`). Worse, the type
hole means a treatment can be *inverted* rather than merely nulled: any string
is truthy, so `{"unitFatality":"false"}` enables the knob.

**This is a live measurement hazard in the current tree, not a design
observation.** It is one loop of code to fix by hand, and zero by generation.

---

## 4. What the census does to the design

### 4.1 Law R gains a second clause, at the coordinate layer

Law R currently governs mechanisms: *reachable, and engaged at runtime, or
carrying a self-retiring waiver.* The census says the same law is needed one
level up:

> **Law R2 (coordinate engagement).** A declared coordinate must have been
> **varied by an emitted spec**, or carry a waiver naming the batch that will
> vary it. The waiver self-retires when that batch runs or is abandoned.

The waiver is what keeps this from being a ratchet against new work.
`search.maxClusterCells` and `maxClustersSolved` were added *specifically* to
price a measured two-regime cost and have not yet been run: that is a coordinate
with a named future batch, which is a waiver, not a violation. `slate` is a
coordinate whose named batch never happened, which is a violation — and a much
more useful thing to say than "unused".

The point is not the deletions. It is that **an unexercised coordinate should
cost something to keep**, because today it costs nothing and 68% of the surface
is the result.

### 4.2 The manifest closes this loop by construction, and that is its cost case

Everything in §3 is a symptom of one absence: **the config surface and the
experiment corpus are not connected by any artifact.** Under B2's generated
manifest they are the same artifact:

| today | under the manifest |
|---|---|
| an arm is a prose fragment in a comment | an arm is a **typed diff over the manifest**, in the spec's data |
| the tutorial and the treatment are indistinguishable | the example is not in the data, so it cannot be mistaken for one |
| "which coordinates have we priced?" is a six-format grep | a query over the spec corpus |
| an unexercised coordinate is invisible | a **column of zeros in a generated table**, visible without anyone deciding to look |
| 30 of 42 leaves unvalidated, one sub-object checked by hand | the codec is generated from the same rows, so the check is uniform by construction |
| the ledger is a fifth/sixth enumeration keyed on dead names | the ledger's rows *are* manifest rows; a dead name is a build error |

This is the manifest's cost case stated in measured units rather than in
aesthetics: it converts six audits I had to perform by hand into six queries,
and it removes the defect class in §3.4 as a side effect of generating the
codec.

### 4.3 The census is the argument for TWO identities, not one

`04`'s pair — `botId` (input-addressed) and `behaviourId` (output-addressed) —
has until now been justified by analogy to Nix. §3.4 gives it a local proof.

Consider the two arms `{"candidates":{"unitFatality":true}}` and
`{"candidates":{"unitFatalty":true}}`. They have **different `botId`s** — the
inputs genuinely differ — and **the same `behaviourId`**, because the typo'd
knob is never read and the bot plays the default. Today the harness sees two
distinct arms and reports a treatment delta computed from an A/A.

So `behaviourId` is not merely an early-cutoff optimisation borrowed from Nix.
It is **the detector for this defect class**: an arm and its baseline sharing a
`behaviourId` is a silent A/A, mechanically, with no validator involved. That is
Nix's *realisation divergence* used in the direction that matters here — not
"two inputs produced one output, save the work", but "two inputs produced one
output, so one of them is not the experiment you think you ran."

It also means the fix in §3.4 and the identity work in `A1` are **redundant in
the good way**: the validator prevents the typo, and if a typo ever gets through
by another route the address comparison still catches it. One of them is a
check; the other is an invariant.

### 4.4 It supplies the denominator `12` was missing

`12-EXPRESSIVENESS.md` claims every exercised degree of freedom becomes a point
in a well-typed config space. The census gives that claim its baseline: the
exercised set is **6 coordinates in emitted specs, 13 across the whole corpus**,
and **none of them are well-typed today** — they are prose strings, and four of
the six live inside the two nested objects that are not key-checked. The design
does not have to expand the space to be worth building. It has to make the
space that already exists honest.

---

## 5. Recommendation, given that deletion is licensed

Three buckets, and only the first is a deletion:

| bucket | coordinates | action |
|---|---|---|
| **never named, no named batch, superseded by a shipped decision** | the depth-ration knobs beyond `plyCap` that `DEFAULT_SCOUT_TUNING` already fixes, and any candidate knob the ledger records as merged | delete the field; the value becomes the shipped constant. A merged policy that keeps a switch is a flag with a different spelling |
| **never named, but with a named future batch** | `search.maxClusterCells`, `search.maxClustersSolved` (batch 3's pricing of the two cost regimes) | keep, with a Law-R2 waiver naming the batch. The waiver self-retires |
| **never exercised, and the reason the socket exists** | `slate` | neither delete nor waive: **run it**. The cheapest correction in this document is one arm, `bot={"slate":"potion-aware"}`, in the next potion-bearing spec |

And one non-optional item, which is not a design proposal at all:
**key-check `candidates` and `depth`.** It is the same loop the `search`
sub-object already has, it takes minutes, and until it lands every arm reached
through those two objects is one typo away from being an A/A reported as a
result.

---

## 6. Honest caveats

- **The corpus is what is in the kit worktree.** Arms may have been run from
  the command line and never written down; the census measures what is
  *recorded*, which is arguably the more relevant quantity for a programme that
  must be able to say what it raced — but it is not the same quantity.
- **"Never named" is not "never useful".** A coordinate added last week has had
  no chance to be exercised; that is what the waiver is for, and the count is a
  prompt to write waivers rather than a verdict.
- **The 41 count treats every leaf as one coordinate.** A boolean and a
  twelve-field tuning object are not the same amount of surface, and a
  weighting by reachable value-space would put the depth knobs far ahead of the
  booleans. The unweighted count is the conservative one for the claim being
  made (the surface is under-exercised), and the wrong one for any claim about
  how much *space* is unexplored.
- **§3.4 is a defect report, not a design finding**, and should be fixed on a
  normal commit regardless of whether any of this design is adopted. It is
  listed here because the census is how it was found, and because it is the
  clearest possible demonstration of what a generated codec buys.
