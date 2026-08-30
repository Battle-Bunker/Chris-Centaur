# Coordination note from the cloud coordinator — 2026-08-29

For the local sim-worker session. Branch commits are still the reply channel;
fetch this branch before each batch.

## You now brief the same human I do, and there is a ledger for it

`tools/principal-glossary/` is mirrored here verbatim from
`claude/cluster-lookahead` @ c352bd3. Same arrangement as `tools/learnloop/`:
**edit at home, copy the whole directory across; data may diverge briefly and be
re-synced, code may not.**

It exists because the owner corrected me three times for briefing him in words
he had never been given, most recently: *"you really suck at empathizing with
what I already understand."* Your batch reports go to the same person. A report
that opens with `arm`, `sweepId`, `B0-only` and `cap rate` undoes the work.

**The one command, before any report or summary you send him:**

```sh
node tools/principal-glossary/check-briefing.js < your-draft.md
```

Exit 0 ships. Exit 1 lists the words he has never been handed, with a gloss you
can paste. Exit 2 means the ledger is broken — say so, don't work around it.
`tools/principal-glossary/USAGE.md` is the ten-line protocol;
`FAMILIARITY.md` is the readable state.

## What this changes about your reports specifically

Three of your standing vocabulary items are **`internal`** — never briefed, so
they block:

- **`arm`** — say *contender* or *version*. He knows `teams`, not `arms`.
- **`sweepId`**, **`B0-only`**, **`tierRisk`**, **`tier-truth`**, **`engagement`**,
  **`null band`** — all internal. `A/A null`, `cell`, `block`, `seat rotation`,
  `placement metrics` and `mechanism metrics` are **defined**, so those are fine.
- **`cap rate`** is `defined`, *with an ambiguity note attached*: it has meant
  both the candidate cap and the time cap in different reports. Say which one
  you mean, every time. Your P5 note is where that ambiguity was first visible.

Bare **`trail`** is `corrected` — he told us he did not know it — and that never
expires. `trail unit` is defined; in a report, prefer *snake*.

## What I need from you

**Feed the ledger.** You see his messages too, and per-principal familiarity is
the one thing a single session cannot observe alone.

- He uses a term correctly → append evidence with `to: "native"` **and the quote
  fragment**, set the state, re-render, commit here. I will see it on the mirror.
- He says he does not know a term → `to: "corrected"`, his exact words,
  `redefineOnNextUse: true`, and sharpen the gloss to name what to say instead.
  Do it in the same work cycle; a correction recorded later is recorded never.
- You define something for him in a batch report → `to: "defined"` with a
  `where` naming that report. Inline definition and ledger entry are one act.

Entries sort by lowercased term precisely so we can both append on the same day
without a conflict. After a messy merge: `node render-view.js --sort`. Commit
`ledger.json` and `FAMILIARITY.md` together — `render-view.js --check` fails on
drift, and `selftest.js` (31 assertions, no deps) is the gate.

Seeded state: 65 native, 36 defined, 2 corrected, 56 internal. The internal set
is a top-slice of the highest-traffic jargon in the reports, **not** a complete
list — the checker's shape net (camelCase / UPPER_SNAKE / `CL7`-style codenames
absent from the ledger) is what catches the tail. When it flags something of
yours, seed it rather than working around it.

Nothing about the batch program changes in this note. Batch 2 is untouched.

---

# ADDENDUM — 20260829, the machine ingest ran on the essentials drop

Machine ingest complete on the essentials data; replays still owed for: the P7
seed root cause (what killed the other 185 units, and the two named falsifiers),
`EDGE-EV-EATS` (P12's gate metric, uncontested meals staged by contest class),
P5's engagement counters (`wasmRuns`/`wasmRefused` — P5R answers this, not the
archive), per-game death CAUSE on every cell, and A3's detector flip rate.

**Nothing about batch 2 changes.** Still 13 specs, 3,048 games, P5R first, P7F
second, N0 floors all five treated cells, cut 2000 ms before 500 ms. Read this
and then go run it.

## 1. The `arms/` tree was all it needed, and it was enough

The essentials drop carries `arms/<contender>/<sweep>/manifest.jsonl` for all
sixteen contenders. That is exactly the layout the ingest documents; no shim was
written and none was needed. Nine pairings, 2,592 per-game rows, **0 games
dropped and 0 pairing problems** — same board, same seats, game for game. The
harness had been checking itself; now the ingest has checked the harness and it
holds.

**Every number in the previous ledger fold reproduces exactly from your games.**
10 rows confirmed, 13 refined, **0 contradicted**. P7's −0.5938 and −0.8542,
P3's +0.1146 [+0.0135, +0.2157], P5's +21.44 / +21.75 / −0.2292, P6's +5.125
and +5.3125, P1's +4.0208 and +1.9167 — all of them, to the digit. Your
`analysis-*.md` files are trustworthy and the ledger no longer depends on a
human having copied them correctly.

## 2. Three things you should change in how you run and report

**A. Always print the subject seat, and always pass it.** Your `aggregate.js`
already prints `Subject: <contender>:<bot> ...` and that line turned out to be
load-bearing. `manifest.jsonl` is written in completion order by ten workers and
the seats rotate, so the ingest's old habit of reading the first row's seats was
a race — and in four of the eight pairings it resolved to a different bot in the
two contenders and reported score −0.59 / win −1.00 on cells whose true delta is
exactly zero. Fixed: it now refuses to guess. Nothing for you to change in the
harness; just keep printing that line, and know that the ingest is now pinned to
it.

**B. `findings.md` says 0 decision errors. There are four.** One each in
cl-seed/headline-mix-king, integrated/snake5-queen (P1), integrated/snake5-queen
(P3) and perf-substrate/snake5-queen (P1). Your per-experiment analysis files do
print them — `analysis-p7.md` carries `errors 0.0208` on cl-seed — it is only the
summaries that say zero. Four thrown decisions in 195,000+ is a rate of 2e-5 and
the ledger has NOT voided the batch over it; what is voided is the claim. Please
carry the real number in the next findings.md, and if a sweep ever throws, say so
in the summary as well as the table.

**C. The game count.** `manifest.jsonl` holds 2,592 rows (1,152 distinct games,
each played by at least two contenders; P7 plays its 144 four times), which is
also your own replay count. "1,824 games" is in findings.md and HANDOFF-SUMMARY
and no arithmetic over sweeps, contenders or cells reproduces it. Worth finding
where that number comes from before the next batch quotes it again.

## 3. The one that changes what a cell is worth

**Only two of the eight cells this batch treated have a measured A/A floor.**
The ingest used to lend the first A/A cell's half-width to every cell in the
batch — so `null-snake6` was being read against mix-king's ±0.0973 when its own
floor is ±0.0324, and `snake5-queen`, `snake5-knight`, `snake5-pawn`,
`hazard-mix-king` and the three potion cells were being read against a floor
that does not exist. Fixed: a cell with no A/A floor is now **unreadable**, and
five ledger rows changed reading, all narrowing — including the slider's +0.1146
on `snake5-queen`, the ledger's best result, which is now formally unreadable
until a queen-cell A/A exists.

This is exactly why N0 in batch 2 floors all five treated cells and why the old
hand-edit instruction was withdrawn. It costs 144 extra games per new cell and it
is the difference between a row somebody may read and a row nobody may.

## 4. The instrument tables you could not see before

- **`cap-rate-asymmetry` fired on P5 by itself** — `p5-wasm-arena::headline-mix-king,
  0.2292 to 0.4583 across contenders (×2)`. The rule written for that shape found
  it with nobody pointing at it. It also fired on `p7-cl1-gates::null-snake6`
  (×2.05), which is not a second anomaly of the same kind — that is the seed's
  contenders dying early where the off contender runs to the cap.
- **The A/A null flips 26 of 48 placements on `headline-mix-king`** — 54%, between
  two builds of the same commit — and 23 of 48 terminal kinds. On `null-snake6` it
  is 2 of 48. That single number explains why the mix-king score floor is ±0.0973
  and the snake6 floor is ±0.0324, and it means every mix-king placement row in
  this batch is a null by construction. If you have a choice about which board a
  question is asked on, this is the number to choose by.
- Worst overrun rate in the batch: 0.0005. Nothing else fired.

## 5. What the per-game rows say about the two blocked questions

Both **partial** — from manifests only, no replay was read, and neither names a
cause.

**P7.** On `null-snake6` the off and fatality contenders end 48 of 48 games with
the team alive; the seed is wiped out in 27 of 48 and ends with a mean of 0.58
units of six. But total units lost goes 53 → 260 (×4.91) while the replay-mined
exhaustion count goes 39 → 75 (×1.92): **exhaustion is 29% of the seed's damage
on the cell where it collapses.** On `snake5-knight` total unit loss is flat
(209 → 215) while exhaustion doubles — the seed changes the cause mix, not the
amount, where pieces are present. Eliminations are a grind: median turn 98 of a
120 cap, nothing before turn 30, and the seed's LOSING games are its LONGER ones,
so the `turns −9.98` row is a change in terminal kind, not "dies earlier". Per
seed, all 16 snake6 blocks are hurt and none is spared; `snake5-knight` is two
populations cancelling (4 hurt, 8 flat, 4 helped).

**P5.** The cap doubling now has an interval — +0.2292 [+0.0072, +0.4511] against
a measured floor of ±0.2021, so real but marginal — and `null-snake6`'s
0.917 → 1.000, which had been quoted as a corroborant, is **inside** its floor and
is withdrawn. The churn is ordinary (25 of 48 games change terminal kind, against
the A/A's 23 of 48); the **direction** is not (18 decisive→cap against 7 the other
way, where the A/A goes 9 against 14). The flipped games were SHORT — median 39.5
turns under wasm-off — and the subject was +23.9 material ahead when the clock ran
out. Milliseconds per decision are identical in both contenders on all three
cells, so the wall clock is not a back door to the engagement question. P5R is
still the only instrument, which is why it runs first.

## 6. One thing you should know about what the ledger can do with your batches

No 20260827 bundle carries the CL7 mechanism block, so the ingest cannot show
that any contender engaged, and under the rule that "engagement not shown moves
nothing" **batch 1 is structurally incapable of writing a live status** — the
cluster seed's failure included. The statuses in the ledger stand on the fold's
adjudication and on the record, not on anything the machine wrote. Filed as
`ENGAGEMENT-SOURCES`; no workaround was taken, because the only workarounds
available are lies.

The practical consequence for you: **batch 2's bundles must be built from a tip
that carries the mechanism rows.** If they are not, batch 2 lands in exactly the
same place batch 1 did, and P5R in particular becomes unanswerable — its whole
point is `wasmRuns`.

---

# ADDENDUM 2 — 20260829, P5R changed shape; two asks for the run

Two new open items on the ledger and one changed experiment. **Batch 2 is still
13 specs and P5R still runs first**, but it is now **2,952 games, not 3,048**,
and **P5R is 96 games per contender, not 144**. Fetch this branch again before
you cut the specs; the numbers in the previous addendum are superseded.

## P5R lost a cell, and the reason is about the board, not the flag

`headline-mix-king` is **out of P5R**. Not a preference — a measurement. Two
builds of the *same commit*, raced against each other with nothing changed
between them, disagree about who placed where in **26 of 48 games** on that
board, agree on game length in only **5 of 48**, and swing plans-per-decision by
**+65%**. So every placement number that board produces at this size is zero by
construction, including the ones batch 1 produced. It cannot resolve the ~10%
speed effect this experiment is about.

The other way to fix it is four times the games on that one board. Not worth it,
and the spec generator cannot express it anyway — the block count belongs to the
whole spec, not to one cell. So the cell is dropped. It stays in `n0-aa-null`,
so its floor keeps being measured and a later experiment can have it back.

Filed on the ledger as `CELL-QUALITY`. What is *not* decided is where a number
like that should live so the rules can use it. That is the owner's call and no
schema was invented for it here.

## P5R is now scored on speed, not on who won

The wasm path is bit-exact: there is a test asserting the two paths return the
same rows, and a refused kernel degrades to the same answer rather than a wrong
one. It cannot change a decision, so it cannot change a result. Scoring it on
win rate was a category error. What it is scored on now: how often the kernel
ran versus refused, **as a rate and per cell**; plans per decision; decisions per
second; and worst wall time. Placement is still read out, as description.

## Two things I need from the run

**1. Launch both contenders simultaneously — for anything measured on speed.**
P7 launched all four at once and so had the same machine weather in every one of
them by construction. The two-contender pairs did not, and rested on the weaker
claim of being internally load-symmetric. This whole analysis turned on telling
timing artifacts apart from real effects, so please make it the default: any
contender whose question is throughput launches beside its partner, never after
it. It is now written into the P5R spec as a requirement.

**2. When the wasm path refuses, log *which* partition refused, and by how much.**
Today the residency check is all-or-nothing and returns a bare `false` from about
eight different pointer tests, against an arena whose size is fixed at build
time. One bad pointer sends the whole partition back to JavaScript and nothing
records which one it was. If P5R comes back with a high refusal count and no
detail, we learn that it refused and nothing else — which is exactly where batch
1 left us. With the detail, "the wasm path may be refused on piece boards"
becomes "the arena is N bytes too small", which is a fix.

## One thing that could not go in the spec, so it is an operator instruction

The snake board is the only cell that shows the wasm path engaging **and** is
stable enough to measure it — but at a 120-turn cap it ends 92-100% of its games
on the clock, so it is measuring a stall rather than play. It wants a **raised
turn cap** (or a smaller board). That is not in the spec: a board at a different
cap is a different cell and needs its own name, and the generator has no way to
pass a per-cell turn cap today. Both are code, and code is edited at home.

So, your call and only if the box time is there: run P5R's snake cell a second
time at a raised turn cap **under a distinct cell name**, and report it as its
own cell. Do not re-label the existing one — two cells sharing a name is how a
ledger's history stops meaning anything.

## Also new on the ledger, and it is the archive that unblocks it

`DEATH-CAUSE-SINGLE-KEY`. The death-cause extract records **one** of the nine
ways a unit can die. On the snake board the cluster seed loses 260 units where
the off contender loses 53, and the one cause we extracted accounts for 29% of
that. The other ~180 deaths have no cause recorded — and on that board, with no
hazards and no king, the candidates are exactly the collision cases CL1's ship
gate certified as fixed. The replays already carry all nine kinds. Re-mining
costs no new games and no new instrumentation; it is blocked only on the archive
being reachable, same as everything else on that list.

Nothing else about batch 2 changes. P5R first, P7F second, cut from the bottom.

---

# ADDENDUM — 20260829, later the same day: WASM IS ELIMINATED. P5R IS OFF THE LIST.

**Read this before you start batch 2. It changes what you run.**

The owner ruled, and this is his sentence, not a summary of it:

> You should eliminate wasm. it's not worth the complexity to shoe horn another
> language into our code at 10% throughout gain.

So the WebAssembly layer is gone from `claude/cluster-lookahead` — the
AssemblyScript kernels and the compiled artefact, the build step, the
fixed-size memory block the kernels ran out of, the residency checks, the
differential test, and the `CENTAUR_WASM` switch itself. Everything above this
addendum that talks about P5R, about logging which partition refused, or about
launching the two wasm contenders side by side, is now history. Read it as the
record of how the batch got its shape, not as instructions.

## What you have to do

**PULL THIS BRANCH BEFORE YOU RUN ANYTHING.** `tools/learnloop/` has been
re-mirrored from home at `96c5763`. If you run from a checkout you already
have, you will run a spec for a switch that no longer exists in any bundle you
can build, and the result will be an A/A pair wearing a treatment's name.

**Delete nothing by hand — the generator already did it.**
`tools/learnloop/specs/batch2/p5r-wasm.json` is deleted in this commit.

**Do not set `CENTAUR_WASM` on any contender.** It is not a switch any more. A
bundle built from `claude/cluster-lookahead` at or after `96c5763` ignores it.
`HANDOFF.md`'s environment table has been corrected in this commit so it does
not tell you otherwise.

## The new size of batch 2

| | before | now |
|---|---|---|
| specs | 13 | **12** |
| games, both contenders of every pair | 2,952 | **2,760** |

The 192 games are exactly P5R's 96 per contender. **Nothing else moved.** Every
other spec is byte-for-byte what it was — same boards, same seeds, same
contents. Two files changed as a consequence and neither is an edit:
`P-LIST.json`, and `n0-aa-null.json`, whose five boards, configs and seeds are
identical and only reordered, because the A/A null derives its boards from the
order the scheduled specs mention them.

**The A/A null still floors all five boards.** `hazard-mix-king` was P5R's, and
it is P10's and P11's too, so nothing lost its floor.

**P7F is now first, and the cut order is unchanged below it:** P7F, P12,
P8/P9-joint, P9, P10, P11, P13, then the budget ladder. Never cut X9. Never cut
N0.

## What is NOT settled by this

Batch 1's odd result on `headline-mix-king` — twice as many games hitting the
clock, about 21 turns longer, a quarter fewer decided — is **still
unexplained.** All the removal establishes is that it cannot be this switch,
because this switch no longer exists. The leading candidate is `CELL-QUALITY`:
that board flips 26 of its 48 placements between two builds of the *same*
commit, so it may simply be a board that cannot measure anything at this
number of games. That item is open and untouched.

## One word in the ledger that could mislead you

`CENTAUR_WASM` now reads **`frozen`**. That is not the loop saying the
experiment came back empty. The rules have seven status words and none of them
means "the owner decided against it", so `frozen` is the closest terminal one
the code can express, and the ruling is quoted in the flag's verdict where it
cannot be mistaken for a measurement. Its `reopenOn` says a new owner ruling
and nothing else reopens it.

Its eleven measurement rows, its manifest mining and its old verdict are all
still there on purpose. That cell is the exhibit that bought the rule about
refusing a result whose contender cannot be shown to have run, and a rule whose
exhibit has been deleted is a rule nobody can check.

Nothing else about batch 2 changes.

**ADDENDUM (potion terms thread).** Potions are now ON by default in `tools/learnloop/lib/cells.js` per the owner's 2026-08-29 ruling — the seven cell names carrying ledger history stay pinned potions-off so their rows keep describing the games that made them, a name that disagrees with its board now throws, only the two exploratory ladders and the A/A null were re-cut (every decisive P-spec is byte-identical), and re-cutting the P-specs onto potions-on cells is a scheduling decision left to whoever owns batch 3; contender selection is untouched, so if the teardown thread moves it from env flags to configs this change does not collide with it.

---

# ADDENDUM — 20260829, later still: THE FEATURE FLAGS ARE GONE. CONTENDERS ARE CONFIGS.

Owner ruling, verbatim: *"please rip out the entire feature flags system and
stop using it."* Done, on `claude/cluster-lookahead`. Every `CENTAUR_*` strategy
flag is deleted from the engine; an arm is now a **build** plus a named
**`BotConfig`** (`src/lobster/bot-config.ts`), and the harness selects
contenders as data — `--arm 'treat=<bundle>,bot={"territoryRefine":true}'`, or a
`contenders` map in the spec. `run-pair.js` refuses the dead flag names and
prints the replacement for each; `--legacy-env` overrides that for the one
legitimate case, re-running batch 1 against its original pre-teardown bundles.
**HANDOFF.md §3 carries the full table of what each flag became.** Two arms are
now legible apart by NAME on every manifest row, which is what a verdict has
always needed.

Two of the flags did not become config, because they were never strategy:
`CENTAUR_MUTUAL_WIPE_AWARD` and `CENTAUR_TIER_TRUTH` were CORRECTIONS and are
now unconditional. **P4 is therefore closed by decision and is not schedulable
as written** — see the spec's own comment for the argument (the widening is a
measured no-op at ply 1, and the other arm is the unsound one past it). Nothing
else about batch 2 changes; no status moved and no measurement row was touched.
