# Paired aggregation — p16-budget-1000

Base arm: `integrated`. Generated 2026-08-31T03:06:19.511Z.

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

## p16-budget-1000

Subject: `integrated:lobster-territory perf-substrate:lobster-territory` · arms: integrated, perf-substrate · paired 48 games

**Arm audit** — the flags each engine RESOLVED:

| flag | perf-substrate |
|---|---|

### cell `headline-mix-king@1000` — 25x25, 3 teams x 6, 1000ms, cap 120, food 0.5, hazards none, potions false

24 games in 8 blocks. cap-terminal rate: integrated 0.333, perf-substrate 0.083

| metric | integrated (level) | perf-substrate (level) | Δ perf-substrate−integrated [95% CI] |
|---|---|---|---|
| sharePar | 1.5587 [0.9571, 2.1603] n=8 | 1.5274 [0.7143, 2.3405] n=8 | **-0.0313** [-1.0824, 1.0198] |
| score | 0.6667 [0.5177, 0.8156] n=8 | 0.75 [0.5834, 0.9166] n=8 | **0.0833** [-0.1637, 0.3304] |
| win | 0.4167 [0.1696, 0.6637] n=8 | 0.5417 [0.246, 0.8373] n=8 | **0.125** [-0.2674, 0.5174] |
| place | 1.6667 [1.3687, 1.9646] n=8 | 1.5 [1.1669, 1.8331] n=8 | **-0.1667** [-0.6608, 0.3274] |
| finalMaterial | 18.7083 [10.5613, 26.8553] n=8 | 15.6667 [5.8588, 25.4746] n=8 | **-3.0417** [-18.3646, 12.2813] |
| finalUnits | 2.7917 [1.6874, 3.8959] n=8 | 2.375 [1.1607, 3.5893] n=8 | **-0.4167** [-2.2091, 1.3758] |
| survived | 0.6667 [0.4086, 0.9247] n=8 | 0.5417 [0.246, 0.8373] n=8 | **-0.125** [-0.5704, 0.3204] |
| turns | 69.0833 [49.9222, 88.2445] n=8 | 60.1667 [35.4695, 84.8638] n=8 | **-8.9167** [-42.0574, 24.2241] |
| decisive | 0.6667 [0.4086, 0.9247] n=8 | 0.9167 [0.7876, 1.0457] n=8 | **0.25** [-0.0747, 0.5747] |
| decisions | 67.6667 [47.7316, 87.6017] n=8 | 59.3333 [34.437, 84.2297] n=8 | **-8.3333** [-42.5711, 25.9044] |
| worstWallMs | 939.9583 [929.9939, 949.9227] n=8 | 1007.5 [970.2497, 1044.7503] n=8 | **67.5417** [24.8831, 110.2002] ✱ |
| overrunRate | 0 [0, 0] n=8 | 0.0235 [0.0014, 0.0456] n=8 | **0.0235** [0.0014, 0.0456] ✱ |
| unstagedRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| deathsSelf | 0.0833 [-0.1137, 0.2804] n=8 | 0 [0, 0] n=8 | **-0.0833** [-0.2804, 0.1137] |
| deathsWall | 0.0417 [-0.0569, 0.1402] n=8 | 0 [0, 0] n=8 | **-0.0417** [-0.1402, 0.0569] |
| deathsExhaustion | 0.0833 [-0.1137, 0.2804] n=8 | 0 [0, 0] n=8 | **-0.0833** [-0.2804, 0.1137] |
| deathsBodyBlock | 0.2917 [0.113, 0.4703] n=8 | 0.4167 [0.0296, 0.8037] n=8 | **0.125** [-0.206, 0.456] |
| deathsContest | 1.4583 [0.9436, 1.9731] n=8 | 1.5833 [1.1426, 2.024] n=8 | **0.125** [-0.4698, 0.7198] |
| deathsTeammate | 0.1667 [-0.044, 0.3774] n=8 | 0.2083 [-0.0873, 0.504] n=8 | **0.0417** [-0.1909, 0.2743] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | — | 117554 [80023.5032, 155084.4968] n=8 | — |
| clusterEnumMs | — | 25148.6667 [16371.9289, 33925.4044] n=8 | — |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | — | 1369.2083 [850.3216, 1888.095] n=8 | — |
| scoutPlies | — | 837.125 [515.1366, 1159.1134] n=8 | — |
| scoutRefusals | — | 0.0417 [-0.0569, 0.1402] n=8 | — |
| ceilingDecided | — | 60.5417 [24.7928, 96.2906] n=8 | — |
| illegal | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| errors | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 6372.5 [1007.5398, 11737.4602] n=8 | 1532.375 [-895.7263, 3960.4763] n=8 | **-4840.125** [-10357.2687, 677.0187] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |

### cell `null-snake6@1000` — 25x25, 3 teams x 6, 1000ms, cap 120, food 0.5, hazards none, potions false

24 games in 8 blocks. cap-terminal rate: integrated 1, perf-substrate 0.917

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | perf-substrate (level) | Δ perf-substrate−integrated [95% CI] |
|---|---|---|---|
| sharePar | 2.1809 [2.0441, 2.3177] n=8 | 2.3369 [2.1817, 2.4921] n=8 | **0.156** [-0.0922, 0.4043] |
| score | 0.9792 [0.9299, 1.0284] n=8 | 1 [1, 1] n=8 | **0.0208** [-0.0284, 0.0701] |
| win | 0.9583 [0.8598, 1.0569] n=8 | 1 [1, 1] n=8 | **0.0417** [-0.0569, 0.1402] |
| place | 1.0417 [0.9431, 1.1402] n=8 | 1 [1, 1] n=8 | **-0.0417** [-0.1402, 0.0569] |
| finalMaterial | 39.4583 [34.0993, 44.8174] n=8 | 39.5833 [35.0627, 44.104] n=8 | **0.125** [-6.984, 7.234] |
| finalUnits | 4.8333 [4.3172, 5.3494] n=8 | 4.7083 [4.1423, 5.2744] n=8 | **-0.125** [-1.0056, 0.7556] |
| survived | 1 [1, 1] n=8 | 1 [1, 1] n=8 | **0** [0, 0] |
| turns | 120 [120, 120] n=8 | 118.7083 [116.5991, 120.8175] n=8 | **-1.2917** [-3.4009, 0.8175] |
| decisive | 0 [0, 0] n=8 | 0.0833 [-0.0457, 0.2124] n=8 | **0.0833** [-0.0457, 0.2124] |
| decisions | 120 [120, 120] n=8 | 118.7083 [116.5991, 120.8175] n=8 | **-1.2917** [-3.4009, 0.8175] |
| worstWallMs | 963.2917 [961.8516, 964.7318] n=8 | 979.9583 [971.0363, 988.8803] n=8 | **16.6667** [7.7129, 25.6204] ✱ |
| overrunRate | 0 [0, 0] n=8 | 0.0028 [-0.0005, 0.0061] n=8 | **0.0028** [-0.0005, 0.0061] |
| unstagedRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| deathsSelf | 0.3333 [0.1226, 0.544] n=8 | 0.4583 [0.203, 0.7137] n=8 | **0.125** [-0.2947, 0.5447] |
| deathsWall | 0.0833 [-0.0457, 0.2124] n=8 | 0.125 [-0.0193, 0.2693] n=8 | **0.0417** [-0.0569, 0.1402] |
| deathsExhaustion | 0.1667 [-0.1313, 0.4646] n=8 | 0.1667 [0.0177, 0.3156] n=8 | **0** [-0.3942, 0.3942] |
| deathsBodyBlock | 0.1667 [0.0177, 0.3156] n=8 | 0.0833 [-0.0457, 0.2124] n=8 | **-0.0833** [-0.2804, 0.1137] |
| deathsContest | 0.4167 [0.1282, 0.7052] n=8 | 0.4583 [0.0953, 0.8214] n=8 | **0.0417** [-0.4837, 0.5671] |
| deathsTeammate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | — | 4908.625 [3868.8862, 5948.3638] n=8 | — |
| clusterEnumMs | — | 2523.9167 [2205.2397, 2842.5936] n=8 | — |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | — | 1422 [1347.3751, 1496.6249] n=8 | — |
| scoutPlies | — | 1246.2917 [1147.0311, 1345.5522] n=8 | — |
| scoutRefusals | — | 319.25 [300.9079, 337.5921] n=8 | — |
| ceilingDecided | — | 342.3333 [66.5869, 618.0798] n=8 | — |
| illegal | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| errors | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 70969.0833 [57698.1535, 84240.0131] n=8 | 166319 [128455.1265, 204182.8735] n=8 | **95349.9167** [62679.2975, 128020.5358] ✱ |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |

