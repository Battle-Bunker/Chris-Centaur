# ROOM-PIECES — two readings of `room` put to the corpus, and both are already right

**Verdict: NEGATIVE RESULT, NOTHING SHIPPED.** Two suspicions were carried into
this study by `BEHAVIOUR-AUDIT-2.md` §D5 and `docs/design/DEEP-DEATHS.md` §§5–6
— that `room`'s zero for a piece hides the pocket deaths of snakes standing
beside one, and that `need = max(4, L + 2)` saturates under a slider so a long
snake reads no fear until it is too late. **Measured, both are refused.** The
cap never truncates a region. The piece's zero *inside the flood* is very nearly
the right reading, and the one rule built at it moves 1.85% of readings and no
deaths. What a piece's zero really costs is not in `territory.ts` at all: it is
`ourUnitTerm`'s divisor, and §4 sizes it.

Corpus, unless a section says otherwise: `snakes` and `mixed`, seeds 1–6, 60
turns, `--nodes`, `--opponent=material-only`, both `--side`s — the ENDGAME
corpus narrowed to the two classes this study is about. A **reading** below is
one `lo` partition built during search, for one of our own unheld trail units:
196 731 of them (`snakes` 10 428, `mixed` 186 303) over the twelve side-0 games.
The instrument that recorded them re-floods each reading at four piece-barrier
horizons, at full piece clouds and at a 4× `need`, and it was checked
behaviour-identical against the un-instrumented build on every counter of every
game it ran (only `worstDecisionMs` moves).

## 1. Reproduction

`ENDGAME.md` §3's two class-E deaths reproduce turn-for-turn and cell-for-cell:
`snakes` seed 2 side 0, red-A `self` at T48 with the same 19-cell body; `snakes`
seed 4 side 0, red-B `self` at T49 with the same 13 cells and the same exact tie
at T47. HEAD over the twelve games:

| class | deaths (all teams) | `self`+`bodyBlock` T46–60 (ours) | fatal / episodes / escaped |
|---|---|---|---|
| snakes / side 0 | 19 — bodyBlock 15, self 3, wall 1 | 6 (3) | 19 / 96 / 75 |
| snakes / side 1 | 14 — bodyBlock 8, self 3, wall 2, contest 1 | 2 (1) | 14 / 121 / 99 |
| mixed / side 0 | 25 — contest 21, bodyBlock 2, wall 1, self 1 | 2 (0) | 11 / 18 / **0** |
| mixed / side 1 | 23 — contest 21, bodyBlock 1, self 1 | 0 (0) | 7 / 18 / **0** |

The last column is P4/D5's instrument saturation, reproduced: on `mixed`
**every** entrapment episode on both sides is still open when the game ends —
0 escapes of 18 — against 75 of 96 and 99 of 121 on `snakes`. `fatalEntrapments`
on `mixed` remains a death counter wearing an entrapment label, so §3's gate is
read on the death columns and not on it.

## 2. The `need` cap does not saturate — D5's second clause is REFUTED

Each reading was re-flooded with `need` set to `4 × need` and **the horizon left
exactly as it is**, so the only thing removed is the early exit.

* On **all 13 451** readings where the term actually fires (`kept < need`), the
  two answers are **equal** — 100.0%, on both classes. The cap has never once
  truncated a region that was still growing; the flood stops because the region
  is exhausted, which is the quantity the term claims to measure.
* Where the term is silent the region is genuinely large: median `4×need`-flood
  of **2.86–4.00 × need**, minimum 1.29.
* Silence is **flat in length**, which is the specific claim under test. On
  `snakes`: `L ≤ 5` 92.2% silent (n = 2 292), `6–9` 96.0% (3 934), `10–14` 92.6%
  (3 031), `15–19` 91.3% (1 092), `L ≥ 20` **93.7%** (79). A long snake is not
  silenced more than a short one; if anything the long ones speak slightly more
  often than the middle of the range.

So `kept ≥ need` is a true statement about the region and not an artefact of the
denominator. A longer horizon is separately refuted at `DEEP-DEATHS.md` §5.5
(`h = 1.0` wakes `room` on 5 of 29 fatal decisions and flips zero comparisons),
and a constant denominator at `BEHAVIOUR-AUDIT.md` §D3 (built, measured,
reverted). **The three ways of widening this reading are now all closed.**

## 3. A piece bars the cell it stands on — built, measured, REVERTED

`entrapment.md` §9.4 restricted clause (d) to trail units because a held
slider's *dilation* covers most of an 11×11 interior in two turns. That leaves
a narrower reading untested and it is the one this study was sent for: the cell
a piece is **standing on**, which is not a dilation and cannot cover a board.

> **The rule, as one knob.** `pieceBarTurns` π, default 0 = today. In
> `bodyBarriersOf`, a subject that `barsIn(reading)` and leaves no trail stamps
> each of its own occupancy cells barred at every flood turn `t ≤ π`. A held
> piece is excluded from `hi`, exactly as `cloudsOf` excludes one, because its
> occupancy is an observed record rather than a fact in a world it may have
> moved in. No board test, no kind name, no second denominator.

π = 0 was verified byte-identical to HEAD on eight games. What π buys, over the
186 303 `mixed` readings (`snakes` is byte-identical at every π — it has no
piece — which is itself the check that the knob is doing what it says):

| variant | `kept` moves | wakes a silent reading | `kept ≤ 1` |
|---|---:|---:|---:|
| π = 1 | 0.57% | 0.56% | 6.0% |
| π = 2 | 1.17% | 0.81% | 6.0% |
| π = 4 | 1.54% | 1.18% | 6.0% |
| π = ∞ | 1.85% | 1.49% | 6.0% |
| the piece CLOUDS (§9.4's refused arm) | **91.26%** | 90.34% | **29.8%** |

**This settles which half of §9.4's finding is load-bearing.** The saturation
belongs to the *dilation* — clouds pin `kept ≤ 1` on nearly a third of all
readings and speak on 91% of them, which is a term carrying no information about
the unit's own position. The *body* does not saturate at any π. So the answer to
"is a piece's zero the right reading" is: **inside the flood, it is right about
98% of the time and wrong about 1.85%, and the 1.85% is real rather than
degenerate.**

And the play does not move. π = ∞, the largest arm, seeds 1–6, 60 turns, both
sides, vs `material-only`:

| class | deaths | `self`+`bodyBlock` T46–60 (ours) | fatalEntrapments | meals/100 |
|---|---|---|---|---|
| snakes / side 0, 1 | byte-identical | byte-identical | byte-identical | byte-identical |
| mixed / side 0 | 25 → **24** | 2 → 2 (0 → **1**) | 11 → 11 | 16.67 → 16.56 (−0.7%) |
| mixed / side 1 | 23 → 23 | 0 → 0 | 7 → 7 | 16.94 → 16.98 |

One `contest` death fewer on one class, one of OUR late body deaths more, and
the counter the rule was built for flat on every class. **REVERTED**: the gate
was late `self` + `bodyBlock` down on `snakes` and on `mixed` with
`fatalEntrapments` down, and a rule that is byte-identical on the class that
holds six of our nine late `self` deaths cannot meet it — nor did it meet it on
the class it does touch.

## 4. Where a piece's zero actually costs, and it is not this file

`fearOf` returns 0 for a piece and `ourUnitTerm` (`bound.ts:183`) divides by our
own non-held count, so **a piece is silent in the numerator and present in the
denominator.** Our `mixed` roster is one snake and two pieces. A snake of ours
that is fully entrapped therefore charges `3 × (1/3) = 1.0` on `mixed` against
`3 × (1/2) = 1.5` on `snakes`: **two thirds of this term's headroom on a mixed
board is spent on units that are silent by construction**, before any question
of what the flood sees. That is the piece-shaped hole in `room`, it is an order
of magnitude larger than §3's 1.85%, and it is not repairable in
`territory.ts` — `entrapment.md` §9.4 shows a piece must read exactly 0 here or
the missing-unit fallback puts `lo` 1.5 above ninety worlds. It is a question
about `ourUnitTerm`'s divisor and is left with the term that owns it.

## 5. And the late `self` deaths are not a `room` reading at all

Worth writing down, because it is why §2 and §3 could not have helped. At
`ENDGAME.md` §3.2's deciding turn — `snakes` seed 4, T47 — the pocket entry
`(7,0)` and the free edge `(9,0)` score `20.23|126.17` **to the last digit on
both endpoints**, so `room` is not merely quiet on that choice, it is exactly
equal on it. The trace says why: red-B reads `kept = 15/15` on seven of its
eight plan readings at that turn, and the uncapped flood from them reaches
**28–58 cells**. The pocket is not a pocket at T47 — the snake's own next two
moves make it. This is `DEEP-DEATHS.md` §5.5's finding ("the FATAL cell is
frequently the ROOMIER one at the moment of choice; the pocket does not exist
yet") reproduced from the member's own side of the fold, and no reading of the
*present* board — wider `need`, wider horizon, more barriers — can price it.
What would is a term that prices the plan's own future trail, which is a
different member and not a repair of this one.

## 6. What is now closed

* `need`'s cap saturates the term — **refused** (§2). Do not re-derive.
* A piece barring its own standing cell in the flood — **built, measured,
  reverted** (§3). Do not re-derive; the knob and its numbers are here.
* Piece dilation clouds as barriers — refused twice now, `entrapment.md` §9.4
  and §3's last row.
* Still open, and sized here rather than proposed: `ourUnitTerm`'s divisor (§4).
* Still open, and named here rather than proposed: the pocket a plan's own
  trail makes (§5).
