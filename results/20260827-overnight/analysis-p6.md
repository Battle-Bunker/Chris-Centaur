# Paired aggregation — 20260827-overnight

Base arm: `cohort-off`. Generated 2026-08-27T22:47:59.173Z.

Intervals are 95% t over BLOCK means; `n` is the number of seeds. A delta whose
interval includes zero is a NULL RESULT and must be written up as one.

**Placement resolution.** At 16 blocks the normalized placement score resolves to
roughly ±0.10. A |delta score| under that is not a small effect, it is no effect
this design can see — read the mechanism rows instead.

## p6-admission

Subject: `cohort-off:lobster-territory cohort-on:lobster-territory` · arms: cohort-off, cohort-on · paired 144 games

### cell `hazard-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards cross, potions false

48 games in 16 blocks. cap-terminal rate: cohort-off 0.583, cohort-on 0.708

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | cohort-off (level) | cohort-on (level) | Δ cohort-on−cohort-off [95% CI] |
|---|---|---|---|
| score | 0.8021 [0.7036, 0.9005] n=16 | 0.8229 [0.7405, 0.9054] n=16 | **0.0208** [-0.1342, 0.1759] |
| win | 0.6458 [0.4942, 0.7975] n=16 | 0.6667 [0.5217, 0.8117] n=16 | **0.0208** [-0.2342, 0.2759] |
| place | 1.3958 [1.199, 1.5927] n=16 | 1.3542 [1.1892, 1.5191] n=16 | **-0.0417** [-0.3518, 0.2685] |
| finalMaterial | 22 [17.9687, 26.0313] n=16 | 26.4583 [21.7667, 31.15] n=16 | **4.4583** [-0.3537, 9.2703] |
| finalUnits | 3.5208 [3.0271, 4.0145] n=16 | 3.7917 [3.2458, 4.3376] n=16 | **0.2708** [-0.6021, 1.1438] |
| survived | 0.875 [0.7862, 0.9638] n=16 | 0.8958 [0.7889, 1.0028] n=16 | **0.0208** [-0.1162, 0.1579] |
| turns | 96.2083 [84.4397, 107.977] n=16 | 101.6667 [90.8286, 112.5048] n=16 | **5.4583** [-6.7503, 17.667] |
| decisive | 0.4167 [0.2513, 0.582] n=16 | 0.2917 [0.1216, 0.4617] n=16 | **-0.125** [-0.3288, 0.0788] |
| decisions | 95.1667 [83.4345, 106.8988] n=16 | 101.1458 [89.7788, 112.5128] n=16 | **5.9792** [-5.6967, 17.655] |
| worstWallMs | 1960.0833 [1958.7317, 1961.435] n=16 | 1965.3958 [1964.4249, 1966.3668] n=16 | **5.3125** [3.4093, 7.2157] ✱ |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0293 [0.0183, 0.0403] n=16 | 0.0163 [0.005, 0.0276] n=16 | **-0.013** [-0.0282, 0.0022] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 17198.7917 [12233.8312, 22163.7521] n=16 | 31482.7917 [25460.464, 37505.1193] n=16 | **14284** [5753.9441, 22814.0559] ✱ |
| ~~boundsInversions~~ (retired) | 128.2083 [-119.4164, 375.8331] n=16 | 3.7917 [-2.745, 10.3284] n=16 | **-124.4167** [-365.753, 116.9197] |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: cohort-off 0.646, cohort-on 0.729

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | cohort-off (level) | cohort-on (level) | Δ cohort-on−cohort-off [95% CI] |
|---|---|---|---|
| score | 0.7187 [0.6287, 0.8088] n=16 | 0.7292 [0.6506, 0.8078] n=16 | **0.0104** [-0.0945, 0.1153] |
| win | 0.4583 [0.2883, 0.6284] n=16 | 0.4792 [0.35, 0.6083] n=16 | **0.0208** [-0.189, 0.2306] |
| place | 1.5625 [1.3823, 1.7427] n=16 | 1.5417 [1.3845, 1.6988] n=16 | **-0.0208** [-0.2306, 0.189] |
| finalMaterial | 22.5 [19.5684, 25.4316] n=16 | 26.2708 [21.2727, 31.269] n=16 | **3.7708** [-2.9266, 10.4683] |
| finalUnits | 3.6042 [3.0686, 4.1397] n=16 | 3.6042 [3.1401, 4.0682] n=16 | **0** [-0.4493, 0.4493] |
| survived | 0.875 [0.7651, 0.9849] n=16 | 0.875 [0.7862, 0.9638] n=16 | **0** [-0.145, 0.145] |
| turns | 98.6875 [87.8419, 109.5331] n=16 | 104.1458 [95.5342, 112.7574] n=16 | **5.4583** [-7.8529, 18.7696] |
| decisive | 0.3542 [0.2025, 0.5058] n=16 | 0.2708 [0.1376, 0.404] n=16 | **-0.0833** [-0.2832, 0.1165] |
| decisions | 97.8542 [86.9174, 108.7909] n=16 | 103.0208 [94.7077, 111.3339] n=16 | **5.1667** [-8.069, 18.4024] |
| worstWallMs | 1961.3333 [1959.6993, 1962.9674] n=16 | 1966.4583 [1965.6057, 1967.3109] n=16 | **5.125** [3.3141, 6.9359] ✱ |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0222 [0.0128, 0.0316] n=16 | 0.0162 [0.0058, 0.0265] n=16 | **-0.006** [-0.0188, 0.0067] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 16292.8125 [11674.7645, 20910.8605] n=16 | 30562.5625 [26822.0984, 34303.0266] n=16 | **14269.75** [9174.4859, 19365.0141] ✱ |
| ~~boundsInversions~~ (retired) | 68.4792 [-45.1145, 182.0729] n=16 | 3.0417 [-0.5022, 6.5856] n=16 | **-65.4375** [-178.7925, 47.9175] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: cohort-off 0.917, cohort-on 0.938

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | cohort-off (level) | cohort-on (level) | Δ cohort-on−cohort-off [95% CI] |
|---|---|---|---|
| score | 1 [1, 1] n=16 | 0.9792 [0.9348, 1.0236] n=16 | **-0.0208** [-0.0652, 0.0236] |
| win | 1 [1, 1] n=16 | 0.9792 [0.9348, 1.0236] n=16 | **-0.0208** [-0.0652, 0.0236] |
| place | 1 [1, 1] n=16 | 1.0417 [0.9529, 1.1305] n=16 | **0.0417** [-0.0471, 0.1305] |
| finalMaterial | 39.1042 [36.6635, 41.5449] n=16 | 40.3333 [37.9019, 42.7648] n=16 | **1.2292** [-1.8533, 4.3116] |
| finalUnits | 4.8333 [4.566, 5.1007] n=16 | 4.9167 [4.6378, 5.1956] n=16 | **0.0833** [-0.2567, 0.4234] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 119.0833 [117.8151, 120.3515] n=16 | 118.75 [117.3124, 120.1876] n=16 | **-0.3333** [-1.861, 1.1943] |
| decisive | 0.0833 [0.0039, 0.1628] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **-0.0208** [-0.1227, 0.0811] |
| decisions | 119.0833 [117.8151, 120.3515] n=16 | 118.75 [117.3124, 120.1876] n=16 | **-0.3333** [-1.861, 1.1943] |
| worstWallMs | 1959.8125 [1959.3146, 1960.3104] n=16 | 1960.3333 [1959.0219, 1961.6447] n=16 | **0.5208** [-1.0122, 2.0539] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 41844.625 [38749.1194, 44940.1306] n=16 | 50744.2917 [37937.6175, 63550.9658] n=16 | **8899.6667** [-1934.8751, 19734.2084] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

## Integrity problems

(6 entries in the on-disk original — dominated by other experiments' sweeps being skipped for this pass's base arm, which is expected in a multi-experiment batch; full list in the zip archive.)