# Manifest amendments — the shared-data class, five owed items, and scoped contributions

Cycle 8 of the COMPOSITION lens. Three inputs adjudicated: the TIME lens's
manifest join (one drift: profiles have no home), the dedicated red team's
round-2 owed list (five items on my docs), and their scoped-contributions
proposal for the VALUE-side linearity gap. All adopted; six of the nine come
back with a condition or a refinement that closes a hole the proposal left.

---

## A. The shared fitted-data class — adopted, generalised, with the two rules the proposal needs

**The drift is real.** A conditional performance profile is *addressed*,
*fitted*, and *read by several ECONOMY members*. It is not a member: it composes
with nothing, and nothing selects it. Copying the fit into each reader's private
priors recreates the five-copies disease the manifest exists to kill. Same shape
for the VALUE lens's fitted `k` tables and the EPISTEMICS lens's supplier
log-loss baselines — so it is adopted as the **general class**, not a
cost-profile special case:

```ts
interface DataEntry {                    // NOT a joint member
  readonly id: DataId                    // 'data/cost-profile@3'
  readonly shape: Codec<unknown>         // validated like any member's params
  readonly provenance: FitProvenance     // ruling 49 — corpus, population, shapes, regime, metric, n, held-out
  readonly compose: 'refuse'             // there is no law; two profiles do not combine
}
```

Readable only by a member that names it in its `ReadSet`; covered by the
reachability law, so an unread data entry is deleted like anything else.

**Two rules the proposal needs, or it reintroduces what it removes.**

1. **Addressing is transitive, or `botId` lies.** A data entry is not seated in
   the bot's joint map, so nothing in `normalise(bot)` would pull it in — and a
   bot whose cost profile changed would keep its address. Rule: **a member's
   declared `reads` are part of its resolved form**, so a data entry's id (and
   through it, its `fitId`) enters the normalised bot transitively and `botId`
   covers it. Without this, the shared-data class is a hole in the address.

2. **No silent upgrade: members pin the version they read.** A member declares
   `reads: 'data/cost-profile@3'`, not `'data/cost-profile'`. Re-fitting mints
   `@4` (Law F1), and re-pointing readers is an **explicit, diffable** change.
   Otherwise one re-fit silently changes every bot that reads it — the exact
   failure mode shared mutable data always has, and the reason the identity law
   exists.

With those two rules the class is strictly better than private copies: one fit,
one provenance record, N declared readers, and the address still tells the
truth. Their non-member list (realised resolution = kernel; Law-K(b) fits with
fitted params as members; revalidation = law) is right and is recorded here so
the join cannot be read as *everything becomes config*.

---

## B. The five owed items

**B1 — `σ²_transfer` is generated, never member-computed. Adopted.** Their
precedent is decisive: member-local code that is wrong about its own semantics
is exactly the potion sign bug. So the transfer penalty is computed by the
framework from **the two premise records** — the fit's and the live decision's —
driven by a per-coordinate rule table in the manifest:

```
each coordinate declares:  distance(fitValue, liveValue) → penalty contribution
member declares:           nothing about transfer, ever
framework computes:        σ²_transfer = Σ over coordinates, recorded on the read
```

A member that does not understand a coordinate cannot under-penalise it, because
it is not asked. This also makes the penalty table **one place to calibrate**
rather than N places to audit — and it is generated into the stamp, so a reading
says what it was discounted for.

**B2 — The opponent-identity coordinate. Adopted; `08` consumed it undeclared.**
The premise index gains it in the CONFIG group (it is a property of the match,
not of our bot):

```
CONFIG-INDEX  … opponents: ReadonlyArray<{ kind: 'bot'; codeRef; botId }
                                        | { kind: 'centaur'; centaurId }
                                        | { kind: 'human' }>
```

`centaurId` is stable and public on the wire, which is what makes per-opponent
anything measurable at all. Without this coordinate `08 §2`'s population row
cannot be evaluated and the transfer table's most important row — *"the opponent
is a human"* — is unreachable. Their catch.

**B3 — Law K versus the anti-latch text. Adopted, with a type restriction.**
Law K resolves the contradiction in substance (a within-game posterior over
`Turn.moves` is replayable from public history, so it is not a latch); the
TIME lens's anti-latch *text* still reads as a blanket ban and owes a textual
amendment. Proposed wording for their line, so we do not diverge:

> the worldline holds knowledge and appetite, never calibration — **except
> calibration that is replayable from the observation ledger (Law K(a)), which
> is not carried state but a derivation over carried observations.**

And the restriction they ask for is right and belongs in the law itself:

> **Law K(a), restricted.** A replayable calibration may read **ledger
> observables only** — moves, boards, items, outcomes, commit status — and never
> timing, wall clock, load or any measured cost. Timing is not replayable, and
> a timing-derived value is admissible only under Law K(b) (spend-only).

**B4 — Law R's engagement clause needs a self-retiring waiver. Adopted.** As
written, "engaged in the ledger of at least one validated run" deletes fog
members the day before invisibility ships. The fix is not an open-ended
`instrument` mark (that is a licence to keep anything) but a **waiver that
names its blocking condition and expires when the condition clears**:

```ts
readonly engagementWaiver?: {
  readonly blockedBy: string     // 'game mode: invisibility potions'
  readonly check: MemberId       // a predicate that returns true once the mode exists
}
```

CI: a waived member passes reachability **only while `check` is false**; the
day the mode ships, the waiver stops applying and the member must engage or be
deleted. A waiver with no `check`, or one whose check has been true for a
release, fails. That keeps the anti-Frankenstein property and stops it from
eating work that is early rather than dead.

**B5 — The sentence owed to the owner. Written, and it is expectation-inverting
enough to lead with:**

> Under ruling 49, a number is only as good as the games it was fitted on — so
> the first time our bot plays alongside a human against humans, **every fitted
> advisory term goes quiet**, because no human game exists in any corpus we
> have. That is the rule working, not failing: the bot keeps its proved floors,
> its safety refusals and its move ordering, and stops asserting opinions it
> learned from games only bots played. The terms come back as human replays
> enter the corpus — a few hundred logged human turns is enough to start, and
> the same measurement (agreement with what was actually played) is what earns
> each term its voice back.

Two things worth adding for the owner's model, which the red team's phrasing
leaves out: **the mute is partial** — ordering (`ACTION`) and the sound channel
are untouched, so the bot does not get weaker at avoiding mistakes, it gets
quieter about preferences; and **it is exactly ruling 13's division** — against
humans, the bot offers conservative advice and the humans take the risks, which
is what a muted advisory channel *is*.

---

## C. Scoped contributions — adopted, with three conditions

Their proposal for the VALUE-side linearity gap I conceded in `12 §D4`: every
VALUE emission declares its **participant scope**; disjoint scopes add verbatim;
overlapping scopes must declare a connective; undeclared overlap is a static
manifest error; non-nested overlap composes by **join with recorded widening**.

**Adopted, and it is better than my sub-provenance answer** because it attacks
the linearity gap where it starts rather than documenting it after the fact. It
is also not new machinery in this codebase: the edge-EV surrogate already ships
a scoped decomposition in the ACTION joint — `Ṽ = Σφ_u + Σφ_uv`, singletons plus
pairs — so we have both the precedent and a cost measurement for the pair level.
The additive law is the singleton truncation of exactly this.

Three conditions, without which it does not deliver what it promises:

1. **Residual form, not total form.** A scope-`{u,v}` term must emit the
   *interaction residual* — what the pair is worth **beyond** the sum of its
   singletons — the Möbius/interaction-index form. If a pair term emits the
   pair's total value, "disjoint scopes add verbatim" is false and every
   overlapping pair double-counts its singletons. This is the one technical
   condition that makes the whole scheme sound, and it is invisible until
   someone writes the second pair term.
2. **Bounded arity, declared in the manifest.** Scope subsets are `2^n`. The
   manifest declares a maximum arity (2 is the precedented level; 3 for a
   declared exception) and the generator refuses a member that emits above it.
   Without a cap, the "declare your scope" discipline buys expressiveness and
   loses the cost model.
3. **Engagement per scope term.** Law M (sub-provenance) applies: a declared
   pair term that never fires in a validated run is dead code inside a live
   member and is deleted. Otherwise scoped emission becomes the new place for
   unplayed heuristics to hide — one level deeper than the last one.

With those, their two worked cases hold: the king-race double count becomes
**unrepresentable** (two singleton terms cannot both claim the joint outcome —
the claim is a pair residual or it is nothing), and body-wall architecture
becomes **one declared second-order term** rather than a fat member. And their
non-nested-overlap rule (join, with the widening recorded) is exactly my premise
algebra applied inside a joint, which is the strongest evidence yet that the two
carves are one machine: the same operation, at two scales.

I also accept their withdrawal of the proposal-side half — fat PROPOSAL members
carry only a coverage obligation, and forcing scope declarations on them would
be ceremony without a soundness argument.

---

## D. What this changes in the manifest

| addition | shape | enforced by |
|---|---|---|
| `DataEntry` class | id, codec, provenance, `compose: 'refuse'` | reachability (unread ⇒ deleted); readers pin `@version` |
| transitive addressing | a member's `reads` join its resolved form | `normalise` / `botId` |
| transfer table | per-coordinate distance → penalty | generated; members never compute it |
| `opponents` coordinate | CONFIG group | premise record; the transfer table's most important row |
| Law K(a) restriction | ledger observables only, never timing | codec on the supplier's `reads` |
| `engagementWaiver` | `blockedBy` + a `check` predicate | reachability CI; self-retiring |
| scope on VALUE emissions | participant set + residual form, arity ≤ 2 (3 by exception) | static overlap check; per-scope engagement |

Zero vocabulary conflicts remain across the branches after this pass, which
matches the TIME lens's own report: the carves describe one machine with
different spine emphasis, and the remaining differences are which of us wrote a
given row down first.
