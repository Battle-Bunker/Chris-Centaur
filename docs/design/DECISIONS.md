# Decisions — the orchestrator's rulings, in date order

Wording is pulled from the cited docs; nothing here is invented. Evidence is
cited by file. Read `SUCCESSION.md` and `docs/ORCHESTRATOR-LOOP.md` for the
standing orders these rulings operate under.

**2026-09-02 — the horizon stays at 1; `DEFAULT_SWITCH_MARGIN` is the fix
that mattered most.** `docs/BASIC-INTELLIGENCE.md`: "a horizon-1 decision
with an evaluator that can see food and can see a piece's activity is a sane
bot, and it is a stable one." Margin dropped 5 → 0.01: "no positional fact
was ever worth restaging, and the bot played `seedPlan`'s first pick until
half a unit of material changed hands."

**2026-09-02 — the one-engine plan is accepted.** `docs/design/ONE-ENGINE-PLAN.md`
states the end state as one paragraph: `engine/` holds the whole turn and
"nothing else in either repo computes a legal move, a contest, a path, a
tier, a promotion, a food pickup, an exhaustion or a winner." SUCCESSION
confirms landing: "The bot has NO rules mirror... One seam:
`src/lobster/substrate.ts`."

**2026-09-03 (first attempt) — entrapment as a new member is refused.**
`docs/design/entrapment.md` §1: measured at the mandated 30 turns, `snakes`
deaths went "5 → **8**", so "it was recorded and not seated." Verdict:
"Entrapment is not a missing member. It is `room` measuring the wrong
quantity."

**2026-09-03 — standing orders: worktrees, checkpoints, self-play as the
sanity gate.** `docs/ORCHESTRATOR-LOOP.md`: "use self-play... as the sanity
gate for every architectural change against the stable baseline, but do NOT
over-optimise against it (it lacks strategy diversity)."

**(same wave) — `entrapment.md`'s repair is taken.** "Kept. The predictions
hold in direction on every board class: `snakes` deaths fall at both
horizons with the mechanism ratio falling with them... Deleted with it:
`crowdCertain` and `roomSum`." (§9.5) Not to re-derive: "A snake cannot trap
itself. Its own body vacates one cell per turn."

**2026-09-04 — `b1-sound`'s per-feature law-sweep repairs are declined.**
`docs/design/ab/2026-09-04-b1-sound-vs-57fd2da.md`: "Deaths are up on three
of four board classes and down on none... The repairs were sound and they
were also, on the evidence, unnecessary: the exact-reply oracle settles
44,859,582 concrete worlds... and finds the whole-plan bracket ALREADY EXACT
on every one of them, both before and after." What was taken instead: "the
instruments — the exact-reply oracle, its classifier, the sixteen-arm gate
and the per-feature law sweep."

**2026-09-04 — the ceiling ply (B4) is built, sound, and refused as
inert.** `docs/design/decision-lens/08-DEPTH-VERDICT.md` §7: "the ply is
sound but never tightens — holding everything is looser than the concrete
leaf 31/31 times... Shipped inert behind `b4:false`, which the standing
rules forbid, so it is not merged." Governing findings: **D-2**,
chainability is exactness — "There is no board on which a chained ply is
both sound and worth taking"; **D-1**, inverse selection — "the reply
product is simultaneously the cost of a chained ply and the inverse of its
value."

**2026-09-04 — the 485-inversion report on `origin/ceiling` does not
reproduce.** §7.1: "432,148 checks over 44,859,582 concrete worlds: ZERO
floors above a real reply and ZERO ceilings below a complete reply space."

**2026-09-0X (dated by dependency: after contest-gap.md, before
WEIGHT-SWEEP.md) — class A is accepted as the price of a crowded board.**
`docs/design/contest-classA.md` §4: "No rule. The gradient exists, it is
statistically unambiguous, and it cannot be spent: at `σ < 2.33` it moves 2
of 19 entry decisions... Shipping it would spend the whole
cliff-certificate budget the class-B σ rule needs, for two decisions in
fourteen games." The one gradient that discriminates at all (`π`, two-ply
pressure, p = 0.0004) is refused because the deciding margin is a "0.16
TERRITORY gap," not a contest one.

**(same wave) — the weight table is a local minimum; nothing from the
sweep is kept.** `docs/design/WEIGHT-SWEEP.md` §3: "No arm reaches the first
clause. Deaths fall on ZERO classes for every arm... nothing is kept.
`calibration.ts` is unchanged on this branch." §5: "The head's weights are a
local minimum in deaths along every direction swept."

**2026-09-05 09:00Z — D1's honest floor is taken over its own meals
budget.** `docs/design/BEHAVIOUR-AUDIT.md`, D1 third attempt: "The repair
ships... It is taken over this attempt's own 3% meals budget, deliberately:
deaths fall on both board classes that have any... A soundness fix that also
kills fewer of our own units outranks a 4.1% meal dip on one of four
classes." Closes `contest.lo` 30 → 0 (`decision-lens/08-DEPTH-VERDICT.md`
§7.1). D1's ordering half (`ε` dosing) is left out: "Neither `ε` arm is
taken."

**2026-09-05 09:00Z — D2 is held for a dose sweep, then refused.**
`docs/design/BEHAVIOUR-AUDIT.md`: "BUILT, SWEPT AT THREE DOSES, NOT TAKEN —
it unparks the pawn by killing it... it is refused anyway, because the
owner's rule is to err conservative and this trades tempo for self-inflicted
deaths."

**2026-09-05 — F2 (`bounds/bank.ts`'s peril probe) is declined as a
tightening; F3 is free and taken.** `docs/design/ab/2026-09-05-bank-f23-vs-0be83a4.md`:
"F2's repair was MEASURED AND DECLINED — a tightening, not a soundness
repair, that costs contest deaths on `mixed`." F3 (the entanglement gate,
`docs/design/REVIEW-1.md`): "FIXED, and FREE."

**2026-09-05 — P1, P2, P3 are each built exactly as designed and refused.**
P1 (`BEHAVIOUR-AUDIT-2.md`, pawn immobility indicator): "INSTRUMENTED, BUILT
EXACTLY AS WRITTEN, NOT TAKEN — it unparks the pawn and the pawn is then
killed in the open... Every death it ADDS is a `contest`." P2
(`potions.md` "P2", peril as a share of ground): "the charge is common to
both sides of the comparison, so it cannot re-sort it." P3 (`potions.md`
"P3", ground read from the plan's cell): "BUILT, MEASURED, REVERTED... The
plan-conditioned ground collapses horizon 1 to a BOOLEAN."

**2026-09-05 — the potion member is closed.** `docs/design/potion-shape.md`:
"the recommendation stands unchanged and is now the finding rather than the
fallback: leave the potion member alone until the game changes. Five shapes
have been measured... and all five moved the count and left the composition
flat." `docs/design/potions.md` corroborates: every attempt is BUILT and
MEASURED, none is in the tree.

**2026-09-05 13:00Z — the owner reframes the programme into three
dimensions; the 26-game corpus is declared at its floor.**
`docs/ORCHESTRATOR-LOOP.md`: "The behaviour programme on the 26-game corpus
is at its floor (see the tally); new intelligence work must come from new
dimensions: more board, opponent diversity, outcome-based (win/draw/loss)
measurement, budget allocation, endgame, soundness classes that are free in
play, search efficiency." OPERATOR UX of the Centaur interface is made a
standing third of orchestrator attention.

**2026-09-05 13:10Z — nine-agent wave launched against the new dimensions**
(`docs/ORCHESTRATOR-LOOP.md` active-wave table): perf, ratchet-2, UX IA, UX
latency, wide corpus, opponent diversity, budget allocation, endgame.

---

## Process lessons (SUCCESSION.md, verbatim where quoted)

- **Never `git stash` in a worktree.**
- **Every worker checkpoints and pushes after each step** — "container
  restarts and the hourly session rate limit kill all workers at once."
- **A dead agent cannot be resumed by message; relaunch from its branch.**
  Sonnet briefs must forbid `run_in_background`/Monitor/waiting on a
  notification. A full-suite result recorded under runner-heavy workers is
  not evidence; re-run failures alone.
- **A behaviour change is kept only if it is at least as good as the
  baseline on every board class at full length, deaths first**; a 30-turn
  arm is a truncation, not a class — the rule that refused `b1-sound` and F2.
- **A refuted rule earns a paragraph beside the code, not a scaffold**: no
  fixture tests, unused builders or diagnostics for a rule that was reverted.
- **After a selective merge, read `git diff --stat HEAD~1 HEAD` before
  pushing; read `date -u` before judging a ping late.**
- **Never resume a completed agent** — "cold transcript re-read at full
  price — one wave of nine cost $60"; successors are new agents briefed
  from branch docs. **Report per board class, never pooled** — "measured
  sign-flips cancel on pooling." **No feature flags** — members are
  seated/selectable/validated/merged; rejected code is deleted.
