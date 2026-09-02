# Paired aggregation — p13-workers

Base arm: `workers-off`. Generated 2026-08-31T02:23:29.241Z.

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

## p13-workers

Subject: `workers-auto:lobster-territory workers-off:lobster-territory` · arms: workers-auto, workers-off · paired 96 games

**Arm audit** — the flags each engine RESOLVED:

| flag | workers-auto | workers-off |
|---|---|---|
| `name` | default | lobster-territory |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: workers-auto 0.125, workers-off 0.083

| metric | workers-auto (level) | workers-off (level) | Δ workers-auto−workers-off [95% CI] |
|---|---|---|---|
| sharePar | 1.4933 [0.9675, 2.0191] n=16 | 1.2994 [0.927, 1.6718] n=16 | **0.1939** [-0.3782, 0.7661] |
| score | 0.7292 [0.6222, 0.8361] n=16 | 0.6875 [0.6089, 0.7661] n=16 | **0.0417** [-0.073, 0.1563] |
| win | 0.5 [0.3166, 0.6834] n=16 | 0.4167 [0.2954, 0.538] n=16 | **0.0833** [-0.1057, 0.2724] |
| place | 1.5417 [1.3278, 1.7555] n=16 | 1.625 [1.4678, 1.7822] n=16 | **-0.0833** [-0.3126, 0.1459] |
| finalMaterial | 16.6875 [10.5803, 22.7947] n=16 | 13.625 [8.9707, 18.2793] n=16 | **3.0625** [-4.2919, 10.4169] |
| finalUnits | 2.8542 [1.8006, 3.9077] n=16 | 2.5625 [1.9248, 3.2002] n=16 | **0.2917** [-0.7657, 1.349] |
| survived | 0.5625 [0.3603, 0.7647] n=16 | 0.4792 [0.35, 0.6083] n=16 | **0.0833** [-0.1366, 0.3032] |
| turns | 58.7292 [50.2407, 67.2176] n=16 | 55.3542 [45.41, 65.2983] n=16 | **3.375** [-10.0015, 16.7515] |
| decisive | 0.875 [0.7862, 0.9638] n=16 | 0.9167 [0.8372, 0.9961] n=16 | **-0.0417** [-0.1305, 0.0471] |
| decisions | 58.5417 [50.0764, 67.007] n=16 | 55.0208 [45.1537, 64.8879] n=16 | **3.5208** [-9.9148, 16.9564] |
| worstWallMs | 1952.5208 [1943.8688, 1961.1729] n=16 | 1956.7917 [1955.2587, 1958.3246] n=16 | **-4.2708** [-13.1761, 4.6344] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0039 [-0.0006, 0.0083] n=16 | 0.0091 [-0.0095, 0.0278] n=16 | **-0.0053** [-0.0249, 0.0144] |
| deathsSelf | 0.0208 [-0.0236, 0.0652] n=16 | 0 [0, 0] n=16 | **0.0208** [-0.0236, 0.0652] |
| deathsWall | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| deathsExhaustion | 0.0625 [-0.0091, 0.1341] n=16 | 0 [0, 0] n=16 | **0.0625** [-0.0091, 0.1341] |
| deathsBodyBlock | 0.2083 [0.0984, 0.3183] n=16 | 0.2292 [0.0741, 0.3842] n=16 | **-0.0208** [-0.2204, 0.1787] |
| deathsContest | 1.2917 [1.0175, 1.5658] n=16 | 1.2708 [0.9325, 1.6091] n=16 | **0.0208** [-0.3429, 0.3846] |
| deathsTeammate | 0.0833 [0.0039, 0.1628] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **0.0208** [-0.0811, 0.1227] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 169731.1667 [143756.7011, 195705.6322] n=16 | 154630.4167 [133987.9429, 175272.8904] n=16 | **15100.75** [-16676.7118, 46878.2118] |
| clusterEnumMs | 16700.875 [14347.9543, 19053.7957] n=16 | 16037.1042 [13335.2899, 18738.9184] n=16 | **663.7708** [-3040.851, 4368.3926] |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1498.9167 [1257.9037, 1739.9296] n=16 | 1368.0417 [1128.2704, 1607.813] n=16 | **130.875** [-227.4092, 489.1592] |
| scoutPlies | 1375 [1184.4771, 1565.5229] n=16 | 1297.0625 [1061.9187, 1532.2063] n=16 | **77.9375** [-236.678, 392.553] |
| scoutRefusals | 0.0208 [-0.0236, 0.0652] n=16 | 0 [0, 0] n=16 | **0.0208** [-0.0236, 0.0652] |
| ceilingDecided | 1518.3958 [850.9309, 2185.8608] n=16 | 1329.0208 [492.1863, 2165.8554] n=16 | **189.375** [-608.0959, 986.8459] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 6505.1042 [2217.327, 10792.8813] n=16 | 5475.875 [2511.797, 8439.953] n=16 | **1029.2292** [-4325.1567, 6383.6151] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: workers-auto 0.917, workers-off 0.917

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | workers-auto (level) | workers-off (level) | Δ workers-auto−workers-off [95% CI] |
|---|---|---|---|
| sharePar | 2.1869 [1.9905, 2.3832] n=16 | 2.3069 [2.1704, 2.4433] n=16 | **-0.12** [-0.2429, 0.0029] |
| score | 0.9479 [0.8704, 1.0255] n=16 | 0.9792 [0.9488, 1.0095] n=16 | **-0.0313** [-0.0978, 0.0353] |
| win | 0.9375 [0.8409, 1.0341] n=16 | 0.9583 [0.8977, 1.019] n=16 | **-0.0208** [-0.0994, 0.0578] |
| place | 1.1042 [0.9491, 1.2592] n=16 | 1.0417 [0.981, 1.1023] n=16 | **0.0625** [-0.0707, 0.1957] |
| finalMaterial | 36.8958 [33.221, 40.5707] n=16 | 38.4375 [35.4415, 41.4335] n=16 | **-1.5417** [-4.7269, 1.6436] |
| finalUnits | 4.6458 [4.1673, 5.1244] n=16 | 4.7917 [4.4954, 5.0879] n=16 | **-0.1458** [-0.5008, 0.2091] |
| survived | 0.9792 [0.9348, 1.0236] n=16 | 1 [1, 1] n=16 | **-0.0208** [-0.0652, 0.0236] |
| turns | 117.8542 [115.3927, 120.3157] n=16 | 118.7083 [117.4084, 120.0083] n=16 | **-0.8542** [-3.1903, 1.482] |
| decisive | 0.0833 [0.0039, 0.1628] n=16 | 0.0833 [0.0039, 0.1628] n=16 | **0** [-0.0648, 0.0648] |
| decisions | 117.25 [113.6236, 120.8764] n=16 | 118.7083 [117.4084, 120.0083] n=16 | **-1.4583** [-5.0669, 2.1502] |
| worstWallMs | 1981.1458 [1974.1556, 1988.1361] n=16 | 1981.8542 [1973.4835, 1990.2248] n=16 | **-0.7083** [-11.1422, 9.7255] |
| overrunRate | 0.0024 [0.0009, 0.0039] n=16 | 0.0021 [0.0005, 0.0037] n=16 | **0.0003** [-0.0019, 0.0026] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0132 [0.0087, 0.0177] n=16 | 0.012 [0.0076, 0.0164] n=16 | **0.0012** [-0.0031, 0.0056] |
| deathsSelf | 0.5833 [0.2025, 0.9642] n=16 | 0.4583 [0.1842, 0.7325] n=16 | **0.125** [-0.1713, 0.4213] |
| deathsWall | 0.125 [0.0362, 0.2138] n=16 | 0.1042 [-0.0028, 0.2111] n=16 | **0.0208** [-0.0578, 0.0994] |
| deathsExhaustion | 0.1042 [-0.0028, 0.2111] n=16 | 0.0833 [0.0039, 0.1628] n=16 | **0.0208** [-0.0236, 0.0652] |
| deathsBodyBlock | 0.1667 [0.0544, 0.279] n=16 | 0.1667 [0.075, 0.2584] n=16 | **0** [-0.0648, 0.0648] |
| deathsContest | 0.375 [0.2178, 0.5322] n=16 | 0.3958 [0.2341, 0.5575] n=16 | **-0.0208** [-0.0994, 0.0578] |
| deathsTeammate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 4845.1667 [4380.314, 5310.0193] n=16 | 5114.8958 [4656.8681, 5572.9236] n=16 | **-269.7292** [-619.7442, 80.2859] |
| clusterEnumMs | 1392.2708 [1317.4892, 1467.0525] n=16 | 1241.1667 [1190.7872, 1291.5462] n=16 | **151.1042** [105.6319, 196.5764] ✱ |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1384.8542 [1327.035, 1442.6733] n=16 | 1409.0417 [1377.691, 1440.3923] n=16 | **-24.1875** [-71.0932, 22.7182] |
| scoutPlies | 1011.2917 [963.3881, 1059.1952] n=16 | 963.25 [937.2371, 989.2629] n=16 | **48.0417** [2.4106, 93.6728] ✱ |
| scoutRefusals | 304.3542 [289.3298, 319.3785] n=16 | 303.2917 [296.9671, 309.6162] n=16 | **1.0625** [-10.1891, 12.3141] |
| ceilingDecided | 949.0417 [299.4096, 1598.6737] n=16 | 794.3333 [141.9386, 1446.728] n=16 | **154.7083** [-215.2286, 524.6452] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 546890.0417 [513745.8347, 580034.2486] n=16 | 626336.7083 [599347.2423, 653326.1743] n=16 | **-79446.6667** [-102204.5435, -56688.7898] ✱ |
| ~~boundsInversions~~ (retired) | 1302.3958 [-1473.0097, 4077.8014] n=16 | 2453.2292 [-1118.5802, 6025.0386] n=16 | **-1150.8333** [-3827.7453, 1526.0786] |

