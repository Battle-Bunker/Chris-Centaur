# 13 — LATENCY, ROUND 2: a model of the delay, a simulator that can be wrong, and what the measurement changed

UX, document 13. `03-LATENCY.md` built the ladder
(DISCONNECTED → STALE → DEGRADED → THINKING → LIVE), the last-safe-press notch
and the optimistic command chips, and photographed all of it under a constant
injected delay. This document is the round that asks whether any of it is
**right**.

Three parts, in the order they were done, because each one is the input to the
next:

* **§1** decomposes a turn's wall clock into segments — which of them the wire
  actually reports, which are estimated, which nobody reports at all — and
  reads how the rest of the field communicates delay. A signal an operator
  cannot decompose is a signal they cannot act on.
* **§2** replaces the constant delay with five named wires that behave like
  real ones, and builds the instrument this round is argued from:
  `scripts/latency-sim.js` drives the **shipped page** through eight turns
  under each wire and compares **what the operator was shown** against **what
  was true**, where the truth is the transport's own ledger rather than a
  second opinion.
* **§3** is the design work the instrument paid for, and §4 is the same
  measurement re-run against it.

The dev environment still has no latency on either hop. Everything below is
therefore design under simulation, and §2's whole discipline is making the
simulation something you can be wrong against.

---

## 1. A model of the delay

### 1.1 A turn's wall clock, in segments

An operator's turn is not one delay, it is eight, and they belong to four
different owners. In order:

| # | segment | who owns it | what it does to the operator |
|---|---|---|---|
| 1 | game server → centaur | the game server | the board is old before anyone here sees it |
| 2 | centaur, before the kernel | us | the deadline is running and nothing is thinking yet |
| 3 | kernel → its first answer | us | there is nothing to look at yet |
| 4 | kernel, refining | us | the answer on screen keeps improving |
| 5 | centaur → browser | the wire (down) | what is on screen is already out of date |
| 6 | **the operator** | **the operator** | the only segment a person can spend |
| 7 | browser → centaur | the wire (up) | the press is still in flight when the clock runs out |
| 8 | centaur → game server | us / the game server | the submit, which nobody times |

Two of these are the ones an operator can act on. **(6)** is theirs outright:
deciding faster is the only lever a human has inside a turn. **(7)** is theirs
indirectly — it is the reason to press *earlier*, and it is what the
last-safe-press notch exists to price. Everything else is somebody else's, and
the single most useful thing this surface does is say **which**: an operator
who can see that the turn is 1,500 ms old because the game server is behind
knows that pressing faster will not help, and stops trying.

### 1.2 What the wire actually carries

Every number below is a field that already exists. Nothing in this round asked
the server for anything new.

| segment | source | measured, estimated or unknown |
|---|---|---|
| 1 · game → centaur | `gameLagMs` on `board-update`, from `GameWebSocketServer.noteTurnOrigin` | **measured** where anyone called `noteTurnOrigin`; `null` — never `0` — where nobody did |
| 2 · centaur queue | `decision.begin.atWall − board.arrived.atWall`, off `lens-frames` | **measured** |
| 3 · to first answer | first `emission.atWall − decision.begin.atWall` | **measured** |
| 4 · refining | `decision.end.atWall − first emission.atWall` | **measured** |
| 5 · centaur → browser | arrival − `serverSentAt` (stamped by `websocket-server.ts` as it lets go of the frame) | **measured**, one way, not a halved round trip |
| 6 · operator | the browser's own clock, board arrival → the gesture | **measured** |
| 7 · browser → centaur | `rtt/2` from the transport's own ping/pong | **estimated** |
| 8 · centaur → game | — | **unknown**: no stamp for either end reaches this page |

Three things are worth stating plainly about that table.

**The `TurnEvent`s were already carrying the centaur's whole share.** Segments
2–4 come out of `atWall` on events the page has been receiving and folding all
along — `board.arrived`, `decision.begin`, `emission`, `decision.end` — all
stamped by the *one* writer that orders the turn (`ActiveGameManager`), so they
are on one clock by construction and need no skew correction between them. The
surface was throwing them away.

**The kernel's own lateness is a different question and is not on this wire.**
`KernelReport` carries `overshootMs` (how far past the caller's deadline the
answer came, measured against `askedDeadline` and not the clamped one) and
`startedLateMs` (`max(0, t0 − deadlineMs)` — the wire having spent the whole
turn window before the kernel saw it), and `docs/design/DEADLINE.md` describes
`TurnDeadlineGuard`, which widens the reserve to `max(150 ms, 3σ)` of the
arrival-lag distribution and applies the *provable* slow-clock correction.
**None of those reach the browser.** `decision.end`'s payload carries
`summary: Record<string, number>` — a counters bag whose contents are the
caller's choice, and the harness puts `{ nodes }` in it. So the page can
measure how long the kernel took and cannot see what the kernel thought its
deadline was. That is a real gap and §3 does not paper over it: the spend bar
reports segments 2–4 as *time*, never as *lateness*.

**Segment 8 has no witness at all**, and the honest treatment of it is a hatch
and the word *unknown*. Folding it into the `rtt/2` estimate would have made
the bar add up, which is exactly the temptation to refuse: a decomposition that
always sums to the total has stopped being a measurement.

### 1.3 Jitter and loss are not extra segments — they are the shape of (5) and (7)

A mean delay is the least interesting thing about a bad connection. Three
distinct behaviours produce the same mean and ask for three different things
from an operator:

* **steady delay** — press earlier, every turn, by the same amount;
* **jitter** — press earlier by *more* than the mean, because the notch has to
  cover a distribution rather than a point;
* **loss** — press earlier is no help at all; the frame that was dropped is not
  late, it is gone, and the fold has a hole in it for the rest of the turn
  (`lens-frames` carries the turn's only copy of its events and nothing above
  the socket retransmits).

A fourth, which the constant-delay harness could not produce at all: **the
queue**. Under bufferbloat the delay is not a property of the link, it is the
depth of the buffer in front of it, so it *climbs while you are talking* and
drains when you stop (Gettys, [*Bufferbloat: Dark Buffers in the Internet*,
ACM Queue 9(11)](https://queue.acm.org/detail.cfm?id=2076798), 2011; Nichols &
Jacobson, [*Controlling Queue Delay*, ACM Queue
10(5)](https://queue.acm.org/detail.cfm?id=2209336), 2012, the CoDel paper,
later RFC 8289). That shape matters here more than in most places, because a
turn of this game offers ~55 KB of `lens-frames` in a burst (`03` §1.2): the
burst *is* the load that fills the buffer, so the page's own traffic is what
makes the page's own numbers worse, and a smoothed RTT will always be reporting
the queue as it was rather than as it is.

### 1.4 How the rest of the field says it

Five traditions, and each one contributed a rule.

**Game netcode HUDs decompose, and they name the buffer separately from the
wire.** Overwatch's network graph reports latency, packet loss and
**interpolation delay** as three numbers, and the community's standing
observation is that most complaints called "lag" are high IND rather than high
ping — the *buffer the client adds to smooth an unstable link*, not the link
([Blizzard forums, *Packet loss and interpolation
delay*](https://us.forums.blizzard.com/en/overwatch/t/packet-loss-and-interpolation-delay/368115)).
VALORANT goes further and splits what is normally one number: its stats display
carries Network Round Trip Time, server tick rate, **receive vs send packet
loss** as separate figures, and a graph explicitly labelled *Network RTT +
Processing Delays* that puts server and client move delays beside the wire
([Riot, *VALORANT Game and Network Instability
Basics*](https://playvalorant.com/en-gb/news/game-updates/valorant-game-and-network-instability-basics/);
[*VALORANT's 128-Tick
Servers*](https://technology.riotgames.com/news/valorants-128-tick-servers)).
Both are the same rule: **an operator who is shown one number cannot tell whose
fault it is**, and both hops and the processing are separate readings. That is
the argument for §1.1's eight segments and for `gameLagMs` having been a
separate number since round 1.

**Rollback fighting games display the correction, not the delay.** Guilty Gear
Strive and KOF XV show the **rollback frame count** during a match, under the
guard meter, and SNK's connection indicator is five levels cut on hard ping
bands (0–19 ms = Lv. 5, ≥ 90 ms = Lv. 1)
([EventHubs](https://www.eventhubs.com/news/2021/nov/17/kof15-ggpo-rollback/)).
Rollback itself is the deeper lesson: GGPO's premise is that the local input is
applied **immediately** and reconciled afterwards, and the visible artefact is
the correction ([GGPO](https://www.ggpo.net/)). That is precisely the
optimistic-chip contract `03` §3.4 built — the gesture appears in the frame it
was made in, and a refusal *becomes* the chip rather than the chip vanishing —
and it is why the count of corrections is worth showing: **a rollback you
cannot see is a rollback you cannot trust the system through.**

**Cloud gaming decomposes the pipeline rather than the wire.** NVIDIA Reflex
splits end-to-end system latency into peripheral, game, render and display
latency, and the Reflex SDK exposes per-stage markers — input, simulation,
render submission, driver, render queue, GPU render
([NVIDIA](https://www.nvidia.com/en-us/geforce/news/reflex-low-latency-platform/)).
The relevant borrowing is not the stages, it is the **habit**: the useful thing
to show a competitor is not the total but *which stage owns it*, because that
is the only form in which the number implies an action. §3a's spend bar is this
idea at turn scale.

**Chess servers compensate rather than merely report, and say which is
which.** lichess separates *ping* (the round trip to the server) from *server
lag* (the server's own processing) on its [`/lag`](https://lichess.org/lag)
page, and credits measured lag back to the player's clock per move, with a cap.
The relevant borrowing is negative: **we cannot compensate.** The game server's
deadline is not ours to move; `DEADLINE.md`'s guard already spends the only
slack there is, and it spends it in the *safe* direction (every correction it
can apply moves the deadline earlier, never later). Where lichess gives the
player their lag back, this interface can only tell the operator to press
earlier — which is why the notch has to be *right*, and why §2 measures whether
it is.

**Market data draws staleness as a ladder, and names its fallbacks.** The rung
vocabulary and the rule that a fallback path must *say* it is a fallback came
from there in round 1 and stand unchanged.

### 1.5 What human factors say about communicating delay

Four findings, and each one constrains a decision below.

**Nielsen's three limits** — 0.1 s feels instantaneous, 1 s keeps thought
uninterrupted, 10 s is the limit of attention
([NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)) —
sit *around* this problem rather than inside it, and that is the finding.
A 500 ms turn budget straddles the first two: the surface's own reactions must
land inside 0.1 s (they do — `03` §1.3 measures 0.6 ms to install the rail and
13.5 ms to repaint the board), while the *turn* is a 0.5–1.5 s event that the
operator must be kept oriented inside. Nothing here is ever a 10-second wait,
so **progress bars for their own sake are not the answer** and the percent-done
indicator Nielsen prescribes past 10 s is out of scope. What is in scope is the
1 s limit: past it the operator notices, and something has to say what is
happening.

**Card, Moran & Newell's Model Human Processor** (*The Psychology of
Human-Computer Interaction*, 1983) puts the perceptual processor cycle at
~100 ms and the cognitive at ~70 ms. Two consequences are taken literally: a
readout that changes faster than ~100 ms is changing faster than it can be
read (hence `TICK_MS = 100` and the idle fallback to 1 Hz), and the *reaction*
component of segment 6 has a floor of a couple of hundred milliseconds that no
interface can design away — which is why on a 500 ms turn the notch is not a
nicety.

**Seow's responsiveness classes** (*Designing and Engineering Time*, 2008 —
instantaneous 0.1–0.2 s, immediate 0.5–1 s, continuous 2–5 s, captive
7–10 s) give the right vocabulary for the ladder's rungs: LIVE and THINKING are
an *immediate*-class interaction, DEGRADED has fallen to *continuous*, and
STALE has fallen out of the classes altogether. The rungs are the classes, and
that is the justification for there being five of them rather than a percentage.

**Uncertainty is worse than delay.** Maister's *The Psychology of Waiting
Lines* (1985) — the canonical propositions being that **uncertain waits feel
longer than known, finite waits** and that **unexplained waits feel longer than
explained ones** — is the single most load-bearing citation in this document,
and it is still the framework the current literature works within
([Arveson et al., *40 Years of The Psychology of
Waiting*](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5669790), 2025).
It is why §3c exists: a page that says *no decision frame for 1,240 ms* has
converted a known finite wait into an unexplained one, and the same silence with
*the wire is up, the bot is quiet* attached is a different experience of the
same 1,240 ms. It is also the reason the surface must not be **precise where it
is uncertain** — a single-line notch drawn from an average tells the operator a
false certainty, and §3b replaces it with the spread.

### 1.6 The rules that follow

1. **Say whose segment it is** before saying how big it is. (Overwatch/VALORANT)
2. **Never draw an unknown as a zero.** Hatch it and name it. (§1.2, segment 8)
3. **Show the correction, not only the delay.** (rollback; the chips)
4. **Where the number is a distribution, draw the distribution.** (Maister;
   §3b)
5. **Explain the wait or the wait gets longer.** (Maister; §3c)
6. **Nothing on this surface may change faster than it can be read.** (Card,
   Moran & Newell)

---

## 2. The simulation, and the instrument

### 2.1 Five wires

`03` §3.5's harness had one delay, one jitter and one drop rate, drawn from
`Math.random`. That reaches every rung of the ladder and it cannot ask whether
any rung is *right*: a constant has no distribution, so a notch drawn from one
is never wrong against it; a uniform jitter has no tail; and neither of them
ever does the thing a real bad connection does, which is to be fine for a
second and then stop.

`src/tests/latency-profiles.ts` names five wires. Each is stated as a **round
trip** — the form every net graph, every `ping` and every chess server states
it in — and split evenly across the two hops, so `--profile-down=mobile` is
half of one and is exactly the asymmetry that tells an old board apart from a
late press.

| profile | round trip | jitter | loss | other |
|---|---|---|---|---|
| `lan` | 5 ms | — | — | the control |
| `regional` | 40 ms | ± 10 | — | one hop through a city |
| `continental` | 120 ms | ± 30 | — | coast to coast, or a sea crossing |
| `mobile` | 200 ms | ± 80 | 2 % per hop | 800 ms stalls at 1.5 % per frame, blocking the frames behind them |
| `saturated` | 60 ms base | ± 10 | tail drop | a 25 B/ms bottleneck with a 1,200 ms queue bound |

Three properties of the implementation are what make the measurement mean
anything:

* **Per hop.** `TransportShaping.down` / `.up` are separate hops now. The flat
  fields still mean one wire in both directions, so `03`'s scenes are unchanged.
* **A queue in front of the link, not only a delay on it.** `rateBytesPerMs`
  gives a hop a service rate and `queueMaxMs` a tail drop, so `saturated`'s
  delay **climbs while the turn is talking and drains between turns** rather
  than sitting at a mean. `stallMs`/`stallRate` add a hold that blocks the
  frames behind it — head-of-line blocking, which is what makes a stall feel
  different from a slow link.
* **A seed.** Every loss and jitter draw is a function of `(seed, direction,
  frame index)`; `Math.random` is not called. Two runs of a profile drop the
  same frames and jitter each by the same amount. Without that, "what the
  operator was shown against what was true" measures the weather.

`GameWebSocketServer.transportLedger()` records what the shaping actually did
to every frame — the hold, the queue it waited in, whether it was dropped and
why — and is **empty while the wire is unshaped**, which is the only state
production is ever in.

### 2.2 How the truth is known

The browser, the centaur and the "game server" are one process on one clock and
the wire is injected rather than real. That is normally the harness's weakness
and here it is the instrument's whole basis:

* `Date.now()` means the same thing on both sides of every comparison, so no
  clock estimate stands between the measurement and the answer;
* the injected hold of every frame is written down, so the **true** one-way
  delay at any instant is a lookup and not a model;
* the harness writes the turn's own stamps as they happen (`/dev/truth`:
  produced, arrived, deadline, decision begun, first emission, decision ended).

`scripts/latency-sim.js` opens the shipped page, installs a sampler and a press
driver **inside it** (a `page.evaluate` round trip costs milliseconds and this
samples at 40 Hz — driven from node, the sampling would be a load on the thing
being measured), plays eight turns, and then scores three things:

**Presses.** The operator presses **at the notch and never past it** — inside
the window `(slack, slack + 40 ms]`, so every press the driver makes is one the
surface itself calls safe. The ledger says when that press actually reached the
centaur. A press that landed after the deadline while the surface said it would
land is the failure the whole notch exists to prevent.

**Ladder lag, false alarms and misses.** The true rung is computed by a
**second copy** of the ladder — the same constants, with the page's estimates
replaced by measurements — because an oracle that reused the page's own reading
would be checking the page against itself. Then: how long the shown rung took
to reach a rung the truth had already reached (*lag*); time spent shown-bad
while truly fine (*false alarm*); and time spent shown-fine while truly bad
(*missed* — the one `01-RESEARCH.md` §4 calls the only unacceptable failure).

Two windowing rules, both of which cost the surface credit rather than giving
it any:

* the measured window opens at the first sample where the page has a
  **deadline**, not merely a socket — before a `board-update` has carried one
  the page is honestly working off its 500 ms fallback while the oracle knows
  the real budget, and comparing there compares two budgets rather than two
  readings of one wire;
* the oracle uses **the turn's own budget** (`deadline − arrival`), the same
  quantity the page derives from `turnExpiryTime − serverSentAt`, so the
  thresholds land in the same places on both sides.

### 2.3 The table, before

Eight turns per profile, 1,500 ms turn clock, seed 1, one press per turn at the
notch. `node scripts/latency-sim.js --turns=8`. Raw record:
[`latency/sim/latency-sim-before.json`](latency/sim/latency-sim-before.json).

| profile | RTT held p50/p95 | drops ↓/↑ | max queue | presses | late | refused / of those, would have landed | press cost p50/p95 | notch error p50/p95 | ladder lag p50/max | turn visible after | false alarm | MISSED |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lan | 6/6 ms | 0/0 | 0 ms | 8 | 0 | 0 / 0 | 6/8 ms | -27/-8 ms | 25/100 ms | 531/744 ms | 40.5% (10) | 0% (0) |
| regional | 40/50 ms | 0/0 | 0 ms | 8 | 0 | 0 / 0 | 21/32 ms | -58/-11 ms | 0/100 ms | 553/1182 ms | 43.7% (10) | 0% (0) |
| continental | 122/148 ms | 0/0 | 0 ms | 8 | 0 | 0 / 0 | 66/76 ms | -90/-64 ms | 22/104 ms | 501/1143 ms | 45.5% (11) | 0% (0) |
| mobile | 260/1782 ms | 0/0 | 0 ms | 8 | 0 | 1 / 1 | 140/1041 ms | -109/695 ms | 0/0 ms | 589/862 ms | 52.3% (7) | 8.4% (1) |
| saturated | 3012/8460 ms | 25/0 | 5130 ms | 7 | 0 | 5 / 5 | 33/551 ms | -629/-107 ms | 0/125 ms | 916/1341 ms | 2% (1) | 11.2% (3) |

### 2.4 What the table said

**Finding 1 — the surface cried STALE on every turn of every wire, including
the LAN.** Between **40.5 % and 52.3 %** of every run on the four ordinary
wires was spent shown-STALE while the truth was LIVE, and the diagnosis
breakdown is unambiguous — 207 of the LAN's 220 false-alarm samples carry one
sentence, *no decision frame for N ms, past this turn's deadline*. The cause is
not a threshold. It is the `turn visible after` column: **the operator learns a
turn exists 501–916 ms after the centaur does** (p50; up to 1,341 ms), because
the turn's clock runs out well before the next turn's board is published. So
"no emission past the deadline" is *true* for roughly a third of every turn on
a perfectly healthy wire — and `alerts.js`, which polls the same `read()`, was
raising `wire-stale` on every one of them. An alarm that fires every turn is
furniture, and an operator learns to read past it before it has ever been right.

(`saturated` reads 2 % on this column for a reason worth keeping: its queue is
so deep that the page is *never out of the previous turn's frames*, so it never
reaches the between-turns silence at all. A low false-alarm count is not always
good news.)

**Finding 2 — the notch's estimate has no tail, and the tail is where a press
is lost.** On `mobile` the `notch error` column reads **−109 ms at the median
and +695 ms at the 95th**: the mark is conservative in the ordinary case and
**695 ms optimistic** in the case that loses the turn. An earlier run of this
instrument, whose press driver was allowed to fire at the notch rather than
strictly inside it, lost a press outright on that wire. An average has no 95th
percentile, and `rtt/2 + work` is an average.

**Finding 3 — the ladder is genuinely slow under a growing queue.** `mobile`
spent **8.4 %** and `saturated` **11.2 %** of their runs shown-fine while truly
DEGRADED, and every one of those samples is `LIVE`/`THINKING while DEGRADED`.
The smoothed RTT — an EMA at α = 0.3 over 1 Hz pongs — cannot follow a queue
that grows past five seconds inside two turns, because it is an average of
samples that have already come back. The reading it gives is the queue as it
was. This is the failure `01-RESEARCH.md` §4 calls the only unacceptable one,
and it was the largest single thing the instrument found that round 1 could not
have.

**Finding 4 — the press does not only fly.** Measured press cost reached
**1,041 ms at the 95th on `mobile`** and, in a second run, 2,018 ms end to end
on a `continental` wire whose whole round trip is 124 ms. The press waits for a
**centaur that is in the middle of a decision**, and the page's `serverWorkMs`
estimator does not see it, because the commands it trains on are the ones
answered between slices. This is segment 2 of §1.1 appearing on the operator's
side of the ledger, and it is the deepest of the four findings: **the
last-safe-press question is not a network question.**

**What the table did NOT find, and is worth recording:** the ladder's *lag* is
fine everywhere — p50 between 0 and 25 ms, max 125 ms, one to two ticks of a
10 Hz readout, which is the readout's own cadence and not a defect in the
rules. Nothing in §3 touches the tick rate.

---

## 3. The iterations

Four were designed; all four were built, because the instrument favoured all
four and one of them (a) is the only way to communicate finding 4 at all.

### 3a. Where the turn's time went

A segmented bar of §1.1's eight segments, drawn **inside the existing 15 px
line** of the strip, in the horizontal space between the state word and the
numbers. A second row would have been easier to draw and would have cost thirty
pixels of board on every page that has a socket; the strip's height, and
therefore the board's position, does not move.

* **The ink is ordered by ownership.** Hops and queues are grey and get darker
  the further they are from the operator; the kernel's own work is the ladder's
  own THINKING green (it is the same fact the dot reports); and **the
  operator's own segment is the brightest thing on the bar**, because it is the
  only one a press can move. That ordering *is* rule 1 of §1.6.
* **Estimated and unknown are hatched**, not paled. Paler reads as "less of
  it"; hatched reads as "we did not see it", and the point of the bar is that
  those are different claims. An unknown segment still gets a 2 % sliver — zero
  width would read as "it costs nothing", which is false.
* **It does not normalise to 100 %.** A turn that overran its budget shows a
  bar that fills and stops, because that is what happened.
* **The same bar is in review's why-panel**, off the same four stamps read back
  out of the stored log — and the card says outright that four segments of the
  live decomposition (the game hop, both transport hops, and the operator's own
  think time) are *properties of one connection at one moment* that the store
  does not keep, so they are absent rather than estimated.

### 3b. A jitter-aware notch: a band, not a line

`pressSlackMs` is no longer `rtt/2 + work`. It is the
**`latency.notchConfidence` quantile (default 0.9) of the press costs the page
has actually observed**, taken from the same command acknowledgements that used
to train the EMA — with the modelled `rtt/2 + work` as the floor, so the notch
exists from the first pong and does not need a press to have happened first.

* The **solid notch** sits at the confident end. A press before it lands nine
  times in ten; the old line was right about half the time, and finding 2 is
  what that costs.
* The **band** runs from there back to the median cost, drawn in a flat
  low-opacity wash rather than a tone of the fill: uncertainty is not urgency.
  It **vanishes when the two ends agree**, which is what a steady wire looks
  like — the right amount of ink for a wire with nothing to say.
* `read().pressCost` publishes `{midMs, highMs, confidence, samples}`, so the
  board's own optimistic ink and the turn clock on the board's edge draw the
  same band rather than a second estimate.
* The preference is read through the one store —
  `window.Prefs?.get('latency.notchConfidence', 0.9)` — with a working
  fallback if `prefs.js` has not loaded or is not on the page.

### 3c. Stalls, disconnection, and what can still be done

Three changes, all of them Maister's rule (§1.5) applied literally.

**Which silence this is.** A gap in the frames with the pings still answering
is the *bot thinking*; a gap with the pings unanswered is the *wire holding*.
They ask opposite things of an operator — wait, versus do not press — and the
surface said one sentence for both. `read().gapCause` answers it from a fact
the page already had and was discarding (when a pong last came back), and the
banner says which in words.

**Between turns is not stale.** Finding 1's fix, and the narrowest one that is
honest. The STALE reading is demoted to LIVE **only** when all four hold: the
deadline has passed with nothing since (the STALE condition itself, so this only
ever re-reads that state); the pings still answer; **this turn was answered — an
emission exists and it was before the deadline**; and the silence is still
shorter than a whole budget. Delete any one clause and this becomes the silent
degradation `01-RESEARCH.md` §4 rules out; with all four it is the honest
reading — the turn is over, the board is right, and the next one is on its way.
The banner says *turn N decided — waiting for the next board*.

**What you can still safely do.** `read().advice` is a second line under the
diagnosis, dimmer than it, because the rung is the news and this is the
instruction:

| situation | what it says |
|---|---|
| DISCONNECTED | *nothing you press now leaves this page — the reconnect resubscribes and replays the turn* |
| just reconnected | *reconnected — N turns resolved while you were away, the board on screen is +N ms old* |
| the wire is holding, past the notch | *the wire is holding — a lock issued now will not land this turn* |
| the wire is holding, inside the notch | *the wire is holding — what is on screen is the last thing that got through* |
| DEGRADED but the press still fits | *a lock still lands: N ms of press left* |

The reconnect notice is the one message that is shown **on a good rung**.
Everything else on this surface is suppressed at LIVE — silence is the signal —
but "you were gone and the game moved" is news precisely *because* the wire is
fine again, and a page that comes back silently lies by omission about the turns
it missed.

### 3d. A net graph of the last turns

Twelve bars at the far right of the same line, one per turn, height by round
trip **against the DEGRADED threshold** rather than against the run's own worst
sample — a graph that rescales to its own worst point says nothing about
whether the worst point was bad. A turn that lost a board carries a red foot.

Bars and not a line: a line needs an axis to be read and an axis needs room this
strip has not got, while a row of bars reads as a *shape*. Nothing here animates
in any motion setting — a history that slides is a history that is moving when
the wire is not — so `prefers-reduced-motion` needs no special case beyond the
one `tokens.css` group E already applies to `--dur-lat-arrive`.

The graph is deliberately **not** a peripheral signal. The ladder answers "is it
bad now"; an operator's actual question after a lost press is "has it been
bad", and a rung cannot answer that. This is the smallest thing that lets a
*look* settle it rather than a memory.

### 3e. What it looks like

[`latency/round2/after/09-last-safe-press.png`](latency/round2/after/09-last-safe-press.png),
beside its own before, is in §5. Read left to right along the strip: the rung's
dot and word, then the segment bar (§3a), then the four numbers hard against
the bar's end, then the twelve-turn graph (§3d); the clock track above carries
the fill, the band and the notch (§3b); and the overlay under it carries the
diagnosis and, dimmer, the instruction (§3c). Everything after the dot is for a
reader who has already looked — which is the division `01-RESEARCH.md` §4 asked
for, with three more things on the strip than it had.

### 3f. Considered and not built

* **Compensating the deadline the way lichess compensates a clock.** The game
  server's deadline is not ours to move, and `DEADLINE.md`'s guard already
  spends the only slack there is — in the safe direction only. Recording it here
  so the next person does not go looking.
* **Putting `overshootMs` / `startedLateMs` on the wire.** They would make the
  spend bar able to say *late* as well as *long*, which is a better bar. It is a
  protocol change to `decision.end`'s payload and belongs to whoever owns
  `active-game-manager.ts`, not to this surface. §1.2 names the gap.
* **A worker, a coalescer, or anything else from `03` §2.3.** Unchanged and
  still not built, for the reasons measured there.
* **Making the press estimate include the centaur's decision phase** (finding
  4). The band absorbs it empirically — a press that waited for a slice trains
  the quantile the notch is drawn from — but the page still cannot *say* that is
  what happened, because it cannot see the slice boundary. Naming it here.

---

## 4. The table, after

Same command, same seed, same eight turns, against the surface §3 built. Raw
record: [`latency/sim/latency-sim.json`](latency/sim/latency-sim.json).

| profile | RTT held p50/p95 | drops ↓/↑ | max queue | presses | late | refused / of those, would have landed | press cost p50/p95 | notch error p50/p95 | ladder lag p50/max | turn visible after | false alarm | MISSED |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lan | 6/6 ms | 0/0 | 0 ms | 8 | 0 | 0 / 0 | 4/17 ms | -30/-17 ms | 25/100 ms | 400/798 ms | 17.1% (8) | 1.1% (2) |
| regional | 42/50 ms | 0/0 | 0 ms | 8 | 1 (≤582 ms) | 0 / 0 | 24/1941 ms | -47/1865 ms | 25/100 ms | 452/832 ms | 20.1% (8) | 0.7% (1) |
| continental | 126/148 ms | 0/0 | 0 ms | 8 | 0 | 2 / 2 | 57/1241 ms | -74/718 ms | 50/77 ms | 321/548 ms | 17.2% (7) | 0.4% (1) |
| mobile | 588/1736 ms | 1/0 | 0 ms | 8 | 0 | 4 / 4 | 333/421 ms | -597/-499 ms | 0/200 ms | 422/982 ms | 39.4% (5) | 10.2% (2) |
| saturated | 4412/10652 ms | 29/0 | 6315 ms | 7 | 0 | 6 / 6 | 216/417 ms | -1182/-228 ms | 0/0 ms | 406/1192 ms | 0% (0) | 8.2% (4) |

### 4.1 What moved, and what did not

**The false alarm is the win, and it is a large one.** Every wire improved, and
the three an operator would call healthy improved by more than half:

| | before | after |
|---|---|---|
| `lan` | 40.5 % | **17.1 %** |
| `regional` | 43.7 % | **20.1 %** |
| `continental` | 45.5 % | **17.2 %** |
| `mobile` | 52.3 % | **39.4 %** |
| `saturated` | 2.0 % | **0 %** |

That is §3c's between-turns clause and nothing else. The residual on the
healthy wires — a sixth of the run rather than a half — is the window between
the deadline passing and the demotion's own evidence arriving: the clause
requires *this turn's* first emission stamp, and on a slow down hop that stamp
is itself in flight. It is the correct residual: the page waits for evidence
before it stops alarming, which is the right direction to be wrong in.

**The misses moved in both directions and the honest summary is "not much".**
`saturated` improved (11.2 % → **8.2 %**), which is the outstanding-ping floor
doing what it was built for. `mobile` did not (8.4 % → 10.2 %), and its wire was
also worse in the second run (held RTT p50 260 ms → 588 ms) — on a profile whose
stalls are 1.5 % per frame, eight turns is not enough samples to separate the
change from the wire. **The floor is kept on the `saturated` evidence and on the
argument, not on `mobile`'s number.** The healthy wires went from 0 % to
0.4–1.1 %, which is the price of the between-turns demotion, paid in the two or
three samples where the page demoted a beat before the truth agreed.

**The notch got safer and the retune cost less than 0.9 did.** At 0.9 the band
refused all eight `mobile` presses and **seven of them would have landed**; at
0.75 it refuses four, of which four would have landed. Both are worse than the
old estimator on that wire, which refused one — and both are better on the
failure that matters more, since the old estimator's mark was 695 ms optimistic
in the tail. That trade is the judgement this round makes explicitly, and
`latency.notchConfidence` is where an operator overrides it.

**One press was lost after the change that was not lost before, and it is not
noise.** `regional`, turn 5: press cost p95 **1,941 ms on a 40 ms wire**, 582 ms
past the deadline, and the surface said it would land. No quantile could have
predicted it. The band is a quantile of the press costs this page has *seen*,
and on `regional` every press it had seen cost about 24 ms — a first-ever
1,941 ms block by the centaur's own decision loop is not in that distribution
and cannot be. **This is finding 4 arriving as a limit rather than as an
observation: the last-safe-press mark is bounded by the fact that the client
cannot see a slice boundary.** §3e names the fix and it is not on this surface.

**What the round did not touch, restated:** the ladder's lag (still 0–50 ms
p50), the tick rate, the client cost measured in `03` §1, and the DEGRADED/STALE
thresholds themselves. Every threshold in §3.2 of `03-LATENCY.md` is unchanged;
what changed is one *reading* of the STALE condition, one estimator, and what
the surface says.

---

## 5. Gates

`npx tsc --noEmit -p .` — clean. `npx eslint src/**/*.ts src/web/*.js` — clean.
`npm run build:lens` — clean. `node --check src/web/latency.js` is in the loop
too, for the reason `03` §2.4 gives (this file is not TypeScript and no jest
suite loads it, so a syntax error in it is invisible until the readout is not
there).

**Jest — `src/tests/lens-*`, `src/lobster/__tests__/lens-*`,
`local-game-determinism`: 22 suites, 353 tests, all passing.**

**The operator drills** (`scripts/lens-walkthrough.js`, run against a freshly
started harness): **11 of 11 steps `ok`** — stage, pin, the undo stack's depth
either side of a pin, the stage line, `U` taking the stage back, the named
refusal, the lock arming and firing, the widen banner, and undo popping exactly
one determination. Zero page exceptions. The eight console errors are the
harness's own (`firebase-status: not_configured`, two 404s on the replay route)
and are present on the base build too.

**The pixel gate — a PAIR of walks, base and branch, on freshly started
servers, differenced shot by shot with `scripts/lens-png-diff.js`:**

* **All 40 element shots are byte-identical — 0 differing pixels.** That
  includes every rail and panel shot (`03b`, `03d`, `04`–`10`, `12`–`14`,
  `16`, `16b`, `17b`, `19b`, `21a`, `21b`), three of the four board shots
  (`03c`, `05b`, `13b`, `19c`), all ten drill shots (`d1`–`d5` and their
  control crops), the two key-scheme crops, and — the one that matters most
  here — **`d8-clock-notch.png`, the notch drill's own close-up of the clock
  track, at 0 pixels.** The notch has not moved on an unshaped wire, which is
  exactly what §3b predicts: with a free wire the observed press costs are all
  the same and the band collapses onto the line it replaced.
* **All three REPLAY full-page shots are 0** (`18`, `19`, `20`) — a replayed
  game opens no socket, the mount stays empty and `#latency-mount:empty` takes
  it out of flow, so the page is byte-for-byte the page it always was. That is
  round 1's `:empty` rule still holding after round 2 added three elements to
  the strip.
* **`08b-foil-board` differs in a three-row band at the top** (rows 2–4) and
  the six LIVE full-page shots differ by 0.25–1.1 %. A full-page comparison
  across two separately started servers is not a controlled comparison — the
  two walks drive live sockets whose ages, chip contents and hover timings
  differ by construction — which is why `03` §2.4 made the element shots the
  gate, and they are the gate here.
* **`d9-tour-last` differs by 10 %**, in two bands. It is the tour's last-step
  spotlight, and the tour steps through elements whose contents this branch
  changed. Recorded rather than explained away; the tour belongs to another
  owner and a merge should re-take that shot.

**The intended change, photographed.** `node scripts/lens-latency-shots.js
--only=slow`, run once on the base build and once on this one, same scene
(`--latency=500 --jitter=60 --turn-timeout=3000`):

| | before | after |
|---|---|---|
| past the last safe press | [`round2/before/09-last-safe-press.png`](latency/round2/before/09-last-safe-press.png) | [`round2/after/09-last-safe-press.png`](latency/round2/after/09-last-safe-press.png) |
| DEGRADED on a slow wire | [`round2/before/06-degraded-rtt.png`](latency/round2/before/06-degraded-rtt.png) | [`round2/after/06-degraded-rtt.png`](latency/round2/after/06-degraded-rtt.png) |

The `09` pair is the clearest statement of what this round did. Before: a bar,
four numbers, and one sentence — *1633 ms round trip — a press needs 1181 ms to
land · a lock issued now may not land this turn*. After, on the same scene: the
segment bar sits between the state word and the numbers, the twelve-bar net
graph sits at the far right of the same 15 px line, and the banner has gained
its second, dimmer line — *a lock still lands: 1296 ms of press left*. The
strip's height is unchanged and the board below it has not moved.

**The instrument** — `node scripts/latency-sim.js --turns=8` — runs clean on
all five profiles, before and after, and its two records are committed under
[`latency/sim/`](latency/sim/).



### 5.1 What a merge must check

1. **`src/server/websocket-server.ts` is production code and this round changed
   its send path.** The change is per-hop shaping, a seeded RNG and a ledger,
   and all three are behind the same `shaping === null` check that has always
   been there — production installs no shaping, writes no ledger rows and pays
   one null check per frame, exactly as before. A merge should confirm that
   `shapeTransport` still has exactly one caller
   (`src/tests/lens-walkthrough-server.ts`) and that nothing in `src/index.ts`
   or the config store can reach it.
2. **`read()`'s `pressSlackMs` changed meaning** — it is now the confidence
   quantile rather than the mean. `alerts.js` does not read it; the board's
   optimistic ink and the board-edge turn clock are the two surfaces `03` §4.5
   left it exported for, and if either has since started drawing it, it now
   draws a more conservative mark. That is the intended direction, but it is a
   behavioural change to a published field and should be noticed rather than
   discovered.
3. **`alerts.js` will raise materially fewer `wire-stale` alerts** — that is
   §3c's whole point, and `06-ALERTS.md`'s counts were taken before it. The
   alert suites should be re-run and its noise figures restated.
4. **`tokens.css` gained one group** (`--lat-seg-*`, `--clock-band`,
   `--lat-hist-*`) and `chrome.css` one block (`.rv-spend`). No existing token
   changed value.
5. **The pixel gate.** See §5's shot list: the strip's own height is unchanged
   by design, so element shots must be zero-diff and the full-page LIVE shots
   should differ only inside the strip's own row.
6. **The sim is not a jest gate and should not become one.** It starts five
   servers and a browser and takes minutes; it is a designed experiment, run
   deliberately, and its record is committed so the next round can diff against
   it rather than re-run it.
