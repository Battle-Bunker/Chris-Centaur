# Paired aggregation — p11cfg

Base arm: `default`. Generated 2026-08-31T22:08:56.271Z.

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

## p11-scout

Subject: `default:lobster-territory depthless:lobster-territory` · arms: default, depthless · paired 144 games

**Arm audit** — the flags each engine RESOLVED:

| flag | default | depthless |
|---|---|---|
| `depthPlyCap` | 24 | 0 |
| `name` | default | lobster-territory |

### cell `hazard-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards cross, potions false

48 games in 16 blocks. cap-terminal rate: default 0.229, depthless 0.292

| metric | default (level) | depthless (level) | Δ depthless−default [95% CI] |
|---|---|---|---|
| sharePar | 1.3735 [0.9099, 1.8371] n=16 | 1.7469 [1.3711, 2.1227] n=16 | **0.3734** [-0.1587, 0.9056] |
| score | 0.7292 [0.6442, 0.8142] n=16 | 0.7812 [0.7037, 0.8588] n=16 | **0.0521** [-0.0541, 0.1582] |
| win | 0.5 [0.3412, 0.6588] n=16 | 0.5833 [0.4458, 0.7209] n=16 | **0.0833** [-0.1165, 0.2832] |
| place | 1.5417 [1.3716, 1.7117] n=16 | 1.4375 [1.2824, 1.5926] n=16 | **-0.1042** [-0.3165, 0.1081] |
| finalMaterial | 16.6875 [11.8378, 21.5372] n=16 | 20.4167 [15.8102, 25.0231] n=16 | **3.7292** [-2.2461, 9.7044] |
| finalUnits | 2.2292 [1.485, 2.9734] n=16 | 3.1875 [2.5759, 3.7991] n=16 | **0.9583** [0.1107, 1.806] ✱ |
| survived | 0.5417 [0.3845, 0.6988] n=16 | 0.75 [0.6287, 0.8713] n=16 | **0.2083** [0.0512, 0.3655] ✱ |
| turns | 66.6667 [55.7245, 77.6088] n=16 | 78.25 [67.576, 88.924] n=16 | **11.5833** [-2.5865, 25.7532] |
| decisive | 0.7708 [0.6458, 0.8959] n=16 | 0.7083 [0.5652, 0.8515] n=16 | **-0.0625** [-0.2367, 0.1117] |
| decisions | 65.8958 [54.9791, 76.8126] n=16 | 78.0417 [67.3766, 88.7067] n=16 | **12.1458** [-2.0318, 26.3235] |
| worstWallMs | 1947.0208 [1934.9211, 1959.1206] n=16 | 1956.9583 [1953.9329, 1959.9838] n=16 | **9.9375** [-2.0487, 21.9237] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0003 [-0.0004, 0.0011] n=16 | 0.0094 [0.0005, 0.0183] n=16 | **0.0091** [0.0001, 0.018] ✱ |
| deathsSelf | 0.0833 [0.0039, 0.1628] n=16 | 0 [0, 0] n=16 | **-0.0833** [-0.1628, -0.0039] ✱ |
| deathsWall | 0.0417 [-0.019, 0.1023] n=16 | 0.1042 [-0.0028, 0.2111] n=16 | **0.0625** [-0.0707, 0.1957] |
| deathsExhaustion | 0.125 [0.0362, 0.2138] n=16 | 0.25 [0.1124, 0.3876] n=16 | **0.125** [-0.0182, 0.2682] |
| deathsBodyBlock | 0.2292 [0.1041, 0.3542] n=16 | 0.1458 [0.0548, 0.2368] n=16 | **-0.0833** [-0.2487, 0.082] |
| deathsContest | 1.6667 [1.2617, 2.0716] n=16 | 1.4167 [1.0645, 1.7689] n=16 | **-0.25** [-0.7544, 0.2544] |
| deathsTeammate | 0.0833 [0.0039, 0.1628] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **-0.0417** [-0.1305, 0.0471] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 155196.9583 [129801.0908, 180592.8259] n=16 | 185422.9583 [159676.9085, 211169.0082] n=16 | **30226** [2874.6935, 57577.3065] ✱ |
| clusterEnumMs | 30633.4792 [26265.488, 35001.4704] n=16 | 996.0833 [855.8037, 1136.3629] n=16 | **-29637.3958** [-33977.4957, -25297.296] ✱ |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1566.1667 [1319.4808, 1812.8525] n=16 | 0 [0, 0] n=16 | **-1566.1667** [-1812.8525, -1319.4808] ✱ |
| scoutPlies | 1491.9167 [1229.0934, 1754.7399] n=16 | 0 [0, 0] n=16 | **-1491.9167** [-1754.7399, -1229.0934] ✱ |
| scoutRefusals | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ceilingDecided | 346.7083 [151.7538, 541.6629] n=16 | 471.625 [268.9613, 674.2887] n=16 | **124.9167** [-133.5798, 383.4131] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 9336.4792 [2909.7865, 15763.1718] n=16 | 24629.75 [9636.936, 39622.564] n=16 | **15293.2708** [738.7563, 29847.7854] ✱ |
| ~~boundsInversions~~ (retired) | 828.0833 [-395.5324, 2051.6991] n=16 | 0 [0, 0] n=16 | **-828.0833** [-2051.6991, 395.5324] |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.208, depthless 0.333

| metric | default (level) | depthless (level) | Δ depthless−default [95% CI] |
|---|---|---|---|
| sharePar | 1.601 [1.2415, 1.9604] n=16 | 1.5133 [1.2445, 1.7821] n=16 | **-0.0877** [-0.4625, 0.2871] |
| score | 0.7188 [0.6412, 0.7963] n=16 | 0.7396 [0.6837, 0.7954] n=16 | **0.0208** [-0.0578, 0.0994] |
| win | 0.5 [0.3703, 0.6297] n=16 | 0.5208 [0.4091, 0.6326] n=16 | **0.0208** [-0.1162, 0.1579] |
| place | 1.5625 [1.4074, 1.7176] n=16 | 1.5208 [1.4091, 1.6326] n=16 | **-0.0417** [-0.1988, 0.1155] |
| finalMaterial | 20.2083 [16.4246, 23.9921] n=16 | 20.2083 [17.4194, 22.9973] n=16 | **0** [-5.75, 5.75] |
| finalUnits | 3.1042 [2.5437, 3.6647] n=16 | 2.9167 [2.4698, 3.3636] n=16 | **-0.1875** [-0.8918, 0.5168] |
| survived | 0.6458 [0.5251, 0.7666] n=16 | 0.6667 [0.575, 0.7584] n=16 | **0.0208** [-0.1441, 0.1858] |
| turns | 64.1875 [52.5811, 75.7939] n=16 | 72.1875 [59.7607, 84.6143] n=16 | **8** [-9.1824, 25.1824] |
| decisive | 0.7917 [0.664, 0.9193] n=16 | 0.6667 [0.537, 0.7964] n=16 | **-0.125** [-0.295, 0.045] |
| decisions | 63.7708 [51.9557, 75.586] n=16 | 70.5417 [58.3014, 82.7819] n=16 | **6.7708** [-10.1704, 23.712] |
| worstWallMs | 1971.3958 [1937.4434, 2005.3482] n=16 | 1950.1042 [1941.7157, 1958.4926] n=16 | **-21.2917** [-56.4643, 13.881] |
| overrunRate | 0.0046 [-0.0009, 0.0101] n=16 | 0 [0, 0] n=16 | **-0.0046** [-0.0101, 0.0009] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0031 [-0.0011, 0.0072] n=16 | 0.0018 [-0.0004, 0.004] n=16 | **-0.0013** [-0.0049, 0.0024] |
| deathsSelf | 0.0208 [-0.0236, 0.0652] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **0** [-0.0648, 0.0648] |
| deathsWall | 0.0417 [-0.019, 0.1023] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.0208** [-0.0994, 0.0578] |
| deathsExhaustion | 0.0833 [-0.0542, 0.2209] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **-0.0208** [-0.1858, 0.1441] |
| deathsBodyBlock | 0.25 [0.0979, 0.4021] n=16 | 0.2292 [0.1222, 0.3361] n=16 | **-0.0208** [-0.2204, 0.1787] |
| deathsContest | 1.1667 [0.9155, 1.4178] n=16 | 1.5417 [1.1932, 1.8901] n=16 | **0.375** [-0.092, 0.842] |
| deathsTeammate | 0.1042 [-0.0028, 0.2111] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **-0.0417** [-0.1693, 0.086] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 160875.8333 [136185.4773, 185566.1894] n=16 | 152238.5 [127248.5698, 177228.4302] n=16 | **-8637.3333** [-41981.297, 24706.6303] |
| clusterEnumMs | 32791.0625 [27184.7343, 38397.3907] n=16 | 853.0625 [721.1588, 984.9662] n=16 | **-31938** [-37534.8534, -26341.1466] ✱ |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1592.0625 [1315.7582, 1868.3668] n=16 | 0 [0, 0] n=16 | **-1592.0625** [-1868.3668, -1315.7582] ✱ |
| scoutPlies | 1481.0625 [1197.2936, 1764.8314] n=16 | 0 [0, 0] n=16 | **-1481.0625** [-1764.8314, -1197.2936] ✱ |
| scoutRefusals | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ceilingDecided | 756.3542 [229.138, 1283.5703] n=16 | 380.5208 [199.4953, 561.5464] n=16 | **-375.8333** [-881.3995, 129.7328] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 5411.0208 [2289.8281, 8532.2136] n=16 | 8990.6875 [4319.1845, 13662.1905] n=16 | **3579.6667** [-2119.0289, 9278.3622] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 360.9375 [-408.2203, 1130.0953] n=16 | **360.9375** [-408.2203, 1130.0953] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.896, depthless 0.854

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | depthless (level) | Δ depthless−default [95% CI] |
|---|---|---|---|
| sharePar | 2.3283 [2.1749, 2.4816] n=16 | 2.3701 [2.243, 2.4972] n=16 | **0.0418** [-0.1566, 0.2403] |
| score | 0.9792 [0.9348, 1.0236] n=16 | 0.9792 [0.9488, 1.0095] n=16 | **0** [-0.0562, 0.0562] |
| win | 0.9792 [0.9348, 1.0236] n=16 | 0.9583 [0.8977, 1.019] n=16 | **-0.0208** [-0.0994, 0.0578] |
| place | 1.0417 [0.9529, 1.1305] n=16 | 1.0417 [0.981, 1.1023] n=16 | **0** [-0.1123, 0.1123] |
| finalMaterial | 39.4792 [35.9981, 42.9603] n=16 | 39.0208 [34.8893, 43.1523] n=16 | **-0.4583** [-4.9241, 4.0074] |
| finalUnits | 4.8542 [4.5717, 5.1366] n=16 | 4.9167 [4.5527, 5.2806] n=16 | **0.0625** [-0.3735, 0.4985] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 117.0833 [111.6463, 122.5204] n=16 | 118.0833 [116.3152, 119.8515] n=16 | **1** [-5.004, 7.004] |
| decisive | 0.1042 [-0.0367, 0.245] n=16 | 0.1458 [0.0341, 0.2576] n=16 | **0.0417** [-0.1515, 0.2348] |
| decisions | 117.0833 [111.6463, 122.5204] n=16 | 118.0833 [116.3152, 119.8515] n=16 | **1** [-5.004, 7.004] |
| worstWallMs | 2003.1042 [1984.2168, 2021.9915] n=16 | 1983.1875 [1975.8894, 1990.4856] n=16 | **-19.9167** [-39.9262, 0.0929] |
| overrunRate | 0.0052 [0.0027, 0.0077] n=16 | 0.0021 [0.0006, 0.0036] n=16 | **-0.0031** [-0.0055, -0.0007] ✱ |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0211 [0.0135, 0.0287] n=16 | 0.0229 [0.0134, 0.0324] n=16 | **0.0018** [-0.0095, 0.013] |
| deathsSelf | 0.3125 [0.1476, 0.4774] n=16 | 0.3333 [0.1745, 0.4922] n=16 | **0.0208** [-0.1988, 0.2404] |
| deathsWall | 0.1042 [-0.0028, 0.2111] n=16 | 0.0625 [-0.0341, 0.1591] n=16 | **-0.0417** [-0.1693, 0.086] |
| deathsExhaustion | 0.1875 [0.0045, 0.3705] n=16 | 0.0833 [-0.0192, 0.1859] n=16 | **-0.1042** [-0.3063, 0.098] |
| deathsBodyBlock | 0.1042 [-0.0028, 0.2111] n=16 | 0.125 [-0.0026, 0.2526] n=16 | **0.0208** [-0.1564, 0.198] |
| deathsContest | 0.4375 [0.2824, 0.5926] n=16 | 0.4792 [0.2548, 0.7035] n=16 | **0.0417** [-0.1621, 0.2454] |
| deathsTeammate | 0.0208 [-0.0236, 0.0652] n=16 | 0 [0, 0] n=16 | **-0.0208** [-0.0652, 0.0236] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 4558.1042 [4123.9306, 4992.2778] n=16 | 5277.375 [4642.1791, 5912.5709] n=16 | **719.2708** [8.3498, 1430.1919] ✱ |
| clusterEnumMs | 2483.875 [2329.9176, 2637.8324] n=16 | 120.2917 [104.2464, 136.3369] n=16 | **-2363.5833** [-2520.9211, -2206.2456] ✱ |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1399.7917 [1337.2403, 1462.3431] n=16 | 0 [0, 0] n=16 | **-1399.7917** [-1462.3431, -1337.2403] ✱ |
| scoutPlies | 1256.4167 [1191.9071, 1320.9262] n=16 | 0 [0, 0] n=16 | **-1256.4167** [-1320.9262, -1191.9071] ✱ |
| scoutRefusals | 312.1667 [296.2431, 328.0903] n=16 | 0 [0, 0] n=16 | **-312.1667** [-328.0903, -296.2431] ✱ |
| ceilingDecided | 698.5208 [48.3419, 1348.6998] n=16 | 318.6667 [65.3666, 571.9667] n=16 | **-379.8542** [-1125.3437, 365.6354] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 324536.8333 [299703.8389, 349369.8278] n=16 | 387189.2917 [323655.06, 450723.5233] n=16 | **62652.4583** [750.2603, 124554.6564] ✱ |
| ~~boundsInversions~~ (retired) | 604.3333 [-683.501, 1892.1677] n=16 | 2269.9167 [-376.8189, 4916.6522] n=16 | **1665.5833** [-1415.7032, 4746.8699] |

