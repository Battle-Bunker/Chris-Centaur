# Paired aggregation — p9-sampled_cap

Base arm: `default`. Generated 2026-08-30T21:32:53.385Z.

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

## p9-sampled_cap

Subject: `default:lobster-territory sampled-cap:lobster-territory` · arms: default, sampled-cap · paired 144 games

**Arm audit** — the flags each engine RESOLVED:

| flag | default | sampled-cap |
|---|---|---|
| `name` | default | lobster-territory |
| `sampledCap` | false | true |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.125, sampled-cap 0.167

| metric | default (level) | sampled-cap (level) | Δ sampled-cap−default [95% CI] |
|---|---|---|---|
| sharePar | 1.7049 [1.2046, 2.2052] n=16 | 1.5793 [1.1943, 1.9644] n=16 | **-0.1256** [-0.5945, 0.3432] |
| score | 0.7396 [0.6322, 0.847] n=16 | 0.75 [0.6583, 0.8417] n=16 | **0.0104** [-0.0894, 0.1102] |
| win | 0.5833 [0.418, 0.7487] n=16 | 0.5625 [0.4216, 0.7034] n=16 | **-0.0208** [-0.1725, 0.1308] |
| place | 1.5208 [1.3061, 1.7356] n=16 | 1.5 [1.3166, 1.6834] n=16 | **-0.0208** [-0.2204, 0.1787] |
| finalMaterial | 19.0417 [13.4749, 24.6084] n=16 | 19.2292 [13.3584, 25.0999] n=16 | **0.1875** [-6.8847, 7.2597] |
| finalUnits | 2.9792 [2.0633, 3.895] n=16 | 2.6875 [1.9787, 3.3963] n=16 | **-0.2917** [-1.2221, 0.6387] |
| survived | 0.6042 [0.4299, 0.7784] n=16 | 0.6042 [0.456, 0.7523] n=16 | **0** [-0.1716, 0.1716] |
| turns | 57.9167 [49.8146, 66.0187] n=16 | 66.5625 [56.293, 76.832] n=16 | **8.6458** [-3.0024, 20.2941] |
| decisive | 0.875 [0.7862, 0.9638] n=16 | 0.8333 [0.721, 0.9456] n=16 | **-0.0417** [-0.1988, 0.1155] |
| decisions | 56.8333 [48.3333, 65.3334] n=16 | 64.375 [53.6455, 75.1045] n=16 | **7.5417** [-4.4345, 19.5178] |
| worstWallMs | 1950.8333 [1937.6656, 1964.001] n=16 | 1931.0833 [1900.3551, 1961.8115] n=16 | **-19.75** [-45.244, 5.744] |
| overrunRate | 0.001 [-0.0004, 0.0024] n=16 | 0.0006 [-0.0003, 0.0014] n=16 | **-0.0004** [-0.0018, 0.001] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0019 [-0.0021, 0.0059] n=16 | 0.0027 [-0.0003, 0.0057] n=16 | **0.0008** [-0.0045, 0.0061] |
| deathsSelf | 0.0417 [-0.019, 0.1023] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.0208** [-0.0994, 0.0578] |
| deathsWall | 0.0208 [-0.0236, 0.0652] n=16 | 0 [0, 0] n=16 | **-0.0208** [-0.0652, 0.0236] |
| deathsExhaustion | 0 [0, 0] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **0.0625** [-0.0091, 0.1341] |
| deathsBodyBlock | 0.1667 [0.0544, 0.279] n=16 | 0.2917 [0.1485, 0.4348] n=16 | **0.125** [-0.0788, 0.3288] |
| deathsContest | 1.375 [1.0717, 1.6783] n=16 | 1.6042 [1.2139, 1.9944] n=16 | **0.2292** [-0.2281, 0.6864] |
| deathsTeammate | 0.0833 [0.0039, 0.1628] n=16 | 0.1042 [-0.0028, 0.2111] n=16 | **0.0208** [-0.0811, 0.1227] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 138496.1667 [116859.8861, 160132.4473] n=16 | 146138.1667 [130033.4872, 162242.8461] n=16 | **7642** [-16496.2139, 31780.2139] |
| clusterEnumMs | 30571.0625 [25948.7861, 35193.3389] n=16 | 37072.4375 [31378.2902, 42766.5848] n=16 | **6501.375** [920.8576, 12081.8924] ✱ |
| selectionFar | — | 3025.5833 [1298.7475, 4752.4192] n=16 | — |
| selectionDraws | — | 115482.0833 [69292.9412, 161671.2255] n=16 | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1373.0625 [1148.767, 1597.358] n=16 | 1519.375 [1291.0848, 1747.6652] n=16 | **146.3125** [-155.3804, 448.0054] |
| scoutPlies | 1338.1875 [1138.0731, 1538.3019] n=16 | 1528.75 [1274.9196, 1782.5804] n=16 | **190.5625** [-90.2128, 471.3378] |
| scoutRefusals | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ceilingDecided | 445.375 [177.3566, 713.3934] n=16 | 179.2917 [-14.7884, 373.3717] n=16 | **-266.0833** [-566.0175, 33.8508] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 2760.1458 [1484.2953, 4035.9964] n=16 | 1008.125 [639.4392, 1376.8108] n=16 | **-1752.0208** [-3107.4828, -396.5589] ✱ |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.875, sampled-cap 0.979

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | sampled-cap (level) | Δ sampled-cap−default [95% CI] |
|---|---|---|---|
| sharePar | 2.3763 [2.2826, 2.4699] n=16 | 2.3625 [2.2645, 2.4605] n=16 | **-0.0138** [-0.1281, 0.1005] |
| score | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| win | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| place | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| finalMaterial | 38.8542 [36.5958, 41.1125] n=16 | 43.5417 [39.7797, 47.3037] n=16 | **4.6875** [0.071, 9.304] ✱ |
| finalUnits | 4.8333 [4.6388, 5.0279] n=16 | 5.2083 [4.848, 5.5686] n=16 | **0.375** [-0.0545, 0.8045] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 117.6667 [115.9907, 119.3426] n=16 | 119.8333 [119.4782, 120.1885] n=16 | **2.1667** [0.3861, 3.9472] ✱ |
| decisive | 0.125 [0.0362, 0.2138] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.1042** [-0.2111, 0.0028] |
| decisions | 117.6667 [115.9907, 119.3426] n=16 | 119.8333 [119.4782, 120.1885] n=16 | **2.1667** [0.3861, 3.9472] ✱ |
| worstWallMs | 1986.5833 [1975.1703, 1997.9964] n=16 | 1979.1875 [1974.2156, 1984.1594] n=16 | **-7.3958** [-20.6045, 5.8129] |
| overrunRate | 0.0033 [0.001, 0.0056] n=16 | 0.0009 [0.0002, 0.0016] n=16 | **-0.0025** [-0.0051, 0.0002] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0266 [-0.004, 0.0572] n=16 | 0.0138 [0.0078, 0.0197] n=16 | **-0.0128** [-0.0444, 0.0187] |
| deathsSelf | 0.5208 [0.3378, 0.7039] n=16 | 0.375 [0.0787, 0.6713] n=16 | **-0.1458** [-0.5125, 0.2208] |
| deathsWall | 0.125 [-0.0026, 0.2526] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **-0.0833** [-0.2209, 0.0542] |
| deathsExhaustion | 0.0833 [-0.0192, 0.1859] n=16 | 0.0833 [0.0039, 0.1628] n=16 | **0** [-0.1297, 0.1297] |
| deathsBodyBlock | 0.1667 [0.0544, 0.279] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **-0.1042** [-0.245, 0.0367] |
| deathsContest | 0.2708 [0.1227, 0.419] n=16 | 0.2292 [0.0883, 0.37] n=16 | **-0.0417** [-0.1988, 0.1155] |
| deathsTeammate | 0.0208 [-0.0236, 0.0652] n=16 | 0 [0, 0] n=16 | **-0.0208** [-0.0652, 0.0236] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 4968.0625 [4372.2522, 5563.8728] n=16 | 5043.125 [4510.1431, 5576.1069] n=16 | **75.0625** [-683.0151, 833.1401] |
| clusterEnumMs | 2445 [2326.7563, 2563.2437] n=16 | 2747.1667 [2581.7279, 2912.6055] n=16 | **302.1667** [180.5754, 423.7579] ✱ |
| selectionFar | — | 260.5625 [175.9083, 345.2167] n=16 | — |
| selectionDraws | — | 4422.875 [3009.1404, 5836.6096] n=16 | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1447.9792 [1400.5999, 1495.3585] n=16 | 1529.0417 [1486.3678, 1571.7155] n=16 | **81.0625** [29.3619, 132.7631] ✱ |
| scoutPlies | 1237.6667 [1197.2063, 1278.127] n=16 | 1699.1667 [1625.5198, 1772.8135] n=16 | **461.5** [388.9911, 534.0089] ✱ |
| scoutRefusals | 318.75 [311.6049, 325.8951] n=16 | 365.3125 [356.4655, 374.1595] n=16 | **46.5625** [34.4135, 58.7115] ✱ |
| ceilingDecided | 832.8958 [482.7805, 1183.0112] n=16 | 267.6042 [124.7112, 410.4972] n=16 | **-565.2917** [-963.8232, -166.7601] ✱ |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 338282.6667 [306437.1844, 370128.1489] n=16 | 115682.1667 [101661.5232, 129702.8101] n=16 | **-222600.5** [-242624.8264, -202576.1736] ✱ |
| ~~boundsInversions~~ (retired) | 754.2292 [-853.0332, 2361.4915] n=16 | 646 [-730.626, 2022.626] n=16 | **-108.2292** [-2293.0414, 2076.5831] |

### cell `snake5-queen` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.854, sampled-cap 0.896

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | sampled-cap (level) | Δ sampled-cap−default [95% CI] |
|---|---|---|---|
| sharePar | 1.4945 [1.3003, 1.6886] n=16 | 1.5933 [1.3906, 1.7959] n=16 | **0.0988** [-0.187, 0.3847] |
| score | 0.7292 [0.6576, 0.8008] n=16 | 0.7708 [0.6798, 0.8618] n=16 | **0.0417** [-0.0683, 0.1516] |
| win | 0.5625 [0.4556, 0.6694] n=16 | 0.5833 [0.4313, 0.7354] n=16 | **0.0208** [-0.1441, 0.1858] |
| place | 1.5417 [1.3985, 1.6848] n=16 | 1.4583 [1.2764, 1.6403] n=16 | **-0.0833** [-0.3032, 0.1366] |
| finalMaterial | 30.5833 [27.0671, 34.0996] n=16 | 33.5 [28.5421, 38.4579] n=16 | **2.9167** [-2.8754, 8.7087] |
| finalUnits | 1.25 [1.0301, 1.4699] n=16 | 1.4167 [1.1697, 1.6636] n=16 | **0.1667** [-0.0671, 0.4005] |
| survived | 0.8958 [0.8108, 0.9808] n=16 | 0.9167 [0.8372, 0.9961] n=16 | **0.0208** [-0.0999, 0.1416] |
| turns | 117.9375 [116.5062, 119.3688] n=16 | 115.375 [109.6258, 121.1242] n=16 | **-2.5625** [-8.06, 2.935] |
| decisive | 0.1458 [0.0548, 0.2368] n=16 | 0.1042 [-0.0028, 0.2111] n=16 | **-0.0417** [-0.1693, 0.086] |
| decisions | 113.7917 [109.4332, 118.1502] n=16 | 113.0833 [106.5387, 119.6279] n=16 | **-0.7083** [-7.8468, 6.4301] |
| worstWallMs | 1965.0208 [1963.6024, 1966.4392] n=16 | 1979.3333 [1970.3719, 1988.2948] n=16 | **14.3125** [5.3622, 23.2628] ✱ |
| overrunRate | 0 [0, 0] n=16 | 0.0014 [0.0003, 0.0025] n=16 | **0.0014** [0.0003, 0.0025] ✱ |
| unstagedRate | 0.0003 [-0.0004, 0.0011] n=16 | 0.0007 [-0.0008, 0.0022] n=16 | **0.0003** [-0.0014, 0.002] |
| stagedNothingRate | 0.0002 [-0.0002, 0.0005] n=16 | 0.0002 [-0.0002, 0.0005] n=16 | **0** [-0.0005, 0.0005] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0007 [-0.0005, 0.002] n=16 | 0.0017 [-0.001, 0.0045] n=16 | **0.001** [-0.0021, 0.0041] |
| deathsSelf | 0.2083 [0.0512, 0.3655] n=16 | 0.1042 [0.0192, 0.1892] n=16 | **-0.1042** [-0.2843, 0.076] |
| deathsWall | 0.0417 [-0.019, 0.1023] n=16 | 0.125 [0.0151, 0.2349] n=16 | **0.0833** [-0.0192, 0.1859] |
| deathsExhaustion | 0.25 [0.0979, 0.4021] n=16 | 0.2083 [0.0652, 0.3515] n=16 | **-0.0417** [-0.2454, 0.1621] |
| deathsBodyBlock | 1.7292 [1.4449, 2.0134] n=16 | 1.6667 [1.2415, 2.0919] n=16 | **-0.0625** [-0.654, 0.529] |
| deathsContest | 2.5208 [2.0812, 2.9605] n=16 | 2.4792 [2.0903, 2.8681] n=16 | **-0.0417** [-0.6632, 0.5799] |
| deathsTeammate | 0.8542 [0.66, 1.0484] n=16 | 0.8958 [0.6007, 1.191] n=16 | **0.0417** [-0.3678, 0.4511] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 5730.3958 [5166.9184, 6293.8732] n=16 | 6294.3542 [5598.6239, 6990.0845] n=16 | **563.9583** [-319.9429, 1447.8596] |
| clusterEnumMs | 24955.7292 [23683.2957, 26228.1627] n=16 | 26785.6667 [24962.7823, 28608.5511] n=16 | **1829.9375** [-521.1495, 4181.0245] |
| selectionFar | — | 51997.9167 [26499.4658, 77496.3676] n=16 | — |
| selectionDraws | — | 2121252.6667 [1478561.0866, 2763944.2467] n=16 | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1505.9792 [1414.0934, 1597.8649] n=16 | 1642.8125 [1524.4949, 1761.1301] n=16 | **136.8333** [-21.9495, 295.6162] |
| scoutPlies | 2030.4167 [1916.9022, 2143.9311] n=16 | 2284.3125 [2113.473, 2455.152] n=16 | **253.8958** [40.0088, 467.7829] ✱ |
| scoutRefusals | 0.0833 [0.0039, 0.1628] n=16 | 0.1458 [-0.0372, 0.3289] n=16 | **0.0625** [-0.1117, 0.2367] |
| ceilingDecided | 4436.25 [2549.2162, 6323.2838] n=16 | 1584.2292 [805.0533, 2363.405] n=16 | **-2852.0208** [-4853.78, -850.2617] ✱ |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0.0208 [-0.0236, 0.0652] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **0** [-0.0648, 0.0648] |
| ~~plansEvaluated~~ (retired) | 63677.7708 [43274.035, 84081.5066] n=16 | 28193.7083 [11454.7436, 44932.6731] n=16 | **-35484.0625** [-65049.6988, -5918.4262] ✱ |
| ~~boundsInversions~~ (retired) | 7211 [3972.8096, 10449.1904] n=16 | 22832.3333 [3536.2849, 42128.3817] n=16 | **15621.3333** [-4011.7608, 35254.4275] |

