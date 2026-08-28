# Paired aggregation — 20260827-overnight

Base arm: `integrated`. Generated 2026-08-28T01:36:30.922Z.

Intervals are 95% t over BLOCK means; `n` is the number of seeds. A delta whose
interval includes zero is a NULL RESULT and must be written up as one.

**Placement resolution.** At 16 blocks the normalized placement score resolves to
roughly ±0.10. A |delta score| under that is not a small effect, it is no effect
this design can see — read the mechanism rows instead.

## p1-substrate-headline

Subject: `integrated:lobster-territory perf-substrate:lobster-territory` · arms: integrated, perf-substrate · paired 144 games

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.333, perf-substrate 0.271

| metric | integrated (level) | perf-substrate (level) | Δ perf-substrate−integrated [95% CI] |
|---|---|---|---|
| score | 0.6979 [0.6171, 0.7788] n=16 | 0.6875 [0.5965, 0.7785] n=16 | **-0.0104** [-0.1294, 0.1086] |
| win | 0.4375 [0.2966, 0.5784] n=16 | 0.3958 [0.2216, 0.5701] n=16 | **-0.0417** [-0.2555, 0.1722] |
| place | 1.6042 [1.4425, 1.7659] n=16 | 1.625 [1.443, 1.807] n=16 | **0.0208** [-0.2171, 0.2588] |
| finalMaterial | 16.5208 [11.4705, 21.5712] n=16 | 15.5417 [10.1475, 20.9358] n=16 | **-0.9792** [-8.7609, 6.8025] |
| finalUnits | 2.5833 [1.8986, 3.268] n=16 | 2.5625 [1.7906, 3.3344] n=16 | **-0.0208** [-1.001, 0.9593] |
| survived | 0.625 [0.4678, 0.7822] n=16 | 0.5625 [0.4074, 0.7176] n=16 | **-0.0625** [-0.3155, 0.1905] |
| turns | 67.1667 [54.6633, 79.67] n=16 | 64.8958 [51.3551, 78.4366] n=16 | **-2.2708** [-23.6754, 19.1337] |
| decisive | 0.6667 [0.5217, 0.8117] n=16 | 0.7292 [0.581, 0.8773] n=16 | **0.0625** [-0.1986, 0.3236] |
| decisions | 66.8333 [54.0582, 79.6085] n=16 | 64.6667 [50.9429, 78.3904] n=16 | **-2.1667** [-23.8937, 19.5603] |
| worstWallMs | 1943.6042 [1935.5287, 1951.6796] n=16 | 1951.0833 [1945.6131, 1956.5536] n=16 | **7.4792** [-2.7372, 17.6956] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0117 [0.0029, 0.0204] n=16 | 0.0019 [-0.0011, 0.0049] n=16 | **-0.0098** [-0.0194, -0.0002] ✱ |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 4755.6875 [2703.2915, 6808.0835] n=16 | 6283.0833 [3514.3034, 9051.8632] n=16 | **1527.3958** [-2558.7278, 5613.5194] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.979, perf-substrate 0.917

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | perf-substrate (level) | Δ perf-substrate−integrated [95% CI] |
|---|---|---|---|
| score | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| win | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| place | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| finalMaterial | 40.3958 [37.0513, 43.7403] n=16 | 39.4375 [36.6284, 42.2466] n=16 | **-0.9583** [-4.639, 2.7223] |
| finalUnits | 4.875 [4.5089, 5.2411] n=16 | 4.8125 [4.5156, 5.1094] n=16 | **-0.0625** [-0.4788, 0.3538] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 119.6042 [118.7606, 120.4477] n=16 | 118.8958 [117.6643, 120.1274] n=16 | **-0.7083** [-2.2872, 0.8706] |
| decisive | 0.0208 [-0.0236, 0.0652] n=16 | 0.0833 [0.0039, 0.1628] n=16 | **0.0625** [-0.0341, 0.1591] |
| decisions | 119.6042 [118.7606, 120.4477] n=16 | 118.8958 [117.6643, 120.1274] n=16 | **-0.7083** [-2.2872, 0.8706] |
| worstWallMs | 1962.8125 [1962.2662, 1963.3588] n=16 | 1964.7292 [1963.2332, 1966.2251] n=16 | **1.9167** [0.2794, 3.5539] ✱ |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=16 | 0.0017 [-0.0001, 0.0036] n=16 | **0.0017** [-0.0001, 0.0036] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 128381.125 [123713.5569, 133048.6931] n=16 | 131096.9583 [125509.5909, 136684.3257] n=16 | **2715.8333** [-794.4092, 6226.0758] |
| ~~boundsInversions~~ (retired) | 33.0625 [-37.3937, 103.5187] n=16 | 0 [0, 0] n=16 | **-33.0625** [-103.5187, 37.3937] |

### cell `snake5-queen` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.958, perf-substrate 0.958

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | perf-substrate (level) | Δ perf-substrate−integrated [95% CI] |
|---|---|---|---|
| score | 0.7188 [0.6078, 0.8297] n=16 | 0.7188 [0.6653, 0.7722] n=16 | **0** [-0.1123, 0.1123] |
| win | 0.5 [0.3284, 0.6716] n=16 | 0.4375 [0.3306, 0.5444] n=16 | **-0.0625** [-0.2367, 0.1117] |
| place | 1.5625 [1.3405, 1.7845] n=16 | 1.5625 [1.4556, 1.6694] n=16 | **0** [-0.2246, 0.2246] |
| finalMaterial | 29.9792 [25.2904, 34.6679] n=16 | 32.0417 [28.909, 35.1743] n=16 | **2.0625** [-3.5345, 7.6595] |
| finalUnits | 1.1667 [0.9833, 1.3501] n=16 | 1.3125 [1.1754, 1.4496] n=16 | **0.1458** [-0.0589, 0.3506] |
| survived | 0.9167 [0.8141, 1.0192] n=16 | 1 [1, 1] n=16 | **0.0833** [-0.0192, 0.1859] |
| turns | 118.4583 [115.9579, 120.9587] n=16 | 118.8125 [117.0811, 120.5439] n=16 | **0.3542** [-2.8643, 3.5726] |
| decisive | 0.0417 [-0.019, 0.1023] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **0** [-0.0917, 0.0917] |
| decisions | 116.375 [112.2164, 120.5336] n=16 | 118.8125 [117.0811, 120.5439] n=16 | **2.4375** [-2.3477, 7.2227] |
| worstWallMs | 1961.1875 [1960.1562, 1962.2188] n=16 | 1965.2083 [1961.9173, 1968.4994] n=16 | **4.0208** [0.3318, 7.7098] ✱ |
| overrunRate | 0 [0, 0] n=16 | 0.0003 [-0.0002, 0.0009] n=16 | **0.0003** [-0.0002, 0.0009] |
| unstagedRate | 0.0005 [-0.0006, 0.0016] n=16 | 0.0003 [-0.0004, 0.0011] n=16 | **-0.0002** [-0.0015, 0.0012] |
| stagedNothingRate | 0.0002 [-0.0002, 0.0005] n=16 | 0.0002 [-0.0002, 0.0005] n=16 | **0** [-0.0005, 0.0005] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=16 | 0.0025 [-0.0011, 0.006] n=16 | **0.0025** [-0.0011, 0.006] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0.0208 [-0.0236, 0.0652] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **0** [-0.0648, 0.0648] |
| ~~plansEvaluated~~ (retired) | 70422.2917 [46054.2633, 94790.32] n=16 | 92150.5833 [72941.9989, 111359.1678] n=16 | **21728.2917** [929.6483, 42526.935] ✱ |
| ~~boundsInversions~~ (retired) | 19210.7708 [10393.0635, 28028.4782] n=16 | 33257.5417 [10199.9324, 56315.1509] n=16 | **14046.7708** [-12368.1767, 40461.7184] |

## p2-legacy-rebaseline

Subject: `integrated:lobster-territory legacy:lobster-territory` · arms: integrated, legacy · paired 144 games

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.313, legacy 0.354

| metric | integrated (level) | legacy (level) | Δ legacy−integrated [95% CI] |
|---|---|---|---|
| score | 0.8021 [0.728, 0.8762] n=16 | 0.7396 [0.6604, 0.8188] n=16 | **-0.0625** [-0.1644, 0.0394] |
| win | 0.6042 [0.456, 0.7523] n=16 | 0.5208 [0.3624, 0.6793] n=16 | **-0.0833** [-0.2832, 0.1165] |
| place | 1.3958 [1.2477, 1.544] n=16 | 1.5208 [1.3624, 1.6793] n=16 | **0.125** [-0.0788, 0.3288] |
| finalMaterial | 22.9583 [17.869, 28.0476] n=16 | 23.2083 [17.4775, 28.9392] n=16 | **0.25** [-6.8363, 7.3363] |
| finalUnits | 3.1458 [2.4943, 3.7974] n=16 | 2.8958 [2.1863, 3.6053] n=16 | **-0.25** [-1.0322, 0.5322] |
| survived | 0.75 [0.6124, 0.8876] n=16 | 0.6875 [0.5359, 0.8391] n=16 | **-0.0625** [-0.2242, 0.0992] |
| turns | 77.0833 [63.8035, 90.3632] n=16 | 78.2292 [65.1873, 91.271] n=16 | **1.1458** [-13.8368, 16.1285] |
| decisive | 0.6875 [0.5359, 0.8391] n=16 | 0.6458 [0.4942, 0.7975] n=16 | **-0.0417** [-0.2454, 0.1621] |
| decisions | 77.0833 [63.8035, 90.3632] n=16 | 77.8542 [64.6791, 91.0292] n=16 | **0.7708** [-14.2107, 15.7523] |
| worstWallMs | 1949.5833 [1945.4462, 1953.7204] n=16 | 1948.1875 [1943.8362, 1952.5388] n=16 | **-1.3958** [-7.2999, 4.5083] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0083 [0.0022, 0.0145] n=16 | 0.0306 [0.0058, 0.0554] n=16 | **0.0223** [-0.0036, 0.0482] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 4979.5833 [2834.9584, 7124.2083] n=16 | 6451.6042 [-98.9325, 13002.1409] n=16 | **1472.0208** [-5338.2959, 8282.3376] |
| ~~boundsInversions~~ (retired) | 202.7917 [-223.5207, 629.104] n=16 | 18.0833 [-16.5896, 52.7563] n=16 | **-184.7083** [-615.0162, 245.5995] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.917, legacy 0.917

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | legacy (level) | Δ legacy−integrated [95% CI] |
|---|---|---|---|
| score | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| win | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| place | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| finalMaterial | 41.1667 [37.1836, 45.1497] n=16 | 40.9792 [37.9638, 43.9946] n=16 | **-0.1875** [-3.7486, 3.3736] |
| finalUnits | 4.9167 [4.5527, 5.2806] n=16 | 4.9167 [4.5892, 5.2441] n=16 | **0** [-0.4101, 0.4101] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 119.25 [118.2278, 120.2722] n=16 | 119.6042 [119.0455, 120.1628] n=16 | **0.3542** [-0.8264, 1.5347] |
| decisive | 0.0833 [-0.0192, 0.1859] n=16 | 0.0833 [-0.0192, 0.1859] n=16 | **0** [-0.0917, 0.0917] |
| decisions | 119.25 [118.2278, 120.2722] n=16 | 119.6042 [119.0455, 120.1628] n=16 | **0.3542** [-0.8264, 1.5347] |
| worstWallMs | 1961.9375 [1961.3182, 1962.5568] n=16 | 1962.4792 [1961.5925, 1963.3658] n=16 | **0.5417** [-0.6396, 1.723] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 124093.125 [116748.1091, 131438.1409] n=16 | 125428.4792 [117948.5926, 132908.3657] n=16 | **1335.3542** [-5193.479, 7864.1873] |
| ~~boundsInversions~~ (retired) | 666.7708 [-720.4812, 2054.0228] n=16 | 647.75 [-732.6052, 2028.1052] n=16 | **-19.0208** [-51.49, 13.4483] |

### cell `snake5-knight` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.979, legacy 1

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | legacy (level) | Δ legacy−integrated [95% CI] |
|---|---|---|---|
| score | 0.4687 [0.3816, 0.5559] n=16 | 0.5 [0.3877, 0.6123] n=16 | **0.0313** [-0.0559, 0.1184] |
| win | 0.3125 [0.2339, 0.3911] n=16 | 0.2708 [0.1545, 0.3872] n=16 | **-0.0417** [-0.1305, 0.0471] |
| place | 2.0625 [1.8883, 2.2367] n=16 | 2 [1.7754, 2.2246] n=16 | **-0.0625** [-0.2367, 0.1117] |
| finalMaterial | 6.5833 [5.6425, 7.5241] n=16 | 7.2917 [6.2185, 8.3648] n=16 | **0.7083** [-0.2727, 1.6893] |
| finalUnits | 1.5625 [1.3823, 1.7427] n=16 | 1.6667 [1.5078, 1.8255] n=16 | **0.1042** [-0.0509, 0.2592] |
| survived | 0.9375 [0.8659, 1.0091] n=16 | 0.9792 [0.9348, 1.0236] n=16 | **0.0417** [-0.019, 0.1023] |
| turns | 118.6667 [115.8253, 121.508] n=16 | 120 [120, 120] n=16 | **1.3333** [-1.508, 4.1747] |
| decisive | 0.0208 [-0.0236, 0.0652] n=16 | 0 [0, 0] n=16 | **-0.0208** [-0.0652, 0.0236] |
| decisions | 117.0625 [113.5614, 120.5636] n=16 | 119.1458 [117.3256, 120.9661] n=16 | **2.0833** [-1.0824, 5.2491] |
| worstWallMs | 1962.8542 [1962.2494, 1963.4589] n=16 | 1963.1458 [1962.6521, 1963.6395] n=16 | **0.2917** [-0.4242, 1.0075] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 226226.8333 [197897.3917, 254556.275] n=16 | 239115.9792 [198599.4581, 279632.5003] n=16 | **12889.1458** [-12834.3824, 38612.6741] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

## Integrity problems

(51 entries in the on-disk original — dominated by other experiments' sweeps being skipped for this pass's base arm, which is expected in a multi-experiment batch; full list in the zip archive.)