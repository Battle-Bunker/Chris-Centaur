# 06 — ALERTS: what pulls the operator back, and what it is allowed to cost

UX, document 6. `01-RESEARCH.md` established that the periphery reads
brightness and motion rather than text or colour, and that the first 300 ms of
a turn is one preattentive glance. `02-IA-AND-CONTROLS.md` built the surfaces
that glance lands on — the clock bar on the board's edge, the stage line, the
unfinished-business strip, the two full-size cards. `03-LATENCY.md` put a
ladder and a last-safe-press notch on the wire.

**Every one of those assumes the operator is looking at this window.** They are
not, often. They are reading a breakdown table, or watching the other screen,
or in another tab entirely while the bot plays out a quiet stretch. This
document is the channel for the moments when something demands them anyway:
a unit one turn from a fatal cell with nothing pinned, the clock past the
last-safe-press notch with business unfinished, the wire dropping to DEGRADED
or STALE, a press the server refused, the bot taking back a unit the operator
had determined.

It is the only surface in this design allowed to spend attention nobody
offered. So it is also the only one with a budget, a mute, and a per-event
opt-out — and this document spends as many words on what stops it firing as on
what makes it fire, because the literature in §1 is unanimous that the second
is the easy half.

Built as `src/web/alerts.js`, one module, no framework, mounted at
`<div id="alerts-mount">`. Drilled by `scripts/alerts-drill.js` — 46 checks,
three scenes, a failed assertion failing the run — whose output is in
`docs/design/ux/alerts/`.

---

## 1. The evidence

### 1.1 An alert channel dies of being right too often, not of being wrong

This is the finding that shaped every threshold below. In en-route air traffic
control, 62% of Conflict Alerts and 91% of Minimum Safe Altitude Warnings are
unnecessary ([Friedman-Berg, Allendoerfer & Pai,
2008](https://doi.org/10.1177/154193120805200123)); a Western African upper
airspace study classified **313 of 315** Short Term Conflict Alerts as false,
after which 73% of controllers surveyed reported *increased* workload and 38%
reported *reduced* situation awareness
([Diack, Blundell & Li,
2024](https://publications.ergonomics.org.uk/uploads/The-Impacts-of-Systematic-False-Alarms-on-Air-Traffic-Controllers-Situation-Awareness.pdf)).
Interestingly, Wickens et al. found *no* classical "cry wolf" delay in ATC
response times at a 45% false rate
([2009](https://doi.org/10.1177/0018720809344720)) — the damage shows up as
workload and as trust rather than as a slower press. Either way the remedy is
the same, and it is not "make the alerts louder".

**What we took from it.** Every event in §2 is a condition the operator would
act on, not a condition that is merely unusual; and three of the six carry an
explicit *suppression* clause — a fatal move the operator consented to, a
change the operator pressed for, a rung the page reads for two seconds on
every single page load — because a channel that fires on those is a channel
that has taught its operator to mute it before it has ever been right.

### 1.2 Rate: the shape of the rule, not its base

EEMUA 191's 1998 origin survey put an acceptable steady-state load at **one
alarm per operator per ten minutes**; ISA-18.2 (2009) quoted ~150 a day, IEC
62682 ~144, and the family converges on **≤12 an hour** as the long-term
maximum a person can manage, with **>10 in 10 minutes** as the conventional
definition of a flood
([Chemical Engineering, *Alarm Management By the
Numbers*](https://www.chemengonline.com/alarm-management-numbers);
[Dubois, *The Sense and Nonsense of Alarm System Performance
KPIs*](https://www.processvue.com/downloads/Alarm_system_performance_KPIs_V1_0.pdf)).
ISA-18.2 dropped the per-day KPI in 2016 precisely because it was being
translated between time bases it did not survive.

That translation is exactly the trap here: our operator's unit of time is a
**500 ms turn**, not an eight-hour shift, and one alarm per ten minutes on a
500 ms turn is one alarm per 1,200 turns, which is silence. So we took the
*shape* — a per-condition cooldown, a flood ceiling, a rule that averages hide
floods — and rebased it on the turn, exactly as `03-LATENCY.md` §3.2 rebased
every staleness threshold as a fraction of the turn budget rather than as an
absolute millisecond count. §4 has the numbers.

### 1.3 Earcons, not speech

The meta-analysis is unusually clear-cut. Nees & Liebman synthesised the
literature comparing auditory icons, earcons, spearcons and speech across
accuracy, reaction time, subjective rating, workload and **dual-task
interference**
([2023](https://doi.org/10.1080/25742442.2023.2219201)); speech and spearcons
win on accuracy and reaction time *when the listener has nothing else to do*,
and the dual-task picture is what decides it for us. Our operator's competing
task is **reading** — a rail of ranked movesets, a breakdown table, a stage
line. Speech competes with reading for the phonological loop in a way a tone
sequence does not, and it competes directly with a screen reader for the same
output device (which WCAG 1.4.2's whole intent is about).

There is a real counter-argument: Edworthy's more recent work shows *auditory
icons* — sounds with an ecological relationship to their referent — beating
abstract tones in clinical alarms
([2025](https://dael.euracoustics.org/confs/fa2025/data/articles/000375.pdf)).
We did not take it, for a reason specific to this domain: there is no everyday
sound of "a unit is one turn from a cell it cannot survive". An icon with no
ecological referent is an earcon wearing a costume, and it costs an asset
fetch — over the network, at the moment the alert may be *about* the network.

### 1.4 Urgent but not startling, in parameters

Edworthy, Loxley & Dennis established that perceived urgency is carried by
fundamental frequency, harmonic series, amplitude-envelope shape, **speed,
rhythm, pitch range and melodic structure** — and that a warning set's urgency
ordering can be *predicted* from them
([1991](https://doi.org/10.1177/001872089103300206);
[Hellier, Edworthy & Dennis, 1993](https://doi.org/10.1177/001872089303500408)).
Later work confirms urgency is non-monotonic in pulse rate, with maxima well
away from the extremes ([Russo & Jones,
2021](https://doi.org/10.32920/14639772)), which is a warning against "make it
faster to make it more urgent".

Two design consequences, both in §3.2. First, our three priorities differ in
**rhythm and pulse count** first and pitch second, because rhythm survives a
laptop speaker and a noisy room where a 200 Hz pitch difference does not.
Second, *startle* is a property of the **onset**, not of the level: every pulse
has an 18 ms attack ramp rather than a step, nothing is a square wave, and
nothing peaks above 0.09 of full scale. A sound can be unmistakable at a level
that does not make anyone jump, and the whole motif is under 600 ms.

### 1.5 What games do, and what we borrowed

RTS is the closest live analogue: an operator on a clock, most of the state
off-screen. StarCraft II's answer is a three-part one — a spoken line, a
minimap ping, and an **alert stack** the player can jump to with a key
([the stack behaves as a ring rather than a
queue](https://gaming.stackexchange.com/questions/350945/how-does-the-alarm-stack-in-starcraft-ii-work)),
plus per-category volume controls, which exist because players demonstrably
turn them down. The community's long argument about the redesigned idle-worker
indicator ([TL.net,
2013](https://tl.net/forum/starcraft-2-hots/397665-new-idle-worker-button-is-too-hard-to-notice))
is a nine-page demonstration of `01-RESEARCH.md` P1's peripheral rule: an
indicator that changes only in colour and only in a fixed HUD slot is an
indicator nobody sees mid-fight.

We borrowed the **per-category control** and the **two-channel encoding** and
deliberately did not borrow the **jump-to-alert key**: a key that moves the
board or the cursor is a key that can change a decision, and §0's rule is that
this channel never does. We also did not borrow the spoken line — see §1.3.

Trading desks make the same trade the other way round and are instructive for
it: order-flow sonification is *continuous* and unthresholded
([Janata & Childs, *Marketbuzz*,
ICAD 2004](https://icad.org/websiteV2.0/Conferences/ICAD2004/papers/janata_childs.pdf)),
because a trader monitors a stream with no natural events. Ours has events —
a turn, a refusal, a fatal cell — so a continuous soundtrack would be a worse
fit *and* an unmutable one. Allspaw's summary of Woods on alarms is the
sentence we kept nearest: an alert is *directed attention*, and its designer
cannot know the context the receiver is in
([*Owning Attention*,
2013](https://www.kitchensoap.com/2013/07/22/owning-attention-considerations-for-alert-design/)).
Hence: every event opt-out-able, individually.

### 1.6 Accessibility, as hard constraints

| | requirement | what we do |
|---|---|---|
| **WCAG 2.3.1** Three Flashes or Below Threshold (A) | nothing flashes more than three times in any one second, or stays under the general and red flash thresholds; applies to *all* content on the page ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)) | one ring onset per 700 ms *floor* — a hard ceiling of ~1.4 a second, less than half the limit — and the ring is a 3–5 px border at moderate luminance, never a saturated red and never a full-screen wash, so it is under the area/luminance thresholds independently |
| **WCAG 1.4.2** Audio Control (A) | audio playing automatically for >3 s needs a stop, or a volume independent of the system's ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html)) | no motif exceeds 600 ms, so the criterion does not bind — *and* there is a master mute and an independent volume anyway |
| `prefers-reduced-motion` | a transient is itself the thing being opted out of | the ring's transitions are removed entirely; it appears, holds 1.5 s, and is removed. No fade — a fade is motion |
| screen readers | the ring and the motif carry nothing for a non-sighted operator | a fourth channel: a `role="status" aria-live="polite"` region carrying each alert's own sentence. **Polite, never assertive** — an assertive region interrupts the row being read, which on a 500 ms turn is worse than missing the alert |

### 1.7 What the browser will and will not let us do

Two platform rules that are design inputs, not implementation details.

**An `AudioContext` created without user activation starts suspended.** Chrome
shipped this for Web Audio in Chrome 71
([policy](https://developer.chrome.com/blog/web-audio-autoplay),
[intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/5Y1BqbGauEs));
`resume()` only takes effect after activation. A channel that created its
context at load and never resumed it would be *silently* dead — the exact
failure mode an alert channel may not have. So the context is created on the
first `pointerdown` or `keydown` on the document, the popover's **Test sound**
button is a second explicit opportunity, and the module reports its own
audibility in every log record (`suppressed: ['silent']`) rather than
pretending.

**Notification permission must be asked for on a gesture.** MDN is explicit
that consent should only be requested in response to a user gesture and that
browsers are moving to disallow otherwise
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API));
Chrome's own data is that a gesture makes a grant 3–4× more likely, and Chrome
now suppresses prompts from sites with poor grant rates
([web.dev](https://web.dev/articles/permissions-best-practices)). A prompt on
page load is reflexively blocked, and a block is permanent until the user digs
into browser settings. So permission is requested **only** from the popover's
*Desktop alerts* button, and never otherwise.

---

## 2. The catalogue

Six events. Nothing may interrupt that is not on this list, and every row names
the signal it is read from — all of which are envelopes `play-game.html`
already handles or numbers `LatencyView` already computes. **No new socket
message type was added**, and that is a robustness property rather than
tidiness: an alert channel that needs the server to tell it when to shout stops
working at the moment the server is the thing that is wrong.

| event | source signal, in our code | priority | channels | cooldown |
|---|---|---|---|---|
| `fatal-unpinned` | inbound `fatal-move-confirmation-needed` (the server refused an unconsented certain-death press), **or** `stagedMoves[u].fatal === true && committed !== true` on `board-update` / `selections-update` with `activeIntentModes[u] !== 'manual'` | 1 | pulse · earcon · notification when hidden · live region | 2 turns, floor 1.5 s |
| `press-window` | `LatencyView.read()`: `remainingMs > 0 && remainingMs ≤ pressSlackMs`, with at least one unit whose staged move is not `committed` | 2 | pulse · earcon · live region | 1 turn, floor 1.2 s |
| `wire-stale` | `LatencyView.read().state` enters `STALE` or `DISCONNECTED` | 2 | pulse · earcon · notification when hidden · live region | 4 turns, floor 2.5 s |
| `wire-degraded` | `LatencyView.read().state` enters `DEGRADED` | 3 | pulse · earcon · live region | 6 turns, floor 4 s |
| `lock-refused` | inbound `lens-lock` with `ok:false`; `toggle-hold-result` with `ok:false`; `selection-contested`; `selection-revoked` | 2 | pulse · earcon · notification when hidden · live region | 1 turn, floor 0.9 s |
| `stage-drift` | `board-update` / `selections-update`: a unit with `activeIntentModes[u] ∉ {heuristic}` whose `stagedMoves[u].source` is `bot`/`fallback`, or whose `requestedMove` changed *within the turn* — and which the operator did not press on | 3 | pulse · earcon · live region | 2 turns, floor 1.5 s |

Three of these carry a **suppression clause**, and they are the rows §1.1 is
about:

* **`fatal-unpinned` is silent when `activeIntentModes[u] === 'manual'`.** That
  mode means the operator went through the consent dialog to put the unit
  there. Shouting at someone for a decision they confirmed one press ago is
  the fastest way to teach them the channel is wrong. The alert is for a fatal
  cell **nobody chose** — the bot's own staging, or a waypoint fallback, or a
  press the server refused.
* **`stage-drift` is silent for the operator's own press.** The module watches
  the *outbound* envelopes too (`select-move`, `set-waypoint`, `toggle-hold`,
  `lens-lock`, `clear-human-input`, `commit-all-staged`) and marks the units
  they name as touched for the turn. A move the operator asked for is not the
  bot taking a unit back.
* **`stage-drift` is silent across turn boundaries for a mere change.** Every
  turn restages every unit, so a move that differs from *last* turn's is the
  ordinary operation of a standing waypoint. What is news is a change **inside
  one turn** with no press of the operator's behind it, or the source falling
  back to the bot at all.

And one more, which is not a clause on a row but a rule for the whole ladder:
**nothing is alerted before the wire has ever been up.** `LatencyView`
correctly reads `DISCONNECTED` for the second or two between the page loading
and the socket opening. An alarm every operator hears on every page load is the
textbook nuisance alert, so the ladder is only alerted on once a `board-update`
has arrived. After that, a close is real news and is treated as such.

---

## 3. The channels

### 3.1 The ring — one transient at the board's edge

`01-RESEARCH.md` P1's peripheral rule says the periphery reads motion and
brightness. The ring is both: a border that appears and decays around the
canvas's own box, weight and opacity carrying priority, hue only ever a second
reading of it.

Three properties it has because of where it is drawn:

* **Over the board, not beside it.** An alert that reflows the page has moved
  the thing the operator was about to click. It is `position: fixed` and sized
  from `#gameCanvas`'s bounding rect *at pulse time*, never cached, so it
  tracks every size the resize grip can drag without owning one of the board's
  own styles. With no canvas it falls back to the viewport's edge.
* **`pointer-events: none`, always.** The channel cannot block input; the drill
  asserts the computed style.
* **A root-level layer, and the first photograph is why.** It was inside
  `#alerts-mount` and therefore inside `.header`, which is
  `position: fixed; z-index: 1000` — a **stacking context**. A child of it with
  `z-index: 2500` is still painted underneath the page's own consent dialog at
  2000, because 2500 only orders it against its siblings inside the header.
  The fatal alert fires at exactly the moment that dialog is up, so the ring
  was, in the one case that matters most, drawn beneath the thing it was about.
  It is appended to `document.body` now, at z-index 2500: above the page's
  modals, below the login gate (3000), which is not a game state.

Under `prefers-reduced-motion` every transition is removed and the hold is
extended: it appears, stays, and goes. A fade is still motion.

### 3.2 The earcon — three motifs, synthesised

| priority | motif | notes | peak gain | duration |
|---|---|---|---|---|
| 1 | three quick rising pulses | F♯5 · A5 · C6 (740 / 880 / 1046.5 Hz), 130 ms apart | 0.09 | ~470 ms |
| 2 | two falling pulses | D♯5 · C5 (622.25 / 523.25 Hz), 155 ms apart | 0.075 | ~380 ms |
| 3 | one low note | G♯4 (415.3 Hz) | 0.055 | ~250 ms |

Triangle oscillators through a gain node, no assets, nothing fetched. The
motifs differ in **rhythm and pulse count** first (§1.4), so they are still
three different things on a bad laptop speaker where the pitch difference is
mush. Every pulse ramps in over 18 ms rather than stepping — startle lives in
the onset — and decays exponentially over 70 ms. Peak gain is further scaled by
the operator's own volume preference.

The context is created on the first `pointerdown`/`keydown`, and `resume()`d if
suspended (§1.7). Before that the ring and the live region still work, and the
log records `silent` rather than lying.

### 3.3 The notification — only while `document.hidden`

A system notification for a page the operator is looking at is a duplicate of
something already on screen and costs a dismissal. This channel exists for the
operator who is in another window, so it is gated on `document.hidden === true`
and on permission having been granted through the popover's own button.

One notification per event id, via `tag` — a *replaced* notification is one
interruption; a stack of six is a flood the operator has to clear before they
can act. `silent: true` is set on every one: the earcon is this module's sound,
and the OS should not add a second.

Three events carry notifications by default (`fatal-unpinned`, `wire-stale`,
`lock-refused`); the other three can earn one by escalating (§4).

### 3.4 The live region — the channel that costs nothing

Every alert's sentence is written into a visually-hidden
`role="status" aria-live="polite"` region in the mount. An operator on a screen
reader gets neither the ring nor the motif, and the text the alert already
carries is exactly what they need. Polite and never assertive, for the reason
in §1.6.

---

## 4. Escalation and rate limiting

Every limit, in one table. The per-event cooldowns are in §2.

| limit | value | why |
|---|---|---|
| per-event cooldown | `max(gapMs, gapTurns × turn budget)` | §1.2's shape, rebased on the turn as `03-LATENCY.md` §3.2 rebases the ladder. A standing rung is polled four times a second and asked to raise dozens of times; it raises once per cooldown and **counts** the rest |
| ring onset floor | 700 ms | WCAG 2.3.1 allows three flashes a second; this caps at ~1.4 |
| ring hold | 900 ms (1.5 s under reduced motion) | long enough to catch a returning eye, short enough not to become furniture |
| earcon floor | 700 ms | two motifs never overlap or run together into one unreadable sound |
| earcons per turn | 2 | a turn that needs three things said out loud is a turn already lost; the third is still raised, still pulsed, still logged |
| earcons per rolling minute | 8 | the flood ceiling — what catches a wire that flaps |
| escalation | 3 consecutive turns | see below |
| glance suppression | 300 ms | see below |

**Escalation is by turn count, and it does not repeat.** A condition standing
for three consecutive turns escalates one priority step: the motif gains a
pulse, and a hidden tab earns a notification it would not otherwise get. It
does **not** get louder, and it does **not** repeat faster. A repeating alarm
is the precise mechanism by which alarms stop being heard, and every source in
§1.1 says so. The streak is counted in turns rather than in raisings, and a
raising whose key changed is a different condition starting its own count.

**The glance rule, and exactly how far it reaches.** `01-RESEARCH.md` P1 names
the four things a preattentive glance at a fresh board answers: time left,
unfinished business, freshness, and where attention was. Three of this
catalogue's events *are* those readings — `press-window` is the clock,
`wire-stale` and `wire-degraded` are freshness — so an earcon for one of them
inside the first 300 ms of a turn buys a saccade that is already being made,
and is spent on nothing. Those three are pulse-only inside the glance.

The other three are **not** on P1's list, deliberately: `02 §2.2` refuses to
put a fatal count in the unfinished-business strip at all, on the ground that
fatality is knowable only for a move the server has been asked to stage; and a
refusal and a drift are facts about a *press* rather than about the board.
Those always sound. And nothing is suppressed by the glance while the tab is
hidden — there is no glance to ride.

Every refusal is counted, never silently dropped. `Alerts.stats()` reports
`suppressed: { off, cooldown, budget, muted, glance, flash, silent }` and every
log record names the budgets that refused it, which is what makes §7's
assertions about silence possible at all.

---

## 5. Preferences

`localStorage['centaurAlerts']`, behind a popover on an `ALERTS` button in the
header:

* **Mute all sound** — the master. It takes the earcon and leaves the ring, the
  notification and the live region. This is the WCAG 1.4.2 mechanism, and it is
  also the thing the operator reaches for at 3 a.m.
* **Volume** — 0–100%, independent of system volume (1.4.2's other arm).
* **One checkbox per event** — §1.5's lesson from Woods via Allspaw: the
  designer cannot know the receiver's context, so the receiver narrows the
  channel rather than muting it whole. A channel that can only be turned off
  entirely *is* turned off entirely.
* **Test sound** — the only place this module makes a noise nobody asked for,
  one press from the volume slider, and a second chance for the audio context
  to be unlocked by a gesture.
* **Desktop alerts** — the only place `Notification.requestPermission()` is
  called (§1.7). The note under it states the permission's current value and
  that alerts fire only while the tab is hidden.

Every read and every write is inside a `try`/`catch`: a locked-down profile is
not an error, and the preference still holds for the life of the page. The
drill asserts that mute, volume and a per-event opt-out all survive a reload.

The popover opens **right-anchored** under the button, which is the second
defect the camera found: the mount is at the end of the header row, and a
popover opening leftwards from there ran off the page.

---

## 6. What the wire does not carry

Three facts this module wanted and could not have. Each is reported here with
the proxy used instead, because a proxy that is not written down becomes a
claim nobody can check.

**1. There is no `pin` on the wire.** The lens's own notion of a determination
lives in the frame's `partition[].boundedBy`, reachable only by folding
`lens-frames` events — `src/lens/types.ts` says outright that `UnitRow.fixity`
is derived from `pin`/`commit` events "which nothing on the wire writes today",
and `lens-panel.js`'s lane comment says the same from the other side ("no
`pin` / `unpin` row existed to carry an operator"). *Proxy:* "pinned" is read
as `stagedMoves[u].committed === true` (the turn has frozen it) or
`activeIntentModes[u] !== 'heuristic'` (the operator has issued a standing
determination). Both are on every broadcast. This is weaker than the lens's own
answer and is the one place the alert channel could disagree with the rail.

**2. `window.__lensLastSafePressMs` has no producer.** `play-game.html`'s
`updateTurnClock` draws the last-safe-press notch from that global and
correctly omits the notch while nothing sets it — and **nothing sets it**:
`latency.js` computes `lastSafePressAt` and `pressSlackMs` and exposes them
through `LatencyView.read()`, but never writes the global the clock reads. So
the notch `02 §2.1` designed is, as shipped, always absent. This module reads
`LatencyView.read()` directly and is unaffected, but the notch on the board's
edge is one assignment away from existing and does not exist. It belongs to
whoever owns `latency.js` and `play-game.html`'s clock, so it is reported here
rather than fixed.

**3. `stagedMoves` is empty in the walkthrough harness until an operator
presses.** `getStagedMovesForGame` skips a controlled snake with nothing
staged, and `lens-walkthrough-server.ts` steps the game itself rather than
through `ActiveGameManager`'s staging pipeline. So "unfinished business" is
zero there by construction until a press. This is a harness property and not a
product one — in a real game every controlled snake is staged every turn — but
it is why the drill stages a move before it can test `press-window` at all.

A fourth, smaller one, found by the camera: with Firebase unconfigured,
`firebase-status-banner.js` holds a fixed banner across the top of the page
that **intercepts pointer events aimed at the header**, including this
module's own button. That is the page's own furniture and not this module's to
move; the drill dispatches the click instead.

---

## 7. The drill

`scripts/alerts-drill.js`, three scenes, one walkthrough server per scene (the
injected wire is fixed at construction, and operator names are unique per game
— `02 §4.2`'s two rules). **46 checks; a failed assertion fails the run.**

```
node scripts/alerts-drill.js --out=docs/design/ux/alerts --port=5192
```

The `AudioContext` and `Notification` are replaced by recorders through
`page.addInitScript` before a single page script runs, so the assertion is on
the **call** — three rising notes for a priority-1 motif — and the box needs no
sound card. `document.hidden` is made settable the same way, which is the only
way to test the "only while hidden" rule on a headless page whose visibility
the automation harness itself owns.

### 7.1 What it triggers, and how

| event | how the drill produces it |
|---|---|
| `wire-degraded` | `--latency=880 --jitter=40` on a 4,000 ms budget: a round trip worth more than a third of the budget is DEGRADED by the ladder's own rule |
| `press-window` | the same wire (on a free one the slack is `rtt/2 + work` ≈ 20 ms and the window is half a percent of the turn — which is *why* the notch needed injected latency in `03` too), plus a real staged move so there is something unfinished. Caught the way `lens-latency-shots.js` catches a short rung: step **without awaiting**, so the poll is already running when the clock starts |
| `wire-stale` | stop stepping and let the deadline pass unfed |
| `fatal-unpinned` | a real `select-move` naming the direction that walks the head off the board (or, from an interior cell, back onto its own neck). The server declines to stage it, stages the bot's instead, and answers `fatal-move-confirmation-needed` — the shipped refusal on the shipped wire |
| `lock-refused` | a real `lens-lock` naming a unit this centaur does not control: one of the two things `websocket-server.ts` refuses, answered `ok:false` with its own words |
| `stage-drift` | the two envelopes handed to the module's input port, in the shape `getStagedMovesForGame` broadcasts |

Two cases are driven through `Alerts.observe()` with hand-built envelopes
rather than off the live wire, and the drill labels them as such: a
**bot-staged fatal move** (this harness cannot be made to trap a snake on
demand) and **stage drift** (the waypoint fallback is not reproducible to
order). Both assert the *mapping* — which is the half a drill can prove — on
the exact envelope shape `active-game-manager.ts` sends.

### 7.2 What it asserts about silence

This is the half §1.1 is about, and it is the larger half of the drill:

* a standing rung raises **≤1 more time in 2 s**, and the refusals are
  *counted* rather than dropped;
* **no two earcons closer than 700 ms**, measured across everything raised in
  the scene;
* six raisings inside one turn, spaced wider than the earcon floor so that
  floor is not what is being measured, sound **at most two** of them — *and at
  least one*, so the per-turn cap and not silence is what stopped the rest.
  All six are still raised, still pulsed, still logged;
* twelve raisings over 2.9 s produce **4 ring onsets** — under WCAG 2.3.1's
  three a second — *and at least two*, so the check is not vacuous;
* **mute** takes the earcon and leaves the pulse, and the muted alert says so
  in its own record;
* a **switched-off event** raises nothing at all — the log does not grow;
* **no notification while the tab is visible**, one once it is hidden, and
  every one carries a `centaur-alert-*` tag;
* a fatal move the operator **consented to** raises nothing;
* a change the operator **pressed for** is not reported back to them as drift;
* a waypoint the bot is **honouring** is silent;
* the ring **does not animate** under `prefers-reduced-motion` (computed
  `transition-duration: 0s`) and is `pointer-events: none; position: fixed`;
* mute, volume and the per-event opt-out **survive a reload**.

### 7.3 The pictures

Six, in `docs/design/ux/alerts/`, with `report.json` carrying every check, its
evidence, and the ring's own state on **both sides** of each capture — the
discipline `lens-latency-shots.js` arrived at the hard way, because this
surface redraws four times a second and a caption naming a state must be
checkable against the surface's reading before and after the bytes were taken.

| | |
|---|---|
| `01-degraded.png` | the ladder at DEGRADED, the ring on the board's edge at priority 3 |
| `02-notch.png` | past the last-safe-press notch on a slow wire. Named for what it *catches* rather than for what raised it: the notch and the STALE raising land within the flash floor of each other here, so the ring the camera finds up is usually the notch's and the STALE pulse is the one the budget refused — which is the budget working |
| `03-prefs.png` | the popover: master mute, volume, six event rows, the two buttons |
| `04-fatal.png` | a unit one turn from a fatal cell with nothing pinned — the priority-1 ring drawn **over** the consent dialog that fires alongside it |
| `05-refused.png` | a lock the server refused |
| `06-reduced-motion.png` | the ring under `prefers-reduced-motion` |

### 7.4 Two defects the camera found

Both are in §3.1 and §5 above; recorded together here because neither was
visible in any amount of reading:

1. **The ring was painted under the modal it was about.** `#alerts-mount` sits
   inside `.header`, which is a stacking context at `z-index: 1000`; a ring
   inside it could not rise above the consent dialog at 2000 whatever z-index
   it was given. Moved to a root-level layer.
2. **The popover opened off the right edge of the page.** The mount is at the
   end of the header row; the popover was left-anchored. Right-anchored now.

### 7.5 Gates

`npx tsc --noEmit -p .` clean · `npx eslint "src/**/*.ts"` clean ·
`node --check src/web/alerts.js` clean · `npm run build:lens` byte-identical ·
`npx jest --maxWorkers=2 "src/tests/lens-" src/tests/local-game-determinism.test.ts`
— 16 suites, 277 tests, all passing · the drill itself, 46/46, no page
exceptions.

---

## 8. What was rejected

**Speech, and spearcons.** §1.3. The operator's competing task is reading; a
spoken phrase competes for the same channel and for the same output device as
a screen reader, and does not fit inside a 500 ms turn.

**Auditory icons.** §1.3. Better than tones in clinical alarms, but there is no
everyday sound of "a unit is one turn from a cell it cannot survive", and an
icon without an ecological referent is an earcon that costs an asset fetch —
over the network, at the moment the alert may be about the network.

**A repeating or escalating-in-volume alarm.** §4. Every source in §1.1 says
this is how a channel is destroyed. Escalation here adds a *pulse* and a
notification, once, and never a repetition.

**A modal, a toast, or anything that takes focus.** `03-LATENCY.md` already
established that a modal on a 500 ms clock is a lost turn. This channel never
focuses, never scrolls, never opens a dialog, never sends on the socket and
never changes what is staged: an alert that could change a decision is a
decision made by the alarm.

**A jump-to-alert key**, StarCraft's alert stack. §1.5. A key that moves the
board or the cursor can change a decision, and it would collide with a keymap
`02 §2.4` spent a document unifying. If it is ever wanted, it belongs to
whoever owns the keymap.

**A new socket message type.** §2. The server telling the client when to shout
would be simpler and would fail exactly when the server is the problem. Every
event is derived on the client from envelopes that already arrive.

**A `fatal` segment in the unfinished-business strip.** Not ours to add —
`02 §2.2` refused it deliberately, on the ground that fatality is knowable only
for a move the server has been asked to stage, so a `0 fatal` would be a count
nobody took. The alert fires on the fatal move that *does* exist; the strip
still does not claim a count.

**Colour as the alert's carrier.** `01-RESEARCH.md`'s peripheral rule and
`02 §2.5`'s hue audit both close this off: the board's qualitative palette is
already past any safe set. The ring carries priority in **weight and
luminance**; hue is a second reading of it and never the only one.

**Requesting notification permission on load.** §1.7. Reflexively blocked,
permanently.

---

## 9. Sources

* Nees, M. & Liebman, E. (2023). [*Auditory Icons, Earcons, Spearcons, and Speech: A Systematic Review and Meta-Analysis of Brief Audio Alerts in Human-Machine Interfaces*](https://doi.org/10.1080/25742442.2023.2219201). *Auditory Perception & Cognition*.
* Edworthy, J., Loxley, S. & Dennis, I. (1991). [*Improving Auditory Warning Design: Relationship between Warning Sound Parameters and Perceived Urgency*](https://doi.org/10.1177/001872089103300206). *Human Factors* 33(2).
* Hellier, E., Edworthy, J. & Dennis, I. (1993). [*Improving Auditory Warning Design: Quantifying and Predicting the Effects of Different Warning Parameters on Perceived Urgency*](https://doi.org/10.1177/001872089303500408). *Human Factors* 35(4).
* Russo, F. & Jones, J. (2021). [*Urgency is a non-monotonic function of pulse rate*](https://doi.org/10.32920/14639772).
* Edworthy, J. (2025). [*Experimental Evidence Shows that Auditory Icon Clinical Alerts Work Better than Tones*](https://dael.euracoustics.org/confs/fa2025/data/articles/000375.pdf). Forum Acusticum.
* Friedman-Berg, F., Allendoerfer, K. & Pai, S. (2008). [*Nuisance Alerts in Operational ATC Environments: Classification and Frequencies*](https://doi.org/10.1177/154193120805200123). *Proc. HFES* 52.
* Wickens, C. et al. (2009). [*False Alerts in Air Traffic Control Conflict Alerting System: Is There a "Cry Wolf" Effect?*](https://doi.org/10.1177/0018720809344720) *Human Factors* 51(4).
* Diack, O., Blundell, J. & Li, W.-C. (2024). [*The Impacts of Systematic False Alarms on Air Traffic Controllers' Situation Awareness*](https://publications.ergonomics.org.uk/uploads/The-Impacts-of-Systematic-False-Alarms-on-Air-Traffic-Controllers-Situation-Awareness.pdf). *Contemporary Ergonomics and Human Factors*.
* [*Alarm Management By the Numbers*](https://www.chemengonline.com/alarm-management-numbers), *Chemical Engineering* — EEMUA 191 / ISA-18.2 / IEC 62682 KPIs and flood definitions.
* Dubois, L. [*The Sense and Nonsense of Alarm System Performance KPIs*](https://www.processvue.com/downloads/Alarm_system_performance_KPIs_V1_0.pdf), M.A.C. Solutions.
* Pruitt, Z. et al. (2023). [*Informing Healthcare Alarm Design and Use: A Human Factors Cross-Industry Perspective*](https://patientsafetyj.com/article/73905-informing-healthcare-alarm-design-and-use-a-human-factors-cross-industry-perspective). *Patient Safety* 5(1).
* Allspaw, J. (2013). [*Owning Attention (Considerations for Alert Design)*](https://www.kitchensoap.com/2013/07/22/owning-attention-considerations-for-alert-design/) — Woods on alerts as directed attention.
* Janata, P. & Childs, E. (2004). [*Marketbuzz: Sonification of Real-Time Financial Data*](https://icad.org/websiteV2.0/Conferences/ICAD2004/papers/janata_childs.pdf). ICAD.
* TL.net (2013). [*new Idle Worker button is too hard to notice*](https://tl.net/forum/starcraft-2-hots/397665-new-idle-worker-button-is-too-hard-to-notice) — nine pages on a peripheral indicator encoded in the one channel the periphery cannot use.
* [*How does the Alarm Stack in Starcraft II work?*](https://gaming.stackexchange.com/questions/350945/how-does-the-alarm-stack-in-starcraft-ii-work)
* W3C. [*Understanding SC 2.3.1: Three Flashes or Below Threshold*](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) · [*Understanding SC 1.4.2: Audio Control*](https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html) · [*F23*](https://www.w3.org/WAI/WCAG22/Techniques/failures/F23.html).
* Chrome for Developers. [*Web Audio, Autoplay Policy and Games*](https://developer.chrome.com/blog/web-audio-autoplay) · [*Autoplay policy in Chrome*](https://developer.chrome.com/blog/autoplay) · [*Intent to Ship: Autoplay Policy for Web Audio*](https://groups.google.com/a/chromium.org/g/blink-dev/c/5Y1BqbGauEs).
* MDN. [*Using the Notifications API*](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API) · web.dev, [*Web permissions best practices*](https://web.dev/articles/permissions-best-practices).
* ISO/TS 9241-126:2019, *Ergonomics of human-system interaction — Guidance on the presentation of auditory information*.
