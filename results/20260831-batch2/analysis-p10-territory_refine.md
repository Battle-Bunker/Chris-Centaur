# Paired aggregation — p10-territory_refine

Base arm: `default`. Generated 2026-08-30T22:46:04.167Z.

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

## p10-territory_refine

Subject: `default:lobster-territory refiner:lobster-territory` · arms: default, refiner · paired 144 games

**Arm audit** — the flags each engine RESOLVED:

| flag | default | refiner |
|---|---|---|
| `name` | default | lobster-territory |
| `territoryRefine` | false | true |

### cell `hazard-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards cross, potions false

48 games in 16 blocks. cap-terminal rate: default 0.125, refiner 0.104

| metric | default (level) | refiner (level) | Δ refiner−default [95% CI] |
|---|---|---|---|
| sharePar | 1.9356 [1.59, 2.2812] n=16 | 1.5984 [1.1776, 2.0192] n=16 | **-0.3371** [-0.9073, 0.233] |
| score | 0.8021 [0.7212, 0.8829] n=16 | 0.7396 [0.6481, 0.8311] n=16 | **-0.0625** [-0.1591, 0.0341] |
| win | 0.6667 [0.5544, 0.779] n=16 | 0.5417 [0.3985, 0.6848] n=16 | **-0.125** [-0.2822, 0.0322] |
| place | 1.3958 [1.2341, 1.5575] n=16 | 1.5208 [1.3378, 1.7039] n=16 | **0.125** [-0.0682, 0.3182] |
| finalMaterial | 20.7917 [16.1768, 25.4065] n=16 | 17.2083 [12.6232, 21.7935] n=16 | **-3.5833** [-9.5439, 2.3772] |
| finalUnits | 3.375 [2.8369, 3.9131] n=16 | 2.7708 [2.021, 3.5207] n=16 | **-0.6042** [-1.4819, 0.2736] |
| survived | 0.6875 [0.5856, 0.7894] n=16 | 0.5833 [0.4313, 0.7354] n=16 | **-0.1042** [-0.2722, 0.0639] |
| turns | 59.3958 [48.6486, 70.143] n=16 | 58.1458 [51.4512, 64.8405] n=16 | **-1.25** [-12.8769, 10.3769] |
| decisive | 0.875 [0.7651, 0.9849] n=16 | 0.8958 [0.8108, 0.9808] n=16 | **0.0208** [-0.1441, 0.1858] |
| decisions | 58.9792 [48.127, 69.8313] n=16 | 56.9583 [49.6537, 64.263] n=16 | **-2.0208** [-13.9099, 9.8682] |
| worstWallMs | 1944.4583 [1928.972, 1959.9447] n=16 | 1944.3542 [1929.5797, 1959.1286] n=16 | **-0.1042** [-12.983, 12.7747] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0022 [-0.0008, 0.0053] n=16 | 0.0317 [0.0207, 0.0427] n=16 | **0.0294** [0.0192, 0.0396] ✱ |
| deathsSelf | 0.0625 [-0.0091, 0.1341] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.0417** [-0.1305, 0.0471] |
| deathsWall | 0.0417 [-0.019, 0.1023] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **0** [-0.0648, 0.0648] |
| deathsExhaustion | 0.1667 [0.037, 0.2964] n=16 | 0.1042 [-0.076, 0.2843] n=16 | **-0.0625** [-0.307, 0.182] |
| deathsBodyBlock | 0.0833 [0.0039, 0.1628] n=16 | 0.2083 [0.0807, 0.336] n=16 | **0.125** [-0.045, 0.295] |
| deathsContest | 1.125 [0.943, 1.307] n=16 | 1.2708 [0.9517, 1.5899] n=16 | **0.1458** [-0.215, 0.5067] |
| deathsTeammate | 0.0625 [-0.0091, 0.1341] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **-0.0208** [-0.1227, 0.0811] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 159687.6667 [131314.7411, 188060.5923] n=16 | 150115.4167 [123582.0504, 176648.783] n=16 | **-9572.25** [-43786.8406, 24642.3406] |
| clusterEnumMs | 30938.4792 [26415.9914, 35460.9669] n=16 | 30084.9583 [26492.291, 33677.6257] n=16 | **-853.5208** [-5910.5483, 4203.5067] |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | 1250.5625 [753.7905, 1747.3345] n=16 | — |
| refineInverted | — | 0 [0, 0] n=16 | — |
| scoutThreads | 1459.3125 [1215.8963, 1702.7287] n=16 | 1388.1667 [1184.5905, 1591.7428] n=16 | **-71.1458** [-371.5411, 229.2494] |
| scoutPlies | 1366.125 [1117.4339, 1614.8161] n=16 | 1328.9167 [1160.5187, 1497.3147] n=16 | **-37.2083** [-321.7439, 247.3273] |
| scoutRefusals | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ceilingDecided | 398.0625 [198.9984, 597.1266] n=16 | 490.625 [167.7504, 813.4996] n=16 | **92.5625** [-316.3526, 501.4776] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 4205.3125 [2100.0809, 6310.5441] n=16 | 3073.125 [1783.0122, 4363.2378] n=16 | **-1132.1875** [-3428.4029, 1164.0279] |
| ~~boundsInversions~~ (retired) | 80.9375 [-91.5403, 253.4153] n=16 | 290.2917 [-328.3199, 908.9032] n=16 | **209.3542** [-443.8342, 862.5426] |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.125, refiner 0.104

| metric | default (level) | refiner (level) | Δ refiner−default [95% CI] |
|---|---|---|---|
| sharePar | 1.5221 [0.9613, 2.0828] n=16 | 1.4582 [1.0032, 1.9133] n=16 | **-0.0639** [-0.8329, 0.7052] |
| score | 0.7083 [0.5892, 0.8275] n=16 | 0.6979 [0.5846, 0.8112] n=16 | **-0.0104** [-0.1708, 0.15] |
| win | 0.5417 [0.3597, 0.7236] n=16 | 0.4792 [0.308, 0.6503] n=16 | **-0.0625** [-0.3236, 0.1986] |
| place | 1.5833 [1.3451, 1.8216] n=16 | 1.6042 [1.3775, 1.8308] n=16 | **0.0208** [-0.2999, 0.3416] |
| finalMaterial | 16.75 [11.4342, 22.0658] n=16 | 16.3958 [10.1029, 22.6888] n=16 | **-0.3542** [-8.526, 7.8176] |
| finalUnits | 2.6458 [1.73, 3.5617] n=16 | 2.5 [1.7466, 3.2534] n=16 | **-0.1458** [-1.4231, 1.1314] |
| survived | 0.5625 [0.3823, 0.7427] n=16 | 0.5417 [0.3716, 0.7117] n=16 | **-0.0208** [-0.2759, 0.2342] |
| turns | 55.9375 [46.8748, 65.0002] n=16 | 60.2917 [48.9668, 71.6166] n=16 | **4.3542** [-9.4207, 18.129] |
| decisive | 0.875 [0.7862, 0.9638] n=16 | 0.8958 [0.8108, 0.9808] n=16 | **0.0208** [-0.0999, 0.1416] |
| decisions | 54.8542 [45.5006, 64.2077] n=16 | 58.5 [46.5163, 70.4837] n=16 | **3.6458** [-10.0378, 17.3294] |
| worstWallMs | 1947.0625 [1914.9744, 1979.1506] n=16 | 1952.6042 [1925.2088, 1979.9996] n=16 | **5.5417** [-14.3539, 25.4372] |
| overrunRate | 0.0037 [-0.0014, 0.0087] n=16 | 0.0032 [-0.0019, 0.0083] n=16 | **-0.0004** [-0.002, 0.0011] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0095 [-0.0017, 0.0208] n=16 | 0.0228 [0.0156, 0.0299] n=16 | **0.0132** [-0.0013, 0.0278] |
| deathsSelf | 0 [0, 0] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **0.0208** [-0.0236, 0.0652] |
| deathsWall | 0.0208 [-0.0236, 0.0652] n=16 | 0 [0, 0] n=16 | **-0.0208** [-0.0652, 0.0236] |
| deathsExhaustion | 0.0208 [-0.0236, 0.0652] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **0.0208** [-0.0578, 0.0994] |
| deathsBodyBlock | 0.1875 [0.0758, 0.2992] n=16 | 0.25 [0.1124, 0.3876] n=16 | **0.0625** [-0.1117, 0.2367] |
| deathsContest | 1.3958 [1.0453, 1.7463] n=16 | 1.4792 [1.1684, 1.7899] n=16 | **0.0833** [-0.4126, 0.5793] |
| deathsTeammate | 0.0625 [-0.0091, 0.1341] n=16 | 0.125 [0.0151, 0.2349] n=16 | **0.0625** [-0.0538, 0.1788] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 138755.5 [121342.3066, 156168.6934] n=16 | 144116.5 [119896.2481, 168336.7519] n=16 | **5361** [-21363.4456, 32085.4456] |
| clusterEnumMs | 30773.125 [26335.8159, 35210.4341] n=16 | 32821.2708 [27314.5114, 38328.0303] n=16 | **2048.1458** [-3440.2404, 7536.532] |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | 961.875 [600.7321, 1323.0179] n=16 | — |
| refineInverted | — | 0 [0, 0] n=16 | — |
| scoutThreads | 1338.2292 [1123.392, 1553.0664] n=16 | 1408.8958 [1143.426, 1674.3657] n=16 | **70.6667** [-233.8049, 375.1383] |
| scoutPlies | 1285.25 [1069.7972, 1500.7028] n=16 | 1374.625 [1095.7252, 1653.5248] n=16 | **89.375** [-225.3265, 404.0765] |
| scoutRefusals | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ceilingDecided | 299.7708 [119.1096, 480.432] n=16 | 413.0833 [166.318, 659.8487] n=16 | **113.3125** [-171.9289, 398.5539] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 3907.5417 [-758.7797, 8573.8631] n=16 | 2266.625 [1399.4335, 3133.8165] n=16 | **-1640.9167** [-6273.0331, 2991.1997] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.958, refiner 0.979

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | refiner (level) | Δ refiner−default [95% CI] |
|---|---|---|---|
| sharePar | 2.2634 [2.1558, 2.371] n=16 | 2.1839 [2.0897, 2.2782] n=16 | **-0.0795** [-0.1663, 0.0073] |
| score | 1 [1, 1] n=16 | 0.9896 [0.9674, 1.0118] n=16 | **-0.0104** [-0.0326, 0.0118] |
| win | 1 [1, 1] n=16 | 0.9792 [0.9348, 1.0236] n=16 | **-0.0208** [-0.0652, 0.0236] |
| place | 1 [1, 1] n=16 | 1.0208 [0.9764, 1.0652] n=16 | **0.0208** [-0.0236, 0.0652] |
| finalMaterial | 39.0833 [35.9901, 42.1765] n=16 | 38.625 [35.1494, 42.1006] n=16 | **-0.4583** [-3.1161, 2.1994] |
| finalUnits | 4.9167 [4.6784, 5.1549] n=16 | 4.9167 [4.6533, 5.1801] n=16 | **0** [-0.2594, 0.2594] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 119.5625 [118.6302, 120.4948] n=16 | 119.6667 [118.9563, 120.377] n=16 | **0.1042** [-0.1178, 0.3261] |
| decisive | 0.0417 [-0.0471, 0.1305] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.0208** [-0.0652, 0.0236] |
| decisions | 119.5625 [118.6302, 120.4948] n=16 | 119.6667 [118.9563, 120.377] n=16 | **0.1042** [-0.1178, 0.3261] |
| worstWallMs | 1990.1458 [1981.5582, 1998.7335] n=16 | 1995.3125 [1984.2519, 2006.3731] n=16 | **5.1667** [-11.6646, 21.998] |
| overrunRate | 0.0035 [0.0019, 0.0051] n=16 | 0.0024 [0.0015, 0.0033] n=16 | **-0.001** [-0.0031, 0.001] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0207 [0.0143, 0.0271] n=16 | 0.0224 [0.0144, 0.0304] n=16 | **0.0017** [-0.0066, 0.0101] |
| deathsSelf | 0.375 [0.1712, 0.5788] n=16 | 0.375 [0.1515, 0.5985] n=16 | **0** [-0.1716, 0.1716] |
| deathsWall | 0.1042 [-0.0028, 0.2111] n=16 | 0.125 [0.0362, 0.2138] n=16 | **0.0208** [-0.0999, 0.1416] |
| deathsExhaustion | 0.1042 [-0.0028, 0.2111] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **-0.0417** [-0.1305, 0.0471] |
| deathsBodyBlock | 0.125 [0.0362, 0.2138] n=16 | 0.1667 [0.0544, 0.279] n=16 | **0.0417** [-0.0471, 0.1305] |
| deathsContest | 0.375 [0.193, 0.557] n=16 | 0.3542 [0.1892, 0.5191] n=16 | **-0.0208** [-0.1725, 0.1308] |
| deathsTeammate | 0.0417 [-0.019, 0.1023] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.0208** [-0.0652, 0.0236] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 4919.8333 [4171.8304, 5667.8362] n=16 | 4466.4167 [4104.7329, 4828.1005] n=16 | **-453.4167** [-1088.0781, 181.2447] |
| clusterEnumMs | 2445.8542 [2339.1584, 2552.55] n=16 | 2421.625 [2297.8373, 2545.4127] n=16 | **-24.2292** [-80.6528, 32.1945] |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | 135001.6458 [120436.0468, 149567.2449] n=16 | — |
| refineInverted | — | 0 [0, 0] n=16 | — |
| scoutThreads | 1462.3333 [1416.0199, 1508.6468] n=16 | 1438.1458 [1392.6966, 1483.595] n=16 | **-24.1875** [-49.2316, 0.8566] |
| scoutPlies | 1252.25 [1203.5463, 1300.9537] n=16 | 1246.7083 [1193.4103, 1300.0063] n=16 | **-5.5417** [-54.5561, 43.4728] |
| scoutRefusals | 320.0833 [310.6431, 329.5236] n=16 | 321.3125 [313.5676, 329.0574] n=16 | **1.2292** [-5.3798, 7.8381] |
| ceilingDecided | 386.5208 [83.7391, 689.3026] n=16 | 258.4167 [18.0313, 498.802] n=16 | **-128.1042** [-387.7078, 131.4995] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 337222.5833 [315592.6308, 358852.5358] n=16 | 337447.3125 [308167.44, 366727.185] n=16 | **224.7292** [-12841.9182, 13291.3765] |
| ~~boundsInversions~~ (retired) | 871.5833 [-512.4949, 2255.6616] n=16 | 328.6667 [-288.9131, 946.2465] n=16 | **-542.9167** [-1864.2242, 778.3909] |

