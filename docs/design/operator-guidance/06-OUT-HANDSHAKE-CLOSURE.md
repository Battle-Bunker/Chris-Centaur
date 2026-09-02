# 06 — Closing the loop with design/operator-signals (@ cbd5825)

OPERATOR-GUIDANCE lens, seventh document. The OUT lens cross-read this
branch three times (their 05-IN-OUT-HANDSHAKE, 09, 10) and adopted the
five-coordinate carve; this document answers from the IN side: what their
echo theorem obligates my wire to retain, where their what-if hole lands in
my coordinates, the ask/template ratification semantics, and one new
integration consequence their §9 upstream (search doc-09 v2) forces on my
A2 port. Their asks are either ADOPTED (with the concrete change named) or
ANSWERED (no change needed, reason given).

---

## 1. The echo theorem, adopted as an IN-side wire obligation

Their theorem: each port has a characteristic echo, one echo generator per
port, join key = utterance id. The half they cannot build alone: **the echo
is a read, so my compile step must retain what it reads.** Adopted into
02-WIRE-API as the RETENTION column of the port contract — a port
implementation is not done until its echo feed exists:

| port | what the IN side retains per decision (the echo's feed) |
|---|---|
| value-field | contribution keyed `guidance:<utteranceId>` in `parts` (already specified, 01 §3.1) — naming convention now a wire commitment |
| attention-field | every grant the bounty influenced tagged `fundedBy: utteranceId`; the stratum verdict premise (saturated/starved) rides along per their doc-05 §6 |
| support-demand | floor delta at the deciding rung + staged-plan-changed bit + **deciding-rung shift** (§4 below), citing the utterance |
| belief-weight | per-decision (tilt, decisions-swung refs) AND the raw material for the calibration trace: the utterance's predicted reply distribution is its magnitude params, gradeable against `Turn.moves` at zero match cost — nothing extra retained, the grading is theirs |
| appetite | swing edges on decisions where the blended read crossed `better()`'s margin |
| deadline | the obligation lattice's current meet with binding-row author (a read of the reaction table, no new retention) |
| admission-edit | every exercise (license) / every kill (restriction) as premise-tagged emit-record entries — "your restriction is what killed the alternative" renders from these |
| determination | the conformance ack (shipped pin pipeline + ≤1-tranche law) |

Their early-warning ask for restrictions ("your no-north rule is down to
one live option") is ADOPTED: the closure evaluation already counts the
remainder set per decision; the count lands in the restriction's retained
record so their HELD-health echo is a read, and the consent dialog arrives
as confirmation, not shock.

## 2. Their what-if hole: the quote, landed in my coordinates — and a wire split it forces

Their 10 §7 found the one signal their type system cannot generate:
"what happens if my knight goes east?" — new computation on a hypothetical.
Their fix compiles it to an A0 utterance. Confirmed from my side, with the
coordinates and one sharpening:

- **Coordinates**: ⟨attention-field | unit | referent = hypothetical option
  (the tentative-pin shape, generalized from moves to any candidate) |
  lifetime `decision` | A0⟩. The tentative pin is the shipped degenerate
  case ("rides the event stream, the search may speculate, never enters
  the context") and the platform's worst-case preview is the precomputed
  form — three designs, one object.
- **The sharpening (wire-level, and it matters)**: quotes must NOT enter
  the guidance table. A table write changes `guidanceId`, and a premise-
  coordinate change invalidates and demotes; a speculation that invalidated
  caches would make interrogation expensive exactly when it should be free
  (the time lens's spend(tranche, hypothesis) is priced by the meter, not
  by teardown). So the wire has **two channels with different physics**:
  the TABLE (durable rows, guidanceId-bearing, premise-visible) and the
  SPECULATION stream (ephemeral, fiber-tagged, quarantined — the
  tentative-pin transport, generalized). 02-WIRE-API amended: `quote`
  requests ride the event stream with `ephemeral: true`; they produce no
  row, no guidanceId change, no echo HELD — their answer is the returned
  signals whose premise is the hypothetical fiber (their store's
  `signals.quote` renders it; quarantine law guarantees it never reaches
  the wire).

## 3. Asks, templates, and ratification — the semantics pinned

Their §3 (ask carries a pre-filled utterance template) and their A-3
routing (unit-scoped asks go to the selection-lock holder) are ADOPTED;
my wire's scope-validity rules already route the same way. The provenance
rule, made exact so the uptake number stays honest:

- submitted as-is, or with **magnitude-only** edits → `ratified`;
- any **structural** edit (port, scope, referent, lifecycle) → `authored`
  (the operator did new intellectual work; the template was a prompt, not
  a decision);
- A3 templates are never pre-filled (their rule, my M4 rider — enforced on
  BOTH surfaces: their generator refuses to emit one, my validator refuses
  authority A3 with `provokedBy` + `ratified`);
- A4 pins provoked by asks/warrants carry `provokedBy` on the pin log row
  (05-WORKED-SCENARIO's w7 → pin is the exhibit), and the
  authority-collapse ask's answer is exactly such a pin — unanchored by
  default per their A-3 (the human picks before seeing the bot's tie-break
  coin flip), which my side needs no change to support: a pin is a pin.

The structural/magnitude line reuses the wire's existing edit taxonomy
(02 §3's `retarget` vs `reweight` split) — one distinction, three duties.

## 4. New consequence for the A2 port: widening degrades floor discrimination — priced, not free

Search doc-09 v2 (via their 09 §1): on contacting boards, better column
generation drives more plans to refuted floors (−∞ = "cannot prove better
than catastrophe"), so **the proved floor's ability to ORDER plans degrades
monotonically as the gate widens** — decisions fall through to the est
rung, the ceiling hole, the tie key.

An operator support-demand IS a gate widening. So the A2 port's honest
price list, added to 01 §3.3:

1. compute (the lattice/bank rows — already noted, Q7's cap);
2. **discrimination**: each admitted threat converts some proof-ordered
   decisions into est-ordered ones. The bot gets *more careful and less
   proof-backed at once* — the human buys honesty about danger at the
   price of the machine choosing among survivors by its advised channel.

This is not an argument against A2 (the floor was ordering plans by an
optimistic premise; the demand removed the optimism), but it must be
visible: the demand's echo carries the deciding-rung shift (§1's table),
and a standing demand that keeps a board est-decided feeds their
furniture rule ("this board type is being played on estimates") — which
in turn makes their authority-collapse ask fire more often, which is the
system working: *the human marked the danger; the machine now honestly
reports that its proofs cannot pick among the safe options; the pick
returns to the human.* Ruling 13's division of labour, completing a loop
nobody drew on purpose. The demand cap (Q7) gains its second
justification, and the cap's size should be tuned on the authority-
collapse rate, not only on compute.

## 5. Boundary confirmations (no change, recorded so silence is not ambiguity)

- **Tempo-of-play ≠ tempo-of-briefing** (their §4 residual): confirmed.
  The deadline port never names briefing cadence; AttentionPolicy is
  OUT-owned config on the shared schema machinery. The no-mix law is
  checkable on my side too and 02 §5 gains the twin validation: a guidance
  row naming a SignalClassId is refused (as their policy doc refuses
  search-context reads).
- **Echo priority = operator class (bottom)**: agreed; no IN-side echo
  suppression exists — an utterance whose echo would be embarrassing to
  the bot (frustration, collapse) is exactly the one that must surface.
- **`guidanceId` as frame premise**: agreed and already load-bearing on my
  side (02 §6); their "frames under different live guidance never compare
  silently" is the same coordinate read by a second consumer, which is the
  fibration earning its keep.
- Their O3 shares my falsifier 3 verbatim (goto refused → composite names
  the refusing stage) — one test, two surfaces, kept textually identical
  in both build orders.

## 6. Updates applied to this branch's earlier docs

- 02-WIRE-API §3: the two-channel split (TABLE vs SPECULATION stream) and
  the `quote` event kind; §5 gains the SignalClassId refusal and the
  retention column pointer.
- 01-INTEGRATION §3.3: the discrimination price and deciding-rung-shift
  retention.
- 00-FACTORING §4: `what-if quote` added to the point table; M-table gains
  M10 (echo obligations are port contract, co-owned with operator-signals).
