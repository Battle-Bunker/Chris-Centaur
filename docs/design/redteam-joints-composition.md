# Red team: the COMPOSITION carve under determinations/quanta reality

Adversarial pass on `design/joints-composition` (07-SYNTHESIS.md, with 01,
04, 05 read so as not to strawman what later cycles already fixed). Assigned
by the coordinator under the extended mandate. Verdict up front: the
fibration, the three-operation algebra, and the generation-from-manifest
discipline hold under the time lens — cycles 4–5 absorbed ADVANCE and the
anticipatory meet correctly. Six places break or bend, ordered by severity.

---

## BREAK 1 — ECONOMY's composition law has no home for OBLIGATION policy, and it forecloses an owner decision

The kind law: ECONOMY = "one policy; sub-budgets partition purchasable
meets". That is an ALLOCATION law. Under determinations/quanta there is a
second, distinct policy family that partitions nothing: **reaction
obligations** — how fast which determination must reach the wire
(conform-now / next-tranche / next-commitment), the write rate limit, the
final-flush reserve, the operator-latency cap on tranche size. These do not
choose which meets are bought; they constrain the ORDERING between
determinations and emissions.

The inventory (02 §1 row 11) classes the emit barrier as "kernel constraint
(not a member)" — and that classification is exactly wrong for one live
case: the owner's still-open dial-latency question ("next turn or next
slice?") IS a member choice on the reaction table. A carve that classes
reaction policy as non-member makes the owner's pending decision
unrepresentable in config; a carve that stuffs it into ECONOMY leaves it
composed under a law ("partition sub-budgets") that does not describe it.

Fix (small): ECONOMY declares TWO laws — allocation (partition of quanta
across purchasable + anticipatory meets) and obligation (a reaction table:
determination source → latency class, with "humans always win" a
kernel-pinned row and the rest member-choosable). Or a sixth kind; the
two-law form is cheaper and keeps the count at five.

## BREAK 2 — Totality is static; `Choice` has no transport law

"A bot is a total map from joints to choices" is totality AT AN INSTANT.
Under ADVANCE, every choice must also say what transport does to it, and
`Choice = fixed | composed | conditional | priced` does not:

- a `conditional` choice's predicate reads board facts — re-evaluated at
  the new root, or latched? Nothing says. A latched conditional is the
  arena-latch class wearing config clothes.
- a `priced` choice froze a price under turn-N cost conditions; at N+1 the
  price is stale and nothing marks it. (05's `Carried` has lifetimes — but
  `Carried` is a premise object, not a `Choice`; the config layer itself
  has no `born`/`lifetime`.)

Fix: every `Choice` kind carries a transport declaration
(`invariant | re-evaluate | expires`), which is just the declared read-set
requirement (their own B2 deliverable) applied to configuration: a choice
whose predicate cites world coords is invalidated by `observe`/`advance`
like any other store. Without this, B5's carried-premise map will
accumulate un-transportable choices and the smuggling class returns through
the config door.

## BREAK 3 — Calibration state is a third coordinate class, and ruling 49 makes the gap urgent

04 §3 splits coordinates into DECLARED (inputs, hashed, equal-for-a-pair)
and OBSERVED (outputs, recorded, comparable-for-a-pair). There is a third
class both miss: **measured-and-behavior-affecting** — `stepCostMs` carried
across turns, the slice-cost EWMA, and (in the time carve) the exchange
rate's quanta-per-ms fit. These are observed values that become inputs:
they change grant sizes, which changes behavior. They are not declared (not
equal across a pair by construction), and calling them observed hides that
they feed back.

Ruling 49 now forces the split this class was hiding:

- **Online calibration** (per-game, mechanical, resets at game start,
  turn-stamped, replayable from the allowance ledger) is legitimate
  worldline state — the anti-latch law bounds it, and REPLAYABILITY is its
  license: same ledger, same fit trajectory, same behavior.
- **Offline fitted constants** (cross-game fits — msPerResolution's owed
  re-fit, weight tables, any bot-vs-bot-derived number) are exactly what
  ruling 49 names as distortion-prone: they enter ONLY as members whose
  params carry fit provenance (corpus id, fit window, lineage) as premise
  coordinates — addressable, diffable, never a hardcoded commitment.

Without the class: either the fit lives inside `botId` (address churn
every turn — kills addressing) or it lives nowhere (an untagged behavior
input — the disease itself). The B2 falsifier ("generated stamp reproduces
BotStamp field-for-field") cannot catch this, because BotStamp never
carried calibration state either.

## BREAK 4 — REDUCTION's "exactly one" collides with ruling 13 at the ponder-targeting site

B7 binds one `(weight-supplier, ε)` read by EVERY reduction site. Ruling 13
pins the ponder/hypothesis-targeting site to worst-case-derived targets
(witnesses, cover-counting) REGARDLESS of the bot's ε — no learned weight
may steer inter-turn compute until the owner opens the D2 socket. So one
global binding either (a) leaks a learned supplier into ponder targeting
the day one exists — a ruling violation by construction — or (b) forces the
whole bot to the supplier ponder is allowed, deleting the joint everywhere
else. "Exactly one" needs to be "exactly one PER REDUCTION SITE-CLASS,
with a per-site constraint column, and some sites kernel-pinned" (staging's
sound rung is pinned to the quantifier; ponder targeting pinned to
W0–W2 until the socket ruling; the est rung free). The site table exists in
their 06 sketch; the constraint column does not.

## BREAK 5 — B5's falsifier is miscalibrated and would kill a healthy mechanism

The falsifier: "instrument how often a decision's ⟨board, premise⟩ address
recurs within a game under live operator play; near-zero recurrence kills
the map half." Two populations are conflated:

- WITHIN-TURN recurrence (human pin oscillation): exact-address re-entry is
  the design's cheap win, recurrence plausibly high — a fair test.
- CROSS-TURN recurrence: exact recurrence is expected ≈ zero BY DESIGN —
  the board advances, spawns land, and rebase-transfer DILEMMA 2 says in as
  many words that low carry-utilization is the honest mechanism refusing to
  lie, with value concentrated in partial premise survival and
  attention transfer, not address identity.

As stated, the falsifier reads the second population and deletes a healthy
map. Split it: within-turn re-entry rate gates the oscillation half;
cross-turn value gates on DECISIONS CHANGED (carryEffectRate,
time-to-refutation at N+1), never on recurrence. This is the exact
mistake-class the owner was pre-warned about (DILEMMA 2: "judge it on
decisions changed, not on percent carried") — the composition lens's own
falsifier walked into it.

## BREAK 6 (minor) — Law R needs its runtime twin

"Nothing unreachable may exist" is config-space reachability. Under the
quanta economy there is a second death: a member reachable from a roster
bot whose market weight is zero under every shipped policy never earns a
tranche — an unplayed heuristic at runtime, the same disease Law R exists
to kill, invisible to CI's closure check. The ledger already carries the
counter-evidence (phase/hypothesis grant rows); the law should read:
reachable in config AND engaged in the ledger of at least one validated
run, or seated/deleted. (Their own manifest-rot risk note gestures here;
make it a law, not a gesture.)

---

## Where the carve HOLDS under time pressure (so the merge argument is fair)

- ADVANCE and the two purchase columns are absorbed correctly and stated
  more cleanly than my own first draft (05 §3's "conditioning without
  evidence" identification is the right foundation for hypotheses).
- B4 (`settleTurn` with the spawner injected) strengthens the time carve
  materially: it shrinks replay-re-base's copied game-state half to spawn
  cells alone, and turns most of my checksum's blind spots into replayed,
  checkable phases. Adopt as a dependency of feature/replay-rebase.
- The generation-from-manifest discipline is exactly what the allowance
  ledger's schema needs (grant rows as generated columns, refuse-unknown
  in the miner) — B2 and my increment 2 should be built as one increment.
- Finding 14 (no production binding site for `bot`) is a prerequisite for
  any of my per-game worldline state reaching production; adopted into my
  build-order preamble.
