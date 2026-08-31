# Paired aggregation — p11br

Base arm: `baseline`. Generated 2026-08-31T22:08:56.621Z.

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

Subject: `baseline:lobster-territory search-arch:lobster-territory` · arms: baseline, search-arch · paired 144 games

**Arm audit** — the flags each engine RESOLVED:

| flag | search-arch |
|---|---|

### cell `hazard-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards cross, potions false

48 games in 16 blocks. cap-terminal rate: baseline 0.354, search-arch 0.167

| metric | baseline (level) | search-arch (level) | Δ search-arch−baseline [95% CI] |
|---|---|---|---|
| sharePar | 2.1642 [1.7959, 2.5325] n=16 | 1.5299 [1.0899, 1.97] n=16 | **-0.6343** [-1.2607, -0.008] ✱ |
| score | 0.8542 [0.7756, 0.9328] n=16 | 0.7292 [0.6442, 0.8142] n=16 | **-0.125** [-0.2485, -0.0015] ✱ |
| win | 0.7292 [0.581, 0.8773] n=16 | 0.5208 [0.3763, 0.6654] n=16 | **-0.2083** [-0.4222, 0.0055] |
| place | 1.2917 [1.1345, 1.4488] n=16 | 1.5417 [1.3716, 1.7117] n=16 | **0.25** [0.0031, 0.4969] ✱ |
| finalMaterial | 25.1458 [20.7704, 29.5212] n=16 | 17.5 [13.3358, 21.6642] n=16 | **-7.6458** [-14.4657, -0.8259] ✱ |
| finalUnits | 3.7708 [3.1136, 4.428] n=16 | 2.625 [1.8581, 3.3919] n=16 | **-1.1458** [-2.223, -0.0686] ✱ |
| survived | 0.8333 [0.721, 0.9456] n=16 | 0.6042 [0.4878, 0.7205] n=16 | **-0.2292** [-0.4206, -0.0377] ✱ |
| turns | 72.7292 [59.87, 85.5883] n=16 | 64.1042 [51.3016, 76.9067] n=16 | **-8.625** [-21.9027, 4.6527] |
| decisive | 0.6458 [0.4942, 0.7975] n=16 | 0.8333 [0.7036, 0.963] n=16 | **0.1875** [0.0045, 0.3705] ✱ |
| decisions | 72.4167 [59.4398, 85.3935] n=16 | 63.2917 [50.1931, 76.3902] n=16 | **-9.125** [-22.851, 4.601] |
| worstWallMs | 1943.4375 [1934.3656, 1952.5094] n=16 | 1949.875 [1941.123, 1958.627] n=16 | **6.4375** [-4.0418, 16.9168] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0032 [0.0002, 0.0062] n=16 | 0.0092 [-0.0058, 0.0241] n=16 | **0.006** [-0.0098, 0.0218] |
| deathsSelf | 0.125 [0.0151, 0.2349] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **-0.0833** [-0.1859, 0.0192] |
| deathsWall | 0.0833 [-0.0192, 0.1859] n=16 | 0 [0, 0] n=16 | **-0.0833** [-0.1859, 0.0192] |
| deathsExhaustion | 0.1667 [0.0544, 0.279] n=16 | 0.1042 [0.0192, 0.1892] n=16 | **-0.0625** [-0.1957, 0.0707] |
| deathsBodyBlock | 0.1667 [0.0217, 0.3117] n=16 | 0.25 [0.1287, 0.3713] n=16 | **0.0833** [-0.0942, 0.2609] |
| deathsContest | 1 [0.689, 1.311] n=16 | 1.5 [0.9977, 2.0023] n=16 | **0.5** [-0.0502, 1.0502] |
| deathsTeammate | 0 [0, 0] n=16 | 0.1667 [0.0078, 0.3255] n=16 | **0.1667** [0.0078, 0.3255] ✱ |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | — | 151513.8958 [127944.0738, 175083.7179] n=16 | — |
| clusterEnumMs | — | 32294.5625 [27019.4091, 37569.7159] n=16 | — |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | — | 1411.2292 [1178.4805, 1643.9778] n=16 | — |
| scoutPlies | — | 1421.1667 [1152.4705, 1689.8629] n=16 | — |
| scoutRefusals | — | 0.2083 [-0.1215, 0.5382] n=16 | — |
| ceilingDecided | — | 436.9792 [184.9039, 689.0544] n=16 | — |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 9615.6875 [5307.6254, 13923.7496] n=16 | 11959.0833 [2138.7983, 21779.3684] n=16 | **2343.3958** [-9121.5458, 13808.3375] |
| ~~boundsInversions~~ (retired) | 18.8333 [-21.3005, 58.9672] n=16 | 0 [0, 0] n=16 | **-18.8333** [-58.9672, 21.3005] |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: baseline 0.188, search-arch 0.083

| metric | baseline (level) | search-arch (level) | Δ search-arch−baseline [95% CI] |
|---|---|---|---|
| sharePar | 1.7409 [1.2239, 2.2578] n=16 | 1.3464 [0.885, 1.8077] n=16 | **-0.3945** [-0.9507, 0.1617] |
| score | 0.7813 [0.6855, 0.877] n=16 | 0.6875 [0.5909, 0.7841] n=16 | **-0.0938** [-0.2059, 0.0184] |
| win | 0.6458 [0.4809, 0.8108] n=16 | 0.4375 [0.2694, 0.6056] n=16 | **-0.2083** [-0.4121, -0.0046] ✱ |
| place | 1.4375 [1.246, 1.629] n=16 | 1.625 [1.4318, 1.8182] n=16 | **0.1875** [-0.0368, 0.4118] |
| finalMaterial | 19.2083 [14.4575, 23.9592] n=16 | 14.5417 [9.3777, 19.7056] n=16 | **-4.6667** [-12.2235, 2.8901] |
| finalUnits | 2.9167 [2.1345, 3.6988] n=16 | 2.4167 [1.7019, 3.1314] n=16 | **-0.5** [-1.3279, 0.3279] |
| survived | 0.6458 [0.4809, 0.8108] n=16 | 0.5 [0.355, 0.645] n=16 | **-0.1458** [-0.34, 0.0484] |
| turns | 60.2917 [49.8693, 70.714] n=16 | 61.9792 [52.4556, 71.5028] n=16 | **1.6875** [-12.6769, 16.0519] |
| decisive | 0.8125 [0.7215, 0.9035] n=16 | 0.9167 [0.8372, 0.9961] n=16 | **0.1042** [-0.0028, 0.2111] |
| decisions | 57.375 [47.3191, 67.4309] n=16 | 60.25 [50.5777, 69.9223] n=16 | **2.875** [-11.2487, 16.9987] |
| worstWallMs | 1935.1667 [1923.216, 1947.1174] n=16 | 1961.5833 [1940.3588, 1982.8079] n=16 | **26.4167** [0.1682, 52.6652] ✱ |
| overrunRate | 0 [0, 0] n=16 | 0.0026 [-0.0002, 0.0055] n=16 | **0.0026** [-0.0002, 0.0055] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.021 [0.0077, 0.0343] n=16 | 0.0005 [-0.0006, 0.0016] n=16 | **-0.0205** [-0.034, -0.007] ✱ |
| deathsSelf | 0 [0, 0] n=16 | 0.0417 [-0.019, 0.1023] n=16 | **0.0417** [-0.019, 0.1023] |
| deathsWall | 0.0208 [-0.0236, 0.0652] n=16 | 0 [0, 0] n=16 | **-0.0208** [-0.0652, 0.0236] |
| deathsExhaustion | 0.0833 [-0.0192, 0.1859] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **-0.0625** [-0.1591, 0.0341] |
| deathsBodyBlock | 0.1667 [0.037, 0.2964] n=16 | 0.2292 [0.1041, 0.3542] n=16 | **0.0625** [-0.0992, 0.2242] |
| deathsContest | 1.4375 [1.1087, 1.7663] n=16 | 1.7917 [1.3874, 2.196] n=16 | **0.3542** [-0.032, 0.7404] |
| deathsTeammate | 0.0417 [-0.019, 0.1023] n=16 | 0.1875 [0.0758, 0.2992] n=16 | **0.1458** [0.0341, 0.2576] ✱ |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | — | 149788.625 [127217.4961, 172359.7539] n=16 | — |
| clusterEnumMs | — | 32476.25 [27949.7494, 37002.7506] n=16 | — |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | — | 1493.4583 [1269.9708, 1716.9458] n=16 | — |
| scoutPlies | — | 1410.0417 [1180.0818, 1640.0015] n=16 | — |
| scoutRefusals | — | 0.0208 [-0.0236, 0.0652] n=16 | — |
| ceilingDecided | — | 482.9583 [219.1309, 746.7858] n=16 | — |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 2909.1042 [1102.5624, 4715.6459] n=16 | 2956.1458 [1759.0811, 4153.2106] n=16 | **47.0417** [-2279.5239, 2373.6072] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: baseline 0.896, search-arch 0.896

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | baseline (level) | search-arch (level) | Δ search-arch−baseline [95% CI] |
|---|---|---|---|
| sharePar | 2.3859 [2.2958, 2.4761] n=16 | 2.3175 [2.1693, 2.4658] n=16 | **-0.0684** [-0.2355, 0.0987] |
| score | 0.9896 [0.9674, 1.0118] n=16 | 0.9896 [0.9674, 1.0118] n=16 | **0** [-0.0324, 0.0324] |
| win | 0.9792 [0.9348, 1.0236] n=16 | 0.9792 [0.9348, 1.0236] n=16 | **0** [-0.0648, 0.0648] |
| place | 1.0208 [0.9764, 1.0652] n=16 | 1.0208 [0.9764, 1.0652] n=16 | **0** [-0.0648, 0.0648] |
| finalMaterial | 41.0417 [37.9913, 44.092] n=16 | 39.8125 [37.6746, 41.9504] n=16 | **-1.2292** [-4.9681, 2.5098] |
| finalUnits | 5.0833 [4.6862, 5.4804] n=16 | 4.8958 [4.6387, 5.1529] n=16 | **-0.1875** [-0.6271, 0.2521] |
| survived | 1 [1, 1] n=16 | 0.9792 [0.9348, 1.0236] n=16 | **-0.0208** [-0.0652, 0.0236] |
| turns | 119.0625 [118.0065, 120.1185] n=16 | 118.9375 [117.8657, 120.0093] n=16 | **-0.125** [-1.8058, 1.5558] |
| decisive | 0.1042 [-0.0028, 0.2111] n=16 | 0.1042 [0.0192, 0.1892] n=16 | **0** [-0.145, 0.145] |
| decisions | 119.0625 [118.0065, 120.1185] n=16 | 118.9375 [117.8657, 120.0093] n=16 | **-0.125** [-1.8058, 1.5558] |
| worstWallMs | 1962.3542 [1961.8295, 1962.8788] n=16 | 2000.8542 [1991.5712, 2010.1371] n=16 | **38.5** [29.3381, 47.6619] ✱ |
| overrunRate | 0 [0, 0] n=16 | 0.0045 [0.0029, 0.0061] n=16 | **0.0045** [0.0029, 0.0061] ✱ |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=16 | 0.0235 [0.0162, 0.0308] n=16 | **0.0235** [0.0162, 0.0308] ✱ |
| deathsSelf | 0.3333 [0.1183, 0.5484] n=16 | 0.4167 [0.1968, 0.6366] n=16 | **0.0833** [-0.1879, 0.3546] |
| deathsWall | 0.0625 [-0.0341, 0.1591] n=16 | 0.1042 [-0.0028, 0.2111] n=16 | **0.0417** [-0.086, 0.1693] |
| deathsExhaustion | 0.125 [0.0151, 0.2349] n=16 | 0.1042 [-0.0028, 0.2111] n=16 | **-0.0208** [-0.1725, 0.1308] |
| deathsBodyBlock | 0.1042 [-0.0028, 0.2111] n=16 | 0.0625 [-0.0091, 0.1341] n=16 | **-0.0417** [-0.1305, 0.0471] |
| deathsContest | 0.2917 [0.1097, 0.4736] n=16 | 0.4167 [0.2391, 0.5942] n=16 | **0.125** [-0.0682, 0.3182] |
| deathsTeammate | 0 [0, 0] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **0.0208** [-0.0236, 0.0652] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | — | 4711.6875 [4278.8187, 5144.5563] n=16 | — |
| clusterEnumMs | — | 2605.7292 [2505.9308, 2705.5275] n=16 | — |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | — | 1423.9167 [1386.0915, 1461.7419] n=16 | — |
| scoutPlies | — | 1281.125 [1233.8503, 1328.3997] n=16 | — |
| scoutRefusals | — | 316.5417 [307.148, 325.9353] n=16 | — |
| ceilingDecided | — | 662.7083 [36.8304, 1288.5863] n=16 | — |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 125238.6667 [103269.9245, 147207.4089] n=16 | 316494.875 [300937.3383, 332052.4117] n=16 | **191256.2083** [172938.7733, 209573.6433] ✱ |
| ~~boundsInversions~~ (retired) | 560.5625 [-633.9962, 1755.1212] n=16 | 0 [0, 0] n=16 | **-560.5625** [-1755.1212, 633.9962] |

