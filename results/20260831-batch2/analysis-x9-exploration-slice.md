# Paired aggregation — x9-exploration-slice

Base arm: `default`. Generated 2026-08-31T02:52:26.148Z.

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

## x9-exploration-slice

Subject: `default:lobster-territory staging-off:lobster-territory` · arms: default, staging-off · paired 36 games

**Arm audit** — the flags each engine RESOLVED:

| flag | default | staging-off |
|---|---|---|
| `name` | default | lobster-territory |
| `stagingSafety` | full | off |

### cell `headline-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

12 games in 4 blocks. cap-terminal rate: default 0.167, staging-off 0.333

| metric | default (level) | staging-off (level) | Δ staging-off−default [95% CI] |
|---|---|---|---|
| sharePar | 1.5309 [0.5523, 2.5096] n=4 | 1.1355 [-0.2255, 2.4965] n=4 | **-0.3954** [-1.8827, 1.0919] |
| score | 0.7917 [0.5378, 1.0455] n=4 | 0.6667 [0.3605, 0.9729] n=4 | **-0.125** [-0.4587, 0.2087] |
| win | 0.5833 [0.0756, 1.0911] n=4 | 0.4167 [-0.0911, 0.9244] n=4 | **-0.1667** [-0.697, 0.3637] |
| place | 1.4167 [0.9089, 1.9244] n=4 | 1.6667 [1.0543, 2.279] n=4 | **0.25** [-0.4173, 0.9173] |
| finalMaterial | 17.6667 [-6.5435, 41.8768] n=4 | 16.5833 [-11.8258, 44.9925] n=4 | **-1.0833** [-35.7066, 33.54] |
| finalUnits | 2.8333 [1.2423, 4.4243] n=4 | 2.0833 [-0.4921, 4.6588] n=4 | **-0.75** [-3.3972, 1.8972] |
| survived | 0.5833 [0.0756, 1.0911] n=4 | 0.5 [-0.1847, 1.1847] n=4 | **-0.0833** [-0.8788, 0.7122] |
| turns | 57.3333 [3.307, 111.3597] n=4 | 68.3333 [12.003, 124.6636] n=4 | **11** [-82.41, 104.41] |
| decisive | 0.8333 [0.303, 1.3637] n=4 | 0.6667 [-0.0833, 1.4167] n=4 | **-0.1667** [-1.0852, 0.7519] |
| decisions | 57.3333 [3.307, 111.3597] n=4 | 66.5833 [7.3941, 125.7725] n=4 | **9.25** [-86.118, 104.618] |
| worstWallMs | 2048.5833 [1892.9456, 2204.2211] n=4 | 2050.4167 [1860.1719, 2240.6614] n=4 | **1.8333** [-100.5677, 104.2344] |
| overrunRate | 0.0169 [-0.0105, 0.0442] n=4 | 0.0107 [-0.0075, 0.0289] n=4 | **-0.0062** [-0.0166, 0.0043] |
| unstagedRate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=4 | 0.0118 [-0.0117, 0.0353] n=4 | **0.0118** [-0.0117, 0.0353] |
| deathsSelf | 0 [0, 0] n=4 | 0.5 [0.1938, 0.8062] n=4 | **0.5** [0.1938, 0.8062] ✱ |
| deathsWall | 0 [0, 0] n=4 | 0.5 [-0.1847, 1.1847] n=4 | **0.5** [-0.1847, 1.1847] |
| deathsExhaustion | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| deathsBodyBlock | 0.0833 [-0.1818, 0.3485] n=4 | 0.1667 [-0.3637, 0.697] n=4 | **0.0833** [-0.584, 0.7507] |
| deathsContest | 1.6667 [0.9167, 2.4167] n=4 | 1.1667 [-0.0958, 2.4291] n=4 | **-0.5** [-2.4606, 1.4606] |
| deathsTeammate | 0 [0, 0] n=4 | 0.1667 [-0.1395, 0.4729] n=4 | **0.1667** [-0.1395, 0.4729] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 140712.6667 [83178.0365, 198247.2968] n=4 | 134090.6667 [38731.6568, 229449.6765] n=4 | **-6622** [-152808.2942, 139564.2942] |
| clusterEnumMs | 37454.6667 [7236.714, 67672.6193] n=4 | 36149.1667 [21122.408, 51175.9254] n=4 | **-1305.5** [-36617.0552, 34006.0552] |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1325.0833 [386.9466, 2263.2201] n=4 | 1636.1667 [29.5169, 3242.8164] n=4 | **311.0833** [-1949.8927, 2572.0594] |
| scoutPlies | 1335.1667 [134.7155, 2535.6179] n=4 | 1489.5833 [313.0115, 2666.1552] n=4 | **154.4167** [-1821.5914, 2130.4248] |
| scoutRefusals | 0 [0, 0] n=4 | 0.0833 [-0.1818, 0.3485] n=4 | **0.0833** [-0.1818, 0.3485] |
| ceilingDecided | 545.1667 [-628.7713, 1719.1046] n=4 | 295.25 [-434.9743, 1025.4743] n=4 | **-249.9167** [-1887.2679, 1387.4346] |
| illegal | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| errors | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 1635.6667 [-798.7222, 4070.0555] n=4 | 7261.75 [-13028.0601, 27551.5601] n=4 | **5626.0833** [-15994.9779, 27247.1446] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=4 | 222 [-484.404, 928.404] n=4 | **222** [-484.404, 928.404] |

### cell `null-snake6` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

12 games in 4 blocks. cap-terminal rate: default 0.833, staging-off 0.917

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | staging-off (level) | Δ staging-off−default [95% CI] |
|---|---|---|---|
| sharePar | 2.2719 [1.9672, 2.5765] n=4 | 2.2522 [1.9886, 2.5159] n=4 | **-0.0196** [-0.148, 0.1087] |
| score | 1 [1, 1] n=4 | 1 [1, 1] n=4 | **0** [0, 0] |
| win | 1 [1, 1] n=4 | 1 [1, 1] n=4 | **0** [0, 0] |
| place | 1 [1, 1] n=4 | 1 [1, 1] n=4 | **0** [0, 0] |
| finalMaterial | 37.75 [35.4844, 40.0156] n=4 | 36.5833 [30.0683, 43.0984] n=4 | **-1.1667** [-5.7185, 3.3851] |
| finalUnits | 4.6667 [4.2337, 5.0997] n=4 | 4.5833 [3.7878, 5.3788] n=4 | **-0.0833** [-0.5911, 0.4244] |
| survived | 1 [1, 1] n=4 | 1 [1, 1] n=4 | **0** [0, 0] |
| turns | 117.5833 [110.2428, 124.9239] n=4 | 119.9167 [119.6515, 120.1818] n=4 | **2.3333** [-5.0913, 9.758] |
| decisive | 0.1667 [-0.1395, 0.4729] n=4 | 0.0833 [-0.1818, 0.3485] n=4 | **-0.0833** [-0.3485, 0.1818] |
| decisions | 117.5833 [110.2428, 124.9239] n=4 | 119.9167 [119.6515, 120.1818] n=4 | **2.3333** [-5.0913, 9.758] |
| worstWallMs | 1994 [1957.475, 2030.525] n=4 | 1983.0833 [1965.0969, 2001.0698] n=4 | **-10.9167** [-45.5427, 23.7093] |
| overrunRate | 0.0049 [-0.0007, 0.0104] n=4 | 0.0014 [-0.0012, 0.004] n=4 | **-0.0035** [-0.011, 0.0041] |
| unstagedRate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| ratchetRate | 0.0284 [0.0065, 0.0504] n=4 | 0.0257 [0.0116, 0.0399] n=4 | **-0.0027** [-0.035, 0.0296] |
| deathsSelf | 0.3333 [-0.0997, 0.7663] n=4 | 0.25 [-0.2578, 0.7578] n=4 | **-0.0833** [-0.3485, 0.1818] |
| deathsWall | 0.1667 [-0.1395, 0.4729] n=4 | 0.0833 [-0.1818, 0.3485] n=4 | **-0.0833** [-0.3485, 0.1818] |
| deathsExhaustion | 0.25 [-0.2578, 0.7578] n=4 | 0.3333 [-0.0997, 0.7663] n=4 | **0.0833** [-0.4244, 0.5911] |
| deathsBodyBlock | 0.0833 [-0.1818, 0.3485] n=4 | 0 [0, 0] n=4 | **-0.0833** [-0.3485, 0.1818] |
| deathsContest | 0.5 [-0.0303, 1.0303] n=4 | 0.75 [-0.2539, 1.7539] n=4 | **0.25** [-0.2578, 0.7578] |
| deathsTeammate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 4179.8333 [3492.2417, 4867.425] n=4 | 4404.5833 [3185.5842, 5623.5824] n=4 | **224.75** [-1672.4591, 2121.9591] |
| clusterEnumMs | 2322.4167 [1789.5348, 2855.2986] n=4 | 2282.5833 [1659.4497, 2905.717] n=4 | **-39.8333** [-289.0165, 209.3498] |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1396.25 [1357.0929, 1435.4071] n=4 | 1393.0833 [1220.9019, 1565.2647] n=4 | **-3.1667** [-162.4813, 156.148] |
| scoutPlies | 1285.9167 [1139.1166, 1432.7168] n=4 | 1259 [1128.6912, 1389.3088] n=4 | **-26.9167** [-127.1944, 73.3611] |
| scoutRefusals | 315.9167 [297.1597, 334.6737] n=4 | 320.6667 [291.9111, 349.4223] n=4 | **4.75** [-27.0741, 36.5741] |
| ceilingDecided | 1239.8333 [-1362.3555, 3842.0222] n=4 | 530.9167 [-643.0914, 1704.9247] n=4 | **-708.9167** [-3111.5115, 1693.6782] |
| illegal | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| errors | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 389363.0833 [241694.6885, 537031.4781] n=4 | 404300.25 [245809.1246, 562791.3754] n=4 | **14937.1667** [-33065.2767, 62939.61] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |

### cell `snake5-queen` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

12 games in 4 blocks. cap-terminal rate: default 1, staging-off 0.75

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | default (level) | staging-off (level) | Δ staging-off−default [95% CI] |
|---|---|---|---|
| sharePar | 1.3853 [0.9875, 1.7832] n=4 | 1.7538 [0.8337, 2.674] n=4 | **0.3685** [-0.5795, 1.3165] |
| score | 0.7083 [0.4545, 0.9622] n=4 | 0.8333 [0.6168, 1.0498] n=4 | **0.125** [-0.1289, 0.3789] |
| win | 0.5 [0.1938, 0.8062] n=4 | 0.6667 [0.2337, 1.0997] n=4 | **0.1667** [-0.3637, 0.697] |
| place | 1.5833 [1.0756, 2.0911] n=4 | 1.3333 [0.9003, 1.7663] n=4 | **-0.25** [-0.7578, 0.2578] |
| finalMaterial | 31.3333 [20.209, 42.4577] n=4 | 30.4167 [22.9999, 37.8334] n=4 | **-0.9167** [-12.8334, 11.0001] |
| finalUnits | 1.1667 [0.8605, 1.4729] n=4 | 1.5 [-0.4606, 3.4606] n=4 | **0.3333** [-1.452, 2.1187] |
| survived | 0.9167 [0.6515, 1.1818] n=4 | 0.9167 [0.6515, 1.1818] n=4 | **0** [0, 0] |
| turns | 120 [120, 120] n=4 | 114.4167 [107.6061, 121.2272] n=4 | **-5.5833** [-12.3939, 1.2272] |
| decisive | 0 [0, 0] n=4 | 0.25 [-0.0152, 0.5152] n=4 | **0.25** [-0.0152, 0.5152] |
| decisions | 119.4167 [117.5605, 121.2728] n=4 | 114.4167 [107.6061, 121.2272] n=4 | **-5** [-10.579, 0.579] |
| worstWallMs | 1964.3333 [1956.527, 1972.1396] n=4 | 1974.1667 [1942.1865, 2006.1468] n=4 | **9.8333** [-25.9016, 45.5683] |
| overrunRate | 0 [0, 0] n=4 | 0.0014 [-0.003, 0.0058] n=4 | **0.0014** [-0.003, 0.0058] |
| unstagedRate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| ratchetRate | 0.0007 [-0.0015, 0.0029] n=4 | 0.0194 [-0.0048, 0.0437] n=4 | **0.0187** [-0.0058, 0.0433] |
| deathsSelf | 0.1667 [-0.1395, 0.4729] n=4 | 0.75 [-0.1557, 1.6557] n=4 | **0.5833** [-0.2122, 1.3788] |
| deathsWall | 0.1667 [-0.3637, 0.697] n=4 | 1.4167 [0.2407, 2.5926] n=4 | **1.25** [-0.4479, 2.9479] |
| deathsExhaustion | 0.1667 [-0.3637, 0.697] n=4 | 0.3333 [-0.4167, 1.0833] n=4 | **0.1667** [-0.9373, 1.2706] |
| deathsBodyBlock | 1.75 [0.7461, 2.7539] n=4 | 0.4167 [-0.0911, 0.9244] n=4 | **-1.3333** [-2.3016, -0.3651] ✱ |
| deathsContest | 2.5833 [1.0601, 4.1066] n=4 | 1.5833 [0.7878, 2.3788] n=4 | **-1** [-3.0767, 1.0767] |
| deathsTeammate | 0.6667 [-0.0833, 1.4167] n=4 | 0.3333 [-0.0997, 0.7663] n=4 | **-0.3333** [-1.479, 0.8123] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | 6417.5833 [5314.3415, 7520.8252] n=4 | 8561.5 [4040.0888, 13082.9112] n=4 | **2143.9167** [-2557.1894, 6845.0227] |
| clusterEnumMs | 29782.8333 [26035.1847, 33530.482] n=4 | 25160.4167 [19820.5578, 30500.2756] n=4 | **-4622.4167** [-7555.6467, -1689.1866] ✱ |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | 1596 [1424.0253, 1767.9747] n=4 | 1831.9167 [1252.5137, 2411.3196] n=4 | **235.9167** [-309.6991, 781.5324] |
| scoutPlies | 2239.8333 [2094.7341, 2384.9326] n=4 | 2107.25 [1723.3142, 2491.1858] n=4 | **-132.5833** [-508.9684, 243.8018] |
| scoutRefusals | 0.0833 [-0.1818, 0.3485] n=4 | 6.25 [-3.7223, 16.2223] n=4 | **6.1667** [-3.6552, 15.9886] |
| ceilingDecided | 6499.4167 [1099.2982, 11899.5352] n=4 | 2444.1667 [463.6462, 4424.6871] n=4 | **-4055.25** [-8108.526, -1.974] ✱ |
| illegal | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| errors | 0 [0, 0] n=4 | 0 [0, 0] n=4 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 46208.5 [21917.3511, 70499.6489] n=4 | 70606.5833 [12895.063, 128318.1037] n=4 | **24398.0833** [-10320.3762, 59116.5429] |
| ~~boundsInversions~~ (retired) | 14510.9167 [-5710.6945, 34732.5279] n=4 | 31122.5833 [-47908.6894, 110153.856] n=4 | **16611.6667** [-75600.2078, 108823.5411] |

