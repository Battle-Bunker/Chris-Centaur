# Paired aggregation — p16-budget-2000

Base arm: `integrated`. Generated 2026-08-31T03:33:39.436Z.

Intervals are 95% t over BLOCK means; `n` is the number of seeds. A delta whose
interval includes zero is a NULL RESULT and must be written up as one.

**Placement resolution.** At 16 blocks the normalized placement score resolves to
roughly ±0.10. A |delta score| under that is not a small effect, it is no effect
this design can see — read the mechanism rows instead.

**`sharePar` IS THE OBJECTIVE.** Share of the total weight owned at game end, times
the number of teams. Par is 1, so the column means the same thing on a 2-team cell and
a 3-team one, and it moves CONTINUOUSLY with the weight margin. `score` is a rank: it
steps at rank boundaries, is blind to margin, and its 0.5 on a 3-team cell has no
counterpart on a 2-team one. Both are reported, because every earlier finding in this
program is denominated in `score` — but when they disagree, `sharePar` is the one being
optimized. `win` (P(first)) is a rank reading too; it is kept for continuity and is not
a headline. On a batch run before 2026-08-29 the harness stamped no `sharePar`, so it is
recomputed here from the per-team end weights those manifests do carry — exact on every
end kind except a mutual final wipe, and the Integrity problems section names each of
those games individually rather than letting it disappear into a mean.

**The `sharePar` floor is not the `score` floor.** They are different units and do not
convert. Measured on the 20260827 A/A null at 16 blocks, `sharePar` resolves to ±0.53
on `headline-mix-king` and ±0.15 on `null-snake6`, against ±0.097 and ±0.032 for
`score` — about 1.6-1.8x noisier once the two ranges are put on the same footing, so
roughly 3x the blocks buy the same power. Read a sharePar delta against a sharePar
floor from `verify-null.js`, never against a rank floor.

**Read the arm audit first.** An arm can carry the name of a treatment and have run
the baseline. The stamp table under each sweep is what the engine RESOLVED; the
manifest's `contendersAtRun` (or, on a pre-teardown bundle, `envAtRun`) is what was
asked for. When they disagree, the stamp is the arm. And a mechanism counter that
stayed at zero on the treatment arm means the arm never engaged, which is a
different finding from a null.

Arms are CONFIGURED BOTS as of 2026-08-29: the engine's feature flags were removed,
so a contender is a named `BotConfig` in the spec rather than an environment
variable. Batch-1 rows predate that and carry the old flag stamp; both shapes are
read here, and a stamp's own keys say which one a row is.

## p16-budget-2000

Subject: `integrated:lobster-territory perf-substrate:lobster-territory` · arms: integrated, perf-substrate · paired 48 games

**Arm audit** — the flags each engine RESOLVED:

| flag | perf-substrate |
|---|---|

### cell `headline-mix-king@2000` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

24 games in 8 blocks. cap-terminal rate: integrated 0.292, perf-substrate 0.083

| metric | integrated (level) | perf-substrate (level) | Δ perf-substrate−integrated [95% CI] |
|---|---|---|---|
| sharePar | 1.597 [1.1074, 2.0865] n=8 | 1.1471 [0.4105, 1.8837] n=8 | **-0.4499** [-1.0087, 0.109] |
| score | 0.75 [0.6447, 0.8553] n=8 | 0.6458 [0.5077, 0.7839] n=8 | **-0.1042** [-0.2079, -0.0005] ✱ |
| win | 0.5 [0.2893, 0.7107] n=8 | 0.375 [0.1424, 0.6076] n=8 | **-0.125** [-0.3324, 0.0824] |
| place | 1.5 [1.2893, 1.7107] n=8 | 1.7083 [1.4321, 1.9846] n=8 | **0.2083** [0.001, 0.4157] ✱ |
| finalMaterial | 20.25 [13.3714, 27.1286] n=8 | 12.0417 [3.0478, 21.0355] n=8 | **-8.2083** [-18.8247, 2.408] |
| finalUnits | 2.9167 [2.2219, 3.6115] n=8 | 2.125 [0.7043, 3.5457] n=8 | **-0.7917** [-1.9158, 0.3325] |
| survived | 0.6667 [0.456, 0.8774] n=8 | 0.4167 [0.1282, 0.7052] n=8 | **-0.25** [-0.5385, 0.0385] |
| turns | 72.4583 [57.7794, 87.1373] n=8 | 53.0417 [40.4985, 65.5848] n=8 | **-19.4167** [-35.9285, -2.9048] ✱ |
| decisive | 0.7083 [0.4757, 0.9409] n=8 | 0.9167 [0.7876, 1.0457] n=8 | **0.2083** [-0.0873, 0.504] |
| decisions | 72.4583 [57.7794, 87.1373] n=8 | 51.9583 [38.482, 65.4347] n=8 | **-20.5** [-37.6645, -3.3355] ✱ |
| worstWallMs | 1946.6667 [1937.9376, 1955.3957] n=8 | 1966.2083 [1946.7499, 1985.6667] n=8 | **19.5417** [-1.3385, 40.4218] |
| overrunRate | 0 [0, 0] n=8 | 0.0026 [-0.0015, 0.0067] n=8 | **0.0026** [-0.0015, 0.0067] |
| unstagedRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ratchetRate | 0.0073 [-0.0023, 0.0169] n=8 | 0.0015 [-0.0021, 0.0051] n=8 | **-0.0058** [-0.0168, 0.0052] |
| deathsSelf | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| deathsWall | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| deathsExhaustion | 0.0417 [-0.0569, 0.1402] n=8 | 0.0417 [-0.0569, 0.1402] n=8 | **0** [0, 0] |
| deathsBodyBlock | 0.2083 [0.001, 0.4157] n=8 | 0.2917 [0.0154, 0.5679] n=8 | **0.0833** [-0.2739, 0.4406] |
| deathsContest | 1.625 [1.1922, 2.0578] n=8 | 1.4583 [0.9887, 1.928] n=8 | **-0.1667** [-0.4247, 0.0914] |
| deathsTeammate | 0.0833 [-0.0457, 0.2124] n=8 | 0.0833 [-0.0457, 0.2124] n=8 | **0** [-0.2107, 0.2107] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | — | 123072.25 [96906.3849, 149238.1151] n=8 | — |
| clusterEnumMs | — | 30102.25 [23360.0474, 36844.4526] n=8 | — |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | — | 1220.7917 [933.576, 1508.0073] n=8 | — |
| scoutPlies | — | 1208.125 [908.6381, 1507.6119] n=8 | — |
| scoutRefusals | — | 0 [0, 0] n=8 | — |
| ceilingDecided | — | 292.75 [125.9172, 459.5828] n=8 | — |
| illegal | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| errors | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 4611.1667 [656.2229, 8566.1104] n=8 | 5935.7083 [-4506.6941, 16378.1107] n=8 | **1324.5417** [-10421.0567, 13070.14] |
| ~~boundsInversions~~ (retired) | 0.7083 [-0.9669, 2.3835] n=8 | 0 [0, 0] n=8 | **-0.7083** [-2.3835, 0.9669] |

### cell `null-snake6@2000` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

24 games in 8 blocks. cap-terminal rate: integrated 0.958, perf-substrate 0.875

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | perf-substrate (level) | Δ perf-substrate−integrated [95% CI] |
|---|---|---|---|
| sharePar | 2.3631 [2.2198, 2.5064] n=8 | 2.4859 [2.3116, 2.6602] n=8 | **0.1228** [-0.0251, 0.2707] |
| score | 1 [1, 1] n=8 | 1 [1, 1] n=8 | **0** [0, 0] |
| win | 1 [1, 1] n=8 | 1 [1, 1] n=8 | **0** [0, 0] |
| place | 1 [1, 1] n=8 | 1 [1, 1] n=8 | **0** [0, 0] |
| finalMaterial | 41.9167 [38.4974, 45.3359] n=8 | 40 [36.1065, 43.8935] n=8 | **-1.9167** [-7.4766, 3.6432] |
| finalUnits | 5 [4.7893, 5.2107] n=8 | 4.9583 [4.5803, 5.3363] n=8 | **-0.0417** [-0.4197, 0.3363] |
| survived | 1 [1, 1] n=8 | 1 [1, 1] n=8 | **0** [0, 0] |
| turns | 119.6667 [118.8783, 120.455] n=8 | 118.5833 [116.515, 120.6517] n=8 | **-1.0833** [-3.0072, 0.8405] |
| decisive | 0.0417 [-0.0569, 0.1402] n=8 | 0.125 [-0.0193, 0.2693] n=8 | **0.0833** [-0.0457, 0.2124] |
| decisions | 119.6667 [118.8783, 120.455] n=8 | 118.5833 [116.515, 120.6517] n=8 | **-1.0833** [-3.0072, 0.8405] |
| worstWallMs | 1963.0417 [1961.5265, 1964.5569] n=8 | 2000.7083 [1982.5159, 2018.9008] n=8 | **37.6667** [19.0315, 56.3018] ✱ |
| overrunRate | 0 [0, 0] n=8 | 0.0063 [0.0026, 0.01] n=8 | **0.0063** [0.0026, 0.01] ✱ |
| unstagedRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=8 | 0.0276 [0.016, 0.0393] n=8 | **0.0276** [0.016, 0.0393] ✱ |
| deathsSelf | 0.2083 [0.001, 0.4157] n=8 | 0.5 [0.1669, 0.8331] n=8 | **0.2917** [-0.1146, 0.698] |
| deathsWall | 0 [0, 0] n=8 | 0.0833 [-0.0457, 0.2124] n=8 | **0.0833** [-0.0457, 0.2124] |
| deathsExhaustion | 0.25 [-0.0385, 0.5385] n=8 | 0.1667 [-0.044, 0.3774] n=8 | **-0.0833** [-0.3304, 0.1637] |
| deathsBodyBlock | 0.1667 [-0.044, 0.3774] n=8 | 0 [0, 0] n=8 | **-0.1667** [-0.3774, 0.044] |
| deathsContest | 0.375 [0.0612, 0.6888] n=8 | 0.2917 [0.113, 0.4703] n=8 | **-0.0833** [-0.3718, 0.2052] |
| deathsTeammate | 0.0417 [-0.0569, 0.1402] n=8 | 0 [0, 0] n=8 | **-0.0417** [-0.1402, 0.0569] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | — | 4493.4167 [3731.8458, 5254.9876] n=8 | — |
| clusterEnumMs | — | 2567.25 [2360.4639, 2774.0361] n=8 | — |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | — | 1433.5 [1376.077, 1490.923] n=8 | — |
| scoutPlies | — | 1243.3333 [1167.8667, 1318.8] n=8 | — |
| scoutRefusals | — | 322.875 [305.5426, 340.2074] n=8 | — |
| ceilingDecided | — | 155.5417 [-2.0318, 313.1152] n=8 | — |
| illegal | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| errors | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 153735.8333 [96500.8852, 210970.7814] n=8 | 332392.2917 [300898.1344, 363886.449] n=8 | **178656.4583** [146843.3447, 210469.572] ✱ |
| ~~boundsInversions~~ (retired) | 2854.2083 [-3895.9944, 9604.411] n=8 | 192.4167 [-262.6487, 647.4821] n=8 | **-2661.7917** [-9491.8703, 4168.2869] |

