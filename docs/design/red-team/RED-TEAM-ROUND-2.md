# RED TEAM, round 2 — adjudicating the fixes, and the constructive pass

Round-1 artifact: `RED-TEAM.md` (this directory). This round does three
things the coordinator ordered by value: (1) adjudicate the lens responses —
`design/belief-fog:09-AMENDMENTS-COMPOSITION-REDTEAM.md` @ a9114d4 and
`design/joints-composition:{08-FIT-PROVENANCE,09-REDTEAM-RESPONSE}.md`
@ 6d3bfd0 — fix by fix: closed, relocated, or unfalsifiable as written;
(2) turn my deepest round-1 objection (all five composition laws are linear,
strategy is non-linear) into a specification, using
`design/search-theory:00-WHAT-THIS-SEARCH-IS.md` and
`design/prior-art:02-anytime-and-metareasoning.md` (C7, C8) as ammunition;
(3) sharpen the VALUE seduction-check into a per-format-change table.

A red team that never concedes is noise, so the headline first: **most of
these fixes are real.** Of the fourteen dispositions adjudicated below, ten
close their break outright, two close it with one sentence still owed, one
instruments a behavior rather than fixing it (correctly, I judge), and one —
fit provenance — closes my own §2.5 finding in substance while leaving three
sharp edges. Two of my four round-1 carve failures are now resolved or
half-resolved by fixes the lenses made for *other* reasons; the status table
in §4 says exactly what remains.

---

## 1. Adjudication: the epistemics lens's eight dispositions (belief-fog 09)

| # | their disposition | verdict |
|---|---|---|
| 1 | FOGGED-VACUOUS: value-table fix becomes a prerequisite gate for fog; residency pre-registered | **CLOSES** — the dependency inversion is the right fix, not a patch |
| 2 | catchup leech: `simStale = 0` for observation-held; catchup not in the operation set | **CLOSES** — see residual note (a) |
| 3 | MAX_FROZEN: priority partition + saturated-claim demotion + boxes-one-slot | **CLOSES** — see interaction note (b) |
| 4 | reducibility tag retyped enum → operation set with prices | **CLOSES**, and the retype is better than the fix the break asked for |
| 5 | cover-weight flattening: real property, entropy instrument | **ACCEPTED-AS-BEHAVIOR** — correct call: under wider S the cover argument *should* discriminate less; the danger was misattributing it to ε, and the entropy column kills that |
| 6 | reappearance oracle: quarantine in production, throw in harness | **CLOSES** — same seam-absorb policy the rounding fix validated |
| 7 | Belief(observer) depth ≤ 1 as a declared budget premise | **CLOSES** |
| 8 | conditioning depth: no per-number tag; decision-level premise + trace-key | **CLOSES with one sentence owed** — note (c) |

**(a) Residual on #2, flagged not broken.** The leech is dead, but a
second-order price bias survives: a *compute*-held unit whose narrowing
depends on interaction with a *game*-held neighbour buys less width per
priced meet than the price list assumes (conditioning against an invisible
neighbour returns a wider result at full cost). VOI will overestimate those
meets. Not a leech — the spend is finite and bounded — but the voc
instrumentation should stratify meet yield by "neighbour hidden?" or the fog
cells will read as "narrowing got mysteriously expensive".

**(b) Interaction on #3, one joint tripwire missing.** Saturated-claim
demotion relieves slot pressure by *maximising width*, which is precisely
the input to finding #1's VACUOUS residency. The two amendments are
individually sound and jointly load-bearing in the same scenarios: heavy
fog → more demotions → more VACUOUS residency → more weight on the
est channel. Bands 1 and 3 are registered separately; the *joint* statistic
(demotions × VACUOUS residency per game) is where a compounding failure
would show first and is currently unregistered. One column.

**(c) The dissolving half of #8 has an unstated hypothesis.** "Within one
decision, conditioning depth is uniform — the ladder runs at ingestion,
before the first candidate is priced." True today because board observations
arrive only at turn boundaries. It fails the day any observation conditions
S mid-decision — which the time lens's own `observe()` is built to allow
(operator commits do exactly this to the *pin* coordinate, and epochs handle
it). The sentence owed: **any mid-decision conditioning event starts a new
epoch**, so within-basis uniformity is a law rather than a lucky property of
today's wire cadence. With that sentence, closed.

**On the pre-registered bands (#9).** Band 2 (catchup spend on game-held
units = ZERO) and band 3 (TooManyHeldError = ZERO) are genuinely
falsifiable — zeros are numbers. Band 1 as written is a *procedure for
producing a band* ("predicted from cloud-width forecasts"), not a band; the
document promises numbers "published in the fog-cell spec before the runs".
That promise is the right process, but until the numbers exist the claim is
unfalsifiable, and the failure mode is publishing a band wide enough to be
unmissable. Demand: band 1 ships with its width justified by the dilation
curve's own variance, and the spec names who computes it and when.

---

## 2. Adjudication: the composition lens's six adoptions (joints 09)

| break | their fix | verdict |
|---|---|---|
| 1 economy obligation law | allocation (partition) + obligation (meet on deadlines, kernel pin as bottom) | **CLOSES**, and quietly re-opens half of my F3b — note (d) |
| 2 Choice transport | `invariant / re-evaluate / expires`; latched conditional must mint a Carried | **CLOSES** — routing latches into the one object with a lifetime is the right unification |
| 3 calibration | Law K: replayable (a) or spend-only (b), else refused | **CLOSES — and resolves my F10 in substance without saying so** — note (e) |
| 4 one-reduction vs ruling 13 | site-class table with constraint column, one binding broadcast to `free` rows | **CLOSES** — divergence bounded and visible; the depth-coupling theorem survives |
| 5 B5 falsifier | split within-turn re-entry from cross-turn carry; judge carry on decisions changed | **CLOSES** |
| 6 Law R runtime twin | reachable in config AND engaged in a validated run | **CLOSES with one sentence owed** — note (f) |

**(d) Break 1's fix intersects my F3b, and the intersection should be
claimed on purpose.** `economy/emit` becoming a joint (reaction table over a
kernel-pinned floor) creates a seat my round-1 doc said didn't exist — for
the *reactive* half: "an opponent committed" is a determination source, so a
member row can now say what to do when `movedPlayerIDs` grows (e.g. shift
spend toward the hypothesis market's now-cheaper targets, since frozen
opponents stop being simultaneity rows). Adopt that reading explicitly and
F3b's reactive half is closed. What remains open is exactly what I re-verify
here: the **proactive** half (when do *we* lock — an outbound action whose
strategic content is donating or hoarding the shared clock) has no member
surface, because the commit is operator-owned ("human-triggered Submit
All"), which lands it in F11's missing advice joint. F3b is hereby narrowed
from "no seat at all" to "reactive seat exists post-fix; proactive seat is
an F11 dependency". That is real progress made by their fix, and I am
recording it as such.

**(e) Law K closes my F10 — the lenses should say so out loud and reconcile
the texts.** My round-1 F10: within-game opponent adaptation is listed among
the five asks the Carried object serves (05 §1) and simultaneously forbidden
by the time lens's anti-latch law ("the worldline holds knowledge and
appetite, never calibration") plus advance's "values never cross". Law K
dissolves the contradiction in the right direction: a learned opponent
posterior whose update rule is a member with fixed params, computed
deterministically from the recorded observation ledger, is class (a) —
REPLAYABLE — and may affect behaviour (it prices and orders through the
supplier socket) without entering the address, because `⟨botId, ledger⟩`
determines it. Same ledger, same trajectory: the latch class the anti-latch
law exists for cannot occur. **F10 is therefore downgraded from carve
failure to textual reconciliation owed:** the time lens's anti-latch law
must be amended to "never holds calibration *except class (a)/(b) under Law
K*", or the two branches ship contradictory laws and the next reader
re-derives my finding. One residual: Law K(a)'s replay guarantee requires
the observation ledger to be *complete* for the posterior's inputs —
opponents' realized moves are on the Turn doc, fine, but if a supplier ever
learns from *timing* (arrival latencies, commit order), those are exactly
the wall-clock quantities the time lens removed from replay. Constrain
class-(a) suppliers to ledger-recorded observables by type, not by review.

**(f) Law R (amended) needs the instrument carve-out extended, or it deletes
the fog programme the day before its game mode ships.** "Engaged in the
ledger of at least one validated run" is unsatisfiable for fog-only members
until fog harness cells exist. The existing escape (a roster bot marked as
an instrument, 07 §5.2) covers config reachability; extend the same mark to
the engagement clause with an expiry ("instrument until cell X lands, else
delete"), and the law keeps its teeth without eating the future. One
sentence.

---

## 3. Adjudication: 08-FIT-PROVENANCE against my §2.5

My round-1 finding: ruling 49's own consequence — fit provenance as premise
coordinates — had no home in the four-group index; nothing could refuse a
k = 1.227 fitted on snake boards being read on a rook board.

**Verdict: CLOSED in substance.** The mechanism is right and in the right
place: `FitProvenance` as a member-level record; Law F1 putting `fitId` in
the entry fingerprint so a re-fit mints a new member id (the identity law
extended to evidence — this is *better* than the coordinate I asked for,
because it makes fit changes raceable arms rather than annotations); Law F2
computing `σ²_transfer(fit.premise, live.premise)` at consumption with
unknown-coordinate-widens-to-maximum; and the honest launch table (human
opponents = maximum penalty). The three consequences (nobody remembers
caveats — arithmetic carries them; no provenance ⇒ no precision;
"validated" becomes a coordinate) are exactly what the ruling asked for.

Three sharp edges, none fatal:

1. **Say the launch consequence to the owner in one sentence: in production
   centaur play, every fitted advisory term self-mutes on day one.** The
   penalty table sets population = human to maximum, and no corpus contains
   a human game yet, so `advisoryPrecision ≈ 0` for every fitted member in
   every live game: they order, and move no belief. I judge this *correct*
   (it is ruling 49 applied to itself), and their falsifier 2 owns it as a
   finding-not-bug — but the owner should hear it as a sentence, not
   discover it as a flat mechanism column, because it inverts the natural
   expectation that validation makes members do more in production. The
   remedy is also worth naming: human replays are corpus rows
   (`metric: 'log-loss'` on `Turn.moves` costs no matches), so the penalty
   decays with exactly the data centaur play generates.
2. **The penalty must be computed by generated code, not by the member.**
   Law F2 as written says "a member that cannot compute a transfer penalty
   for a coordinate it does not understand must widen to the maximum". A
   member computing its own humility is the fox auditing the henhouse — the
   defect record (the potion terms' backwards sign) is precisely
   member-local code being wrong about its own semantics. The premises are
   declared data on both sides; `σ²_transfer` should be a manifest-generated
   function of the two records, with the member supplying nothing.
3. **The live premise's population coordinate must exist before F2 can
   run.** Computing a population mismatch requires the live decision to know
   who the opponents are. Today no premise coordinate carries opponent
   identity (CONFIG carries *our* botId/seat). The fix is one coordinate —
   opponent identity when known, `unknown` otherwise, with `unknown`
   triggering the maximum-widening rule — but it must be added to the index
   schema explicitly; 08 consumes it without declaring it.

Their §4 ("six degrees of freedom not expressible today, no new joint")
deserves one honest sentence: all six are real and all six are
`conditional`-choice recombinations *within* the lattice — none touches the
four round-1 families that need a law change. The six show the machine is
richer than the config file; they do not answer the expressiveness test.
The scorecard in §4 below is the answer's current state.

---

## 4. Round-1 findings: status after the fixes

| round-1 finding | status |
|---|---|
| F1 sacrifice (three stacked walls) | **STANDS** — no response addresses it; still needs the owner (closure law) |
| F3b commitment-timing | **NARROWED** — reactive half closed by joints break-1 fix (adopt the reading in §2(d)); proactive half now an F11 dependency |
| F10 in-game adaptation contradiction | **RESOLVED IN SUBSTANCE by Law K** — textual reconciliation owed from the time lens; class-(a) suppliers must be type-restricted to ledger observables |
| F11 operator-advice joint kind | **STANDS** — no lens has touched it; now also carries F3b's proactive half |
| fat-member / linear-laws | **CONSTRUCTIVE SPEC BELOW (§5)** — and partially self-corrected: proposal-side fat is harmless (§5.1) |
| missing coordinate: fit provenance | **CLOSED by 08** with the three edges in §3 |
| missing coordinate: admission trace | **STANDS** — no response; note C8's corollary (prior-art 02) independently derives why it matters: an economy pricing meets by width alone overspends off the decision boundary, and without the admission trace that mis-spend is unmeasurable |
| missing coordinate: resolved conditional selections | **STANDS**, and grows teeth: joints break-2 makes `conditional` re-evaluate per advance, so per-decision resolution volatility is now guaranteed — the telemetry gap widens |
| unwritten cross-horizon law (depth rung) | **STANDS** — no response yet; belief 09 §8's decision-level premise is adjacent but does not license the rung |
| zombie commitments (F4/F7 revalidation) | **NARROWED** — Carried has `invalidate: MemberId` (05 §4), so the gap is not absent invalidation but *cheap-predicate-only* invalidation: a combination refuted only by deep search never trips a cheap predicate. Refined demand: bot-authored Carried objects owe a scheduled re-pricing obligation — a row in the (new) ECONOMY obligation law, which break-1's fix conveniently just created the home for |

---

## 5. The constructive pass: a non-linear composition law that keeps the manifest honest

Round 1 said: all five kind-laws are linear (join / weighted sum /
partition), strategy is mostly non-linear (races, walls, combinations), so
every non-linear idea becomes one fat member and the manifest goes blind one
socket at a time. The coordinator is right that this must not stay an
objection. Two pieces of the other lenses' work supply the algebra.

### 5.1 First, a self-correction: the proposal/value distinction halves the problem

`design/search-theory` 00 §2.3 draws the line my round-1 finding missed:
the cluster machinery is a **coordination graph used as a proposal
operator**, and *"coordination graph as value decomposition is unsound here
… coordination graph as proposal generator has no soundness obligation at
all, only a coverage obligation."*

Applied to my families: a multi-turn pincer generator, a wall-architecture
proposer, a race-line generator are **ACTION-side proposal members**. A fat
proposal member is *harmless to the manifest's honesty* — its output is
priced whole by the unconditional bank and adjudicated by `better()`; there
is nothing about its internals the composition law needs to see, only
coverage counters (how often its proposals were admitted / priced / won,
which the engagement ledger of Law R-amended already records). So:

> **Amendment A (proposal licence).** ACTION members that only *emit
> candidates or plans* carry no composition obligation beyond coverage
> telemetry. Fat is fine here, by the same argument that makes the cluster
> enumeration sound. My round-1 finding is withdrawn for this half.

The real hazard is **value-side fat**: a member that folds a non-additive
interaction into one emitted number, invisible to the VALUE law. That is
the half needing an algebra.

### 5.2 Scoped contributions — the Möbius form of the VALUE law

The VALUE currency is a set function over accounts and events: the team
value of a plan is not a sum of per-unit terms whenever units interact.
The mathematically canonical way to write any such set function is its
**Möbius / interaction decomposition**: `V(A) = Σ_{T ⊆ A} q_T`, where
`q_T` is the interaction term of exactly the participant set `T`. The
current law — weighted sum of per-term emissions — is the truncation of
that series to singletons. The fat member is a `q_T` with `T = everything`,
undeclared. The fix is not to forbid higher-order terms; it is to make the
participant set a declared, typed part of every emission:

```ts
interface Contribution {
  readonly member: MemberId
  readonly scope: ScopeId            // the accounts/units/events this term couples
  readonly relation?: {              // REQUIRED when scopes overlap another member's
    readonly with: ScopeId
    readonly connective: 'independent' | 'exclusive' | 'conditional'
  }
  readonly flow: 'in' | 'out' | 'transfer'
  readonly rate: Interval            // the VALUE lens's schema, unchanged
  readonly horizon: number
}
```

> **Amendment B (scoped VALUE law).** Contributions with **disjoint scopes
> compose additively** — the current monoid, verbatim, now provably the
> special case. Contributions with **overlapping scopes** must declare a
> connective: `independent` (add — an explicit claim, now checkable),
> `exclusive` (a race: at most one realizes; composed by the REDUCTION at
> the declared event boundary, e.g. `min` over arrival plies), or
> `conditional` (gated on a premise — an anticipatory term, priced in the
> stronger fiber, which the two-purchase-column meet already handles).
> **An undeclared overlap is a manifest error**, caught statically per bot
> by the generator: two members claiming the same account with no declared
> relation cannot be seated together.

This makes the king-hunt race representable *between* members: my
king-attack outflow (`scope: their-king-account`) and their counter-attack
transfer (`scope: our-king-account`) declare `exclusive` with the race's
event boundary, and the double-count that additive composition commits is
unrepresentable rather than undetected. A wall is a `q_T` with
`T = {wall units, enclosed region}` — one declared second-order term, not
a fat member. And the sub-provenance demand from round 1 stops being
documentary: a member computing internally over a compound scope must emit
its internal decomposition as scoped sub-contributions, because the scope
field is on the *emission*, not the member.

### 5.3 The licence and its exact limit, from C7

`design/prior-art` 02's C7 supplies both: local compilation (per-joint
composition, no global solve) is optimal on TREES and NP-complete on DAGs.
Scoped contributions inherit precisely that boundary:

- **Nested scopes (a hierarchy: unit ⊂ cluster ⊂ team) form a tree** —
  composition is exact by local folding, and the generator can *verify*
  nesting per bot. This is the common case (walls, per-cluster terms,
  team-level flows) and costs nothing.
- **Overlapping non-nested scopes make the composition graph a DAG**, and
  the law must not pretend to solve it: the composition falls back to the
  lattice's own discipline — **join** (widen: interval hull over the
  connective's cases, sound and lossy) or a typed refusal. Never a silent
  sum.

> **Amendment C (tree condition).** The generator checks each bot's scope
> family for nesting. Nested ⇒ exact local composition. Non-nested
> overlap ⇒ the declared connective must be resolvable by the REDUCTION at
> one event boundary, else the contributions compose by join and the
> widening is recorded (an `Assumption`, like every other join). The
> manifest column says which regime each seated bot is in — so "this bot's
> value law is exact" vs "this bot carries a widening" is a printed fact,
> not a hope.

This answers C7's demand directly: the design no longer inherits a tree
theorem while running a DAG — it declares which projection is a tree and
pays a recorded widening where it is not. And C8's market factor
(P(refinement flips `better()`) from interval overlap at the contested
rung) composes cleanly with scoped contributions, because exclusivity
boundaries are exactly where interval overlap concentrates.

**Cost, counted honestly (round-1 §3 discipline):** one field on
Contribution, one relation record, one static check in the generator, one
manifest column. No new joint, no new kind, no change to REDUCTION's
"exactly one" (the connective is *resolved by* the one reduction, not a
second reducer). The additive law survives as the disjoint case, so B6's
falsifier (reproduce the shipped order exactly) is unaffected. I believe
this is the smallest algebra that makes value-side fat decomposable, and I
put it forward as a proposal to the composition lens, not a ruling.

---

## 6. The VALUE seduction-check, made testable: which format changes break the fold

The fold: `ΔS = (K/W) · Σ sign · shareFactor(side) · rate · horizon`, with
`k ≈ 1.23` fitted, validated at R² 0.97 against **sharePar** on three
rosters. The claim to test: the currency is an artifact of the scoring
rule, and ruling 49 says exactly this class of distortion is the danger.
Per change, does the fold survive, and *which part* breaks:

| format change | identity `S = K·w/W` | flow basis (in/out/transfer) | fitted k / γ | verdict |
|---|---|---|---|---|
| team count 2 ↔ 3 ↔ 4 | survives (K, W, p computed live) | survives | survives (the asymmetric fold is the fix) | **SURVIVES** — measured: the 2.00 ratio identity |
| roster mix / new piece kinds | survives | survives | **open question** — exactly the rook transport test; per 08, a crossing with a penalty | **SURVIVES structurally**, k re-fit priced by F2 |
| budget / time-control changes | survives | survives | k re-fit (regime coordinate) | **SURVIVES** via 08's regime row |
| turn-limit length | survives | survives | k shifts (compounding premium is horizon-dependent) | **SURVIVES**, re-fit flagged |
| turn-limit tiebreak changed (e.g. territory, not weight) | **breaks** — terminal observable is no longer weight share | flows still real, wrong target | invalid | **BREAKS** |
| win-only scoring (1st = 1, else 0) | **breaks** — E[share] ≠ P(win); value becomes a threshold functional of the share trajectory | account algebra survives as MODEL | invalid — and γ = 1 is *wrong in sign* when behind (variance-seeking is correct under win-only while losing) | **BREAKS**, dangerously: the "no cliff to cross" theorem fails (a death that does not change win rank costs ~nothing) |
| elimination bracket / best-of-N series | breaks per-game — payoff is P(advance), coupling series state | survives per game | invalid; risk preference is series-state-dependent | **BREAKS**, and needs a coordinate the index lacks (series/match context) |
| bounty / points-per-kill variants | re-derives (terminal functional still additive in events) | transfer channel reweighted | re-fit | **SURVIVES IF** the terminal functional is swappable |
| king-death = team elimination | survives | **breaks additivity** — one account's wipe ends all accounts; an infinite cross-account coupling | invalid for royal terms | **BREAKS the additive law; representable under §5.2** as one `exclusive`-scoped term on the king account |

The pattern is exact and one sentence long: **the fold survives every change
that redistributes measure over the same terminal observable (teams,
rosters, budgets, lengths) and breaks under every change to the terminal
functional itself (what the game pays).** So the testable demand:

> **The terminal functional becomes a seated member** — one per format
> (`sharePar-at-limit`, `win-only`, `series`, …), MODEL-kind (it is a fact
> about the rules, like `model/terminal`'s adjudication, which already
> exists and already has three drifting copies — this is the same fix
> extended one level). Every fitted coefficient's `FitProvenance.metric`
> field then references the terminal member's id **instead of a bare string
> enum**, so consuming a sharePar-fitted k under a win-only terminal is a
> population-class mismatch F2 already prices. 08's schema needs a one-line
> change (`metric: MemberId`), and the three-copies finding gets its
> fourth copy prevented for free.

Falsifier for the whole table: run the existing replay corpus re-scored
under win-only and confirm the fold's R² collapses and the γ-sign
prediction (variance-seeking when behind) appears in the residuals. No new
games needed — it is a re-scoring pass, the cheapest test in this document.

---

## 7. What this round changes in the demand list

Demands 1 (sacrifice), 2 (advice joint — now carrying F3b's proactive
half), 4 (cross-horizon law), 5-partial (admission trace, resolved
selections), 6 (read-sets by construction), 9-as-amended (scoped
contributions, §5) stand. Demand 3 (F10) converts to: time lens adopts Law
K and amends its anti-latch text; class-(a) suppliers type-restricted to
ledger observables. Demand 7 narrows to a scheduled re-pricing row in the
new ECONOMY obligation law. Demand 8 (reduction functional API) gains the
site-class table as its natural home. New: 08's three edges (§3), the
terminal-functional member (§6), band 1's numbers before the first fog run
(§1), the epoch sentence (§1c), the Law-R instrument expiry (§2f).
