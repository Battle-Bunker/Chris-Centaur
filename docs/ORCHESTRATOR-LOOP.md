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

## Active wave (update on every launch/merge) — launched 2026-09-04 ~09:50Z
| worktree/branch | model | task | merge rule |
|---|---|---|---|
| audit (CC) | opus | read-only simplification plan → docs/design/SIMPLIFY-PLAN.md | merge doc; spawn Sonnet executors per MECHANICAL item |
| depth (CC) | opus | F-1..F-9 depth preconditions, then depth 2 for piece clusters, gated | merge preconditions; engagement only if A/B not worse per board class |
| telemetry-rm (CC) | sonnet | delete unconsumed src/lobster/telemetry.ts and orphans | ff-merge if full suite green |
| goto-fix (CC) | sonnet | goto weight defect (drives/01 M1), minimal fix + real fixture | merge if suite green |
| (TT checkout) | opus | read-only simplification plan → TacticToes docs/SIMPLIFY-PLAN.md | merge doc; spawn Sonnet executors |
Ping: send_later 55 min, re-armed on each firing (trigger name "Orchestrator 55-minute loop ping").

## Queue, ranked (nearness-to-fruition × value × complexity deleted)
1. Simplification audit (post-cut dead code, special cases, duplicated abstractions) → Sonnet executors.
2. Depth preconditions F-1..F-9 (docs/design/decision-lens/06-LOOKAHEAD.md), then depth on for pieces, gated.
3. goto weight defect (docs/design/drives/01, M1) — fix on the working branch.
4. TacticToes server/frontend simplification now the engine owns the turn.
5. Entrapment with a horizon; potion member v2 (must change WHICH pickups).
6. Drives: rebase feature/drives-preferences after #17 lands.
