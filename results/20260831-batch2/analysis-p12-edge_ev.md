# Paired aggregation — p12-edge_ev

Base arm: `default`. Generated 2026-08-30T19:50:05.909Z.

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

## p12-edge_ev

Subject: `default:lobster-territory edge-ev:lobster-territory` · arms: default, edge-ev · paired 144 games

**Arm audit** — the flags each engine RESOLVED:

| flag | default | edge-ev |
|---|---|---|
| `edgeEv` | false | true |
| `name` | default | lobster-territory |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.146, edge-ev 0.188

| metric | default (level) | edge-ev (level) | Δ edge-ev−default [95% CI] |
|---|---|---|---|
| sharePar | 1.618 [1.1509, 2.0851] n=16 | 1.4411 [1.0293, 1.8529] n=16 | **-0.1769** [-0.7615, 0.4077] |
| score | 0.7604 [0.6812, 0.8396] n=16 | 0.7187 [0.6412, 0.7963] n=16 | **-0.0417** [-0.1362, 0.0529] |
| win | 0.5417 [0.3845, 0.6988] n=16 | 0.4583 [0.3152, 0.6015] n=16 | **-0.0833** [-0.2724, 0.1057] |
| place | 1.4792 [1.3207, 1.6376] n=16 | 1.5625 [1.4074, 1.7176] n=16 | **0.0833** [-0.1057, 0.2724] |
| finalMaterial | 16.9375 [11.9301, 21.9449] n=16 | 16.7292 [10.2401, 23.2182] n=16 | **-0.2083** [-9.3899, 8.9732] |
| finalUnits | 2.6458 [1.8504, 3.4413] n=16 | 2.5208 [1.7455, 3.2962] n=16 | **-0.125** [-1.0887, 0.8387] |
| survived | 0.5833 [0.418, 0.7487] n=16 | 0.5833 [0.418, 0.7487] n=16 | **0** [-0.2426, 0.2426] |
| turns | 59.1875 [50.3093, 68.0657] n=16 | 64.8333 [52.7396, 76.9271] n=16 | **5.6458** [-10.039, 21.3307] |
| decisive | 0.8542 [0.7424, 0.9659] n=16 | 0.8125 [0.6833, 0.9417] n=16 | **-0.0417** [-0.2454, 0.1621] |
| decisions | 58.5625 [49.0756, 68.0494] n=16 | 64.3125 [52.0709, 76.5541] n=16 | **5.75** [-9.9713, 21.4713] |
| worstWallMs | 1997.0833 [1942.0525, 2052.1141] n=16 | 1977.25 [1933.9405, 2020.5595] n=16 | **-19.8333** [-44.1155, 4.4488] |
| overrunRate | 0.0103 [-0.0018, 0.0224] n=16 | 0.0037 [-0.0006, 0.008] n=16 | **-0.0066** [-0.0161, 0.0028] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0023 [-0.0009, 0.0054] n=16 | 0.0015 [-0.0007, 0.0036] n=16 | **-0.0008** [-0.0049, 0.0033] |
| deathsSelf | 0.0417 [-0.019, 0.1023] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.0208** [-0.0994, 0.0578] |
| deathsWall | 0.0625 [-0.0091, 0.1341] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.0417** [-0.1305, 0.0471] |
| deathsExhaustion | 0.0417 [-0.019, 0.1023] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **0.0208** [-0.0578, 0.0994] |
| deathsBodyBlock | 0.2917 [0.1345, 0.4488] n=16 | 0.3333 [0.1618, 0.5049] n=16 | **0.0417** [-0.2247, 0.308] |
| deathsContest | 1.4792 [1.1487, 1.8096] n=16 | 1.5208 [1.1374, 1.9043] n=16 | **0.0417** [-0.4559, 0.5392] |
| deathsTeammate | 0.0625 [-0.0091, 0.1341] n=16 | 0.1042 [-0.0028, 0.2111] n=16 | **0.0417** [-0.1015, 0.1848] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 137372.8333 [115115.0556, 159630.611] n=16 | 145404.9167 [126402.3212, 164407.5122] n=16 | **8032.0833** [-21707.1891, 37771.3557] |
| clusterEnumMs | 29337.4792 [25303.4903, 33371.468] n=16 | 35734.625 [30636.935, 40832.315] n=16 | **6397.1458** [203.9014, 12590.3903] ✱ |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1431.5 [1192.2822, 1670.7178] n=16 | 1535.7292 [1256.7752, 1814.6831] n=16 | **104.2292** [-244.8135, 453.2718] |
| scoutPlies | 1311.8958 [1091.2926, 1532.4991] n=16 | 1503.3333 [1224.7759, 1781.8907] n=16 | **191.4375** [-145.9686, 528.8436] |
| scoutRefusals | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ceilingDecided | 540.3125 [85.0172, 995.6078] n=16 | 336.5208 [198.5776, 474.464] n=16 | **-203.7917** [-697.8305, 290.2471] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 8025.6042 [1789.2727, 14261.9356] n=16 | 4437.9167 [668.6492, 8207.1841] n=16 | **-3587.6875** [-11692.1989, 4516.8239] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.958, edge-ev 0.896

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | edge-ev (level) | Δ edge-ev−default [95% CI] |
|---|---|---|---|
| sharePar | 2.2994 [2.1886, 2.4102] n=16 | 2.3454 [2.2348, 2.4561] n=16 | **0.046** [-0.0339, 0.126] |
| score | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| win | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| place | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| finalMaterial | 40.6042 [37.903, 43.3053] n=16 | 39.9583 [37.7112, 42.2054] n=16 | **-0.6458** [-3.0305, 1.7389] |
| finalUnits | 4.875 [4.5452, 5.2048] n=16 | 4.875 [4.5388, 5.2112] n=16 | **0** [-0.311, 0.311] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 119.4792 [118.5784, 120.3799] n=16 | 118.8333 [117.6254, 120.0412] n=16 | **-0.6458** [-1.5685, 0.2768] |
| decisive | 0.0417 [-0.019, 0.1023] n=16 | 0.1042 [0.0192, 0.1892] n=16 | **0.0625** [-0.0091, 0.1341] |
| decisions | 119.4792 [118.5784, 120.3799] n=16 | 118.8333 [117.6254, 120.0412] n=16 | **-0.6458** [-1.5685, 0.2768] |
| worstWallMs | 1987.9167 [1976.3889, 1999.4445] n=16 | 1981.0625 [1976.5999, 1985.5251] n=16 | **-6.8542** [-18.0608, 4.3524] |
| overrunRate | 0.0032 [0.0012, 0.0051] n=16 | 0.0017 [0.0005, 0.0029] n=16 | **-0.0014** [-0.0031, 0.0003] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0174 [0.0105, 0.0243] n=16 | 0.2801 [-0.1022, 0.6624] n=16 | **0.2627** [-0.1227, 0.6481] |
| deathsSelf | 0.3542 [0.1346, 0.5738] n=16 | 0.375 [0.1712, 0.5788] n=16 | **0.0208** [-0.1564, 0.198] |
| deathsWall | 0.1875 [0.043, 0.332] n=16 | 0.1667 [0.037, 0.2964] n=16 | **-0.0208** [-0.0652, 0.0236] |
| deathsExhaustion | 0.1667 [0.0544, 0.279] n=16 | 0.1667 [0.037, 0.2964] n=16 | **0** [-0.1123, 0.1123] |
| deathsBodyBlock | 0.125 [-0.0026, 0.2526] n=16 | 0.1458 [0.0341, 0.2576] n=16 | **0.0208** [-0.1308, 0.1725] |
| deathsContest | 0.2917 [0.1485, 0.4348] n=16 | 0.2708 [0.1227, 0.419] n=16 | **-0.0208** [-0.0994, 0.0578] |
| deathsTeammate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 4788.1875 [4359.5803, 5216.7947] n=16 | 4723.6875 [4346.7458, 5100.6292] n=16 | **-64.5** [-413.7513, 284.7513] |
| clusterEnumMs | 2419.8333 [2278.9518, 2560.7149] n=16 | 2585.5208 [2384.0417, 2786.9999] n=16 | **165.6875** [60.8782, 270.4968] ✱ |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1432.2708 [1385.1863, 1479.3554] n=16 | 1431.5208 [1389.749, 1473.2926] n=16 | **-0.75** [-29.9355, 28.4355] |
| scoutPlies | 1191.8125 [1146.2907, 1237.3343] n=16 | 1193.75 [1139.4813, 1248.0187] n=16 | **1.9375** [-45.3447, 49.2197] |
| scoutRefusals | 315.7083 [305.9107, 325.506] n=16 | 314.2708 [305.4945, 323.0472] n=16 | **-1.4375** [-8.8883, 6.0133] |
| ceilingDecided | 370.0417 [106.9259, 633.1574] n=16 | 405.5 [132.0212, 678.9788] n=16 | **35.4583** [-180.8975, 251.8142] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 352145.4792 [327181.3784, 377109.58] n=16 | 371124.9583 [325221.3226, 417028.5941] n=16 | **18979.4792** [-9521.9097, 47480.868] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

### cell `snake5-queen` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.833, edge-ev 0.917

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | edge-ev (level) | Δ edge-ev−default [95% CI] |
|---|---|---|---|
| sharePar | 1.6094 [1.3236, 1.8951] n=16 | 1.4832 [1.2827, 1.6837] n=16 | **-0.1262** [-0.398, 0.1457] |
| score | 0.7813 [0.6802, 0.8823] n=16 | 0.7188 [0.6347, 0.8028] n=16 | **-0.0625** [-0.1788, 0.0538] |
| win | 0.5833 [0.3943, 0.7724] n=16 | 0.5 [0.3703, 0.6297] n=16 | **-0.0833** [-0.2724, 0.1057] |
| place | 1.4375 [1.2353, 1.6397] n=16 | 1.5625 [1.3944, 1.7306] n=16 | **0.125** [-0.1077, 0.3577] |
| finalMaterial | 32.6875 [26.9648, 38.4102] n=16 | 32.1042 [28.1055, 36.1029] n=16 | **-0.5833** [-7.0282, 5.8616] |
| finalUnits | 1.3958 [1.0767, 1.7149] n=16 | 1.375 [1.2318, 1.5182] n=16 | **-0.0208** [-0.3544, 0.3128] |
| survived | 0.9167 [0.8141, 1.0192] n=16 | 0.9167 [0.8372, 0.9961] n=16 | **0** [-0.145, 0.145] |
| turns | 114.625 [110.5595, 118.6905] n=16 | 118.3542 [116.6915, 120.0168] n=16 | **3.7292** [-0.7358, 8.1941] |
| decisive | 0.1667 [0.037, 0.2964] n=16 | 0.0833 [0.0039, 0.1628] n=16 | **-0.0833** [-0.2209, 0.0542] |
| decisions | 114.2083 [110.2132, 118.2034] n=16 | 117.0417 [114.6338, 119.4495] n=16 | **2.8333** [-2.403, 8.0697] |
| worstWallMs | 1971.9583 [1957.0354, 1986.8812] n=16 | 1968.4375 [1963.1473, 1973.7277] n=16 | **-3.5208** [-20.058, 13.0164] |
| overrunRate | 0.0002 [-0.0002, 0.0005] n=16 | 0.001 [-0.0005, 0.0025] n=16 | **0.0008** [-0.0008, 0.0024] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0008 [-0.0005, 0.0021] n=16 | 0.0017 [-0.0005, 0.0039] n=16 | **0.0009** [-0.0018, 0.0036] |
| deathsSelf | 0.1875 [0.0583, 0.3167] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **-0.125** [-0.2822, 0.0322] |
| deathsWall | 0.1458 [-0.0126, 0.3043] n=16 | 0.125 [0.0151, 0.2349] n=16 | **-0.0208** [-0.1858, 0.1441] |
| deathsExhaustion | 0.2917 [0.1345, 0.4488] n=16 | 0.2292 [0.1041, 0.3542] n=16 | **-0.0625** [-0.2484, 0.1234] |
| deathsBodyBlock | 1.3333 [1.0362, 1.6305] n=16 | 1.7083 [1.3309, 2.0857] n=16 | **0.375** [-0.0965, 0.8465] |
| deathsContest | 2.6458 [2.2086, 3.0831] n=16 | 2.5 [2.1109, 2.8891] n=16 | **-0.1458** [-0.8381, 0.5464] |
| deathsTeammate | 0.8125 [0.5977, 1.0273] n=16 | 0.8542 [0.6118, 1.0965] n=16 | **0.0417** [-0.2474, 0.3308] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 6303.3333 [5768.2396, 6838.4271] n=16 | 5461.7083 [4961.9041, 5961.5125] n=16 | **-841.625** [-1370.1048, -313.1452] ✱ |
| clusterEnumMs | 25058.75 [23616.886, 26500.614] n=16 | 25335.7083 [23724.9717, 26946.445] n=16 | **276.9583** [-889.6622, 1443.5789] |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1614.2083 [1522.7119, 1705.7048] n=16 | 1514.7917 [1392.2174, 1637.3659] n=16 | **-99.4167** [-244.906, 46.0726] |
| scoutPlies | 2064.6667 [1909.9807, 2219.3526] n=16 | 2037.9167 [1900.0761, 2175.7572] n=16 | **-26.75** [-200.7037, 147.2037] |
| scoutRefusals | 0.1667 [-0.1443, 0.4776] n=16 | 0.2917 [-0.0744, 0.6578] n=16 | **0.125** [-0.3809, 0.6309] |
| ceilingDecided | 4076.1667 [2641.0016, 5511.3317] n=16 | 3279.125 [2182.4816, 4375.7684] n=16 | **-797.0417** [-2234.198, 640.1146] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 59919.8125 [39457.6484, 80381.9766] n=16 | 75247.5833 [55952.171, 94542.9957] n=16 | **15327.7708** [-8406.283, 39061.8246] |
| ~~boundsInversions~~ (retired) | 12590.2917 [3523.279, 21657.3043] n=16 | 15011.5 [8273.9333, 21749.0667] n=16 | **2421.2083** [-6555.2687, 11397.6854] |

