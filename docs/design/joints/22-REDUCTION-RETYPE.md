# The reduction returns a set — plus a second currency, and what earns a seat

Cycle 9 close. Three items from the librarian's cycle-4 register, adjudicated.
The first is a **retype of a kind**, which is the largest single change any
review has produced here, and it is right.

---

## 1. R-4 — REDUCTION returns a SET of (option, dominance condition)

**Their finding.** Three unrelated fields converge: Troffaes's decision rules
under imprecise probability (maximality and E-admissibility return **sets**;
Γ-maximin is the one that collapses), POSG α-vectors with dominance regions
(the value function is a set of hyperplanes, each optimal on a region), and
Miller's contrastive-explanation result (an explanation answers *"why P rather
than Q"* — it needs the alternative and the condition).

**Adopted.** The kind's type changes:

```ts
// before — my type, and it threw away the thing everything downstream needs
reduce(credalSet, valueFn): ComparableKey

// after
reduce(gambles): ReadonlyArray<{
  readonly option: PlanKey
  readonly condition: Premise      // the region / reply set under which it wins
}>
```

**This is not a reversal of the "exactly one" law.** That law is about *how many
members a bot binds per site class* (`11 §2`); this is about *what a member
returns*. A bot still binds one reduction per site class; that reduction now
returns the surviving set rather than a winner.

### Why this is cheap here, and what it recovers

**The set already exists and is thrown away.** The bound bank already computes
interval dominance — `hi(p) ≤ lo(q)` retires `p` — so the *maximal set under
interval dominance* is a by-product of machinery that ships. What the
architecture does today is collapse it at the first comparison
(`accept()`/`better()`) and never recover the alternatives. The retype keeps
what the bank already produced.

**Emission is where the collapse belongs.** The wire takes one move, so a
collapse must happen — but it happens at the **emission barrier**, not inside
the reduction. Everything between the two can consume the set:

| consumer | what the set gives it |
|---|---|
| ADVICE | **its input type, for free** — the surviving options *with the condition under which each wins*. Miller's point is that the condition is what makes it an explanation rather than a list |
| ECONOMY allocation | the frontier that is still live: spend where the conditions separating survivors are cheapest to settle |
| ponder targeting | the conditions themselves are the hypotheses worth anticipating |
| the operator | "these two are both defensible, and here is what distinguishes them" — which is the Centaur product, in one sentence |

**And it is native to the fibration.** A "dominance condition" is a
premise-indexed statement — *A beats B whenever the enemy's reply lies in R* —
so the condition is exactly a premise (`01`), not a new object. Members
available at launch: `reduce/interval-dominance@1` (what the bank does today),
`reduce/maximality@1`, `reduce/e-admissible@1`, and
`reduce/gamma-maximin@1` — **the scalar collapse, now one member among several
rather than the shape of the kind**. ε-contamination is a parameterisation of
the last.

**Cost, honestly.** Sets on a hot path. Mitigation: the incumbent path may still
compute an argmax eagerly; the *set* is materialised at the seams that consume
it (emission, advice, allocation), which is the same seam discipline as the
trace hashes (`18 §1`). If materialising costs more than it buys, the fallback
is to record the set's **witnesses** (the retiring comparisons) rather than the
set — which is what the bank's ledger already holds.

---

## 2. C33 — asking the operator is a third way to remove width, and it needs its own currency

**Their finding.** Three ways to remove width: deduce, act-to-observe, and
**ask the operator** — Horvitz's mixed-initiative framing, where dialogue is an
action priced against the cost of bothering the user. Under game-held width
(invisibility) it may be the *only* lever.

**Adopted, with one refusal.** The ask is an ECONOMY lever beside compute-bought
meets, denominated in **operator attention** — which is the same currency the
ADVICE kind's budget already spends (`12 §D3`), so the two unify: one economy,
two currencies, one allowance ledger.

> **Refused: an exchange rate.** The two currencies are **not fungible**. A rate
> between milliseconds and operator attention would let the scheduler "spend the
> human" whenever compute was expensive, and this program's non-negotiables say
> the opposite — humans always win, the bot never auto-unpins, and ruling 13
> gives the human the risk decisions. So: attention is a **hard cap**, not a
> tradeable quantity; the obligation law (deadline-meet) governs *when* an ask
> must reach the human; and no allocation rule may convert one currency into the
> other.

**Wiring, in existing objects.** An outstanding ask is an **anticipatory meet**
(`05 §3`): the bot keeps playing while the question is open, holding the
answer's premise conditionally. The answer arrives as an **operator pin** — a
carried premise with an author of `operator` — which is machinery that already
exists end to end. No new channel.

**Their M27 bounds it, and it is the right bound.** *Complete internally,
selected externally*: the refusal law's exhaustiveness applies to what the bot
computes, **not** to what the operator sees. A surface that inherited
exhaustiveness would show everything and inform nobody. Selection is not a
refusal, and ADVICE is the only kind whose output is deliberately incomplete.

---

## 3. M24 — support in the roster's meta-Nash, and what "beyond" means formally

**Their finding.** Law R's engagement clause can be gamed by a keep-alive bot (I
flagged this myself). The stronger criterion: a member earns its seat by having
**support in the meta-Nash** of the roster's payoff matrix — a member in no
best-response mixture is dominated and deleted. And best-response growth applies
at three scales — actions, policies, and **roster members** — with *"the next
member to spec is the best response to the roster's meta-Nash"* as the formal
content of ruling 49's "and beyond".

**Adopted as a later strengthening, with two honest riders.**

1. **It needs a payoff matrix we do not have.** Meta-Nash support requires
   pairwise results across the roster, and this program struggles to resolve
   ±0.10 on a *single* cell (~73 blocks; the potion work needed ~595 blocks a
   cell to resolve ±0.10). A matrix over even eight roster bots is a different
   order of spend. So Law R ships with reachability + engagement, and
   meta-Nash support is the criterion it *upgrades to* once a matrix exists —
   named now so the ledger's shape anticipates it.
2. **The meta-Nash is itself a fitted object, and ruling 49 applies to it.**
   It is computed from bot-versus-bot games — precisely the numbers the ruling
   calls distortion-prone. So the meta-Nash is a **`DataEntry` with
   `FitProvenance`** (`15 §A`), pinned by version, with a transfer penalty when
   read outside its population. A hidden equilibrium criterion would be the
   worst instance of the thing the ruling forbids: an unaddressed fitted number
   deciding what exists.

**What it buys, and it is strategic rather than technical.** With a matrix, the
question *"what should we build next"* stops being taste and becomes an argmax:
the best response to the current meta-Nash. That is a defensible answer to the
owner's standing "and beyond" — the machine does not merely express strategies
nobody has tried, it **names which untried strategy is worth trying next** —
and it is the double-oracle discipline, not an invention.

---

## 4. Net changes to the manifest

| change | source | affects |
|---|---|---|
| REDUCTION's type: `Gambles → Set<(option, condition)>`; scalar collapse is one member | R-4 | `07 §2` kind table, `11 §2` site-class table (unchanged in structure), `12 §D3` ADVICE input type |
| collapse moves to the **emission barrier**; the set is materialised at consuming seams | R-4 | `02` row 11, `09 §BREAK 1`'s obligation law |
| ECONOMY gains a second currency (operator attention), **non-fungible**, with the ask as an anticipatory meet answered by an operator pin | C33 | `07 §2`, `05 §3` |
| M27: complete internally, selected externally — ADVICE does not inherit exhaustiveness | C33 | `12 §D3` |
| Law R's upgrade path: reachability + engagement now, meta-Nash support once a matrix exists; the meta-Nash is a versioned `DataEntry` with provenance | M24 | `07 §3` law table, `20` ledger schema |
| "what to build next" = best response to the roster's meta-Nash | R-3 | the programme's own sequencing, not the bot |

Nothing here contradicts an earlier law; two of the three *strengthen* laws I
had already written, and the first replaces a type I chose too early — the
reduction was typed as *a comparison* when the domain's own decision theory says
it is *a survival set with reasons*.
