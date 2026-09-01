# Addressing — an arm is a point, not a label

Cycle 3 of the COMPOSITION lens. Verified against the kit line @ `639416b`
(`tools/simworker/bin/run-pair.js`, `lib/arm-spec.js`, `harness/lib/config.ts`,
`harness/lib/match.ts`, `bin/verify-null.js`) and the engine at `3090b77`.

---

## 1. The coordinate system is half-built

The harness already content-addresses the **board** side, properly:

```ts
configHash(c)  // sha256 of the normalized config MINUS name and seed — one board SHAPE
boardHash(c)   // the same INCLUDING the seed — one exact starting board
stableStringify(v)   // key-order-independent canonical form
```

That is exactly the discipline `00-CORE.md` §4.3 asks for, and it works: cells
group by shape, games pair by board, and a config that differs only in key order
hashes the same.

The **bot** side has no equivalent. An arm is

```
name=<bundle-dir>[,bot=<json|path>][,bot@<seat>=<json|path>]...[,KEY=V]...
```

— a human label, a filesystem path to a build of some git ref, and a JSON blob
per seat. So:

- **Two arms are "the same bot" only by inspection.** `verify-null.js` compares
  `botConfig` *and* `seatConfigs` structurally and the code comments explain
  why both are needed — that check is a hand-rolled `botId` equality.
- **The code half is opaque.** `bundle` is a directory; which *joints* differ
  between two bundles is not a question the manifest can answer, only which
  path was built. That is the merge decision's actual question.
- **A ledger row is keyed on a name.** Arm names were renamed once already
  (`integrated`/`perf-substrate` → `baseline`/`search-arch`, with a was/is
  mapping recorded by hand). Names drift; addresses do not.

## 2. The completion

```
cell    = boardHash                                   (exists)
arm     = ⟨ codeRef , botId , seat ⟩                  (botId is the missing half)
regime  = ⟨ budgetMs , workers , observed load ⟩      (§3 — measured, not declared)
row     = ⟨ cell , arm , regime , metric ⟩
```

with `botId = structuralIdentity(normalise(bot))` — the same function the
registry already uses for entry fingerprints (`contracts.ts:83`), over the
total bot value of `00-CORE.md` §4.2. `codeRef` is the bundle's git SHA, which
`build-bot.sh` already knows and the manifest already records.

What that buys, in the harness's own terms:

| today | with an address |
|---|---|
| A/A null = "same bundle, same contender, different names", checked by an ad-hoc structural compare | A/A null = **arm coordinates equal except `name`** — one equality, uncheatable |
| the treatment delta is prose in a spec header | the delta is a **structural diff of two bot values**, printable, and it names the joints that differ |
| a cross-branch arm says "baseline vs search-arch" | it says *which joints the manifest differs in* — the merge question, answered by the artifact |
| an operator excursion is invisible to the record | a dial writes a new `botId`; the excursion is a row in the same coordinate system as every experiment |
| a ledger row keyed on a name that has been renamed once | keyed on an address, with names as labels over it |

**The Centaur payoff is the one worth naming twice.** The DoF synthesis requires
that "every operator excursion is logged as a candidate config" and that dials
be "bounded reparameterizations of a validated region". With bots as addressed
values that is not a discipline anyone must remember: the dial *is* a
reparameterisation (it moves one member's params inside declared bounds), so it
mints a `botId` by construction, and versioned play-strength, experiment arms
and live operator excursions all live in one coordinate system. A human who
found a good dial setting mid-game has produced a candidate bot, addressable and
raceable, without anybody transcribing anything.

## 3. Declared coordinates and observed coordinates

Not every coordinate can be declared. An anytime bot's strength is a function of
the CPU it got — `run-pair.js` refuses a single arm for exactly this reason, and
the record shows A/A floors varying ~2× with box load and a null-snake6 wall
floor widening ×17.76 under contention. So:

- **Declared** coordinates (board, bot, code, seat, budget, worker count) are
  inputs, hashed, and must be *equal* for a pair.
- **Observed** coordinates (wall time, plans/decision, slices, first-plan
  latency) are outputs, recorded, and must be *comparable* for a pair — which is
  what launching both arms at the same instant achieves physically.

A row must carry both, and a verdict must state which it relied on. This is the
premise lattice's declared-vs-measured distinction, and it is why "not the box"
was refutable at all: the observed coordinates were on the rows.

Corollary, and it is a rule the program learned the expensive way: **a miner
that meets a coordinate it does not know must refuse, never default.** The
depth-idle false alarm was one field name read against a folded row, every
lookup `undefined`, every `??` defaulting to `0`, every cell printing 0.0% — a
whole retracted crisis. `depth-ran.js` now refuses. The refusal belongs in the
row reader, once, for every column.

## 4. What lane (b) looks like under addressing

The two-lane rule stands unchanged (`docs/BRANCHING.md`): collection members and
config values are normal commits; architecture changes are `feature/<name>`
branches, validated, then merged. Addressing changes only what a cross-branch
comparison can *say*:

- Each branch carries its **joint manifest** as data (`00-CORE.md` §3.1). A
  cross-branch arm's manifest diff is the list of joints that exist on one side
  and not the other, plus the joints whose composition law differs. That is the
  merge decision's content, and today it is reconstructed by reading commits.
- **The reachability law travels with the branch.** A feature branch that adds a
  joint must also add at least one roster bot that seats it, or CI fails — so a
  branch cannot accumulate an unplayed architecture, which is the exact failure
  the two-lane rule was created to prevent, now enforced by the artifact rather
  than by review.
- **A merge is a manifest join.** If both sides changed the same joint's law,
  the conflict is visible at the row rather than as a textual conflict inside a
  comparator.

## 5. The smallest useful increment

1. `botId` on the engine side: `structuralIdentity` over the resolved bot,
   stamped on `MechanismReport` beside the existing config stamp. **One field,
   no behaviour change**, and it immediately makes "did both arms play the bot
   the manifest says?" a one-line check — the question that, unanswered, cost
   every potion measurement the program had taken.
2. `botId` on the kit side: recorded per seat in `arm.json` and the manifest;
   `verify-null` compares addresses instead of structures.
3. The structural diff printer: `bot-diff <a> <b>` → the joints that differ.
   Used in spec headers, so an arm's claim is generated from its own definition.
4. Row reader refuses unknown columns (generalising `depth-ran.js`'s fix).

None of these requires the manifest, the roster or the reachability law to land
first — they are the address discipline arriving ahead of the algebra, and each
is independently worth it.
