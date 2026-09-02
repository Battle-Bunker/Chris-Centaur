# 00 — The signal inventory, unified

The mandate's premise is correct: the inventory largely exists. Every lens
independently designed instruments whose natural consumer is a human
operator, and none of them named the surface. This document is the union,
with per-signal status. STATUS legend:

- **live** — computed in the shipped engine today (possibly discarded)
- **discarded** — computed today and thrown away (retention is the whole cost)
- **instrumented** — specified with an emit list by its lens, not yet built
- **needs-member** — requires a designed-but-unseated member (named)
- **future** — depends on a build-order step not yet started

Columns: the signal, its generator, source (lens/doc), status, and the shape
it lands on in `01-TYPE-SYSTEM.md`.

## 1. Option-landscape signals (what could be played)

| signal | generator | source | status | shape |
|---|---|---|---|---|
| floor-undominated option set — "four moves still worth considering; ninety ms later, two" | bank floors over the priced set; natively the maximality REDUCTION member | search 05 §2.4, prior-art R-4 | **needs-member** (arity-SET); reconstructable today from bank rows | SET |
| dominance conditions per option — "right if the queen's reply is blocked; wrong if she clears the ray" | maximality / α-vector dominance regions; today: which witness minimised the row | search 05, prior-art 10 §C32 | needs-member; witness-attribution live | SET |
| contrastive foil per decision — (runner-up, deciding rung, margin) for top-k | `better()` computes and discards it on every decision | prior-art 10 (C32: "one column, three consumers") | **discarded** | SET (projection) |
| restricted payoff matrix + pureDuality | B2 rung resolves every priced plan × every witness; rows reduced to min on the spot | search 05 §2.4½, search 09 v2 | **discarded** (retention = one number/cell, zero extra resolutions) | SET (drill) |
| refutation records — (plan, refuting reply); on contacting boards most plans carry one | B1/B3 refuting columns (search 09 v2: one column often refutes 15/17) | search 09 v2, doc 09 §2 | live (via v2's probe path); retention needed | SET (`refutedBy`) |
| dominant-column threat — one plan-independent punishing reply | per-column refutation attribution (#argCol = 1) | search 09 v2 §4.3, doc 09 §2 | instrumented | SET aggregate → threat anchor |
| deciding-rung grade + authority-collapse — the machine choosing by tie key = its knowledge ran out; the human's call has maximum leverage there | `better()` deciding-rung telemetry, graded | doc 09 §3 | **discarded** (same column as the foil) | edge(SET), role=ask when collapsed |
| candidate-ledger dispositions — what was set aside, at which stage, recoverable/closed/unpriced | LifecycleLedger (L0) | search 10 | instrumented (L0 = types only, byte-identical) | SET (drill) |
| sacrifice warrant — an option the bot may not play but a pin makes playable | admission wall + matchPin (already resolves against the pruned ledger) | joints 07 §4.16, B5 | needs-member (ADVICE kind, owner decision pending) | SET member, role=ask |
| commit-timing advice — early commit as credible commitment / clock denial | commit status world-readable; nothing computes the advice | joints 07 §4.17 | needs-member (ADVICE) | SET member |

## 2. Causal-attribution signals (why it is valued)

| signal | generator | source | status | shape |
|---|---|---|---|---|
| per-unit weight-account flows — (unit, channel, side, rate, horizon), event-anchored | the value fold's pre-fold records; the fold is the differential of the score, so flows telescope to it exactly (interior) | value SYNTHESIS §1–2 | live inside evaluation; **not retained** pre-fold (C14/R-2) | FLOW |
| terminal-boundary attribution — what the settling rule does to the position; turn-limit proximity | `model/terminal@1` from exported `adjudicate()` | value SYNTHESIS M1, joints B4t | needs-member | FLOW (boundary channel) |
| (K, W, p) share state — the live conversion rate between weight and score, per team | formed once per turn (value M2) | value SYNTHESIS §2 | instrumented | FLOW (context) |
| inert-weight explanation — why a configured weight is not moving decisions (six causes) | M3 point-of-comparison spread instrument, by unit class | joints 07 §4.6, value M3 | instrumented | FLOW (meta) — experiment scale, not per-decision |

## 3. Uncertainty signals (what is not known, and what would collapse it)

| signal | generator | source | status | shape |
|---|---|---|---|---|
| per-enemy support width — the (S,w) support per hidden coordinate; possibility clouds as marginals | cloud engine; (S,w) object | fog 04 §1–2 | live (clouds); object naming in progress | WIDTH |
| removal tag per width — deduce (C2) / observe (act to reveal) / **ask the operator** / nothing-this-turn | reducibility tag on the hold record | fog 04 §3, prior-art 10 C33 | instrumented (enum + lever-menu read) | WIDTH (the tag is the "what-would-collapse-it") |
| posture state + shifts (incl. FOGGED as legitimate production state) | posture governor | fog 04 §4.1 | live | WIDTH → edge |
| reappearance-oracle violation — a reveal landed outside the predicted cloud | thrown production soundness audit | fog 04 §4.4 | instrumented | edge(HELD) — a soundness commitment broke |
| gift detector / opponent-model surprise | weight-supplier vs observed enemy action (log-loss harness reads Turn.moves at zero match cost) | fog build step 3 | instrumented | edge(WIDTH) |
| appetite dial state (the one operator risk control that survived: utility curvature; ε is fitted, not a dial) | ε-contamination read at the root | fog 04 §7.2 | instrumented | HELD (an operator-authored setting, echoed back) |

## 4. Resource signals (what more thinking buys)

| signal | generator | source | status | shape |
|---|---|---|---|---|
| gapCurve — per-emission (atQuanta, maxGap) | ratchet already enforces the axis; nothing plots it | time SYNTHESIS build 1, search 05 S0¾ | instrumented (one field) | trace(SET) |
| option-set shrinkage curve — cardinality over quanta | native under maximality; the legible progress meter | search 05 §2.4(b) | needs-member | trace(SET) |
| CPP — Pr(quality \| quanta, premise-coords); saturated vs climbing verdict per board family | compiled offline from replay archive; first curves exist (snake6 saturates ≤500ms; queen climbs through top rung) | time SYNTHESIS §2–3 | live (v0 compiled) | trace, fitted member with provenance |
| (family, cost, ΔmaxGap) per applied lever — measured value-per-cost of thinking | one subtraction per slice | search 05 S0⅞ | instrumented | trace (drill) |
| EmissionWindow state — canEmit, threshold, msToNextWrite | kernel computes per slice (L2) | search 10 §4 | instrumented | context on every frame (freshness) |
| hypothesis market state — what ponder is preparing for, at what market weight | worldline hypothesis table | time SYNTHESIS §1, build 3 | future | HELD + trace |

## 5. Commitment signals (what is currently held, and what invalidates it)

| signal | generator | source | status | shape |
|---|---|---|---|---|
| operator pins, echoed with health — age, staleness, floor conflicts ("your pin is 3 turns old and now crosses a refusal") | matchPin resolves against the pruned ledger today; nothing reports back | joints 07 §4.16 | live (pin), **no echo exists** | HELD (operator-authored) |
| bot-authored carried premises — revalidate every turn or die | worldline revalidation law | time SYNTHESIS build 3 | future | HELD |
| commitments (C2/C4) — may change order and spend, never a bound; re-justify when the reduction binding changes | commitment machinery (B6) | joints 07 §3 | future | HELD |
| staged-plan incumbent + its witness — the current answer and what certifies it | kernel incumbent (the interruptible type) | time SYNTHESIS §1 | live | HELD (the degenerate always-present one) |

## 6. Conformance signals (what the human's actions did — the OUT echo of every IN affordance)

| signal | generator | source | status | shape |
|---|---|---|---|---|
| commit/intervention conformance — received / incorporated within ≤1 tranche / overridden by a floor | citation-scoped invalidation + conformance stream | time SYNTHESIS build 4 | future (increment 4 starts the telemetry — no operator event has ever fired in a harness game) | edge(HELD) |
| guidance progress — e.g. the near/goto stat's current per-move value, visible while it has no completion event | waypoint stat already computed per candidate | platform (goto/near), IN-lens shared item | live platform-side | FLOW (the guidance term is a flow channel like any other) |
| ask-status — an issued ask's lifecycle (open, answered, expired-unanswered, mooted by events) | this surface | new | — | HELD (role=ask echo) |
| guidance-frustration — why the bot is not doing what was asked: never-priced / outvoted / beaten-at-reduction, with the remedy per cause | ledger dispositions + FLOW contrast + the foil, joined on the utterance id | guidance lens M5, doc 05 §2 | instrumented (all three reads exist in this design) | composite bundle, edge-triggered |
| per-port echoes — one echo generator per guidance port (value-field→FLOW channel, attention→funded trace, support-demand→floor-delta edge, license→exercise edges, ...) | doc 05 §1 echo theorem | doc 05 | designed | port-determined |

Section 6 is the load-bearing coordination point with `design/operator-guidance`:
**every IN affordance owes an OUT echo**, else Horvitz's minimise-the-cost-of-
poor-guesses principle is violated and the operator flies blind on whether
their guidance did anything. The `near` command — continuous, no completion
event — is the exhibit: its echo is a continuous FLOW reading, not an event.

## 7. What the unification shows

1. **Most of the surface is already computed.** Two of the highest-value
   signals (the foil; the restricted matrix) are computed on every decision
   and discarded. The marginal cost of the surface's spine is retention, not
   computation.
2. **The signals sort cleanly into five payload families** — options, flows,
   widths, held-things, and traces/edges of those — which is the type-system
   claim of doc 01.
3. **Nothing here reads back into search** (Law V holds by construction):
   every generator above exists for engine-internal reasons; the surface is
   a reader. The single exception is role=ask, which re-enters through the
   IN surface as an ordinary observable determination — never as a direct
   write into any staged-plan joint.
