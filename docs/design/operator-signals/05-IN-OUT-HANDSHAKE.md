# 05 — The IN/OUT handshake (with design/operator-guidance @ a7a2c2a)

Written after reading the guidance lens's `00-FACTORING.md`. Their
five-coordinate carve ⟨PORT, SCOPE, CONSTRUCTOR, LIFECYCLE, AUTHORITY⟩ is
adopted here as the vocabulary for everything guidance-shaped; my doc 04
§6's coarser factoring offer (drive = HELD + channel; preference = channel
only) is superseded by it — consistent but strictly less fine. This
document is the seam contract from the OUT side.

## 1. The echo theorem: PORT determines echo shape

Standing rule from doc 00 §6: every IN affordance owes an OUT echo. The
guidance lens's PORT axis makes this precise — **each port has a
characteristic echo, and the echo's shape is a function of the port
alone**:

| port (IN) | what the operator needs to see (OUT) | echo shape |
|---|---|---|
| **value-field** | the field's live contribution to the ordering — is my pull winning or being outvoted? | FLOW on channel `guidance:<utteranceId>` (01 §2.2), continuous; the `near` no-completion case is simply this echo with no terminal edge |
| **attention-field** | did the compute go where I pointed, and did it find anything? | `trace(quantaSpent, anchor=referent)` + any edges produced by work on that anchor, tagged `fundedBy: utteranceId` |
| **support-demand** | what admitting the row did — floor drop, staged-move change | edge citing the utterance: (floor delta at the deciding rung, staged-plan changed?) — a conformance edge with weight-unit content |
| **appetite** | the setting, echoed; and which decisions it actually swung | HELD (kind=setting) + edges on decisions where the blended read crossed `better()`'s margin |
| **deadline** | the obligation state — what row binds now, whose | HELD (the obligation lattice's current meet, with the binding row's author) |
| **license** (A3) | the license's standing + every exercise of it | HELD (kind=commitment, author=operator) + an `operator`-class edge per exercise — a license exercised silently is an unsupervised exception |
| **determination** | received / incorporated / overridden-by-floor, ≤1 tranche | the conformance ack (03 §5) |

Consequences:

- The OUT surface implements **one echo generator per port**, not one per
  affordance. New affordances (their §4 table has seventeen) get echoes for
  free by compiling to ports — the same economy their compile step buys the
  search.
- Echo priority: all echoes are `operator`-class (bottom element, 03 §4) —
  they answer the operator's own act.
- The utterance id is the join key everywhere (`guidance:<utteranceId>`
  channels, `fundedBy`, edge citations). Their wire already stamps ids per
  utterance; nothing new needed on their side.

## 2. The frustration signal is a first-class composite (their M5, adopted)

"Why is the bot not doing what I asked" has three different answers with
three different remedies, all reads this surface already holds:

| answer | read | remedy shown with it |
|---|---|---|
| never priced — set aside at a lifecycle stage | ledger `set_aside` disposition + stage, filtered to plans serving the utterance | "widen X / the cap binds here" (or: the ask to re-scope) |
| priced, outvoted in the ordering | FLOW contrast: the guidance channel's contribution vs the channels that beat it, at the deciding rung | "raise magnitude" is *not* auto-suggested if the winner is the death band — the echo names the outvoter instead |
| survived to the reduction, beaten there | the foil: (asked-for plan as member, dominance condition it fails) | the separating condition — what would have to be true for your plan to win |

Assembled as one AdviceItem (a coincidence-style bundle, 02 §6) anchored on
the utterance, emitted when a live utterance's served-fraction drops — an
`edge(FLOW guidance channel, starved)`. Added to the doc 00 inventory
(§6). This is the single best exhibit of "intelligently aggregated": three
subsystem reads, one causal sentence, one attention unit.

## 3. Ask ↔ utterance closure (their §5.4, adopted with the reverse ref)

- An ask (01 §4) carries `affordance: AffordanceId` — now refined: it
  carries a **pre-filled utterance template** (port, scope, referent,
  suggested magnitude/lifecycle) the client can submit as-is.
- The answering utterance carries their `provokedBy: adviceRef`; my
  AskStatus closes by watching for utterances citing the ask. No dedicated
  answer channel — exactly their design.
- **Ratification laundering** (their rider) binds this surface's conduct:
  an ask that pre-fills an A1/A2 utterance yields `ratified` provenance on
  acceptance; this surface must therefore never pre-fill an A3 license
  (asks may *describe* the license case; the operator authors it from
  scratch), and the uptake telemetry (which advice gets acted on — the
  number the program has never had) reads `provokedBy` joins.
- Symmetric rule for honesty of the uptake number: an ask expires
  (`mooted`) when its voidIf fires, and mooted asks are excluded from
  uptake denominators — else the surface can inflate its own usefulness by
  asking questions events were about to answer.

## 4. Vocabulary now shared (single definitions; owners marked)

| object | owner | reader |
|---|---|---|
| AttentionPolicy | guidance (it is operator config) | signals (selection input) |
| utterance id + `provokedBy` + `authored\|ratified` | guidance | signals (echo joins, uptake) |
| AffordanceId / utterance templates | guidance | signals (ask pre-fill) |
| `guidance:<id>` flow channels | signals (channel registry) | guidance (their §5.1 fields enter the ordering as these channels) |
| conformance deadline (≤1 tranche) | time lens | both |
| obligation classes incl. bottom element | joints/time | both |

One residual difference to keep visible, not resolve: their deadline port
lets an operator direct the bot's *clock* posture; my frame cadence
(frameQuantum) is deliberately not operator-directed per-item but is
policy-configurable. If the owner ever wants "brief me only at commits",
that is an AttentionPolicy cursor mode, not a deadline utterance — the two
lenses agree tempo-of-play and tempo-of-briefing are different dials.

## 5. Second cross-read (their 02-WIRE-API + 03-SELF-RED-TEAM @ 7036c14)

**H9 settles AttentionPolicy ownership — my §4 table stands corrected.**
I had assigned AttentionPolicy to the guidance lens as operator config;
their H9 draws the sharper line: *"the guidance table biases the game; the
advice subscription biases the conversation — the rows never mix (an
ADVICE threshold can never change an ordering)."* Adopted: AttentionPolicy
is **OUT-owned** (it is the advice subscription), but it rides the same
generated-schema machinery (their constructor-row generation gives me
pins/shelves/budget rows for free) and the same transport family. The
no-mix law becomes checkable: nothing in the search context may read the
policy doc; nothing in the guidance table may name a SignalClassId.

**H5's belief-weight port gets its echo** (extending §1's table): the
operator-authored weight-supplier tilt is supervisable *and gradeable* —
the fog lens's log-loss harness reads Turn.moves at zero match cost, so
the echo is (a) edges on decisions the tilt actually swung (like
appetite), and (b) a per-utterance **calibration trace**: how the
operator's read on that enemy is scoring against observed replies. The
empathy channel comes with an empathy scoreboard, which is exactly the
feedback loop that keeps ruling 13's "humans take the risks" honest —
risk-taking with a visible track record. (Their falsifier for H5 is also
an OUT read: changed decisions cite the supplier utterance.)

**A-3's two signs echo symmetrically**: a standing *restriction* is a HELD
like a license, and the frustration signal gains the case their H4 names —
"your restriction is what killed the alternative" renders from the emit
record's premise tags; when a restriction's remainder approaches all-fatal
the consent surface is theirs, but the *early warning* ("your no-north
rule is down to one live option") is an OUT edge on the restriction's
HELD, cheap and probably the difference between a consent dialog arriving
as a shock or as a confirmation.

**Their `guidanceId` premise coordinate** (02 §6) is adopted as the join
key on every echo item's premise — frames computed under different live
guidance never compare silently, and "did guidance help" A/B reads drop
out of the same address discipline.

**Their Q10 (constructor versioning across deploys) has an OUT half**: a
retired-constructor row must surface as a HELD health change
("your escort directive's constructor was retired; row served under
compatibility") — the visibly-retire rule their §5 no-silence principle
requires, delivered through this surface.
