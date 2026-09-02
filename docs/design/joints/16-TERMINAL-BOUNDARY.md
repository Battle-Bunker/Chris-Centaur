# The terminal boundary — one row, three mechanisms, and the kind question resolved

Cycle 8 addendum. The VALUE lens's cycle-5b measurement (`71580b8`): with exact
ΔΦ their three-flow basis is **complete in the interior** — 0.00% attribution
gap, the telescoped sum reproducing the last board's share exactly — and
**100% of the remaining residual sits at the terminal adjudication step**,
carrying all of the game-length dependence (corr +0.969).

---

## 1. What the measurement says, read carefully

A potential-based decomposition telescopes **by construction**, so "the interior
sums to the endpoints" is not by itself news — it is the check that the
decomposition is genuinely potential-based, and it passed. The two informative
facts are the other two:

1. the telescoped sum **reproduces the actual final share**, so the potential is
   the right one rather than merely a consistent one;
2. the residual is not spread thinly across the game — it is **concentrated
   entirely at the boundary**, and it is where every game-length effect lives.

The composition reading is immediate and it is a standard shape: **a bulk term
plus a boundary condition.** The flow fold is the bulk; the adjudication rule is
the boundary; and a fold defined only in the interior has *no value at the
terminal step at all* — it must be supplied, not extrapolated. Nothing in any
evaluator supplies it today, and the bot **reads no turn limit anywhere**
(the distiller's P1 finding), while every real game now ends at one by default.

---

## 2. The kind question, resolved: it is two objects, not one

The VALUE lens proposes a VALUE-joint member family; the red team's round-2 pass
proposes a seated MODEL member with `FitProvenance.metric` as a `MemberId`.
Under this manifest's own seam rule both are right about different halves, and
splitting them is what keeps a strategy knob from silently editing the rules:

| object | kind | what it is | composition | who may vary it |
|---|---|---|---|---|
| `model/terminal@1` | **MODEL** | the exact rule the game settles by: turn cap, last-team-standing, same-turn mutual annihilation on the previous turn's weights | unconditional — a **correction**, not a strategy | nobody. One member, no rivals, sourced from the engine (§3) |
| `value/horizon-*` | **VALUE** | pricing the *approach* to that boundary under uncertainty about reaching it: turns-remaining schedule, elimination premium, stock↔flow decay, mutual-wipe brinkmanship | weighted monoid, like every VALUE member | any bot; these are genuine strategy alternatives |

The distinction is the seam rule in one sentence: **what the rules do is not a
preference, and what it is worth to approach them is nothing else.** Collapsing
them into one family would put "how the game ends" on a knob, which is precisely
the class of thing this program spent three implementations learning not to do.

---

## 3. The one manifest row that wires three mechanisms

These must land together or they land as three mechanisms that drift:

```
ROW: terminal-boundary
  engine    adjudicate(state, turn, maxTurns) → Outcome         (03-ENGINE-API §3)
            sharePar(outcome, teams) → per-team number
  member    model/terminal@1
              primitive: engine:adjudicate            ← the ONLY legitimate source
              soundness: sound-writing (it prices a real terminal state)
              params:    { source: 'vendored-engine', maxTurns: from the board }
  fold      the flow fold declares its domain as the INTERIOR; its boundary
            value is supplied by model/terminal@1 and never extrapolated
  metric    FitProvenance.metric = 'model/terminal@1' — the scoring functional
            IS the member id, not a string
```

Three properties this buys, each of which failed at least once already:

1. **A member that re-implements the rule is refused at registration.** The
   primitive names the engine export; a second implementation is a second
   encoding, and we have the receipts — the rule existed three times (server,
   harness, bot) and disagreed three ways, with the bot pricing a winning mutual
   trade as a flat loss and therefore *refusing winning trades*.
2. **The bot cannot optimise a rule the harness does not score by.** With
   `FitProvenance.metric` as a member id, the terminal functional the bot
   evaluates toward and the functional measurements are scored by are **the same
   addressed object**, and CI can assert equality. Today they are two
   implementations and one hope.
3. **Turn-limit awareness arrives as data, not as a feature.** `maxTurns` enters
   the member's params from the board; the interior fold is untouched; and a bot
   that plays toward a cap finally models the rule that settles it.

## 4. Falsifier

Seat `model/terminal@1`, leave the interior fold unchanged, and re-run the
attribution: the game-length dependence (corr +0.969 in the residual) must move
into explained variance. If it does not, the boundary model is **wrong rather
than missing**, and the next suspect is the settling rule's own edge cases
(same-turn annihilation adjudicated on the previous turn's weights) rather than
the fold.

Cheap second check, and it needs no batch: on a seeded board three turns from
the cap, a bot seated with the terminal member must decline a trade that a
capless bot accepts — the turn-limit razor scenario, which is currently
unrepresentable at any weighting because nothing in the evaluator knows the game
ends.
