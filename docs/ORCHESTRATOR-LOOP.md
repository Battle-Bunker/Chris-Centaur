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

## Active wave (update on every launch/merge) — 2026-09-04 ~14:00Z
Merged: 08-DEPTH-VERDICT (290dbe0): chained depth refused with the sharper reason (chainable exactly when B3 already closed the bracket); recommendation = threat/opportunity map per row now (0 settlements), then a CEILING PLY on the loud subset (~10% of budget); F-10 found (better()'s ceiling rung penalises having measured).
| worktree/branch | model | task | merge rule |
|---|---|---|---|
| simp-c (CC) | sonnet | SIMPLIFY-PLAN items 6, 7, 10, 11, 12 (mechanical parts) | byte-identical runner + suite; 11 also zero inversions |
| potion (CC) | opus | potion member v2: instrument (profitable/reckless at pickup) then the member; keep only if WHICH pickups changes | A/B potions 60t×5 seeds; potion-free boards byte-identical |
| threatmap (CC) | opus | 08 §5 steps 1–3: measure Q; threat map per row; F-10 behind G2 | step 2 byte-identical decisions; step 3 A/B vs stable v2 |
Next after threatmap: 08 §5 step 4 (B4 + ceiling ply), gated on Q.
Ping: send_later 55 min, re-armed on each firing.

## Queue, ranked (nearness-to-fruition × value × complexity deleted)
1. Simplification audit (post-cut dead code, special cases, duplicated abstractions) → Sonnet executors.
2. Lookahead: follow 08-DEPTH-VERDICT.md's recommendation (depth preconditions done; chained depth 2 does not pay at production budgets).
3. goto weight defect (docs/design/drives/01, M1) — fix on the working branch.
4. TacticToes server/frontend simplification now the engine owns the turn.
5. Entrapment with a horizon; potion member v2 (must change WHICH pickups).
6. Drives: rebase feature/drives-preferences after #17 lands.
