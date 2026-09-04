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
- TacticToes `stable/one-engine-v3` = a20c075 (plan 2 executed; 21 suites / 352 tests; frontend tsc -b + vite build clean). Older: v2 = 526ff4f, v1 after the presence/grammar fix.
- Runner recordings for A/B: `node dist/tests/local-game.js <mixed|snakes|sparse|potions> 30 <seed> --nodes --json=F`; compare with `node scripts/ab-compare.js base.jsonl new.jsonl`.
- Inversion gate, 16 arms, every one must print no `INVERSION` line: `for s in mixed snakes sparse potions; do for d in 1 2 3; do CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js $s 30 $d --nodes; done; done` and then `for d in 4 5 6 8; do CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js potions 60 $d --nodes; done` — the four potion arms run to sixty turns because the two soundness classes fixed in 6e7b7d0 (a death in the optimistic timeline read as a proof; `room`'s maximised side read off a crowd containing a held cloud) fire on seeds 5 and 8 only past turn thirty, where the twelve 30-turn arms never looked.
- Opponent baseline (`--opponent`, against a NON-mirror field — see `resolveOpponent` in local-game.ts): `node dist/tests/local-game.js sum mixed,snakes,potions 30 3 --nodes --opponent=material-only --json=vs-material-only.jsonl --label=vs-material-only`; team 0's meals/100↑deaths/100 vs the seed-1-3 mirror baseline: mixed 7.78→13.17 / 0.00→1.23, snakes 18.33→18.33 / 0.00→0.00, potions 9.96→11.02 / 0.40→1.22 — a material-only field neither seeks food (weight 0) nor avoids a contest the way the default profile does, which is why team 0 eats more and dies more against it than it does mirroring itself.

## Active wave (update on every launch/merge) — 2026-09-04 20:16Z
Merged this cycle: lens audit (8853d9b: replay drawn from the record not the live source; reservoir rows found under the cluster key nothing read; four empty states told apart; `lo`/`⌈w⌉`/Q named; dead transport seam gone; 18 findings in decision-lens/09-AUDIT.md), TacticToes plan-2 items 1–3, 5–9 (a20c075 = `stable/one-engine-v3`; item 4 left for the owner: no automated gate; E-a deferred), engine re-vendored for E-b (fe259cd), PR #24 body refreshed. Then plan-3 items 1, 7, 10 (083c1f0: 17 suites on the shared fixtures, −367/+105; full suite 94/1616 green, 0 skipped) and item 2 (fce8f47: one WriteQueue under both loggers, batch steps verbatim). Item 7 leftovers in turn-oracle.ts/staging-legality.ts/substrate.ts (healthAfterEntering, projectedHealthCost, destCoordOf, noOrderCandidate) skipped for ownership → queued. Then plan-3 items 4, 8, 5 (0bb68b2: settleInputBase/claimsAfter, perBoard hold-outs, GenerationRig; byte-identical runner all-zero after each; −165/+111). Then item 7's rest (a038c05: −49/+2). Plan 3 now has 1, 2, 3*, 4, 5, 7, 8, 10, 12* done or in flight (* in lens-2); left: 6, 11 (after b1-sound), 9 (p3-d). Then item 9 (db3b166: one consider step; all-zero runner diff). Full jest on fce8f47 under heavy contention had 3 failures (staging-safety, lobster-trio, basic-intelligence at 2290 s); the same three pass on db3b166 (65 tests): wall-clock starvation, not the write queue. Rule: never trust a full-suite result recorded while runner-heavy workers are up; re-run the failures alone. Then the behaviour audit (6bfccc3: D1 contest blind to the occupied cell = every edge death; D2 pawn orientation invisible → parking; D3 room's fear falls with length; D4 potion peril far horizons constant; D5 room saturates under a slider; D6 runner counts rotation as a move; the foodEnergy scenario gap). Bot head 6bfccc3; `stable/one-engine-lens-v3` = 90418c4.
Lessons: a dead agent cannot be resumed by SendMessage, relaunch; Sonnet stalls on background jest EVERY time the brief only says "foreground": briefs must say "never pass run_in_background, never call Monitor, never wait for a notification", resume with that line when it happens; NO `git stash` anywhere (shared across worktrees); cwd persists between Bash calls, always `cd` explicitly.
| worktree/branch | model | task | merge rule |
|---|---|---|---|
| b1-sound (CC) | opus (relaunched 18:25Z) | merge 57fd2da, exact-reply oracle as standing check; fix B1-floor-vs-exact-reply classes | seed 4 zero; sweep green; 16 arms zero; A/B per class |
| lens-2 (CC) | opus | kernel breakdown emit (BREAKDOWN panel never rendered); 7 web one-liners; arrived-frame on join; PLAN-3 items 3, 12 | tsc, eslint, build:lens, 20 lens suites, local-game-determinism |
| beh-contest (CC) | opus | D1 in contest.ts (instrument first), D6, `--food-energy` runner option | prediction holds in direction; no class worse on deaths; 16 arms zero |
| beh-potion (CC) | opus | D4 in window.ts | reckless share down, profitable-safe up on potions; no class worse; 16 arms zero |
Queued: D2 (momentum/command in features.ts), D3 and D5 (room in territory.ts) after b1-sound; PLAN-3 items 6, 11, and PLAN-2 item 7 after b1-sound and p3-c; full jest + 16 arms on the head after p3-* merge, then checkpoint v4; PR #17 body refresh after plan 3 lands; TacticToes: plan-2 item 4 (owner), a third audit only if the second's "not worth it" list changes; drives rebase after #17.
Ping: send_later 55 min, re-armed on each firing (current trig_018d2Xx6STCqxWDm67Js8SnS, fires 20:16Z).

## Queue, ranked (nearness-to-fruition × value × complexity deleted)
1. Simplification audit (post-cut dead code, special cases, duplicated abstractions) → Sonnet executors.
2. Lookahead: follow 08-DEPTH-VERDICT.md's recommendation (depth preconditions done; chained depth 2 does not pay at production budgets).
3. goto weight defect (docs/design/drives/01, M1) — fix on the working branch.
4. TacticToes server/frontend simplification now the engine owns the turn.
5. Entrapment with a horizon; potion member v2 (must change WHICH pickups).
6. Drives: rebase feature/drives-preferences after #17 lands.
