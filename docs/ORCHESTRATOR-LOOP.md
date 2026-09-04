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
- Inversion gate, 16 arms, every one must print no `INVERSION` line: `for s in mixed snakes sparse potions; do for d in 1 2 3; do CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js $s 30 $d --nodes; done; done` and then `for d in 4 5 6 8; do CENTAUR_DEBUG_INVERSION=1 node dist/tests/local-game.js potions 60 $d --nodes; done` — the four potion arms run to sixty turns because the two soundness classes fixed in 6e7b7d0 (a death in the optimistic timeline read as a proof; `room`'s maximised side read off a crowd containing a held cloud) fire on seeds 5 and 8 only past turn thirty, where the twelve 30-turn arms never looked.

## Active wave (update on every launch/merge) — 2026-09-04 ~20:00Z
Merged: potion-board soundness (295e772; gate = 16 arms); entrapment design (eba4b94). NOT merged: the ceiling ply (origin/ceiling 72f2fc6) — sound but vacuous, shipped inert; verdict recorded in 08-DEPTH-VERDICT §7. Head 1c60d8a.
| worktree/branch | model | task | merge rule |
|---|---|---|---|
| b1-sound (CC) | opus | port the exact-reply oracle from origin/ceiling (G-D3) as a standing check; fix the B1-floor-vs-exact-reply classes (485 on potions s4) | seed 4 reads zero; sweep green; A/B reported |
| simp2-b (CC) | sonnet | PLAN-2 items 3 (one arrival field), 5 (one unit-ascent step) | byte-identical + suite + G1/G2 |
| opponent (CC) | sonnet | runner `--opponent=<profile>`; ab-compare pairs by opponent; material-only baseline recorded | byte-identical without the flag |
| entrap (CC) | opus | implement docs/design/entrapment.md: instrument first, P-1 falsifier, then the repair of room (deletes crowdCertain, ownership planes, seen/multi sweep) | keep only if predictions hold in direction; sixteen arms zero inversions |
Queued: PLAN-2 item 7 (B1/B3 fold — after b1-sound), item 2 (ourUnitTerm absorbs tier+potion — Opus, after simp2-b), §5.1 leaderOf est-across-horizons (Opus, after simp2-b); entrapment (needs a horizon: with the ceiling ply refused, design it on the one-ply bracket + claims over the window — Opus design first).
Ping: send_later 55 min, re-armed on each firing.

## Queue, ranked (nearness-to-fruition × value × complexity deleted)
1. Simplification audit (post-cut dead code, special cases, duplicated abstractions) → Sonnet executors.
2. Lookahead: follow 08-DEPTH-VERDICT.md's recommendation (depth preconditions done; chained depth 2 does not pay at production budgets).
3. goto weight defect (docs/design/drives/01, M1) — fix on the working branch.
4. TacticToes server/frontend simplification now the engine owns the turn.
5. Entrapment with a horizon; potion member v2 (must change WHICH pickups).
6. Drives: rebase feature/drives-preferences after #17 lands.
