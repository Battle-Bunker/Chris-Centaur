# Within-bot selection, and the types that carry it

Cycle 5 of the COMPOSITION lens. The owner's ask, in one sentence:
collections at each joint *"that can be chosen from when configuring a bot **and
which are also available for dynamic decisions among within one bot** (every
evaluator is a member of one of these collections)"*. This document says what
the second half costs, why it is unsafe today, and what the whole factorization
looks like as code.

---

## 1. Dynamic selection is a premise change, and that is the whole difficulty

Choosing which evaluators run *per board* changes the **frame** coordinate
(`01-PREMISE-LATTICE.md` §3). Two branches on the same board, evaluated under
different selections, are values in **different fibers**. Everything else about
"socket 2" is easy; this is the part that decides whether it can ship.

Three concrete consequences in today's code:

**1.1 Comparison.** Round-fusion already has the law and it is currently
unexercised because nothing selects: equal pending sets ⇒ compare cores
directly; different pending sets ⇒ compare frame endpoints `lo*/est*/hi*`
(envelope arithmetic); a mixed comparison on cores is a typed refusal. Dynamic
selection makes different pending sets the *normal* case rather than a corner,
so the envelope path stops being contingency machinery and becomes the hot path.

**1.2 The evaluation memo would be wrong or would thrash.** The memo namespace
is `evaluatorIdentity + basisKey + asTeam`, and `evaluatorIdentity` is derived
from the criterion profile, read fresh per price (the file's own comment already
anticipates *"a cohort selection changed between slices — must invalidate"*).
With per-board selection there are exactly two outcomes and both are bad:

- the identity does **not** move with the selection ⇒ a plan evaluated once
  under subset A is served from cache when subset B was wanted — **unsound**;
- the identity **does** move with the selection ⇒ every selection change
  invalidates the whole namespace — **thrash**, on a cache that exists because
  the evaluator is 45–64% of a decision's self time.

The fix is neither: the frame belongs in the **per-branch** key, not in the
wholesale namespace. `⟨namespace = evaluator ∧ basis ∧ asTeam⟩ + ⟨branch key =
view ∧ plan ∧ **frame**⟩`. Then two frames coexist in one namespace, each
serving only its own, and a selection change costs nothing already computed.
**This is the concrete reason `frame` must enter the projection table's key
before shadow-driven invocation is built, not after.**

**1.3 Worker parity.** The worker protocol keys results on an identical
`evaluationIdentity`; the same argument applies verbatim, and the protocol's own
note names identity divergence as the one thing the key cannot express.

### The rule that makes dynamic selection sound

> **Law S.** A dynamic choice may range only over members of a **VALUE**,
> **ACTION-order** or **ECONOMY** joint. It may never range over a **MODEL** or
> **REDUCTION** joint within one decision.

Because: selecting a different model per branch means two branches quantify over
different world sets, and the floors are then not comparable at all (not merely
wider — incomparable); selecting a different reduction per branch means the
decision optimises two objectives at once, which is the depth-coupling failure
the epistemics lens names, generalised. Both are representable in the type but
must be refused by the joint's declaration:

```ts
JOINTS.find(j => j.id === 'model/replies').allowsDynamic === false
```

So the joint manifest carries `allowsDynamic`, and `Choice.priced` on a joint
that forbids it is a **load-time error**, not a runtime surprise. The owner's
"every evaluator is a member of one of these collections" is exactly the joint
where dynamic selection is safe — which is a pleasant confirmation that the
example he chose is the one the mathematics permits.

---

## 2. The types

```ts
// ─────────────────────────────────────────────────────── joints as data
export type JointKind = 'model' | 'value' | 'reduction' | 'action' | 'economy';

export interface Joint<M> {
  readonly id: JointId;
  readonly kind: JointKind;
  /** Parse / validate / canonicalise ONE member's params. Replaces the
   *  hand-written key sets in botConfigFromJson. */
  readonly codec: Codec<M>;
  /** The joint's composition law. `unit` is its identity element: what this
   *  joint contributes when a bot seats nothing. */
  readonly compose: (ms: readonly M[]) => M;
  readonly unit: M;
  /** May a bot vary this joint WITHIN one decision? False for model and
   *  reduction (Law S). */
  readonly allowsDynamic: boolean;
  /** Sound-writing joints owe this as a registry-admission gate. */
  readonly laws?: LawHarness<M>;
  /** How a member proves it ran — the engagement counter, derived once here
   *  instead of hand-written per stamp. */
  readonly engagement: (t: DecisionTrace, member: MemberId) => number;
}

export const JOINTS: ReadonlyArray<Joint<unknown>> = [ /* the one list */ ];

// ─────────────────────────────────────────────────────── members
// StrategyEntry, unchanged in shape, plus the joint it belongs to.
export interface Member<M = unknown> {
  readonly id: MemberId;              // 'value/potion-seek@3' — the identity law
  readonly joint: JointId;
  readonly params: M;
  readonly primitive: PrimitiveId;
  readonly soundness: 'advisory' | 'sound-writing';
  readonly priors: EntryPriors;       // + fittedVariance, per the epistemics lens
  readonly cost: CostModel;
  readonly record: EmpiricalRecord;
}

// ─────────────────────────────────────────────────────── choices
export type Choice =
  | { readonly at: 'fixed';       readonly member: MemberId }
  | { readonly at: 'composed';    readonly of: ReadonlyArray<Choice> }
  | { readonly at: 'conditional'; readonly on: MemberId;      // a predicate member
                                  readonly then: Choice; readonly else: Choice }
  | { readonly at: 'priced';      readonly by: MemberId;      // a VOI member
                                  readonly over: ReadonlyArray<MemberId> };

// ─────────────────────────────────────────────────────── a bot
/** TOTAL over JOINTS. No `??`, no second channel, no undefined. */
export type Bot = { readonly [J in JointId]: Choice };

export function normalise(spec: BotSpec): Bot;         // resolves `extends`, canonical order
export function botId(b: Bot): string;                 // structuralIdentity(b), truncated
export function botDiff(a: Bot, b: Bot): JointDiff[];  // what an arm's claim IS
```

Three properties of this shape are worth naming because they are the design:

1. **`Bot` is total**, so the two-channel defect class (`options.slate ??
   bot.slate`, `evaluate ?? evaluatorForSlate`) is unrepresentable rather than
   forbidden by review.
2. **`Choice` is recursive through the same registry**, so a predicate and a
   pricer are members with ids, records and fingerprints — config-time and
   within-decision selection are one mechanism, which is exactly what the owner
   asked for in one sentence.
3. **`compose` is per joint**, so "how do these combine" is answered once per
   joint instead of being re-decided in each consumer's prose.

---

## 3. The three CI checks that do the enforcement

```ts
// R1 — REACHABILITY (the anti-Frankenstein clause, 00-CORE §5)
//   every exported member must be reachable from bots/ ; a member nothing
//   plays fails the build. Remedies: seat it, or delete it.
assert(setEquals(reachableMembers(loadRoster()), exportedMembers()));

// R2 — SINGLE BINDING (kills the `??` class)
//   exactly one binding site per joint, and Bot is total, so this is a type
//   check plus one lint against `X ?? Y` where both sides are config reads.

// R3 — LAW S (dynamic selection only where the mathematics permits)
for (const [jointId, choice] of entries(bot))
  if (isDynamic(choice) && !jointOf(jointId).allowsDynamic)
    throw new Error(`${jointId} may not be chosen dynamically: ${reason}`);
```

R1 is the one that changes behaviour on day one. Run against today's tree it
should immediately flag `territoryRefine`, `multistartSeed`, `sampledCap` and
`search.clusterEnum` — four alternatives no roster bot seats. If it flags
nothing, the closure is computed wrong (that is `02-JOINT-INVENTORY.md` §6's
falsifier for I3).

---

## 4. The byte-identity path

Every increment must be provable against the existing cross-build identity gate
(`src/tests/core-registry-identity.test.ts`), which asserts that a decision
under the defaults reproduces the pre-teardown build's plans, emissions, tables,
assumptions and refusals. The path:

1. `bots/shipped.json` is generated **from** `DEFAULT_BOT_CONFIG` + `LEGACY_SLATE`,
   not written by hand. The generator is the migration.
2. `normalise(shipped)` must produce a `Bot` whose interpretation is the same
   object graph the constructor builds today — the same evaluator instance, the
   same knobs object, the same tuning constants **by reference** (the registry's
   existing discipline: params are taken by reference from the shipped
   constants, never retyped, so the table cannot drift from what runs).
3. The identity gate then passes unchanged, and `botId(shipped)` becomes the
   name of the thing it was already asserting.

The one place this is not free: `order/candidates` (I4). The shipped comparator
is a function, not data, so its member form must be proved equivalent on
generated candidate sets rather than by reference. That is why it is last.

---

## 5. What I would refuse to build

A factorization proposal is only honest if it names what it will not do.

- **No joint with one member.** A joint whose collection has one member is a
  constant wearing a socket's clothes, and it invites exactly the accumulation
  the mandate bans. `model/replies` is the live example: build the *supplier
  interface* because four consumers already improvise one, but it is not a joint
  until a second member exists that a roster bot seats (the epistemics lens's
  `opp/cover@1`, extracted from the dodge rule, is that second member).
- **No generic plugin system.** `Choice` and `compose` are closed forms over a
  fixed manifest, not a scripting surface. A member is params interpreted by a
  named kernel primitive; if a candidate needs new code, it needs a branch.
- **No config-driven kernel.** The seam rule stands: anything that can move a
  sound bound is kernel behind the law harness. `set/closure` stays kernel even
  though `keepQuiet` and `candidateCap` are numbers, because they close sets.
- **No second epistemic vocabulary.** Support, weight, dilate, condition,
  projection and denomination are the EPISTEMICS lens's; this lens supplies the
  index, not a rival object.
- **No compatibility layer for the old shapes.** `docs/REFACTORING.md` licenses
  deletion, and a bridge that keeps `BotStamp`, `SlateId` and the hand-written
  codecs alive beside their generated replacements would recreate the drift the
  proposal exists to remove. The migration deletes them in the increment that
  replaces them.
