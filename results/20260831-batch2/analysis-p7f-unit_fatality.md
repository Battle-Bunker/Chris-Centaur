# Paired aggregation — p7f-unit_fatality

Base arm: `default`. Generated 2026-08-30T18:09:05.611Z.

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

## p7f-unit_fatality

Subject: `default:lobster-territory unit-fatality:lobster-territory` · arms: default, unit-fatality · paired 144 games

**Arm audit** — the flags each engine RESOLVED:

| flag | default | unit-fatality |
|---|---|---|
| `name` | default | lobster-territory |
| `unitFatality` | false | true |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.146, unit-fatality 0.104

| metric | default (level) | unit-fatality (level) | Δ unit-fatality−default [95% CI] |
|---|---|---|---|
| sharePar | 1.4546 [0.9673, 1.9419] n=16 | 0.9958 [0.7201, 1.2715] n=16 | **-0.4588** [-0.8861, -0.0315] ✱ |
| score | 0.6979 [0.5893, 0.8065] n=16 | 0.6042 [0.5256, 0.6828] n=16 | **-0.0938** [-0.1793, -0.0082] ✱ |
| win | 0.4792 [0.308, 0.6503] n=16 | 0.3125 [0.2106, 0.4144] n=16 | **-0.1667** [-0.3117, -0.0217] ✱ |
| place | 1.6042 [1.387, 1.8214] n=16 | 1.7917 [1.6345, 1.9488] n=16 | **0.1875** [0.0163, 0.3587] ✱ |
| finalMaterial | 17.6667 [11.0959, 24.2374] n=16 | 11.2917 [8.4166, 14.1667] n=16 | **-6.375** [-11.4758, -1.2742] ✱ |
| finalUnits | 2.5417 [1.6045, 3.4788] n=16 | 1.9167 [1.4081, 2.4252] n=16 | **-0.625** [-1.4971, 0.2471] |
| survived | 0.5417 [0.3485, 0.7348] n=16 | 0.3958 [0.2992, 0.4924] n=16 | **-0.1458** [-0.2904, -0.0013] ✱ |
| turns | 57.3542 [44.7726, 69.9357] n=16 | 51.5625 [40.6148, 62.5102] n=16 | **-5.7917** [-21.2829, 9.6996] |
| decisive | 0.8542 [0.725, 0.9833] n=16 | 0.8958 [0.8108, 0.9808] n=16 | **0.0417** [-0.1155, 0.1988] |
| decisions | 56.9583 [44.2069, 69.7097] n=16 | 50.0417 [38.548, 61.5354] n=16 | **-6.9167** [-22.7492, 8.9159] |
| worstWallMs | 1970.75 [1932.2304, 2009.2696] n=16 | 1980.5625 [1946.1131, 2015.0119] n=16 | **9.8125** [-6.4577, 26.0827] |
| overrunRate | 0.0131 [-0.0112, 0.0374] n=16 | 0.0223 [-0.016, 0.0605] n=16 | **0.0091** [-0.005, 0.0233] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0015 [-0.0003, 0.0032] n=16 | 0.0034 [-0.0004, 0.0072] n=16 | **0.0019** [-0.0022, 0.0061] |
| deathsSelf | 0 [0, 0] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **0.0417** [-0.019, 0.1023] |
| deathsWall | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| deathsExhaustion | 0 [0, 0] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **0.0208** [-0.0236, 0.0652] |
| deathsBodyBlock | 0.2083 [0.0512, 0.3655] n=16 | 0.2917 [0.1097, 0.4736] n=16 | **0.0833** [-0.1636, 0.3303] |
| deathsContest | 1.3542 [1.0468, 1.6615] n=16 | 1.5625 [1.175, 1.95] n=16 | **0.2083** [-0.349, 0.7657] |
| deathsTeammate | 0.1667 [0.037, 0.2964] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **-0.1042** [-0.2592, 0.0509] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 138140.625 [117602.8925, 158678.3575] n=16 | 113178.3333 [92083.6062, 134273.0605] n=16 | **-24962.2917** [-52300.8943, 2376.3109] |
| clusterEnumMs | 32099.0625 [26356.2281, 37841.8969] n=16 | 29338.0833 [23016.1747, 35659.992] n=16 | **-2760.9792** [-10491.1509, 4969.1926] |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1377.0208 [1125.3135, 1628.7282] n=16 | 1114.3125 [874.6333, 1353.9917] n=16 | **-262.7083** [-562.5502, 37.1336] |
| scoutPlies | 1315.1042 [1018.4035, 1611.8048] n=16 | 1154.2708 [886.4543, 1422.0874] n=16 | **-160.8333** [-520.4784, 198.8117] |
| scoutRefusals | 0 [0, 0] n=16 | 0.0417 [-0.0471, 0.1305] n=16 | **0.0417** [-0.0471, 0.1305] |
| ceilingDecided | 212.25 [102.312, 322.188] n=16 | 138.5 [83.4253, 193.5747] n=16 | **-73.75** [-178.6874, 31.1874] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 4943.8958 [936.5479, 8951.2438] n=16 | 5792.625 [-3570.9901, 15156.2401] n=16 | **848.7292** [-8980.1136, 10677.5719] |
| ~~boundsInversions~~ (retired) | 544.8125 [-432.1133, 1521.7383] n=16 | 42.0833 [-47.5962, 131.7629] n=16 | **-502.7292** [-1490.8125, 485.3542] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 0.979, unit-fatality 0.917

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | unit-fatality (level) | Δ unit-fatality−default [95% CI] |
|---|---|---|---|
| sharePar | 2.1859 [2.087, 2.2847] n=16 | 2.3401 [2.2574, 2.4227] n=16 | **0.1542** [0.0249, 0.2835] ✱ |
| score | 0.9896 [0.9674, 1.0118] n=16 | 1 [1, 1] n=16 | **0.0104** [-0.0118, 0.0326] |
| win | 0.9792 [0.9348, 1.0236] n=16 | 1 [1, 1] n=16 | **0.0208** [-0.0236, 0.0652] |
| place | 1.0208 [0.9764, 1.0652] n=16 | 1 [1, 1] n=16 | **-0.0208** [-0.0652, 0.0236] |
| finalMaterial | 39.25 [36.2082, 42.2918] n=16 | 39.7708 [36.7027, 42.8389] n=16 | **0.5208** [-3.1787, 4.2203] |
| finalUnits | 4.8333 [4.5582, 5.1084] n=16 | 4.9375 [4.5638, 5.3112] n=16 | **0.1042** [-0.2941, 0.5024] |
| survived | 1 [1, 1] n=16 | 1 [1, 1] n=16 | **0** [0, 0] |
| turns | 119.5833 [118.6954, 120.4713] n=16 | 118.75 [117.4093, 120.0907] n=16 | **-0.8333** [-2.5367, 0.87] |
| decisive | 0.0208 [-0.0236, 0.0652] n=16 | 0.0833 [0.0039, 0.1628] n=16 | **0.0625** [-0.0341, 0.1591] |
| decisions | 119.5833 [118.6954, 120.4713] n=16 | 118.75 [117.4093, 120.0907] n=16 | **-0.8333** [-2.5367, 0.87] |
| worstWallMs | 1996.2292 [1984.2555, 2008.2029] n=16 | 1987.5833 [1975.6766, 1999.4901] n=16 | **-8.6458** [-25.4517, 8.16] |
| overrunRate | 0.0039 [0.0016, 0.0061] n=16 | 0.0026 [0.001, 0.0042] n=16 | **-0.0012** [-0.0044, 0.002] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0232 [0.0154, 0.031] n=16 | 0.0168 [0.0097, 0.0239] n=16 | **-0.0063** [-0.0183, 0.0057] |
| deathsSelf | 0.375 [0.205, 0.545] n=16 | 0.25 [-0.0213, 0.5213] n=16 | **-0.125** [-0.4283, 0.1783] |
| deathsWall | 0.125 [0.0362, 0.2138] n=16 | 0.1042 [-0.0028, 0.2111] n=16 | **-0.0208** [-0.1227, 0.0811] |
| deathsExhaustion | 0.125 [0.0151, 0.2349] n=16 | 0.0833 [0.0039, 0.1628] n=16 | **-0.0417** [-0.1516, 0.0683] |
| deathsBodyBlock | 0.1667 [0.0544, 0.279] n=16 | 0.1875 [0.0758, 0.2992] n=16 | **0.0208** [-0.0578, 0.0994] |
| deathsContest | 0.375 [0.193, 0.557] n=16 | 0.4375 [0.2573, 0.6177] n=16 | **0.0625** [-0.1344, 0.2594] |
| deathsTeammate | 0.0208 [-0.0236, 0.0652] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **0** [-0.0648, 0.0648] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 5212.6875 [4529.1524, 5896.2226] n=16 | 4754.3542 [4052.461, 5456.2473] n=16 | **-458.3333** [-1262.6609, 345.9943] |
| clusterEnumMs | 2385.0625 [2224.0756, 2546.0494] n=16 | 2406.3333 [2288.6404, 2524.0263] n=16 | **21.2708** [-91.3639, 133.9055] |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1458.8125 [1416.7096, 1500.9154] n=16 | 1411.9167 [1360.7151, 1463.1182] n=16 | **-46.8958** [-88.0257, -5.766] ✱ |
| scoutPlies | 1250.6458 [1200.1588, 1301.1329] n=16 | 1204.2083 [1146.2182, 1262.1985] n=16 | **-46.4375** [-108.3532, 15.4782] |
| scoutRefusals | 322.3333 [312.967, 331.6997] n=16 | 314.2292 [306.1159, 322.3424] n=16 | **-8.1042** [-15.9151, -0.2933] ✱ |
| ceilingDecided | 523.8125 [86.8644, 960.7606] n=16 | 465.4167 [106.426, 824.4074] n=16 | **-58.3958** [-507.2286, 390.4369] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 364722.6458 [315564.4432, 413880.8484] n=16 | 352981.0208 [327344.9476, 378617.0941] n=16 | **-11741.625** [-39724.476, 16241.226] |
| ~~boundsInversions~~ (retired) | 847.8333 [-649.8762, 2345.5429] n=16 | 0 [0, 0] n=16 | **-847.8333** [-2345.5429, 649.8762] |

### cell `snake5-knight` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: default 1, unit-fatality 0.979

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | unit-fatality (level) | Δ unit-fatality−default [95% CI] |
|---|---|---|---|
| sharePar | 0.8863 [0.6159, 1.1568] n=16 | 0.9072 [0.6381, 1.1762] n=16 | **0.0208** [-0.0902, 0.1319] |
| score | 0.4479 [0.3076, 0.5882] n=16 | 0.4479 [0.3039, 0.5919] n=16 | **0** [-0.0648, 0.0648] |
| win | 0.2708 [0.0966, 0.4451] n=16 | 0.2708 [0.0966, 0.4451] n=16 | **0** [-0.0648, 0.0648] |
| place | 2.1042 [1.8236, 2.3847] n=16 | 2.1042 [1.8162, 2.3921] n=16 | **0** [-0.1297, 0.1297] |
| finalMaterial | 5.9375 [3.9001, 7.9749] n=16 | 5.9583 [4.497, 7.4197] n=16 | **0.0208** [-1.1143, 1.156] |
| finalUnits | 1.3125 [0.9984, 1.6266] n=16 | 1.3333 [1.0907, 1.576] n=16 | **0.0208** [-0.0999, 0.1416] |
| survived | 0.8125 [0.7008, 0.9242] n=16 | 0.8125 [0.7215, 0.9035] n=16 | **0** [-0.0648, 0.0648] |
| turns | 120 [120, 120] n=16 | 119.8125 [119.4129, 120.2121] n=16 | **-0.1875** [-0.5871, 0.2121] |
| decisive | 0 [0, 0] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **0.0208** [-0.0236, 0.0652] |
| decisions | 112.0417 [106.3031, 117.7802] n=16 | 112 [106.4848, 117.5152] n=16 | **-0.0417** [-0.9878, 0.9044] |
| worstWallMs | 1984.0208 [1971.6847, 1996.357] n=16 | 1977.875 [1970.8551, 1984.8949] n=16 | **-6.1458** [-19.6286, 7.3369] |
| overrunRate | 0.0028 [0.0004, 0.0051] n=16 | 0.0029 [-0.0013, 0.0071] n=16 | **0.0001** [-0.0049, 0.005] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0339 [0.0153, 0.0524] n=16 | 0.0988 [-0.0446, 0.2422] n=16 | **0.0649** [-0.0786, 0.2084] |
| deathsSelf | 0.0833 [0.0039, 0.1628] n=16 | 0.0833 [0.0039, 0.1628] n=16 | **0** [-0.0917, 0.0917] |
| deathsWall | 0.125 [-0.0322, 0.2822] n=16 | 0.125 [-0.0322, 0.2822] n=16 | **0** [-0.0648, 0.0648] |
| deathsExhaustion | 0.5 [0.2754, 0.7246] n=16 | 0.4792 [0.308, 0.6503] n=16 | **-0.0208** [-0.2095, 0.1679] |
| deathsBodyBlock | 1.7083 [1.3785, 2.0382] n=16 | 1.7083 [1.4051, 2.0116] n=16 | **0** [-0.145, 0.145] |
| deathsContest | 2.2708 [1.8752, 2.6664] n=16 | 2.2708 [1.9203, 2.6213] n=16 | **0** [-0.1123, 0.1123] |
| deathsTeammate | 1.3958 [1.1601, 1.6316] n=16 | 1.4167 [1.1454, 1.6879] n=16 | **0.0208** [-0.1308, 0.1725] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 4757.9167 [4034.7785, 5481.0548] n=16 | 4777.5417 [4195.0333, 5360.05] n=16 | **19.625** [-305.6258, 344.8758] |
| clusterEnumMs | 2030.8125 [1868.0788, 2193.5462] n=16 | 2076.4583 [1913.3308, 2239.5859] n=16 | **45.6458** [10.7748, 80.5168] ✱ |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 971.6667 [889.4165, 1053.9168] n=16 | 972.5 [897.3167, 1047.6833] n=16 | **0.8333** [-16.1197, 17.7864] |
| scoutPlies | 1036.2708 [961.7053, 1110.8364] n=16 | 1026.125 [963.0133, 1089.2367] n=16 | **-10.1458** [-44.2186, 23.927] |
| scoutRefusals | 7.9583 [6.2222, 9.6945] n=16 | 7.9583 [5.9472, 9.9694] n=16 | **0** [-0.7133, 0.7133] |
| ceilingDecided | 539.6458 [156.8866, 922.4051] n=16 | 526.1458 [95.0912, 957.2005] n=16 | **-13.5** [-227.1736, 200.1736] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 318953.0625 [280469.1734, 357436.9516] n=16 | 315752.6458 [274105.8882, 357399.4035] n=16 | **-3200.4167** [-16930.6993, 10529.8659] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

