# 09 — Refutation-led presentation, and the authority-collapse ask

Written after the search lens's doc-09 v2 (@ ab7ed5f), which supersedes
the v1 numbers my docs 00/04/07 cited. The revision is not a nuisance to
this surface — it hands it two upgrades.

## 1. What changed upstream

v2's corrected cells (bank.price, not a bare resolve) show: on contacting
boards **most or all plans are refuted** — a banked reply drives their
proved floor to −∞ ("cannot prove better than catastrophe", not
"catastrophe certain") — the live sub-matrix is tiny, one dominant column
frequently refutes nearly every row (15/17, 12/13), a wider gate refutes
the rest, and therefore **the proved floor's ability to order plans
degrades monotonically as column generation improves**. On contacting
boards the bot chooses by `est`, then a declared ceiling hole, then the
salted tie key. The mixing retirement survives but is weak (two
informative boards).

## 2. Upgrade one: the refutation is the best causal object the machine makes

My SET presentation was margin-led ("two plans, 1.0 apart"). On contacting
boards there is often no margin to lead with — but there is something
better. A refutation record is **(plan, refuting reply, what the reply
does)** — a complete contrastive causal statement with a named agent and
event, exactly Miller's shape, produced by the bank as a by-product of
doing its job. And v2's per-column attribution is a ready-made
aggregation: *one reply refuting fifteen plans is one attention item*, and
it is a **threat signal about the opponent** ("everything here dies to the
queen holding the ray"), not fifteen line items about our plans.

Schema changes (applied to 01 §2.1 this commit):

```ts
// SetPayload.options[i] gains:
readonly refutedBy: WitnessRef | null      // null = live; the ref names the reply
// SetPayload gains:
readonly refutation: {
  readonly liveCount: number               // rows with no refuting column
  readonly dominantColumn: WitnessRef | null   // #argCol = 1 case: the one reply that punishes everything
  readonly refutesCount: number            // how many options it refutes
} | null
```

Presentation rule: on boards where `liveCount / options.length` is small,
the SET headline leads with the dominant refuter, not the margin — "the
queen's ray-hold refutes 15 of 17 plans; the two survivors differ by
noise" — and the dominant column doubles as the WIDTH/threat anchor. The
floor column an operator sees must render −∞ as "refuted (by …)" with the
drill, never as a number; a UI that prints -Infinity has laundered "no
proof" into "certain doom", the exact confusion v2's reading discipline
warns about.

## 3. Upgrade two: rung fall-through is the machine's own leverage map

v2's largest finding, read from the Centaur side: **when the proved floor
cannot discriminate, the decision falls to rungs nobody designed to carry
it — and the surface should say so, because that is precisely where the
human's judgment has maximum marginal value.** The deciding-rung telemetry
(already the foil's input) grades every decision:

| decided by | what it means for the operator | surface behaviour |
|---|---|---|
| floor rung, wide margin | the machine has a proof-backed preference | ambient; margin-led SET |
| floor rung, thin margin | proof-backed but close | normal selection; foil prominent |
| est rung | no proof separates the survivors; the advised channel is choosing | SET leads with refutation context + est caveat carried in premise |
| ceiling hole / tie key | **the machine's knowledge has run out; it is choosing arbitrarily among plans it cannot tell apart** | an `edge(SET, authority-collapse)` — and the natural ask: "these k plans are indistinguishable to me; your call is as good as mine and probably better" |

The authority-collapse ask is the cheapest honest Centaur behaviour in
the whole design: it costs one comparison of telemetry the comparator
already writes, it fires exactly where ruling 13's division of labour
says the human should act, and it never fires where the machine actually
knows something (the rung grading gates it). It also gives the
frustration signal its fourth answer: "your plan lost at the tie key" is
an invitation, not a defeat.

Hygiene: the collapse edge is per-decision and would chatter on boards
that are *persistently* est-decided; the furniture rule (02 §4) converts
a standing collapse into a HELD — "this whole board type is being played
on estimates" — which is itself a cell-verdict-grade fact the second
scale (doc 08) wants.

## 4. Corrections applied to my earlier docs

- **07-WORKED-FRAME** rewritten at the moments the v1 numbers touched:
  contested-queen is ALL ROWS REFUTED under the shipped gate, so moment A
  now leads with the dominant-refuter presentation and an authority-collapse
  context; the margin-led variant moves to a quiet-board aside. (The v1
  spread/rowMin numbers are gone; v2 numbers quoted with their premise.)
- **00-SIGNAL-INVENTORY** gains rows: refutation records (live, from B1/B3
  as of v2's probe path), per-column refutation attribution, deciding-rung
  grade + authority-collapse edge.
- **04 §1** (SET supplier): the reconstruction path note now says the
  reconstructed floors are refutation-aware, and that "dominance
  condition" has a live degenerate form today: `refutedBy` is the
  *negative* dominance condition (when the reply happens, this plan is
  out), available before the maximality member exists.

## 5. One caution back to the search lens (recorded on my branch only)

Their §4½ consequence — the gate is "holding the floor's informativeness
up by not looking too hard" — is engine-internal; but the *surface* must
not inherit the shipped gate's optimism silently. A frame's refutation
block carries the gate config in its premise (enemyCap,
gateOnEntanglement), because "2 live plans" under the shipped gate and
"0 live plans" under a wide gate are different statements about the same
board, and an operator toggling appetite deserves to know which one they
are reading. This is the premise discipline doing its ordinary job; noted
because it is the first place the surface would otherwise have quoted an
engine policy as a fact about the game.
