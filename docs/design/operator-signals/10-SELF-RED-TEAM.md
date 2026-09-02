# 10 — Self red-team: nine attacks, four amendments, one hole confirmed

The red-team method applied to docs 00–09. Verdict first: the type system
survives its falsification attempts except one (§7 — the what-if hole, a
real missing capability that lands cleanly on existing machinery); four
amendments applied; two attacks stand as open risks with mitigations
recorded rather than dissolved.

## 1. "Your budget unit is dishonest — items are not equal attention"

**Stands; amended.** A threat map and a one-line ack both cost one item in
the facility-location selection, but not one unit of a human's time. Fix
adopted (A-1): each presentation template declares an **attention weight**
(a small integer class: glance / read / study), the budget is spent in
those units, and greedy selects on gain-per-weight (the standard
knapsack-relaxed greedy, still (1−1/e)-honest for the cardinality-
relaxation). The classes are template properties — generated, not
per-item judgment calls.

## 2. "The sinceLook cursor trusts the client; a soundness alarm can be replaced before it was ever seen"

**Correct and serious; amended.** Snapshot-replacement means a seq-5 frame
can overwrite a seq-4 frame the operator never rendered; the digest covers
the gap only as well as the client's cursor reporting. For most classes
that residual risk is acceptable. For `soundness` (and any class the
policy marks `ackRequired`) it is not. Fix adopted (A-2): **sticky
classes** — a soundness edge persists in every subsequent frame until the
client posts an explicit ack (a cursors-channel write, not a guidance
utterance). This is the alarm-acknowledgement discipline the process
standards assume so universally they barely state it; my doc 06 import
missed it. Ack state is per-operator; the ack is itself an
`operator`-class echo.

## 3. "The index field is flooding by another door"

**Held with the cap already noted (04 Q5), now resolved**: the index lists
**aggregates' entry points with counts**, never raw records (one stub per
(shape × anchor-class), so its size is bounded by the anchor vocabulary,
not the decision's width). A queen decision's 5,000 flow records are one
stub. Applied to 03 §1's field comment.

## 4. "Anchoring: the surface teaches the operator to see what the bot sees, which is exactly the independent judgment the Centaur premise needs preserved"

**The deepest attack; partially mitigated, recorded as a standing risk.**
Automation-bias literature says decision-support users converge on the
tool's framing. Mitigations already in the design: the authority-collapse
ask fires precisely where the bot's framing carries least information; the
index makes the unselected visible; refutation-led presentation shows the
*opponent's* structure rather than our ranking. One amendment adopted
(A-3): the authority-collapse ask defaults to **unanchored mode** — it
names the indistinguishable plan *set* but not the bot's own tie-break
choice, so the human answers before seeing the machine's coin flip; the
policy can disable this. What cannot be designed away: a well-selected
brief is persuasive *because* it is good, and the only real counterweight
is the calibration scoreboard (05 §5) growing to cover the operator's
*disagreements* — track record of human-overrides vs outcomes, which is
uptake telemetry read the other way. Recorded as the surface's version of
ruling 49: the surface must measure its own distortion. A paired-harness
test exists: operators with/without frames on seeded boards, agreement
rates vs outcome quality — expensive (humans), deferred, named.

## 5. "Read-time folds on the hosting server compete with the search for cycles at the worst moment"

**Held.** The surface tithe (04 §3) covers frame assembly; the store's
pull queries are the risk (an operator opening a deep drill mid-decision).
Resolution stands on the module split: queries read *retained* records
(no re-computation), and the store runs off the decision path (03 §4
pull-never-blocks-push); the residual contention is I/O, bounded by the
same class of budget as replay writes. The genuinely expensive read —
`signals.quote` (§7) — is priced in quanta explicitly because it is not a
read at all.

## 6. "Two operators, one ask — who answers? And do both burn attention on the same items?"

**Amended (A-4), completing 04 Q6**: an ask anchored on a unit routes to
that unit's **selection-lock holder** (the guidance lens's exclusivity
machinery, reused); team-anchored asks route per the same captain-gate
convention their Q8 chose for team-scope writes. Offers are not routed —
every operator's frame selects independently under their own policy
(cheap, per 03 §2) — but an *answered* ask and an *acked* sticky edge
clear for the whole team (one answer suffices; the clearing echo names
who).

## 7. The falsification attempt that succeeded: the what-if is not expressible

Counter-examples tried against "any signal = role(op*(shape))": the
staged plan's expected line (SET drill: plan + witness replies — fits);
a game narrative (digest — fits); per-heuristic weight display (FLOW at
coarse channel grain — fits); "show me the board in 3 turns if nothing
changes" (trace of the incumbent's projection — fits, barely, as a drill
of SET); **"what happens if my knight goes east?" — does not fit.** It is
not a retained record; it demands *new computation on a hypothetical*.

The hole is real and the machinery for it exists on the other surface:
the IN lens's A0 (attention-only authority) and the time lens's
`spend(tranche, hypothesis)` — the tentative-pin speculation path. Fix
(applied to 03 §1's store API): **`signals.quote(hypothetical)`** — an
operator-initiated speculation request that compiles to an A0 utterance
(speculation only, never binding), is priced and metered by the
metareasoning meter like any hypothesis spend, and returns ordinary
signals whose **premise is the hypothetical fiber** (the quarantine law
already guarantees fibers never reach the wire, so a quote can never leak
into play). The platform's worst-case preview is the precomputed
degenerate quote. This closes the loop with the fourth Horvitz element:
the operator can interrogate, not just receive.

The type-system claim survives in amended form: four shapes and two
operators cover every signal the engine **generates**; the quote adds no
shape — it adds an *initiation path* for generating signals on demand.

## 8. "Headlines are free text — a template bug asserts a cause the payload does not contain"

**Amended (A-5)**: presentation templates are **projections, not prose** —
every noun phrase in a headline binds to a payload field or ref
(template-fill, checkable), and a template that cannot bind refuses at
generation (miner-refuse discipline applied to language). The glossary
checker covers vocabulary; this covers *reference*. A rendered headline
whose bound refs died with a voidIf is re-rendered or dropped, never
served stale.

## 9. "The ADVICE economy: is any of this a joint with one member?"

Checked against the composition lens's refusal. Genuine member
collections: selection value functions (facility-location is the seated
member; an operator-tuned variant is a plausible second), digest
composers, presentation template sets, echo generators (one per port —
seven members by construction), edge predicates (open vocabulary),
attention-weight classes. Constants entering as members with provenance:
frameQuantum, shelf-life default, flood bands, furniture N. No
single-member socket found; the closest is the store's retention policy
(one policy today) — kept as a config value, not a joint, until a second
policy exists. Refusal respected.

## Summary of amendments applied this cycle

| # | change | where |
|---|---|---|
| A-1 | attention weights (glance/read/study) on templates; budget spent in weight units | 02 §3, 03 §2 |
| A-2 | sticky classes + per-operator ack; soundness is sticky by default | 03 §4 |
| A-3 | authority-collapse ask defaults unanchored | 09 §3 |
| A-4 | ask routing via selection lock; team asks captain-gated; answers clear team-wide | 03 §4, 04 Q6 closed |
| A-5 | headlines are bound projections; unbindable templates refuse | 01 §5 |
| — | `signals.quote` via A0 speculation, priced in quanta, hypothetical-fiber premise | 03 §1 |
