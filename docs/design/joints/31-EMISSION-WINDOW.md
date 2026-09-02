# The emission rule, re-sited — accepted, and my version was wrong twice

Cycle 13 amendment. The search lens's candidate-lifecycle design adopts
`23 §3`'s emission finding and moves it. **Accepted in full.** My rule was wrong
in two independent ways, and both are closed by rules I wrote myself — one
before their objection and one after.

---

## 1. What I wrote, and why it was too strong

`23 §3`: *"a plan that cannot be emitted this slice is not admitted and not
priced."*

Their objection: **sub-threshold improvements accumulate.** Three improvements
at 0.4ε each stage as 1.2ε; refusing to price them destroys the accumulation, so
the plan that cannot be emitted *this* slice may be exactly the one that makes
the next emission possible. That is not a strength loss, it is a correctness
error, and my sentence causes it.

And their second point stands on its own: a threshold inside `better()` would
re-open what the comparator's no-arbitrary-thresholds discipline closed — the
same objection that killed `clampToLat`, arriving from the emission side.

## 2. The second error: I put an ECONOMY constraint inside the ACTION closure

Worse than too-strong, my rule was in the wrong kind. The emission obligation is
**ECONOMY** (the obligation law, `09 §BREAK 1`); admission closure is **ACTION**,
kernel-side. Making admission read the window would have made one kind's
constraint act as another kind's closure — precisely the confusion my own carve
exists to prevent.

**And my own measurement argues against my siting.** The weighted co-change
matrix puts **ACTION × ECONOMY at 0.3, the smallest cell in the whole matrix**
(`29 §1`). My rule would have manufactured, by design, the one coupling the data
says does not exist. Their siting keeps it inside ECONOMY — the kernel publishes,
`voc.ts` reads — which is an ECONOMY-internal protocol and creates no new
cross-kind edge.

## 3. Does the re-siting preserve the intent? Yes, and it improves it

My intent was that the 15–43% waste becomes **visible** rather than invisible.
Their design delivers exactly that and in the better currency:

> a computation whose only product the wire will refuse has **low value**
> *because* the wire will refuse it — priced, not forbidden.

That is my own ECONOMY law applied properly: the economy **prices meets**, it
does not forbid them. A hard gate loses the accumulation; a price reflects it.
The intent is preserved and the mechanism is more consistent with the rest of
the design than my own wording was.

The payoff they name is the sharpest part: the search can finally distinguish
**"no improvement available"** from **"improvement available, wire closed for
40ms"** — two states that look identical today and demand opposite behaviours.
That is the same defect class as a zero that means *field absent* versus a
measured zero, one level up, and `EmissionWindow` is the declared read that
separates them.

## 4. Where the fifteenth term comes from — the unification I can add

They call the missing quantity "the fifteenth term in `estimates()`". It is not
ad hoc; it is an object this design already has:

> **A sub-threshold improvement is an anticipatory meet** (`05 §3`, `24 §2`):
> work done now under the hypothesis that the window opens later. Its value is
> **reaction latency × hypothesis weight**, and `EmissionWindow.msToNextWrite`
> is exactly the latency input that prices it.

So the fifteenth term is the anticipatory-meet price with the wire as its
hypothesis, and it needs no new pricing concept — which is a better argument for
it than "there is a term missing".

## 5. One guard the accumulation claim needs

Three improvements at 0.4ε sum to 1.2ε **only if they are disjoint**. If they
are alternatives to the same unit they are substitutes, not addends, and the
accumulated total is 0.4ε.

> **Accumulate over disjoint scopes; refuse to add overlapping ones.** This is
> the Möbius/scope discipline (`15 §C`) at the emission threshold: improvements
> compose additively when their participant scopes are disjoint, and overlapping
> scopes need the residual, not the sum.

Without the guard, `voc` over-values sub-threshold work on a plan whose pending
improvements are alternatives — which would show up as exactly the pathology the
re-siting is trying to avoid, in the opposite direction.

## 6. It costs no coordinate — certified against my own admission test

`EmissionWindow` is a live constraint, not a record. Run it through C59
(`30 §6`):

- **Would dropping it let two incomparable things compare?** No — a value
  computed while the wire was shut is perfectly comparable to one computed while
  it was open.
- **Would dropping it force a recomputation that need not happen?** No — it
  *prevents* useless computation; it never invalidates a stored result.

**So it is not a coordinate: it is a derived input to the economy**, computed
from the kernel's own state. Their "zero visible-layer charge" is confirmed by
my own test rather than merely agreed with.

**And that retires a third error of mine.** `23 §3` said the emission obligation
*"is a premise coordinate that admission and pricing must read … it belongs in
the observable group's provenance-of-computation"*. It does not: that group
records what the computation **did** (which terms ran, which selections fired),
and the window is a constraint on what may **leave**. Nothing new is owed at
decision scale, and at experiment scale the effect is already carried by
`regime` (`30 §4`) — a 500 ms deadline and a 4000 ms one are different regimes
and are already not pooled.

## 7. Their refusals, endorsed

*"No manifest surface: if it starts wanting a `Choice` form it has drifted from
protocol to joint."* Exactly right, and it is the test I would have applied:
a protocol is a published fact one subsystem reads; a joint is a place where two
bots may reasonably differ. `EmissionWindow` is the former today. **If a bot ever
wants to choose how the window is computed, that is the moment it becomes an
ECONOMY-obligation member** — and the reaction table (`12 §D10`: commit-late /
commit-on-confidence / commit-early-to-deny-clock) is where it would land, not a
new joint.

## 8. Net changes

| # | change | affects |
|---|---|---|
| 1 | `23 §3`'s rule replaced: the emission window is **published and priced**, never a gate on admission or pricing; `better()` never reads it | `23 §3`, `07` finding 6 |
| 2 | my premise-coordinate claim for the emission obligation **withdrawn** — it fails C59 at decision scale, and experiment scale already carries it as `regime` | `23 §3`, `30 §6` |
| 3 | the fifteenth `estimates()` term identified as the **anticipatory-meet price**, with `msToNextWrite` as its latency input | `05 §3`, `24 §2` |
| 4 | **disjointness guard** on accumulation: sub-threshold improvements add only over disjoint scopes | `15 §C` |
| 5 | the protocol/joint boundary endorsed, with the named trigger for crossing it | `12 §D10` |

Three errors of mine in one row of one document, each caught by someone applying
one of this lens's own rules. That is the review structure working, and it is
also the argument for the rules: I did not catch them, and the rules did.
