# PRIOR ART 5 — configuration, addressing and composition systems

Domain: the systems-engineering literature and practice behind the COMPOSITION
lens's four moves — content addressing (Nix), declared-access scheduling (ECS),
effect handlers (the socket pattern), hierarchical config composition (Hydra) —
plus the one paper that unifies this domain with domain 6.

Read against `07-SYNTHESIS.md` moves 2–4 (joints as a data manifest, bot as a
total addressed map, reachability law), `04-ADDRESSING.md`, and risk 1 ("premise
ids could churn").

---

## 5.1 Load-bearing sources

**S13. Mokhov, Mitchell & Peyton Jones, "Build systems à la carte" (ICFP 2018;
JFP 2020 extended).** The unifying taxonomy: every build/incremental system is a
choice of **scheduler** (topological / restarting / suspending) × **rebuild
strategy** (dirty bit / verifying trace / constructive trace / **deep**
constructive trace), and the properties — minimality, early cutoff, dynamic
dependencies, cloud sharing — follow from that choice. Make and Excel are dirty
bit; Ninja is a verifying trace; Bazel and CloudBuild are constructive traces;
**Buck and Nix are deep constructive traces**.

**S14. NixOS RFC 062, *Content-addressed paths*, plus the Tweag implementation
series.** Why input-addressing over-invalidates, what early cutoff is, the
"resolved derivation" mechanism, and the admitted costs.

**S15. Bevy ECS scheduling and its ambiguity detector** (bevyengine/bevy issues
#1312, #1466, #1868, #11796; `bevy::ecs::system` docs). What actually happens
when you derive a schedule from declared component access.

Secondary: algebraic effect handlers as typed dependency injection (Leijen et
al.; the "capability-passing style" framing); Hydra's config-group/defaults-list
composition.

---

## 5.2 What the experts decided, and their stated rationale

### (a) The rebuild-strategy taxonomy, and the property our design gives up

S13's central table pairs each rebuild strategy with the properties it can
support. The two facts that matter here:

- **"Verifying traces and other types of traces support dynamic dependencies and
  minimality; furthermore, all traces except for deep traces support the early
  cutoff optimisation."**
- A **verifying trace** records only *hashes* — of the key, of the values of the
  dependencies actually read, and of the result. A **constructive trace**
  additionally stores the resulting value (enabling cloud sharing). A **deep
  constructive trace** stores only the *terminal input keys*, ignoring
  intermediate dependencies — cheap and shareable, but it cannot early-cut.

Early cutoff, in their canonical example: adding a comment to `main.c` changes
`main.c` but not `main.o`, so the rebuild stops there and `main.exe` is not
rebuilt.

### (b) Nix RFC 062: input-addressing forces rebuilds that change nothing

The motivation, in the RFC's terms: a Nix output path is derived from the
derivation's **inputs**, so any change to a dependency forces rebuilds of all
dependents *even when the built artifact is byte-identical*. Content-addressed
derivations compute the path from the **output content**, which lets Nix
recognise that a downstream component has not actually changed. The mechanism is
the **resolved derivation**: before building, replace every symbolic reference to
an input derivation with the actual store path of its realisation, so two
logically-different derivations that would produce identical results become the
same key.

Admitted costs, also from the RFC: it "makes the Nix model more complicated than
it currently is", weakens some enforceable safety restrictions, and breaks tools
that assume a `.drv`'s output path is an on-disk path. And — the honest one —
there are cases where enabling CA leads to *more* rebuilds than not having it.

### (c) ECS: declared access buys safety, not semantics

Bevy derives its parallel schedule from each system's declared component access:
"if a system mutably accesses data, no other system that reads or writes that
data can run at the same time." Where the relative order of two conflicting
systems is unspecified, that is a **system order ambiguity**, and the engine
ships a detector for it.

Three lessons from their issue tracker, all learned the hard way:

1. **The declaration is deliberately coarse.** Conflicts are detected at the
   component level rather than the archetype-component level, "because
   archetype-component independence can change both at runtime and through small
   code changes." A fine-grained access declaration is *unstable under
   refactoring*, so they chose to over-approximate.
2. **The detector drowns you** — "ambiguity checker emits a lot of warnings with
   default plugins" — which forced a first-class opt-out (`ambiguous_with`) for
   *deliberate* ambiguity.
3. **Declared access underdetermines order.** Safety is derived; correctness of
   ordering still has to be declared separately (`before` / `after`).

### (d) Effect handlers: the socket pattern with a totality guarantee

An effect signature is a set of operations; a **handler is supplied by the
caller**, and the callee invokes operations through a uniform interface without
naming an implementation. Languages with algebraic effects "include an effect
system to reason about which effects a computation uses, **to ensure they are
handled**" — an unhandled effect is a static error. The standard framing is that
this is functional programming's answer to dependency injection, made total.

---

## 5.3 Mapping onto our joint

### AGREES

- **The manifest-generates-everything move is the right one and has precedent.**
  Nix, Bazel and Hydra all derive their codecs, keys and diffs from one
  declaration; the composition lens's "the config codec, the stamp, the manifest
  columns, the diff and the docs table are generated from the manifest, not
  written five times" is standard practice in every system that has survived at
  scale. The finding that "the joint list is enumerated five times" is the exact
  failure those systems exist to prevent.
- **`Choice = fixed | composed | conditional | priced` with a totality
  requirement is the effect-handler design**, and the guarantee it buys is the
  one effect systems buy: an unhandled joint is a *type* error, which is precisely
  what makes `options.slate ?? bot.slate` unrepresentable. Our chief refusal —
  "no generic plugin surface; `Choice` and `compose` are closed forms over a
  fixed manifest" — is the *closed* effect-signature discipline, and it is the
  right one for a system that wants static totality.
- **Declared read-sets driving invalidation is ECS's design**, and it works. The
  caveats below are refinements, not refutations.

### CONTRADICTS — flag loudest

**C16. `botId = structuralIdentity(normalise(bot))` is a deep constructive trace,
which is the one rebuild strategy that provably cannot early-cut.** S13's table
is explicit: deep traces are the exception that loses early cutoff. Two costs,
both of which the program has already paid in other forms:

  1. **Cache and memo over-invalidation.** Every config edit — including one that
     cannot change behaviour, e.g. flipping a member that the seated bot does not
     reach — produces a new `botId`, so every memo namespace keyed on it is cold.
     The composition lens's own risk 1 ("premise ids could churn") is this
     phenomenon, and its proposed remedy (split stable/volatile halves) is a
     *mitigation of the symptom*; the field's remedy is a **different rebuild
     strategy**.
  2. **Two behaviourally identical arms get different addresses**, so an
     experiment cannot recognise a no-op change as a no-op. This is the mirror
     image of the defect B0 was designed to catch: B0 asks "did both arms play
     the bot the manifest says?", and deep-trace addressing cannot answer the
     adjacent question "are these two manifests the same bot?".

  **The fix is Nix's resolved derivation, and it is small.** Address a bot by its
  *reachable closure after normalisation* — resolve each joint's choice to the
  member actually selected, drop everything unreachable, then hash. Two configs
  that differ only in unreachable members resolve to the same address. That is
  content addressing at the config layer, it composes with the reachability law
  already in the design (the closure is already computed for CI), and it turns
  `botDiff` into a diff of *resolved* bots — which is the diff an experiment
  verdict is actually about.

  Note the RFC's honesty requirement: content addressing is not free, and there
  are cases where it causes more work. The design should record the choice, not
  assume it.

**C17. "Invalidation scope falls out of declared read-sets" gives us safety, not
order — and ECS has already paid for learning this.** The time lens's second
foundation change says event scope is *derived* rather than declared. Bevy's
experience says: derived access tells you what *may* conflict; it does not tell
you what *must* happen first, and it produces so many false conflicts that you
need a first-class "deliberately ambiguous" annotation or the check becomes
noise people disable. Three concrete imports:

  - **Add `ambiguous_with` to the declaration record.** Where two citations
    overlap but the design intends them to be order-independent, that intent must
    be recordable, or the refusal law's teeth will be filed down by whoever is
    on call.
  - **Coarsen deliberately and say so.** Bevy declines archetype-level precision
    *because fine-grained sets are unstable under small code changes.* Our
    citation records name (coords, horizon, frame, weightId, evalVersion,
    hypothesisId) — a six-field key whose stability under refactoring is
    unproven. Expect churn; prefer the coarser field set that survives edits.
  - **Ordering constraints still have to be declared.** The five readers of the
    declaration record (comparison refusal, invalidation, transport, dial
    demotion, miner refuse-unknown) are all *access* consumers. Nothing in the
    design derives or checks *order*, and the adjudication-rule-three-times and
    two-staleness-conventions defects are both order bugs.

**C18. The reachability law is necessary but insufficient without a
resolution step.** "Every member must be reachable from a bot in the checked-in
roster; CI asserts closure equals exports" fixes *dead* members. It does not fix
the adjacent problem, which is what actually bit us: a member that is reachable
from *some* roster bot but not from *the bot under test*, whose presence still
perturbs the address and the diff. Resolution (C16) is what separates "exists in
the manifest" from "is in this bot's closure", and the reachability law should be
stated over the *resolved* closure to get both properties from one mechanism.

### COVERS A CASE WE MISSED

**M14. Verifying traces are what we actually want, and they are cheap.** S13:
verifying traces support minimality, dynamic dependencies **and** early cutoff.
The recipe: when a computation runs, record the hashes of the dependency *values
it actually read* and the hash of its result; on the next run, re-read those
dependencies, hash them, and skip if unchanged. Our declaration record already
names the reads — it records *which* coordinates were read but not *what they
were*. Adding the value hash upgrades the design from dirty-bit semantics (which
is what a read-set alone gives you) to verifying-trace semantics, and that single
change is what makes citation-scoped commit invalidation actually cut early
rather than merely cut narrowly. This is a direct, concrete improvement to
`feature/commit-scope`.

**M15. Dynamic dependencies are a first-class property, and our design needs
them.** S13 separates static from dynamic dependency systems and notes that
traces (unlike dirty bits) support the dynamic case. Our reads are dynamic by
nature — which coordinates a spend touches depends on what it finds — so any
design that requires the read-set to be declared *up front* is in the static
camp and will either over-declare or be wrong. Record reads as they happen;
do not require them to be predicted.

**M16. Hydra's lesson: composition of configs needs a defaults *list*, not a
merge.** Hydra's config-group + defaults-list model exists because unordered
deep-merge of config trees is ambiguous exactly where two groups touch the same
key — which is `options.slate ?? bot.slate` generalised. The transferable rule:
composition of configuration must be an **ordered, explicit sequence of named
groups**, so that "which layer won" is readable from the config itself rather
than from merge semantics. Our `Choice` type gets this right for selection;
the *roster/arm/seat/excursion* layering (four places a bot config can come from
in a live game) does not obviously have it, and that layering is where the
"arm's config merged into every seat" defect lived.

**M17. Effect systems give us the name for the D2 socket's real requirement.**
The weight supplier is being designed as an interface with members. The effect-
handler framing adds a property we should want and have not asked for: the
handler is chosen **by the caller's context**, dynamically, and the type system
proves every use is handled. In LOBSTER terms: the reduction sites do not name a
supplier; the *decision context* installs one, and a decision context with no
installed supplier fails to type-check rather than falling back to a default.
That is a stronger and cheaper guarantee than "every consumer calls the same
function", and it directly prevents the `ε = 1.0 chosen by nobody` defect from
recurring.

---

## 5.4 Verdicts the lens agents can act on

- **COMPOSITION (two concrete changes):**
  1. Address bots by their **resolved** closure (Nix's resolved-derivation move),
     not by the raw normalised config. Today's `botId` is a deep constructive
     trace, the one rebuild strategy that cannot early-cut; resolving first buys
     early cutoff, makes no-op config edits recognisable as no-ops, and states
     the reachability law over the right object. Record the cost too — the RFC is
     explicit that CA is not free.
  2. Upgrade the declaration record from a *read-set* to a **verifying trace**:
     record the hash of each value read plus the hash of the result. Read-sets
     alone give dirty-bit semantics; hashes give minimality + early cutoff, which
     is what `feature/commit-scope` is trying to buy.
- **TIME:** derived invalidation scope is safety, not order. Import ECS's three
  hard-won lessons: a first-class deliberate-ambiguity annotation, deliberate
  coarsening of the key (fine-grained keys are unstable under refactoring), and
  the acceptance that *ordering must still be declared*. Every one of our
  recorded order defects (adjudication written three times, two staleness
  conventions) is invisible to an access-derived check.
- **BELIEF:** the weight-supplier socket wants effect-handler semantics — handler
  installed by the decision context, unhandled = type error — rather than a
  function every consumer must remember to call. That is the structural fix for
  "the bot's risk posture is ε = 1.0 chosen by nobody".
- **ALL:** the config layering (roster → arm → seat → operator excursion) needs
  Hydra's ordered defaults-list discipline, so "which layer won" is readable from
  the config rather than from merge semantics.
