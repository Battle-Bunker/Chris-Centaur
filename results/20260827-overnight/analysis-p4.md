# Paired aggregation — 20260827-overnight

Base arm: `tier-expiry`. Generated 2026-08-28T01:30:02.246Z.

Intervals are 95% t over BLOCK means; `n` is the number of seeds. A delta whose
interval includes zero is a NULL RESULT and must be written up as one.

**Placement resolution.** At 16 blocks the normalized placement score resolves to
roughly ±0.10. A |delta score| under that is not a small effect, it is no effect
this design can see — read the mechanism rows instead.

## p4-tiertruth-potions

Subject: `tier-expiry:lobster-material tier-full:lobster-material` · arms: tier-expiry, tier-full · paired 144 games

### cell `null-nopotion-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions false

48 games in 16 blocks. cap-terminal rate: tier-expiry 0.396, tier-full 0.271

| metric | tier-expiry (level) | tier-full (level) | Δ tier-full−tier-expiry [95% CI] |
|---|---|---|---|
| score | 0.75 [0.6706, 0.8294] n=16 | 0.7813 [0.7037, 0.8588] n=16 | **0.0313** [-0.0672, 0.1297] |
| win | 0.5625 [0.4375, 0.6875] n=16 | 0.5625 [0.4074, 0.7176] n=16 | **0** [-0.1716, 0.1716] |
| place | 1.5 [1.3412, 1.6588] n=16 | 1.4375 [1.2824, 1.5926] n=16 | **-0.0625** [-0.2594, 0.1344] |
| finalMaterial | 24.2083 [18.9994, 29.4173] n=16 | 19.3125 [13.9439, 24.6811] n=16 | **-4.8958** [-10.7184, 0.9267] |
| finalUnits | 3.4167 [2.9559, 3.8775] n=16 | 3.125 [2.5103, 3.7397] n=16 | **-0.2917** [-1.0249, 0.4416] |
| survived | 0.8125 [0.7008, 0.9242] n=16 | 0.7083 [0.5652, 0.8515] n=16 | **-0.1042** [-0.2843, 0.076] |
| turns | 79.375 [66.1751, 92.5749] n=16 | 70.125 [58.7636, 81.4864] n=16 | **-9.25** [-27.0274, 8.5274] |
| decisive | 0.6042 [0.4183, 0.7901] n=16 | 0.7292 [0.596, 0.8624] n=16 | **0.125** [-0.1077, 0.3577] |
| decisions | 77.7708 [63.6512, 91.8905] n=16 | 70.125 [58.7636, 81.4864] n=16 | **-7.6458** [-25.9631, 10.6714] |
| worstWallMs | 1953.6042 [1950.6353, 1956.573] n=16 | 1949.9583 [1945.815, 1954.1017] n=16 | **-3.6458** [-8.1381, 0.8465] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0015 [-0.0013, 0.0043] n=16 | 0.0027 [-0.0003, 0.0057] n=16 | **0.0012** [-0.0032, 0.0056] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 8223.5625 [3686.1802, 12760.9448] n=16 | 10992.5625 [3026.023, 18959.102] n=16 | **2769** [-5799.0004, 11337.0004] |
| ~~boundsInversions~~ (retired) | 0 [0, 0] n=16 | 103.6042 [-102.6432, 309.8515] n=16 | **103.6042** [-102.6432, 309.8515] |

### cell `potion-mix-king` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions true

48 games in 16 blocks. cap-terminal rate: tier-expiry 0.333, tier-full 0.271

| metric | tier-expiry (level) | tier-full (level) | Δ tier-full−tier-expiry [95% CI] |
|---|---|---|---|
| score | 0.7396 [0.6372, 0.842] n=16 | 0.6771 [0.5773, 0.7769] n=16 | **-0.0625** [-0.2176, 0.0926] |
| win | 0.5 [0.3055, 0.6945] n=16 | 0.4583 [0.3152, 0.6015] n=16 | **-0.0417** [-0.308, 0.2247] |
| place | 1.5208 [1.3161, 1.7256] n=16 | 1.6458 [1.4463, 1.8454] n=16 | **0.125** [-0.1851, 0.4351] |
| finalMaterial | 19.7917 [13.4758, 26.1075] n=16 | 16.5625 [10.5324, 22.5926] n=16 | **-3.2292** [-12.9341, 6.4758] |
| finalUnits | 2.7292 [1.8957, 3.5627] n=16 | 2.4792 [1.914, 3.0443] n=16 | **-0.25** [-1.4588, 0.9588] |
| survived | 0.6667 [0.4951, 0.8382] n=16 | 0.5625 [0.4216, 0.7034] n=16 | **-0.1042** [-0.3613, 0.1529] |
| turns | 76.4792 [65.0544, 87.9039] n=16 | 64.5625 [48.3441, 80.7809] n=16 | **-11.9167** [-28.9499, 5.1166] |
| decisive | 0.6667 [0.5078, 0.8255] n=16 | 0.7292 [0.5549, 0.9034] n=16 | **0.0625** [-0.1448, 0.2698] |
| decisions | 76.1042 [64.5448, 87.6635] n=16 | 62.0833 [45.003, 79.1637] n=16 | **-14.0208** [-33.1709, 5.1293] |
| worstWallMs | 1952.5 [1949.8099, 1955.1901] n=16 | 1950.625 [1945.8038, 1955.4462] n=16 | **-1.875** [-6.8927, 3.1427] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0016 [-0.0002, 0.0034] n=16 | 0.0032 [0, 0.0065] n=16 | **0.0016** [-0.0022, 0.0053] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 8095.3333 [853.6253, 15337.0413] n=16 | 3643.8125 [1315.9855, 5971.6395] n=16 | **-4451.5208** [-12106.2858, 3203.2441] |
| ~~boundsInversions~~ (retired) | 6.0208 [-6.8096, 18.8512] n=16 | 336.375 [-380.4401, 1053.1901] n=16 | **330.3542** [-387.4305, 1048.1388] |

### cell `potion-snake5-queen` — 25x25, 3 teams x 6, 2000ms, cap 120, food 0.5, hazards none, potions true

48 games in 16 blocks. cap-terminal rate: tier-expiry 0.979, tier-full 0.979

> **More than half of these games hit the turn cap.** A cell that mostly ends by
> running out of turns is measuring a stall, not play. Treat its placement rows as
> uninterpretable and raise the cap or shorten the board before rerunning.

| metric | tier-expiry (level) | tier-full (level) | Δ tier-full−tier-expiry [95% CI] |
|---|---|---|---|
| score | 0.7708 [0.707, 0.8347] n=16 | 0.7708 [0.707, 0.8347] n=16 | **0** [-0.0725, 0.0725] |
| win | 0.5625 [0.4375, 0.6875] n=16 | 0.5417 [0.414, 0.6693] n=16 | **-0.0208** [-0.1725, 0.1308] |
| place | 1.4583 [1.3307, 1.586] n=16 | 1.4583 [1.3307, 1.586] n=16 | **0** [-0.145, 0.145] |
| finalMaterial | 33.0833 [29.4616, 36.705] n=16 | 33.1875 [30.2992, 36.0758] n=16 | **0.1042** [-3.6128, 3.8211] |
| finalUnits | 1.2917 [1.1216, 1.4617] n=16 | 1.1458 [1.0548, 1.2368] n=16 | **-0.1458** [-0.3606, 0.0689] |
| survived | 0.9792 [0.9348, 1.0236] n=16 | 1 [1, 1] n=16 | **0.0208** [-0.0236, 0.0652] |
| turns | 119.125 [117.2604, 120.9896] n=16 | 119.7708 [119.2825, 120.2592] n=16 | **0.6458** [-1.3129, 2.6046] |
| decisive | 0.0208 [-0.0236, 0.0652] n=16 | 0.0208 [-0.0236, 0.0652] n=16 | **0** [-0.0648, 0.0648] |
| decisions | 118.7083 [116.6972, 120.7194] n=16 | 119.7708 [119.2825, 120.2592] n=16 | **1.0625** [-1.0499, 3.1749] |
| worstWallMs | 1962.9167 [1960.7862, 1965.0472] n=16 | 1962.8542 [1961.5065, 1964.2019] n=16 | **-0.0625** [-2.2163, 2.0913] |
| overrunRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| unstagedRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| stagedNothingRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| assumptionRate | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ratchetRate | 0.0017 [-0.0004, 0.0038] n=16 | 0.0002 [-0.0002, 0.0005] n=16 | **-0.0015** [-0.0037, 0.0006] |
| illegal | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| errors | 0 [0, 0] n=16 | 0 [0, 0] n=16 | **0** [0, 0] |
| ~~plansEvaluated~~ (retired) | 83898.7292 [51082.7016, 116714.7567] n=16 | 125689.2292 [56552.3851, 194826.0733] n=16 | **41790.5** [-26667.1261, 110248.1261] |
| ~~boundsInversions~~ (retired) | 74.2917 [-84.0239, 232.6072] n=16 | 0 [0, 0] n=16 | **-74.2917** [-232.6072, 84.0239] |

## Integrity problems

(7 entries in the on-disk original — dominated by other experiments' sweeps being skipped for this pass's base arm, which is expected in a multi-experiment batch; full list in the zip archive.)