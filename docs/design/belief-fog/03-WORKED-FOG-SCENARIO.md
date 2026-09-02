# Worked scenario — one invisible knight, five turns, every mechanism in its place

Companion to `01-OBSERVATION-API.md`. A turn-by-turn trace showing that the
(S, w) factorization runs the invisibility game on today's machinery plus only
the named additions. Also records the three rules-level findings the trace
surfaced (§5–§7), one of which REVERSES a dof-synthesis verdict.

Rules claims below are verified against the engine source at the
cluster-lookahead tip except where tagged (game-design decision) — those are
parameters the invisibility feature must choose, with recommendations.

---

## 1. Setup

11×11, two teams. Enemy knight K at (5,5). Our snake king-side elsewhere.
The game adds an INVISIBILITY potion family (distinct from invulnerability):
collection hides the collector from enemy views for `effectTurns` (say 4).
Redaction policy for the scenario (recommended defaults, argued in §6):
positions/moves/paths/orientation/unitTypes of hidden units withheld; item
boards truthful; deaths public; clash records partially attributed.

## 2. The trace

**T10 — collection.** K ends on the potion cell. The pickup is a visible
event (potion vanished; effect row with expiryTurn=14). Our view's mask
gains `{unitId: K, lastSeenTurn: 10}`.

Bot ingestion: `PartialEngine.hold(K, { heldAtTurn: 10 })` — a FrozenRecord
from the last-seen state, exactly the constructor the mask row is. The
reducibility tag on this hold: `observation` (not `compute`). The scheduler's
un-hold lever is disabled for K — enumeration cannot REMOVE this width, only
C2 deduction or the reveal itself can. What stays purchasable is preparation
AGAINST the width: pre-spending compute on conditional frontiers per possible
reveal (per surviving cloud cell class) buys reaction latency for the turn K
reappears, without narrowing anything. Removal and hedging are two different
purchases with two different prices; the tag governs only the first (see
04-doc §3 — the time lens's correction).

**T11 — first hidden turn.** View shows no K. S(K) = the knight cloud at
turnsHeld 1: the 8 L-cells plus (5,5) itself (`stayLegal` — pieces may hold;
verified grammar.ts profiles). Weight over position coordinate: uniform over
the 9 (the zero-learned-content supplier; ruling 13 keeps the QUANTIFIER for
anything that prices a floor — the position weight serves only advised
consumers).

- C0: our units' end cells and every visible enemy's end cell are bbAndNot'd
  out of `headPossible` (end-of-turn occupancy is exclusive for LIVING units;
  the exclusion is conditional-on-alive, which is precisely the discipline
  the cloud already enforces via `deathPossible` gating — "no verdict layer
  may read a certain cell as presence yes while deathPossible").
- Sound floors: any plan walking a unit of ours through S(K) prices the
  possible contest through the existing risk layer — FOGGED-DISCRIMINATING
  posture, in production, for the first time legitimately (see §5).

**T12 — the food tell (C1).** Food at (7,6) present in T11's board, absent in
T12's, no visible unit ended there. Collection is destination-only (cloud.ts,
verified), so K's head ENDED at (7,6) at T12. Conditioning: the T12 entry of
K's `ConditioningTrace` sets `headMask = {(7,6)}` — the front collapses to a
point, tighter than dilation from T10 by an order of magnitude, and
`healthDelta = refuel` rides the same entry (the food relaxation the timeline
already models speculatively becomes fact).

Note what did NOT happen: nobody predicted K "probably went for the food".
The support learned it as a deduction. A weight supplier that had put mass on
food-seeking would have been vindicated, but the floor never needed it.

**T13 — dodge under position uncertainty.** K's cloud = knight fan from
(7,6). Our pawn wants a cell inside that fan. The dodge discount today walks
the cover fan "from the attacker's CURRENT head" — its own header names the
gap ("repairing it means predicting the attacker's position, which is the
opponent-model socket's own job"). Under fog the socket's answer: the
supplier serves weights over ANY coordinate of S, positions included; the
cover computation becomes a small mixture — for each cloud cell p with weight
w(p), the fan from p, and d(m) = Σ_p w(p)·d_p(m). Uniform-over-cloud is the
zero-content position weight; `opp/cover` composes on the action coordinate
per p. Cost scales with `possibleCount`, which C1 just cut to ~8. (This
generalization — supplier domain = S-coordinates, not merely actions — is a
correction to 02-doc §4 and is folded into the synthesis.)

**T14 — expiry: the reappearance oracle.** The effect's expiryTurn is public;
at T14 K reappears in `facts` at its true cell. Conditioning collapses S(K)
to a point; the hold is released; `observedTurns[K] = 14`.

And one invariant fires for free: **the reappearance cell MUST lie inside the
predicted cloud.** Every reappearance — expiry, or any C1 collapse checked
against later facts — is a live soundness audit of the entire cloud/trace
pipeline in production, at zero instrumentation cost. A reappearance outside
`possible` is a thrown invariant, not a logged curiosity: it means some
consumer somewhere trusted a support that did not contain the truth. (The
tripwire the depth-idle lesson asks for, built into the physics.)

## 3. The mirror run (our unit invisible)

Same machinery, observer flipped: `Belief(enemy)` over OUR collector runs the
ENEMY's conditioning ladder on data we hold exactly (the rule is public; our
true trajectory we know; the enemy's C0/C1 evidence is computable from the
full record we do see... our own view plus our knowledge of our units IS the
full record for events involving us). Consequences priced as D1 terms, not
new machinery:

- eating food while hidden SPENDS concealment (their C1 collapses our cloud)
  — the trace makes "stay hidden vs refuel" a priced trade-off;
- moving toward their units grows the overlap of their S(us) with their own
  paths — C0 exclusions leak position;
- maximal-entropy flight (moves keeping their front large) is computable from
  their trace: it is OUR cover-counting run in reverse.

## 4. What the scenario needed beyond today's code (complete list)

1. Per-team views + mask on the wire (01-doc §1–2).
2. `hold` fed from mask rows; real `observedTurns` (plumbing exists).
3. ConditioningTrace threading in the timeline (01-doc §5).
4. C0/C1 conditioners (set arithmetic).
5. The reducibility tag, read by VOI.
6. Position-coordinate weights in the supplier (mixture dodge).
7. The time-indexed premise (§7 below — the one genuine soundness gap found).

Bounds, bank, risk layer, search core, scout, postures, belief.ts: untouched,
as the 01-doc migration table claimed.

## 5. Finding I — the FOGGED postures become production states (verdict amendment)

dof-synthesis Part I §1 scoped the FOGGED postures to simulation clouds and
said they "should never be entered because of board staleness in production."
Under invisibility they are entered in production for exactly the right
reason: genuine partial observability. No code change — the posture governor
keys on measured board conditions (holds present, floors separating), which
is the correct trigger in both worlds. The amendment is to the DOCTRINE
sentence only, and it validates the governor's design choice of never keying
on WHY a hold exists.

## 6. Finding II — the kindSet promotion fork comes back from the dead

dof-synthesis Part I §1 ruled the pawn promotion fork (cloud.ts: "a pawn held
past the promotion food-count horizon might already be a queen") dead-premise
scaffolding, because promotion lands publicly in `Turn.unitTypes` the turn it
happens. Under invisibility, a HIDDEN pawn's unitTypes row is masked: a pawn
that vanishes, eats twice while hidden (food-vanish tells us it ate — but two
food cells gone near its cloud may be attributable only as a set), and
crosses the promotion threshold IS ambiguously a queen, in production. The
kindSet fork is the only sound answer, and PIN 20's "do not delete the
cross-turn machinery" acquires its concrete exhibit. (Redaction-policy
interaction: if the policy published promotions of hidden units as events,
the fork stays dormant — a game-design dial between fog depth and bot
complexity, flagged for the owner when the feature is specced.)

## 7. Finding III — the static premise is unsound across real turns (the one true gap)

`CloudPremise.food` is the freeze-turn board, and its soundness argument is
"item spawning is gated off while anything is frozen — food can only be
REMOVED during a hold" (cloud.ts, verbatim). TRUE inside one decision's
simulation; FALSE across real turns: production spawns food and potions
continuously (potions at 0.15/turn, always on — ruling 9). A unit hidden for
six real turns can eat food that DID NOT EXIST at its freeze turn; the
timeline's refuel budget and `couldCollectPotion` tier ceiling both
under-approximate, which is the forbidden direction.

The repair falls out of the trace design: item boards are public and
truthful, so the ConditioningTrace entries already carry per-turn boards —
the premise becomes TIME-INDEXED, and the dilation step at turn k reads the
turn-k item boards instead of the freeze-turn ones. Conservative compaction
(union of food boards over the hold; union of potion boards for the ceiling)
keeps the O(1) hot path sound when entries compact. This is the only place
the vendored engine's own covenant needs amendment for cross-turn fog, and
it is an amendment the trace structure was already shaped for.

(Also the reason "item boards stay truthful" is the RECOMMENDED redaction
default: if the food board could lie — hiding an invisible unit's
consumption — the observer's item premise becomes a belief object of its own
and every refuel/tier bound inflates to the board-wide worst case. Price of
that alternative: clouds saturate several turns faster, the C1 channel dies,
and invisibility strictly dominates as a strategy. Game-design decision,
priced, owner's call.)

## 8. Second pass — the disjunctive case worked, and the two rules it forced

The clean T12 above had ONE vanish and ONE hidden unit: point collapse. The
disjunctive-support machinery (01-doc §5b) earns its keep when evidence has
several explanations. Working the cases surfaced two rules the first pass
did not state.

**Case A — two vanishes, two hidden units (K1, K2 both hidden).** Food at A
and at B both vanish at t, no visible eater ends on either. Explanations:
(K1→A, K2→B) or (K1→B, K2→A), each only if the cell is inside that unit's
front. Per-unit marginal clouds would record K1 ∈ {A,…}, K2 ∈ {A,…} — losing
the EXCLUSIVITY correlation (both-at-A is not a world). So:

**Rule 1 — scenarios span the hidden-unit set.** A hypothesis branch (box)
is a JOINT object: one conditioned cloud per hidden unit plus the shared
premise deltas, and per-unit clouds are its marginals. Zero-touch consumers
read the per-unit HULLS (union over scenarios — today's shape); box-aware
consumers iterate scenarios. Slot accounting per 09-doc §3: one unit, one
slot; a scenario is a small set of alternate fronts inside the slots it
already holds. This is the vendored engine's own extremization-trap warning
(risk.ts: "two maybes can ANNIHILATE each other… a sound extremization
quantifies jointly, never at one pinned turn") arriving at the belief layer:
correlation is not an upgrade, it is what soundness already demanded of
∀-claims, now made representable instead of hulled away.

**Case B — one hidden unit, two sequential vanishes.** Food at A vanishes at
t (only K explains it); food at B vanishes at t+1 (only K explains it).
Joint feasibility requires B inside the knight fan of A. If it is: the trace
gains two point entries and the timeline is a two-point path — better than
either observation alone. If it is NOT: conditioning on both leaves S EMPTY,
and an empty support is not a theorem that the game did something
impossible — it is proof that some ATTRIBUTION was wrong (a visible eater
mis-scored, a spawn mis-accounted, a second hidden actor the mask did not
declare). So:

**Rule 2 — the contradiction rule.** Conditioning must never leave S empty
silently. An empty intersection triggers the same quarantine policy as the
reappearance oracle (09-doc §6): unwind the WEAKEST evidence class first —
C2 non-event exclusions, then C1 inferences (attribution-based, fallible),
never C0 (direct facts) — rebuild from what survives, log the dropped
entries with the full trace, count in the mechanism report. The unwind order
is the evidence-strength order, which the trace already records per entry.
This rule is what makes the C-ladder safe to run aggressively: the cost of
an over-eager inference is a logged rebuild, not a poisoned support.
