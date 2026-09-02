# 03 — Red-teaming the carve: hard cases, three amendments, one new port

OPERATOR-GUIDANCE lens, fourth document. The red-team lens's method applied
to my own 00-doc: throw the guidance families a real Centaur team would
reach for at the five coordinates and record where the carve creaks. Verdict
first: the carve survives with **three amendments and one added port**; two
families are named refusals; one question goes to the owner's pile.

---

## 1. Hard cases

### H1. Conditional guidance — "if the queen crosses the river, retreat" — AMENDMENT

As factored, lifecycle was a single retirement rule. Conditionality needs
**activation** too: the directive should sit dormant until a predicate
holds. The platform's derived-retirement rule (00 M9) already implies the
machinery — a maintenance Drive is dormant-while-satisfied, i.e. lifecycle
is *evaluated*, not latched. Amendment A-1 generalizes lifecycle to a pair:

```
lifecycle: { activate?: PredicateRef   // absent = live from birth
           , retire:   { kind: 'turn' | 'turns' | 'until' | 'standing', ... }
           , mode: 'latched' | 'maintenance' }
```

Both predicates are constructor-declared members over (scope, referent,
board) — Law N intact. "If X then fear Y" = a fear payload with
`activate: X`, `mode: maintenance`. No new coordinate: the LIFECYCLE axis
was under-dimensioned, not wrong.

### H2. Sequenced plans — "collect the potion, then attack the file" — FITS

The `goto` queue is the shipped precedent: `until` retirement spawning the
successor. With A-1 the general form needs no chaining field at all:
utterance 2 activates on `retired(utterance-1)`… which would be a
cross-reference (Law N violation). Keep the queue's actual shape instead:
**a single utterance whose referent is a sequence**, the constructor owning
the progression (exactly `targets: Coord[]` today, generalized to
referent lists). Cross-utterance chaining is refused; sequences live inside
one constructor. This is both lawful and matches the shipped design.

### H3. Coordinated multi-unit directives — "A and B pincer X" — FITS, cost noted

Scope = coalition {A, B}, constructor = a joint field (surround/pincer),
payload compiles to a **plan-level term**, not per-unit tables — 01 §2
allowed this for team scope; the honest note is cost: plan-level terms
evaluate inside `scorePlan` rather than as worker-shareable per-unit
tables, so coalition constructors carry a compiled-cost class in their
schema row and the guidance budget counts them at that class. The search
side needs nothing new (the evaluator already composes per-plan parts).

### H4. Negative determinations — "anything but north" / hard "never enter R" — AMENDMENT

The ladder had a gap between A1's soft avoidance and A4's single-move pin.
Two shapes:

- **Per-turn set restriction**: "not north, this turn". This is A4's own
  type, generalized — Amendment A-2: **a determination is over a SET of
  options; the pin is the singleton case.** Same wire (staging ladder, not
  the guidance table), same lifetime ≤ turn, and the fatal-consent gate
  extends: a restriction whose remainder is all-fatal triggers the same
  consent dialog a fatal pin does today (`FatalMoveConsent` — machinery
  shipped).
- **Standing restriction**: "never enter R". Durable option removal is an
  admission change, which is A3's altitude. Amendment A-3: **A3 is the
  admission-edit rung with two signs** — *license* (open a named closure,
  the F1 path) and *restriction* (add an operator closure, scoped and
  logged). Symmetric machinery, symmetric telemetry, and the same
  owner-gating question (B5) covers both signs. A standing restriction can
  bind fatally on a bad board; the sound channel's death-band pricing still
  runs, so the frustration/consent surface must show when the restriction
  is what killed the alternative — the emit record's premise tags carry it.

### H5. Operator empathy — "the reds will rush the potion" — NEW PORT

The genuine hole. This is neither support (it *narrows* nothing soundly),
nor appetite (not curvature), nor a value-field (it is a claim about
*their* moves, not our outcomes). It is a **weight over enemy replies** —
exactly the D2 weight-supplier socket the belief lens built and ruling 13
pinned shut for bot-authored members. But ruling 13's own text assigns
empathy to the humans: "conservative advice that avoids silly mistakes;
HUMANS take the risks based on empathy with opponents."

Port 8, **belief-weight** (A1): an operator-authored member of the credal
weight-supplier — a tilt over a named enemy unit's replies (or a named
line), consumed by the advised channel only, ε-blended at the read like any
supplier, `'adversarial'` untouched as the sound zero point. Floors never
move; est and the ordering do — which is precisely "the bot stays
conservative, the human takes the risk", now as a type. The D2 socket thus
opens for exactly one author class without violating the ruling that closed
it: the fit-transport refusal (ε̂ fitted on population refuses per-opponent
use) applies to *fitted* members; an operator's live opinion is not a fit —
it is the empathy channel the Centaur thesis promises, and it carries
`author: operator` provenance wherever it flows.

Falsifier: with a belief-weight active and ε at the sound end, staged plans
are unchanged (the supplier is advisory by construction); at the fitted ε,
plans may change and every changed decision's emit record cites the
supplier utterance.

### H6. Guidance under fog — "goto a cell inside the cloud" — RULE, deferred build

Referents can be invisible (a hidden enemy unit; a cell whose contents are
masked). Rule adopted from the platform's restart-statelessness plus the
belief lens's grain: **lifecycle predicates evaluate on the authoritative
observed board only** (sound; a latched arrival never fires on a guess);
**fields may read belief projections** (a distance-to-cloud is an interval;
the constructor declares which projection, and the compiled stat inherits
its advisory precision). Nothing new in the carve; the constructors gain a
belief-aware compiled form when the fog programme lands (belief steps 5–8).

### H7. Conflicting operators — priced, visible, allowed — FITS

Two live directives pulling one unit apart sum in the ordering like any two
terms; the frustration signal (00 M5) names the loser per decision; the
wire's attribution (02 Q8) names the authors. Deliberate: guidance conflict
is information about the team, not an error state. The one hard conflict —
two A4 determinations — is already settled by the staging wire (LWW +
selection exclusivity).

### H8. "Play like X" / style directives — REFUSAL (named)

"Play aggressively" as a single dial is expressible today only as a bundle
edit (appetite up, aggression weight up, attention to attacks). A *style*
member — one utterance re-weighting many members — would be a config macro,
which Law N forbids (cross-references, interpolation). Refused: styles live
as **bot addresses** (config-time selectable members/profiles), not as
in-game utterances; the in-game surface offers the named dials it has. If
the owner wants one-gesture styles, that is bot selection mid-game (the
production bot-binding gap, composition finding 14), not guidance.

### H9. Guidance about the bot's honesty — "tell me when you disagree" — OUT

Subscription preferences over ADVICE members (which warrants to surface,
thresholds) are the OUT direction's configuration, not IN-guidance; they
spend attention, not search. Named so the boundary stays crisp: the
guidance table biases the *game*; the advice subscription biases the
*conversation*. Same schema machinery can serve both, but the rows never
mix (an ADVICE threshold can never change an ordering).

---

## 2. The amended carve, restated tight

- Coordinates unchanged: PORT × SCOPE × CONSTRUCTOR × LIFECYCLE × AUTHORITY.
- LIFECYCLE = (activate?, retire, mode) — A-1.
- AUTHORITY ladder: A0 attention · A1 bias (fields, weights, appetite,
  belief-weights, deadlines) · A2 widen-only support · A3 admission edits
  (license | restriction), owner-gated · A4 determinations over sets,
  lifetime ≤ turn, consent-gated when fatal — A-2/A-3.
- PORTS (8): value-field, attention-field, support-demand, belief-weight,
  appetite, deadline, admission-edit, determination. Each owned by an
  existing joint; belief-weight is the D2 socket's operator-author class.
- Budget discipline (joints lens's visible-layer rule): the port table is
  this lens's visible surface — an addition must name what it replaces;
  H5's addition is paid for by H8/H9's two refusals.

## 3. What goes to the owner (adds to 00 Q1)

- **Q11**: A3-restriction ships with A3-license, or later? The consent
  machinery exists; the risk profile differs (restriction can cost a life,
  license can spend one). Recommendation: same B5 decision covers both
  signs or neither — asymmetric shipping would let operators forbid but
  not permit, which trains exactly the wrong trust model.
- **Q12** (belief lens should co-sign): confirm H5's reading of ruling 13 —
  operator-authored weight-suppliers are the intended empathy channel, and
  the socket's author-class gate (operator now, fitted members when the
  ruling lifts) is the right enforcement point.
