# The premise lattice — base and fiber, join and meet

Cycle 2 of the COMPOSITION lens. Reads with `00-CORE.md` (Law P) and against the
EPISTEMICS lens's `docs/design/belief-fog/00-THE-OBJECT.md` on
`design/belief-fog`, whose vocabulary this document **adopts rather than
duplicates**.

---

## 1. The identification, tested

The epistemics lens proposes one credal object: a **support** `S` (a proved
over-approximating set of worlds; grows by *dilation*, shrinks by
*conditioning*) and a **weight** `w` (a measure inside `S`, moving on any
evidence at earned precision), with every existing mechanism a *projection* of
the pair, tagged by `(horizon, quantifier-or-weight-id, basis)`.

My Law P says values are fibered over premises and may be compared only inside a
fiber. **The identification holds on the epistemic half, and it is a strict
containment, not an equality.** Precisely:

| my premise coordinate | their object | verdict |
|---|---|---|
| `model` (simulated vs held-with-cloud, at which observed turn) | the hidden-state coordinates of `S` | **same thing.** Holding = coarsening; the cloud engine is the dilation operator |
| `replies` (which enemy joint actions are quantified over) | the action coordinates of `S`, plus the weight ladder W0–W4 over them | **same thing.** Their credal-set signature (a socket returning a *set* of weights) is my MODEL-kind join law, verbatim |
| `pins` (operator commitments held fixed) | conditioning without evidence; named in the basis | **same thing**, with the caveat in §2 |
| `horizon` | their `V_h` label | **theirs is sharper.** Horizon labels the *random variable*, not the support — I had it in the wrong place |
| `frame` (which terms computed vs pending) | **absent from their tag triple** | **my contribution back** — §3 |
| `config` (which members, weights, code produced the number) | **outside their object entirely, and necessarily so** | **the base is larger than the fiber** — §4 |

So: **premise is the INDEX; `(S, w)` is the fiber's content.** `S` is a
*function of* the premise, not a synonym for it. That distinction earns its
keep immediately, because three of the four `Assumption` kinds the bank already
carries (`reference-action`, `operator-pin`, `narrowing`) are *conditioning
without evidence* — they shrink `S` legitimately but not by proof, and the
epistemics doc's own law ("S may shrink only by evidence") holds only once you
read those as *changing which premise you are under* rather than as evidence.
Their table says as much ("basis = the NAME of which S a number was computed
over"); this document just makes the name the primary object and the set its
value.

Vocabulary decision, stated once so the two branches do not fork: **support,
weight, dilate, condition, projection, denomination, reducibility tag** are
theirs and are used here unchanged. This lens contributes the *base space*
(what indexes them), its two operations, and the extension of the discipline
past the epistemic boundary into configuration and measurement.

---

## 2. The lattice, with both operations

A premise is a point in the product of four coordinate groups:

```
Premise = ⟨ SUPPORT-INDEX , OBSERVABLE-INDEX , MEASURE-INDEX , CONFIG-INDEX ⟩

SUPPORT-INDEX     model      per-unit: simulated | held@observedTurn | pinned | reference-action
                  replies    ∀ over legal | a modelled reply set | a witness point
OBSERVABLE-INDEX  horizon    h = 1 (this turn's frame value) | h = d (a deepened line)
                  frame      the computed-term set; its complement is pending, with spans
MEASURE-INDEX     weight     the quantifier (⊥ = "no weight chosen") | a weight id | an α-ball
CONFIG-INDEX      bot        botId (§00-CORE §4.3) | codeRef | seat | budget & box regime
```

There are **three** operations, not two: join and meet move within one turn's
lattice; `advance` transports every fiber to the next turn's lattice when the
turn resolves (values never cross it; identity, incumbency and attention do).
`advance` is the TIME lens's contribution and is developed in
`05-ADVANCE-AND-COMMITMENTS.md` §2.

Order: `p ≤ q` iff `p` is **weaker** (assumes less, admits more worlds, computes
fewer terms, commits to less measure). Then:

- **join `p ∨ q` — WIDENING.** Total, sound, free, lossy. This is what makes two
  numbers comparable that were not: take both to the weakest common premise
  (drop the disagreeing assumption, widen the interval by the pending span, fall
  back from a weight to the quantifier). Every existing "conservative reading"
  is a join. A join must record what it gave up — that record is exactly
  `Assumption`, generalised out of `ScoreBounds` and carried everywhere.
- **meet `p ∧ q` — NARROWING.** Partial, and **priced**. This is the operation
  the whole decision loop is buying: simulate a held unit, enumerate a cluster,
  deepen a thread, observe the board, commit a pin. It is not free and it is not
  always available.

The epistemics lens's **reducibility tag** (compute / observation / none) is
therefore not an annotation on the join — it is *the price list of the meet*:

| tag on a support component | meet purchasable by | price |
|---|---|---|
| `compute` (we have not simulated it yet) | simulation, enumeration, deepening | the scheduler's currency: µs |
| `observation` (invisible unit, cross-turn fog) | waiting, or deducing from events | not purchasable this turn, at any budget |
| `none` (simultaneity: the enemy's staged move) | nothing until resolution | never; only the measure coordinate can move |

**Therefore: VOI is the value of a purchasable meet.** That single sentence
fixes the failure the epistemics lens warns about — a scheduler that treats all
held width as purchasable will burn budget buying width compute cannot buy, the
day the first invisibility potion lands — and it does so without a special case:
an unpurchasable meet has no price row, so its VOI is undefined rather than
optimistic, and the economy simply never offers that work item.

> **CORRECTED by the TIME lens, and the correction is load-bearing.** Read as
> stated, the paragraph above forbids ponder entirely: every ponder target sits
> under a simultaneity narrowing nothing can buy before resolution. A meet
> supports **two distinct purchases** — (a) buying the narrowing itself, which is
> what the paragraph prices and which really is impossible for `observation` and
> `none` rows; and (b) the **anticipatory meet**: computing *under* the un-bought
> narrowing at ordinary compute price, held conditional in the stronger premise's
> fiber until reality supplies the meet for free. (b) is sound with no new
> machinery precisely because it is *conditioning without evidence* — the case
> §1 identifies as the reason the index must be distinct from the support — so
> the cross-fiber refusal keeps it out of unconditional comparisons until
> `advance` discharges the label. **The VOI table needs both columns or ponder
> is undefined.** See `05-ADVANCE-AND-COMMITMENTS.md` §3.

It also settles a question `00-CORE.md` left open about the ECONOMY kind's
composition law. ECONOMY members do not compose by summing policies; they
compose by **partitioning a budget across purchasable meets**. A ration
(`depth.tithe`, `maxClusterCells`, `maxClustersSolved`, the ply-1 reserve) is a
constraint on that partition, which is why rations belong in ECONOMY and never
in MODEL: a ration changes *which meets are bought*, never *which worlds exist*.

---

## 3. `frame` is a fourth tag, and its absence is already a live bug class

The epistemics lens tags a projection with `(horizon, weight-id, basis)`.
Two numbers agreeing on all three can still be incomparable: `envelope[h]`
depends on **which evaluator terms were computed**, because an un-run term
contributes its certified span instead of its value. That is the whole content
of the shadow/pending machinery, and round-fusion already states the correct
rule in two cases — equal pending sets compare on cores (constants cancel);
different pending sets compare on frame endpoints `lo*/est*/hi*`; a mixed
comparison on cores is a typed refusal.

So the projection table should read

```
envelope[(h, frame)]          — [min, max] over S of V_{h,frame}
estimate[(h, frame, wId)]     — E_w[V_{h,frame}] ± precision
```

and the declared read-set of a comparator names all four coordinates. The cost
of leaving `frame` off is not hypothetical: it is the same shape as the potion
finding (`posteriorOfBranch(worst, best, est)` consuming one component's
projection under another's assumptions), and it is the shape that will bite the
moment socket-2 selection is real — because *then* two branches on one board
routinely differ in which terms ran. **The projection table must be introduced
with `frame` in the key, or shadow-driven invocation cannot ship on top of it.**

---

## 4. The base extends past epistemics — and that half has cost more

The four most expensive defects on this program's record, by weeks lost:

| defect | violated coordinate | detectable by a fiber check? |
|---|---|---|
| `potion-aware` played by the shipped evaluator for its entire measured life | CONFIG (`bot`) — reported premise ≠ actual | yes, trivially: stamp ≠ constructed |
| `X ?? XEnabled()` / per-engine override beating the environment | CONFIG (`bot`) — two channels, one joint | yes: totality (§00-CORE §4.2) |
| `depth-ran.js` reading raw names against folded rows → "the layer is dead" | CONFIG (schema) — a miner defaulting an absent field to zero | yes: refuse-unknown-coordinate |
| an arm's config merged into **every** lobster seat | CONFIG (`seat`) | yes: seat is a coordinate |
| `turnsHeld` vs `currentTurn − observedTurn` double-counting | SUPPORT (`model`) | yes — and this is the *only* epistemic one |

The epistemic half is the mathematically deeper half; the configuration half is
where the program actually bled. They are the same law. That is the argument for
one discipline rather than two: **the projection table's declared read-sets, the
memo namespace, the worker protocol key, the manifest column set, and the A/A
pairing check are five instances of "declare your coordinates and refuse
anything you cannot place".**

Concretely, one rule with five deployments:

```ts
// A value that knows where it came from. Cheap: the stable half is hashed once
// per decision (evaluationIdentity already proves the cost is affordable).
type At<T> = { readonly at: PremiseId; readonly value: T }

compare(a: At<number>, b: At<number>)   // refuses unless a.at === b.at
join(a, b): At<[number, number]>        // widens both, records what it gave up
```

1. **bounds**: `compareFloors`'s basis refusal, unchanged — it is this rule's
   first instance and its proof of practicality.
2. **caches**: memo and worker keys become `PremiseId` instead of hand-rolled
   `evaluationIdentity` strings.
3. **telemetry**: every mechanism row carries the premise it was measured under;
   a miner that meets an unknown coordinate refuses instead of defaulting.
4. **harness**: an arm is `⟨codeRef, botId, seat, budget-regime⟩`; an A/A pair
   is coordinate equality, not an ad-hoc structural comparison of two fields.
5. **re-entry**: the search map is keyed by `⟨board, PremiseId⟩`, which is what
   makes the owner's ask ("instantly recover where we left off if the state
   pinned by human decisions returns to one we had already computed") a lookup
   rather than a feature. Pins are a coordinate; oscillating human indecision
   walks the same few premise addresses back and forth.

---

## 5. What this makes buildable that is not buildable today

- **Cross-turn fog costs an ingestion change, not an epistemic one** (the
  epistemics lens's §5 result). In lattice terms: observation fog is a support
  component whose reducibility tag is `observation`. Nothing else in the
  pipeline changes, because the fiber content is identical to a held unit's.
- **The opponent socket is a weight supplier at a MODEL joint**, and the
  owner's ruling-13 population (worst case only) is its `⊥` — "refuse to choose
  a weight, keep the whole credal set". Adding the cover-counting rule as a
  second member is then a lane-(a) commit, not an architecture change, and the
  four consumers currently improvising their own opponent treatment
  (`sigmaOfPly`'s `theirMiss`, the scout's reply walks, the exposure bracket,
  the dodge discount) become four readers of one supplier.
- **One paranoia dial with a meaning.** α is the size of the weight-set you
  refuse to choose among: α = 1 is the quantifier (today's floors), α = 0 is a
  single weight (pure EV), CVaR interpolates. That is D3's "fear expressed
  exactly once", and it is only expressible once the REDUCTION joint is one
  object (`02-JOINT-INVENTORY.md` §4 shows it is currently five places).
- **Depth stops needing an exception.** A deep reading is `estimate[(d, frame,
  w)]` — a different observable on the same support — so "not truncated into
  the one-ply interval" stops being a licensed violation of a rung and becomes
  a type distinction. The kill-1-lose-2 semantics the owner insisted on is then
  a *consequence* of the coordinates rather than a hand-placed rung.

---

## 6. Where the identification could still fail (falsifiers)

1. **If `S` is not representable per-coordinate.** The whole scheme assumes the
   support factorises the way the engine already factorises it (per-unit
   clouds × reply sets × future choices). Correlated supports — "either both of
   these enemies moved, or neither" — are not expressible, and the honest
   consequence is a widening (join) rather than a wrong answer. Acceptable, and
   already the status quo; worth stating so nobody claims otherwise later.
2. **If premise ids churn.** A `PremiseId` that changes every decision destroys
   the cache and the re-entry map. Mitigation: split it — a *stable* half
   (config, frame, horizon) hashed once per decision, and a *volatile* half
   (model, pins) hashed per branch. If the volatile half cannot be made cheap,
   the fibration stays a type-level discipline with runtime checks only at the
   five seams above, which is where every recorded defect lived anyway.
3. **If the config coordinate cannot be made total.** Totality is what kills the
   `??` class. If some option genuinely must be resolved late (a pool that only
   exists after the first decision), it is *deployment*, not a joint, and the
   test is the seam rule: it may change speed, never a bound and never an order.
