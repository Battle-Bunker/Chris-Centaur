# Paired aggregation — p16-budget-500

Base arm: `integrated`. Generated 2026-08-31T02:52:28.916Z.

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

## p16-budget-500

Subject: `integrated:lobster-territory perf-substrate:lobster-territory` · arms: integrated, perf-substrate · paired 48 games

**Arm audit** — the flags each engine RESOLVED:

| flag | perf-substrate |
|---|---|

### cell `headline-mix-king@500` — 25x25, 3 teams x 6, 500ms, cap 120, food 0.5, hazards none, potions false

24 games in 8 blocks. cap-terminal rate: integrated 0.042, perf-substrate 0

| metric | integrated (level) | perf-substrate (level) | Δ perf-substrate−integrated [95% CI] |
|---|---|---|---|
| sharePar | 1.3326 [0.737, 1.9282] n=8 | 1.6921 [1.0195, 2.3647] n=8 | **0.3595** [-0.1589, 0.8779] |
| score | 0.6667 [0.5613, 0.772] n=8 | 0.7292 [0.5814, 0.877] n=8 | **0.0625** [-0.0853, 0.2103] |
| win | 0.4583 [0.251, 0.6657] n=8 | 0.5833 [0.3363, 0.8304] n=8 | **0.125** [-0.0824, 0.3324] |
| place | 1.6667 [1.456, 1.8774] n=8 | 1.5417 [1.246, 1.8373] n=8 | **-0.125** [-0.4206, 0.1706] |
| finalMaterial | 10.6667 [4.6371, 16.6963] n=8 | 12.6667 [5.4016, 19.9317] n=8 | **2** [-5.0495, 9.0495] |
| finalUnits | 1.9583 [0.9764, 2.9402] n=8 | 2.9167 [1.898, 3.9353] n=8 | **0.9583** [0.373, 1.5437] ✱ |
| survived | 0.4583 [0.251, 0.6657] n=8 | 0.5417 [0.3343, 0.749] n=8 | **0.0833** [-0.1137, 0.2804] |
| turns | 47.5 [34.2667, 60.7333] n=8 | 32.7083 [17.2441, 48.1726] n=8 | **-14.7917** [-34.9355, 5.3522] |
| decisive | 0.9583 [0.8598, 1.0569] n=8 | 1 [1, 1] n=8 | **0.0417** [-0.0569, 0.1402] |
| decisions | 44.125 [32.6429, 55.6071] n=8 | 31.5833 [16.101, 47.0657] n=8 | **-12.5417** [-31.6409, 6.5575] |
| worstWallMs | 449.9583 [442.4168, 457.4998] n=8 | 764.7083 [598.0317, 931.385] n=8 | **314.75** [151.8437, 477.6563] ✱ |
| overrunRate | 0 [0, 0] n=8 | 0.2176 [0.0912, 0.344] n=8 | **0.2176** [0.0912, 0.344] ✱ |
| unstagedRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| deathsSelf | 0.0417 [-0.0569, 0.1402] n=8 | 0 [0, 0] n=8 | **-0.0417** [-0.1402, 0.0569] |
| deathsWall | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| deathsExhaustion | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| deathsBodyBlock | 0.2917 [0.0591, 0.5243] n=8 | 0.125 [-0.0824, 0.3324] n=8 | **-0.1667** [-0.4998, 0.1665] |
| deathsContest | 1.6667 [1.0004, 2.3329] n=8 | 1.1667 [0.6955, 1.6378] n=8 | **-0.5** [-1.1143, 0.1143] |
| deathsTeammate | 0.2083 [0.001, 0.4157] n=8 | 0.2083 [-0.047, 0.4637] n=8 | **0** [-0.3331, 0.3331] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | — | 47071.3333 [26195.1015, 67947.5651] n=8 | — |
| clusterEnumMs | — | 10648.4167 [6835.9968, 14460.8365] n=8 | — |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | — | 742.5833 [374.0991, 1111.0675] n=8 | — |
| scoutPlies | — | 579.5417 [387.9022, 771.1811] n=8 | — |
| scoutRefusals | — | 0 [0, 0] n=8 | — |
| ceilingDecided | — | 1.375 [0.1158, 2.6342] n=8 | — |
| illegal | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| errors | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 448.5833 [293.715, 603.4517] n=8 | 320.625 [-71.2919, 712.5419] n=8 | **-127.9583** [-539.552, 283.6353] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=8 | 268.75 [-366.8438, 904.3438] n=8 | **268.75** [-366.8438, 904.3438] |

### cell `null-snake6@500` — 25x25, 3 teams x 6, 500ms, cap 120, food 0.5, hazards none, potions false

24 games in 8 blocks. cap-terminal rate: integrated 1, perf-substrate 0.917

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | integrated (level) | perf-substrate (level) | Δ perf-substrate−integrated [95% CI] |
|---|---|---|---|
| sharePar | 2.2065 [2.0298, 2.3832] n=8 | 2.3101 [2.1593, 2.4609] n=8 | **0.1036** [-0.1551, 0.3623] |
| score | 1 [1, 1] n=8 | 1 [1, 1] n=8 | **0** [0, 0] |
| win | 1 [1, 1] n=8 | 1 [1, 1] n=8 | **0** [0, 0] |
| place | 1 [1, 1] n=8 | 1 [1, 1] n=8 | **0** [0, 0] |
| finalMaterial | 44.1667 [38.2786, 50.0547] n=8 | 41.1667 [34.6625, 47.6708] n=8 | **-3** [-9.7339, 3.7339] |
| finalUnits | 5.1667 [4.6726, 5.6608] n=8 | 4.9167 [4.289, 5.5443] n=8 | **-0.25** [-0.9606, 0.4606] |
| survived | 1 [1, 1] n=8 | 1 [1, 1] n=8 | **0** [0, 0] |
| turns | 120 [120, 120] n=8 | 119.125 [117.1658, 121.0842] n=8 | **-0.875** [-2.8342, 1.0842] |
| decisive | 0 [0, 0] n=8 | 0.0833 [-0.0457, 0.2124] n=8 | **0.0833** [-0.0457, 0.2124] |
| decisions | 120 [120, 120] n=8 | 119.125 [117.1658, 121.0842] n=8 | **-0.875** [-2.8342, 1.0842] |
| worstWallMs | 462.9167 [461.4742, 464.3592] n=8 | 476.4583 [464.8093, 488.1074] n=8 | **13.5417** [1.1593, 25.9241] ✱ |
| overrunRate | 0 [0, 0] n=8 | 0.0003 [-0.0005, 0.0012] n=8 | **0.0003** [-0.0005, 0.0012] |
| unstagedRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ratchetRate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| deathsSelf | 0.25 [0.0029, 0.4971] n=8 | 0.4167 [0.0296, 0.8037] n=8 | **0.1667** [-0.2275, 0.5608] |
| deathsWall | 0.125 [-0.0824, 0.3324] n=8 | 0.125 [-0.0824, 0.3324] n=8 | **0** [-0.3331, 0.3331] |
| deathsExhaustion | 0.125 [-0.0193, 0.2693] n=8 | 0.0417 [-0.0569, 0.1402] n=8 | **-0.0833** [-0.2124, 0.0457] |
| deathsBodyBlock | 0.125 [-0.0193, 0.2693] n=8 | 0.125 [-0.0824, 0.3324] n=8 | **0** [-0.298, 0.298] |
| deathsContest | 0.2083 [0.001, 0.4157] n=8 | 0.375 [0.0612, 0.6888] n=8 | **0.1667** [-0.0914, 0.4247] |
| deathsTeammate | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| wasmRuns | — | — | — |
| wasmRefused | — | — | — |
| clusterJoints | — | 5281.1667 [4296.9522, 6265.3811] n=8 | — |
| clusterEnumMs | — | 2291.7083 [2006.3418, 2577.0749] n=8 | — |
| selectionFar | — | — | — |
| selectionDraws | — | — | — |
| refineMovedLo | — | — | — |
| refineInverted | — | — | — |
| scoutThreads | — | 1409.5833 [1333.3147, 1485.852] n=8 | — |
| scoutPlies | — | 992.4583 [933.1929, 1051.7237] n=8 | — |
| scoutRefusals | — | 311.25 [298.5143, 323.9857] n=8 | — |
| ceilingDecided | — | 26.7917 [5.4473, 48.136] n=8 | — |
| illegal | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| errors | 0 [0, 0] n=8 | 0 [0, 0] n=8 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 33654.7083 [25080.5531, 42228.8635] n=8 | 82762.5417 [62737.2217, 102787.8616] n=8 | **49107.8333** [36833.7253, 61381.9413] ✱ |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=8 | 208.5 [-284.6025, 701.6025] n=8 | **208.5** [-284.6025, 701.6025] |

