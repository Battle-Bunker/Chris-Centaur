<!-- SNAPSHOT: source scratchpad/dof-synthesis.md — synced 2026-09-01T01:13:23Z by the branch-topology housekeeping task.
     This is a point-in-time copy, not the live document. The working copy is the coordinator's
     scratchpad; this branch exists so the owner can reach it if that box is unreachable. -->

# Degrees of Freedom — THE synthesis (A × B × five-socket frame)

Inputs: `dof-cleanroom-A.md` (8 joints, decision-theoretic), `dof-cleanroom-B.md`
(19 joints / 6 clusters, POSG framing), `core-redesign.md` (five-socket frame —
owner has ruled the five were EXAMPLES, not the answer), owner rulings 6–12
(2026-08-29 fourth message), and the engine source verified below. Repo state
anchored at `42d03ca` (registry + belief, work/depth-search) on
`claude/cluster-lookahead`.

Verdict shape up front: **A's carving discipline wins the frame; B's best
content survives inside it; the five-socket frame's registry mechanics survive
but its slot list does not.** Eight strategy joints plus the comparison
substrate. Two of B's items are promoted over A's equivalents on their merits
(diplomacy vector as the data shape; variance appetite as real content, though
fused into one fear surface). Two of B's clusters die on a false factual
premise (board fog).

---

## Part I — The three factual disputes, settled against source

### 1. FOG — A is right. There is no board fog; the only hidden state is this turn's staged moves.

`TacticToes/firestore.rules:237` on the game document:

```
match /games/{gameId} {
  allow read: if true;
```

and the `Turn` document that lives under it (`shared/types/Game.ts:139-176`)
carries the ENTIRE state: `playerPieces` (every body cell of every unit),
`playerHealth`, `food`, `hazards`, `invulnerabilityPotions`,
`playerInvulnerabilityLevel` (tiers), `activeEffects` (with `expiryTurn` and
`sourcePlayerID`), `orientation`, `moves` (what every unit actually did last
turn), `unitTypes` (promotion is visible the turn it happens). All of it
world-readable, every turn. A grep of the whole ruleset
(`functions/src/gameprocessors/`, `shared/`) for vision/fog machinery finds
none — the only hits are "provisional death" comments.

The single hidden object (`firestore.rules:261-263`):

```
match /privateMoves/{moveId} {
  allow read: if isCentaur() &&
    centaurControlsPlayer(sessionId, gameId, resource.data.playerID);
```

— the current turn's **staged moves**, readable only by their owner. Commit
status (`movedPlayerIDs`) is public; content is not. That is intent fog, and
it is the whole of the fog.

**What rests on the false premise.** Everything premised on not knowing the
*current board*:

- **B's cluster A entirely** (J1 hidden-unit measure, J2 fog-pessimism λ, and
  J3's exact-vs-cloud framing). B read the partial-engine headers and assumed
  the game they describe. There is no distribution over hidden unit positions
  because there are no hidden unit positions.
- **Multi-turn staleness machinery as a production capability**: `turnsHeld`
  head-start compensation, catch-up/unfreeze of stale clouds, staleness A/B
  results as production evidence (the deployment pin already flagged this:
  fog was arena-injected, rules:237 says production has none).
- **The kindSet promotion fork** (`Chris-Centaur/src/partial-engine/cloud.ts:655`:
  "A pawn held past the promotion food-count horizon might already be a
  queen") — in production, promotion lands in `Turn.unitTypes` on the public
  wire the turn it happens. A pawn is never ambiguously a queen.
- **The conservative-fog inviolate as scoped in core-redesign §4.1**
  ("a possibly-promoted pawn is a slider") — over-scoped. Conservatism is owed
  only to what is genuinely hidden.

**What survives on the true premise.** The cloud/hold/bounds machinery itself
is not dead code — it is re-scoped to the two real uncertainties:
(a) the enemy's **staged actions this turn** (simultaneity — one-ply holds),
and (b) **search-generated futures** (multi-ply threads dilate enemy
possibilities because the future genuinely hasn't happened). The FOGGED
postures (`src/lobster/postures.ts`) remain meaningful under (a)/(b) but
should never be entered because of board staleness in production. The
deployment pin's reframe stands: the claim engine's production value is a
sound floor under simultaneous-move uncertainty, not positional staleness.

Consequence for the joint set: **all tactical uncertainty reduces to one
object — a distribution over the enemy's joint action this turn (plus its
extension along search plies).** That object is joint D2 below; there is no
belief-over-board-state joint.

### 2. "Severing is the only free aggression" — arithmetic right, exclusivity overstated. There are exactly TWO weight-free attack channels.

The trade law checks out. With `S = T·own/(own+rest)`, a trade costing me `a`
and an enemy `b` improves my share iff `(own−a)/(total−a−b) > own/total` ⟺
`a/b < s/(1−s)`. At par in a 4-team game that is a 3:1 bar; an even trade
helps only above half the board. Verified algebra, no code needed.

The contest law (`turnEngine.ts:173-179`):

```ts
/** Tier first, then frozen weight. At most one unique strict maximum survives. */
const strictMaximum = (participants: RuntimeUnit[]): RuntimeUnit | null => {
```

and the sever rule (`turnEngine.ts:437-480`, c5): equal-or-lower tier entering
a living trail cell dies (`bodyBlock`); strictly higher tier severs — "Severs
are non-fatal: the owner is not a victim" — and the severer capture-stops.
Nowhere in the contest/sever path does a *winner* lose weight.

So A's claim needs one amendment: **a won head-on contest is also weight-free
for the winner.** `strictMaximum` survivors pay nothing; the loser dies whole.
This is not a corner case — it is the owner's own ruling 10: "Without potion,
piece attacks are only against HEADS of lower-weight units." The two channels
differ in *risk*, not in weight cost:

- **Sever (tier channel):** requires strictly higher tier; the target is a
  trail cell committed for the whole turn — it cannot dodge; the cost is one
  tempo + per-cell health; yield up to `len − cutIndex` enemy weight;
  `a/b ≈ 0`, near-deterministic. Riders verified: a tier-0 unit outranks a
  −1 carrier (0 > −1, no potion of your own needed), and severing/killing any
  tier<0 unit revokes its whole team's buff the same turn
  (`turnEngine.ts:477` adds to `vulnerableCollided`;
  `TeamSnekProcessor.ts:531-547` sets `effect.expiryTurn = currentTurnNumber`;
  `expireEffects` fires on `<=`).
- **Head-hunt (weight channel):** requires equal tier + strictly higher frozen
  weight; weight-free when won, but the target's head moves simultaneously —
  the attack is a bet against the dodge distribution, and the tie outcome
  ("ties kill everybody") is mutual death, which fails the trade law at any
  `s < 1/2` by the full unit weights.

Amended doctrine sentence: **severing is the only free attack against a target
that cannot dodge; head-hunting is the only free attack that needs no potion —
and it is a simultaneity gamble priced by the opponent model and risk posture,
not a sure thing.** A's structural conclusion survives intact — potion doctrine
remains the strategic centre of aggression — but the aggression budget has two
lines, not one, and the owner's within-3-turns attack-availability signal
(ruling 10) is the arming trigger for the first line.

On bystanders (A F2 vs B J8): both are right in their own algebra, and one
subtlety matters. Destroying any weight anywhere raises EVERY surviving
team's share (the denominator shrinks for all), so even a free attack helps
bystanders — but the terminal metric is *absolute* share × T, not rank, so a
free attack is still strictly positive for the attacker. The bystander gift is
therefore not an arithmetic tax on the attack; it is a *forecast* liability
(stronger rivals harvest more and are harder to eliminate). That moves
"bystander accounting" out of the derived-arithmetic bin and into joint D7 as
a genuine judgment about future threat.

### 3. Top-end convexity and maxTurns — both confirmed.

Convexity is two lines of calculus: `∂S/∂rest = −T·own/total²`,
`∂²S/∂rest² = +2T·own/total³ > 0`. Each successive unit of enemy weight
removed is worth more than the last. Two engine discontinuities sharpen it:
units die whole (a lost contest removes the unit's entire stock at once), and
the terminal rule (`TeamSnekProcessor.ts:700-730`):

```ts
const reachedTurnLimit = this.maxTurns !== undefined && currentTurnNumber >= this.maxTurns
...
if (aliveTeams.length === 1) {
  return this.calculateTeamWinners(aliveTeams[0], board)
}
```

Last team standing ends the game immediately holding all surviving weight —
share 1, score T, the maximum. `aliveTeams.length === 0` falls to
`calculatePreviousTurnTeamOutcome()` (the mutual-wipe rule the true-metric fix
already prices). And if `maxTurns` is undefined, `reachedTurnLimit` is never
true — the ONLY termination is ≤1 team alive, and the continuous share metric
degenerates to near-binary win/lose. A's regime warning is engine fact:
**configs are comparable only within a declared turn-limit regime**, and that
declaration belongs in the comparison substrate (D0), not in the bot.

---

## Part II — Carving rules adopted (and their provenance)

1. **A joint exists only where genuine strategic uncertainty lives** and
   matches (or a named supervised proxy) can settle it. Derived quantities are
   never dials: the grow/deny exchange `s/(1−s)`, territory income as a
   contested-Voronoi measure, threat arithmetic, starvation/fuel arithmetic,
   promotion arithmetic. (A, P1 + Part 3; owner peer-stance compatible.)
2. **Fear is expressed exactly once.** One risk-posture surface; no second
   caution knob anywhere — not in valuation, not in a fog layer, not in a
   separate variance dial. (A, P2 — extended to absorb B's J10.)
3. **Mutually compensating joints are swept together, and the doc says so.**
   Named grids: D2×D3 (model calibration vs response robustness); the endgame
   block D1-schedule × D3-appetite × D7-horizon; D5 reported across ≥2 D4
   settings. (A's J2/J3 grid rule + R1/R2, generalized.)
4. **Centaur dials are intent-level scalars and discrete commitments — never
   move overrides, never architecture knobs.** (B §4, verbatim principle.)
   Plus A's rider: the dial surface is a strict subset of config space, every
   operator excursion is logged as a candidate config, and dials are bounded
   reparameterizations of a validated region.
5. **Every joint names its comparison method.** Supervised proxies before
   match play wherever a proxy exists (valuation → final-score correlation;
   opponent model → log-loss on `Turn.moves`); equal wall-clock always;
   per-opponent matrices, never scalar strength. (A, J0/J1/J2.)
6. **The seam rule survives from core-redesign:** anything that can change a
   sound bound is kernel behind the law harness; anything that can only change
   order or spend is entry data. Joints live entirely on the entry side.

Noise threshold retained from A: an effect expected below ~5% of par is not a
joint — fix it, derive it, or bury it as a parameter inside a joint. This is
what compresses B's 19 into 8 without losing content.

---

## Part III — THE joint set

Numbering D0–D8 (deliberately neither A's nor B's).

### D0 — Comparison substrate (the protocol, not a bot joint)

From A J0, amended by owner rulings and Part I §3.
**Varies:** turn-limit regime (mandatory declaration — Part I §3); team count;
roster; board presets and paired seeds; ladder shape; reported statistic.
**Owner-ruling amendments:** potions ALWAYS ON at 0.15 in primary cells —
potions-off runs exist only as controls isolating D6 (ruling 9 overrides A's
suggestion of potions-off as a routine A/B); the metric is the true score
(share of end-of-game weight × team count), continuous, with the mutual-wipe
terminal rule priced.
**Non-negotiables:** identical wall clock per config in a match; full
per-opponent matrix; diversity-preserving reference population + held-out
opponents (A's R3 — a config cycle, if found, is a finding about the game).
**Existing mapping:** learnloop paired arms/nulls/engagement proof carry over
with slates as arms; needs a `regime` column.

### D1 — Valuation: the term-vector (ONE joint, one vector)

Absorbs A J1 + B J9 + B J12's price half + B J19's pricing half + the
convexity finding.
**Varies:** the basis (stock; contested-Voronoi income with contest model and
discount as free shape; fuel reserve; **sever exposure** — weight at reachable
cut depths, the geometry half of B's body-posture insight; potion option AND
denial value — B J12's scalars live here, doctrine in D6; liberties/mobility;
king shadow price on regicide rosters — B J9's lexicographic point);
**share-curvature / elimination-premium shaping** (Part I §3 makes the convex
transform near domination a first-class term — core-redesign §2.2's
`share-curvature` row was right); **which `s` feeds the exchange rate**
(current / forecast / among-survivors); the **stock↔flow endgame decay**
(value side of B J11).
**Comparison:** supervised first — correlation/ranking loss between valuation
at turn t and final score over the logged corpus, at several t (orders of
magnitude cheaper than matches); match play after, to catch well-correlated
evaluations that steer badly.
**Dial:** bounded emphasis multipliers over a validated baseline (global and
per-unit — exactly the §4.3 knob surface already built at 42d03ca); never the
term list, never the derived exchange rate.
**Coupling:** everything consumes it; endgame decay swept with D3's appetite
schedule and D7's horizon (the endgame block).

### D2 — Opponent action model (the sixth socket; the fog, correctly scoped)

A J2's shape wins; B J6's content (stereotypes, learning rate, per-team
granularity) lives inside it; B J1/J2 die with the fog premise, and their
legitimate residue — reading a particular opponent's habits — is this joint's
adaptation machinery.
**Varies:** mixture over component priors (engine default — exactly known:
`moveGrammar.defaultAction` walks a snake straight, holds a piece; greedy-food;
threat-averse; potion-seeking; carrier-hunting; uniform-legal floor);
intra-team correlation (none / role-coupled / joint-sampled); adaptation
(fixed / within-game Bayes with halflife / per-`centaurId` priors across a
series — identity is stable and public).
**Contract (the P2 firewall):** D2 emits a calibrated distribution over each
enemy unit's action this turn (extended along search plies by the thread reply
model) and NOTHING else; no other component may contain a safety threshold.
**Comparison:** log-loss against `Turn.moves` (the wire records every applied
move) on the replay corpus; then decision-weighted log-loss (restricted to
turns where a different prediction changes our action); match play last.
**Dial:** mixture nudges ("they're farming, not hunting"), per-enemy-team,
merged into D7's stance UI; never the adaptation machinery.
**Existing mapping:** NO SOCKET EXISTS — see Part IV. This is the biggest
re-carve in the program.

### D3 — Risk & response policy (the ONE fear surface)

(Owner-facing name: "risk policy" — the glossary reserves "posture" for the
kernel's internal visibility states, and the checker blocks it.)

Fuses A J3 (response rule: EV / maximin-over-support / CVaR-α /
regret-matching, + randomization = B J5's temperature) with B J10 (variance
appetite: utility curvature over outcome lotteries, standing-and-clock
scheduled, with the out-of-game context — series stakes — as the operator's
private information). B's insight is real and A's discipline applies to it:
robustness-to-model-error and appetite-for-outcome-variance are different
objects that compensate almost perfectly in behavior, so they are ONE joint,
swept together.
**Varies:** α (the response rule's robustness level over D2's distribution);
utility curvature (schedule off standing + clock, free gain); temperature /
whether we actually mix in duel pockets (chicken standoffs, food races,
contested potions — the mixed-strategy pockets simultaneity creates).
**Comparison:** match play as a GRID WITH D2, never one-at-a-time (A's rule:
a calibrated model wants best response, a poor one wants robustness; either
alone finds a ridge). If the grid shows no interior optimum, fuse D2+D3 into
one tactical-posture joint (A's named falsifier, kept).
**Dial:** one legible paranoia control (α) + one gamble/ice-the-game override
(B's J10 rationale: only the operator knows the tournament context). These are
the only fear dials in the system.
**Existing mapping:** partially the selection ladder (floor → mu → prec) and
the sampling temperature; needs the α/curvature surface gathered into the
advisory channel's enemy-reply integration (slot-4 `selectionKey` +
thread reply weighting). The sound maximin floor is NOT fear — it is law, and
stays kernel.

### D4 — Coordination & action factorization

A J4 + B J15, including B's one real dial in the cluster: the coupling degree
(how much units sacrifice individually for joint plans).
**Varies:** independent-with-repair / sequential best-response sweeps (order a
choice) / role-partitioned groups / sampled joint search; group size caps;
joint sample counts; friendly-contest repair (the no-friendly-exemption
constraint makes naive independence unsafe — engine-verified: own units
contest and kill each other).
**Comparison:** equal wall-clock match play PLUS the compute-scaling curve
(1s → 10s): a factorization that does not convert cores into strength is
wrong regardless of point score. This is where the parallel-compute mandate
cashes out.
**Dial:** none. Machinery.
**Existing mapping:** CLEAN — cluster partition + exact enumeration are kernel
primitives; multi-start sampler, gain ordering, edge-EV are slot-1 entries;
the owner's overlapping-clusters ruling is this joint's parameter space.

### D5 — Roles, dispersion & assignment

A J5 + B J16 + **B J13 (collector designation) kept on its merits** as a role
in this joint's vocabulary, consumed by D6 (including B's bait inversion — a
carrier that *wants* to be hunted while the team is buffed).
**Varies:** role roster (harvester, screen, raider/severer, potion carrier,
escort, collector-bait, area denier); proportions and state-conditioned
schedule rows; food assignment cost model (F5: the same item is worth more to
a starving unit — an assignment problem, not greedy-nearest); dispersion
target (Voronoi share vs mutual protection — the genuine unresolved tension);
re-assignment hysteresis.
**Comparison:** match play + the binding diagnostic (how often the role's
preferred action is the chosen one — never-binds means untested, always-binds
means the roles replaced the search); ALWAYS reported across ≥2 D4 settings
(A's R2: roles may be a mask over a weak factorization, and the mask
accumulates hand-authored doctrine on the primary human dial — the named
Bitter-Lesson trap).
**Dial:** PRIMARY. Role tags per unit (B's UI insight: drag roles onto
units), roster proportions, spread. Every excursion logged as a config row.
**Existing mapping:** nothing exists — no role concept anywhere in the
registry. Carve as an assignment layer whose output conditions slot-1
move-selector logits and D6/D8 spend.

### D6 — Potion & attack doctrine (indivisible, and now two-channel)

A's indivisibility argument wins outright: contest/collect, carrier choice,
pre-positioned targets, window spend, escort, counter-window, denial are one
temporally-extended option — split into five knobs, no variant is
interpretable. B J12/J13/J14 become internal parameters (price → D1; collector
→ D5 role consumed here; window commitment → this joint's core). Owner rulings
9–10 are this joint's spec: conditional potion-SEEKING when profitable attacks
are within reach; potion CONTROL (keep potions inside our territory, collect
on short notice — B's "hold on the ground as a standing threat", independently
ruled by the owner); the arming trigger = a profitable enemy-body attack
available within 3 turns.
**Varies (together):** contest/decline rule; carrier choice (safest-cheap /
nearest / bait); require-precommitted-targets; window spend ranking (cut depth
× weight, verified sever mechanics); escort; counter-window posture (turtle +
coil — B J19's behavioral half — vs hunt the −1 carrier vs tail-nick to revoke
the buff, all engine-verified in Part I §2); denial collection; **and the
second free channel:** weight-superior head-hunt doctrine (when to spend
prediction-gamble attacks outside windows — priced through D2×D3, armed here).
**Comparison:** match vs fixed references, potions ON (D0); potions-off cells
as the isolating control; sub-metrics the game hands over free: enemy weight
removed per potion collected, carrier survival through the window, windows
armed vs windows spent. Fully observable on both sides (tiers and expiry on
the public wire) — the sub-game where doctrine differences show sharpest.
**Dial:** arm / hold / commit switch + defensive-posture toggle (B's UI, A's
semantics) — the classic 3-turn-horizon human timing call.
**Existing mapping:** the potion/attack terms being built (tier-window
pricing, `sliderAttackVector` + ray-crossing at ddf07f1) are D1 rows — they
PRICE the window. Nothing COMMITS to it. This joint needs a discrete
multi-turn commitment object (arm → collect → spend plan) visible to the
scheduler and move selectors — B J18's macro-grammar point lands here as a
build precondition, not as a joint. See Part IV.

### D7 — Rivalry, diplomacy & horizon

**B's data shape wins over A's:** a per-enemy-team stance vector + truce/punish
protocol, not a single target-rule enum. B's argument is decisive — n-player
equilibrium selection depends on the particular minds present, which no
offline fit anticipates — and A's own insistence on per-opponent matrices
concedes the same point. A's contents survive inside it:
**Varies:** the stance vector; the truce protocol (don't initiate on a quiet
border; punish-the-attacker); bystander accounting (re-derived in Part I §2:
a FORECAST liability, not an arithmetic tax — how much future threat a
strengthened bystander represents); elimination pursuit (when the convex
premium justifies real cost — Part I §3 verified the acceleration and the
terminal jump to score T); the turns-remaining schedule and a distinct
terminal phase (refuse sub-rate trades, graze, tuck bodies during enemy
windows — B J11's shape, D1's decay, D3's appetite: the endgame block, swept
together).
**Comparison:** multi-team round robins within a declared regime;
per-opponent matrix, never the mean ("leader-bash vs hunt-weakest" is A's
clean four-way, runnable now as stance-vector presets).
**Dial:** SECOND PRIMARY. Per-enemy-team tri-state (hostile/neutral/avoid) +
"play for the finish" — B's #1-ranked centaur dial, adopted.
**Existing mapping:** nothing keys on enemy team id today. Moderate re-carve:
stance vector = slate-level params consumed by D1's denial/threat rows as
per-team multipliers, delivered over the operator-pin channel.

### D8 — Compute, tempo & attention

A J7 + B J17 + B J3's surviving residue (with no board fog, "exact vs frozen"
becomes: which enemies get exact reply modeling this turn — a criticality/
compute question, not a belief question).
**Varies:** budget split (root candidates / depth / D2 samples); escalation
triggers (contact, potion within k, endgame); anytime re-staging cadence;
commit timing (staging is repeatable, committing is binding and public —
small real information content, F9); per-enemy exact-modeling set.
**Comparison:** equal wall-clock + the strength-vs-budget curve (the only
honest allocator comparison); safety metric: engine-default fallback rate ≈ 0;
**and the owner's standing depth diagnostic (ruling 11): depth-effect rate —
the fraction of decisions where a 2+-turn evaluation changed the staged move —
tracked continuously, not per-experiment.**
**Dial:** mild ("think harder here"). Never architecture (B's exclusion list,
adopted).
**Existing mapping:** CLEAN — slot 5 scheduler + VOI boundary-straddle
(core-redesign §2.3), thread machinery, BranchPosterior + precision-weighted
merge (the clamp's replacement), Gumbel-top-k sampling with explicit
exploration (ruling 12). The slot-4 backup-rule family is D8 machinery; its
selection-ladder face is D3's surface.

### Refused as joints (the negative space, merged from both)

1. Aggression α as a dial (B J7) — derived `s/(1−s)`, verified. The free
   residue (which `s`; capacity-denial pricing) is D1's. B's real point —
   farm and hunt differ in variance and tempo — is captured by D3's appetite
   and D1's income terms, not by a blend scalar.
2. Board-fog belief machinery (B J1, J2) — false premise, Part I §1. The
   observation adapter stays isolated so a future ruleset with vision makes
   this a joint without disturbing anything (A's #8).
3. The one-turn forward model — exact shared re-implementation, never a
   variant (A's #2; the program's differential-testing record is the proof).
4. Threat arithmetic, starvation deadlines, promotion policy, pawn-value
   micro-rules — computed, priced by D1 (A's #3-5).
5. Individual evaluation terms as separate joints — one vector (A's #6).
6. A standalone caution/risk knob anywhere outside D3 (A's #7 — the single
   most important negative decision, now also covering B J10).
7. Randomization as a top-level style — D3 parameter (A's #9, B J5 likewise).
8. Macro-action grammar as a swept joint (B J18) — kernel vocabulary, changes
   rarely, judged by what it makes representable; named as D6's build
   precondition.
9. Body posture as a joint (B J19) — split: pricing into D1 (sever exposure),
   behavior into D6 (counter-window coil); realization is the search's job.
10. Roster/board setup — D0's axis, not the bot's choice.

---

## Part IV — Mapping onto what exists

The registry at `42d03ca` (`src/lobster/registry.ts`) declares five sockets —
move-selector, evaluator-selector, evaluator, aggregator, scheduler — seeded
with legacy entries, identity law with teeth (fingerprint tests over the live
constants), slates as arms, and the seam rule. The depth build adds
`belief.ts` (BranchPosterior), precision-weighted merge, scout-through-
aggregator. The potion/attack thread adds tier-window terms and
`sliderAttackVector` + ray-crossing as evaluator rows.

### Maps cleanly

- **D4 ← kernel primitives + slot 1/5.** Cluster partition, enumeration,
  multi-start sampler, gain ordering, edge-EV: exactly the right shape.
- **D8 ← slot 5 + VOI + threads + slot-4 machinery.** The depth build IS D8's
  machinery; ruling 12's explicit exploration and the precision-merge
  replacement of the clamp land here unchanged.
- **D1's rows ← slot 3.** Material, health economy, king margin, reach, room,
  command, tier-window, sever-threat, share-curvature: the row inventory is
  right (and Part I verified the two rows the true-metric work added —
  sever damage first-class, mutual-wipe pricing).
- **D0 ← learnloop.** Slates as arms, nulls, engagement proof: carries over.

### Requires re-carving

1. **D2 has no socket — the biggest re-carve in the program.** Today the
   enemy exists only as (a) sound worst-case over reply sets in the bank
   floors and (b) thread reply models with no calibrated prior. A sixth slot
   — opponent-model entries emitting the calibrated action distribution,
   consumed by the advisory channel (posterior densities, thread reply
   integration, D3's α) while the sound channel stays maximin — is the
   structural exit from the worst-case-passivity caveat that four independent
   agents confirmed as structural. Passivity is what a bot with only a sound
   channel must do; D2 is the channel the mitigation (bounded-adversary
   relaxation) was reaching for. Its comparison method (log-loss on
   `Turn.moves`) needs no matches, so the socket pays for itself in
   evaluation cost immediately.
2. **D1's weights: one versioned valuation profile per slate**, not per-row
   independent params. Sweeping rows independently violates the one-vector
   rule and the noise threshold (most rows are individually sub-5%-of-par).
   The identity law already gives the mechanism: a profile is an entry;
   `which-s`, share-curvature shape, and endgame decay are profile params.
   The §4.3 operator multipliers then modify the PROFILE, which keeps dials
   on-manifold and logged.
3. **D3's surface: gather fear into one place.** The advisory channel's
   enemy-reply integration (slot-4 selectionKey + thread reply weighting +
   temperature) becomes the α/curvature surface; the posture governor's
   conservative defaults stop being an independent second fear once FOGGED
   states are re-scoped (Part I §1). Sound floors stay kernel — law, not fear.
4. **D5: an assignment layer** (unit → role tags) conditioning slot-1 logits
   and D6/D8 spend, plus the intent-level dial surface (§4.3 today is weight
   multipliers only; role tags and stances are absent from the operator-pin
   vocabulary).
5. **D6: a discrete commitment object.** The evaluator rows price the window;
   nothing arms, collects, and spends one. A three-turn plan (arm → collect →
   spend, with precommitted targets) must be representable to the scheduler
   and move selectors — the macro-grammar precondition. Without it, D6's
   candidates cannot exist as data, and potion play stays emergent-or-absent.
6. **D7: per-team keying.** Stance vector as slate-level params consumed by
   D1 rows as per-enemy-team multipliers; wire it through the operator-pin
   channel like any pin.

### What in the five-socket frame was WRONG (not incomplete)

1. **The slot list carved the maximizer, not the strategy.** Four of five
   sockets (move selector, evaluator selector, aggregator, scheduler) are
   compute-machinery joints — D4/D8 territory — and the entire object-level
   strategy space was compressed into one socket (evaluators) as
   independently-weighted rows. The registry MECHANICS (identity law, slates,
   paired arms, seam rule, entry-not-flag) are right and load-bearing; the
   claim that those five slots span strategy was wrong, and the owner has
   since said so (rulings 7: the five were examples).
2. **Slot 2 (evaluator selector) as a strategy socket.** By rule 1 of Part II
   it fails: which evaluators to run is derived economics — core-redesign
   §2.3 itself derives the VOI/cost boundary-straddle rule, making slot 2's
   entries approximations of one correct rule, not rival strategies. It is
   D8 machinery. (Keeping bracketing baselines like `always-all` for
   validation is fine; they are instruments, not candidates.)
3. **Per-row independent evaluator weights as the sweep surface.**
   Compensating knobs, individually sub-noise; wrong unit of comparison
   (re-carve 2 above).
4. **The conservative-fog inviolate as scoped.** "A possibly-promoted pawn is
   a slider" defends against multi-turn staleness that production does not
   have (promotion is public the turn it happens — `Turn.unitTypes`,
   rules:237). Conservatism is owed to this turn's staged moves and to
   search-generated futures, nothing else. Keeping the over-scoped version
   is not safe-but-slow; it feeds systematic pessimism into every ceiling and
   is one of the passivity inputs.
5. **What was RIGHT and stays untouched:** the seam rule; the safety floor
   as kernel; denomination in the true metric with sever damage first-class
   (verified); share-curvature as a row (verified convexity); the posterior
   object and precision-weighted backup; deletion of the clamp; entries as
   data with records (rulings 6 makes this permanent).

### Sweep-together contracts (rule 3, explicit)

- **D2 × D3**: always a grid; falsifier — no interior optimum ⇒ fuse.
- **Endgame block**: D1 decay × D3 appetite schedule × D7 horizon — swept as
  a block; they all move "how much do we bank now".
- **D5 across D4**: role results reported at ≥2 factorization settings;
  binding-rate trend is the obsolescence signal.
- **D6 windows under D2**: window commitment presumes a reply model for the
  3 turns; potion sub-metrics reported per opponent class.

---

## Part V — A vs B: the disagreements, decided

| Question | A said | B said | Decision |
|---|---|---|---|
| Board fog | none — intent fog only | fog-pessimism λ, hidden-unit measure | **A — engine-verified** (rules:237 vs 261-263); B's cluster A dies, habits-reading residue → D2 |
| Aggression dial | derived s/(1−s), never a dial | scalar α, "the canonical dial" | **A** — dial refused; B's variance/tempo point → D3+D1 |
| Free aggression | severing only | (not analyzed as sharply) | **Neither exactly**: two weight-free channels (sever + won head contest); A's structure survives amended |
| Target selection shape | single target_rule enum + bystander discount | per-team diplomacy vector + truce protocol | **B** — equilibrium selection is genuinely per-minds; A's contents live inside B's shape (D7) |
| Variance appetite | inside J8 horizon rows / refused as standalone | J10, standalone scalar, centaur dial | **Fused** — real content (B), one fear surface (A's P2): D3 |
| Potion carving | one indivisible joint | three joints (J12/J13/J14) | **A** — indivisible; B's collector designation + bait kept as D5 role, prices to D1 |
| Fear count | exactly one (J3 α) | several (J2 λ, J4 blend, J10) | **A** — D3 is the only fear surface |
| Mixing | J3 parameter | J5 standalone dial | **A** (B's own exclusion logic supports it) |
| Macro grammar | not discussed as joint | J18, deepest structural commitment | **Both partly**: not a joint (A's discipline), but D6's build precondition (B's point stands) |
| Body posture | derived exposure term | J19 policy joint | **Split**: D1 pricing + D6 behavior; not a joint |
| Attention/exact-modeling | inside J7 | J3, belief-flavored | **D8**, compute-flavored (fog verdict removes the belief flavor) |
| Roles UI | schedule rows in config | drag roles onto units | **Both**: B's UI, A's logged-config discipline (D5) |

Kept novel items on merit: **B** — diplomacy vector + truce protocol (D7),
collector designation incl. bait inversion (D5→D6), variance appetite content
(D3), intent-level-only centaur principle (Part II rule 4), potion-on-ground
standing threat (D6, independently owner-ruled). **A** — indivisible potion
doctrine (D6), J2×J3 grid rule (D2×D3), supervised proxies (D1, D2),
binding diagnostic + R2 matrix rule (D5), compute-scaling curve (D4),
the noise threshold, the entire refused-joints list, dial-excursions-as-data.

---

## Part VI — Owner summary (≤10 bullets, checker-clean)

See `dof-owner-summary.md` — piped through
`node tools/principal-glossary/check-briefing.js` on `claude/cluster-lookahead`
(cl-main worktree): **0 blocking, exit 0**. One ledger debt flagged by the
checker: "arm" is defined in place ("arm/hold/commit switch",
"arm-collect-spend commitment") — the definition event is owed to
`tools/principal-glossary/ledger.json` in the same cycle the summary ships;
left to the coordinating session, since this task's mandate is read-only on
the repo.
