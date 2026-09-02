# OPERATOR-SIGNALS lens — the bot→human surface (ruling 51, OUT direction)

Mandate: design a flexible API presenting what the bot knows about the
strategy landscape to human operators — a wide range of engine-generated
signal types, intelligently aggregated. This is the OUT half of the Centaur
surface; the IN half (realtime guidance: drives, preferences, goto/near) is
the `design/operator-guidance` lens. The two share the attention budget and
one vocabulary; frictions between them are named, not smoothed over.

Nothing here is final (ruling 50). Every claim carries its source; every
fitted or measured number cited from a sibling lens keeps that lens's
provenance caveats (ruling 49).

## Reading order

| doc | what it answers |
|---|---|
| `00-SIGNAL-INVENTORY.md` | what signals the engine already generates, per lens, with status — the inventory existed; nobody had unified its surface |
| `01-TYPE-SYSTEM.md` | the base types the whole range composes from: **four shapes, two operators, two roles** |
| `02-AGGREGATION.md` | the aggregation algebra, and which folds destroy the causal vocabulary (the flows law's teeth) |
| `03-API.md` | the versioned wire surface: frames, per-team view docs, the attention budget as a first-class parameter, priority under the obligation law, push/pull/turn-boundary cadence |
| `04-MISMATCHES-AND-OPEN-QUESTIONS.md` | where sibling lenses' objects resist this surface, and what is unresolved |
| `05-IN-OUT-HANDSHAKE.md` | the seam with `design/operator-guidance`: the echo theorem (PORT determines echo shape), the frustration composite, ask↔utterance closure, the no-mix law |
| `06-PRIOR-ART-SURFACES.md` | UCI, KataGo, ISA-18.2/EEMUA-191, solver explorers — validations and the six alarm-hygiene amendments |
| `07-WORKED-FRAME.md` | the schema exercised on a real probe board, three moments (revised to search doc-09 v2) |
| `08-THE-SECOND-SCALE.md` | the landscape OF strategies: same shapes at the per-experiment scale; three currencies, zero exchange rates; the owner's decision queue as the ask surface |
| `09-REFUTATION-AND-AUTHORITY.md` | refutation-led presentation and the authority-collapse ask (the machine's own leverage map) |
| `10-SELF-RED-TEAM.md` | nine attacks on this design; five amendments; the what-if hole and `signals.quote` |
| `11-O0-RETENTION-SPEC.md` | the unlock increment specified against the real code sites (`better()`, the B2 loop, `prunedLedger`, the term vectors), with cost gates and falsifiers |
| `12-OVERRIDE-LEDGER.md` | the surface measuring its own distortion: intervention join keys, counterfactual anchors, the credit-assignment refusal, owner-scale-first custody |
| `contracts.sketch.ts` | the whole wire in one builder-facing file |
| `SYNTHESIS.md` | the standalone summary (start here for the whole argument) |

## Inputs (branch @ tip, at time of writing)

- `design/search-theory` @ 10e47ed — docs 05 (undominated option set, §2.4/2.4½),
  09 (restrictedGap), 10 (candidate lifecycle, EmissionWindow)
- `design/belief-fog` @ 727c11a — 04-SYNTHESIS ((S,w), clouds, reappearance
  oracle, postures), 01 (per-team view documents)
- `design/value-evaluation` @ 16d7952 — SYNTHESIS (per-unit flows, terminal
  boundary, contrastive foils)
- `design/time-interruption` @ 92fa18e — time-SYNTHESIS (CPP curves,
  hypothesis state, EmissionWindow, conformance)
- `design/joints-composition` @ c7c4e01 — 07-SYNTHESIS (ADVICE kind, Law V,
  two currencies), 27 (attention budget precedent)
- `design/prior-art` @ b56238f — 10 (Miller/Horvitz: contrastive, selected,
  causal, social; C31–C33, M27–M29), 19/29 (R-4, the one index)
- Snek Centaur Platform (local clone, read-only context): `openspec/changes/
  migrate-decision-transparency`, `migrate-live-game-observation`,
  `migrate-operator-control` — the product surface this API must be the
  natural evolution of

## Standing laws this lens is bound by

1. **Flows, never aggregates** (value lens + prior-art C31): the surface is
   built on per-unit flow attributions; flows are not summed before caching
   or the causal content dies.
2. **Complete internally, selected externally** (M27): provenance apparatus
   exhaustive; presentation ruthlessly selected — one or two causes, the
   deciding rung, the foil. The surface must not inherit the refusal law's
   exhaustiveness.
3. **ADVICE is one-way** (Law V): sink = operator surface; no staged-plan
   joint may read it.
4. **Two currencies, no exchange rate** (ECONOMY law): operator attention is
   non-fungible against milliseconds; the scheduler may never spend the
   human.
5. **Humans always win** (obligation law): the bottom element of every
   priority meet on this surface is operator-initiated.
