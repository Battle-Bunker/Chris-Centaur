# Response to the TIME lens's red team — six breaks, six adoptions, three refinements

Their pass: `docs/design/redteam-joints-composition.md` on
`design/time-interruption`. **All six are accepted.** Three of them come back
with a sharper form than the fix they proposed, and those refinements are the
content of this document. Where I changed my mind I say so plainly; one of the
six is a straight error of mine.

---

## BREAK 1 — ECONOMY needs an obligation law. Accepted, and the second law is not a partition.

They are right, and the inventory row that classed the emission barrier as
"kernel constraint (not a member)" is wrong for one live case: the owner's open
dial-latency question ("does an operator's dial show in the next turn, or the
next slice?") **is a member choice on a reaction table**, and my carve made it
unrepresentable.

Their proposed fix (two declared laws inside ECONOMY, keeping the kind count at
five) is adopted. The refinement is that the second law has a *different
algebra*, and saying which one matters:

| law | what it partitions/orders | composition | identity |
|---|---|---|---|
| **allocation** | quanta across purchasable and anticipatory meets | **partition** — shares sum to ≤ 1 of the budget | "buy nothing" |
| **obligation** | determination source → latency class | **meet on deadlines** — when two obligations cover one determination, the TIGHTER one binds | "no deadline" |

Obligations compose by `min`, not by summing to one. That is why one law could
not cover both: a partition that over-subscribes is a bug, whereas two
obligations that both apply are simply resolved by the tighter — and a
kernel-pinned row (humans always win; the safety refusal; the emission barrier)
is exactly a deadline of zero that no member row can loosen. Stated that way the
kernel pin is not an exception to the law, it is the law's bottom element.

Consequence for `02-JOINT-INVENTORY.md` row 11: `economy/emit` becomes a joint
with a member surface (the reaction table) over a kernel-pinned floor, rather
than a kernel-only row.

## BREAK 2 — `Choice` has no transport law. Accepted; and a latched choice is a carried premise.

Correct, and it is my own Law C left unapplied to the config layer. I assumed
configuration was invariant under `advance`; that holds for `fixed` and
`composed` (they cite no world coordinate) and fails for the two that do.

```ts
type Transport = 'invariant' | 're-evaluate' | { expires: number }
```

- `fixed`, `composed`: **invariant** by construction — a checked property, not a
  declaration (the codec refuses a `fixed` choice whose member params cite a
  world coordinate).
- `conditional`: **re-evaluate** at the new root. Default and, I now think,
  the only safe value.
- `priced`: **expires** with the premise its price was computed under.

The refinement: **a `conditional` that latches is not a Choice at all — it is a
carried premise, and the type should force the conversion.** Latching means "the
predicate's verdict outlives the facts it read", which is precisely
`Carried{author: bot, lifetime, invalidate}` from `05`. So the config layer gets
no latch of its own; anything that wants one mints an object that already has a
lifetime, an invalidation predicate and a conditional label. That closes the
arena-latch class through the config door without adding a mechanism — it
routes it into the one that already handles lifetimes.

## BREAK 3 — Calibration is a third coordinate class. Accepted; here is the admission criterion.

`04 §3`'s declared/observed split is missing measured-and-behavior-affecting
state (`stepCostMs`, slice-cost EWMAs, quanta-per-ms fits), and ruling 49 makes
the gap urgent because the same box now has to hold offline fitted constants
too. Their dilemma is exact: such a value either churns `botId` every turn
(killing addressing) or lives untagged (the disease).

The resolution is a criterion rather than a third bucket, and it splits the
class in two:

> **Law K (calibration).** A measured value may affect behaviour only if it is
> either
> **(a) REPLAYABLE** — a deterministic function of the declared coordinates plus
> the recorded observation ledger, so `⟨botId, ledger⟩` determines it and it need
> not enter the address; or
> **(b) SPEND-ONLY** — it may change how much work is bought and may never
> change a bound, an order, or a refusal (the seam rule, unchanged).
> A value that is neither is an untagged behaviour input and is refused.

This is worth the extra sentence because it *classifies today's code correctly*
rather than asserting a rule:

- `stepCostMs` and the slice EWMA are **not** replayable — they are wall-clock
  derived, and the branch has a recorded instrument mystery where an anytime
  loop was not slice-reproducible with both clocks faked. They are legitimate
  anyway, under (b): they size slices. They buy differently; they never prefer
  differently.
- An online per-game calibration that is turn-stamped and ledger-replayable is
  legitimate under (a) — and, as the time lens says, replayability is its
  licence: same ledger, same trajectory, same behaviour.
- An **offline fitted constant** is neither (a) nor (b) in general — it prices
  and orders — so it must enter as a member with fit provenance, which is
  exactly ruling 49 and `08-FIT-PROVENANCE.md`. The two documents meet here.

And their point about the falsifier is taken: B2's "generated stamp reproduces
`BotStamp` field-for-field" cannot catch this, because `BotStamp` never carried
calibration either. B2 gains a second acceptance: **every behaviour-affecting
measured value in the decision is classified (a) or (b) by an explicit
declaration, and an unclassified one fails the build.**

## BREAK 4 — "Exactly one reduction" collides with ruling 13. Accepted, with the anti-drift property preserved.

Their counterexample is decisive: ruling 13 pins ponder/hypothesis targeting to
worst-case-derived targets regardless of the bot's ε, so one global binding
either leaks a learned supplier into ponder targeting the day one exists, or
drags the whole bot down to the supplier ponder is allowed.

But "one binding per site-class" as stated loses the property that made the law
worth having — that the epistemics lens's depth-coupling law became a *theorem*
of totality rather than a discipline. Both are recoverable:

> **Amended REDUCTION law.** The manifest declares the **site-class table**
> (staging's sound rung · the est rung · a thread's inner reduction · ponder
> targeting), each row carrying a **constraint**: `kernel-pinned-to-quantifier`,
> `pinned-to-W0..W2-by-ruling-13`, or `free`. A bot binds **one**
> `(supplier, ε)` which is **broadcast to every `free` row**; a per-row override
> is legal only where the manifest says `free`, and every override appears in
> `botDiff`.

So the common case is still one binding and the coupling still cannot drift
silently; divergence is possible, bounded by the constraint column, and
*visible*. This is also not a special case in the fibration: the root est rung,
a thread's inner reduction and ponder targeting differ in their **observable and
measure coordinates**, so a per-site binding is the measure coordinate varying
where the premise already varies.

## BREAK 5 — My B5 falsifier was wrong. Straight adoption.

I conflated within-turn re-entry (human pin oscillation — the design's cheap
win, plausibly high) with cross-turn address recurrence (expected ≈ 0 by design,
because the board advances and spawns land). As written my falsifier reads the
second population and deletes a healthy mechanism, which is exactly the
mistake-class the rebase-transfer dilemma pre-warned about ("judge it on
decisions changed, not on percent carried"). Replaced:

| half | gate | metric |
|---|---|---|
| oscillation / re-entry | within-turn | exact-address re-entry rate under live operator play, and the compute it saves against a full re-open |
| cross-turn carry | across `advance` | **decisions changed** — carry-effect rate and time-to-refutation at N+1 — never recurrence |

`05-ADVANCE-AND-COMMITMENTS.md` §7 and `07-SYNTHESIS.md`'s B5 row are corrected
to this.

## BREAK 6 — Law R needs a runtime twin. Accepted.

Config reachability is not enough: a member reachable from a roster bot that
never earns a tranche under any shipped policy is an unplayed heuristic at
runtime, invisible to a closure check. The law gains its second clause, and the
evidence is the engagement counter the manifest already derives:

> **Law R (amended).** Every member must be **reachable in config** from a
> roster bot **and engaged in the ledger of at least one validated run**. A
> member failing either is seated so it can be, or deleted.

This is also the honest home for the ledger status the batch-2 analysis had to
invent — "raced live, no effect at this design" — which is precisely *engaged
but not helping*, and is a different verdict from *never ran*.

---

## The merge they propose, and one dependency I owe them

**Adopted:** B2 (the joint manifest and generation-from-it) and their allowance
ledger's schema are one increment. The shared part is exactly the discipline
both need — generated columns, and a miner that refuses an unknown column
instead of defaulting it — and building it twice would produce two column sets
that drift, which is the disease in miniature.

**Owed:** they adopt B4 (`settleTurn` with the spawner injected) as a dependency
of `feature/replay-rebase`, because it shrinks the copied game-state half to
spawn cells alone. That makes B4 a shared prerequisite rather than an
engine-side nicety, and it should be sequenced accordingly: B4 moves ahead of
B5 in my build order, since B5's map is worth much less against a game-state
copy nobody can checksum.
