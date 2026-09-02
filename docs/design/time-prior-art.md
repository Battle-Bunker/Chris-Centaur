# Prior art — what experts built, checked against the time carve

Extended-mandate research pass (ruling 50). Four fields read; each section
ends with the AMENDMENTS it forces on this branch's design, marked
SUPERSEDES where they change something already written. Sources are cited
by name/URL; code was read via fetched files.

---

## 1. Chess and Go engines: time management and ponder

**Sources.** chessprogramming.org (Pondering; Time Management); Stockfish
`src/timeman.cpp` (master, fetched); AlphaGo Zero tree-reuse as implemented
in leela-zero PR #315; KataGo `search.cpp` root-change behavior (issue
#929) and the persistent-MCTS PR #1211.

**What they built.**

- **Two ponder modes, both standard.** (a) *Predicted-move* (chess): make
  the PV's predicted reply and search the resulting position; a PONDER HIT
  (~50% per Hyatt) continues the search with the time already invested — a
  binary outcome. (b) *Consider-all* (the AlphaZero family): keep searching
  the CURRENT root during opponent time; whichever child the opponent plays
  becomes the new root and its subtree is retained "along with all its
  statistics" — survival is GRADED, proportional to the visit mass the
  played move attracted. Hybrid/optimistic multi-line pondering exists for
  clusters (Himstedt, GridChess).
- **Stockfish `nodestime`** is a shipped allowance ledger: at game start
  `availableNodes = npmsec × time`; elapsed is measured in NODES, deducted
  per search (`advance_nodes_time`); used for reproducible time controls.
  Their comment carries the safety direction verbatim: *"to avoid time
  losses, the given npmsec must be much lower than the real engine speed"* —
  over-estimate the quantum's cost, spend less wall, never more.
- **Soft/hard bounds**: `optimumTime` (checked at iteration boundaries)
  vs `maximumTime` (checked "every set amount of nodes") — wall reads
  gated to node-count multiples even in wall mode.
- **Ponder feeds back into budget**: `if (Ponder) optimumTime += 1/4` —
  when thinking on opponent time is possible, per-move allocation is
  raised, because expected carried work subsidizes the move.
- **Instability extends time**: best-move changes across iterations, score
  swings, and subtree-share of the best move all extend the soft bound.
- **KataGo on root advance** re-computes every retained node's stats when
  the utility recenters (dynamic score center) — retained statistics are
  re-denominated, not trusted, when the OBJECTIVE moves. The persistent-
  MCTS PR stores "persistent primitive facts tagged with the root key that
  generated them" and treats aggregate stats as "a materialized cache…
  rebuilt from only the current root's tagged primitives".

**Amendments forced.**

- **A1.1 — value transport refined (SUPERSEDES the blanket "values never
  cross").** The AlphaZero family transports full subtree statistics across
  the turn boundary soundly because interior states are EXACT and the
  objective is unchanged; KataGo shows the two failure axes handled
  separately (objective moved → re-denominate; state inexact → doesn't
  arise for them). Our law refines to: *a value crosses ADVANCE iff its
  premise is point-exact at the new frontier (an exactly-matched full-joint
  hypothesis, ply-1-resolved), its evalVersion is unchanged, and none of
  its citations name a spawn-patched cell; everything else carries
  attention only and re-walks.* Rebase-transfer's three reasons values
  cannot cross (clouds, advisory ceilings, I7/I8 residue) are reasons about
  INEXACT premises — they scope the rule, they are not the rule. Practical
  content: a promoted ponder hypothesis's ply-1 value store transfers
  bounded and citation-checked; its deeper plies (clouds resume) re-walk as
  designed.
- **A1.2 — both ponder modes are market rows, and consider-all is the
  default-shaped one for this game.** Chess gets 50% hits predicting ONE
  opponent's single reply; our reply space is a 2-team joint product, so
  exact-hit mass is structurally lower and graded survival (breadth over
  the cloud / current-root work) should carry the floor, with
  predicted-line rows (witness replies) as the deep-value upside. This
  gives the interruption doc's §5.2 ordering an external anchor.
- **A1.3 — grant policy may anticipate carried quanta** (Stockfish's +25%):
  a config row on the agent — raise per-turn refine grants when the window
  policy is on and match telemetry shows carried work arriving. Also its
  converse, already in rebase-transfer: never RELY on the subsidy (the
  reserve floor stays).
- **A1.4 — instability-extended grants**: the StickyStager's flip telemetry
  and the belief's leader-flip counter are exactly the engines'
  "best-move changed" signals; an extension rule (bounded by the hard
  deadline) is a legitimate ECONOMY member, and it is the anytime
  literature's monitoring result in engine clothing (§4).
- **A1.5 — the counting cut has a shipped precedent** (`nodestime`), and
  its known limitation is ours to inherit knowingly: a fixed exchange rate
  mis-fit in the unsafe direction loses on the clock, so the fitted rate
  carries a safety factor and the conservative direction is enforced, not
  hoped.

## 2. Rollback netcode (GGPO)

**Sources.** GGPO `doc/README.md` + DeveloperGuide (fetched); Gamedeveloper
write-up of Cannon's GDC material; SnapNet rollback architecture series.

**What they built.** Fully deterministic simulation + save/load +
inputs-only; remote inputs PREDICTED (repeat-last), simulation speculated
forward, prediction provenance kept per input queue; on misprediction,
rewind to last confirmed state and re-simulate silently; periodic state
checksums detect desync; a SYNC-TEST backend replays every frame twice
offline to prove the game deterministic; frame-delay remains available and
blends with rollback; "if your game uses the time of day… the time of day
at the beginning of a frame is also an input."

**Amendments forced.**

- **A2.1 — the quarantine contrast, stated as a design argument.** GGPO
  speculates the PRESENTED TRUTH, so a miss costs a rewind plus N frames of
  re-simulation inside one frame's budget — their worst case is a compute
  spike at the worst moment. The fibration quarantines speculation in
  hypothesis fibers and never lets it reach the wire, so OUR misprediction
  cost is only the compute already spent, never a rewind — the worldline
  moves forward monotonically by construction. This is the crisp answer to
  "why is there no rollback operation in a design that looks like rollback
  netcode": the wire's staging semantics (revisable until deadline) is the
  game giving us frame-delay for free at the commitment layer, and the
  fibration gives speculation without rollback at the search layer.
- **A2.2 — sync-test as a standing gate.** Add to feature/allowance-ledger:
  a harness mode that runs every decision twice from the same ledger and
  byte-compares reports (their Sync Test, our vocabulary). Cheaper and
  stricter than the cross-build identity gate for the new machinery, and
  it turns "the ledger captures all nondeterminism" from a claim into a
  tripwire.
- **A2.3 — prediction provenance is not optional.** GGPO's input queue
  records what it predicted so the rewind point is known; our hypothesis
  record (assumed determinations, verbatim) is the same object and must be
  stamped into telemetry at spend time, not reconstructed at promotion
  time.
- **A2.4 — checksum cadence.** Their periodic checksums catch drift late;
  our per-turn checksum against an authoritative doc is strictly stronger —
  worth one sentence in the replay-rebase doc, no change.

## 3. Incremental computation (Salsa, Adapton lineage, Jane Street Incremental)

**Sources.** Salsa book (overview: red-green, revisions, durability,
inputs/tracked/interned); Incremental README/tutorial (costs: "incremental
nodes are big" — 216 bytes before payload; from-scratch cost gets WORSE;
stabilize as an explicit phase; per-node cutoff; height-ordered recompute
heap); the intf docs.

**Amendments forced.**

- **A3.1 — the CUTOFF law (new, and it exposes a live defect today).**
  Invalidation must stop where recomputation yields an equal value
  (Salsa's backdating; Incremental's cutoff). Our observe() as drafted
  kills by citation intersection unconditionally. Add: where re-derivation
  is cheap, recompute-and-compare BEFORE propagating; equal ⇒ downstream
  stands. The concrete case that pays immediately: **an operator commit of
  the unit's ALREADY-STAGED destination — the single most common operator
  action, a human approving the bot's move — today sets `epochChanged`
  unconditionally (kernel.ts applyPinEvents), drops the basis, clears the
  plans table and kills the session, for a determination that removed a
  variable without contradicting anything.** Under cutoff it costs one
  equality check plus removing the unit from the variable set. This is a
  measurable increment-1 win beside the citation scoping, and no design
  document in the program has named it.
- **A3.2 — durability strata for coords (answers the fine-grain cost
  risk).** Salsa's durability: tag inputs by change frequency; skip whole
  verification swaths when no input of that durability changed. Ours:
  citations grouped by class — geometry (game-constant), positions
  (per-turn), actions (per-event), objective (per-dial) — and observe()
  walks only the touched class's index. Incremental's "nodes are big"
  warning is the reason to track at this coarse grain (class + cluster +
  unit), never per-cell; this also discharges the joints lens's premise-id
  churn risk (their §5.1 stable/volatile split is the same move; cite it).
- **A3.3 — the from-scratch warning endorses the re-base asymmetry.**
  Incrementality has overhead and loses when deltas are large. Our
  boundaries sort cleanly: commits are small deltas (incrementalize hard),
  re-base is a large delta (restart is correct; carry attention + the A1.1
  exact-premise values only). The literature thus argues FOR
  rebase-transfer's re-walk and AGAINST any temptation to board-hash
  interior caches across turns — now with an external reason.
- **A3.4 — stabilize discipline.** Determinations drain at tranche
  boundaries only (already designed); recomputation after a drain proceeds
  in dependency order (structure → values → belief → rows), which the
  height-ordered recompute heap is the industrial form of. One sentence in
  the worldline doc; no new machinery.

## 4. Anytime algorithms (Zilberstein school)

**Sources.** Zilberstein, "Using Anytime Algorithms in Intelligent
Systems" (AI Magazine 1996); Zilberstein & Russell, "Optimal composition
of real-time systems"; Zilberstein, Charpillet & Chassaing, "Real-time
problem-solving with contract algorithms" (IJCAI-99); Hansen &
Zilberstein, "Monitoring and control of anytime algorithms" (AIJ 2001);
Svegliato et al., online performance prediction (IJCAI-18).

**What the theory gives, mapped.**

- **Contract vs interruptible is exactly grant vs deadline.** A tranche is
  a CONTRACT (quanta fixed at activation, atomic inside); the commitment
  agent composes an INTERRUPTIBLE system out of contracts. The classical
  construction — run contracts in an exponentially increasing sequence —
  yields interruptibility at a small constant penalty, which is the
  theoretical license for tranche atomicity: bounded loss relative to a
  truly interruptible search, in exchange for determinism inside the
  quantum. (Today's adaptive slice growth is already schedule-shaped.)
- **A4.1 — the ponder window is the stochastic-deadline contract problem,
  solved (SUPERSEDES the red-team doc's fixed-median default).** IJCAI-99
  treats precisely our case: contracts must be sized BEFORE running,
  the deadline (opponent's commit) is unknown, optimal contract-length
  sequences exist with and without a deadline distribution. So the window
  policy's deterministic default is not "one grant sized to the fitted
  median gap" but a GEOMETRIC LADDER of grants — each harvested whole when
  the resolution lands (plies are already atomic), so any window length
  leaves completed work bounded-close to what a known window would have
  bought. With live window telemetry (which the moveStatuses listener
  supplies), the sequence tightens toward the distribution-aware optimum —
  a fitted member with provenance per ruling 49, not a constant.
- **A4.2 — monitoring has a cost, and the tranche size is the monitoring
  policy.** Hansen–Zilberstein's non-myopic stopping with costly
  monitoring is the principled frame for what the adaptive slice does by
  feel: short tranches buy responsiveness (frequent gates, fresher
  reaction) at overhead; long tranches the reverse. Their DP is overkill
  to ship, right to cite: the tranche-size policy is a monitoring-cost
  trade and should be swept as one (one axis, not two).
- **A4.3 — performance profiles are the fit-provenance objects ruling 49
  asks for.** Quality-vs-quanta curves per board class (the CPP,
  conditional performance profile) are what depthEffectRate, first-plan
  latency and carryEffectRate are point-samples of. The harness should fit
  and store CPPs as addressed members (fit corpus, window, lineage), and
  the meta-level rows (A1.4's instability extension, A4.1's ladder) read
  the CPP member — never a loose constant. Svegliato's online variant maps
  to per-game refinement of the profile, turn-stamped like stepCostMs.

---

## 5. The one-table summary (field → our object)

| theirs | ours |
|---|---|
| ponder hit / miss (chess) | hypothesis promotion / contradiction |
| consider-all ponder, subtree retained ∝ visits (AGZ) | breadth-over-cloud spend; graded premise survival |
| Stockfish `nodestime` + conservative npmsec | allowance ledger + safe-direction exchange fit |
| soft/hard time bounds; node-gated clock checks | grant vs deadline; counting cut |
| ponder ⇒ +25% optimum time | carried-quanta-aware grant policy (new row) |
| KataGo re-denomination on recenter | evaluator-version demotion |
| persistent-MCTS tagged primitives / rebuilt aggregates | ReadSet coords / caches |
| GGPO prediction provenance + rollback | hypothesis record + fiber quarantine (no rollback needed) |
| GGPO sync-test backend | ledger double-run byte-compare gate |
| Salsa durability; backdating; red-green | coord strata; cutoff law; observe() verification |
| Incremental stabilize; height order; big-node warning | tranche-boundary drain; dependency-ordered rederive; coarse-grain citations |
| contract algorithm; exponential sequencing | tranche; ponder grant ladder |
| performance profiles / CPPs | fitted members with provenance (ruling 49) |
| monitoring cost (Hansen-Zilberstein) | tranche-size policy, swept as one axis |
