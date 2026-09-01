# REFACTORING — the licence to throw legacy structures away

**Status: BINDING. Owner ruling, 2026-09-01. Referenced from `docs/BRANCHING.md`
§0.1. Every agent working in this repo inherits it; you do not need to ask for
it again.**

---

## 1. The licence, in the owner's own words

> **Radical refactoring of architecture is entirely allowed and encouraged and
> legacy structures can and should be thrown away to make room for the new more
> powerful approaches to be implemented more elegantly without being encumbered
> by the need to do awkward backwards compatibility to interfaces and
> dependencies that no longer make sense.**

The ruling was given about a specific structure — the per-unit candidate-move
heuristic analytics table — which the owner described as

> **no longer aligned with the shape of the data our bot (variants) should be
> generating**

and whose machinery was

> **hindering more elegant design choices and acting as a burden of technical
> debt.**

The instruction generalises: that is not a one-off permission slip for one
table, it is the standing disposition for this program's architecture work.

## 2. Deletion over compatibility

When a legacy structure is in the way, **delete it**. Do not:

- leave a deprecated-but-populated field "in case something reads it";
- add a compatibility shim, adapter, or dual-write so an old consumer keeps
  working;
- keep a dead interface alive so a rename can be avoided;
- widen a type with an optional legacy variant rather than removing the variant.

A shim is a promise to a caller that no longer exists. It costs a reader's
attention on every future pass and it is precisely the "encumbrance" the ruling
names.

**Rename freely.** A name that describes what a thing used to be is part of the
debt. The only reason to keep a legacy name is a cost the deletion cannot pay
today — a stored column, a wire contract with a client outside this repo — and
when you keep one for that reason, say so where the name lives.

## 3. What deletion does NOT license

The licence is about *legacy structures*, not about coverage or about systems
that still do work.

1. **Separate systems stay intact.** Before deleting, map who depends on what.
   A consumer that is not the legacy structure — a test, a miner, the sim kit's
   mechanism report, the operator command/waypoint path, the replay viewer's
   board — keeps working. Sever the legacy structure's tendrils out of it; do
   not amputate it along with them.
2. **A system that genuinely needs a signal gets its own.** When a live system
   was reading the legacy structure only because that was where the number
   happened to live, give it a small, purpose-named signal carrying exactly what
   it needs — and nothing else. That is severing, not shimming: the new signal
   has one caller, an honest name, and no display shape.
3. **Coverage is not legacy.** A test asserting real behaviour *through* a
   deleted surface is retargeted at the surface where the fact actually lives
   (make the engine's own record public if that is what it takes), not deleted
   with it. Only assertions about the deleted structure itself go.
4. **Behaviour must not move.** Observability is not strategy. A deletion of
   reporting machinery must leave the bot's decisions byte-identical, and the
   replay/identity gates are how you assert that, not how you hope it.
5. **The lanes still apply.** `docs/BRANCHING.md` decides which branch a change
   lands on and what evidence it owes. A refactor that alters which joints exist,
   how they compose, or what the kernel may conclude is lane (b) — licence or no
   licence.

## 4. Human legibility is being redesigned, later

The per-unit-candidate heuristic table was this program's human-legibility
surface, and it is gone. **A new human-legibility / signalling framework will be
designed once the new architecture settles.** Until that design exists:

- **Do not rebuild the old one.** Not as a smaller table, not as a debug JSON
  blob shaped like the old rows, not as "just a few columns for now".
- **Do not block a refactor on legibility.** Prefer deletion over accumulating
  mess. A big refactor that ends with less signal and a clean shape is the
  outcome the owner asked for; one that ends with the old signal preserved in a
  new mess is not.
- **Do leave the facts reachable.** Keep the engine's own records honest and
  public enough that the future framework has something to read. That is a
  different thing from shipping a display.

## 5. The 2026-09-01 exercise, as the worked example

Deleted end to end, in one change, with no compatibility path:

| what | where |
|---|---|
| the per-candidate breakdown builder | `src/logic/voronoi-strategy.ts` (`buildBreakdown`, and the console breakdown table in `logTurnInfo`) |
| the per-candidate breakdown row schema | `src/logic/decision-logger.ts` (`DecisionLogEntry.moveEvaluations[].breakdown`, `numStates`) |
| the piece breakdown emitter | `src/server/active-game-manager.ts` (`computePieceMoveEvaluations`'s weights/weighted tables) |
| the transport field | `MoveEvaluation.breakdown` / `.numStates` |
| the UI table | `src/web/board-renderer.js` `updateStatsTable`, the "Decision Breakdown" panel and `.stats-table` CSS in `src/web/play-game.html`, and the `analyticsFrozen` state that gated its refresh |

Kept, because they are different systems and were verified as such:

- the **mechanism report** (`src/lobster/telemetry/mechanism.ts`) — never read
  the breakdown; untouched;
- **operator pins / commands** (`src/logic/command-logger.ts`, the intent
  ladder) — untouched;
- the **candidate enumeration** (`move`, `score`, `dest`, `kind`) — the replay
  viewer's board and the operator's click/keyboard steering are built on it;
- the **turn-state Voronoi grids** (`turn_states.territory` /
  `cell_ownership`) — a property of the board, not of a candidate.

Severed rather than amputated: the operator's waypoint re-bias
(`getWaypointBiasedMove`) had been reading four numbers out of the breakdown
blob. It now takes `MoveEvaluation.waypointBias` — five numbers, one caller, no
display shape — per §3.2.
