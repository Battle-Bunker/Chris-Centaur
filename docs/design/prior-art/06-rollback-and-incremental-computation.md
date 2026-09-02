# PRIOR ART 6 — rollback netcode and incremental computation

Domain: two industries that have already built what the TIME lens calls
*re-base* and *citation-scoped invalidation* — real-time game networking (GGPO
and its descendants) and language-based incremental computation
(Adapton / Salsa / Jane Street's Incremental).

Read against `time-SYNTHESIS.md` §1Q2–Q3 (observe, ADVANCE, replay-rebase, the
wire doc as checksum), `feature/commit-scope`, and `07-SYNTHESIS.md` risk 1.

---

## 6.1 Load-bearing sources

**S16. GGPO and the rollback-netcode practice it defined** (ggpo.net; SnapNet's
*Netcode Architectures Part 2: Rollback*; the desync-reporting practice).

**S17. Hammer et al., "Incremental Computation with Names" (NOMINAL ADAPTON,
OOPSLA 2015, arXiv:1503.07792)**, plus `miniAdapton` (arXiv:1609.05337) for the
minimal core. The demand-driven dirty/propagate algorithm, and the argument that
**first-class names** are the critical feature.

**S18. Salsa's red-green algorithm and its `Durability` mechanism**
(salsa-rs.github.io/salsa/reference/algorithm.html; rust-analyzer's *Durable
Incrementality*, 2023). Revision counters, dependency recording, early cutoff by
backward flooding, and durability-based revalidation skipping.

---

## 6.2 What the experts decided, and their stated rationale

### (a) Rollback: determinism is a prerequisite, and the checksum is the design

The rollback contract: only **inputs** cross the wire. "For any given input and
state, the resulting state must be the exact same for all players." Game logic
proceeds using local inputs plus **predicted** remote inputs; when the true
inputs arrive and differ, the engine loads the savestate from the last confirmed
frame and re-simulates forward.

Three practices that carry:

1. **The predictor is the crudest possible thing that respects temporal
   correlation** — "the game duplicates the opponent's last known input during
   delays" — and it is good enough that the entire genre is built on it.
2. **A per-frame state checksum is exchanged, and that is the standard desync
   detector.** When checksums diverge you "report it immediately with the frame
   number and the inputs leading up to it." The named causes of desync are worth
   quoting because they are all *our* hazards: "an uninitialized variable, a
   floating-point difference, or **iteration over an unordered collection**."
3. **The rollback window is bounded by design.** Practical GGPO covers latency to
   ~150 ms; beyond the window the system stalls rather than rolling back
   arbitrarily far. Save/load state must be cheap enough to do many times per
   frame.

### (b) Incremental computation: dirty eagerly, verify lazily, cut early

Salsa's red-green algorithm: the database tracks a single **revision**,
incremented on each input change; for each input it records the revision in which
it last changed. A tracked function records, alongside its result, *which other
tracked functions it called* and the revisions at which their values last
changed. On re-invocation in a new revision, it checks whether any input actually
changed; if not, it returns the cached value; if so, it re-executes. Critically:
**"backward flooding stops when we hit a query whose result is unchanged despite
a changed input"** — early cutoff, again.

**Durability** is Salsa's second mechanism and the one to steal. Inputs are
annotated with a durability level. "If we know that the only changes were to
inputs of low durability (the common case), and we know that the query only used
inputs of medium durability or higher, then we can skip that enumeration" — i.e.
whole subgraphs are revalidated in O(1) rather than traced to their leaves.

Adapton adds the **demand-driven** discipline: changes *dirty* the graph (cheap,
eager, O(edges touched)); recomputation happens only when a value is *demanded*.
And NOMINAL ADAPTON's thesis: **first-class names are a critical linguistic
feature** — "names identify computations to be reused across differing runs of a
program, and making them first class gives programmers a high level of control
over reuse". The system is formalised and **proved from-scratch consistent**: the
incremental answer always equals the answer from re-running.

---

## 6.3 Mapping onto our joint

### AGREES — and one of these is the survey's cleanest vindication

- **The replay-rebase design is GGPO, correctly derived.** "Reconstruct the
  resolution by replaying the realized joint move through the bot's own
  differentially-tested engine, with the wire doc as a per-turn CHECKSUM and
  today's marshal path as the fallback on any mismatch" is the rollback contract
  almost verbatim: send inputs, re-simulate locally, checksum to detect
  divergence, fall back on mismatch. The claimed bonus — "a free differential
  test of the partial engine runs every live turn" — is exactly what rollback
  developers get from per-frame checksums and treat as one of the architecture's
  main benefits. This is the strongest independent confirmation any lens's core
  mechanism received in this survey.
- **Removing slice-count nondeterminism is the prerequisite, not a nicety.**
  "Wall cuts inside work become counting cuts; wall time influences only the
  number of grants, which the ledger records" is precisely the determinism
  contract rollback requires. Doing it first is right.
- **Citation-scoped invalidation is the incremental-computation problem**, and
  the field's answer (record dependencies, compare, cut early) is the shape the
  design is reaching for.

### CONTRADICTS — flag loudest

**C19. Our invalidation is EAGER; the field's is dirty-then-verify-on-demand, and
the difference bites hardest at exactly our worst moment.** `observe(determination)`
is specified as "advance the frontier; **kill** exactly the state whose declared
coordinates the determination touched". Killing is eager: the work is discarded
now and will be redone when needed. Adapton and Salsa both split this into two
phases — mark dirty (cheap, immediate, proportional to edges touched) and
recompute *on demand*, with early cutoff during revalidation.

  Why this matters more for us than for a compiler: an operator commit arrives
  *mid-turn, with the deadline approaching*. Eager invalidation converts a cheap
  marking into an expensive recomputation at the moment compute is scarcest, and
  it recomputes state that the remainder of this turn may never demand. The
  economy the time lens is building is precisely a demand-ranking mechanism —
  so the invalidation layer should hand it dirty marks and let the market decide
  what to re-verify. This is a small change to `observe()` with a large effect on
  the 343 ms claim, and it makes `feature/commit-scope`'s falsifier easier to
  pass rather than harder.

**C20. Early cutoff is missing again, and this is its third independent
appearance.** Salsa: backward flooding stops when a query's result is unchanged
*despite* a changed input. Our declared read-sets record *which* coordinates were
read; without the *values* (or their hashes), a changed coordinate always
propagates, so invalidation is narrow but never short. Domains 5 and 6 agree on
the remedy (verifying traces / recorded value hashes) and domain 4 supplies the
same lesson from KataGo's side. **Three separate literatures independently say
the same thing about our design: record what you read, not just where you read
it.**

**C21. Identity-for-reuse and equality-for-dedup are two different keys and we
have one.** Domain 5 says: content-address, so that identical content gets an
identical key (Nix). NOMINAL ADAPTON says: use first-class *names*, because a
name must remain **stable across the change you want to be incremental in** — a
name identifies "the same computation, one revision later", which is exactly what
a content hash must *not* do. These are complementary and their laws are
opposite:

  | key | law | purpose | our current holder |
  |---|---|---|---|
  | content address | changes iff content changes | dedup, cache correctness, "are these the same bot?" | `botId` |
  | name | stable across the incremented input | reuse across runs, "is this the successor of that work?" | `botId` |

  `botId` and the premise ids are being asked to do both jobs, and the second job
  is the one the attention map, the carry store, warm promotion and cross-turn
  ADVANCE all depend on. When a premise id churns (composition risk 1), what is
  actually lost is the *name*, not the address. **Split them:** keep the content
  address for equality and add a stable **site name** — the joint/unit/coordinate
  the work is *about*, which survives the value changing. Nominal Adapton's
  measured result is that this split is where the large speedups over plain
  Adapton come from.

**C22. Our rollback window is unbounded; GGPO's is bounded by construction.**
Rollback engines cap how far back they will re-simulate and *stall* past the cap,
so the worst case is a designed number rather than an emergent one. The time
lens's re-base has no stated bound: an operator who changes their mind late, or
several times, triggers replay whose depth is limited only by how much work
happened to be citation-dependent. Give it a hard cap with a defined behaviour on
exceeding it (fall back to the marshal path / full re-open, which already exists
as the mismatch fallback), so the reaction table has a bounded worst case and the
ledger can report how often the cap fires.

**C23. A per-turn checksum detects divergence but cannot localise it — and our
named desync hazards are GGPO's named desync hazards.** "Iteration over an
unordered collection" is on their list and is present in ours: candidate
generation, cluster partition and the conflict index all iterate maps/sets, and
`order-shuffle.test.ts` exists because order sensitivity has already bitten. The
rollback practice is to report the frame number *and the inputs leading up to
it*; a once-per-turn checksum gives neither. `subStepCount` is currently filed
under "additive polish" — it should be **promoted to the mechanism that makes the
free differential test diagnosable**, with a per-sub-step checksum. Without it,
the first live mismatch produces an alarm nobody can act on, and the depth-idle
lesson says an unactionable alarm gets retracted rather than fixed.

### COVERS A CASE WE MISSED

**M18. "Repeat the last input" is the baseline every hypothesis-market member
must beat.** Rollback's predictor is the crudest thing that respects temporal
correlation, and it carries an entire genre. Our hypothesis market is being
designed as an open ranking problem over conditional frontiers; it needs a free
baseline, and this is it: *the enemy continues its current trajectory / keeps its
posture*. Cheap, needs no model, and a market member that cannot beat it is not
earning its allowance. Adding it costs nothing and makes the market's first
measurement meaningful.

**M19. Durability is the built, named, measured answer to composition risk 1.**
The lens proposes splitting premise ids into "a stable half (config, frame,
horizon) hashed once per decision, a volatile half (model, pins) per branch".
Salsa's durability is the same idea done better: durability is a property of the
**input**, not of the id, and the revalidation algorithm consumes it to skip
whole subgraphs in O(1) when only low-durability inputs changed. Map directly:
config/evalVersion = HIGH, frame/horizon = MEDIUM, model/pins/hypothesis = LOW.
Then the common case — an operator commit changes pins only — revalidates nothing
above the LOW tier without tracing it.

**M20. From-scratch consistency is a *standing* property, not a migration gate.**
NOMINAL ADAPTON is *proved* from-scratch consistent: the incremental result
always equals re-running from scratch. The composition lens asks for
byte-identity at every migration step, proved against the cross-build gate. The
literature's framing is stronger and cheaper: make it an invariant of the
incremental layer, checked by *occasionally recomputing from scratch in
production and comparing* — which is exactly the free-differential-test pattern
the replay-rebase design already invented for the engine. One mechanism, two
users: run it on the incremental value layer too, at a sampled rate, and the
whole citation/invalidation design gets a live soundness audit of the same kind
the belief lens's reappearance oracle gives the cloud engine.

---

## 6.4 Verdicts the lens agents can act on

- **TIME (four changes, all small):**
  1. Make `observe()` **dirty**, not kill. Recompute on demand, with the economy
     deciding what to demand. Eager invalidation spends the scarcest compute at
     the worst moment on work that may never be needed.
  2. Record **value hashes** in the declaration record, not just coordinates —
     this is the third independent statement of the early-cutoff point (domains
     4, 5, 6 all land on it).
  3. Bound the re-base window and define the behaviour past the bound (the
     marshal-path fallback already exists); report cap hits in the ledger.
  4. Promote `subStepCount` + a per-sub-step checksum out of "additive polish".
     GGPO's desync-cause list is our hazard list, and a per-turn checksum can
     detect but not localise.
- **COMPOSITION:** adopt Salsa **durability** as the mechanism behind risk 1's
  stable/volatile split; and split the two keys — content address for equality,
  a stable **site name** for reuse across revisions. Nominal Adapton's headline
  result is that the second key is where the speedups live, and every cross-turn
  mechanism we want (attention carry, warm promotion, ADVANCE) is a reuse-across-
  revisions problem, not a dedup problem.
- **BELIEF:** the hypothesis market's free baseline is "the enemy repeats" —
  adopt it as the zero member so the market has something to be measured against
  from day one.
- **ALL:** from-scratch consistency, sampled in production, generalises the
  replay-rebase differential test from the engine to the incremental value layer.
  One pattern, three audits (engine, values, clouds).
