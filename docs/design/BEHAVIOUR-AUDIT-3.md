# Behaviour audit 3 — the wide corpus: five new board shapes, read at `81063d7`

Audits 1 and 2 read the SAME 26 games. `docs/ORCHESTRATOR-LOOP.md` closed that
corpus — "the behaviour programme on the 26-game corpus is at its floor... the
only decidable next step is more board" — so this audit reads a different
corpus: the five old classes UNCHANGED, plus five new shapes built from one
parameterised `boardOfShape` (`src/tests/local-game.ts`, the `wide-corpus`
section), every class recorded on two arms.

**Only NEW defect classes are named here.** D1–D6 (audit 1), P1–P4 (audit 2)
and the refutations in `docs/design/DECISIONS.md` are binding: nothing below
re-derives a refuted rule, and where the new board makes a KNOWN class worse
that is reported in §4 as a magnitude, not as a discovery.

## Method and corpus

    scripts/wide-corpus.sh docs/design/wide <seeds> 1

One process per (scenario, seed, arm), deterministic (`--nodes`), so every
number below is a function of (build, scenario, seed, arm) and re-recording it
on `81063d7` reproduces it byte for byte. `arm = mirror` is every team on the
default profile; `arm = material-only` puts every team but team 0 on
`MATERIAL_ONLY_PROFILE`, so on that arm team 0's (`red`'s) deaths are OURS.
60 turns everywhere except `long`, which is 120. The five old classes are
byte-identical to the head at seeds 1–3 (`ab-compare.js`, all zero, 5 classes
flat; and the fifteen JSON summaries equal field-for-field bar `label`/`wall`).

The tables are `docs/design/wide/TABLE.md`, regenerated from disk by
`node scripts/wide-corpus.js table docs/design/wide`; the paired sign tests are
`node scripts/wide-corpus.js pair docs/design/wide <A> <B>`; the death, park and
pickup census is `node scripts/wide-corpus.js census docs/design/wide`. Traces
are not committed — they are a deterministic function of the build, and every
reproduction below prints the one command that regenerates its own.

The new classes, in one line each (`boardOfShape`):

| class | board | rosters | items | asks |
|---|---|---|---|---|
| `wide` | 15×15 | 3 × 4 units | 8 meals | does the bot SCALE — distance, not density |
| `dense` | 11×11 | **4** × 3 units | 6 meals | `mixed`'s board with half again the crowd |
| `asym` | 13×13 | **5 / 3 / 1** units | 6 meals | the first board where team 0 is not level at turn 1 |
| `potion-rich` | 13×13 | 3+3+2 units | 5 meals, **8 potions**, refill 2 | the potion member's "until the game changes" |
| `long` | 11×11 (`mixed`) | `mixed`'s | `mixed`'s | the same games, run to **120** turns |
