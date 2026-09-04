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

## Active wave (update on every launch/merge) — 2026-09-04 ~15:40Z
Merged: potion member v2 (ef47035; kept on its numbers). Finding: the potion board at 60 turns / seeds 1–10 has ~875 bound inversions the twelve-arm gate never saw → soundness worker launched; the gate is being extended.
| worktree/branch | model | task | merge rule |
|---|---|---|---|
| threatmap (CC) | opus | 08 §5 steps 1–3: measure Q; threat map per row; F-10 behind G2 | step 2 byte-identical decisions; step 3 A/B vs stable v2 |
| potion-sound (CC) | opus | potion-board inversions (60t, seeds 1–10): classes, minimal boards, fixes; extend the standing gate | zero inversions on the extended arms; A/B reported |
Queued: runner `--opponent=<profile>` (Sonnet; after potion-sound, it owns local-game.ts); 08 §5 step 4 (ceiling ply) gated on Q; second simplification audit after the threat map; entrapment with the ceiling-ply horizon.
Ping: send_later 55 min, re-armed on each firing.

## Queue, ranked (nearness-to-fruition × value × complexity deleted)
1. Simplification audit (post-cut dead code, special cases, duplicated abstractions) → Sonnet executors.
2. Lookahead: follow 08-DEPTH-VERDICT.md's recommendation (depth preconditions done; chained depth 2 does not pay at production budgets).
3. goto weight defect (docs/design/drives/01, M1) — fix on the working branch.
4. TacticToes server/frontend simplification now the engine owns the turn.
5. Entrapment with a horizon; potion member v2 (must change WHICH pickups).
6. Drives: rebase feature/drives-preferences after #17 lands.
