# The joint inventory — what the joints actually are, read off the code

Cycle 2 of the COMPOSITION lens. Every row is verified against
`claude/cluster-lookahead` @ `3090b77`. The point of this document is to stop
arguing about joint *lists* and read the joints the shipped bot already has,
with the composition law each one actually uses — because in four cases out of
nine the law is hand-written prose in a comparator, and in two the declared
contract and the implementation disagree.

---

## 1. The inventory

| # | joint (proposed id) | kind | members that exist today | the composition law as IMPLEMENTED | where it is written |
|---|---|---|---|---|---|
| 1 | `model/units` | MODEL | simulate · hold-with-cloud@observedTurn · pin · reference-action | lattice join (dilation/conditioning) | `partial-engine/cloud.ts`, substrate |
| 2 | `model/replies` | MODEL | **one**: ∀ over the legal set (worst case) | — (no second member; ruling 13 fixes it there for now) | bank floors, scout reply walks |
| 3 | `model/terminal` | MODEL | mutual-wipe pricing, turn-limit adjudication | unconditional (a correction, not a choice) | `evaluate/mutual-wipe.ts` + server + harness — **three copies** |
| 4 | `value/terms` | VALUE | material, health, king margin, reach, room, command, tier-window, sever, share-curvature + 4 potion terms ×2 scales | weighted sum over a common frame; sound half in interval arithmetic, advisory half onto `est` | `evaluate/bound.ts` `fold`, `potion-lineup.ts` |
| 5 | `value/profile` | VALUE | 4 `CriterionProfile`s (territory, material-only, slider, slider-royal) | **replacement, not composition** — a profile is an opaque bundle of weights | `evaluate/calibration.ts` |
| 6 | `order/candidates` | ACTION | gain ordering · edge-EV · potion ordering · escort shadow · self-debuff · multi-start seed · sampled cap | **hand-written lexicographic comparator with fixed slots** | `candidates.ts` `gainOrderKey` |
| 7 | `set/closure` | ACTION (kernel side) | fatal-no-gain prune · king hard safety · refuse-promotion · terrain-fatal refusal · `keepQuiet: 2` ray thinning · `candidateCap: 8` | intersection of closures, with an emptiness guarantee | `candidates.ts` prune chain |
| 8 | `factor/clusters` | ACTION | cluster partition + exact enumeration, sliders in every cluster, rations | partition (a structural choice, one per decision) | `search/cluster-*.ts` |
| 9 | `reduce/accept` | REDUCTION | **one**: witness veto → depth rung (`mu`, `prec`) → floor → est → ceiling → salted key | hardwired ladder | `search/core.ts` `accept`/`depthRung` |
| 10 | `economy/schedule` | ECONOMY | slice loop + depth tithe/reserve/plyCap + cluster rations + speculation + VOI (partial) | budget partition, hardwired shares | `kernel.ts`, `scout/schedule.ts`, `voc.ts` |
| 11 | `economy/emit` | ECONOMY | staged emission barrier, pin conformance, deadline | kernel constraint (not a member) | `team-decision-engine.ts` |

Nine joints where a member choice is real; two (3, 7) where the right answer is
"kernel, and say so". The owner's five sockets map onto 4, 6, 9, 10 and a
not-yet-real 2 — the DoF synthesis's verdict ("the slot list carved the
maximizer, not the strategy") reads directly off this table.

---

## 2. Finding: the ordering joint's declared law and its real law disagree

`registry.ts` declares socket 1 as additive logits:

> *Logits over the COMPLETE candidate set. Additive composition: a slate's
> selectors SUM their logits, each entry's params carrying its own scale.*

Nothing implements `MoveSelector`. What ships is `gainOrderKey` — a fixed
lexicographic comparator, twelve slots deep, each ordering heuristic a
hard-coded line at a hand-chosen precedence:

```
tier → tierRisk → regicideShot → capture → foodGain → potionGain
     → shadowBonus → edgeEv → healthSpent → contingencies → cell index
```

with the individual heuristics switched on and off by `CandidateKnobs`
booleans that make their term *zero* rather than removing them from the order.
Three consequences, all live:

1. **The precedence vector is an unnamed, unversioned strategy.** The single
   most productive change the potion work found — `potionOrdering`, +55%
   pickups, +42% window severs, at zero search cost — is *a slot position*:
   "below the eats, because food is the resource a unit dies without and a
   window is a resource it merely wins with; above everything quiet". That
   argument is good, it is in a code comment, and **no config can vary it and
   no measurement attaches to it**. A rival precedence is a source edit.
2. **Lexicographic and additive are different laws, and the choice is itself
   the interesting knob.** Lexicographic ordering is total-precedence (a lower
   slot can never outvote a higher one); additive logits let a strong second
   opinion overturn a weak first. This program has evidence on exactly this
   axis and did not know it was measuring it: "4× weights flat to worse"
   (additive channel, VALUE joint) versus "ordering is the lever and it costs
   nothing" (lexicographic channel, ACTION joint).
3. **ACTION dominates VALUE, structurally.** `candidateCap: 8` closes the set
   *after* the comparator sorts and *before* anything is priced. So a plan the
   ordering drops is a plan no evaluator ever sees, at any weight. The
   registry's own note says it: *"a plan the candidate cap closed in front of
   is a plan no advisory term ever prices"*. This is the most important
   composition fact in the bot, and it is currently a comment rather than a
   law.

**Proposal.** `order/candidates` becomes a joint whose members produce
`⟨priority, logit⟩` per candidate, and whose *composition law is itself a
member param*: `lexicographic(precedence)` or `additive(scales)` or the mixed
form (group by priority band, sum inside a band). The precedence vector becomes
data with an id and a record; `potionOrdering`'s slot position becomes a
measurable claim instead of a comment; and the cap's dominance becomes explicit
because the closure joint (`set/closure`) is declared to run *after* ordering
and *before* pricing, in one place a reader can find.

---

## 3. Finding: `CandidateKnobs` is three kinds in one bag

Eleven booleans and one number, and they do not obey one law:

| knob | kind | law |
|---|---|---|
| `gainOrdering`, `potionOrdering`, `escortShadowOrdering`, `selfDebuffOrdering` | ACTION | compose (they are slots in one order) |
| `pruneFatalNoGain`, `kingHardSafety`, `refusePromotion`, `refuseTerrainFatal`, `keepQuiet: 2` | **set closure** | do **not** compose — each *removes options*; under the order-not-set law these are either declared max-side restrictions or safety floor, and both are kernel |
| `tierSafeStaging` | safety policy | kernel-adjacent |
| `chargeStandingTerrain` | MODEL | a claim about what a move costs — a premise, not a preference |

`keepQuiet: 2` deserves its own sentence: **a number in a knob bag that closes a
set.** It is a max-side restriction (quiet ray prefixes kept per ray) with no
declared ledger entry, sitting beside four ordering booleans that cannot change
what is representable. That is exactly the confusion the order-not-set law
exists to prevent, and it is invisible because the container has no types.

Under the manifest (`00-CORE.md` §3) this bag splits by kind automatically,
because a member cannot be registered without declaring its joint, and a joint
declares its law.

---

## 4. Finding: REDUCTION is five places, and the epistemics lens supplies the object

Where "how afraid are we" is decided today:

1. `accept()`'s ladder order — floor before est before ceiling.
2. `depthRung`'s **position above the floor comparison** — which is why an
   advisory term "converts floor-decided comparisons into belief-decided ones"
   (measured: floor/dec 1057 → 781, depth/dec 359 → 554, plain → bold).
3. The bank's floors: `min` over the reply set — the quantifier, unparameterised.
4. The posture governor's conservative defaults on fog states.
5. Each term's own conservative endpoint choice (potion-seek's exposure
   endpoint, dodge's `mean` vs `worst`, attack-window's gate).

The EPISTEMICS lens (`design/belief-fog`, `02-PROJECTIONS-AND-WEIGHTS.md` §5)
supplies the single object these five are approximating: the **ε-contamination
credal class**, whose lower expectation has the closed form

```
E_lower[V] = (1−ε)·E_w[V] + ε·min_S V   =   (1−ε)·estAdvised + ε·lo
```

ε = 1 reproduces today's floor-led bot exactly; ε = 0 is best response to the
supplied weight; every value between is a genuine lower prevision, so the
guarantees compose rather than being an ad-hoc blend. I adopt it, and it
*sharpens* rather than contradicts the "REDUCTION composes by choose-one" law
of `00-CORE.md` §3.3:

> **Refined law (REDUCTION).** A bot binds exactly one `(weight-supplier, ε)`
> pair, and every reduction site reads that binding. Two reductions may not be
> averaged — an average of two reduced scalars is not the lower prevision of
> any credal set, so it composes no guarantees. What *looks* like mixing two
> reductions is legal only when it is re-expressed as a **wider credal set at
> the MODEL joint** (which is precisely what ε-contamination is: a mixture in
> the support, not in the answer).

That is a statically checkable rule, and it makes the epistemics lens's
**coupling law a theorem instead of a discipline**: they observe that a thread's
inner `min_b` must run the same ε as the root's est rung, or the search
optimises a different objective at depth than at the root, and that "the
coupling is invisible in today's code". Under a total bot value (`00-CORE.md`
§4.2) there is exactly one binding site for `reduce/accept`, so *two different
ε values are unrepresentable* — the coupling cannot drift because there is
nothing to drift from. **This is the concrete payoff of the composition algebra:
a cross-joint interaction that today can only be maintained by vigilance becomes
a consequence of totality.**

One interaction to check before ε ships, offered back to that lens: at depth the
support is wider (dilated clouds), so a *constant* ε applied to a wider `lo` is
more pessimistic in value terms than the same ε at the root; and the deep
finding is *also* discounted by `sigmaOfPly`, whose fog/interference terms
measure much the same width. **Pessimism may be charged twice — once in the
blended value, once in the precision.** The falsifier is cheap: hold ε fixed and
vary `plyCap`; if the depth-effect rate falls as plies rise, the double charge
is real.

---

## 5. The current bot, written as a value

What `00-CORE.md` §4 proposes, spelled out for the shipped bot — this is the
byte-identity bridge in the new vocabulary, and writing it out is how you find
out whether the manifest is honest:

```jsonc
// bots/shipped.json — TOTAL: every joint bound, no channel, no `??`
{
  "model/units":      { "at": "fixed", "member": "model/scheduler-held@1" },
  "model/replies":    { "at": "fixed", "member": "opp/adversarial@1" },
  "model/terminal":   { "at": "fixed", "member": "rules/adjudicate@1" },
  "value/terms":      { "at": "fixed", "member": "value/territory-profile@1" },
  "order/candidates": { "at": "composed", "law": "lexicographic",
                        "precedence": ["tier","tierRisk","regicide","capture","food",
                                       "shadow","edgeEv","health","contingencies","cell"],
                        "of": ["order/gain@1","order/escort-shadow@1","order/self-debuff@1"] },
  "set/closure":      { "at": "fixed", "member": "close/shipped@1" },      // kernel-owned
  "factor/clusters":  { "at": "fixed", "member": "factor/overlapping@1" },
  "reduce/accept":    { "at": "fixed", "member": "reduce/floor-led@1",
                        "params": { "epsilon": 1.0 } },                     // = today
  "economy/schedule": { "at": "fixed", "member": "econ/slice-loop@1",
                        "params": { "tithe": …, "reserve": …, "plyCap": … } }
}
```

and the potion arm is a *diff*, not a second slate:

```jsonc
{ "extends": "shipped",
  "value/terms":      { "at": "composed", "of": ["value/territory-profile@1","value/potion-lineup@1"] },
  "order/candidates": { "+precedence-after": { "food": "potionGain" } } }
```

Three things fall out of writing it this way:

- `potionOrdering`'s slot position is **in the diff**, so the arm that races it
  is racing a stated claim.
- The `potion-aware` / `potion-aware-bold` pair collapses to one member with a
  scale param and two bot values — no fourth branch in a `slateFor` switch, no
  second weights table, no eight entry ids where four would do.
- `reduce/accept`'s `epsilon: 1.0` makes today's risk posture *visible for the
  first time*. Nobody chose 1.0; it is what a floor-led ladder means, and the
  bot has never been able to say so.

---

## 6. Migration: four lane-(b) increments, each with a falsifier

Ordered so that every step is independently valuable and byte-identity is
provable at each one. Increments 1–2 are shared with the EPISTEMICS lens's
build order (their §7.1–2 is my §6.1) — they should be built once, not twice.

**I1 — the value table on `BankResult`.** `{envelope, estSound, estAdvised,
advisoryPrecision}` replacing the mutable `est`; belief assembly reads
`estSound`; the comparator's rungs declare their read-sets. *Falsifier:* the
dose-response curve (floor-decided fraction falling as advisory weight rises)
must flatten; if it does not, the laundering diagnosis is wrong. *Identity:*
with `advisoryPrecision = 0` and one profile, bit-for-bit today.
**Add from this lens:** key the envelope by `(horizon, frame)`, not horizon
alone — see `01-PREMISE-LATTICE.md` §3. Without `frame` in the key, shadow-driven
evaluator invocation cannot be built on top of this table, because two branches
on one board will then routinely differ in which terms ran.

**I2 — the joint manifest, and the config derived from it.** `JOINTS` as data;
`BotConfig`'s codec, the stamp, the manifest columns and the diff generated from
it; `BotStamp` and `botConfigFromJson`'s hand-written key sets deleted. *Falsifier:*
the generated stamp must reproduce the current `BotStamp` field-for-field on a
replay corpus; a field that cannot be generated is a joint the manifest does not
model, and it must be named rather than special-cased.

**I3 — bots as total values with addresses.** The roster directory, `botId`,
the structural diff, and the reachability law (`00-CORE.md` §5) in CI. Removes
`SlateId`, `slateFor`, `options.slate ?? bot.slate`, and every off-by-default
config field that no roster bot seats. *Falsifier:* Law R must fail loudly on
today's tree (it should flag `territoryRefine`, `multistartSeed`, `sampledCap`,
`search.clusterEnum` immediately). If it flags nothing, the closure is computed
wrong.

**I4 — the ordering joint.** `order/candidates` with a declared law and a
precedence vector as data; the potion slot position becomes an arm. *Falsifier:*
the shipped precedence must reproduce `gainOrderKey`'s order on a corpus of
generated candidate sets, exactly; and an additive-law member must be
representable and raceable, or the "law is a param" claim is empty.

Only I4 changes behaviour, and only when a bot names something other than the
shipped precedence.
