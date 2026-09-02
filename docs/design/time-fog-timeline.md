# A fog turn through the time machinery — the process trace

Companion to `time-worked-timeline.md`, for the invisibility-potion world
(pin 20). The epistemics lens's `03-WORKED-FOG-SCENARIO.md` traces the
BELIEF (clouds, conditioning, weights) through a five-turn fog scenario;
this document traces the PROCESS — what each piece of the time machinery
does on a fog turn, which pieces degrade, and by how much. Vocabulary from
their `01-OBSERVATION-API.md` (ObservationRecord = facts + mask + events)
is used unchanged.

Scenario slice: enemy knight picked up an invisibility potion turn N−2
(pickup visible in `activeEffects`, expiry turn public); its position has
been hidden since. Turn N resolves; the view document arrives.

## 1. observe(partial resolution) — what changes vs the full-info trace

- **Determined coords**: actions and positions of every VISIBLE unit at N;
  spawn cells; effect changes. NOT determined: position(knight, N+1) — the
  mask's `hiddenUnits` row constructs its FrozenRecord instead
  (heldAtTurn = lastSeenTurn, their §2.1).
- **Citation pass**: identical mechanics. Stores citing visible coords die
  or survive as usual; stores citing the knight's position were ALREADY
  hypothesis-conditional (its cloud), so a fog turn kills LESS than a
  full-info turn — the degenerate case is the destructive one, which is
  the design's claim inverted and confirmed.
- **replay-rebase degrades by declared steps, not by falling over**:
  `ordersFrom` covers visible units; the knight enters `resolve` as a hold
  (the engine's existing partial mode). The replayed Resolution's events
  are then INTERSECTED with the view's events (their C0/C1 conditioning:
  a visible death against an unseen contestant, food that vanished with no
  visible eater — each shrinks the knight's cloud). The checksum narrows
  to the view's facts: occupancy/health equality over visible units,
  deaths/severs as reported. A full-record digest is impossible for a
  masked observer BY DESIGN — so the digest of `realized-resolution.
  sketch.md` becomes a per-view digest, one row for the epistemics lens's
  dilemma list (their redaction-policy ruling should say whether views
  carry one).

## 2. The reveal schedule — fog width has an arrival time, like simultaneity

The effect's `expiryTurn` is public (activeEffects today; their §2.1 keeps
the pickup visible). So hidden-position width is observation-reducible
WITH A SCHEDULE: at expiry the unit re-enters the visible record (and the
reappearance oracle — their finding — asserts it lands inside the cloud).
Consequence for the market: the anticipatory-meet ladder applies to fog
exactly as to the inter-turn window — hypotheses over reveal positions can
be pre-spent against a known reveal turn, geometric in depth, harvested at
the reveal. The reducibility tag's third row ("none-this-turn") is thus
usually "none-until-T", and T is data the scheduler may read. Only
C1-style event deductions shorten it unpredictably.

## 3. What degrades, quantified in expectations

| machinery | full-info turn | fog turn |
|---|---|---|
| citation kill volume | large (all ply-1 values) | strictly smaller (cloud-cited stores were already conditional) |
| replay checksum coverage | full roster | visible subset + event consistency |
| divergence counter meaning | engine drift | engine drift OR redaction-policy mismatch — split the counter (`replay-divergence` vs `mask-divergence`) so a policy change is not read as a rules bug |
| warm promotion rate | premise = full joint move | premise = visible joint × cloud-compatible hidden — MORE hypotheses survive partially (per-variable survival is the fog dividend) |
| settled-early conversion | fires on dominance | fires less (wider clouds, fewer dominances) — expected, not a defect; count it |
| ponder market | reply hypotheses | reply × reveal hypotheses, weights still W0–W2 (ruling 13 unchanged) |

## 4. New rows this trace adds to the standing docs

1. `mask-divergence` beside `replay-divergence` (the counter split above)
   — one line in realized-resolution.sketch.md's expected-catches list.
2. The reveal-scheduled reducibility refinement ("none-until-T", T data)
   — an amendment to the tag's contract as stated in belief-fog 04 §3 and
   my 8½.2; the tag gains an optional `revealTurn`.
3. Per-view digest as an open row for the redaction-policy ruling.
4. The fog acceptance shape, process half (their 03 owns the belief
   half): a seeded fog game where the hidden knight's reveal at expiry
   (a) lands inside the cloud (their oracle), (b) promotes the reveal
   hypothesis that pondered it, and (c) the ledger shows the ladder's
   completed rungs harvested — three assertions on one run.
