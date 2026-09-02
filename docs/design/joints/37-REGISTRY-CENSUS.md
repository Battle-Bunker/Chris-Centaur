# The registry half of the census — five sockets, a resolved arity of one

Cycle 15, written short because the programme paused mid-cycle. `36` counted
the config space. This counts the other surface my lens owns: **the registry**.
Every number below was produced by executing against `ALL_ENTRIES` and the
three slates, not by reading.

---

## 1. What the registry holds

```
ALL_ENTRIES = 16      seated in some slate = 13

  slot move-selector        entries= 1  seated= 1   varies across slates = false
  slot evaluator-selector   entries= 1  seated= 1   varies across slates = false
  slot evaluator            entries=12  seated= 9   varies across slates = TRUE
  slot aggregator           entries= 1  seated= 1   varies across slates = false
  slot scheduler            entries= 1  seated= 1   varies across slates = false

  NEVER SEATED: eval/legacy-material@1,
                eval/legacy-territory-slider@1,
                eval/legacy-territory-slider-royal@1
```

**Four of the five sockets hold exactly one entry and differ in no slate.**

## 2. The resolved arity is one

Compose that with `36 §3.1`: `slate` is set in **zero** specs and appears
nowhere in the kit. So `LEGACY_SLATE` is the only slate that has ever resolved
in a measured game, and `LEGACY_SLATE` names **one** evaluator entry.

> Five sockets, sixteen entries, three slates — and in every measured game the
> programme has ever run, the registry resolved to one slate naming one entry
> per socket, none of which has ever differed from any other run's.

The registry's selection mechanism has a **measured arity of one**. That is not
an argument that it is worthless: it is the honest statement of what it has so
far been observed to do, and the gap between its declared arity and its
measured one is the same gap `36` measured in the config space (6 of 41),
appearing a second time in a second surface.

## 3. The two channels partition the evaluator entries

The three never-seated entries are not leftovers. They are exactly the entries
reachable through **the other evaluator channel** — the harness's base-bot
names, which resolve to `TeamDecisionOptions.evaluate`:

| channel | how a spec varies it | entries it reaches | varied in specs? |
|---|---|---|---|
| slate (`BotConfig.slate` → registry) | `bot={"slate":"potion-aware"}` | the 13 seated entries | **never** |
| base bot (`bots: [...]` → `options.evaluate`) | `bots: ["lobster-material", "lobster-slider"]` | the 3 never-seated entries | **in every spec** |

`bots.ts` states it outright for the slider profile: *"Nothing in production
selects this profile: `TeamDecisionOptions.evaluate` is the ONLY seam, which is
why the arm exists here and nowhere else."*

So the evaluator choice — the one socket that has any alternatives at all — is
addressed by **two mechanisms that partition its members between them**. The
registry seats thirteen entries no experiment has ever selected; the harness
selects three entries no slate seats.

## 4. The repair composes them, and the composition has never run

Cycle 2 found these two channels as live alternatives
(`this.options.evaluate ?? evaluatorForSlate(...)`), and the repair since
landed: the profile is the **base**, the slate's advisory lineup is **overlaid**
on it, and a base that cannot carry a lineup is a refusal rather than a silent
drop. That is the right law, and it is well argued in place.

The census adds the fact the repair cannot supply about itself: **the composed
path has never executed in a measured game.** Overlaying requires a slate with
an advisory entry, which requires `slate` to be set, which no spec does. Every
measured decision has taken `advisory.length === 0 → return base`, the identity
branch.

This is the third instance in three cycles of one shape — a mechanism that is
reachable, tested, correct as far as anyone can tell, and **never engaged** —
after the four reduction/ratchet mechanisms (0 in 192 games) and `colourBound`
(no bishop in any spec). It is also the most instructive of the three, because
here the unengaged path is a *repair*: its correctness rests on a branch that
no measurement exercises, so the defect it fixed could recur under a different
spelling without any measurement noticing.

One further caution, stated as a question rather than a claim: the repair's own
comment says *"every live game a `potion-aware` arm ever played was played by
the SHIPPED evaluator"*. The census finds no spec that ever set a slate, so
either those arms were run outside the recorded corpus, or the sentence
describes a hazard caught before it produced a number. Which one it is matters
for whether any published potion figure needs re-reading, and I could not settle
it from the corpus.

## 5. The design consequence — and it binds my own manifest

> **A socket with one member is not a joint. It is a name for a call.**

Declaring a socket costs a registry, an id scheme, a params fingerprint, a
resolve step and a stamp field. It buys nothing until a second member exists.
Four of five sockets here pay that cost against no benefit, and the pattern that
produced them — declare the joint now, fill it later — is the same pattern that
produced 68% unexercised config coordinates. Declaring a degree of freedom is
not the same act as opening one, and the programme has repeatedly been charged
for the first while believing it bought the second.

The rule this implies is uncomfortable for my own design, which proposes a
manifest with six kinds, and several rows that have exactly one member today.
So the rule has to be drawn precisely enough to bind me too, and the honest
line is not "never declare early" but a distinction between two costs:

- **A row in a table is cheap.** It is data; a kind with one member costs one
  row and makes the one member's premises explicit. Writing it in advance is
  fine, and `36 §4.1`'s self-retiring waiver is what keeps it from becoming
  permanent furniture.
- **A resolution mechanism is not cheap.** An id scheme, a fingerprint, a
  resolve step, a stamp field and a second addressing channel are real
  structure, and they should be built **when the second member is written, not
  before**. Until then the call site names the function.

Applied to this design: the manifest may carry a row for a kind with one
member; it may **not** carry a resolver for one. Applied to the tree as it
stands: four sockets should collapse to their single functions, and the
evaluator socket — the only one with genuine alternatives — should be the one
that keeps the machinery, with the harness's base-bot channel folded into it
rather than left beside it.

## 6. Where this stopped

The programme paused here. The unfinished thread, recorded so it is not lost:
the two channels appear to have **different identity discipline** — the slate
channel names entries as `EntryId` with an `@version` and a params fingerprint,
while the base-bot channel names an evaluator with a bare string resolved
through `evaluatorNamed(...)`. If that holds, the versioning discipline landed
on the channel nobody varies and the channel every experiment varies has a name
with no hash, which is Law I inverted. **I did not verify what the mechanism
stamp records for the base-bot channel**, so this is an open question and not a
finding.
