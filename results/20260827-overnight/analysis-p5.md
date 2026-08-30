# Paired aggregation — 20260827-overnight

Base arm: `wasm-off`. Generated 2026-08-28T01:30:02.467Z.

Intervals are 95% t over BLOCK means; `n` is the number of seeds. A delta whose
interval includes zero is a NULL RESULT and must be written up as one.

**Placement resolution.** At 16 blocks the normalized placement score resolves to
roughly ±0.10. A |delta score| under that is not a small effect, it is no effect
this design can see — read the mechanism rows instead.

## p5-wasm-arena

Subject: `wasm-off:lobster-territory wasm-on:lobster-territory` · arms: wasm-off, wasm-on · paired 144 games

### cell `hazard-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards cross, potions false

48 games in 16 blocks. cap-terminal rate: wasm-off 0.396, wasm-on 0.417

| metric | wasm-off (level) | wasm-on (level) | Δ wasm-on−wasm-off [95% CI] |
|---|---|---|---|
| score | 0.7813 [0.7108, 0.8517] n=16 | 0.8125 [0.7339, 0.8911] n=16 | **0.0313** [-0.0952, 0.1577] |
| win | 0.5625 [0.4216, 0.7034] n=16 | 0.6458 [0.5088, 0.7829] n=16 | **0.0833** [-0.1549, 0.3216] |
| place | 1.4375 [1.2966, 1.5784] n=16 | 1.375 [1.2178, 1.5322] n=16 | **-0.0625** [-0.3155, 0.1905] |
| finalMaterial | 22.4583 [17.1301, 27.7866] n=16 | 24.2708 [19.0521, 29.4896] n=16 | **1.8125** [-7.1985, 10.8235] |
| finalUnits | 2.8125 [2.1325, 3.4925] n=16 | 3.1667 [2.594, 3.7394] n=16 | **0.3542** [-0.6302, 1.3386] |
| survived | 0.6875 [0.5359, 0.8391] n=16 | 0.75 [0.6124, 0.8876] n=16 | **0.0625** [-0.182, 0.307] |
| turns | 78.2917 [65.4214, 91.1619] n=16 | 79.875 [69.4194, 90.3306] n=16 | **1.5833** [-12.1876, 15.3542] |
| decisive | 0.6042 [0.4425, 0.7659] n=16 | 0.5833 [0.4458, 0.7209] n=16 | **-0.0208** [-0.2204, 0.1787] |
| decisions | 78.2917 [65.4214, 91.1619] n=16 | 79.1458 [68.6549, 89.6368] n=16 | **0.8542** [-13.5955, 15.3038] |
| worstWallMs | 1953.9375 [1950.8684, 1957.0066] n=16 | 1955.0833 [1952.9558, 1957.2109] n=16 | **1.1458** [-2.5229, 4.8145] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.006 [0.0004, 0.0117] n=16 | 0 [0, 0] n=16 | **-0.006** [-0.0117, -0.0004] ✱ |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 9427.2708 [4595.0332, 14259.5084] n=16 | 11499.9583 [7314.013, 15685.9037] n=16 | **2072.6875** [-4490.7572, 8636.1322] |
| ~~boundsInversions~~ (retired) | 493.4792 [-365.0814, 1352.0397] n=16 | 318.2708 [-267.1518, 903.6935] n=16 | **-175.2083** [-1237.4785, 887.0618] |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: wasm-off 0.229, wasm-on 0.458

| metric | wasm-off (level) | wasm-on (level) | Δ wasm-on−wasm-off [95% CI] |
|---|---|---|---|
| score | 0.75 [0.6527, 0.8473] n=16 | 0.75 [0.6642, 0.8358] n=16 | **0** [-0.1297, 0.1297] |
| win | 0.5208 [0.3497, 0.692] n=16 | 0.5 [0.3284, 0.6716] n=16 | **-0.0208** [-0.2498, 0.2081] |
| place | 1.5 [1.3055, 1.6945] n=16 | 1.5 [1.3284, 1.6716] n=16 | **0** [-0.2594, 0.2594] |
| finalMaterial | 16.1458 [11.2743, 21.0173] n=16 | 23.8333 [17.9243, 29.7424] n=16 | **7.6875** [-0.309, 15.684] |
| finalUnits | 2.8125 [1.9048, 3.7202] n=16 | 3.1042 [2.4127, 3.7957] n=16 | **0.2917** [-0.923, 1.5063] |
| survived | 0.6042 [0.4299, 0.7784] n=16 | 0.75 [0.5979, 0.9021] n=16 | **0.1458** [-0.0785, 0.3702] |
| turns | 63.8542 [52.5203, 75.188] n=16 | 85.2917 [70.2089, 100.3745] n=16 | **21.4375** [0.4675, 42.4075] ✱ |
| decisive | 0.7708 [0.6458, 0.8959] n=16 | 0.5417 [0.3845, 0.6988] n=16 | **-0.2292** [-0.4511, -0.0072] ✱ |
| decisions | 63.5417 [52.1895, 74.8938] n=16 | 85.2917 [70.2089, 100.3745] n=16 | **21.75** [0.9374, 42.5626] ✱ |
| worstWallMs | 1953.0208 [1949.9936, 1956.0481] n=16 | 1952.9167 [1949.8852, 1955.9481] n=16 | **-0.1042** [-3.9833, 3.775] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0034 [-0.0011, 0.0079] n=16 | 0.0034 [-0.0001, 0.0069] n=16 | **0** [-0.0063, 0.0063] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 8466.5417 [3660.8843, 13272.1991] n=16 | 7534.7083 [4256.7806, 10812.636] n=16 | **-931.8333** [-5893.4697, 4029.803] |
| ~~boundsInversions~~ (retired) | 10.9792 [-11.5334, 33.4918] n=16 | 1.125 [-1.2724, 3.5224] n=16 | **-9.8542** [-32.6586, 12.9503] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: wasm-off 0.917, wasm-on 1

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | wasm-off (level) | wasm-on (level) | Δ wasm-on−wasm-off [95% CI] |
|---|---|---|---|
| score | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| win | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| place | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| finalMaterial | 39.7083 [36.3117, 43.105] n=16 | 40.4167 [37.9191, 42.9142] n=16 | **0.7083** [-3.1952, 4.6119] |
| finalUnits | 4.8542 [4.4494, 5.259] n=16 | 4.9583 [4.7082, 5.2084] n=16 | **0.1042** [-0.3246, 0.5329] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 118.6667 [116.7974, 120.5359] n=16 | 120 [120, 120] n=16 | **1.3333** [-0.5359, 3.2026] |
| decisive | 0.0833 [-0.0192, 0.1859] n=16 | 0 [0, 0] n=16 | **-0.0833** [-0.1859, 0.0192] |
| decisions | 118.6667 [116.7974, 120.5359] n=16 | 120 [120, 120] n=16 | **1.3333** [-0.5359, 3.2026] |
| worstWallMs | 1965.1875 [1963.9884, 1966.3866] n=16 | 1963.1875 [1962.4149, 1963.9601] n=16 | **-2** [-3.2149, -0.7851] ✱ |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0005 [-0.0003, 0.0013] n=16 | 0 [0, 0] n=16 | **-0.0005** [-0.0013, 0.0003] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 132897.3958 [121910.8822, 143883.9095] n=16 | 166407.2708 [133516.2009, 199298.3408] n=16 | **33509.875** [998.9398, 66020.8102] ✱ |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

## Integrity problems

(7 entries in the on-disk original — dominated by other experiments' sweeps being skipped for this pass's base arm, which is expected in a multi-experiment batch; full list in the zip archive.)