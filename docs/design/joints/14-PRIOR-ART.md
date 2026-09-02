# Prior art — five systems that industrialised these four moves, and what they learned the hard way

Cycle 8 of the COMPOSITION lens, under ruling 50 (research, expert
implementations). Each section: what the system does, the hard lesson, and
**what changes in this design because of it**. Six design changes come out of
this; three are corrections to things I had wrong.

---

## A. Nix — content-addressing, normalization, and cache-key explosion

**What it does.** A build is a *derivation*; its output is stored at a path
derived either from **how it was made** (input-addressing) or from **what it is**
(content-addressing). The reference manual states the distinction exactly:
*"an input-addressed output's store path is a function not of the output itself,
but of the derivation that produced it. Even if two store paths have the same
contents, if they are produced in different ways … they will have different
store paths."*

**The hard lessons.**

1. **Input-addressing causes mass invalidation.** Change a comment in a source
   file and every downstream hash changes, so everything rebuilds. The fix is
   content-addressing plus **early cutoff**: *"suppose you add a comment in a
   source, Nix will rebuild the component depending on it, but since the output
   will be the same … every other component that depends on that will not be
   rebuilt."* Content-addressing is what makes *equivalence* usable where
   *identity* changed.
2. **Self-references defeat content-addressing.** RFC 62: outputs that embed
   their own store path *"change each time the inputs of the derivation change,
   making CA useless."* Their detection trick is elegant — build with an
   artificially different output path and see whether the output changes.
3. **Realisations diverge across machines.** Two builders can produce different
   outputs for the same derivation, and then a downstream consumer with the
   *local* realisation cannot use the *cached* one — you rebuild anyway. CA
   forces you to name a trust model.
4. **Normalization must be canonical and total.** "Resolving" a derivation
   replaces every input derivation with its concrete store path before hashing;
   without a canonical normal form you get spurious cache misses.

**What changes here.**

- **`botId` is input-addressed, and I had not noticed the cost.** It hashes the
  *configuration*, so a cosmetic re-parameterisation, a re-fit that changes no
  decision, or a member split that preserves behaviour **invalidates every
  measurement row keyed on it**. That is cache-key explosion, and the program
  can least afford it: our measurements cost box-nights, not CPU-seconds.
  **Adopted: a second, output-addressed identity.**

  > **`behaviourId`** = the hash of the decision function's observable behaviour
  > over a fixed canonical probe suite (a small pinned set of boards × seeds ×
  > budgets, decided once): the staged plans, the refusals, the assumption sets.
  > `botId` is **identity** (what we asked for); `behaviourId` is
  > **equivalence** (what it does). A change that moves `botId` but not
  > `behaviourId` **retains prior measurements** — Nix's early cutoff, applied
  > to experiments.

  This also gives the re-fit rule from `08` a cheap exit: re-fitting mints a new
  member id (identity), and if the new fit changes no decision on the probe
  suite, every existing measurement still applies (equivalence).

- **The self-reference rule, adopted as a CI check.** Fit provenance names its
  reference population by bot address. If a bot's own address ever appears
  transitively inside its own params, `botId` has no fixed point. Rule: a fit's
  `population` may name opponents and code refs, **never the containing bot's
  own id**; CI asserts the params tree is acyclic in bot addresses. (Nix's
  detection trick has a direct analogue if we ever doubt it: recompute the
  address with a salted placeholder and check nothing moved.)

- **"Realisation divergence" is the right name for our box problem.** An anytime
  bot on a loaded box is a different realisation of the same derivation. Nix's
  lesson is that this must be a *declared* concept with a trust model, not
  noise: our A/A floor is the realisation-divergence measure, and a measurement
  may only be compared against another realisation of the same declared regime.
  That is `04 §3`'s observed coordinates, with a name and a precedent.

- **Normalization is load-bearing, not hygiene.** `normalise(bot)` must be
  canonical (sorted keys, resolved `extends`, defaults materialised, member
  params resolved to values) *before* hashing, or two identical bots get two
  addresses. `structuralIdentity` already sorts keys; the `extends` resolution
  is the part I owe.

---

## B. Bevy ECS / Unity DOTS — typed access declarations, and detecting the coupling nobody declared

**What it does.** A system declares what it touches through its parameter types
(`Query<&A, &mut B>`, `Res<C>`, `ResMut<D>`); the scheduler derives conflicts and
parallelism from those declarations alone. *"if a system mutably accesses data,
no other system that reads or writes that data can be run at the same time."*

**The hard lessons.**

1. **Undeclared ordering is nondeterminism, and it needs a detector.** Bevy 0.5
   introduced ambiguity detection precisely because a parallel scheduler
   *creates* a new error class: *"When two systems interact with the same data,
   but have no explicit ordering defined, the output they produce is
   non-deterministic (and often not what the author intended)."* It ships as a
   build setting (`ambiguity_detection: LogLevel::Warn`) that reports every pair
   where one writes and no ordering exists.
2. **Structural mutation is deferred to explicit sync points.** `Commands` are
   queued and applied by `ApplyDeferred`, which the scheduler inserts
   automatically between dependent systems. You never mutate the world
   mid-schedule; you enqueue and the barrier applies.
3. **Cross-boundary channels are double-buffered.** Events *"are added to a
   double buffered queue and kept for at least two frames to ensure any systems
   that were processed out of order … will receive the event."*

**What changes here.**

- **Adopted: ambiguity detection for the manifest.** My constraint rows (`11 §5`)
  are hand-written, which means they cover the interactions I thought of. Bevy's
  lesson is that the valuable half is *automatic*: from each member's declared
  read/write coordinates, compute every pair that touches a common coordinate
  with **no declared ordering and no constraint row**, and report it. This is the
  difference between "cross-joint interactions are explicit" (a claim about
  discipline) and "undeclared interactions are detected" (a property of the
  build). It is also the enforcement mechanism my Law D was missing: declared
  reads are *delivered*, and undeclared *interactions* are *reported*.

- **Adopted: carried-premise mutations are deferred commands.** `05`'s
  `Carried` objects (pins, commitments, roles, attention) should be mutated
  through a queue applied at declared sync points — the emission barrier and
  `advance` — never mid-slice. That is exactly the shape of the bug class the
  TIME lens calls smuggling, and ECS solved it with a barrier rather than with
  care.

- **Confirmed, and generalised: the two-turn buffer.** The pin ledger already
  buffers events that arrive for a turn it has not begun (`ahead`, with its
  own note about the turn-boundary gap). Bevy's double-buffered events say this
  is not a local trick but the general shape for every cross-boundary channel;
  it should be the default for the observation record and the operator channel
  too.

---

## C. Algebraic effects (Koka, Eff, OCaml 5) — the answer to "do handlers give the laws for free" is **no**

**What it does.** Operations are declared as an effect signature; a *handler*
supplies their interpretation; effect rows in the type say which effects a
function may perform. It is a clean separation of *what may happen* from *what
it means* — which is exactly `primitive` versus `member params` in the registry.

**The hard lessons.**

1. **Handler composition is order-dependent, and the order is the semantics.**
   Koka's own discussion: *"combining handlers creates different results based on
   which handler is written first."* Effect rows are order-irrelevant only for
   *distinct* operations; duplicate labels are ordered.
2. **Correct composition needs derived side conditions.** The fusion work is
   explicit: *"it is well known that different orders of composing handlers can
   lead to drastically different semantics. Determining the correct order of
   composition is a non-trivial task"*, and the contribution is *"a systematic
   way of deriving sufficient conditions on handlers for their composite to
   correctly handle combinations."*
3. **Static, lexically-resolved handlers are predictable; dynamic lookup is
   flexible and less predictable.**

**What changes here.**

- **The direct answer to the research question: handler composition does not
  give my joint laws for free.** It gives the *plumbing* (typed operations,
  swappable interpretation, no flag threading) and leaves the *hard part*
  exactly where my design already puts it: the composition law per joint IS the
  "sufficient condition on handlers for their composite to be correct". That is
  a useful negative result — it means the laws are not overhead I could design
  away by adopting a fancier substrate.

- **`spend / observe / advance` is a good operation set, and worth writing as
  one.** ECONOMY's two purchase columns are two operations over one budget
  handler; `advance` is the boundary at which the handler's state is
  transported. Writing them as an explicit operation vocabulary (rather than as
  method calls on a scheduler object) buys the property Koka advertises: a
  function's *type* says which of them it may perform — so a comparator that
  cannot spend is statically prevented from spending.

- **Static beats dynamic here, which supports Law S.** Koka's finding that
  lexical handler lookup is the predictable regime is the same conclusion Law S
  reaches from soundness: a fixed manifest with `fixed`/`composed` choices is
  the predictable core, and dynamic selection is admitted only where the
  mathematics allows.

---

## D. Hydra / gin-config — the governance failures of "extends + overrides", named

My roster-as-diff-expression (`{extends: shipped, "value/terms": …}`) is
Hydra's defaults list. Its failure modes at scale are documented, and they are
not small.

| documented failure | what it looks like | countermeasure adopted here |
|---|---|---|
| *"YAML can reach around across the config tree (`${…}` paths), creating hidden dependencies that are hard to track and easy to break during restructuring"* | interpolation between config nodes | **No interpolation, ever.** `normalise(bot)` produces a **flat total map**; no joint's value may reference another's. Cross-joint relationships are `JointConstraint` rows (data, checked), never string references |
| *"interpolations/resolvers become a small, implicit programming layer"* | resolver functions in code, referenced from config | **Members are the only code.** A config value is data or a member id; there is no expression language |
| *"no clear scoping rules a reader can rely on; values can silently depend on distant bindings"* (gin) | spooky action at a distance | totality plus flatness: every joint's binding is visible in the normalised bot |
| composition order is subtle — Hydra needed `_self_` in the defaults list to say whether the schema overrides the config or the reverse, and shipped a migration warning about it | the same files compose to different results | **Canonical order defined once** in `normalise`, and the *artifact is the normalised bot* — the thing hashed, diffed and stamped is the composed result, not the expression |
| *"no type checking at the config boundary; mistakes show up late"* | typos become defaults | the per-joint `Codec` (already in the design), plus `botConfigFromJson`'s existing refuse-unknown-key discipline generalised |
| *"go to definition is weak: the config references `@…()` but doesn't tell you where the function lives"* | refactors break configs indirectly | member ids resolve to code symbols through the manifest, and the reachability law makes an id nothing implements a build failure |
| *"the command is not a single source of truth for the experiment"* | script + config + overrides | the arm address `⟨codeRef, botId, seat⟩` is the single source of truth |

The pattern across all seven: **every escape hatch that makes configuration
more expressive (interpolation, resolvers, implicit scope) converts a data
problem into an untyped programming problem.** My design's answer is that
expressiveness lives in *members* (typed, addressed, measured) and never in the
config language. This is worth stating as a law because it is the temptation
that will arrive the first time a roster file wants "the same value as that
other joint":

> **Law N (no config language).** The bot value is data: literals, member ids,
> and the four `Choice` forms. No interpolation, no expressions, no references
> between joints. Anything that wants to compute belongs in a member.

---

## E. UCI options and MLflow/DVC — the operator surface and the experiment ledger

**UCI.** An engine *emits its own knob schema* at handshake: `option name <N>
type check|spin|combo|button|string [default …] [min …] [max …] [var …]`, and
the GUI renders a menu from it. Stockfish's `Tune` framework *"automates the
creation of UCI options for internal engine parameters to facilitate automated
tuning sessions via Fishtest"* — the **same declaration** serves the human dial
and the automated sweep. And `UCI_LimitStrength` / `UCI_Elo` are a *derived*
dial over internal parameters: one legible control that reparameterises many.

> **Adopted.** The manifest **generates the operator knob schema**: each dial is
> a bounded reparameterisation of a seated member's params, typed
> (`check`/`spin`/`combo`), with default and range, emitted by the bot rather
> than hardcoded in a UI. Three properties fall out, and they are exactly the
> three the DoF synthesis asked for: the dial surface is a strict subset of
> config space; every excursion is a config point (a new `botId`); and the same
> declaration drives the sweep generator. Thirty years of engine practice says
> this is the right shape, and it costs one generator.

**MLflow vs DVC.** The community's own split: *"DVC answers 'which exact data
and code produced this?' while MLflow answers 'what did we try and which version
is approved?'"*, and DVC's stage cache re-runs only stages whose inputs changed.
The known pain is joining the two — linking a run to the commit that produced it
(the recurring "commit before or after the run" problem).

> **Adopted.** Keep the two roles separate, as they are today: the kit is
> DVC-shaped (content-addressed boards and configs, re-run on input change), the
> validation ledger is MLflow-shaped (what we tried, what is validated). The
> join that their ecosystem struggles with is solved by construction here,
> because the arm address **contains** the code ref: `⟨codeRef, botId, seat⟩` is
> both the cache key and the ledger key.

**And one bug report that is worth the whole search.** DVC #11079: a parameter
named `size` or `nfiles` was **excluded from the stage cache hash**, so changing
it did not re-run the stage — *"The failure is silent, which is what makes it
nasty — the stage reports as cached and the outputs look valid."* That is our
`depth-ran.js` defaulting-to-zero, in a mature tool, in 2026.

> **Confirms a rule already in the design and raises its priority.** The
> fingerprint must be **total over the params tree** — `entryFingerprint` walks
> every own key deliberately ("Deliberately NOT a field list") — and any
> exclusion is a silent-staleness bug. Add the falsifier: a test that mutates
> *each* param of *each* member in turn and asserts the fingerprint moves.

---

## Summary — six changes, three of them corrections

| # | change | source | status |
|---|---|---|---|
| 1 | `behaviourId` beside `botId` — output-addressed equivalence, early cutoff for measurement reuse | Nix | **correction** (input-addressing alone causes measurement invalidation we cannot afford) |
| 2 | self-reference ban in fit provenance, with an acyclicity check | Nix RFC 62 | new |
| 3 | automatic ambiguity detection over declared coordinates, beside hand-written constraint rows | Bevy | **correction** (my constraints only cover interactions I thought of) |
| 4 | carried-premise mutations as deferred commands applied at sync points | Bevy | new |
| 5 | Law N: no config language — expressiveness lives in members | Hydra / gin | **correction** (my `extends` grammar was one step from an expression language) |
| 6 | the manifest generates a typed operator knob schema the bot emits | UCI / Stockfish Tune | new |

And one negative result worth recording: **algebraic effects would not give the
joint laws for free** — order-dependence is the known hard part of handler
composition, and the per-joint law is precisely the side condition that has to be
supplied either way.
