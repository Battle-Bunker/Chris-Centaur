# The depth numbers, and exactly what each one measures

Committed beside `depth-acceptance.test.ts`, which is the code that produces
them. It exists because two figures from the depth landing — **30%** and
**22.5%** — were circulating with no committed statement of what they are
measurements *of*, and both are the kind of number that reads as an improvement
to anyone who meets it without its definition.

## For the owner, in one paragraph

> The engine can now look one turn further ahead before it decides. We have
> measured how often that changes its mind, and that is all we have measured. On
> a set of small practice boards — 11 by 11, two teams, six chess pieces each, no
> hazards, no potions, one second to think — taking the extra turn of thinking
> away changed the move it played on 30% of decisions in the standing check
> (6 of 20 boards) and on 22.5% of a wider sweep of the same board family
> (45 of 200). Both numbers say how often the two versions disagree. Neither says
> which one is right: we have not yet played the two against each other in real
> games, so nothing here is evidence that the engine plays better, and these
> figures must never be quoted as an improvement. They also do not describe your
> board — those practice boards are a quarter the size of yours, with two teams
> instead of three, no hazards and no potions. The measurement on your own shape
> is a separate note.

## The two figures, in full

| | standing check | wider scan |
|---|---|---|
| **figure** | 30% | 22.5% |
| **as a count** | 6 of 20 boards | 45 of 200 boards |
| **what it counts** | decisions on which the two arms staged a **different move** | same |
| **board family** | `pieceBoard(seed)` in `depth-acceptance.test.ts`: 11×11, two teams (`red`/`blue`), six one-cell pieces from `{queen, rook, bishop, knight}`, six food, **no hazards, no potions, no king** | identical generator, seeds 0–199 |
| **budget** | 1000 ms of the decision's own injected clock | same |
| **method** | paired **whole decisions**: the same board decided twice, once with the shipped depth ration and once with `depth: { plyCap: 0 }` | same |
| **horizon reached** | 2 turns | 2 turns |
| **committed as** | the `is nonzero on piece-bearing boards at a one-second budget` test, which gates on **nonzero** and prints the rate | a one-off scan; this table is its record |

## The owner-shape figures — 20260830, n = 24 per cell

Measured by the `depth-effect rate at the owner's shape` block of
`depth-acceptance.test.ts`: 25×25, three teams of six, a deterministic hazard
cross at damage 15, **potions on**, 2000 ms, paired against `plyCap: 0`.
96 whole decisions, 1,804 s on a 4-core box.

| cell | roster | rate | horizon (funded / depthless) | threads | deep readings published | door refusals |
|---|---|---|---|---|---|---|
| `owner-mix-king` | king, queen, rook, knight, snake, snake | **2/24 = 8.3%** | 2 / 1 | 707 | 50 | **0 of 24** |
| `owner-snake5-queen` | queen, snake × 5 | **5/24 = 20.8%** | 2 / 1 | 749 | 64 | **0 of 24** |

Two readings worth keeping:

- **Depth engages on this family and nothing refuses it.** Zero door refusals
  across 48 funded decisions is the number that matters most here — the door
  refused every potion-bearing board until the tier-truth premise became `full`,
  and the owner's games always carry potions.
- **The rate is lower than the probe family's, and the probe family is not an
  upper bound on it either** — 8.3% on the mixed roster against 30% / 22.5% on
  11×11, but 20.8% on the mostly-snake roster. A bigger board with three times
  the units gives the same budget less to spend per unit; a sparser roster gives
  the deepening more room. These are different board families and their rates
  must not be averaged.

**The quality signal came back empty, and honestly so.** All 7 disagreeing
decisions had both plans replayed through `resolvePartialTurn`, and all 7 gave
identical same-turn ledgers (`0/0/0` against `0/0/0` — our deaths / our severed
cells / enemy deaths). The two arms are choosing between moves that are equally
safe *this* turn, which is both the regime a further-looking search exists for
and the regime a same-turn instrument cannot report on. **Quality needs live
games.**

## What the method is, and why it has to be this one

Both arms are the **same build**. `plyCap: 0` does not compile out the depth
layer — the layer is constructed, the door is available, the report is
published, and the purse simply buys no plies. That is what makes the pair a
measurement of *depth* rather than of two code paths, and it is why the
depthless arm's honest horizon is 1 rather than absent.

It is measured across **whole decisions** rather than from an indicator inside
one, because depth changes the trial *stream* as well as the acceptances: its
findings re-order what the enumeration proposes, so a counterfactual computed
inside a single decision only re-runs the comparator and would understate the
effect.

## The four things these numbers are not

1. **Not an improvement rate.** Disagreement is symmetric. A rate of 100% would
   be consistent with depth playing strictly worse. Only a live paired sweep
   with a verified concurrent null can say which arm is better; that sweep is
   **owed** and is specified as **P11** in `tools/learnloop/promotion-ledger.json`.
2. **Not the owner's board.** 11×11 / two teams / no hazards / no potions /
   1000 ms is a probe family. The owner's shape is 25×25, three teams of six,
   hazards on, potions on, 2000 ms — a different board family, and a
   disagreement rate is a property of a board family and a budget. The
   owner-shape measurement is its own block in `depth-acceptance.test.ts` (`the
   depth-effect rate at the owner's shape`), reports per cell, and is tabled
   above.
3. **Not a snake-board rate.** Every board behind both figures bears pieces.
   The all-snake and mostly-snake families were unmeasured when these figures
   were taken.
4. **Not "two turns deep" in the ordinary sense.** The horizon of 2 means one
   turn past this one — three plies, one thread per cluster.

## Where the number comes from at run time

```sh
npx jest src/lobster/__tests__/depth-acceptance.test.ts -t "is nonzero on piece-bearing"
#   depth-effect rate 6/20 on piece boards at 1s (deepest horizon reached: 2 turns)

DEPTH_OWNER_BOARDS=24 npx jest src/lobster/__tests__/depth-acceptance.test.ts \
    -t "is measured per cell at 25x25"
```

`DEPTH_OWNER_BOARDS` is read in the test and reaches no decision. Nothing in a
decision on this branch reads `process.env`.
