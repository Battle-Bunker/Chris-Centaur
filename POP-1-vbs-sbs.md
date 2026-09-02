> **QUALIFIER ADDED, see `POP-3` §4.** The null is one of three readings: (a) no headroom,
> (b) headroom THE POOL CANNOT EXPRESS, (c) underpowered. Profile correlations of +0.996 and
> +0.879 are direct evidence for (b). Under (b) the architecture's pitch is the ability to hold
> members that are not variations of each other, and this instrument should be a standing column
> re-run whenever a non-lineage member seats.

# POPULATION INSTRUMENT 1 — the VBS − SBS gap

**Population premise, stamped first because these are measurements *of* the lineage problem.**
18,302 games from the whole on-disk archive; 43 cells; 14 bot identities, all descended from one
codebase; every game bot-vs-bot with no external opponent. Conservation asserted inside the
extraction (per game the seat `sharePar`s must sum to K — **6 games failed and were dropped**).
`sharePar` is native in 39,248 rows and **derived from final material in 15,638** (the large
overnight batch predates the field); every table below was re-run on native-only rows and the
verdict does not change.

---

## 1. THE TABLE

**SBS** = arm with the best aggregate `sharePar`. **VBS** = per scenario take the best arm, then
average. **Floor** = the same statistic computed over pseudo-arms built from *one bot's own*
replications, so it contains only noise and seat effects.

| block (games) | granularity | n | SBS | VBS | **gap** | **floor** | **excess** |
|---|---|---|---|---|---|---|---|
| material/territory/reflex (4,649) | per-seed | 790 | 1.715 | 2.044 | +0.328 | +0.433 | **−0.104** |
| | **per-cell** | 25 | 1.653 | 1.724 | **+0.071** | **+0.078** | **−0.008** |
| plain/potionBoth/potionOrder (934) | per-seed | 216 | 1.036 | 1.391 | +0.355 | +0.409 | **−0.054** |
| | **per-cell** | 6 | 1.040 | 1.086 | **+0.046** | **+0.012** | **+0.034** |
| parentDefault/potionIntel/reflex (302) | per-seed | 59 | 1.436 | 1.585 | +0.149 | +0.150 | **−0.001** |
| | **per-cell** | 7 | 1.320 | 1.409 | **+0.089** | **+0.033** | +0.056 |

---

## 2. READING

**The per-seed gap is entirely noise, on every block.** +0.33 to +0.36 looks like a large
headroom until it is compared with what the *same bot* achieves against its own rotations:
+0.15 to +0.43. The excess is **negative in all three blocks**. A per-seed selector — an oracle
choosing the right member for each individual game — buys nothing that shuffling one bot's own
replications does not. Any VBS number quoted without this floor is a measurement of variance.

**The per-cell gap on the main lineage is also at its floor.** +0.071 against a floor of +0.078,
**excess −0.008**, over 4,649 games and 25 cells — the largest and best-powered block in the
archive. **On the lineage that matters, per-board member selection has no measurable headroom.**

**One real signal survives, and it is small and specific.** The potion block clears its floor by
**+0.034** (gap +0.046, floor +0.012), and the per-joint decomposition says exactly where:

| cell | n | best arm | gain over SBS |
|---|---|---|---|
| potion-hazard-snake6 | 288 | plain | **+0.144** |
| potion-hazdose15-snake6 | 72 | plain | +0.085 |
| potion-hazdose05-snake6 | 70 | potionBoth | +0.048 |

**Every cell where switching pays is a hazard cell.** That is the k1/k2 finding recovered
independently, from a different statistic, on 430 games — and it is the only well-powered
member-selection signal in 18,302 games.

**The third block's +0.056 excess should not be banked.** Its entire gain comes from
`pi-depth-400` and `pi-depth-4000`, **n = 3 games each**. That is noise wearing a decomposition's
clothing, and it is exactly what the per-cell floor exists to catch — the floor there (+0.033) is
built from cells with more data than the cells driving the gap.

### The per-joint decomposition (M42), and why I will not rank build increments on it

In the main block, switching helps in 8 of 25 cells, and the pattern is not random:

| cell | n | best arm | gain |
|---|---|---|---|
| c3-queen2 | 24 | material | +0.436 |
| null-nopotion-mix-king | 48 | material | +0.341 |
| headline-mix-king@500 | 48 | material | +0.335 |
| **snake5-knight** | **336** | **reflex** | **+0.289** |
| potion-snake5-queen | 48 | material | +0.182 |
| c3-knight | 24 | material | +0.118 |

**Piece and king boards, every one.** This is the same joint my own lens has been circling all
session: territory wins on snake boards and loses on piece boards. And the best-powered row is the
one I would most want the program to look at — on `snake5-knight`, over 336 games, **the best arm
is `reflex`, the non-searching baseline.** That is independent corroboration of the dead-instrument
finding: on a board where nothing an evaluator does can move the outcome, not searching is the
best available policy.

**But the block gap is below its floor, so I am not ranking build increments on these rows.** The
per-cell gains are individually large and collectively indistinguishable from noise. Reporting the
ranking without that sentence is how a floor-failing measurement becomes a roadmap.

---

## 3. THE VERDICT ASKED FOR

> **Small gap. The member-selection architecture's honest pitch is hygiene, not strength.**

On the main lineage the headroom is **−0.008 against its floor**; across the archive the one
defensible selection gain is **+0.034**, confined to hazard boards. Against `sharePar` par = 1.0
that is ~3%, and it is the ceiling on what *perfect* per-board selection could buy — an actual
selector, which must infer the board class and will sometimes be wrong, gets less.

**Two things that would be wrong to conclude.**

1. **Not "selection is worthless in this game" — "selection is worth little among *these members*".**
   VBS is bounded above by how much the arms disagree, and instrument 2 measures that disagreement
   directly: `territory`/`slider` correlate **+0.996** across cells and `plain`/`potionOrder`
   **+0.879**, against a −0.5 null. Half the pool is duplicated. **A small VBS gap over a redundant
   pool is a fact about the pool, not about selection**, which is exactly why the two instruments
   were commissioned together.
2. **Not "the composition architecture is unjustified".** It is justified on grounds this
   instrument cannot see — one adjudicator instead of three disagreeing ones, refusal at
   registration, addressed metrics, provenance that travels. Those are correctness properties. What
   this measurement removes is the *strength* argument: nobody should promise that member selection
   will make the bot win more, because on 18,302 games of evidence it does not.

---

## 3b. ROBUSTNESS — and the verdict has to be softened

The librarian's rollup flags [C]: **Balduzzi's invariance axiom excludes uniform averaging by
name**, and my per-cell gap is a uniform average over a cell population the program chose. Testing
my own headline against re-weighting, on the main block (25 cells, 4,649 games):

| weighting | gap |
|---|---|
| uniform (as published) | **+0.0706** |
| **by game count** | **+0.0329** |
| by √(game count) | +0.0545 |
| leave-one-cell-out range | +0.0553 … +0.0735 |
| **bootstrap over cells, 95% CI** | **[+0.0247, +0.1247]** |

**The point estimate is below the +0.078 floor under every weighting**, and *further* below it
under game-count weighting — the more defensible one, since it weights by evidence rather than by
the arbitrary decision of which cells got run. **But the cell-bootstrap CI reaches +0.125, above
the floor.**

**So I soften the verdict.** The correct statement is **"no evidence the gap clears its noise
floor"**, not "the gap is below its floor". With 25 cells the cell-level sampling error is wide
enough that a real gap of ~0.12 cannot be excluded. What *is* robust is the direction and the
order of magnitude: under every weighting the headroom is between 0.03 and 0.07 sharePar, i.e. 3–7%
of par, and it never approaches the size of the effects the program routinely chases.

(One asymmetry to note: the floor was computed under uniform cell weights and not itself
bootstrapped, so the comparison is not perfectly like-for-like. Bootstrapping both is the clean
version and I did not do it.)

---

## 4. WHAT THIS INSTRUMENT CANNOT SEE

- **VBS is an oracle bound.** It assumes free, perfect knowledge of the right member per scenario.
  A real selector is strictly worse.
- **The scenario axis is the cells that were run**, which the program chose. A member that is
  brilliant on a board nobody tested contributes nothing here.
- **Blocks are not comparable to each other.** Different bot sets on different cells; the per-arm
  means are within-game and zero-sum, so they compare arms inside a block and nothing across.
- **Derived-`sharePar` rows** cannot fail the conservation check (it is vacuous by construction for
  them). The native-only re-run is the load-bearing one and it agrees: per-cell gap +0.061, per-seed
  +0.339 against floor +0.395.
