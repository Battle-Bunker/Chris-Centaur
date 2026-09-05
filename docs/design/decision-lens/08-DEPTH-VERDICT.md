# 08 — DEPTH VERDICT: what the measurement settled, and the one ply worth building

DECISION-LENS, document 8. Inputs: `06-LOOKAHEAD.md` (the design), the depth
worker's merged preconditions (`439bec4`, F-1..F-7) and its measurement,
`07-MEASURED.md` (the O1 run), `03-KERNEL-SURFACE.md` §2.4 (the set-valued
reduction), and the extracted theory — `04-BACKUP` (the backup joint and its
laws), `05-SEARCH-SYN` (REDUCTION, and the restricted matrix computed and
discarded), `07-ANYTIME` (recognizable quality), `16-TERMINAL` (the boundary),
`07-SYNTHESIS` (Laws H and H′), `TIME-SYN` §2 (the interruption curves).

The owner's question is unchanged and is still the right one:

> *"I want insight about lookahead beyond the very next turn … but I want that
> information legible in illuminating summary to inspection of candidate
> movesets."*

`06` designed the answer as chained depth. The depth worker built the
preconditions, built depth 2, measured it, and did not engage it. This document
says what that measurement settled, evaluates the five successors against the
same numbers, and recommends one sequence.

---

## 0. The verdict, on one page

**The depth worker is right and the reason is structural, not budgetary.** A
chained ply needs a concrete board one turn on; a concrete board needs a
complete concrete joint reply; and a partial settlement does not have one,
because it settles the turn *with the held units absent from the board*
(`src/engine-vendor/engine/settlePartial.ts:33`). Its optimistic timeline is not
a board any world reaches, so it cannot be chained from. Where the ledger *is*
empty the timeline is concrete — and then the ply-1 bracket is already exact and
there is nothing left for a second ply to contract.

**And the measurement adds a second, sharper fact that neither the design nor
the verdict states: the affordability of a chained ply is anti-correlated with
its value.** The bank's B3 rung already enumerates the whole cross-product when
it fits under `productCap: 512` (`src/lobster/bounds/bank.ts:132`, `:552-591`),
and B3 is the only rung that can report `exact`. So on `mixed` seed 1:

| reply product | n | share | ply-1 state | chained ply-2 |
|---|---:|---:|---|---|
| no piece held | 50 | 14.1% | nothing to enumerate; ledger empty | **nothing to buy** |
| ≤ 24 | 6 | 1.7% | **B3 closed it** — exact when the residue empties | affordable, nothing to buy |
| ≤ 512 | 66 | 18.6% | **B3 closed it** | 2,560 settlements — 5.4 decision budgets |
| ≤ 4096 | 125 | 35.2% | B3 declined; B1/B2 only; bracket open | ~20,480 settlements |
| > 4096 | 108 | 30.4% | B3 declined; bracket open | worse |

**122 of 355 occasions (34.4%) are already closed at ply 1 by the rung that
enumerates the whole product, and those are exactly the 122 a chained ply could
pay for.** The 233 where the bracket is genuinely open (65.6%) are exactly the
233 where it costs 40× a decision's budget. That is why cap 24 fired four times
in sixty turns and changed no staged decision: it was not underpowered, it was
**pointed at the decisions that had nothing left to prove.**

**So the way forward is not a cheaper tree. It is to stop spending on the
channel that cannot pay and spend on the two that can.**

1. **Ship the threat/opportunity map per row (candidate d), now.** It costs zero
   settlements — every input is a value `better()` already produced, it is
   already computed at the barrier (`src/lens/kernel/reservoir.ts:62-95`),
   already stored (`src/database/schema.ts:205-206`), and today it is drawn for
   exactly one pair of rows (`src/lens/view/index.ts:488-512`). Per row it says
   *"this moveset leads unless r3 and q1 resolve against us — 2.4 at stake"*.
   That is insight about the next turn's contingencies, and it is the
   set-valued reduction `05-SEARCH-SYN` §2.4½ says is computed and thrown away.

2. **Then build one ply on the ceiling only — the CEILING PLY (a disciplined
   member of candidate c).** Its cost does not scale with the reply product at
   all; it scales with the *loud* subset of it, and the MAX layer costs nothing
   because our own continuations are covered by holding our own units rather
   than by enumerating them. That is the mirror rung `06` Q-L3 asks for, and it
   turns out to be free.

3. **Reject (b) on the arithmetic above. Keep (a) as a diagnostic, never as a
   ranking input. Defer (e) behind the REDUCTION declaration**, without which
   `05-SEARCH-SYN` §2.3 says an opponent model is unfalsifiable by construction.

**The honest headline for the row is not "the bot now looks two turns ahead". It
is "the bot removes optimism one turn further out, and names what each moveset
is betting on."** Depth on this architecture cannot raise a floor affordably.
It can lower a ceiling, and a lowered ceiling retires rivals by certificate.

---

## 1. What was built, and what the measurement means

### 1.1 The preconditions are merged and they are the right ones

`439bec4` merged five commits, and all five are load-bearing for anything that
follows. Read as a set they say: *the depth seam is now honest and instrumented,
and nothing on it has ever carried a number other than 1.*

| commit | what it settled | why the ceiling ply needs it |
|---|---|---|
| `6be9494` | root slack is a rival quantity; `slackFor`'s dead guard removed | the ration reads `slack` to decide stability (`src/lobster/voc.ts:667-671`); a degraded slack rations depth wrongly |
| `ad68ef1` | `refinementView` gets a producer; horizon travels on the READING, per plan | F-1/F-2. `depthMax: 1` and an honest `no` through a real seam (`src/lobster/search/core.ts:1123-1130`) |
| `dbdb740` | `est` is a summary at a horizon, guarded at all three sites and at the gate | F-4/F-8. The ceiling ply never touches `est`, and this is why it can be sure |
| `2ec3533` | `DEFAULT_SWITCH_MARGIN` re-derived from the bounds; still a constant | F-6. The margin does noise work; the guard does horizon work; neither borrows the other's job |
| `c3f0412` | the turn cap seated (`src/lobster/evaluate/terminal.ts`) | F-7. Depth's only route to a LEVEL change is the boundary, and the boundary is now whole |

Every one of those was merged byte-identical on all twelve runner arms, and the
reason is stated in `ad68ef1`'s own message: every horizon on this build is 1, so
each guard is inert. **That is the correct shape for a precondition: it is the
code that would be needed if depth arrived, installed while it cannot move
anything, and therefore installable with a gate that can see a change.**

### 1.2 The two refusals, stated exactly

**Refusal 1 — the optimistic timeline cannot be chained.** `settlePartial` calls
`settleTurn` over the LIVE units only, with the held bodies present for
*legality* and absent from the collision phase
(`src/engine-vendor/engine/settlePartial.ts:278-323`). The board that comes back
is the board of the world in which none of the held units interfered. Chaining
from it stages turn `t+1` on a position that no world reaches, and every
`Divergence` the ply-1 ledger named is a way the real board differs from it. A
ply-2 reading taken there is a reading *conditional on the whole ply-1 ledger
resolving our way* — which is a narrowing, which changes the `BasisKey`
(`src/lobster/bounds/score.ts:77`), which makes `compareFloors` refuse
(`:530-533`), which makes the row present and **not sorted against the others**
(`06` §2.2's `✂`). Chained depth off a partial settlement is either unsound or
incomparable, and neither is worth a settlement.

**Refusal 2 — where it can be chained there is nothing to chain for.** The
timeline is a real board exactly when the ledger is empty, and an empty ledger is
`settlePartial`'s T1 proof that the held set did not matter (`06` §6.3). Then the
ply-1 bracket is exact: `lo = hi`, `Δ_width = 0` by construction. And the interior
of the evaluator is potential-based, hence telescoping (`VALUE-SYN` §2, `06`
§1.4), so summing two plies of interior terms gives the same number as scoring
the second board once. **The only channel left is `Δ_terminal`** — and on the
twelve 60-turn arms the 100-turn cap is never reached (`c3f0412`), so
`Δ_terminal` can only mean elimination inside two turns. That is a real but very
thin channel, and it does not justify a tree.

### 1.3 The finding the numbers add: affordability is anti-correlated with value

This is the part that changes what to build next, and it is read off two places
in the code plus the measured distribution.

`bank.ts:552-591` runs B3 — every gated unit live at once, the whole
cross-product — whenever the gate covers everything, every option list is
complete, and `product <= productCap`, with `productCap: 512` (`:132`). B3 is
documented as *"the only rung that can report `exact` — and only when the residue
also empties"* (`:48-51`). So the product classes are not merely a cost axis;
**they are a proxy for whether ply 1 already answered the question.**

Cross the distribution with the rung that fires:

| product | n | B3 eligible? | ply-1 bracket | one deepening (C=5) | ×2 ration targets | as multiples of ~470 nodes |
|---|---:|---|---|---:|---:|---:|
| no piece | 50 | n/a | exact | 0 | 0 | 0 |
| ≤ 24 | 6 | **yes** | exact-when-residue-empty | 120 | 240 | **0.51** |
| ≤ 512 | 66 | **yes** | exact-when-residue-empty | 2,560 | 5,120 | **10.9** |
| ≤ 4096 | 125 | no | open | ~20,480 | ~40,960 | **87** |
| > 4096 | 108 | no | open | ≥20,480 | ≥40,960 | **≥87** |

(The decision budget is ~470 evaluator nodes against ~11,000 reads at a 150 ms
`mixed` budget — `src/tests/local-game.ts:99-107`, `NODE_COST = 1` at `:119`. The
ration deepens at most two plans per decision, the leader and the highest-`hi`
un-refuted rival — `src/lobster/voc.ts:694-723`. `C = 5` is `LENS_TOPK`,
`src/lens/types.ts:69`, and is the count of continuations a MAX layer would price;
the 2,560 figure is the depth worker's own and it reproduces as 512 × 5.)

> **Finding D-1 (inverse selection).** The reply product is simultaneously the
> cost of a chained ply and the inverse of its value. Below `productCap` the
> product is small *because* the held set is small, so B3 has already closed the
> bracket and depth has no width to remove; above it the bracket is open and the
> ply costs tens of decision budgets. **A cap on the reply product therefore
> selects, with near-perfect precision, the decisions on which deepening cannot
> change anything.** Four firings in sixty turns and zero staged changes is not
> a small effect measured noisily; it is the effect this selection rule
> guarantees.

The corollary is the design instruction: **any affordable deep member must be
selected by a quantity that is not the reply product.**

---

## 2. The cost unit, once, so the rest of the document can be arithmetic

One **settlement** is one `settlePartial` plus the evaluator call on its result.
`computeClaims` is *not* per settlement: it is a pure function of the held
records and the board, computed once per (held set, narrowing) and handed back as
`settlePartial`'s third argument (`src/engine-vendor/engine/settlePartial.ts:270-283`;
`src/lobster/substrate.ts:35-40`). A decision's budget is ~470 nodes. The lens
retains ≤5 rows per `(cluster, complement)` and ≤24 per decision
(`src/lens/types.ts:69,72`), and 07-MEASURED confirms both caps bind and neither
is wasted.

Two facts about the seam that every candidate below uses:

- **Holding is the default; naming is the exception.** *"Omitting the unit from a
  plan does something else entirely: it becomes a held claim"*
  (`src/lobster/substrate.ts:76-81`), and `resolveBoundedFor` derives its own
  held set from the plan it is given (`:117-118`, `:1012`). Holding a unit is a
  sound relaxation of enumerating it — the held lemma
  (`src/lobster/bounds/substrate-ext.ts:13-16`).
- **The dilation parameter already exists.** `span = max(1, input.turn −
  held.observedTurn)` (`src/engine-vendor/engine/claims.ts:396`), consumed by
  `computeClaims` (`:309`), and everything it produces over-approximates: *"every
  set is a superset of the truth and every interval contains it"* (`:31-34`).

---

## 3. The five candidates

### 3.1 (a) Abstract plies — extend the held enemies' claims a second turn

**The construction.** Keep the held records at their observation and settle turn
`t+1` instead of `t`, so `span` becomes 2 and each claim's `headPossible` is the
union over two turns of unknown movement. One `computeClaims`, one settlement per
continuation, no reply enumeration at all.

**Soundness.** The claim is a superset and the interval contains the truth
(`claims.ts:31-34`), so *the object that comes back is a bracket*. But it is a
bracket of the wrong question. The base board is the optimistic timeline, on
which the held units are absent and our own units may not have survived, so the
span-2 reading is a bracket conditional on the ply-1 ledger. Two honest ways to
carry it and both are dead ends:

- take the **hull** — Law H′, *"across horizons the sound channel yields the hull,
  never an intersection"* (`07-SYNTHESIS` §3). The hull of a narrower and a wider
  bracket is the wider one. The deep reading can then only ever *widen*, and a
  strictly wider reading cannot move a ranking in any direction;
- **declare** the ply-1 divergences as a narrowing — `withNarrowing`
  (`src/lobster/bounds/score.ts:548`), new `BasisKey`, `compareFloors` refuses
  (`:530-533`), `better()` keeps the incumbent
  (`src/lobster/search/core.ts:577`). The row renders `✂`, present and not sorted.

**Cost.** `2 × (1 + C)` settlements per decision — 12 at `C = 5`, ~2.6% of the
budget, and **flat in the reply product**: the 108 occasions above 4096 cost
exactly what the 6 below 24 cost. It is by far the cheapest candidate.

**What the lens row shows.** `h2` with **no line**, which `06` Rule L-1 forbids
outright: *"a row with a depth number and no line is a number the operator cannot
check."* Worse, dilation is already in production under another name — staleness
— and `06` §2.4 reserves `stale` for the complement precisely so the two never
share a glyph. A dilated `h2` would collide with a word the lens has already
spent.

**What a transcript changes.** Nothing in the ranking, by construction. Every
retained row's bracket widens by the same mechanism, the order is preserved
because the widening is monotone in the same direction on every row, and the
depth column reads `h2 ↕` — `compareConfidence` (`src/lobster/voc.ts:99-106`)
answers `incomparable` for deeper-but-looser, which is what this always is.

**Verdict: keep it, and only as a diagnostic.** There is one thing it is good
for and it is worth a line in the drill-down rather than a column: *how much of
this row's bracket is the enemy's first unknown move, and how much would a second
one add?* That is a legible statement about how fast our knowledge decays, it
costs 12 settlements, and it must never reach the comparator. It is the answer
for the 108 `> 4096` rows, where nothing else is affordable and the honest cell
is otherwise blank.

### 3.2 (b) Selective deepening for clusters whose reply product ≤ 24

**Population.** 6 of 355 on the product alone (1.7%); 56 (15.8%) if the 50
no-piece occasions are counted, and they should not be — there is no enemy to
reply, so the "deepening" is our own continuation against nothing.

**Cost.** 120 settlements per deepening at `C = 5`, 240 for the ration's two
targets — **0.51 of a whole decision's budget**, spent on 1.7% of decisions, so
~4 settlements per decision amortised (0.9%). Affordable in expectation. That is
not the problem.

**Soundness.** Fine. At `P ≤ 24` the sweep is complete, `closeGroup` may raise
the floor (`bank.ts:587`, `:740`), no narrowing is declared, the basis is
unchanged, and an exact min is exactly what `06` §1.5 licenses.

**What it buys.** Nothing, measured: four firings in sixty turns, zero staged
decisions changed. And Finding D-1 says that is the rule and not the sample:
`P ≤ 24 < productCap` means B3 has already enumerated that same product at ply 1
and closed the bracket. **Selective deepening at ≤24 re-derives, one turn later
and at half a decision's budget, an answer the bank already had exactly.**

**What the lens row shows.** `h2` with a zero delta on four rows in sixty turns,
and `h1 · not affordable` on the other ~99%. The doc is right that the honest
"not affordable" is better than a blank — but a column that is honest about a
member that never moves anything is a column that would be equally honest with
the member deleted, and `h1 ·` on every row already says the same true thing at
zero cost.

**Verdict: reject.** Not because it is expensive and not because it is unsound,
but because the selection rule provably picks the decisions with nothing to buy.
If a variant of this is ever wanted it must be selected on the ledger — deepen
where `ledgerSize > 0` and the product is small — and the measurement says that
conjunction is close to empty, because the ledger is small for the same reason
the product is.

### 3.3 (c) Quiescence — deepen only through captures and contests

This is the candidate with the right shape, and §4 develops it. Here is why it is
right and what has to be fixed before it is sound.

**The selection quantity is not the reply product.** A reply that never touches
our staged footprint cannot change material, cannot resolve a contest, and cannot
move either endpoint of the bracket. Define the **loud** subset of one held
enemy's options as those whose path intersects the staged plan's footprint in
sub-step time — the same relation the entanglement gate already computes per
unit (`bank.ts:115`, `gateOnEntanglement`), applied per option instead. The
**quiescent product** `Q = Π_e |loud(e)|` is bounded by the reply product and is
plausibly very much smaller: `thinQuiet`'s own classifier already knows that on a
long ray only a handful of prefixes are interesting — the first index, the
horizon, every maybe-stop and the cell before it, and every terrain event, *"and
everything else is QUIET"* (`src/lobster/candidates.ts:878-925`). The 4096+
products come from long rays; the loud subset of a long ray is a handful.

**Two problems before it is sound, and §4 solves both.** The first is
chainability: restricting the MIN layer does not by itself produce a board to
chain from, and Finding D-2 (§4.1) says only a *fully enumerated* held set does.
The second is parity.

**The parity problem, and why naive quiescence gets neither endpoint.** `06` §0's
rule: truncating *their* replies keeps ceilings sound and breaks floors;
truncating *our* continuations keeps floors sound and breaks ceilings. A
quiescence search that truncates both layers has a sound floor from the MAX
truncation and a sound ceiling from the MIN truncation — of **two different
readings**, and neither bounds the other's quantity. That is the trap, and it is
the trap `04-BACKUP` Finding B-2 describes one field over.

**The fix is that the MAX layer needs no enumeration at all.** Hold our own
units. A claim over our continuation set over-approximates every continuation we
could play, so the `best` endpoint of the bracket with our units held is an upper
bound on `max over our continuations` — with zero enumeration and zero
truncation. This is not a new mechanism: `perilOf()` already asks exactly this
question of *"a board WE ARE NOT ON"* and argues the over-approximation direction
in place (`src/lobster/substrate.ts:735-757`), and constructing it is a
plan-building change, because omitting a unit from the plan is what makes it held
(`substrate.ts:76-81`, `:117-118`).

**So the sound object is a ceiling and only a ceiling**, and that is stated in
§4. Cost, soundness, the row and the transcript are all developed there.

### 3.4 (d) The threat/opportunity map — no deeper search at all

**It is already built, and it is already stored, and it is drawn once.**

- `better()` returns its reason — the six refusal branches ARE the reduction
  (`src/lobster/search/core.ts:555-602`, [CHANGE 1]);
- the reservoir turns the reason into a `DominanceCondition` at the barrier and
  never before (`src/lens/kernel/reservoir.ts:56-95`, `:246-250`);
- it is persisted as `dominance_kind` + `dominance` jsonb
  (`src/database/schema.ts:205-206`, `src/lens/store/index.ts:948-949`);
- and when this was written it reached the operator through one function, for
  **one pair of rows** — the selected row and its foil. It is drawn on every
  retained row since `8ca6338` (`dominanceClause`, `src/lens/view/index.ts`),
  which is step 2 of §5; the pair's own line names the LOSER's condition
  (`whyItLost`).

**Cost: zero settlements.** `03` §2.4 says it in as many words: *"This is the
threat/opportunity map and it is free. Every input is a value the comparison
already produced."*

**Soundness.** Not applicable in the bracket sense and that is the point — no
bound is computed, no bound is changed, and no comparison is added. The condition
is a *read* of a comparison already performed, in the order already performed
(`reservoir.ts:56-61`: *"a dominance condition asserted mid-search would be a
claim about a comparison the search had not finished"*). Byte-identity is
structural rather than tested-for.

**What the lens row shows** — one clause per retained row instead of one clause
per decision:

```
 #  aggregate      depth    Δ     unless                          assignment
▸1  12.4 ⌈2.9⌉    h1 ·     —     leads on the proved floor        C f7 · Q d4 · s1↑
 2  11.7 ⌈4.1⌉    h1 ·    −0.7   r3, q1 resolve against us · 2.4  C f7 · Q d4 · s1→
 3  11.1 ⌈1.2⌉    h1 ·    −1.3   cannot win — dominated by 1.9    C f7 · Q g4 · s1↑
 4   9.6 ⌈8.8⌉    h1 ·    −2.8   floors equal — advisory 0.3      C f7 · Q d4 · s1↑
```

Row 2 is the one the owner asked for. `contingent` carries `onUnits` — the held
units whose resolution this row rides on, taken from the row's own `citedUnits`,
i.e. from the ledger — and `atStake = row.hi − leader.lo`
(`reservoir.ts:88-93`). **That is a statement about the next turn's contingency,
named by unit and priced in the aggregate's own units, and it is exactly the
information a deeper search would have been bought to produce.** Row 4 is the
second most valuable: `advisory-only` says the proved floors are equal and the
leader won on the channel that never adjudicates — *"the most important row in
the table, because it is where the bot is guessing"* (`03` §2.4).

**What a `mixed` transcript changes.** Every retained row gains a phrase; no
number moves; the runner is byte-identical. And one measurement opens that
07-MEASURED could not take: the distribution of `dominance_kind` over stored
rows. Today the only reading is `refuted-by-witness: 0 of 1,566`. The split
between `contingent`, `dominated`, `advisory-only` and `indifferent` is the
sharpest available answer to *"how much of this bot's decision is proof and how
much is a coin"* — and `indifferent` in particular is the row `02` §3.5 raises
the authority-collapse ask on. It costs one query against a column that already
exists.

**Verdict: ship it, first, alone.** It answers the legibility half of the owner's
question at zero risk and zero settlements, and it is the only candidate that can
be merged with a gate that cannot possibly fail.

### 3.5 (e) A reply model — the enemies' own one-ply argmax as one continuation

**The construction.** Run the enemies' decision (a mirror of our own search at
one ply), take their argmax joint, settle it concretely, continue from the real
board, and keep the bracket widened by the claims of everything not modelled.

**Cost.** The enemies' argmax is *their* decision, so its natural price is a
decision's budget: ~470 nodes per deepened plan, ~940 for the ration's two
targets — **two whole decision budgets**, before our own continuation layer. It
is four to five times cheaper than a chained ply at `P = 512` and it is still
more than a decision has. Cutting their search to a seed-only argmax brings it
down, but a seeded argmax is not an argmax, and then the model is neither cheap
nor faithful.

**Soundness.** A single concrete reply is a **witness**: an upper-bound
certificate on the value, never a cover, and *"it may not move a floor"*
(`src/lobster/bounds/bank.ts:22-27`, the B2 rung; `:646`). So the mirror bot's
continuation is a ceiling channel too — and unlike (c) it is a ceiling with a
*model* behind it rather than a proof.

**The blocking objection is Law B1, and it is not about cost.** *"`theirReduction`
at every ply is the same member as the ply-1 REDUCTION. A search that is
worst-case near and model-based far is not a search with a horizon; it is two
bots spliced at a ply boundary"* (`04-BACKUP` §3). Ply 1 is Γ-maximin with a
vacuous ambiguity set (`05-SEARCH-SYN` §3.1: *"`ambiguity` = paranoid shape,
vacuous size; `arity` = point; `reading` = sound"*). A mirror-bot argmax is a
**singleton** ambiguity set — a different member of the same joint — and
`05-SEARCH-SYN` §2.3 is categorical about what that costs today:
*"`inf_{P∈Δ(B)} E_P[v]` ignores `P`. So any experiment that varies the enemy
model at `ε = 1` is measuring nothing, and the program's four improvised
enemy-treatments … are individually unfalsifiable by construction."* A fifth
improvised enemy-treatment would be the fifth unfalsifiable one.

**And a determinism cost.** An opponent model is a second bot with its own budget
and its own slice boundaries. Any timing that reaches it reaches our decision,
and the runner's byte-identity gate — the instrument every merge in this program
has been judged on — is exactly what would break.

**Verdict: defer, behind a named trigger.** The trigger is the REDUCTION joint's
declaration (`05-SEARCH-SYN` §3.1 R1). Turn the ambiguity down from vacuous and
the opponent-model socket becomes measurable *for the first time*; until then the
mirror bot's replies cannot be shown to be better than the paranoid min they
replace, in either direction. There is one cheap thing worth doing meanwhile, and
it belongs to (d): the mirror bot's most useful output is not a continuation, it
is a **column** — a concrete reply that is an upper-bound certificate against
*every* plan. `05-SEARCH-SYN` W-2 records that we already discard those:
`speculate` ships the witness set down with every parcel and nothing comes back.
Recovering discarded columns is strictly cheaper than generating new ones.

### 3.6 The comparison, on one table

| | (a) abstract ply | (b) selective ≤24 | (c) ceiling ply (§4) | (d) map | (e) reply model |
|---|---|---|---|---|---|
| **settlements / decision** | 12 (flat) | ~4 amortised, 240 when it fires | `2Q`, ≤48 at `Q ≤ 24` | **0** | ~940 |
| **as % of ~470 nodes** | 2.6% | 0.9% / 51% | ≤10.2% | **0%** | ~200% |
| **selected by** | nothing (always) | reply product — the wrong quantity | loud subset — independent of the product | n/a | n/a |
| **population it reaches** | 355/355 | 6/355, all already exact | unmeasured; bounded by `Q ≤ 24` | 355/355 | 355/355 |
| **does the bracket stay a bracket** | yes, but only as a hull → strictly wider | yes | **yes, on `hi`; `lo` stays h1's** | n/a — no bound touched | yes, as a witness ceiling |
| **can it move a ranking** | no (monotone widening) | yes, measured zero | yes — via `refutedAt` | no | yes |
| **line for the drill-down** | **none** (violates Rule L-1) | yes | yes, one MIN layer | n/a | yes |
| **blocking issue** | no line; collides with `stale` | inverse selection (D-1) | F-10 below | none | Law B1 + determinism |
| **verdict** | diagnostic only | **reject** | **build, second** | **ship, first** | defer |

---

## 4. The recommendation: the CEILING PLY

### 4.1 The fact that closes the chaining question, and opens this one

`06` §1.1 treats chaining as a cost decision. It is not; it is a licence
decision, and the licence has a name in the code already.

B3 fires only when `coversEverything && every list complete && product <= productCap`
(`src/lobster/bounds/bank.ts:554-564`), where `coversEverything` is
`held.every(id => gated.includes(id))` (`:556`). So **every B3 leaf names a move
for every unit on the board**: `withMoves(base, acc)` with `acc` covering the
entire held set (`:575-576`). A B3 leaf is a complete concrete world, and the
board it settles to is a real board.

> **Finding D-2 (chainability is exactness).** A partial settlement can be
> chained from exactly when its held set was fully enumerated — which is exactly
> the condition under which the ply-1 bracket can report `exact`. Refusal 1 and
> Finding D-1 are not two facts. They are one fact seen from the cost side and
> the soundness side. **There is no board on which a chained ply is both sound
> and worth taking, and no cap on the reply product can produce one.**

Which leaves precisely one move available, and the bank's own rule names it.
*"Capping WHO gets enumerated is free … capping WHICH replies of a modelled unit
is an assumption"* — and an assumption on the WHICH axis is forbidden for the
floor and **permitted for the ceiling**: *"a min over that subset is an
over-estimate of the min over all of them — not a floor … may LOWER THE CEILING
and may never RAISE THE FLOOR"* (`bank.ts:31-38`). The bank has been carrying the
licence for this member since it was written.

### 4.2 The construction

A new rung, **B4 — THE LOUD PRODUCT**, and one continuation layer above it.

**Loud.** One held enemy's option is *loud* iff its path intersects the staged
plan's footprint in sub-step time. That is the entanglement relation the gate
already computes, moved from the unit to the option (`bank.ts:115`
`gateOnEntanglement`; the footprint is `footprintOf`, `src/lobster/bounds/plan.ts`).
An option that never touches our footprint cannot capture, cannot contest, cannot
sever, and cannot move either endpoint — it is *quiet* in `thinQuiet`'s own sense
(`src/lobster/candidates.ts:878-925`). The **loud product** is
`Q = Π_e |loud(e)|` over the gated enemies, and it is a sum to compute, never a
product.

**Ply 1 (their layer, MIN).** Enumerate the cross-product of loud options when
`Q ≤ LOUD_CAP`. Each leaf names a move for every gated unit, so each leaf is a
complete concrete world with a real resulting board. `closeGroup("B4", …,
complete = false, …)` — **complete is false by construction**, which is the whole
point: `closeGroup` will contribute the branch's ceiling and refuse to let it
move the floor (`bank.ts:740`), and no `declareTruncatedFloor` is set
(`DEFAULT_BANK_CONFIG`, `:133`), so no narrowing is declared, the `BasisKey` does
not move, and `compareFloors` does not refuse. **The row stays sorted.**

**Ply 2 (our layer, MAX).** From each B4 leaf's board, settle turn `t+1` with
**every unit held** — ours included. Omitting a unit from the plan is what makes
it held (`src/lobster/substrate.ts:76-81`, `:117-118`), and `perilOf()` already
asks this exact question of *"a board WE ARE NOT ON"* and argues the
over-approximation direction in place (`:735-757`). The claim covers every
continuation we could play and every reply they could make, so the settlement's
`best` endpoint is an upper bound on `max_{K'} min_{b'} V`. **One settlement per
leaf, zero enumeration, zero truncation.**

That is the mirror rung `06` Q-L3 asks for — *"a rung that refuses to let an
incomplete continuation set move the ceiling"* — and it turns out not to need
building. Holding is the complete cover; the incomplete continuation set never
exists.

**The reading.** `hi := min over loud leaves of (ply-2 best)`, taken only where it
is below the ply-1 `hi`. `lo := h1.lo`, unchanged, always. `est` is not touched
and cannot be — it is B0's alone (`bank.ts:547`) and two of them at two horizons
are two evaluations of two boards (`dbdb740`).

### 4.3 Why the bracket stays a bracket

Four claims, each with its enforcement already in the tree:

| claim | why | enforced at |
|---|---|---|
| min over a subset of replies is an upper bound on the true min | the true reply is in the full set; the subset's min is ≥ it | `bank.ts:31-34`, the rung's stated law |
| a leaf's board is real, so settling from it is settling a world | every gated unit's move is named; the gate covers the held set | `bank.ts:554-576` |
| `best` with everything held bounds `max min` over ply 2 | the claim contains every world; `best` is the sup over the claim | `claims.ts:31-34`; `substrate.ts:751-757` |
| a ceiling proved at h2 compares with one proved at h1 | both are upper bounds on one horizon-independent quantity; the basis is unmoved because nothing was declared | `score.ts:530-533`; `search/core.ts:578-591` |

And the floor is untouched, which is not a weakness but the member's whole
soundness argument in one line: **`deep.lo === h1.lo` on every deepened row, as
an assertion, not as an expectation.**

> **F-10 — `better()`'s ceiling rung penalises depth, and it is the mirror of
> F-4.** `search/core.ts:596-598` accepts the trial when
> `trial.bounds.best > incumbent.bounds.best` — the **higher** ceiling wins at an
> equal floor. A deeper reading has a **lower** ceiling, so a plan that was
> measured loses rung 5 to one that was not, purely for having been measured.
> The comment immediately above it (`:578-591`) has the whole argument and
> applies it to `est` only: it is right that `hi` crosses a horizon boundary as a
> *bound*, and it does not notice that as a *ranking key preferring the larger*
> it rewards the looser one. Two members: (i) extend the existing
> `acrossHorizons` guard (`:592`) to rung 5, so the rung is skipped where the
> readings disagree about depth and the salted tie decides — one line,
> byte-identical on this build because every horizon is 1; (ii) invert the rung
> across horizons so the tighter reading wins, which is defensible and changes
> decisions the day depth arrives. **Recommend (i)**, for the same reason F-4's
> guard was recommended: it declines to compare rather than inventing an
> exchange rate. `leaderOf` in the refinement view mirrors the ladder and takes
> the same line (`:1058-1063`).

**And note what the member does NOT re-decide.** `2ec3533` said whoever engages
depth re-decides the switch margin and the sticky stager's horizon guard, in one
commit or neither. Both were re-decided in the merge, and both landed away from
this member's channel: the guard now sits on the **`est` arm only**
(`src/lobster/voc.ts:418-428`), the floor arm's was deliberately removed because
*"a floor is a floor whatever proved it"* (`:450-453`), and the margin's two
bounds — the bounds layer's float tolerance below, the criterion profile's
resolution above — are both horizon-free (`2ec3533`). `pickLeader`'s horizon rung
sits immediately above every `est` read (`:223-227`). A ceiling-only member
touches none of them. **It is the one depth member that engages without reopening
a single calibration** — because it moves the one channel every existing guard
already lets cross.

### 4.4 Cost, at the measured products

Per deepened plan: `Q` settlements at ply 1 (the loud leaves — new work, since
B3 declined on 233 of 355) plus `Q` at ply 2 (one per leaf). The ration deepens
at most two plans, the leader and the highest-`hi` un-refuted rival
(`src/lobster/voc.ts:694-723`).

| `LOUD_CAP` | settlements / decision (`4Q`) | % of ~470 nodes | comment |
|---:|---:|---:|---|
| 6 | 24 | 5.1% | conservative first engagement |
| **12** | **48** | **10.2%** | **recommended** — inside the inspection reserve's order of magnitude |
| 24 | 96 | 20.4% | only if the measurement says `Q ≤ 12` is too rare |

**Independent of the reply product.** The 108 occasions above 4096 and the 6
below 24 are priced by the same `Q`. That is the property Finding D-1 demanded of
any affordable member, and it is why this one is not (b) with a different number
written on it.

**The one number this design does not have.** The distribution of `Q` on `mixed`
is unmeasured. If `Q > 12` on nearly every occasion the member declines nearly
always and the column is honest and inert; if `Q ≤ 12` is common the member fires
on boards where the bracket is genuinely open. Everything else in this section is
settled by code and law; this is the only open empirical question, and it is the
cheapest measurement in the file: **one counter, no settlements, a sum over
option lists rather than a product.** §5 makes it step 1.

**And the ration is self-limiting, which is worth naming.** `rootSlack` is
`max over rivals (R.hi − L.lo)` (`voc.ts:259`, with `6be9494`'s repair making it
a rival quantity at last). The member lowers rivals' `hi`, so slack falls, so
`stable` becomes true (`voc.ts:670-671`), so the ration stops deepening. **The
member's own success is what turns it off** — which is the anytime property
`07-ANYTIME` A-2 wants and has never had a producer for: `basis.maxGap` becomes a
quantity that moves for a reason a plot can show.

### 4.5 What the lens row shows

The cell `06` §2.2 designed, with one structural asymmetry that is a feature:

```
 #  aggregate      depth        Δ     unless                        assignment
▸1  12.4 ⌈2.9⌉    h2 ▽−0.9    —      leads on the proved floor      C f7 · Q d4 · s1↑
 2  11.7 ⌈1.6⌉    h2 ▽−2.5 ◂  −0.7   refuted by a witness           C f7 · Q d4 · s1→
 3  11.1 ⌈1.2⌉    h1 ·        −1.3   cannot win — dominated by 1.9  C f7 · Q g4 · s1↑
 4   9.6 ⌈8.8⌉    h1 · Q=340  −2.8   r3, q1 resolve against us · 4  C f7 · Q d4 · s1↑
```

- **`▲` never appears.** The floor cannot move, so the glyph for a risen floor is
  structurally absent from this member, and its absence is the member's honest
  signature: *depth here removes optimism; it does not add proof.*
- **`▽` is the whole delta**, and `Δhi` is the number in the cell.
- **`◂` means the deep ceiling retired a rival.** Row 2 fell below the leader's
  proved floor and `refutedAt` fired (`search/core.ts:575`). That is a
  certificate, it composes, and it survives shallower re-reads (`06` §1.3) — the
  MCTS-Solver mechanism (`04-BACKUP` §6) running at more than one ply for the
  first time.
- **`h1 · Q=340`** on row 4 is the decline, naming the number that caused it. The
  absence of depth is drawn, never omitted, and now it is drawn *with its reason*
  — which is strictly better than today's `h1 ·`, even on the rows the member
  never touches.
- **`↕` is unreachable here.** `compareConfidence` answers `incomparable` for
  deeper-but-looser (`voc.ts:99-106`); this member is deeper-and-tighter by
  construction, so it always answers `better`. The one glyph that means *do not
  read this as progress* is one this member cannot earn — which is the cleanest
  possible statement that it is not laundering anything.

The drill-down has its line, so Rule L-1 is satisfied. It is **one MIN layer
deep**: the argmin loud reply is a concrete joint reply, already banked as a
`Witness` by `closeGroup` (`bank.ts:752-759`), drawn as `06` §2.3 rule 2 requires — a
hollow arrow from the observed cell to the argmin cell with that claim's
`headPossible` washed behind it, because *the set is the truth and the arrow is
our pick from it*. The ply-2 layer draws as one row with **no arrow at all**,
because our continuation was held rather than chosen: the honest picture of a
bound over a set we never enumerated, and the panel says `held — bound over all
continuations` where an arrow would otherwise be.

### 4.6 What a `mixed` transcript visibly changes

Four things, in the order an operator would notice them.

1. **Rows get retired that today survive to the barrier.** `dominance:
   refuted-by-witness` is **0 of 1,566 stored rows** (`07-MEASURED` §3) — the
   witness channel is empirically empty in bot-only play. A ceiling that falls
   one turn further out is the first mechanism in this bot that can populate it.
   The visible change is rows leaving the reservoir with a certificate instead of
   sitting in it with a wide bracket.
2. **`⌈w⌉` narrows on the leader and its top rival, and only on those two.** The
   ration's two targets are exactly the two rows whose brackets define the
   decision, and every other row's width is unchanged — a per-row pattern an
   operator can check by eye against the ration's stated policy.
3. **The staged plan changes only by retirement.** The leader is chosen floor
   first; this member cannot move a floor; so it can change what is staged only
   by refuting a rival that would otherwise have taken the stage. **Every
   decision change it can produce is a decision it declined to take on a
   certificate** — which is precisely the conservatism the owner asked for, and
   it is a property of the construction rather than of a threshold.
4. **The timeline lane gains `▲e3ʰ²` badges** on the kernel ticks that carried a
   deepening (`06` §4.2), and scrubbing across one shows the bracket close. No
   new event kind, no schema change, because the frames are whole. The
   predicate that found those ticks was written, called by nothing, and deleted
   with the rest of the dead view code (`09` §D4): on a build where every
   horizon is 1 it can only ever answer "none", and the lane has no badge to
   draw until this member is merged.

---

## 5. The sequence, and the gates it must pass

### Step 1 — measure `Q`. No settlements, no behaviour, one commit.

Instrument the B3 preamble: for each gated enemy, count the options whose path
meets the staged footprint; report the per-unit counts and their product beside
the existing product. Emit it on the `movesets` frame's context. Run
`node dist/tests/local-game.js mixed 60 1 --nodes --json=` on both board classes
and report the distribution of `Q` against the distribution of `P` already in
hand. **This is the gate on everything after it**: if `Q ≤ 12` is as rare as
`P ≤ 24` was, the member is a second instance of Finding D-1 and must not be
built. The measurement costs nothing and can refute the whole design, which is
the right order to do it in.

### Step 2 — ship the threat/opportunity map per row (candidate d).

Independent of step 1 and independent of depth. `dominance` is computed, stored
and unread on every row but one; render it per row, and add the
`dominance_kind` histogram to `scripts/lens-measure.js` so `07-MEASURED` §3 gets
the reading it could not take. Zero settlements, no kernel edit, byte-identical
by construction.

### Step 3 — F-10, on its own commit, behind G2.

One line in `better()` and one in `leaderOf`. Byte-identical on this build
because every horizon is 1, and it is the only instrument that would see it if it
were not. This lands before the member, for the same reason `dbdb740` landed
before anything could produce a second horizon: a guard installed while it is
inert is a guard whose installation can be proved harmless.

### Step 4 — B4 and the ceiling ply, gated.

**The gates, all of which must hold:**

| gate | statement | why it is the right one |
|---|---|---|
| **G-D1 · snake parity** | byte-identical on all snake-only arms | the member is scoped to clusters with a held **piece**, so on a snake board it never fires — parity is structural, and the gate checks the structure rather than hoping. It is also what the cost curves say: snake6 saturates at ≤500 ms with **zero** staging changes from 500 ms to 4 s across 9,000+ extra priced plans, while the queen cell climbs through the top rung — *starved, not saturated* (`TIME-SYN` §2). Spend where the curve is still rising |
| **G-D2 · per-class A/B** | `scripts/ab-compare.js` against `stable/one-engine-lens-v2`, per board class, never pooled | the standing order, and pooling would hide a piece-board gain behind a snake-board null |
| **G-D3 · zero inversions** | `boundsInversions` zero across every arm; `bounds/soundness.test.ts` green | a ceiling-only member's failure mode is an unsound ceiling, and an inversion is what one looks like |
| **G-D4 · the floor never moves** | `assert(deep.lo === h1.lo)` on every deepened row, in the member, not in a test | the entire soundness claim, as one runtime invariant |
| **G-D5 · B3 is the oracle** | on every decision where B3 also fires, assert `B4.ceiling ≥ B3.ceiling` | **Finding D-1 turned into an asset.** The 122 occasions where the loud truncation cannot help are the 122 where ground truth exists — the full min is computed — so the member's soundness is checkable exactly on the population where it is useless, and the population where it is useful inherits the check |
| **G-D6 · the column speaks** | the lens depth column no longer reads `h1 ·` on the rows the member applies to, and reads `h1 · Q=<n>` with a real number on the rows it declines | the owner's own acceptance test: the absence of depth stays drawn, and the presence of it becomes visible |
| **G-D7 · G2 stays green** | `lens-determinism.test.ts` before and after | steps 3 and 4 both edit the hottest function in the search |

**Merge rule, in the standing orders' own terms:** merge the instrument (step 1)
and the map (step 2) unconditionally; merge F-10 on G2 alone; engage B4 only if
G-D1 through G-D7 all hold and the per-class A/B is not worse. If step 1 says
`Q ≤ 12` is rare, stop after step 2 and record the number — that is a complete
and useful outcome, and it is the same outcome the depth worker delivered, one
level down and for one commit's worth of work.

### Not now, with named triggers

- **(a) as a diagnostic.** One line in the drill-down — *"a second turn of enemy
  freedom would widen this bracket by `w`"* — 12 settlements, never read by the
  comparator, and it is the only thing that can be said about the 108 `> 4096`
  rows. Trigger: the first operator session in which a `Q > LOUD_CAP` row is
  opened.
- **(e) the reply model.** Trigger: the REDUCTION joint's declaration
  (`05-SEARCH-SYN` §3.1 R1). Until the ambiguity set is non-vacuous an opponent
  model is unfalsifiable by construction (§2.3), and it would be the fifth
  improvised enemy-treatment in a program that already has four. The cheaper half
  is available first and belongs to (d): recover the witness columns
  `speculate` currently ships down and discards (W-2), since a column is an
  upper-bound certificate against *every* plan and is the artifact that transfers.
- **`Δ_terminal`.** The cap is seated (`c3f0412`) but the 60-turn arms never
  reach a 100-turn limit, so the boundary channel is untestable on the current
  runner. Trigger: a 100-turn arm, which costs a runner flag and no code.

---

## 6. What is settled here, in one place

- **The depth worker's verdict stands, and its reason is stronger than stated.**
  Chainability and exactness are the same condition — a partial settlement can be
  chained from exactly when its held set was fully enumerated, which is exactly
  when B3 can report `exact` (Finding D-2). No cap on the reply product produces
  a board where a chained ply is both sound and worth taking.
- **Affordability is anti-correlated with value** (Finding D-1). 122 of 355
  occasions on `mixed` seed 1 are already closed at ply 1 by B3, and they are
  exactly the 122 a chained ply could pay for. Cap 24 firing four times in sixty
  turns with zero staged changes is what that selection rule guarantees, not a
  noisy measurement of a small effect.
- **Any affordable deep member must be selected by a quantity that is not the
  reply product.** The loud product `Q` is such a quantity, it is a sum to
  compute, and its distribution is the one open empirical question.
- **The ceiling is the only channel depth can afford to move here.** The floor
  needs a complete cover, which is what makes it expensive; the ceiling is
  licensed to truncate by the bank's own rule, and holding our own units covers
  our MAX layer completely for one settlement — which is `06` Q-L3's mirror rung,
  free.
- **A ceiling-only member re-decides no calibration.** The switch margin and the
  sticky stager's horizon guard both sit on the floor and `est` arms; every
  merged precondition already lets a bound cross a horizon. One new finding is
  owed first: **F-10**, `better()`'s ceiling rung prefers the looser bound and
  therefore penalises having measured.
- **The legibility half of the owner's question is answerable today, for free.**
  The threat/opportunity map is computed, stored, and drawn for one pair of rows.
  Per row it says *"this moveset leads unless r3 and q1 resolve against us — 2.4
  at stake"*, which is insight about the next turn's contingencies, named by unit
  and priced in the aggregate's own units.
- **The honest headline is not "two turns ahead".** It is: *the bot names what
  each moveset is betting on, and removes optimism one turn further out where the
  loud replies are few enough to enumerate.* Every decision that member can
  change is a decision it declined to take on a certificate, which is the
  conservative direction by construction rather than by threshold.

## 7. Measured (2026-09-04): the ceiling ply is sound and vacuous — not merged

Built on branch `ceiling` (origin, 72f2fc6; not merged). B4 = the loud-subset
ceiling ply, last on the ladder, `LOUD_CAP=12`, every other held unit pinned to
the first of its own enumerated replies, truncations declared as narrowings.
Cost 5.4 settlements/decision (p95 8–12, bound 24) — inside §4.4. Soundness
gates G-D1/4/5/7 green. **G-D6 half**: the ply is sound but never tightens —
holding everything is looser than the concrete leaf 31/31 times (median +237),
so no row ever reads h2 and the A/B on mixed/potions is inside noise. Shipped
inert behind `b4:false`, which the standing rules forbid, so it is not merged;
the finding stands: at production budgets, the one-ply bracket plus the threat
map IS the lookahead, and a ply that holds its own MAX layer cannot beat the
leaf it approximates. Revisit only with a reply model (§3.5) whose single
continuation is concrete, or a budget an order of magnitude larger.

Its harness also reported: **G-D3 fails** — 485 inversions on `potions` seed 4
where a B1 floor sits above an exact concrete reply. **That report is now
closed and it was wrong about the shipped bank; see §7.1.**

## 7.1 The 485, followed up (2026-09-04): they do not reproduce

**The instrument.** `src/lobster/bounds/exact-reply.ts` is the B4 harness's
refutation without the rung. For a priced plan it takes the held set,
enumerates each held unit's COMPLETE option list out of the engine's own
enumerator, names every one of them at once and settles: nothing is held in
the result, so the bracket the evaluator returns is a POINT and that point is
the value of a game the two sides could really play. Then `floor ≤ value(w)`
for every enumerated world, and `ceiling ≥ min over w` where the enumeration
was complete. It holds for any SUBSET of worlds, which is what makes a sampled
arm a proof rather than a sample. It may not spend the decision's clock — in
the deterministic mode the clock IS the evaluator — so it scores through the
unwrapped evaluator of the same declared identity, refuses to run against any
other, and runs after the answer is assembled. Off (no `CENTAUR_EXACT_CHECK`)
it is one null check per priced plan.

**The measurement.** Over all sixteen gate arms — four scenarios at seeds 1–3
for thirty turns, `potions` at sixty on seeds 4, 5, 6 and 8, one plan in ten —
**432 148 checks over 44 859 582 concrete worlds: ZERO floors above a real
reply and ZERO ceilings below a complete reply space.** On `potions` seed 4
alone, 37 098 checks over 4 741 712 worlds, zero. The same sixteen arms print
no `INVERSION` line under `CENTAUR_DEBUG_INVERSION=1`. The anti-vacuity arm
shows the instrument still refutes a floor moved one unit up on the same
worlds, so the zero is a reading and not a silence. **The whole-plan bracket
is already exact on every real arm; the 485 were a fact about `origin/ceiling`'s
own reading, not about the bank the ladder ships.**

**What a finer instrument does find, and why it was measured and declined.**
R1 is stated on the fold's TOTAL, and the fold is a non-negatively weighted sum
— so a term whose own `lo` sits above its own value in some world is a broken
bound that another term's slack is currently paying for.
`src/lobster/evaluate/law-sweep.test.ts` checks R1 TERM BY TERM with the
shipped evaluator over 240 generated boards carrying snakes, pieces, food and
potions, and finds nine such classes. Branch `b1-sound` (kept on origin as the
record) closed two of them at their cause — `command.hi` 600 → 199 via
`command`'s food board and a displaced mover's front, `reach.lo` 128 → 106 via
the piece contest's endpoint rule and a tie split gated on a claim — and **the
repairs are NOT merged.** The A/B, per board class and never pooled
(`docs/design/ab/2026-09-04-b1-sound-vs-57fd2da.md`): sparse byte-identical,
but deaths up on `snakes` (+0.38/100), `mixed` (+0.15, all three seeds) and
`potions` (+0.37), up on three of four classes and down on none. A
correct-and-looser floor that fixes nothing the oracle can find in a real game
and loses more games is not a repair we ship; the standing rule is that a
change must be at least as good as the baseline per board class.

**So the classes stay open, and they stay VISIBLE.** The law sweep pins each
one as a ratchet at its unrepaired count, so a class can only go down and a
tenth cannot appear unnoticed.

**What a future repair has to show.** Both, together:

1. a lower number in the law sweep's ratchet — the class it claims to close,
   closed, term by term; and
2. an A/B that is neutral or better on every board class, never pooled, at the
   same seeds and budget; and
3. ideally, a world the exact-reply oracle can point at. A class that no arm of
   the oracle can make live is latent, and latent is worth exactly what it
   costs — which so far is deaths.

Nothing else is owed. The oracle, its classifier, the sixteen-arm gate and the
law sweep are merged as instruments precisely so that the next attempt is
argued with numbers rather than with a reading.

**A tenth class is CLOSED, and this one shipped (2026-09-05).** `contest.lo` —
30 worlds where `contest`'s own floor sits above its own value — was the ratchet
that refused D1's second attempt in `docs/design/BEHAVIOUR-AUDIT.md`. Its cause
is now named and repaired: the term charged each of our units at the charge of
the cell the PARTIAL resolution settles it on, and a completion world that halts
a mover short settles it somewhere else, so a contingent quantity was read as a
point. Bracketing over the cells the arrival could settle on (`contest.ts`,
`settlesOn` — the cells the unit entered in this timeline union the one it set
out from, and nothing at all where the engine's own `fates` says it is not
contingent) takes the class **30 → 0** with `totalLo` still 0, checked before it
was believed on the sweep's own 240 boards: over 8 637 completion worlds and
1 956 relocations the world's settle cell was inside the set every time.
`bounds/exact-reply` stays exact on all four seed-1 arms.

**It is the first repair to meet both requirements**, and it meets the second
one narrowly and on purpose. The A/B, per board class and never pooled: deaths
DOWN on both classes that have any (`mixed` 10 → 9, `potions` 26 → 24) and up on
none, `edge` deaths 2 → 0 and `enemyOccupiedEntriesLost` 5 → 1 on `mixed`,
`snakes` and `sparse` identical on every game counter — against one cost,
`mixed`'s meals at −4.1% per 100 unit-turns, which is over the 3% budget D1 set
itself. It was taken over that budget: a soundness fix that also loses fewer
units outranks a meal dip on one of four classes, and the mechanism is the
conservative direction rather than an accident. The pin is now `'contest.lo': 0`
— the class is CLOSED, so the ratchet refuses any regression in it rather than
merely holding a count.

**The mechanism generalises past `contest`, and it is why the dip is the price
rather than a bug.** Closing this class means charging each unit at the WORST
cell its arrival could settle on, and the measurement says the worst cell is
nearly always the one it set out from: the commonest contingent world is simply
the one where the move does not happen (1 854 of the 1 956 relocations were
outside `traversed` alone). An honest floor over a contingent settle cell is
therefore a standing tax on ADVANCING — it prices every staged move that passes
an enemy at the worse of "where it gets to" and "where it started", while a hold
stays a point. That is the same shape as `b1-sound`'s two closures above:
correct-and-looser, paid for in tempo. The difference is the ledger. `b1-sound`
bought nothing and cost deaths on three classes of four; this one buys deaths on
two classes and the class itself, and costs meals on one. **Correct-and-looser
is not disqualifying — it is a price, and the test is what it buys.** That is
the reading to carry to the eight classes still open — the sweep prints
`food.hi` 63, `reach.hi` 220, `command.hi` 600, `room.lo` 73, `reach.lo` 128,
`material.hi` 8, `energy.hi` 10, `momentum.lo` 27, and no `contest.lo` at all.

**D1's ORDERING half stayed out.** The lightened charge
`CONTEST_LOSS × (1 − ε + ε·p)` was measured on top of this repair at `ε = 0.125`
and `ε = 0.25`: bound-clean at both (`contest.lo` still closed, `totalLo` 0,
`exact-reply` exact), and refused by the play — `mixed` meals −3.3% and −5.7%,
and `ε = 0.125` takes `potions` deaths 26 → 27. So the bound obstacle in front
of that half is gone and the tempo obstacle is not.
