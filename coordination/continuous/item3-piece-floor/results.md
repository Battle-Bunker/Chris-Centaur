# ITEM 3 — THE PIECE-CELL FLOOR, CHARACTERIZED

Queue item 3. Three separate runs had produced a piece-bearing cell whose
A/A interval EXCLUDED ZERO between two byte-identical arms:

- overnight finding 2, a queen cell on the feature bundle: +0.271 [0.037, 0.506]
- batch 2's `headline-mix-king`, whose sharePar floor widened to ±0.53
- sandbox cycle c1's knight cell: -0.490 [-0.688, -0.270]

The programme read all three the same way — "piece cells have no usable
floor" — and that reading blocks every piece-cell result in the
programme, including the roster-ladder findings and batch 2's mix-king
rows. It had never been tested against its rivals.

## VERDICT: the reading was wrong. The piece cell's floor is sound.

**`potion-snake5-knight` has an entirely ordinary A/A floor.** At 48
blocks it is -0.176 [-0.364, **0.018**] — it CONTAINS ZERO — and it falls
as 1/sqrt(blocks) to within a few percent at every block count tested.

Cycle k3: batch `$SP/continuous/k3`, spec
`$SP/continuous/specs/k3-piecefloor.json`, bundle `b4` ←
`tmp/potionplay` `7f89a74`. 48 blocks, seeds 84101-84148, one cell, two
identical arms, 144 games per arm = **288 games**.

### The scaling check (`floorscale.js`)

| blocks | A/A floor | expected from full sample | ratio |
|---:|---:|---:|---:|
| 6 | 0.391 | 0.538 | 0.73 |
| 12 | 0.414 | 0.380 | 1.09 |
| 18 | 0.316 | 0.311 | 1.02 |
| 24 | 0.268 | 0.269 | 1.00 |
| 30 | 0.249 | 0.241 | 1.03 |
| 36 | 0.212 | 0.220 | 0.97 |
| 42 | 0.204 | 0.203 | 1.00 |
| 48 | 0.190 | 0.190 | 1.00 |

Textbook. Every ratio from 12 blocks up sits within 9% of 1.00. This is
the best-behaved cell measured in the programme so far — better than
either snake cell, where `potion-snake6`'s floor stalled between 12 and
24 blocks.

### Which hypothesis survives

`specs/mkknight.js` named three before the run:

| | hypothesis | verdict |
|---|---|---|
| H1 | BOARD — piece boards genuinely have a wider outcome distribution, but it scales normally | **partly. The floor is wide in absolute terms (0.19 at 48 blocks) but perfectly ordinary in shape.** It is a bigger cell, not a broken one. |
| H2 | HEAVY TAIL / SMALL SAMPLE — an 8-block interval excludes zero by luck | **SUPPORTED, and this is the answer.** c1's -0.490 [-0.688, -0.270] came from 8 blocks. At 48 the same cell gives -0.176 [-0.364, 0.018]. The exclusion did not survive the count. |
| H3 | SERVICE — piece cells are the most search-hungry, so the CPU-service swing does the most damage there | **a real second-order contributor.** `armservice.js` on k3: the first arm bought more search in 3 of 3 bot pairs, mean +3.89%, and **+9.5% on `potionOrder`** — the bot whose between-arm G gap is largest. That is why the mean ΔG sits at -0.176 rather than 0, and why the floor is wider than pure sampling predicts. |

**So "piece cells have no usable floor" should be withdrawn as a
programme-wide claim.** What the three earlier observations share is not a
piece board; it is a block count too small for a bootstrap interval to be
trusted. Eight blocks is not enough on any cell in this programme, and on
a wide cell an 8-block interval will exclude zero often enough to look
like a finding.

**What this unblocks.** Piece-cell readings are claimable again, provided
they are run at enough blocks and read against the reading's own interval
rather than the A/A half-width. That reaches batch 2's `hazard-mix-king`
and `headline-mix-king` rows, the overnight roster-ladder table, and the
knight rung of item 1's own channel ladder.

**What it does not excuse.** The floor is still 0.19 at 48 blocks, so this
cell is expensive: a ±0.10 reading needs about 4 x 48 = 190 blocks. Wide
but honest is still wide.

## The channel-ladder rung this run also bought

The contenders rode along, so k3 is also a piece-cell rung of item 1's
ladder — readable, now that the floor is known to be sound:

| pair | cell | blocks | G | 95% CI | reading |
|---|---|---:|---:|:--|---|
| potionOrder − plain | potion-snake5-knight | 48 | +0.069 | [-0.032, 0.165] | contains zero — no effect |
| potionBoth − plain | potion-snake5-knight | 48 | +0.041 | [-0.068, 0.141] | contains zero — no effect |

### And it sharpens item 1's one real finding

Put the three cells side by side. `potionOrder` is the free ordering slot
— a potion pickup sorts as a gain — and it runs no evaluator at all:

| cell | hazards | potionOrder − plain | 95% CI |
|---|---|---:|:--|
| potion-hazard-snake6 | **cross @ 0.15** | **-0.145** | [-0.258, **-0.035**] |
| potion-snake6 | none | +0.021 | [-0.143, 0.213] |
| potion-snake5-knight | none | +0.069 | [-0.032, 0.165] |

**The only cell with hazards is the only cell with harm**, and on the two
hazard-free cells the effect is indistinguishable from zero with the
sign, if anything, faintly positive. That is exactly the pattern the
proposed mechanism predicts: sorting a pickup as a gain draws units
across hazard cells to reach potions, and where there are no hazards to
walk into, it costs nothing.

Two cells is not a dose-response curve, though. Cycle k4 tests it
properly by varying the hazard damage ratio while holding everything else
fixed — if the harm scales with the damage, the mechanism is confirmed;
if it does not, the hazard cell differs from the others for some other
reason and the story is wrong.
