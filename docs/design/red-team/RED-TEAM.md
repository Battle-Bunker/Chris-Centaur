# RED TEAM — breaking the unified carve

Target: the shape the four lens syntheses converged on — values fibered over a
premise index `⟨support, observable, measure, config⟩` with credal `(S, w)`
content; three operations (join / meet-with-two-purchase-columns / advance);
joints as a five-kind data manifest (MODEL / VALUE / REDUCTION / ACTION /
ECONOMY), each kind with one typed composition law; a bot as a total map
normalising to an addressed `botId`; the reachability law.

Sources read: `design/time-interruption` @ 5d895ab (time-SYNTHESIS.md),
`design/belief-fog` @ 2f56590 (04-SYNTHESIS.md), `design/value-evaluation`
@ ee6080d (SYNTHESIS.md), `design/joints-composition` @ ef75551
(00–07 docs), and the shipping code on `claude/cluster-lookahead` @ 47c983e
(`search/core.ts`, `kernel.ts`, `belief.ts`, `registry.ts`, `bot-config.ts`,
`candidates.ts`). Mandate: ruling 49 (the machine must express a LARGE space of
ideas including ones not yet tried, via functions plugged into a few powerful
joints) and ruling 50 (nothing is final).

Verdict up front: **the carve is strong against the defect classes on record
and weak against exactly the thing ruling 49 demands.** Of thirteen concrete
strategy families below, five configure cleanly, three need a fat member that
hollows out the composition law, and five need a law change, a new joint, or a
coordinate the index does not have. The five are not exotic: they include
deliberate sacrifice, in-game opponent adaptation, and the entire
operator-facing half of a centaur bot.

---

## 1. THE EXPRESSIVENESS TEST (ruling 49, made concrete)

Thirteen strategy families the program has not tried. For each: what it plugs
into, what members it needs, and whether the carve holds. "FITS" means
lane-(a)/(b) work inside the declared joints; "FAT MEMBER" means expressible
only by fusing logic inside one member, with the composition law contributing
nothing; "FAILS" means a new joint, a law change, or a missing coordinate.

### F1. Deliberate sacrifice lines — **FAILS (law change required)**

Give up a snake to seal a corridor; feed a unit to a queen to decoy her off
the king file; trade a 2-weight unit to open a 30-weight account.

- **What it needs:** a plan in which one of our units takes a rules-certain
  fatal move, priced at team level as net-positive weight-share flow.
- **Where it plugs today:** nowhere reachable, via three stacked walls whose
  mechanics I verified against `candidates.ts`, and the carve *hardens* the
  first and pins the second:
  1. **Admission.** `pruneFatalNoGain` ("drop moves that certainly kill us
     and certainly gain nothing", default true) removes every *gainless*
     sacrifice — and "gain" is one-ply gain, so a decoy or body-block whose
     payoff arrives at ply 3 is "no gain" at admission, gone before any
     member prices it. A capturing sacrifice survives this wall. Today the
     knob could at least be turned off per-bot; the joints inventory (§3)
     reclassifies the prune as set-closure and the refusal list makes
     closures kernel ("set-closures stay kernel even though they are
     numbers") — under the carve, the seat is deleted.
  2. **Ordering starvation.** The `tier` band tops the precedence order, and
     the VALUE lens pins it there by ruling: *"a doomed move is outside the
     value function's domain, not a low number … must never become a
     weight."* A doomed candidate therefore sorts below every safe move, and
     since the caps take a sorted prefix (`sliderCandidateCap: 4` of ~71),
     an admitted capturing sacrifice is ordered last and cut by the cap on
     exactly the boards where sacrifices matter. B6 keeps the death band as
     a precedence resident, so this survives the re-carve verbatim.
  3. **Economy starvation.** Even where the small option set admits the
     sacrifice (snake boards, ≤3 options), its payoff is deeper than one
     ply, deep threads root at the enumeration's own proposals, and a
     bottom-ordered candidate never seeds a thread — so nothing ever computes
     the value that would justify it. The plan-level `accept()` has no
     doomed veto (the floor accounts the wipe honestly); the sacrifice loses
     upstream, in ACTION and ECONOMY, before VALUE is consulted.
- **The irony:** the VALUE lens's own currency prices sacrifice *correctly* —
  "a death costs exactly the balance it wipes" is the whole point of the
  account algebra, and a 2-weight outflow buying a 30-weight transfer is a
  positive net flow. The currency can say it; the ACTION kernel forbids ever
  asking.
- **What would fix it:** the fatality closure must become premise-indexed —
  "doomed for the unit" and "vetoed for the team" are different statements,
  and only the second belongs to the floor. Concretely: the closure keeps
  refusing *unjustified* fatality (no member has priced it), but a plan whose
  team-level reduction survives with the death priced in must be admissible.
  That is a change to the declared law of the closure joint (kernel → kernel
  with a priced exception path), not a new member. Until it lands, the machine
  cannot express a whole quadrant of chess.

### F2. Baiting / trap play — **FITS** (with one honest wall)

Play a move whose best reply *under the opponent's presumed shallow evaluator*
walks into a prepared refutation.

- **Plugs into:** MODEL `model/replies` — a weight-supplier member
  `mirror(evalId, depth=1)` that weights enemy replies by softmax of *their*
  presumed evaluation; REDUCTION at ε < 1 so the weighted reply distribution
  actually moves the reduce; ECONOMY deep threads to verify the refutation
  line.
- **Members needed:** one supplier member; no new joint. The credal supplier
  type ("must span quantifiers and measures") admits it, and `'adversarial'`
  stays its ⊥.
- **The wall, named honestly:** *belief-shaping* baits — moves chosen to make
  the opponent's model wrong, not just to exploit its being shallow — need
  second-order weights, which the epistemics lens refuses ("empathy-grade
  prediction stays with the humans per ruling 13"). That refusal is recorded
  negative space, so this is a documented boundary, not a carve failure. But
  it should be listed in the manifest as an *explicitly closed* joint, so
  nobody mistakes the silence for an oversight.

### F3. Tempo / commitment-timing play — **SPLIT: half FITS, half FAILS (missing joint)**

- **Complexity pressure** (steer into positions where a bounded opponent errs
  more): FITS — it is a state-conditional supplier member (weights concentrate
  on findable replies; hard positions spread mass onto mistakes) read through
  the standard reduction. No new joint.
- **Commitment-timing** — **FAILS, and the leakage is now VERIFIED, not
  conditional.** The game server resolves the turn early once every alive
  player has committed (`active-game-manager.ts:199`,
  `firebase-interface.ts:1968`), commitment is recorded in a shared per-turn
  document (`moveStatuses/${turn}`, `movedPlayerIDs` via `arrayUnion`) that
  clients read, and the commit action is *human-triggered* ("the
  MoveCommitter implementation for the human-triggered Submit All"). So the
  timing game is real and two-sided: committing early donates your remaining
  reaction window and accelerates resolution; committing last, after
  watching `movedPlayerIDs` fill, gives your team the only live hand at the
  table — everyone else is frozen while you still think. That is a genuine
  strategy axis, it is observable in the live data model today, and the
  carve has no seat for it: the inventory classifies `economy/emit` as
  "kernel constraint (not a member)", and no joint reads `movedPlayerIDs`
  at all (nothing bot-side ingests opponents' commit status). Worse, since
  the commit belongs to the *operator*, the natural home for a
  when-to-commit policy is advice to the human — which is F11, the joint
  kind that does not exist. Two carve failures intersect on this square.

### F4. Coordinated multi-turn combinations — **FITS, with a law amendment owed**

A 3-turn pincer where turn 1's move is only good given the follow-through.

- **Plugs into:** the Carried object (author `'bot'`, a premise delta pinning
  our own future reference actions), anticipatory meets computing under the
  self-imposed premise, ADVANCE discharging the labels as reality confirms,
  deep threads pricing the line.
- **The gap:** the advance law says values never cross, but the *commitment*
  crosses while its justifying value dies. Nothing in the law obliges
  revalidation: a carried combination whose refutation appears on turn 2 rides
  on incumbency and attention-carry unless the budget happens to re-price it.
  The anti-latch tripwires (rootTurn, plies-bounded) bound *staleness*, not
  *validity*. **Amendment needed: a carried premise with author `'bot'` owes a
  standing revalidation obligation — one priced meet per turn whose failure
  kills the Carried — or combinations become zombie commitments.** The
  designs' own precedent (pins re-stage a conforming plan before refinement)
  shows the shape; it is not yet a law for bot-authored carries.

### F5. Deceptive movement under future fog — **HALF-FITS (refusal wall)**

Feint toward the east corridor, then go invisible and double back.

- **Support-shaping** (keep their deduced S wide; decline the revealing meal):
  FITS — the epistemics lens builds exactly this (`Belief(enemy)`,
  concealment-spend D1 terms, build step 8).
- **Belief-shaping** (plant a *wrong* mode in their weight, then exploit the
  error): needs their `w`, i.e. second-order weights — refused, same wall as
  F2. Half the deception space is expressible; the half that wins games
  against humans is deliberately fenced off. Fine as a v1 boundary; must be
  re-opened the day human opponents are the population, because against
  humans the refused half is where the value is.

### F6. King-hunt races — **FAT MEMBER (law survives by meaning nothing)**

Mutual attacks; the position's value is "whose attack lands first", a
comparison of arrival times, not a sum of flows.

- **Why the VALUE law can't say it:** the kind's law is a weighted monoid —
  additive over the currency. A race is exclusive-or: my king-attack outflow
  and their counter-attack transfer cannot both realize, so summing
  independent terms double-counts. Correlation between contributions is
  inexpressible *between* members.
- **The escape hatch:** one `race-evaluator` member computes the whole race
  internally (min of arrival plies, tempo counts) and emits a single folded
  contribution. Legal, and it works.
- **The finding:** this generalises. *Any* non-additive strategic interaction
  is expressible only by fusing it inside one member. The composition law does
  not constrain what is expressible; it constrains what is *factorable* — and
  every strategy family with internal correlation (races, walls, sacrifices,
  combined operations) will accrete into fat members whose internals the
  manifest cannot see. The Frankenstein risk is not dead; it has moved inside
  the sockets. The manifest should at minimum require fat members to declare
  their internal term structure as sub-provenance, or the "nine idioms → one
  object" win gets undone one member at a time.

### F7. Territory denial via body-wall architecture — **FITS (fat member + Carried)**

Grow and park bodies to wall a region; harvest the enclosure later.

- **Plugs into:** VALUE (enclosed-area inflow rate at long horizon — the
  Contribution schema has the `horizon` field for it), Carried unit roles with
  hysteresis (D5), ACTION ordering members promoting wall-consistent moves.
- **Same caveats as F4** (revalidation of the wall commitment) and **F6**
  (wall value is a cross-unit joint property — per-unit room/reach terms
  cannot see it; one wall-evaluator member computes the enclosure).

### F8. Potion denial / hoarding — **FITS**

- Denial is priced *natively* by the asymmetric fold — the VALUE lens's M1
  finding (an enemy potion is worth 2× ours at par on three-team boards) is
  the denial coefficient, computed live from `(K, W, p)`. Hoarding-as-tempo
  (hold the potion; spend when their fat account is reachable) is an
  anticipatory meet under our own future-commitment hypothesis, exactly the
  05-doc's "arm now, spend in three turns" case. Deterrence-as-psychology is
  the F2/F5 second-order wall again. This family is the carve at its best —
  concede it plainly.

### F9. Endgame / phase mode-switches — **FITS, with a telemetry gap**

Turtle at parity, race when the turn-limit adjudication approaches, switch
profiles when reduced to one royal unit.

- **Plugs into:** `Choice.conditional` — `{at: 'conditional', on: predicateMember,
  then, else}` is in the selection sketch, and the predicate is an ordinary
  member reading the board. The bot stays one addressed value; the identity
  law survives because the *function* is fixed.
- **The gap:** telemetry keyed by `botId` alone conflates the branches. Two
  decisions by one conditional bot may run disjoint member sets; a
  measurement row that records only the botId averages over the condition. The
  premise CONFIG coordinate needs a **resolved-selection sub-coordinate**
  (which branch of every conditional actually ran) or phase-switch bots are
  unmeasurable per-mode — and a per-mode defect (the endgame profile is bad)
  is invisible in pooled rows. Cheap fix; must be in the manifest schema from
  day one.

### F10. In-game opponent adaptation — **FAILS (the carve contradicts itself)**

Recognise within a game that this opponent never defends the east edge, and
exploit it from turn 20 on.

- **Where the designs put it:** 05-ADVANCE §1 lists "within-game opponent
  adaptation — a posterior over an opponent's habits" as one of the five asks
  the Carried object exists to serve.
- **Where the designs forbid it:** the time lens's anti-latch law —
  *"the worldline holds knowledge and appetite, never calibration — the only
  cross-turn mutable scalars are the exchange-rate fit, attention rows, and
  the seed position"* — and the advance law's "values never cross". A learned
  opponent posterior is calibration, is a measure-coordinate object, and must
  cross turns to exist at all.
- **This is a direct inconsistency between two absorbed lenses**, not a
  quibble: the joints lens adopted the time lens's advance law verbatim and
  also adopted the five-asks table. One of them must give. The honest
  resolution is a fourth crossing category — *learned measure state*, w-only
  (never S), turn-stamped, tripwired like attention rows, and named in the
  premise's measure coordinate so any value computed under the adapted
  supplier declares it (a fitted-in-game weight is a premise crossing per
  ruling 49). Without that amendment, D2's adaptation machinery — an owner
  ask — is inexpressible.

### F11. Operator-facing option play (the Centaur half) — **FAILS (missing joint kind)**

Prefer lines that keep two meaningfully-different plans alive for the human;
surface the sacrifice the human can authorise that the bot may not; order the
displayed alternatives by decision-relevance to the operator, not by est.

- **Why this matters more than any other family:** the VALUE lens's own §6
  closes with it — the fold's residual is small, so *"the Centaur argument
  must rest on surfacing options a human can act on"*. The program's stated
  reason to exist is a strategy family the manifest cannot seat.
- **Why nothing seats it:** its currency is not weight-share (it is operator
  decision-value), so it is not a VALUE member; it does not reorder the bot's
  own argmax, so not ACTION; it does not spend the search budget, so not
  ECONOMY (though it competes for it!); emission is kernel. The five kinds are
  claimed one-to-one with "the game's irreducible facts" — but this product's
  irreducible fact list includes *a human in the loop*, and the carve has no
  kind for what crosses the human boundary: which plans, annotations, and
  disagreement signals reach the operator surface, and what the bot will spend
  to make them trustworthy.
- **What is needed:** a sixth kind (call it ADVICE / PRESENTATION), with its
  own law (probably: a portfolio selector over the plan table under a
  diversity constraint — members rank *sets* of plans, not plans), reading the
  same fibered values, writing only to the operator surface, gated so it can
  never touch the staged plan. This is a joint-kind addition — precisely the
  thing the closed manifest is designed to resist — so it must be decided
  now, not discovered later.

### F12. Correlation-aware risk portfolios — **FITS (watch the API)**

Avoid plans where all units die to the same single reply.

- Expressible iff the REDUCTION member type is the general *functional over
  the credal set* (the 01-doc's α-ball / CVaR framing), of which
  ε-contamination is one closed form. If B7 ships the binding as the ε scalar
  rather than the functional, CVaR and correlation penalties become API
  changes. One-line demand: **the reduction joint's member signature takes the
  credal set, not (est, lo, ε).** Then this family is a member.

### F13. Cross-game / tournament economy — **out of scope, flag it**

Banking effort across concurrent games in one process, throwing a lost game's
compute to a winnable one. ECONOMY is per-decision, the worldline per-game;
nothing spans games. Probably deployment rather than a joint — but a
tournament format makes it a *strategy*, and the carve should say on the
record that it is out of scope rather than absorbable.

### Scorecard

| verdict | families |
|---|---|
| fits cleanly | F2 baiting, F8 potion denial, F9 mode-switch*, F12 risk portfolio*, F3a complexity-pressure |
| fat member (law contributes nothing) | F6 races, F7 walls, (F4's pricing) |
| law amendment owed | F4 revalidation, F9 resolved-selection coordinate, F12 functional API |
| **carve failure** (new joint / law change / missing coordinate) | **F1 sacrifice, F3b commitment-timing, F10 in-game adaptation, F11 operator advice** |
| named refusal wall (honest, but shuts the anti-human half) | F5 deception, F2/F8 second-order halves |

*starred = fits only if the flagged API/schema demand is honoured.

Ruling 49 asks for a machine where a large untried space "configures
naturally". Four of thirteen families cannot configure at all, and three more
configure only by abandoning the factoring the machine exists to provide.
That is not a passing grade; it is a specific work list.

---

## 2. HIDDEN COUPLING — what stays implicit after the carve

The carve's claim: cross-joint interactions become explicit because every
number carries its premise. Five interactions that stay dark:

**2.1 Admission decides what belief ever hears (ACTION → epistemics, no
coordinate).** The closure and caps run before pricing; deep observations
exist only for admitted branches; the belief counterfactual is honest about it
(`belief.ts`: "a depthless search would have generated a slightly different
stream, because the incumbent steers the sweep"). The premise index records
the assumptions *of a number* but has no coordinate for the *selection process
that produced the set of numbers*. Two measurement rows can agree on every
coordinate and still be incomparable because different admission members fed
them different evidence populations. This is ruling 49's distortion (results
driven by the measurer's choices) reappearing one level down, and the manifest
gives it no handle. Minimum fix: the decision's admission trace (which
closures fired, where caps truncated, per unit class) becomes part of the
measurement premise — the joints lens already demands the mechanism report
"say where truncation actually occurred"; it must be a *coordinate*, not a
diagnostic column, or miners will keep pooling across it.

**2.2 ECONOMY grants are a hidden prior over horizons (ECONOMY → VALUE).**
Budget allocation decides which branches get deep readings; deep readings
escape the one-ply truncation; therefore the spend policy systematically
biases which branches may leave their intervals. Two bots differing only in
ECONOMY members produce plies-distributions that differ per branch — and the
depth rung then compares a plies-3 posterior against a plies-1 posterior.
Note what that comparison is: **a cross-observable comparison, licensed
nowhere.** The refusal law says tag mismatch never compares silently; the
depth rung's entire purpose is to compare across horizon tags (that is the
owner's kill-1-lose-2 semantics). The 01-doc claims depth "stops needing an
exception … becomes a type distinction" — but a type distinction still gets
*compared* at pickLeader, and no law says when `estimate[(3,f,w)]` may beat
`estimate[(1,f,w)]`. The exception is real, is load-bearing, and is unwritten.
Write it: cross-horizon comparison is a REDUCTION-member decision with a
declared discount, never a default — otherwise the refusal law has a hole in
the exact centre of the decision.

**2.3 Incumbency is a value that crosses advance wearing an identity
costume.** "Values never cross; identity, incumbency and attention do." But
the incumbent is the argmax of dead values, and the sticky stager's switch
margin means next turn's challenger must beat the ghost by a margin. Dead
values thus keep deciding ties for as many turns as hysteresis holds, with no
premise record — a value laundered into identity. Same for attention rows:
attention is a compressed value function ("this region mattered"), and it
carries while the value that justified it died. The designs bound its
*staleness* (tripwires, plies caps) but not its *bias*: nothing measures
whether carried attention pins the new turn's search to the old turn's
theory of the game. Demand: `carryEffectRate` (already proposed) must be
decomposed into "carry helped" vs "carry anchored", via the same shadow
technique the depth counterfactual uses — an incumbent-free shadow argmax per
turn is cheap and makes the laundering measurable.

**2.4 Read-set declarations are convention, and convention was the disease.**
The merged declaration record (projection tags + citation scopes + frame) is
read by five subsystems, and invalidation correctness inherits from *declared*
read-sets. TypeScript cannot stop a comparator from reading a coordinate it
did not declare — a function reads what is in scope. The four expensive
defects on record were all "the metadata said X, the code did Y". The carve's
answer to that class is… more metadata. The only structural fix is to make
undeclared reads *unrepresentable*: a comparator receives the projected value
for its declared coordinates and nothing else — no fiber, no bank result, no
context object. If the implementation passes rich objects and trusts
declarations, the fibration is the old discipline with new names, and it will
fail the old way.

**2.5 Fit provenance has no coordinate — ruling 49's own consequence is
unimplemented.** The ruling: "every fitted value carries its fit provenance
(lineage, roster density) as premise coordinates — generalizing beyond that
provenance is an explicit premise crossing." Walk the index:
`⟨support, observable, measure, config⟩` — support is model/replies, observable
is horizon/frame, measure is the weight id, config is botId/codeRef/seat/
budget. The VALUE lens's k = 1.227 (fitted on 144 games, three rosters, one
lineage) enters as a member param inside config. Nothing in the index can say
"this number is valid over rosters like the fitting set", so nothing can
*refuse* when a rook-board bot reads a coefficient fitted on snake boards —
which is precisely the crossing the ruling says must be explicit. The
measure coordinate (or a fifth group) needs a provenance component:
`fitted(memberParam, corpusId)` with corpus descriptors, and the refusal law
extended to fire on out-of-corpus reads at least as a logged crossing. As
designed, the lattice enforces everything about a number's *computation* and
nothing about its *estimation pedigree* — and the pedigree is what ruling 49
was about.

---

## 3. COMPLEXITY AUDIT — reduced, or relocated?

Honest counts, both directions.

**What the carve deletes** (verified against the docs' own claims):
- 5 hand-written joint enumerations → 1 manifest + generation (real).
- 3 copies of the adjudication rule → 1 (real, and overdue).
- 9 epistemic idioms → 1 object + projections (real; belief.ts shows the
  object already carries its weight in code).
- 2 staleness conventions, the `??` two-channel class, `BotStamp`, hand
  codecs, the flags system's residue (real).
- 6 hand coefficients + 12-slot precedence + the cliff inequality → 3 flows,
  live coefficients, 1 fitted constant, 2 typed precedence residents
  (real *if* the fold transports; the rook forecast is the honest test and
  it is still open at n=12).
- 5 of the time programme's pending dilemmas → 1 (their accounting).

**What the carve adds** (nothing on this list exists today):
- ~9 premise coordinates in 4 groups, with a stable/volatile id split and a
  churn risk the authors themselves rank first.
- 3 lattice operations + 2 purchase columns + a price list.
- 5 joint kinds × 1 law each, + 2 residual precedence types, + the
  manifest, + a generator producing 5 artifact classes (codec, stamp,
  columns, diff, docs) — a generator is a compiler; it will have bugs and it
  is upstream of *everything*.
- `Choice` (4 forms, recursive), normalisation, botId, roster, reachability
  CI, botDiff.
- Carried (id/author/coordinate/lifetime/transport), the worldline, the
  allowance ledger, the exchange rate, the hypothesis market, the reaction
  table, virtual clock.
- ObservationRecord wire schema, per-team views, ConditioningTrace, the
  reducibility tag, the reappearance oracle.
- ~14 named laws (support, weight, projection, refusal, reducibility, seam,
  identity, totality, reachability, anti-latch, advance, two-lane,
  byte-identity, revalidation-when-added) that every future contributor must
  not violate.

**The honest comparison.** The carve trades *duplication* for *prerequisites*.
Today a maintainer can read `accept()` in `search/core.ts` top to bottom and
know the decision rule; the concepts are local. After the carve, the same
question routes through manifest → Choice resolution → member → law → premise
→ projection, and the reader needs the lattice vocabulary before reading any
single file. Convention count drops; the *entry floor* rises for every reader,
forever. That can be worth it — the four expensive defects were exactly
cross-file convention failures — but call it what it is: complexity moved from
the code into the type system and the metadata, where it is checkable, at the
price that nothing is understandable locally any more.

**Frankenstein risk, new location.** §1's fat-member finding is the audit's
sharpest point: the five composition laws are all *linear* (join, weighted
sum, partition), and strategy is mostly *non-linear* (exclusive races, joint
walls, conditional combinations). Every non-linear idea will be implemented as
one big member, and the manifest will show a beautiful lattice of laws
composing a handful of opaque monoliths. The complexity did not die; it
changed address, and the new address is off the map the manifest draws.
Second risk: the generator. When the manifest is wrong, five artifact classes
are wrong *in agreement with each other* — the property that made drift
detectable (independent copies disagreeing) is gone. The B2 falsifier
(generated stamp reproduces BotStamp field-for-field) covers the migration,
not the steady state.

---

## 4. FAILURE STORIES — the maintainer's view

**Story A: the bot loses to a 3-turn skewer nobody saw.** Old world: read the
decision log; the skewer reply was either in the candidate set or not; grep
the comparator; done — maybe wrong, but shallow. New world, the suspect list a
maintainer must clear in order: (1) ACTION — was the defensive plan admitted,
or closed/capped/sampled away (needs the admission trace, see §2.1)? (2)
MODEL — did the reply supplier weight the skewer line, or did ε=1 make the
question moot? (3) observable — did any deep thread reach ply 3 on that
branch, i.e. did ECONOMY grant it (allowance ledger, hypothesis market
weights)? (4) advance — did a carried commitment/attention row anchor the
search elsewhere (needs §2.3's decomposition)? (5) epistemics — under fog, was
the support wide because C1/C2 rungs are unbuilt or because the width was
game-held? Five joints, each with members, plus the premise trail — **and the
trail exists per branch only if the volatile-half premise hashing survived
its own cost-cut**, which the joints lens lists as its first risk with "type-
level discipline + 5 seam checks" as the fallback. If that fallback is taken,
Story A's per-branch trail is gone exactly where it is needed. The carve is
better than today at *bookkeeping* failures (mismatched premises now refuse
loudly) and worse at *strategy* failures (all coordinates valid, answer still
bad) — and by eliminating the former it makes the latter the dominant
residual class. The design should say so and invest in the counterfactual
replay harness (swap one member, replay the decision) as a first-class
diagnostic tool, because member-level credit assignment is the new debugging,
and nothing in the manifest performs it.

**Story B: the depth-effect rate drops between two builds.** Old world: one
counter, known caveats. New world, legitimate causes with no defect anywhere:
an ECONOMY member shifted grants (denominator now needs carriedQuanta — the
time lens's own open ruling); a conditional bot spent more turns in its
shallow mode (needs F9's resolved-selection coordinate); an ACTION member
changed admission so the belief stream differs (§2.1); the manifest schema
version renamed a folded column (the generator is upstream of the miner). A
maintainer must hold the full coupling graph to interpret *one metric moving*.
The mitigation is real but must be built deliberately: every metric row
carries its premise INCLUDING admission trace, resolved selections, and grant
totals — the three coordinates §2 shows are missing today.

---

## 5. SEDUCTION CHECK — each lens validated on today's game

**TIME (worldline + allowance quanta).** Breaks on the first *stochastic or
hidden* rule addition beyond spawn: replay-rebase reconstructs the resolution
through the bot's own engine with the wire doc as checksum; a new random
effect (random teleport potion, misfire chance) makes replay diverge every
turn, and the design's graceful fallback (marshal path) silently turns the
"free differential test" into a permanently-failing alarm that trains everyone
to ignore it. Also assumes turn-lattice discreteness — a real-time or
variable-tick variant dissolves ADVANCE's clean boundary. Within discrete
turns and deterministic-plus-spawn rules, the design survives; its own
red-team doc already priced the minimal path, which I credit.

**EPISTEMICS ((S,w), S moves only by deduction).** The sound channel's value
is proportional to how much of the game is deterministic and observable.
Every future rule that adds public randomness dilates S toward vacuity, and
the architecture degrades exactly as designed (floors stay floors, worth
less) — the object survives; its *payoff* is rule-dependent, and the pitch
should stop implying the floors' current bite is intrinsic. Correlated
supports are conceded by the lens itself (falsifier 1) and will matter the
day a "both moved or neither" mechanic (linked units, convoy rules) lands.
The refusal of second-order weights is the right v1 call and the wrong
end-state for a game with humans (F5): the day the population is human, the
refused half is the game.

**VALUE (E[terminal weight share] as the one currency).** The currency is
downstream of the *scoring rule*, and the owner has already once caught
results being driven by scoring-rule choices. `sharePar` is an adjudication
artifact: change the tournament format (win-only scoring, elimination
brackets, best-of-N) and the risk-neutral fold mis-targets — γ and the whole
additive channel are calibrated to a currency that the format defines, not
the game. Team-count changes are handled beautifully (the (K,W,p) fold is the
lens's best work); format changes are not, because the currency is an
architectural constant rather than a member. Fix is cheap to state: the
terminal functional (what "winning" pays) is itself a MODEL/VALUE-adjacent
joint with one member per format, and every fitted coefficient's premise
names it (§2.5). Also note the lens's own honesty: R² 0.949 is partly
definitional, snake6-driven, three rosters, and the rook transport test is
still open — the fold must not be promoted to a law of the game until it
lands.

**JOINTS (five kinds, closed manifest).** The kinds are claimed one-to-one
with the game's irreducible facts, and the claim is false by omission twice:
the product has a human in the loop (F11 — no kind for the operator boundary)
and a wire with timing (F3b — emission is kernel by fiat). Both omissions are
load-bearing for a *centaur* bot specifically. The closed manifest ("no
generic plugin surface; new behaviour needs a branch") is the right defence
against plugin soup, but it prices joint-kind addition at architecture-review
cost — so the kind list must be right *now*, and it is not. Separately, the
reachability law survives my attack (the instrument-mark carve-out handles
members awaiting a game mode, e.g. fog members before fog games ship), but it
needs one clarification: "raceable" must mean *raceable in some harness mode*,
not *raced*, or the law deletes the fog programme the day before its game
mode lands.

---

## 6. WHERE THE CARVE SURVIVES (concessions, stated plainly)

1. **(S,w) with horizon-tagged non-truncation is right and already proven in
   shipping code** — `belief.ts` implements the split, the licensed escape,
   and earned precision cleanly. My §2.2 attack is on the *unwritten law*, not
   the mechanism.
2. **Totality + botId kills a real, four-times-paid defect class.** The `??`
   two-channel bug, the unbound production bot, the unlabelled arms — B0/B3
   are cheap, mechanical, and correct. No objection.
3. **The asymmetric (K,W,p) fold is definitionally right on three-team boards
   and the symmetric balances are definitionally wrong.** M1 should land
   regardless of every other question in this document.
4. **The two-purchase-column meet is a genuine catch** — the time lens's
   correction saved ponder from the epistemics lens's own price list, and the
   anticipatory meet as "conditioning without evidence" is the strongest
   single argument that the index/fiber split earns its keep.
5. **The five-defect table (01-doc §4) is honest history**, and "declare your
   coordinates and refuse what you cannot place" is the right one-sentence
   law. My §2.4 demand is about enforcement mechanism, not the law.
6. **The build orders are disciplined** — byte-identity gates, falsifiers per
   increment, behaviour-changing steps last. The migration risk is as managed
   as a change this size can be.

---

## 7. DEMANDS (the work list this review generates)

1. **Sacrifice seat (F1):** re-draw the closure law so team-priced fatality is
   admissible; keep unjustified fatality at the floor. Law change; needs the
   owner, because it touches the safety floor's definition.
2. **Sixth kind or explicit refusal (F11):** decide the operator-advice joint
   now. If refused, the Centaur argument loses its architectural home and the
   owner should hear that trade stated.
3. **Resolve the F10 contradiction:** advance law vs the five-asks table.
   Proposed: a fourth crossing category (learned measure state, w-only,
   stamped, tripwired, premise-named).
4. **Write the cross-horizon comparison law (§2.2):** the depth rung's
   licensed exception to the refusal law, as a REDUCTION-member concern.
5. **Add the missing coordinates:** admission trace (§2.1), resolved
   conditional selections (F9), fit provenance (§2.5). All three are
   measurement-premise gaps that ruling 49 explicitly or implicitly demands.
6. **Enforce read-sets by construction (§2.4):** comparators receive
   projections, never fibers.
7. **Revalidation law for bot-authored Carried (F4/F7).**
8. **Reduction API = functional over the credal set (F12), not an ε scalar.**
9. **Fat-member sub-provenance (F6/F7):** members with internal term
   structure declare it, or the manifest's visibility claim is one member
   deep.
10. **Give commitment-timing a seat (F3b — leakage verified).** The server's
    early-resolution rule plus the shared `movedPlayerIDs` document make
    commit timing a live two-sided strategy today. Minimum: an ECONOMY-side
    reader of opponents' commit status (it is a determination source for the
    reaction table anyway), and a policy seat — likely inside the F11 advice
    joint, since the commit is operator-owned.

Nothing here says the carve is the wrong shape. It says the carve as
converged is a machine for *never again mis-comparing two numbers*, and
ruling 49 asked for a machine for *expressing strategies nobody has tried*.
Those are different machines. The first is nearly done on paper; the second
is four joints, three coordinates, and two laws short.
