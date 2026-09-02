# The consolidated build order — one plan, its dependencies, and the smallest useful subset

Cycle 14. Five documents now carry increment lists (`07` B0–B8, `19` E1–E7,
`20` M1–M5, `32` X1–X6, `33` L1–L5) and nobody can execute from that. This is
the single ordered plan: what depends on what, what changes behaviour, what is
shared with which lens, and — the question a reader actually has — **what to
build if only a few things get built.**

---

## 1. The duplicates, resolved first

Three pairs were the same work under two names:

| pair | resolution |
|---|---|
| `B0` (stamp `botId`/`behaviourId`) and `M1` (addresses, no schema change) | **one increment**: `A1` |
| `B4` (settleTurn / adjudicate / grammar) and `E1–E7` | `B4` is the summary; **E1–E7 is the plan**. Use E |
| `B1`'s "key the value table by (horizon, frame)" and `X1–X3` (the index as projections) | **X comes first**: keying is an index operation, and M74 says the bank already implements it |

---

## 2. The plan

```
        A1 ─────────────┐                         A1  addresses stamped
                        │                         X   index inversion
   X1→X2→X3 ─── X4 ─────┼── B1 ── B8              L   candidate lifecycle
        │               │        (reduction)      B   bot/manifest spine
        └── X5 ── X6    │                         E   engine (shared repo)
                        │                         M   measurement
   L1→L2→L3 ── L4 ── L5 ┤
        │               │
        B2 ── B3 ───────┴── B7 (ordering)
        │
        M2 → M3 → M4 → M5
                                    ┌── B6 (carried premises)
   E1 → E2 ──────────────────────── ┤
     └→ E3 → E4 → E5 → E6 → E7      └── B5 (ADVICE — owner decision)
```

| # | increment | changes behaviour? | shared with | depends on |
|---|---|---|---|---|
| **A1** | `botId` + `behaviourId` stamped on the mechanism report; kit records per seat; `verify-null` compares addresses | no | — | — |
| **X1** | the index module: coordinates, canonicalisation, the operations table as data | no | epistemics, time | — |
| **X2** | `basisKeyOf` / `evaluationIdentity` re-expressed as projections | no (character-identical keys) | epistemics | X1 |
| **X3** | memo namespace and worker key follow | no | epistemics | X2 |
| **X4** | `tighten` lifted out of the bank; cross-horizon tighten becomes a type error (Law H′) | **only by refusing** | epistemics | X3 |
| **X5** | CI: key-constructor allow-list, clone detection, projection round-trip, each with a falsification test | no | — | X2 |
| **X6** | CPP key and trace key adopt the index | no | epistemics | X5, fit provenance |
| **L1** | `CandidateSet` wrapper, empty trace, passed through every stage | no | value | — |
| **L2** | closures and ordering record their member ids | no | value | L1 |
| **L3** | truncation records cap, dropped, **spread** | no | value | L2 |
| **L4** | the trace becomes a premise coordinate; the miner refuses to pool across coverage shapes | **measurement only** — invalidates some pooled numbers, deliberately | value | L3, X1 |
| **L5** | the six-cause separation as a standing report | no | value | L4 |
| **B1** | the value table on `BankResult` — `envelope[(horizon, frame)]`, `estSound`, `estAdvised`, `advisoryPrecision` | no (unfitted ⇒ precision 0) | **epistemics** | X3 |
| **B2** | the joint manifest; codec/stamp/columns/diff/knob schema generated; ambiguity detection; `BotStamp` deleted | no | **time** (allowance ledger — one increment) | A1, L2 |
| **B3** | bots as total addressed values; roster; `botDiff`; reachability, single-binding and Law-S checks | no | — | B2 |
| **B5** | the ADVICE kind: sacrifice warrant, commit timing, disagreement | **yes** | — | **owner decision** (`13`), B3 |
| **B6** | carried premises + the ⟨name, trace⟩ attention map; mutations as deferred commands | **yes** | time | B3, E2 |
| **B7** | the ordering joint: scalarization members, precedence residual | **yes** | value | B3, L3 |
| **B8** | the reduction site-class table; ε at the read; supplier members | **yes** | epistemics | B1, B3 |
| **E1** | effect expiry + ally-buff cancel move into the module | no | — | — |
| **E2** | **potion collection moves in; `potionWindowTurns` an input; settlement returns tiers** | no (server) / **unlocks** (bot) | value | E1 |
| **E3–E4** | orientation rewrite; pawn → queen | no | — | E2 |
| **E5** | `adjudicate` + `sharePar` exported; all three callers | no | value | E4 |
| **E6** | `SpawnLaw` with `outcomes()` primary, `sample()` derived | no | epistemics | E5 |
| **E7** | grammar queries exported; bot deletes its re-derivations; UI gains legality | **yes** (bot) | — | E6 |
| **M2** | the re-key script: historical rows gain addresses (`legacy-env:` where honest) | no | — | A1 |
| **M3** | ledger schema: member rows, `validatedAt` coordinates, per-part engagement | no | — | M2, B2 |
| **M4** | generated columns + the independent oracle (observation-built stamp vs manifest-built) | no | — | M3 |
| **M5** | constraint enforcement at spec time (compensating pairs) | no | — | M4 |

**Only six increments change behaviour**, and four of those (B5–B8) are gated on
something else — an owner decision, an engine step, or a measurement.

---

## 3. The critical path to the owner's stated priority

His standing priority is a bot that is **intelligent about potions in play**.
That path is short and it is mostly engine work:

```
E1 → E2  (settlement returns tiers — the window becomes a state the search can walk)
       → B6  (the arm→collect→spend commitment, with a lifetime and an invalidator)
       → L3  (the ordering slot's effect becomes measurable in the trace)
       → B5  (the human half: the warrant surfaced for ratification)   [owner decision]
```

**E2 is the keystone.** Today `tier` is an input-only field, so a simulated turn
cannot advance a window and a three-turn plan is unmodellable — the potion
branch's recorded design wall. Everything else on this path is downstream of
that one field direction changing.

---

## 4. If only three things get built

**A1, X1–X3, E1–E2.** In that order, and here is the case for each:

1. **A1** — one field, no behaviour change, and it answers the question that
   invalidated every potion measurement the programme had taken: *did both arms
   play the bots the manifest says?* It costs a day and it retires a defect
   class that has cost weeks.
2. **X1–X3** — the index inversion's byte-identical half. It deletes three
   module-local conditioning tuples, and per M74 it is **recognition, not
   invention**: the bank already implements canonicalise / union / refuse, so
   the risk is "does the generalisation preserve what the bank proves", which a
   character-identical key test answers directly.
3. **E1–E2** — the capability unlock. Without it the owner's first priority is
   not buildable at any budget; with it, the rest of the potion path is ordinary
   work.

Everything else in this design is an improvement to how we build and measure.
Those three are the ones that change what is *possible*.

---

## 5. What each lens owes, so nothing is built twice

| shared item | who builds it | the other lens's stake |
|---|---|---|
| the index (X1–X3) | this lens | epistemics' projection tag and time's citation records are projections of it |
| the value table (B1) | epistemics | this lens owes `(horizon, frame)` in the key or shadow invocation cannot be built on it |
| the manifest + generated columns (B2) | this lens | time's allowance-ledger schema is the same generator — **one increment, not two** |
| `settleTurn` (E1–E6) | engine/value | time's replay-rebase shrinks its copied game state to spawn cells alone |
| the candidate trace (L1–L3) | this lens | value's homogeneity diagnostic reads it; the search lens's lifecycle owns the stages |

---

## 6. The honest risks of this order

- **L4 invalidates pooled numbers on purpose.** Some published deltas span two
  coverage shapes and will need re-reading. Doing it late is worse than doing it
  early, because the corpus grows.
- **X4 is the first refusal.** A cross-horizon `tighten` becomes a type error,
  and if something in the tree was relying on that comparison the failure will
  look like a regression. It is not; it is a defect surfacing. The falsification
  test should be written *before* X4, so the refusal can be demonstrated
  deliberately rather than discovered.
- **B5 is blocked on a person, not a build.** If the owner's answer is "B, not
  A" (the bot plays sacrifices itself), the increment changes shape and the
  safety-floor definition moves with it — so it should be asked early even
  though it is built late.
- **E2 touches a shared repo and changes what `tier` means in the module's
  contract.** The vendored copy must be re-synced in the same change, or two
  encodings exist again for one turn's length — which is the failure this whole
  engine section exists to remove.
