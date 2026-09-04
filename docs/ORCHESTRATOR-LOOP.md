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
- Chris-Centaur `stable/one-engine-lens-v3` = 90418c4 (green: 94 suites / 1616 tests, 0 inversions on 16 arms, A/B vs v2 no class worse: docs/design/ab/2026-09-04-head-vs-v2.md). Older: v2 = 439bec4, v1 = 514e1c6.
- TacticToes `stable/one-engine-v2` = 526ff4f (21 suites / 352 tests). Older: v1 after the presence/grammar fix.
- Runner recordings for A/B: `node dist/tests/local-game.js <mixed|snakes|sparse|potions> 30 <seed> --nodes --json=F`; compare with `node scripts/ab-compare.js base.jsonl new.jsonl`.
- Exact-reply gate, the SAME 16 arms, every one must print `floorViolations=0 ceilingViolations=0` on its `EXACT-REPLY` line: `for s in mixed snakes sparse potions; do for d in 1 2 3; do CENTAUR_EXACT_CHECK=10 CENTAUR_EXACT_CAP=256 node dist/tests/local-game.js $s 30 $d --nodes 2>&1 >/dev/null | grep EXACT-REPLY; done; done` then `for d in 4 5 6 8; do CENTAUR_EXACT_CHECK=10 CENTAUR_EXACT_CAP=256 node dist/tests/local-game.js potions 60 $d --nodes 2>&1 >/dev/null | grep EXACT-REPLY; done` — this is the gate the inversion counter below CANNOT be. That one compares the bank's members against each other, so a floor that is wrong on every rung at once passes it with the bracket the right way up; this one enumerates the held units' complete option lists through the vendored `settleTurn`, settles each CONCRETE world, and asserts the point value of every one of them is at or above the published floor (`bounds/exact-reply.ts`). On `574d475`: 432 148 checks over 44 859 582 worlds, zero both sides.
- Inversion gate, 16 arms, every one must print no `INVERSION` line: `for s in mixed snakes sparse potions; do for d in 1 2 3; do CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js $s 30 $d --nodes; done; done` and then `for d in 4 5 6 8; do CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js potions 60 $d --nodes; done` — the four potion arms run to sixty turns because the two soundness classes fixed in 6e7b7d0 (a death in the optimistic timeline read as a proof; `room`'s maximised side read off a crowd containing a held cloud) fire on seeds 5 and 8 only past turn thirty, where the twelve 30-turn arms never looked.
- Opponent baseline (`--opponent`, against a NON-mirror field — see `resolveOpponent` in local-game.ts): `node dist/tests/local-game.js sum mixed,snakes,potions 30 3 --nodes --opponent=material-only --json=vs-material-only.jsonl --label=vs-material-only`; team 0's meals/100↑deaths/100 vs the seed-1-3 mirror baseline: mixed 7.78→13.17 / 0.00→1.23, snakes 18.33→18.33 / 0.00→0.00, potions 9.96→11.02 / 0.40→1.22 — a material-only field neither seeks food (weight 0) nor avoids a contest the way the default profile does, which is why team 0 eats more and dies more against it than it does mirroring itself.

## Active wave (update on every launch/merge) — 2026-09-04 18:26Z
Merged: SIMPLIFY-PLAN-3 (aef112a; 12 Sonnet items, net −660; items 3, 12 wait for lens-audit; 6, 11, 9 wait for b1-sound), entrap (d4c0886), the A/B record (90418c4 = `stable/one-engine-lens-v3`), TacticToes plan-2 items 1, 5, 9a/b/d/e (fbcf8cd; 9c skipped: teamOf is private to the processor, folds into item 6/7 territory), TacticToes SIMPLIFY-PLAN-2 (602b4d8; headline: one adjudication mirror left in frontend GameFinished.tsx, wrong on mutual wipe; −493 lines across items 1–9; E-a deferred, it needs a ruling on whether a new engine export widens the vendored surface — orchestrator's ruling: defer, −8 lines is not worth the debate; item 4 has no automated gate, left for the owner).
b1-sound: died on a 429 at 16:44Z; WIP recovered as f3a5474; the SendMessage resume never took (no activity after 16:44Z), so a fresh Opus agent was launched at 18:25Z from f3a5474 with the full brief. Lesson: a dead agent cannot be resumed by message; relaunch. Stashes are shared across worktrees: NO `git stash` in any brief.
| worktree/branch | model | task | merge rule |
|---|---|---|---|
| b1-sound (CC) | opus (relaunched 18:25Z) | merge 57fd2da, then the exact-reply oracle as standing check; fix B1-floor-vs-exact-reply classes | seed 4 zero; sweep green; 16 arms zero; A/B per class |
| p3-a (CC) | sonnet | PLAN-3 items 1, 7, 10 (tests harness round 2, dead exports, snake registration) | touched suites, tsc, eslint |
| p3-b (CC) | sonnet | PLAN-3 item 2 (one write queue; FK-ordering trap) | write-path suites, full jest |
| p3-c (CC) | sonnet | PLAN-3 items 4, 8, 5 (claims input, perBoard hold-outs, generation rig) | byte-identical runner between items; soundness sweep; named suites |
| lens-audit (CC) | opus | lens UI audit (09-AUDIT.md) + fixes in src/lens/**, src/web/lens-view.js | tsc, eslint, build:lens, lens suites, parity + determinism green |
| tt-exec-2 (TT) | sonnet | TT plan-2 items 2, 3, 6, 7, 8 in order | functions suite green after each; no golden re-recorded |
Queued: PLAN-3 items 3, 12 after lens-audit; PLAN-3 items 6, 11, 9 and PLAN-2 item 7 after b1-sound; TT PR #24 body refresh after tt-exec-* merge; TT checkpoint v3 then; drives rebase after #17.
Ping: send_later 55 min, re-armed on each firing (current trig_01NugWRxyFQBFkZWj5rAKKP6, fires 19:20Z).

## Queue, ranked (nearness-to-fruition × value × complexity deleted)
1. Simplification audit (post-cut dead code, special cases, duplicated abstractions) → Sonnet executors.
2. Lookahead: follow 08-DEPTH-VERDICT.md's recommendation (depth preconditions done; chained depth 2 does not pay at production budgets).
3. goto weight defect (docs/design/drives/01, M1) — fix on the working branch.
4. TacticToes server/frontend simplification now the engine owns the turn.
5. Entrapment with a horizon; potion member v2 (must change WHICH pickups).
6. Drives: rebase feature/drives-preferences after #17 lands.
