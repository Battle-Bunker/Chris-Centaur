# The measurement side — the ledger is still keyed on things that no longer exist

Cycle 9 of the COMPOSITION lens. The bot side is specified (`06`, `sketch/`),
the engine side is specified (`19`); this is the third leg, and it is the one
that holds the evidence. Verified against the kit line @ `639416b`:
`tools/learnloop/promotion-ledger.json`, `tools/simworker/{bin,lib}`.

---

## 1. The finding: the unit of account is still the flag

`promotion-ledger.json` carries **fourteen `flags` rows**, each shaped around a
mechanism that was deleted:

```jsonc
{ "flag": "CENTAUR_CLUSTER_SEED",
  "perEngineOption": "TeamDecisionOptions.clusterSeed",
  "shipsDefault": "off",
  "parses": "1|on|true only — anything else is off, with no warning",
  "status": "live-failed",
  "selection": "TODO(teardown-search) — still an environment flag; …" }
```

`flag`, `perEngineOption`, `shipsDefault` and `parses` describe an environment
variable, its per-engine override and its parsing rule. The flags system was
torn out weeks ago; the `selection` field is prose glue holding a schema to a
world that no longer exists.

This is the **fifth enumeration** of the joint list — after `SlotId`,
`BotConfig`, `botConfigFromJson`'s key set and `BotStamp` — and it is the one
that matters most, because it is where the measurements live. The registry
already anticipated the join and deferred it: *"When the ledger's schema gains
its `slot`/`entryId` columns the join runs the other way and this hook is what
it joins on."* It never gained them.

Consequences, all live:

- a verdict is attached to a name that names nothing runnable;
- "which bot produced this number" is answerable only by reading prose;
- arm names have already been renamed once, with a was/is mapping kept by hand;
- and the status ladder (`candidate → probe-passed → live-supported → default`)
  describes a promotion process the owner has since banned in favour of two
  lanes.

---

## 2. Target schema

Three keys, each addressed rather than named:

```jsonc
// a measurement row
{
  "cell":   "<boardHash>",                       // exists today
  "arm":    { "codeRef": "<sha>", "botId": "<hash>", "seat": "s2" },
  "regime": { "budgetMs": 1000, "workers": 1, "turnLimit": 100,
              "observed": { "plansPerDecision": 812, "wallP50": 47 } },
  "behaviourId": "<hash>",                        // early-cutoff key (§4)
  "premise": { "opponents": [...], "frame": "...", "admission": "..." },
  "metric": { "name": "sharePar", "value": 1.021, "n": 48, "halfWidth": 0.35 }
}

// a member row — what replaces a flag row
{
  "member": "value/potion-seek@3",
  "joint":  "value/terms",
  "fit":    "fit/potion-retrodiction@1",          // ruling 49
  "state":  "selectable | merged | validated-at | retired",
  "validatedAt": [ { "cell": "...", "regime": {...}, "rows": [ "..." ] } ],
  "engagement": { "runs": 12, "decisions": 41_233, "parts": { "…": 0 } }
}
```

Two changes of substance beyond the renaming:

1. **"Validated" is a coordinate, not a status** (`08 §1`). `validatedAt` lists
   the premises the evidence ranges over; a bare `validated` cannot be written.
2. **Engagement is per member and per part** (Law M), which is what makes
   "raced live, no effect at this design" — the status batch 2 had to invent —
   expressible rather than improvised.

---

## 3. Where the columns come from, and the oracle that keeps the generator honest

Manifest → generated: the config codec, the stamp, the manifest columns, the
diff, the knob schema, the docs table. The red team's objection stands and this
is where it bites hardest: **when the manifest is wrong, five artifact classes
are wrong in agreement**, and the property that made drift detectable — separate
copies disagreeing — is exactly what generation removes.

> **The independent oracle.** One artifact class is produced by a *different
> path* and compared: the **stamp is rebuilt from the live decision's own
> observations** — which members actually constructed, which primitives actually
> ran, which coordinates were actually read — rather than from the manifest's
> declaration of what should have. A mismatch is a hard error on the run.

That is not a nice-to-have. It is the check that would have caught the single
most expensive defect on record: `potion-aware` **declared** a slate and
**constructed** the shipped evaluator, and every layer that could have noticed
was reading the same declaration. An observation-built stamp disagrees with a
manifest-built stamp on exactly that turn.

---

## 4. Reusing what we already paid for

`behaviourId` (Nix's early cutoff, `14 §A`) is what stops the migration from
invalidating the corpus:

- **Post-teardown rows** (batch 2 onward) ran configured bots, so their `botId`
  is computable from the recorded `botConfig`/`seatConfigs` — and their
  `behaviourId` from a replay of the probe suite against that bundle. Rows
  whose `behaviourId` matches a current bot's **transfer directly**.
- **Pre-teardown rows** (batch 1) ran environment flags. They must **not** be
  given a synthetic `botId`: that would assert an equivalence nobody checked.
  They get an honest legacy address — `legacy-env:<hash of the env set>` — which
  is comparable to itself and to nothing else, exactly as the `--legacy-env`
  escape hatch in `run-pair.js` already treats them.
- **The re-key is a pure function of what the manifests already record**, so it
  is a script, not a re-run. Nothing is re-measured to migrate.

---

## 5. What changes in the kit, tool by tool

| tool | change | gate |
|---|---|---|
| `lib/arm-spec.js` | an arm resolves to `⟨codeRef, botId, seat⟩`; the per-seat isolation rule is unchanged | existing selftest (33/33) green |
| `bin/verify-null.js` | compares **addresses**, replacing the hand-rolled structural comparison of `botConfig` + `seatConfigs` | an A/A pair passes; a pair differing in one member fails |
| `bin/run-pair.js` | prints `botDiff` in the launch banner — the arm's treatment claim, generated | banner names the joints that differ |
| `bin/make-specs.js` | refuses a one-axis arm over a **compensating** constraint pair (`11 §5`), as it already refuses a single arm | a γ-only spec over the γ×ε pair is rejected with the row cited |
| `bin/aggregate.js` | columns generated from the manifest; **refuses** an unknown column instead of defaulting it | the depth-idle regression: a renamed field fails loudly |
| `lib/match.ts` | `placementsOf` calls the engine's `adjudicate`/`sharePar` (`19 §3`) | the mutual-wipe corpus re-adjudicates identically |
| `promotion-ledger.json` | flag rows → member rows; `validatedAt` coordinates; per-part engagement | the re-key script reproduces every existing verdict's numbers unchanged |
| `PROMOTION-STATUS.md` / `VALIDATION-STATUS.md` | rendered from member rows; vocabulary already migrated to validated/merged/selectable | renders with no manual mapping table |

---

## 6. Order

1. **M1 — addresses, no schema change.** `botId`/`behaviourId` stamped by the
   engine (`B0`), recorded per seat in `arm.json` and the manifest, compared by
   `verify-null`. Nothing in the ledger moves. *This is the increment that makes
   the potion-class defect impossible, and it is a day of work.*
2. **M2 — the re-key script.** Historical rows gain addresses (legacy-env where
   honest). Verdicts unchanged; the join becomes possible.
3. **M3 — the ledger schema.** Member rows replace flag rows;
   `validatedAt` replaces `status`-as-a-scalar; per-part engagement lands.
4. **M4 — generated columns + the independent oracle.** Aggregate's columns come
   from the manifest; the observation-built stamp is compared against the
   declaration-built one on every run.
5. **M5 — constraint enforcement at spec time.** `make-specs` refuses one-axis
   arms over compensating pairs.

M1 and M2 are worth doing **whatever happens to the rest of this design**: they
cost little, they invalidate nothing, and they answer a question that has been
unanswerable for the whole programme — *which bot produced this number?*
