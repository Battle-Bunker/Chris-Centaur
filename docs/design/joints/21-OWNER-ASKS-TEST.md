# The carve tested against the owner's own asks — and one ruling tension it exposes

Cycle 9 close. The dedicated red team tested thirteen strategy families they
invented. This is the complementary test and in one way the harder one: the
capabilities **the owner has actually asked for**, in his words, checked against
the manifest. Five asks. Three fit and one of those exposes a tension between
two of his own rulings that nobody has surfaced.

---

## Ask 1 — focus-narrowing search (ruling 41)

> *"heavily filtered lookahead (greater depth, lower breadth) triggered by
> acute-impact situations; tunable depth-vs-breadth balance with a breadth
> reserve against feints"*

**Fits, and it is an ECONOMY member with two params.** Depth-versus-breadth is
the allocation law's partition, a trigger is a predicate member (`conditional`
choice on an acute-impact predicate), and the **breadth reserve is a floor on
the partition** — the same shape as the existing ply-1 reserve, which is already
a ceiling on the depth tithe.

Two things the carve adds that the ask does not name, and both matter:

- **The reserve must be a floor on the partition, not a subtraction from
  depth.** Otherwise a bot that narrows hard has no representable way to say
  "and never below this much breadth", which is exactly what a reserve is for.
- **`allowsDynamic: true` on ECONOMY is what makes the trigger legal.**
  Narrowing per board state is a within-decision selection, and Law S permits it
  precisely because ECONOMY is not MODEL or REDUCTION — the trigger changes what
  we *buy*, never what we *believe* or how we *reduce*.

## Ask 2 — potion control and seeking (rulings 9, 10)

**Fits; partly built.** VALUE members (seek, control, attack-window) priced in
the currency, an ACTION ordering slot (`potionOrdering` — measured free and
effective), and the missing half is the commitment: arm → collect → spend as a
`Carried` premise with a three-turn lifetime (`05 §4`), which the engine re-cut
(`19`) finally gives states to plan over by returning settled tiers.

## Ask 3 — live per-heuristic operator knobs, global and per-unit

**Fits, and prior art says how.** A knob is a bounded reparameterisation of a
seated member's params; the manifest **generates** the typed knob schema
(`14 §E`, UCI's `check`/`spin`/`combo` with default and range), the bot emits
it, and an excursion mints a new `botId` so every dial move is a config point in
the same coordinate system as the experiments. Per-unit knobs are the scope
mechanism (`15 §C`) at singleton scope.

## Ask 4 — slider attack vectors, lines of defence, and **interception-deterrence**

> *"there'll be a whole strategy around lines of defence by our own sliders to
> be able to intercept dangerous moves by smaller opponent sliders that deter
> them from making them **whether or not we actually make the intercept move**"*

**This is the one that does not fit, and the reason is a ruling interaction, not
a carve failure.**

Attack vectors and lines of defence are VALUE members over geometry — they fit
straightforwardly and one is already built (`slider-attack-vector.ts`).
**Deterrence is different in kind**: its value is *the enemy not making a move
they would otherwise make*. That is a claim about **opponent response**, and:

> **A quantifier has no response.** Ruling 13 pins the opponent model to
> worst-case for now — `'adversarial'`, the credal set's zero point — and a
> worst-case opponent is by construction the one who does the worst thing
> available regardless of what we threaten. Under that model the deterrence
> value of an unexecuted threat is **identically zero**, at any weighting, in
> any evaluator. The term is not mispriced; it is unpriceable.

So the owner has asked for a capability that one of his own standing rulings
makes inexpressible. That is worth his attention, and it has a cheap resolution
that does **not** reopen enemy-prediction work:

- **Deterrence needs only the weakest non-adversarial rung.** The EPISTEMICS
  lens's supplier ladder puts `opp/cover@1` — cover-counting, derived from the
  support and the rules, **zero learned content** — one step above the
  quantifier. A threat that removes admissible enemy actions changes the cover
  counts, so deterrence has a value under `opp/cover@1` *without any model of
  what this opponent is like*.
- **It is exactly the `ruling-13` site-class row** (`11 §2`): the reduction
  binding stays pinned wherever the ruling pins it, and a *deterrence VALUE
  term* reads the weight supplier at the est rung only. Nothing learned, nothing
  predictive, no enemy-modelling programme.

Stated for the owner in one sentence: *deterrence is the value of a move the
enemy declines to make, so it can only be measured against a model in which the
enemy responds to anything; the cheapest such model counts how many of their
options our threat removes, which is arithmetic over the rules and not a
prediction about the opponent.*

## Ask 5 — the Centaur surface (throughout, and ruling 13's division)

**Did not fit until cycle 7, and now does — as a sixth kind.** ADVICE
(`12 §D3`, `13`): members read fibered values and write only to the operator
surface, under a submodular attention budget (`17 §C`), with a one-way
constraint no staged-plan joint may cross. The decision package (`13`) is the
owner-facing form, and its headline finding is that the expensive half is
already built: a pinned sacrifice already plays.

---

## Scorecard

| ask | verdict | where it seats |
|---|---|---|
| focus-narrowing search + breadth reserve | **fits** | ECONOMY allocation: partition + floor, `conditional` on a trigger predicate |
| potion seek / control | **fits, half built** | VALUE members + ACTION slot + a `Carried` commitment; needs `19`'s settled tiers |
| live operator knobs | **fits** | generated knob schema over bounded reparameterisations; every excursion a `botId` |
| slider attack vectors / lines of defence | **fits** | VALUE members over geometry |
| **interception-deterrence** | **blocked by ruling 13, not by the carve** | a VALUE term reading a non-adversarial weight supplier at the est rung; needs `opp/cover@1`, which carries zero learned content |
| the Centaur surface | **fits since cycle 7** | ADVICE kind, with the sacrifice-warrant member gated on the owner's decision |

---

## What this test says about the carve

The families the red team invented found four failures and produced a sixth
kind, a law re-draw and three coordinates. The owner's own asks find **one
blocker, and it is not architectural** — it is a live tension between two things
he has asked for, which the carve is good enough to *locate precisely*: the
deterrence term's premise requires a measure where a ruling pins a quantifier.

That is the strongest evidence I have that the factorization is doing its job.
A carve that cannot express something should be able to say *exactly which
coordinate is missing*, and here it names one: the measure coordinate at one
site class, satisfiable by the one supplier rung that learns nothing.
