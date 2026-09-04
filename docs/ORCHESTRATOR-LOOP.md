# ORCHESTRATOR LOOP — living state (rewrite every cycle; this file survives compaction)

Standing orders (owner, 2026-09-03): work indefinitely; up to 8 subagents (Opus for
judgement, Sonnet for precisely-specified mechanical work); subagents report ONCE, briefly,
at the end, never mid-work; orchestrator reads minimally; checkpoint stable bot-design
states as `stable/*` branches on both repos; use self-play (deterministic runner +
`scripts/ab-compare.js`, per board class, never pooled) as the sanity gate for every
architectural change against the stable baseline, but do NOT over-optimise against it
(it lacks strategy diversity); pursue any factoring that deletes special cases in favour
of parameterised powerful abstractions; a recurring 55-minute ping keeps the cache warm;
nothing goes to `develop`/`main` directly (PRs #17 Chris-Centaur, #24 TacticToes).

## Baselines
- Chris-Centaur `stable/one-engine-lens-v1` = 514e1c6 (green: 92 suites, 0 inversions).
- TacticToes `stable/one-engine-v1` = the branch head after the presence/grammar fix.
- Runner recordings for A/B: `node dist/tests/local-game.js <mixed|snakes|sparse|potions> 30 <seed> --nodes --json=F`; compare with `node scripts/ab-compare.js base.jsonl new.jsonl`.

## Active wave (update on every launch/merge) — 2026-09-04 ~12:20Z
Merged this cycle: goto fix (c1a3e2c); bot SIMPLIFY items 3,4,8,9,2m (348988c) and 1,5,13 (c3928e3); TT SIMPLIFY items 1-9 (pushed on the TT branch). Head c3928e3; full suite re-run pending on the merged head.
| worktree/branch | model | task | merge rule |
|---|---|---|---|
| depth (CC) | opus | F-1..F-9 depth preconditions, then depth 2 for piece clusters, gated | merge preconditions; engagement only if A/B not worse per board class |
| (TT checkout) | opus | TT SIMPLIFY judgement items 10, 12 (+ a gate for 11 if cheap) | goldens unchanged + suite green |
Deferred until depth lands (same files): bot items 10 (board memo), 11 (bank sweep), 12 (contracts hub), 6 (decision rig), 7 (tier-freeze).
Watch: the executors' net line deltas were near zero on candidates/evaluate (+200/−179) — helpers added; judge the NEXT audit on special cases removed, not lines.
Ping: send_later 55 min, re-armed on each firing.

## Queue, ranked (nearness-to-fruition × value × complexity deleted)
1. Simplification audit (post-cut dead code, special cases, duplicated abstractions) → Sonnet executors.
2. Depth preconditions F-1..F-9 (docs/design/decision-lens/06-LOOKAHEAD.md), then depth on for pieces, gated.
3. goto weight defect (docs/design/drives/01, M1) — fix on the working branch.
4. TacticToes server/frontend simplification now the engine owns the turn.
5. Entrapment with a horizon; potion member v2 (must change WHICH pickups).
6. Drives: rebase feature/drives-preferences after #17 lands.
