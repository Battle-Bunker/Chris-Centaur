# VALUE lens — which script produces which number

Every figure in `../SYNTHESIS.md` and `../value-algebra.md` comes from one of these. They
read the R1 evaluator-ladder replays directly and play no games.

**Path assumption.** Each script hardcodes `SP=<scratchpad>` and expects batches at
`$SP/continuous/{rl1,rl3,rl4,rl5}/arms/*/*/*.jsonl.gz`. Change the one `SP=` line to
re-point them. `rl1` = snake6, `rl3` = snake5-knight, `rl4` = snake5-queen, `rl5` =
snake5-rook. They tolerate in-flight (truncated) `.gz` files and skip them, so they are safe
to run against a batch that is still being written.

| script | produces |
|---|---|
| `mine1.py` | end reasons, `sharePar` distributions, survival rates — §1.1's dead-instrument evidence |
| `mine2.py` | death causes, deaths/game, severs, final and peak material by bot |
| `mine3.py` | search telemetry (`plansEvaluated`, horizons, postures) — rules out the compute-tax hypothesis |
| `mine4.py` | early (t≤40) vs late deaths, material trajectory — the unconfounded behavioural comparison |
| `mine5.py` | score variance, elimination counts, piece-death linkage |
| `mine6.py` | **paired within-game** statistics with CIs — the §1 table |
| `mine7.py` | share channel vs elimination channel, split on whether any team was eliminated |
| `mine8.py` | weight concentration in the piece; `sharePar` conditioned on piece survival — §2 |
| `mine9.py` | death-count vs weight-lost as predictors |
| `mine10.py` | weight share vs unit count as predictors — §3.3's negative result |
| `mine11.py` | first pass at the fold; coefficient spread across cells |
| `mine12.py` | **pooled through-origin regression, three nested predictors — §3.2** |
| `mine13.py` | own-loss vs others'-loss regression — the 2.00 asymmetry, §3.4 |
| `mine14.py` | inflow + outflow folded as one predictor — §3.2b |
| `mine15.py` | **all three channels, one coefficient — §3.2c, the headline** |
| `forecast-rook3.py` | the pre-registered rook forecast at `k = 1.227`; **re-run when `rl5` completes** |

`forecast-rook.py` is the superseded outflow-only version, kept only so the earlier
pre-registration in the git history can be reproduced.

## The one thing to run first

```
python3 mine15.py          # the three-channel fold: k=1.227, R^2=0.970
python3 forecast-rook3.py  # the out-of-sample test, once rl5 has games
```
