# Paired aggregation — 20260827-overnight

Base arm: `integrated`. Generated 2026-08-28T01:36:31.280Z.

Intervals are 95% t over BLOCK means; `n` is the number of seeds. A delta whose
interval includes zero is a NULL RESULT and must be written up as one.

**Placement resolution.** At 16 blocks the normalized placement score resolves to
roughly ±0.10. A |delta score| under that is not a small effect, it is no effect
this design can see — read the mechanism rows instead.

## p3-slider-2000

Subject: `integrated:lobster-territory slider:lobster-slider` · arms: integrated, slider · paired 192 games

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.25, slider 0.292

| metric | integrated (level) | slider (level) | Δ slider−integrated [95% CI] |
|---|---|---|---|
| score | 0.7396 [0.654, 0.8252] n=16 | 0.7708 [0.6922, 0.8494] n=16 | **0.0313** [-0.091, 0.1535] |
| win | 0.5208 [0.3763, 0.6654] n=16 | 0.5417 [0.3845, 0.6988] n=16 | **0.0208** [-0.1988, 0.2404] |
| place | 1.5208 [1.3497, 1.692] n=16 | 1.4583 [1.3012, 1.6155] n=16 | **-0.0625** [-0.307, 0.182] |
| finalMaterial | 19.9167 [14.3671, 25.4663] n=16 | 20.2083 [14.0304, 26.3862] n=16 | **0.2917** [-7.9749, 8.5582] |
| finalUnits | 3.125 [2.5276, 3.7224] n=16 | 2.7292 [2.0577, 3.4006] n=16 | **-0.3958** [-1.3225, 0.5308] |
| survived | 0.6875 [0.5504, 0.8246] n=16 | 0.6042 [0.4425, 0.7659] n=16 | **-0.0833** [-0.2935, 0.1268] |
| turns | 70.7708 [60.1072, 81.4345] n=16 | 66.4792 [52.88, 80.0784] n=16 | **-4.2917** [-20.1676, 11.5843] |
| decisive | 0.75 [0.6287, 0.8713] n=16 | 0.7083 [0.5512, 0.8655] n=16 | **-0.0417** [-0.2454, 0.1621] |
| decisions | 70.3542 [59.6206, 81.0877] n=16 | 66.4792 [52.88, 80.0784] n=16 | **-3.875** [-19.8363, 12.0863] |
| worstWallMs | 1947.2708 [1941.4215, 1953.1202] n=16 | 1925.1667 [1910.0142, 1940.3191] n=16 | **-22.1042** [-36.1483, -8.0601] ✱ |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0114 [0.0027, 0.0202] n=16 | 0.0186 [0.0028, 0.0345] n=16 | **0.0072** [-0.0135, 0.0279] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 5716 [1567.5598, 9864.4402] n=16 | 5993.6875 [-42.0634, 12029.4384] n=16 | **277.6875** [-6600.2734, 7155.6484] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 23.3333 [-26.39, 73.0567] n=16 | **23.3333** [-26.39, 73.0567] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.958, slider 0.979

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | slider (level) | Δ slider−integrated [95% CI] |
|---|---|---|---|
| score | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| win | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| place | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| finalMaterial | 41.6667 [37.7841, 45.5492] n=16 | 39.7083 [36.376, 43.0406] n=16 | **-1.9583** [-6.2099, 2.2932] |
| finalUnits | 4.9792 [4.6519, 5.3064] n=16 | 4.8125 [4.5086, 5.1164] n=16 | **-0.1667** [-0.5869, 0.2536] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 119.4167 [118.4826, 120.3507] n=16 | 119.7917 [119.3477, 120.2356] n=16 | **0.375** [-0.6942, 1.4442] |
| decisive | 0.0417 [-0.019, 0.1023] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.0208** [-0.0994, 0.0578] |
| decisions | 119.4167 [118.4826, 120.3507] n=16 | 119.7917 [119.3477, 120.2356] n=16 | **0.375** [-0.6942, 1.4442] |
| worstWallMs | 1963.875 [1961.5972, 1966.1528] n=16 | 1962.9375 [1961.8443, 1964.0307] n=16 | **-0.9375** [-3.2522, 1.3772] |
| overrunRate | 0.0002 [-0.0002, 0.0005] n=16 | 0 [0, 0] n=16 | **-0.0002** [-0.0005, 0.0002] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 118321.5833 [111035.262, 125607.9046] n=16 | 120964.8333 [115275.2071, 126654.4596] n=16 | **2643.25** [-4937.4403, 10223.9403] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 16.6458 [-18.8264, 52.1181] n=16 | **16.6458** [-18.8264, 52.1181] |

### cell `snake5-pawn` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.896, slider 0.938

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | slider (level) | Δ slider−integrated [95% CI] |
|---|---|---|---|
| score | 0.4271 [0.2975, 0.5566] n=16 | 0.4375 [0.3306, 0.5444] n=16 | **0.0104** [-0.072, 0.0929] |
| win | 0.25 [0.0847, 0.4153] n=16 | 0.3125 [0.1754, 0.4496] n=16 | **0.0625** [-0.0538, 0.1788] |
| place | 2.1458 [1.8867, 2.405] n=16 | 2.125 [1.9112, 2.3388] n=16 | **-0.0208** [-0.1858, 0.1441] |
| finalMaterial | 6.5 [3.8453, 9.1547] n=16 | 7.2292 [5.1605, 9.2978] n=16 | **0.7292** [-0.3148, 1.7732] |
| finalUnits | 1.2917 [0.9314, 1.652] n=16 | 1.3125 [0.9984, 1.6266] n=16 | **0.0208** [-0.1441, 0.1858] |
| survived | 0.6458 [0.4942, 0.7975] n=16 | 0.625 [0.5151, 0.7349] n=16 | **-0.0208** [-0.1227, 0.0811] |
| turns | 117.0625 [113.2316, 120.8934] n=16 | 119.0833 [117.9743, 120.1923] n=16 | **2.0208** [-1.7959, 5.8375] |
| decisive | 0.1042 [0.0192, 0.1892] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **-0.0417** [-0.1023, 0.019] |
| decisions | 101.2708 [93.1699, 109.3718] n=16 | 101.7917 [94.3135, 109.2698] n=16 | **0.5208** [-1.7726, 2.8143] |
| worstWallMs | 1962.875 [1962.3732, 1963.3768] n=16 | 1962.8542 [1962.3912, 1963.3171] n=16 | **-0.0208** [-0.5952, 0.5536] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 272792.625 [230592.1776, 314993.0724] n=16 | 251472.9792 [216406.7693, 286539.189] n=16 | **-21319.6458** [-42820.1936, 180.9019] |
| ~~boundsInversions~~ (retired) | 131.375 [-148.5851, 411.3351] n=16 | 129.7292 [-146.7237, 406.182] n=16 | **-1.6458** [-5.1531, 1.8614] |

### cell `snake5-queen` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: integrated 0.979, slider 0.958

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | slider (level) | Δ slider−integrated [95% CI] |
|---|---|---|---|
| score | 0.6667 [0.5809, 0.7524] n=16 | 0.7812 [0.6972, 0.8653] n=16 | **0.1146** [0.0135, 0.2157] ✱ |
| win | 0.3542 [0.1892, 0.5191] n=16 | 0.5625 [0.3944, 0.7306] n=16 | **0.2083** [-0.0055, 0.4222] |
| place | 1.6667 [1.4951, 1.8382] n=16 | 1.4375 [1.2694, 1.6056] n=16 | **-0.2292** [-0.4313, -0.027] ✱ |
| finalMaterial | 29.7083 [26.3222, 33.0945] n=16 | 33.7292 [30.5842, 36.8741] n=16 | **4.0208** [0.2218, 7.8199] ✱ |
| finalUnits | 1.1458 [1.0341, 1.2576] n=16 | 1.1458 [1.0013, 1.2904] n=16 | **0** [-0.2051, 0.2051] |
| survived | 0.9583 [0.8977, 1.019] n=16 | 0.9792 [0.9348, 1.0236] n=16 | **0.0208** [-0.0578, 0.0994] |
| turns | 119.1875 [117.4561, 120.9189] n=16 | 119.7083 [119.2837, 120.1329] n=16 | **0.5208** [-1.3017, 2.3434] |
| decisive | 0.0208 [-0.0236, 0.0652] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **0.0208** [-0.0578, 0.0994] |
| decisions | 119.1875 [117.4561, 120.9189] n=16 | 119.7083 [119.2837, 120.1329] n=16 | **0.5208** [-1.3017, 2.3434] |
| worstWallMs | 1961.1667 [1960.1353, 1962.1981] n=16 | 1960.8125 [1959.5435, 1962.0815] n=16 | **-0.3542** [-2.0118, 1.3034] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0.0005 [-0.0006, 0.0016] n=16 | 0 [0, 0] n=16 | **-0.0005** [-0.0016, 0.0006] |
| stagedNothingRate | 0.0002 [-0.0002, 0.0005] n=16 | 0 [0, 0] n=16 | **-0.0002** [-0.0005, 0.0002] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0.0208 [-0.0236, 0.0652] n=16 | 0 [0, 0] n=16 | **-0.0208** [-0.0652, 0.0236] |
| ~~plansEvaluated~~ (retired) | 81764.875 [63903.1103, 99626.6397] n=16 | 67622.7917 [39916.8757, 95328.7076] n=16 | **-14142.0833** [-43801.5589, 15517.3922] |
| ~~boundsInversions~~ (retired) | 15712.5833 [6634.3901, 24790.7766] n=16 | 42.875 [-48.4916, 134.2416] n=16 | **-15669.7083** [-24759.8229, -6579.5937] ✱ |

## Integrity problems

(51 entries in the on-disk original — dominated by other experiments' sweeps being skipped for this pass's base arm, which is expected in a multi-experiment batch; full list in the zip archive.)