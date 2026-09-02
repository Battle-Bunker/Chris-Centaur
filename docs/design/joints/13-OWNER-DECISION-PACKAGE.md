# Decision package — the human boundary: one square, two worked designs

Cycle 7 of the COMPOSITION lens. The red team's three open failures — the
missing ADVICE seat, the sacrifice wall, and commit-timing — are **one
decision**, and this document works both candidate shapes so the choice is
between designs rather than slogans.

Verified against `claude/cluster-lookahead` @ `3090b77` and `TacticToes` @
`416d9c8`. Code citations are load-bearing here; each is quoted.

---

## 1. The three failures are one square

| failure | who owns the act today | what is missing |
|---|---|---|
| sacrifice lines | nobody — the move never reaches a human's screen | a surface that says "this death buys that" |
| commit timing | **the human** (`MoveCommitter` is *"Never invoked automatically — only from an explicit user action"*) | anything bot-side that reasons about when to commit |
| option surfacing | nobody | a joint kind whose sink is the operator |

All three sit on the same boundary: **the bot's output is a move, and the
product's output is a decision a human takes.** The manifest models the first
and has no vocabulary for the second. That is why the same gap shows up three
times.

And it is exactly the boundary owner ruling 13 already drew: *the bot's role in
the Centaur is to offer conservative advice that avoids silly mistakes while the
humans make the calls on taking risks based on empathy with their opponents.*
Sacrifices and commit timing are risk-taking. Under the owner's own division,
they are **human calls the bot should be informing** — and the architecture has
no channel for informing.

---

## 2. The decisive fact: the sacrifice wall is in ADMISSION and ADVICE, not in emission

This changes the price of the whole decision, so it is worth stating with
citations.

**A human-authorised sacrifice already plays today.** The operator pin path
matches a pinned destination against the candidate set **and the pruned ledger**
(`search/core.ts`, `matchPin`):

```ts
const matchPin = (set: CandidateSet, to: number): Candidate | null => {
  for (const c of set.candidates) if (c.to === to) return c;
  for (const entry of set.prunedLedger) if (entry.candidate.to === to) return entry.candidate;
  return null;
};
```

So a move the fatality closure removed is still reachable **by a pin**. Pins are
seeded first, their cells reserved before any free unit picks, and the bot never
unpins (*"the bot never auto-unpins; humans always win"*). The staging-safety
layer is about de-conflicting our own units, not about vetoing an operator's
destination.

**What is actually blocked** is the bot's own search, in three stacked places
the red team located precisely and I confirm:

1. `pruneFatalNoGain` measures "gain" at **one ply**, so a sacrifice whose
   payoff is three plies out dies at admission;
2. the `doomed` band plus sorted-prefix caps starve it of ordering even when
   admitted;
3. scout threads seed at the enumeration's own proposals
   (`scout/schedule.ts`), so a bottom-ordered sacrifice never earns deep
   pricing.

And `accept()` has **no doomed veto** — plan-level comparison would price a
sacrifice honestly. It loses in ACTION and ECONOMY before VALUE is ever
consulted.

**Therefore the owner's question is not "shall we weaken the safety floor".**
It is: *may the bot compute and surface sacrifices for a human to authorise?* —
a strictly smaller, strictly safer question, and one whose "no" is hard to
defend.

---

## 3. OPTION A — the ADVICE kind (recommended)

**The shape.** A sixth joint kind whose members read fibered values and write
**only** to the operator surface, never to the staged plan.

```
kind ADVICE
  sink:      operator surface (never the wire)
  law:       partition of a scarce ATTENTION budget over set-valued selection
             (members rank SETS of plans under a declared diversity or
             decision-relevance measure — not individual plans)
  constraint: excludes — no joint that produces the staged plan may read an
             ADVICE member's output (load-time check, module-boundary enforced)
```

**Three members at launch**, so the kind does not open empty:

| member | what it surfaces | seat |
|---|---|---|
| `advice/sacrifice-warrant` | rules-certain-fatal plans whose team-level price is positive, each with its warrant: what the death buys, in the currency | reads the VALUE fold; needs admission to *evaluate*, not to stage (§3.1) |
| `advice/commit-timing` | when to commit, and what committing costs and buys, from the live `moveStatuses` doc | reads the wire's public commit status |
| `advice/disagreement` | boards where two seated VALUE profiles rank differently — the ambiguity signal | reads two projections |

**3.1 What must change for the sacrifice warrant to be computable.** Not the
floor, and not the closure's verdict for the bot's own plan — only its
*visibility*:

- the closure keeps refusing, and additionally **records** the refused option in
  the pruned ledger with its one-ply verdict (it already does);
- `advice/sacrifice-warrant` re-prices a bounded sample of pruned-fatal options
  at **team level** through the ordinary VALUE fold, off the decision's own
  budget, under an ECONOMY ration;
- a positive warrant reaches the operator surface. The human pins it or does
  not. **No bound moves, no closure changes, the staged plan is untouched
  unless a human acts.**

**3.2 Commit timing, in the same kind.** Verified wire facts:
`moveStatuses/{turn}` is world-readable (`allow read: if true`) and carries
`movedPlayerIDs`; a commit is irrevocable for the turn (`privateMoves` create is
gated on `!hasCommittedForTurn`); and the server resolves the turn early once
every alive player has committed. So committing early is a *credible public
commitment* and also *denies everyone clock* — including the humans on the other
side. Today nothing bot-side even reads that document. `advice/commit-timing`
reads it and says: who is still thinking, what our option value is worth, what
committing now would freeze.

**Cost.** One kind in the manifest, one sink discipline, three members, one new
ration. No law change. No floor change. Fully reversible: delete the kind and
the bot is what it is today.

**What it forecloses.** Nothing structural. If evidence later shows the bot
should stage warranted sacrifices itself, Option B is a strict extension — the
warrant object, the pricing path and the telemetry all carry over.

**Acceptance tests** (behavioural, per the capability-ledger standard):
1. On a seeded board where a 2-weight unit's death seals a corridor worth 30, the
   operator surface shows the sacrifice with its warrant; the staged plan does
   not contain it; a pin makes it play.
2. On a board with no positive warrant, the surface shows none (no
   sacrifice-spam — the false-positive rate is the number to watch).
3. With two opponents still uncommitted and our margin decided, the surface says
   so and names the option value being spent by committing now.

---

## 4. OPTION B — kernel-law parameterisation (the bot acts on its own)

**The shape.** No new kind. The closure law becomes premise-indexed and the
obligation law gains commit-timing members:

```
closure law, amended:  a closure may remove an option only if its justification
                       is invariant under the reduction binding.
                       unwarranted fatality → kernel refusal (unchanged)
                       warranted fatality   → admissible; warrant recorded as an
                                              Assumption and ridden on the emission
doomed band:           becomes `doomed-unwarranted`; a warranted death is ordered
                       by the currency like anything else
ECONOMY/obligation:    gains commit-timing members (commit-late /
                       commit-on-confidence / commit-early-to-deny-clock)
```

**What it buys.** The bot plays the whole quadrant of chess it currently cannot:
decoys, corridor seals, tempo sacrifices — without a human in the loop. Under
the VALUE lens's currency these are ordinary positive flows.

**What it costs.**
1. **The safety floor's definition changes.** "Rules-certain fatality is
   refused" becomes "…unless a member priced it", and the correctness of every
   refusal now depends on the correctness of a member. The floor stops being
   inspectable in one file.
2. **A new failure mode with no precedent here**: a noisy member writes a
   warrant, the bot kills its own unit, and the post-mortem is a pricing
   argument rather than a rules argument. The program's whole soundness culture
   is built on the opposite property.
3. **It contradicts ruling 13's division** — risk-taking moves to the bot —
   which is an owner call, not an engineering one.
4. Commit-timing members must then decide *for* the human on a control the
   product currently reserves to an explicit user action.

**Acceptance tests.** Everything in Option A, plus: paired live play on
sacrifice-bearing boards showing net positive `sharePar` **and** a bounded
self-inflicted-death rate — which is a batch, not a scenario, and therefore
weeks rather than days.

---

## 5. Recommendation

**Take Option A now. Hold Option B as a strict extension, gated on evidence that
A produces warrants a human accepts.**

Four reasons, in order of weight:

1. **A is ruling 13's architecture, not a compromise with it.** The bot computes
   the risky option and prices it; the human takes the risk. That is the
   Centaur division the owner already stated, and the program has never had a
   channel to implement it.
2. **A costs no law change and no floor change**, and the pin path already
   carries the human's authorisation end-to-end. The expensive half of the
   red team's demand turns out to be already built — what is missing is the
   half that tells a human it exists.
3. **A generates exactly the evidence B needs.** Warrants surfaced, warrants
   accepted by a human, and outcomes of accepted warrants are the dataset that
   decides whether the bot should ever act alone. Under B-first there is no such
   dataset and the first evidence is a lost unit.
4. **A seats commit-timing in the only place the product allows it today** —
   the human's hand — while B has to move a control the product deliberately
   reserves.

**The honest cost of A**: the bot remains unable to play a sacrifice in
unattended play (a pure-bot arena arm still cannot). If the owner's priority is
bot strength in *unattended* play, that argues for B, and the trade should be
stated to him in exactly those words.

---

## 6. What each option does to the manifest

| | Option A | Option B |
|---|---|---|
| kinds | 6 (ADVICE added; sink + one-way constraint) | 5 |
| closure law | unchanged | premise-indexed; kernel gains a priced exception path |
| `doomed` band | unchanged | splits into warranted / unwarranted |
| obligation law | commit timing is ADVICE, not a bot policy | commit timing becomes ECONOMY-obligation members |
| new constraint rows | `excludes: ADVICE → staged-plan joints` | `requires: warranted-fatality → a VALUE member that prices it` |
| new coordinates | none | the warrant becomes an `Assumption` (premise), so every value under it is conditional |
| reversibility | delete the kind | a floor definition is hard to walk back |

Both options need the same two prerequisites, which are already in the build
order and are worth doing regardless: **the admission trace as a coordinate**
(without it, no one can tell a sacrifice that was never admitted from one that
was priced and lost) and **`botId` on the mechanism report** (without it, no one
can tell which bot produced a warrant).

---

## 7. The question, in one paragraph, for the owner

> Today the bot may not consider giving up one of its own units, even when the
> team gains by it: the move is deleted before anything prices it. A human can
> already force such a move by pinning it — that path works end to end — but
> nothing ever tells the human the option exists. **Option A**: the bot computes
> these sacrifices, prices what each death buys, and shows them to you to
> authorise, along with advice on when to commit the turn; the safety rules do
> not change and the bot never plays a sacrifice on its own. **Option B**: the
> bot also plays them itself whenever one of its own heuristics says the trade
> is good, which means the rule "never move into certain death" becomes "unless
> a heuristic priced it". A is recommended, and it produces the evidence that
> would justify B later.
