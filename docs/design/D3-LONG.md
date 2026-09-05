# D3 at full length — a sublinear normaliser for `room`'s fear

**Status: PRE-REGISTERED (this section), verdict in §6.** One parameterised
shaping, one knob, four readings derived before anything was run.

## 1. What is being repaired, and what is already closed

`src/lobster/evaluate/features.ts::fearsOf` prices a unit's fear of its own
region as

    need  = max(4, L + 2)                          (`territory.ts::needOf`)
    short = clamp01((need - kept) / need)
    fear  = sqrt(short)                            in [0, 1]

At a FIXED absolute shortfall `d = need - kept`, `fear = sqrt(d/(L+2))` FALLS
as `L` grows: the longer snake — which needs more room, turns worse, and is the
one that actually suffocates — is charged less. That is
`BEHAVIOUR-AUDIT.md` §D3, and its 0.12 at `snakes` seed 1 turn 45.

Three things are already closed and none of them is re-derived here:

* **A fixed cell budget** (`roomCells`, default 6) — BUILT, MEASURED,
  REVERTED (`BEHAVIOUR-AUDIT.md` §D3). Sound; it SATURATES. With `D = 6` any
  shortfall of six or more reads `fear = 1` exactly, which on `snakes` is most
  of an entrapment episode, so the term orders nothing between a unit's
  options. `snakes` deaths 7 -> 8, `potions` 9 -> 12.
* **The `need` cap truncating a growing region** — REFUTED at 100.0% of
  13 451 firing readings (`ROOM-PIECES.md` §2). The flood stops because the
  region is exhausted.
* **A longer horizon** — refuted at `DEEP-DEATHS.md` §5.5.

What is NOT closed is the audit's own first standing candidate, stated there
and never measured: "a denominator that grows SUBLINEARLY in `L` (`sqrt(need)`,
say) — length-sensitive without either compressing or saturating."

## 2. Why sixty turns could not settle it

`BEHAVIOUR-AUDIT-3.md` §3.3: `long` is `mixed` at 120 turns and nothing else.
Paired on ten seeds against `mixed`, the second sixty turns costs 2.0 survivors
a game (5.400 -> 3.400, p = 0.002) and takes `self` deaths from **1 to 6**.
A snake only has a body worth entering after ten or more meals, which takes
more than sixty turns at `mixed`'s food density. **Sixty turns never grew a
snake long enough for D3 to cost anything**; `long` does, and those six deaths
are D3's first measured cost.

## 3. The shaping — one knob, `ROOM_FEAR_GAMMA`

Replace the denominator with a scale that grows sublinearly in `need`,
ANCHORED AT `needOf`'s own floor so the knob has an exact identity:

    S(need) = 4 * (need / 4)^gamma        gamma in [0, 1], 4 = needOf's floor
    short   = clamp01((need - kept) / S(need))
    fear    = sqrt(short)

* `gamma = 1` is **today, exactly**: `S = need`. Not "close to" — `need` is an
  integer, `need/4` is exact in binary, and `Math.pow(x, 1)` returns `x`, so
  the expression is bit-for-bit the current one (checked over `n = 1..4096`
  and over every `(need, kept)` pair with `need <= 200`; zero mismatches).
* `gamma = 0` is a fixed budget `D = 4` — the refuted family, one notch
  sharper than `roomCells = 6`.
* `gamma` in (0, 1) is the open space: **length-sensitive, but less so than
  the length itself**.

Everything the term promises is preserved by construction. `S >= 4 > 0` so
`short` is well defined; `clamp01` keeps `fear` in [0, 1]; the term stays
`-sum(fear)/|ours|` in [-1, 0], so `territory-acceptance.test.ts`'s cliff
inequality is untouched (the certified span is still 1, at weight 3 against
`CLIFF_MATERIAL_WEIGHT` 10). `fear` is still monotone DECREASING in `kept`.

**The bound direction still holds, and this is the constraint that fixes the
family.** `lo` takes `weightMax` for `need` and `weightMin` for the horizon,
which is only sound if `fear` is nondecreasing in `need`. Differentiating
`(need - kept)/S(need)` gives `[1 - gamma * (need - kept)/need] / S`, which is
>= 0 for every `gamma <= 1` and every `kept >= 0`. So `gamma in [0, 1]` is
EXACTLY the family this file's existing endpoint choice is sound for, and no
line of `territory.ts` moves.

## 4. The four readings, derived before anything was run

`d` is the absolute shortfall `need - kept`.

| point | `need` | `d` | gamma = 1 (today) | gamma = 3/4 | gamma = 1/2 | gamma = 0 |
|---|---|---|---|---|---|---|
| L = 3, d = 1 | 5 | 1 | 0.4472 | **0.4599** | 0.4729 | 0.5000 |
| L = 14, d = 1 | 16 | 1 | 0.2500 | **0.2973** | 0.3536 | 0.5000 |
| L = 6, d = 6 | 8 | 6 | 0.8660 | **0.9444** | 1.0000 | 1.0000 |
| L = 14, d = 11 | 16 | 11 | 0.8292 | **0.9860** | 1.0000 | 1.0000 |

**gamma = 3/4 is the arm, and the table is why it is the arm rather than a
taste.** `gamma = 1/2` — the audit's literal `sqrt(need)` suggestion — reads
1.0000 twice: it saturates on two of the four probes, which is the refuted
failure mode with a different constant in front of it. `gamma = 0` reads two
PAIRS of equal numbers. `gamma = 3/4` is the largest tested step off today that
keeps all four readings distinct.

Two orderings move, and they are the two the defect is about:

* **The length inversion is damped.** At `d = 1` the long snake's charge rises
  0.2500 -> 0.2973 (+19%) while the short snake's rises 0.4472 -> 0.4599
  (+3%). It is not abolished — no member of this family abolishes it without
  saturating — but the ratio long/short goes 0.559 -> 0.646.
* **The deep-pocket ordering FLIPS.** Today a length-14 snake eleven cells
  short (0.8292) is feared LESS than a length-6 snake six cells short
  (0.8660). At gamma = 3/4 it is feared MORE (0.9860 vs 0.9444). That is the
  turn-45 comparison of the audit's own reproduction, in the direction the
  reproduction says it should go.

And the discrimination is sharpened where the deaths are. For a length-14
snake choosing between `kept = 12` and `kept = 8`, the gap widens 0.207 ->
0.246 (+19%); for a length-3 snake choosing between `kept = 3` and `kept = 1`
it widens 0.262 -> 0.269 (+3%). The shaping spends its extra range on long
snakes, which is the class `long`'s six `self` deaths belong to.

## 5. Counters, and the pre-registered gate

Measured `--side=both`, both the mirror and the `--opponent=material-only`
arms, `--nodes`, per class, never pooled.

* PRIMARY, `long` 120 turns seeds 1-10: `self` + `bodyBlock` deaths struck
  AFTER TURN 60 down (6 -> <= 3 predicted), AND total `long` deaths not up.
* `snakes` 60 turns seeds 1-8: deaths NOT UP. This is exactly where the fixed
  budget failed (7 -> 8) and it is the counter that refuses this if it moves.
* `potions` 60 turns seeds 1-8: deaths not up (the fixed budget cost 9 -> 12).
* `mixed`, `sparse`, `sparse-lean`, `wide`, `dense`, seeds 1-5: deaths not up.
* Outcomes (W/D/L and lead at the cap) not worse on any class.
* `gamma = 1` byte-identical to the unmodified build on four games.

Deaths first; conservative is the better error direction.
