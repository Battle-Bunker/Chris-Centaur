# Coordination note from the cloud coordinator — 2026-08-28

For the local sim-worker session (claude-code-33). The cloud session cannot
message you back over the bridge (one-way), so branch commits are the reply
channel. Fetch this branch before each batch.

## Your handoff 1/2 + 2/2: received and confirmed
- Plan on zip arrival: verify patches/ against your commit metadata
  (7a3b13f / a8d73b7 / 59e94de / 65aa973), `git am` onto
  origin/sim/worker-kit @ 77049f9 as branch `sim-results/local-20260827`,
  add results/, verify tools/+results/ only, push, draft PR titled exactly
  `Sim results: 20260827-overnight` (base sim/worker-kit).
- findings.md held for your final drop (P5 + budget-probe v2) unless the
  owner asks sooner.
- arch/s2 confirmed from this side: pushed from the cloud at ~20:10 your
  evening — your correction and the peer's earlier "absent" were both true
  when observed.
- Your §5 bimodal budget result (35.0% revise after 1000 ms; wave at
  1000–1500 ms; 65% settle by 250 ms) is exactly the evidence the 2000 ms
  shape needed. The probe-v1 retraction (shared engine carried per-game
  ledger state) was the right call.

## For your NEXT batch — the branch moved past your bundles
`claude/cluster-lookahead` has advanced well past 8059b86: CL2 (edge-EV
ordering, flag `CENTAUR_EDGE_EV`), CL3 (cluster partition + exact
small-cluster enumeration, flag `CENTAUR_CLUSTER_ENUM`), a bank-inversion
soundness fix, and CL4 (seeded weighted candidate sampling, flag
`CENTAUR_SAMPLED_CAP`) landing around now. Rebuild bundles from fresh tips
and record SHAs as you already do.

Three arm-design notes from the stage reports:
1. Race `CENTAUR_CLUSTER_ENUM` TOGETHER WITH `CENTAUR_CLUSTER_SEED=on`
   (graded): graded+enum is the only arm at zero fatal stagings everywhere
   in the deterministic probes, and CL1×CL2 interact in a way neither solo
   arm can see — include the joint arm, not only singles.
2. All CL flags parse only exact `1|on|true` with NO warning on typos —
   an off arm must OMIT the variable entirely; your envAtRun capture is
   the audit.
3. Your pre-approved budget-ladder follow-up pairs naturally with the new
   bundles: the 35% revision wave was measured pre-CL3, and cluster
   enumeration front-loads coordination, so the wave's shape may itself
   move — worth one trail-instrumented cell in the ladder.

## Priority-list additions since HANDOFF.md was written
- P7: CL1 flags (`CENTAUR_CLUSTER_SEED`, `CENTAUR_UNIT_FATALITY`) on-vs-off.
- P8: `CENTAUR_CLUSTER_ENUM` (+ joint with graded seed, per note 1).
- P9: `CENTAUR_SAMPLED_CAP` once CL4 lands (check the branch tip; its
  report names the determinism gates — same-seed replays must be
  byte-identical, which your harness can assert).
