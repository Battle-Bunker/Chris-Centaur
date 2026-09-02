# 07 — A worked frame: three moments on the contested-queen board

The schema (docs 01–03), exercised end to end. Board: the search lens's
`contested-queen` probe scenario (09-RESTRICTED-GAP-RESULT @ 10e47ed) —
23 candidate plans, 5 banked witness columns, floor spread 4.0 weight
units, pureDuality 0, four distinct row minima. Real numbers from that
probe are used where they exist; everything else is **illustrative and
marked ~**. Team weight ~38 with the queen holding ~31 (the joints lens's
weight-blindness exhibit). Budget 2s ≈ ~2000 quanta at an illustrative
exchange rate. One operator, budget 4 items, one standing `near` on the
queen, one pinned class (`soundness` is pinned by default policy).

## Moment A — mid-turn, 40% of budget spent

```jsonc
{
  "v": 1, "gameId": "g_...", "teamId": "red", "scope": "op_chris",
  "turn": 22, "seq": 3,
  "bot": { "botId": "~b_default", "behaviourId": "~bh_9f2", "evalVersion": "~e17" },
  "asOf": { "turn": 22, "seq": 3, "quantaSpent": 800, "stagedPlanHash": "p_k4x", "voidIf": null },
  "attention": { "policyId": "pol_chris_v3", "budget": 4, "spent": 4 },
  "items": [
    {
      "signal": "sig_set_t22", "role": "offer",
      "presentation": {
        "headline": "Two plans still live, 1.0 weight apart; the rest of the 23 are 4.0 below.",
        "foil": { "instead": "p_j7q", "because": "keeps the queen's escape ray open but concedes the contested cell", "margin": 1.0 },
        "causes": ["flow_q_contest", "flow_q_escape"]
      }
      // payload behind sig_set_t22: options[23] with floors (span 4.0, 4
      // distinct row minima — real probe numbers), staged = p_k4x,
      // deciding = { rung: "floor", margin: 1.0 }~
    },
    {
      "signal": "sig_flow_qnear", "role": "offer",
      "presentation": {
        "headline": "Your near(queen) pull is being outvoted this turn by the contest flow (~0.4 vs ~2.1 weight-rate).",
        "causes": ["flow_q_contest"]
      }
      // the guidance echo (05 §1, value-field port): FLOW on channel
      // guidance:utt_near_q, continuous — the `near` case, no completion
    },
    {
      "signal": "sig_trace_gap", "role": "offer",
      "presentation": {
        "headline": "Still climbing: the last 200 quanta moved the margin; this board type historically improves through the full budget.",
        "causes": []
        // squeeze(trace) verdict = climbing; premise cites CPP member
        // cpp/queen@v0 (fit provenance attached) — the queen cell's
        // climbs-through-top-rung curve, a real compiled result
      }
    },
    {
      "signal": "sig_ask_q7", "role": "ask",
      "presentation": {
        "headline": "Is the enemy knight committed to the east corridor? Its 9-cell cloud~ decides the 1.0 margin.",
        "affordance": "utt_template:support-demand{unit:eKnight,scope:team}",
        "causes": ["flow_k_threat"]
      }
      // WIDTH with removal='ask', decisionRelevance ~1.2 > margin 1.0;
      // pre-filled A2 utterance (widen-only, so ratification-safe per
      // guidance lens §5.4 — never an A3 template)
    }
  ],
  "digest": null,
  "asksOpen": [ { "ref": "sig_ask_q7", "since": { "turn": 22, "seq": 3 }, "state": "open" } ],
  "index": [
    // stubs, not payloads — the not-selected middle:
    { "ref": "sig_width_all", "shape": "width", "anchor": "enemies", "label": "3 tracked widths, 2 quiet" },
    { "ref": "sig_matrix_t22", "shape": "set", "anchor": "decision", "label": "restricted matrix 23x5, pure saddle (drill)" },
    { "ref": "sig_flows_t22", "shape": "flow", "anchor": "team", "label": "~41 flow records this decision (rollup by unit)" },
    { "ref": "sig_held_pins", "shape": "held", "anchor": "operator", "label": "1 standing guidance, 0 pins" }
  ]
}
```

Points proved by writing it:

1. **Every item's payload names a real generator.** SET = bank floors +
   discarded matrix (O0 retention); the guidance echo = the shipped
   near-stat read per candidate; the trace verdict = gapCurve + compiled
   CPP; the ask = cloud width × margin overlap. Nothing had to be invented
   engine-side beyond the O0–O3 build steps.
2. **The budget forced a real omission.** The (K,W,p) share context and
   the two quiet enemy widths lost the greedy selection to the ask — and
   remain one tap away via `index`. Selection ≠ censorship, visibly.
3. **Statistics stayed in the drill.** pureDuality, R², visit counts:
   none headline. Both headline causes are flows with event anchors.

## Moment B — the enemy knight commits east; reveal at sub-step 2

Operator answered the ask (submitted the pre-filled support-demand
~20s earlier); then the knight's move resolves visibly.

```jsonc
{
  "v": 1, "seq": 5, "turn": 22,
  "asOf": { "turn": 22, "seq": 5, "quantaSpent": 1650, "stagedPlanHash": "p_j7q", "voidIf": null },
  "items": [
    {
      "signal": "sig_bundle_e1", "role": "offer",   // coincidence bundle, first-out led (02 §6)
      "presentation": {
        "headline": "The knight's commitment east collapsed its cloud, dropped the floor 2.0~, and flipped the staged plan to the escape-ray line you were shown as the foil.",
        "causes": ["flow_k_threat", "flow_q_escape"]
      }
      // drills: edge(WIDTH eKnight, collapsed) + edge(SET, staged-changed)
      //         + your answered ask (closed by utterance utt_a41,
      //           provokedBy: sig_ask_q7 — uptake recorded)
    },
    {
      "signal": "sig_conform_a41", "role": "offer",  // operator-class: always delivered, off-budget
      "presentation": {
        "headline": "Your support-demand was incorporated within one tranche: the knight is now priced in every floor.",
        "causes": []
      }
    }
  ],
  "asksOpen": []
}
```

Points proved:

4. **The first-out discipline orders the bundle**: the reveal headlines;
   plan-flip and floor-drop are consequences. Three edges, one attention
   item.
5. **The ask lifecycle closed honestly**: answered → conformance ack ≤1
   tranche (`operator` class, off-budget) → uptake join on `provokedBy`.
   Had the reveal arrived *before* the answer, the ask would have been
   `mooted` and excluded from uptake denominators (05 §3).
6. **stagedPlanHash change between frames** is what tells the client that
   moment-A items were computed against a superseded plan — the SET item
   from seq 3 renders as stale without any push to say so.

## Moment C — turn boundary: the turn note (digest, sinceTurn cursor)

```jsonc
{
  "v": 1, "seq": 9, "turn": 23,
  "digest": {
    "cursor": "sinceTurn:22",
    "edges": ["sig_bundle_e1", "sig_conform_a41", "edge_arrival_q"],
    "rollups": [
      { "by": "unit:queen", "channels": { "contest": -2.0, "escape": +1.5, "guidance:utt_near_q": +0.3 }, "drill": "sig_flows_t22" }
      // ~ illustrative balances; per-(unit, channel) — the AGG-2 causal grain
    ],
    "held": [
      { "ref": "utt_near_q", "health": "live", "note": "served-fraction rose after the plan flip" }
    ],
    "verdicts": [ { "trace": "sig_trace_gap", "verdict": "spent-through", "note": "used 1900/2000q~; climbing to the end — this board type wants its full budget (cpp/queen@v0)" } ]
  },
  "items": []   // nothing outranked the note; ambient quiet
}
```

Points proved:

7. **The digest is per-(unit, channel), never a score delta** — the
   queen's turn story is three named channels, each drillable to events.
8. **ADVANCE carries the cursor**: the turn note is assembled once at
   resolution from realized results (replay-rebased), not from mid-turn
   speculation.
9. **The guidance HELD persisted across the boundary** (operator-authored
   carries outlive turns; bot carries would have revalidated-or-died).

## What writing this surfaced (fed back into the docs)

- The selection needed the facility-location correction (02 §3 — the
  first-draft gain formula was not monotone; fixed this cycle).
- `asksOpen` must be a top-level frame field, not an item class — an open
  ask that lost this frame's selection must still be visible (applied in
  03 §1 from the start; confirmed here).
- The ask's affordance field wants to carry the *template*, not just an id
  (05 §3's refinement — confirmed; the template is what made the moment-B
  close cheap).
- One unresolved: moment-B's floor-drop edge cites a **negative**
  consequence of the operator's own accepted ask (the floor fell — that is
  the honest widening). The presentation must frame floor-drops from
  support-demands as *the demand working* ("now priced"), not as damage.
  Presentation-template concern, recorded in 04 §7 (headline language).
