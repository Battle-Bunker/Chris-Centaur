# Amendments under the composition lens's red team

Answers to `design/joints-composition:10-REDTEAM-BELIEF.md` (tip 6d3bfd0),
finding by finding: ACCEPTED (doc amended), ACCEPTED-WITH-MECHANISM (their
break is real; the fix is stated here), or ANSWERED (the break dissolves under
an argument they did not have). Net verdict first:

**Their sharpened replacement claim is adopted verbatim.** The falsifiable
claim of this line is restated everywhere it appears: *invisibility changes no
soundness law and no bound arithmetic, but WILL change modal posture, lever
set, and frozen-slot occupancy — three pre-registered numbers that must move
within a predicted band.* "Zero lines changed" was the wrong boast; zero LAWS
changed is the defensible one, and the behavioral regime shift is now a
measured deliverable, not a footnote.

---

## 1. FOGGED-VACUOUS steady state under permanent hiding — ACCEPTED

Their break: a permanently-hidden unit's saturating cloud lands fogged steady
states in FOGGED-VACUOUS, where ordering authority transfers to the est
channel — which doc 02 itself shows is precision-laundered while every
advisory term is unfitted. Zero code changes and the ordering REGIME moves.

Correct, and it sharpens the build order into a dependency: **the value-table
fix (02-doc increments 1–2) is a PREREQUISITE of the fog programme, not a
parallel track.** Under fog, est stops being a tie-breaker of last resort and
becomes the modal ordering channel; shipping fog against a laundered est is
shipping the defect at scale. Sequence amended (04-doc §6): steps 1–2 are
gates for steps 5–8. Additionally, the FOGGED-VACUOUS residency fraction is
pre-registered band #1 (see §9).

## 2. voc catchup leech — ACCEPTED-WITH-MECHANISM

Their break: stale units admit neither narrow nor advance; catchup's
value/cost converges positive; a permanently hidden unit holds a non-vanishing
compute claim forever for an impossible repair, and the fallback selector
prefers exactly it (max staleness).

The mechanism that dissolves it: **an observation-held unit is never
catchup-stale, because ingestion IS its catchup.** The ObserverLedger
maintains the unit's conditioned front at the CURRENT turn (dilate+condition
per real turn); there is no simulation lag to repair — the staleness the voc
lever reads is simulation-behind-ness, and for a game-held unit that quantity
is zero by construction. Amendment (08-doc §5/§6): the ledger publishes
`simStale = 0` for observation-held units; the catchup lever and the
max-staleness fallback read simStale, not observation age. Observation age
feeds ONLY the width telemetry and the D2 supplier. This is finding 4's
operation-set tag doing its job: catchup is not in a game-held unit's
operation set, so no lever may bid it.

## 3. MAX_FROZEN as a two-producer resource — ACCEPTED-WITH-MECHANISM

Their break: game-imposed and scheduler-imposed holds now share the 32-slot
field; the overflow remedy ("model more units") is structurally unavailable
for a unit of unknown position; TooManyHeldError = lost turn.

Three-part amendment (01-doc migration table row added):

- **Priority partition.** Game-held units have first claim on slots — they
  cannot be un-held. Scheduler holds yield under pressure (un-holding a
  scheduler-held unit is always available at compute cost: model it).
- **Saturation relief.** A saturated cloud already short-circuits every query
  (`saturated` flag, engine-built). A game-held unit whose cloud saturates is
  demoted to a SATURATED CLAIM — one flag, no field slot, worst-case answers
  by rule — reclaiming its slot. Sound (saturation is the widest state) and
  cheap (the short-circuit is the existing fast path).
- **Boxes don't multiply slots.** A disjunctive union is one unit, one slot,
  k fronts inside it (01-doc §5b's cache note now says so explicitly).

TooManyHeldError becomes unreachable from fog by construction: hidden units
either hold slots, or are saturated claims holding none.

## 4. The reducibility tag is not a partition — ACCEPTED, retyped

Their break is exact: C0–C2 are COMPUTE that removes OBSERVATION-tagged
width, so a consumer reading `'observation'` as "compute cannot help" refuses
to fund the C-rungs on precisely the units they serve.

The tag is retyped from an enum to an operation set with prices (08-doc §5):

```ts
type RemovalOp =
  | { op: 'enumerate' | 'narrow' | 'advance'; cost: ComputePrice }   // sim-held
  | { op: 'condition'; rung: 'C1' | 'C2'; cost: ComputePrice }       // evidence
  | { op: 'await-reveal'; horizon: number | 'unknown' }              // the game
type Reducibility = ReadonlyArray<RemovalOp>   // possibly empty = none-this-turn
```

The voc lever menu bids whatever operations the set offers at their prices;
hedged preparation remains outside the set (always open, scheduler-priced —
the time lens's split survives unchanged). The 04-doc §3 contract paragraph
is corrected to this shape.

## 5. Cover-weight flattening under fog — ACCEPTED, instrumented

Their break: the mixture-of-fans over a widening cloud flattens w toward
uniform, so a fixed ε buys different effective pessimism as fog grows.

Correct, and it is a REAL property, not an artifact — under genuine position
uncertainty the cover argument legitimately discriminates less. What must not
happen is reading behavior change as ε-drift when it is w-entropy drift.
Adopted as pre-registered instrument (05-doc §4): **entropy of the supplied
weight vs mask size per decision**, published in the mechanism report next to
the advisory rows; the (supplier × ε) grid stratifies by it.

**Second pass — should ε be SCHEDULED on entropy? No, and here is the
derivation (a refusal with a falsifier, per the derived-never-dials rule).**
ε prices exactly one thing: the chance the WEIGHT'S MODEL is wrong (the
contaminating mass an adversary could hide inside the supplier's blind
spots). For a DERIVED weight like cover-counting, that model error is a
property of the derivation's assumption (the enemy best-responds to our
uniform) — it does not grow because the board got foggier. What entropy
degrades is DISCRIMINATION, and discrimination degrading is already
self-expressed in the arithmetic: as w flattens, E_w[V] converges across
candidates, the est rung separates less and decides less, and ordering
authority passes gracefully to whatever still separates (floors, depth).
Scheduling ε up under entropy would double-express one cause — the exact
two-fear-knobs shape the joint frame forbids — and scheduling it down would
manufacture confidence from fog. So: ε constant per D3 policy; the entropy
column is a STRATIFIER, not a controller. FALSIFIER, pre-registered with the
bands: if estDecided-rate vs entropy shows the est rung still deciding at
high entropy AND those decisions grade worse than floor-decided ones on the
same boards, then flat-w decisions are actively harmful rather than merely
rare, and an entropy-gated est rung (a D3 design change, not an ε schedule)
goes on the table with that evidence attached.

## 6. The reappearance oracle throws in production — ACCEPTED, demoted to quarantine

Their break: coverage is inversely proportional to danger (wide clouds catch
nothing; narrow, aggressively-conditioned clouds are both where violations
live and where we already acted), and a production throw is a lost turn — the
1e-4 rounding forfeit is the exhibit.

Amendment (03-doc §2/T14, 05-doc §4.2): in PRODUCTION play the oracle
QUARANTINES — treats the reveal as a fresh observation, rebuilds the unit's
belief from it, logs the violation with the full trace, and counts it in the
mechanism report; the bot plays on. It THROWS only in the harness and tests,
where a lost run is the point. Same policy the rounding fix chose (absorb at
the seam, count loudly, never forfeit). The coverage asymmetry is accepted as
a limit of the instrument: the oracle is a cheap always-on audit, not the
soundness proof — the proof burden stays on the conditioning ladder's
per-rung arguments, and the harness adds seeded narrow-cloud scenarios where
oracle coverage is high by construction.

## 7. Belief(observer) memory — ACCEPTED as a budget premise

Adopted: observer depth is a declared premise coordinate with maximum 1
(Belief(us) + Belief(enemy-team-E) per living enemy team, each over OUR
hidden units only — not their beliefs about each other, not recursion). Cost
model: one ObserverLedger per enemy team, each O(our hidden units × boxes);
no thread-local copies (read-only shared pointer, same discipline as cloud
timelines). Anything deeper is a new design with its own memory case, refused
here by default.

## 8. Conditioning depth as a comparison coordinate — ANSWERED, half adopted

Their break: which C-rungs ran changes S, and the (horizon, weight, basis)
triple doesn't record it, so two numbers on differently-conditioned supports
compare silently.

The half that dissolves: WITHIN one decision, conditioning depth is uniform —
the ladder runs at ingestion, before the first candidate is priced, so every
candidate's S is the same S. The refusal law's per-number tags exist for
within-decision comparison, and there the coordinate cannot vary. No fourth
per-number tag.

The half that is adopted: ACROSS decisions and across carried values
(rebase/ponder transfer, paired-measurement mining, thread values folded next
turn), conditioning depth genuinely varies and must be recorded. Amendment:
`conditioningDepth` (the rung mask that ran, per held unit) joins the
DECISION-level premise — stamped in the mechanism report and in the
ConditioningTrace key (08-doc §5 already keys the trace; the rung mask is
added to the key), so any cross-decision consumer inherits the refusal
semantics through the key mismatch rather than through a per-number tag.

## 9. The three pre-registered bands (the adopted replacement claim, made concrete)

To be predicted BEFORE the first fog harness run, per scenario family
(03-doc's five-turn scenario is family 1):

1. **Modal posture residency**: fraction of decisions in FOGGED-DISCRIMINATING
   vs FOGGED-VACUOUS while a unit is hidden. Predicted band from cloud-width
   forecasts (dilation curve × C0/C1 collapse rate); VACUOUS residency above
   the band = the est-channel prerequisite (§1) is load-bearing sooner than
   planned.
2. **Lever-spend shift**: share of voc spend on condition-rungs + hedged
   preparation vs enumerate/narrow/advance, per the §4 operation sets.
   Catchup spend on game-held units predicted ZERO (§2) — any nonzero is the
   leech bug reproduced.
3. **Frozen-slot occupancy**: peak slots held by game-held units + saturated-
   claim demotions per game (§3). TooManyHeldError predicted ZERO.

Bands published in the fog-cell spec before the runs; landing outside a band
is a finding about the design, in either direction.
