# Design docs — index

One line per document. Status: **executed** (shipped), **taken** (kept after
measurement), **refuted** (built, measured, reverted — mechanism recorded),
**design** (spec, not yet acted on), **record** (mixed-finding measurement or
audit), **open** (live question), **superseded** (folded into a later doc).
Read `SUCCESSION.md` and `docs/ORCHESTRATOR-LOOP.md` first — living state,
not indexed here. `docs/design/drives/` does not exist in this worktree;
`feature/drives-preferences` carries it, parked until the seam settles on
`develop` (SUCCESSION §"What develop does NOT contain").

## Architecture and engine

- `docs/BASIC-INTELLIGENCE.md` — **executed**. The seven fixes that made the
  bot behave sanely (food gradient, momentum, slider profile, tie-key,
  margin 0.01, unconditional self-fatal correction, `checkWeights`); also
  carries `contest` and `tier` as later-seated members, the `room` repair
  summary, and the re-measured prune verdict (`guard`, not `full`, on
  snake-only boards). Do not re-derive: `DEFAULT_SWITCH_MARGIN=5` was the
  single largest cause of observed idiocy, not the four other fixes combined.
- `docs/BOT-BINDING.md` — **executed**. `botId`/`behaviourId` stamping and the
  per-(game, centaur) bot-binding resolution order; reference, not a decision.
- `docs/design/ONE-ENGINE-PLAN.md` — **executed**. The plan that deleted the
  bot's second (partial) engine and the legacy decision path in favour of one
  vendored `settleTurn`/`settlePartial` seam; SUCCESSION confirms it landed.

## Simplification plans

- `docs/design/SIMPLIFY-PLAN.md` — **executed**. Round 1, 13 items behind the
  one-engine cut; `closing.ts`, the `DepthColumn` fields and `voc.ts`'s
  confidence machinery are held on purpose (depth scaffolding) — do not
  re-flag as dead code.
- `docs/design/SIMPLIFY-PLAN-2.md` — **executed**. Round 2, 15 items; contains
  two live defects (not simplifications) still open: the snake goto re-bias
  reads a vocabulary telemetry no longer produces (weight 300 leaks through
  absent keys — this is drives' M1), and `leaderOf` vs `better()` comparing
  `est` across horizons (repaired ahead of schedule, see §5.1 in that doc).
- `docs/design/SIMPLIFY-PLAN-3.md` — **executed**. Round 3, 12 items, all
  Sonnet-executable; §3 records 18 "not worth it" candidates so they are not
  re-searched, including why the two `planKey`/`partitionOf` name-pairs and
  the two `entrapmentNeed`/`needOf` copies are deliberate, not duplicates.

## Soundness and reviews

- `docs/design/REVIEW-1.md` — **record**. Ten findings (F1–F10) plus two
  confirmed-and-fixed bugs pre-dating the list (a modelled sibling's stale
  peril cache; a horizon guard keyed on the wrong identity). F1, F3, F5, F8
  fixed and free; F4, F6, F7, F9, F10 traced and found not to be defects; **F2
  (`perilOf` computed on a board we are on) was reproduced, repaired, measured
  and DECLINED** — see `ab/2026-09-05-bank-f23-vs-0be83a4.md`. Do not
  re-derive F2's mechanism or re-propose the same fix without a per-class A/B.
- `docs/design/contest-gap.md` — **refuted** (diagnosis kept). Why moving
  pieces die in contests `contest` never priced: class A (field silent at the
  entry turn, 71% of the corpus) has no member gradient at all; the `σ ·
  standing` point-addend repair was built and measured and is NOT in the tree
  — it broke the flat state as predicted but deaths rose on both boards that
  have any. Do not re-derive: `field⁺`/`standingField` stays in the tree
  unread, as an instrument only.
- `docs/design/contest-classA.md` — **record** (verdict: accepted). Measures
  whether ANY gradient discriminates the 19 entry-turn deaths that
  `contest-gap.md` left open. One does (`π`, two-ply pressure, p = 0.0004) —
  and it is refused anyway: it can move at most 2 of 19 decisions before
  spending the whole cliff-certificate budget, because the deciding margin at
  those turns is a **0.16 TERRITORY gap**, not a contest one. **Class A is
  accepted as the price of a crowded board.** Do not re-open without new board
  diversity (twenty seeds, or more potions/units).
- `docs/design/WEIGHT-SWEEP.md` — **refuted**. Seven single-knob moves off
  `DEFAULT_WEIGHTS`, run because contest-classA.md closed the per-member road
  and the deciding margin was territory. **The head's weights are a local
  minimum in deaths along every direction swept — nothing is kept.** One arm
  (`command×0.5`) DOES turn the 0.16 class-A margin, but the pawn dies one
  turn later anyway and the arm costs +9/+3 deaths elsewhere. Do not re-derive:
  `calibration.ts` is unchanged; a global re-weighting cannot fix a
  decision that needs a term local to the entry turn.

- `docs/design/SIDE-ASYMMETRY.md` — **corpus rule**. The measurement corpus is
  not fair: in MIRROR self-play (the identical profile on both teams, so no bot
  difference is possible) slot 0 wins the five baseline classes 12/40 and slot 1
  wins 26/40, and on `mixed`/`potions` — where blue's roster carries the queen —
  slot 0 wins **0 of 16** at mean leads of −35 and −29. Swap the two teams' unit
  lists and the result swaps with them. **It is the ROSTER, not the runner and
  not the engine**: decisions are reflection-equivariant, and on hand-symmetric
  controls the slots split 0.463/0.537 over forty games. The old boards are NOT
  repaired (the whole A/B corpus is bound to their side-0 play); instead
  **every A/B and every audit runs both colours and reports them separately**
  (`--side=both`, `ab-compare.js --require-both-sides`), and there is one
  hand-symmetric control per class. No taken decision flips — the mirror
  corpora are provably slot-invariant — but every "ours" count in the
  `material-only` arms is a side-0 reading.

## Behaviour audits and rules

- `docs/design/BEHAVIOUR-AUDIT.md` — **record**. First audit (23 games). D1
  (contest can't see an enemy's own cell): three attempts, **taken** at the
  third (the honest floor over the cells an arrival could settle on, closing
  `contest.lo` 30→0) over its own 4.1% meals budget; the ordering half (`ε`
  dosing) stays out. D2 (pawn orientation invisible to the fold): **built,
  dose-swept, refuted** — it unparks pawns by walking them into bodies (piece
  body-deaths 0→3 on `mixed`). D3 (`room`'s fear shrinks as a snake grows):
  **built, measured, refuted** — the fixed-denominator repair saturates the
  term and deaths rise; **superseded** by `entrapment.md`'s full repair, as
  is D5 (`room` saturates near a slider). D4 (potion peril's far horizons
  constant): **refuted**, folded into `potions.md`. D6 (runner counts a
  rotation as a move): **executed** — `stationary`/`longestPark` now real.
- `docs/design/BEHAVIOUR-AUDIT-2.md` — **record**. Second audit, same 26
  games, re-read after D1's floor repair and the sibling-peril fix. `edge`
  deaths are 0 in 57 deaths across both audits — do not re-derive. P1 (pawn
  immobility against a wall): **built exactly as designed, refuted** — it
  unparks the pawn and the pawn then dies of `contest` in the open (a new
  mechanism, not D2's). P2 (peril reads a SHARE of ground): **refuted**,
  continued in `potions.md`. P3 (hunger denominated in the tank, not meals):
  **built, every predicted number lands, refuted anyway** on its own
  pre-registered counter — `sparse-lean` deaths 0→1 (`HUNGER_FLOOR`'s coil
  failure, transposed from a spiral to a corner). P4: recorded only,
  superseded by `entrapment.md`.
- `docs/design/potions.md` — **refuted** (member closed). Five attempts to
  make the potion member discriminate good pickups from bad — the level
  (`PERIL_WEIGHT`), the horizon weights (D4, `λ`), the share's shape (P2,
  `γ`), the ground (P3, per-plan `α`), and a fifth non-reparameterisation
  (gate + escape floor). **All five moved the pickup COUNT and left the
  composition (reckless share, profitable-and-safe share) flat.** Every
  attempt is BUILT and MEASURED, none is in the tree. Do not re-derive any of
  the five shapes; see `potion-shape.md` for why a sixth cannot work on this
  corpus.
- `docs/design/potion-shape.md` — **refuted** (member CLOSED). Measures the 35
  pickups BEFORE proposing a shape (AUC 0.924 on `peril` itself); proves the
  audit's own reckless-≤40% gate was UNREACHABLE on this corpus (ceiling
  44.4%) and that the separating quantity is a per-collector CONSTANT, not a
  per-plan one. The fifth arm reaches the decision on both named boards and is
  still the worst arm of five. **Verdict: leave the potion member alone until
  the game changes** (more seeds, more potions/units) — this is the
  standing recommendation, not a fallback.
- `docs/design/energy.md` — **taken** (member (a)–(e)), **refuted** (§(f)).
  The `energy` member (price spending against a scarcity/slack read of the
  nearest meal) is seated, weight 8, derived from clearing `momentum`'s
  idleness charge exactly; measured effect concentrated on queens (−11%
  health/turn) with a contest-death rate reading flagged honest-but-unresolved
  (10 games insufficient). §(f), "a meal is not a tank" (= audit-2's P3): the
  `HUNGER_SPAN` repair is **refuted** on the same pre-registered counter as
  the audit records it — do not re-derive.
- `docs/design/entrapment.md` — **taken**. Supersedes its own first attempt (a
  separate `entrap` member, recorded in §1, refuted — it feared a snake's own
  safe coil and cost 5→8 deaths on `snakes` at 30 turns). The shipped design
  is a REPAIR of `room` itself (not a new member): the flood must respect
  each unit's own vacating schedule, or a coiled snake reads a false trap.
  **Key finding, do not re-derive: a snake cannot trap itself** — its own
  body vacates one cell per turn, so a static own-body barrier is always a
  false alarm. Kept: `snakes` deaths fall at both 30 and 60 turns with the
  fatal/episode ratio falling too; deletes `crowdCertain` and the per-unit
  ownership planes from `territory.ts`.

## Decision lens

- `docs/design/decision-lens/01-DATA-MODEL.md`, `02-INSPECTION-UI.md`,
  `03-KERNEL-SURFACE.md` — **superseded** by `04-SYNTHESIS.md` (three
  independent lens drafts: data model, operator UI, kernel surface).
- `docs/design/decision-lens/04-SYNTHESIS.md` — **design**. Reconciles 01–03
  into one lens; resolves 33 open questions from the three independent lenses.
- `docs/design/decision-lens/05-BUILD-ORDER.md` — **executed**. The
  delete-first/fence-second/cut-third build order; SUCCESSION confirms the
  lens is built on this order.
- `docs/design/decision-lens/06-LOOKAHEAD.md` — **design**. How a depth-`h`
  reading would compose and render; states the flow fold is potential-based
  (telescoping), so depth can only change bracket width and the terminal, not
  the interior — settled in practice by `08-DEPTH-VERDICT.md`.
- `docs/design/decision-lens/07-MEASURED.md` — **record**. O1 instrumentation
  run confirming `LENS_TOPK`/`LENS_ROW_CAP`/storage budget.
- `docs/design/decision-lens/08-DEPTH-VERDICT.md` — **open** (ceiling ply) /
  **taken** (contest.lo repair, dated 2026-09-05, described in this doc's
  §7.1 addendum). **Do not re-derive: chaining a ply off a partial settlement
  is either unsound or incomparable** (Finding D-2 — chainability IS
  exactness); a chained ply is affordable exactly where B3 already closed the
  bracket and useless everywhere else (Finding D-1, inverse selection). The
  built CEILING PLY (B4) is sound but never tightens — holding beats the
  concrete leaf 31/31 times — and is **shipped inert, unmerged**. `b1-sound`'s
  two term repairs (`command.hi`, `reach.lo`) are correct-and-looser and
  **declined**: no A/B win, costs deaths on 3 of 4 classes. `contest.lo`'s
  repair (=`BEHAVIOUR-AUDIT.md` D1's third attempt) is the one class **taken**.
- `docs/design/decision-lens/09-AUDIT.md` — **executed**. Bands A/B/D and C1
  fixed on `lens-audit`/`lens-2`; C3/C4 remain open.
- `docs/design/decision-lens/10-WALKTHROUGH.md` — **record**. Browser walkthrough of the shipped lens with screenshots; feeds `ux/01-RESEARCH.md`.

## UX

- `docs/design/ux/01-RESEARCH.md` — **design**. Reads the shipped UI against
  outside literature (RTS HUDs, chess GUIs, trust calibration); the operative
  fact is the clock — `gameTimeout` defaults to 500ms and the kernel emits
  7–10 frames per turn, so the operator's whole unit of work is under 1.5s.
  Feeds the in-flight `ux-ia`/`ux-latency` waves (ORCHESTRATOR-LOOP).

## Performance

- `docs/design/PERF-1.md` — **executed**. Four key-machinery folds (plan key,
  memo composite key, ledger key, evalmemo namespace split), −16.9%/−17.6%
  µs-per-node, byte-identical play. Three further ideas (incremental key
  parts, a push/pop accumulator, a shared miss-path closure) were tried and
  reverted — all cost more than they saved. `settlePartial` (engine-vendor)
  is left alone deliberately: it is the currency, not waste.

## A/B records

- `docs/design/ab/2026-09-04-b1-sound-vs-57fd2da.md` — **refuted**. The two
  per-feature law-sweep repairs (`command.hi`, `reach.lo`) cost deaths on 3 of
  4 board classes and none of the sixteen exact-reply arms could exhibit a
  world where the looser bound was actually wrong — declined as a tightening,
  not a soundness fix.
- `docs/design/ab/2026-09-04-head-vs-v2.md` — **record**. Sanity check: HEAD
  at least as good as `stable/one-engine-lens-v2` on every board class (mirror
  self-play only; baseline predates `--opponent`).
- `docs/design/ab/2026-09-05-bank-f23-vs-0be83a4.md` — **record** (split
  verdict). F3 (entanglement gate reads `base`, not `plan`) is free and
  **taken** — byte-identical on `mixed`. F2 (peril probe narrowing) is
  **declined** — it buys meals (+1.575/100) by paying in `mixed` contest
  deaths (+1.0/game); same standing rule as `b1-sound`.
