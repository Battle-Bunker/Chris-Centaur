# The spine, as compiling code — cost in lines, and three things running it taught

`manifest.ts` + `demo.ts`. Type-checks under `--strict`, runs under
`node --experimental-strip-types`, imports nothing from the repo.

```
npx tsc --noEmit --strict --target es2022 --module nodenext \
        --moduleResolution nodenext --allowImportingTsExtensions manifest.ts demo.ts
node --experimental-strip-types demo.ts
```

## Why this exists

The dedicated red team's sharpest structural objection was not about
correctness: *"a generator is a compiler; it will have bugs and it is upstream of
everything"*, and the carve *"trades duplication for prerequisites"*. That
deserves a number rather than a reassurance.

| piece | lines |
|---|---|
| identity (`structural`, `hash`, `botId`, `behaviourId`, `Name`, traces) | ~90 |
| manifest types (kinds, laws, joints, members, data entries, constraints, coordinates) | ~150 |
| choices, bots, specs, `normalise` | ~80 |
| `botDiff` | ~20 |
| the checks (Law R both clauses, Law S, codecs, arity, identifiability, ambiguity) | ~120 |
| transfer variance + earned precision + edge credits | ~70 |
| the reduction's set type, emission collapse, two currencies, the miner's three rules | ~77 |
| **spine total** | **608** |
| the demo that exercises all of it (toy manifest, 10 members, 3 roster bots) | 364 |

**What this does not include, and where the real risk is.** The spine is small;
the *generator* — emitting the config codec, the stamp, the manifest columns,
the docs table and the operator knob schema from these declarations — is not
here. That is the part that is a compiler, and the risk note in
`07-SYNTHESIS.md` §7 stands: when the manifest is wrong, five artifact classes
are wrong in agreement, so one class must be produced by an independent path and
compared. 608 lines is the cost of the *concepts*; it is not the cost of the
*migration*.

## What the demo shows

Real output, abbreviated:

```
shipped      3272ff9c46dae85a
potion-aware 79784d30e5ff8858
the arm claim, generated: [{"joint":"value/terms", a: fixed(territory), b: composed(territory, potion-seek)}]

checks:
  [S] model/replies (model) may not be chosen dynamically
  [R] value/potion-seek@3 never engaged in a validated run
  [R] model/observation-fog@1 is reachable from no roster bot
  [ambiguity] order/gain@1 writes order.rank also touched by reduce/floor-led@1
              (reduce/accept), and no constraint row covers order/candidates|reduce/accept

transfer variance vs humans at production budget: 4.5
  earned precision in-corpus : 4.000
  earned precision vs humans : 0.211

carried line: line/3.7:queen->d4
  valid within turn   : true
  valid after a spawn : false   (name still finds it; the trace refuses it)

edge credits for one shared evaluation:
  cluster/3.7 → three consumers, 3 quanta each

reduction survivors (advice reads these verbatim): plan/a, plan/b
  collapsed at emission -> plan/a
attention spend 1 of 2: {"quanta":1000,"attention":1}
attention spend 3 of 2: "refused"          (no exchange rate: attention is a cap)
miner:
  unknown column        : refused — "unknown column \"depthEffect\""
  absent value          : refused — never defaulted
  statistic at its bound: saturated at 441  (an instrument reading, not a measurement)
```

Every claim the design makes about being *mechanical* is exercised there: the
arm's treatment claim is generated rather than written; a dynamic choice on a
MODEL joint is a load-time error rather than a review comment; an unplayed
member fails; the transfer penalty is computed from two premise records by the
framework; and a carried line survives `advance` by name while its trace refuses
the stale result.

## Three things that only came out of running it

**1. The ambiguity detector needs a discharge rule, or it is noise.** The first
version flagged two evaluators writing the same fold — which is precisely what
the `mobius` law says they do. Fixed: ambiguity is reported only **between
members of different joints**; within a joint, the composition law *is* the
declared ordering. Bevy's detector has the same shape and the same need — a
report that fires on legitimate structure gets muted, and a muted detector is
worse than an absent one.

**2. The detector then found, from declarations alone, the coupling that took a
week of code reading to find by hand.** The surviving finding is
`order/candidates` × `reduce/accept` both touching `order.rank` — the
admission-versus-valuation coupling of `02-JOINT-INVENTORY.md` §2.3, which I
derived by reading `gainOrderKey`, the candidate cap and `accept()`. It falls
out of two `writes` declarations. That is the strongest argument I have for the
declaration discipline: it finds couplings *before* someone spends a week
finding them, or worse, never does.

**3. A waiver covers engagement, not reachability — and that is right.**
`model/observation-fog@1` carries a self-retiring waiver for a game mode that
does not exist, and it still failed: no roster bot seats it. Correct, and the
consequence is a good forcing function — **work that is early still needs a
named future bot**, so "which configured bot will play this when the mode
ships?" has to be answered when the member is written rather than when the mode
arrives. That is the same discipline as the capability ledger, one level down.

## Cycle 14: the index, and two more things running it taught

The operations table, `combine` (Law T + Law H′) and the clone detector are now
in the sketch. Output:

```
purchasable by compute: support.model, support.replies, observable.horizon, observable.provenance
NOT purchasable      : measure.weight(choice), measure.range(observation), config.*(none)
advance is a real computation only at: measure.range
equality does NOT license tightening at: observable.horizon, measure.weight

same index      : tightened  [2,9] + [4,7] -> [4,7]
cross-horizon   : hull       [2,9] + [5,6] -> [2,9]      <-- vacuous, as predicted
differing index : refused    "join first and record the widening"
inversion       : refused    "genuine inversion: lo 8 > hi 2"

clone detector: EvalMemoKey and BasisKey flagged; PlanKey ignored (not coordinates);
                BoardHash ignored (allow-listed with a reason)
```

**4. The table caught an overstatement in my own prose.** I wrote that horizon
is the *only* coordinate where equality does not license tightening; the table
says `measure.weight` is the second, **for a different reason** — tightening is
a sound-channel operation and the weight governs the advisory channel, where two
readings compose by precision-weighted merge rather than by max/min. Two
absences, two causes; conflating them would put an interval operation on a
density.

**5. The cross-horizon hull is visibly vacuous.** `[2,9]` combined with a
*tighter* deep reading `[5,6]` yields `[2,9]` — the deep reading contributes
nothing to the sound channel, which is exactly the claim Law H′ makes and the
reason depth's value has to travel in the advisory channel. Seeing it return the
input is more convincing than the argument for it.

**Cycle 14b — the reduced product and the termination operator run:**

```
reduced product:
  direct  [3,5] x [3,5]  -> [3,5]
  reduced [3,5] x (even) -> [4,4]      <-- Cousot's reduction, not max/min
termination:
  gain below eps -> unchanged           (the tightening is NOT TAKEN, so the chain is finite)
  gain above eps -> [4,7]
```

The reduction is nine lines and O(1); the termination operator is four. Both
were specified before they were written and neither needed the spec amended,
which is the first time in this sketch's life that has happened.

## What the sketch deliberately does not do

No joint semantics. A manifest row carries a codec and a law; what a move
selector or an evaluator *does* is the member's business and lives in the
kernel. The sketch is the spine, and the spine is supposed to be boring.
