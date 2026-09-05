# 01 — RESEARCH: the operator interface, against what other people already learned

UX lens, document 1. Written by reading the shipped surface —
`src/web/play-game.html`, `board-renderer.js`, `lens-panel.js`, `lens-view.js`,
`keynav-machine.js`, `ws-client.js`, `server-status-badge.js` — the design it is
answerable to (`decision-lens/02-INSPECTION-UI.md`), the run that measured it
(`07-MEASURED.md`), the walk that photographed it (`10-WALKTHROUGH.md` and every
PNG under `decision-lens/walkthrough/`), and `docs/BASIC-INTELLIGENCE.md` for
what the numbers on the rail mean. Then against the outside literature: RTS
command UIs, esports observer tools, chess GUIs, HUD design for peripheral
vision, uncertainty visualisation, trust calibration, accessibility, and how
networked games and market-data terminals say "this is not fresh".

Nothing here is a decision. §5 is the list an operator has to settle.

---

## 0. The clock this interface actually runs on

One fact reframes everything and it is not in `02-INSPECTION-UI.md`:

* `gameTimeout` falls back to **500 ms** (`active-game-manager.ts:1007`), and the
  deadline is `arrival + timeout − 50 ms` delivery estimate (`:953`).
* `02` §2.2's own lane is drawn to a **1,500 ms** deadline.
* The countdown ticks every 50 ms and goes urgent at **500 ms remaining**
  (`play-game.html::startTurnTimer`).
* The kernel emits **7–10 emissions per board turn**, max 10, at 33–88 KB
  (`07-MEASURED.md` §1). The panel redraws under the reader up to ten times
  inside one turn.

So the operator's unit of work is **half a second to a second and a half**, and
inside it the picture changes ten times. That is an RTS HUD budget carrying a
chess GUI's content. Every principle below is a consequence.

The second fact: `03d-conditional.png` is a five-row, six-column table with a
three-line prose `unless` clause in every row, in a 380 px rail that the walk
itself measured at **735 px tall** (`10` §5). At 500 ms nobody reads that. The
walk called it "the next thing 02 §3.7 will have to answer for". This is that.

---

## 1. Design principles for our interface

### P1 — The first 300 ms is one glance, and a glance is preattentive

Preattentive features pop out in about 200 ms in a time nearly independent of
how many distractors are on screen; conjunctions of features do not
([Wolfe/pop-out](https://pubmed.ncbi.nlm.nih.gov/25706768/)). Below 0.1 s a
response reads as instantaneous; past 1 s the operator has lost the feeling of
operating on the data ([Nielsen](https://www.nngroup.com/articles/response-times-3-important-limits/)).
Our whole turn fits inside Nielsen's second limit.

**Must be readable within 300 ms of `board.arrival`, without a saccade to text:**

1. **Time left**, as a decaying *shape*, not digits — see P1's peripheral rule.
2. **Do I have unfinished business** — how many units I own have no plan, a
   fatal plan, or a contested one. One number, one colour, one place.
3. **Is this frame live and fresh** — not "is the socket open", but "how old is
   what I am looking at" (§4).
4. **Where my attention was** — T17 already keeps `unit` across a turn boundary;
   the board must say so with one non-repeating mark, not by silence.

Everything else is *not* in the 300 ms budget and should stop competing for it.

**Peripheral encoding rule.** Peripheral vision reads motion, transients and
*brightness*; it does not read colour, shape detail or text
([Player Research](https://www.playerresearch.com/learn/perceiving-without-looking-designing-huds-for-peripheral-vision/)).
Our turn clock is a 12 px text pill in the page header, and the freshness signal
is 11 px grey ticks in a lane at the bottom of the rail. Both are encoded in the
one channel the periphery cannot use.

### P2 — One key away, never two

Progressive disclosure earns its keep for complexity, but NN/g's own caveat is
that it *hurts* when users are experts who scan many controls and when
information density is the point
([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)).
Our operator is an expert on a 500 ms clock. So: **layer by depth, not by
frequency**, and make every layer exactly one unmodified keypress from the
surface — which `[ ] F B , .` already are. The failure today is the opposite of
hiding: everything is disclosed simultaneously at 11 px, so nothing is.

### P3 — Nothing re-orders under the cursor

Already the house rule (`02` §1.5, §1.6: *additive uncertainty is staged;
subtractive certainty is applied*), and it is the correct one. Two extensions
the evidence asks for:

* A swap the eye does not see is a swap that did not happen — change blindness
  is defeated by *motion at the change*, not by the change being large
  ([NN/g](https://www.nngroup.com/articles/change-blindness-definition/)).
  §1.6's one-shot 600 ms arrival pulse and §1.5's `▲was #1` rank trail are both
  right, and the trail should also fire on the board, not only in the table.
* The rule currently protects the rail. It must equally protect **the board's
  arrows for the row being read** and **the position and key of the lock
  affordance**. An affordance that moves between "pins 1 of 4" and "pins 2 of 4"
  must change its text, never its place.

### P4 — Commitment is cheap because release is cheap

Undo beats confirmation for anything reversible; a confirmation dialog on a
reversible action is a wasted interaction, and NN/g reserves dialogs for the
genuinely irreversible
([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)).

* `Space` is right to be one press with an **exact count rendered before it**
  (`[Space] lock — pins 2 of 2`). Exactness is what makes the dialog
  unnecessary; `02` §1.4 got this right and then added a one-shot confirm on
  `|P*| > 1` anyway. Replace it with an undo window.
* `U` (release) is the undo, and it is currently a letter in a help pane. It
  should be as visible as the lock, in the same place, the moment a pin exists.
* Genuinely irreversible actions keep their dialogs: `Submit All`, fatal-move
  consent, cross-owner takeover. Those are correct as they stand.
* The optimistic write already has the right three-state vocabulary — dashed
  ghost = requested, solid = confirmed, chevron = committed. That *is* the
  pending/reconcile pattern ([optimistic UI](https://dev.to/stacknotice/react-useoptimistic-optimistic-ui-patterns-that-actually-work-2026-5460)),
  and the divergence banner is its reconciliation half. Extend both to pins.

### P5 — Confidence is a shape, and absence is a reading

Showing a model's confidence calibrates trust but does **not** by itself improve
decisions; what improves them is a *contrastive* explanation — the runner-up and
what separates it
([Zhang, Liao & Bellamy, FAT\* 2020](https://arxiv.org/abs/2001.02114)).
Interval displays are misread by roughly one reader in three, and readers hold
the wrong reading even with a correct key beside it
([Padilla, Kay & Hullman](http://space.ucmerced.edu/Downloads/publications/Uncertainty_Visualization_Padilla_Kay_Hullman_2022.pdf)).

* Therefore: **the foil is the highest-value object on the surface** and should
  not be behind a key. `02` §3.5 already calls it "the highest-value cheap
  signal"; the evidence says it is *the* signal.
* Bounds (`lo…hi`, `∞`, `−∞`) must draw as a **band with a marked incumbent**,
  not as `0.00…10.00` text. `∞` is a real reading of "nothing proved above"
  (F7) and needs a glyph that says *open*, not a number that says *ten*.
* A single scalar invites overtrust — the chess-engine lesson, where `0.00`
  means "equal under best play" and is routinely read as "easy"
  ([ChessBase](https://en.chessbase.com/post/centipawn-analysis-evaluating-strength-with-an-engine)).
  Our `0.00 ⌈0.0⌉` was worse: a reading nobody took, drawn as a measurement.
  Grades (`~` estimated, `·` unpriced) are the right instinct and must be shape,
  not punctuation.
* **Lookahead reads as a depth and a horizon, and says when it stopped.**
  `h1 · Q=0/33` is the truth and is unreadable. Depth is one bar with a proved
  floor; `reserve-spent` vs `row-cap` is the difference between "I ran out" and
  "that's all there is", and the operator must not have to know which is which.

---

## 2. Pattern catalogue

**1. Eval bar + best-move arrow, always on.** *Where:* Lichess, Chess.com,
Banksia, every analysis GUI. *Here:* the persistent-single-scalar half does not
apply — we have bounds, not a scalar, and 04's own lattice says so. The
*always-on, peripheral, non-textual* half applies exactly. Draw the aggregate
band, never a bare number.

**2. Multi-PV arrows, rank encoded in weight and opacity.** *Where:*
[BanksiaGUI](https://banksiagui.com/multi-thinking-arrows/) draws rank 1 at full
weight and the rest "thinner and more transparent". *Here:* directly reusable.
`02` §3.4's filled/hollow/ring vocabulary already exists; add **thickness and
alpha for rank** rather than a new hue. Banksia's own caveat — too many arrows
and it is unfollowable — is the argument for capping the board at the selected
row plus the foil.

**3. The centipawn caveat.** *Where:* chess. *Here:* our numbers are worse than
centipawns because they are *conditional on a cluster* and the rail says so only
in words (`scored as best-of-cluster`). Keep saying it; make the conditioning
visible in the mark, e.g. the band drawn inside the cluster's own chip.

**4. Control groups, and double-tap to centre.** *Where:*
[SC2](https://tl.net/forum/starcraft-2/120949-standard-vs-grid-vs-classic-hot-keys).
*Here:* applies. `Tab` cycles our units in letter order only; an operator
watching one cluster across turns has no way to bind it. `Ctrl+1..9` is free
(`1..9` is the numpad move schema).

**5. Grid hotkeys that mirror screen position.** *Where:* SC2 grid layout.
*Here:* does **not** apply — our commands are not a spatial palette. What
transfers is the narrower finding: single unmodified keys, home-row reachable,
no chords in the hot path. `[ ] F B U N , .` satisfies this; `Shift+Space` in
the hot path does not.

**6. Idle-worker alert / minimap ping.** *Where:* AoE II's idle-villager key,
SC2 alerts. *Here:* **applies strongly and is missing.** "Which unit of mine has
no plan, or a plan that kills it" is the operator's actual job and nothing on
the surface answers it in one glance. This is the single largest gap.

**7. Cooldown near the point of gaze.** *Where:* Overwatch puts cooldowns at the
bottom centre because that is where the eye rests
([HUD design](https://polydin.com/game-hud-design/)). *Here:* applies. Our clock
is in the page header, far from the board the eye is on.

**8. Observer/caster chrome distinct from player chrome.** *Where:*
[SC2's observer UI mod tools](https://www.pcgamesn.com/starcraft/starcraft-2s-new-observer-ui-mod-tool-should-make-better-esports-broadcasts),
Dota 2 broadcaster tools. *Here:* partially. Our operator is watcher *and*
intervener in one seat; the transferable idea is a **mode**: a watch layout that
spends the rail on the board and the roster, and an intervene layout that spends
it on one cluster. `live-scrub` and `replay` already prove the page can wear
different chrome.

**9. Training-mode frame data.** *Where:* SF6 input history, GG Strive's frame
data display. *Here:* the intra-turn lane **is** a frame-data display, and the
fighting-game convention is the right one: opt-in, always-on for the expert,
never in the beginner's way. Our lane is always on and illegible; invert both.

**10. Peripheral HUD encoding.** *Where:*
[Player Research](https://www.playerresearch.com/learn/perceiving-without-looking-designing-huds-for-peripheral-vision/):
brightness, size, motion — not colour, shape or text. *Here:* applies to the
clock, the freshness state and the unfinished-business count. Contradicts the
current rendering of all three.

**11. Motion as the change cue.** *Where:*
[NN/g change blindness](https://www.nngroup.com/articles/change-blindness-definition/).
*Here:* applies; already designed (arrival pulse, rank trail). Bounded by
accessibility (#15).

**12. Progressive disclosure, with the expert caveat.** *Where:*
[NN/g](https://www.nngroup.com/articles/progressive-disclosure/). *Here:*
applies in the *layered* form only. Do not collapse `[ ] F B`; do collapse the
`unless` prose, the terms table, and the provenance footer.

**13. Undo over confirmation.** *Where:*
[NN/g](https://www.nngroup.com/articles/confirmation-dialog/). *Here:* applies —
P4.

**14. Optimistic write with reconciliation and rollback.** *Where:* game netcode
([Valve](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking),
[Gambetta](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html))
and web UI (`useOptimistic`). *Here:* already implemented as ghost→solid→chevron
plus the divergence banner. What is missing is the **age of a pending write**:
a ghost that has not confirmed within one RTT is a fact worth drawing.

**15. A deliberate, constant, disclosed lag beats a variable one.** *Where:*
Valve's `cl_interp 0.1` — 100 ms of view lag, always, on purpose. *Here:*
applies to emissions. Ten redraws in 500 ms is a flicker; coalescing them to a
fixed cadence, and *saying* the cadence, is calmer and no less true.

**16. The staleness ladder.** *Where:* market-data terminals move a symbol
LIVE → DEGRADED → STALE → FALLBACK → DEAD on quote age, and the guidance is
explicitly **never a red error banner for a recoverable state**
([EODHD](https://eodhd.com/financial-academy/fundamental-analysis-examples/real-time-market-data-reliability-stale-price-detection-rest-fallback-and-websocket-recovery)).
*Here:* applies wholesale — §4.

**17. Colour-vision-safe, shape-first.** *Where:* the
[Okabe–Ito](https://thenode.biologists.com/data-visualization-with-flying-colors/research/)
eight-colour set, chosen for separation under protanopia/deuteranopia/tritanopia
*and* distinct luminance. *Here:* our board already claims blue, amber, red,
grey, green, teal-blue, plus arbitrary operator hues, and the lens adds violet,
teal, and orange-red. That is past any safe qualitative set. `02` §3.2's rule —
*shape carries the meaning, colour only reinforces* — is the right one and needs
auditing rather than restating.

**18. Contrastive explanation over confidence.** *Where:*
[Zhang et al. 2020](https://arxiv.org/abs/2001.02114); confidence calibrates
trust, counterfactual/contrastive explanation improves decisions. *Here:* the
foil, promoted. P5.

---

## 3. Ranked changes

Cost: **S** ≈ hours · **M** ≈ a day · **L** ≈ multi-day.

| # | change | evidence | cost |
|---|---|---|---|
| 1 | **Move the turn clock to the board's edge and make it a shape** — a depleting arc or bar on the board frame, brightness-encoded, digits secondary. Keep the text pill for the exact number. | Peripheral vision reads brightness/motion, not text (#10); Overwatch's gaze-adjacency (#7); the budget is 500–1500 ms (§0). | S |
| 2 | **An unfinished-business strip at the top of the rail**: `5 units · 4 staged · 1 fatal · 2 unpinned`, each segment clickable and keyed. | The idle-worker alert is the oldest solved problem in RTS UI (#6); nothing on our surface answers it (walk §1.1's idle rail says only "no unit is focused"). | S–M |
| 3 | **Promote the foil**: draw the runner-up permanently at low alpha for the selected row; `F` becomes *latch/expand*, not *reveal*. | Contrastive explanation is what moves decisions, confidence alone is not (#18); `02` §3.5 already calls it the highest-value cheap signal. | M |
| 4 | **Rebuild the moveset table around two full-size rows.** Rank 1 and the foil at readable size with the band; ranks 3–5 as one-line summaries; the `unless` prose behind hover/`B`. | 735 px of rail at 11 px in a 500 ms turn (§0, walk §5); progressive disclosure's layered form (#12); F6 already proved the column wraps badly. | M |
| 5 | **Bounds as a band, grades as shape.** `lo…hi` becomes a filled span with an incumbent tick and an open end for `±∞`; `~`/`·` become a dotted/hollow marker. | Intervals are misread by ~1 in 3 even with a key (#P5); F7 established that `∞` is a reading, not a blank. | M |
| 6 | **The staleness ladder and the effective deadline** (§4 in full). | Market-data state model (#16); the walk's own silent-replay failure (`10` §5: a 404 on `/api/play/game/:id` renders a live game as finished). | M |
| 7 | **`U` beside `Space`, and an undo window instead of the one-shot confirm** on `\|P*\| > 1`. | Undo beats confirmation for reversible actions (#13); the exact pin count is already on screen, which is what makes the dialog redundant. | S |
| 8 | **Rank by weight and alpha, not by new hues** — thin/dim the lower-ranked implied arrows; cap the board at selected row + foil. | Banksia's multi-PV rendering and its own over-crowding caveat (#2); our hue budget is already over (#17). | S |
| 9 | **Coalesce emissions to a fixed redraw cadence** (~200 ms), and show the cadence, rather than redrawing on each of 7–10 emissions. | Constant disclosed lag beats variable lag (#15); measured cadence is 7–10/turn (`07` §1). | M |
| 10 | **Accessibility pass**: 3:1 non-text contrast for violet/teal/foil ink on the white board *and* on `#1a1a1a` chrome; a visible focus ring on rail rows; `prefers-reduced-motion` for the arrival pulse, the ask pulse and the badge pulse; verify nothing flashes >3 Hz. | [WCAG 1.4.11 / 2.4.7 / 2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html); [2.3.1 three-flash and reduced-motion guidance](https://web.dev/learn/accessibility/motion). The 2 s ask pulse and the badge's 2 s pulse are both unconditional today. | S |
| 11 | **Cluster control groups** on `Ctrl+1..9`: bind the current cluster or unit set, re-select and re-centre with one press, double-tap to centre the board. | SC2 control groups (#4); T17 already keeps focus across turns, which is half of it. | M |
| 12 | **Watch vs intervene layouts.** A `W` toggle: watch gives the board the rail's width and keeps only strip #2 and the clock; intervene is today's rail. | Observer chrome differs from player chrome (#8); the page already carries three modes. | L |

---

## 4. Latency and staleness

Two independent clocks, and today the page conflates them into one badge.

**Clock A — the deadline.** `turnExpiryTime`, skew-corrected via `serverNow()`
(EMA over the low-RTT half of a 5-sample window, `play-game.html:891–917`). This
is correct and well built. What it does not do: subtract the **flight time of
the press**. A lock issued at `T` lands at `T + RTT/2 + server work`. So the
countdown should carry **two marks**: the deadline, and the *last safe press* at
`deadline − RTT/2 − ε`. Between the two marks the affordance changes to
`[Space] lock — may not land`. This is the one change that turns the ping number
from trivia into a decision input.

**Clock B — freshness.** How old is the frame on screen. `seq` age since the
last `kernel.emission`, not socket liveness. Nothing shows this today; the rail
shows `seq 29 · 30/30 · LIVE`, which is a counter, not an age.

**The ladder** (states, thresholds, and what draws):

| state | condition | what draws, where |
|---|---|---|
| `LIVE` | socket open, last emission < 250 ms | nothing beyond the normal ink. Silence is the signal. |
| `THINKING` | open, no emission for 250 ms–1× the turn budget, within deadline | the kernel lane's head brightens; no banner. The bot is allowed to think. |
| `DEGRADED` | RTT > 150 ms, **or** no emission for > 1× the turn budget | rail head gains `frame +Nms`; the clock's last-safe-press mark widens visibly. Amber, never red. |
| `STALE` | no emission past the deadline, or socket in reconnect | ink desaturates 30 % (the `live-scrub` treatment, already built), banner *"the rail below is stale @ seq N"* (already built, `10` §4 O8), determinations still offered but labelled. |
| `DISCONNECTED` | socket closed, reconnect pending | existing bottom-left pill goes amber; determinations disabled with the reason, not greyed silently. |
| `SCRUBBED` / `REPLAY` | `at.mode ≠ live-head` | existing badges; `[N] return to now` only in `live-scrub`, per O7. |

**Thresholds, justified.** 250 ms is the p50 gap between our own emissions
(7–10 per 500–1500 ms turn, `07` §1) — below it a gap is normal, above it a gap
is news. 150 ms RTT is where the flight time crosses ~30 % of a 500 ms turn and
starts to change what an operator should press. Market-data practice puts
LIVE/DEGRADED/STALE at 3 s/10 s against a slow feed; scaled to a 500 ms turn
those become fractions of the turn budget, which is the form to store them in —
**every threshold expressed as a fraction of the current turn budget, not as an
absolute** — because the budget is per-game (`game.timeout`).

**Rules for how it draws.**

* Never a red banner for a recoverable state; red is reserved for `DEAD`
  (no board, no socket, no fallback) ([EODHD](https://eodhd.com/financial-academy/fundamental-analysis-examples/real-time-market-data-reliability-stale-price-detection-rest-fallback-and-websocket-recovery)).
* One banner region, above the rail, already established by the widen banner —
  and its rules carry: countdown visible, pausable, suspended while a drill is
  open (`02` §1.6).
* Never modal. A modal on a 500 ms clock is a lost turn.
* **Silent degradation is the only unacceptable failure.** The walk found a live
  game rendering as a finished replay because one `/api/play/game/:id` call 404'd
  (`10` §5). Every fallback path must name itself in the badge, the way a
  market-data `FALLBACK` label does.
* Pending writes carry their age: a ghost arrow unconfirmed past 1 RTT gains a
  count; past 3 RTT it is a `DEGRADED` trigger of its own.

---

## 5. Open questions an operator has to answer

1. **What is the real turn budget you play at?** 500 ms and 1,500 ms are
   different interfaces. Every threshold in §4 is a fraction of this number.
2. **In a turn, do you mostly *watch* or mostly *intervene*?** If watching is
   the default, change 12 outranks changes 3–5.
3. **When you intervene, is it because the bot's plan is wrong, or because you
   know something it does not?** The first wants the foil; the second wants goto
   and hold, and no lens at all.
4. **Do you read the moveset list, or only rank 1?** `07` §3 records zero
   conditional frames in 180 bot-only decisions; `[ ]` has never been measured
   with a human on it. If rank 2+ is unread, change 4 becomes a deletion.
5. **How many units do you actually own in a live game?** Cluster size measured
   at mean 1.34, max 3 (`07` §1). If clusters are usually singletons, the whole
   moveset apparatus is rarely on screen and strip #2 matters far more.
6. **Would you rather be told "you have 1 unplanned unit" or shown it on the
   board?** Change 2's placement depends on the answer.
7. **Is `Space` ever pressed in anger, or always after reading?** If it is a
   reflex, the exact pin count must move onto the board near the cursor; if it
   is deliberate, the rail is fine.
8. **Has a pin ever been regretted?** If yes, the undo window (change 7) needs a
   duration; if no, the one-shot confirm can simply go.
9. **Do you play with a second operator?** The ownership guard, takeover dialog
   and operator colours are built for it and untested by a human. `02` §1.6's
   whole reactive apparatus exists for this case.
10. **Colour vision, motion sensitivity, screen and viewing distance.** The
    board is white-on-dark at 11 px in a 380 px rail; the answer decides whether
    change 10 is a pass or a redesign.
11. **What is your network like?** If RTT is reliably under 30 ms the last-safe-
    press mark is decoration; at 150 ms+ it is the most useful thing in §4.

---

## Sources

Response time and disclosure — [Nielsen, *Response Time Limits*](https://www.nngroup.com/articles/response-times-3-important-limits/) ·
[NN/g, *Progressive Disclosure*](https://www.nngroup.com/articles/progressive-disclosure/) ·
[NN/g, *Confirmation Dialogs Can Prevent User Errors*](https://www.nngroup.com/articles/confirmation-dialog/) ·
[NN/g, *Change Blindness in UX*](https://www.nngroup.com/articles/change-blindness-definition/).

Perception and HUDs — [Player Research, *Perceiving without looking*](https://www.playerresearch.com/learn/perceiving-without-looking-designing-huds-for-peripheral-vision/) ·
[*Is pop-out visual search attentive or preattentive?*](https://pubmed.ncbi.nlm.nih.gov/25706768/) ·
[Polydin, *Game HUD design*](https://polydin.com/game-hud-design/) ·
[Accessible Game Design, *HUD guidelines*](https://accessiblegamedesign.com/guidelines/HUD.html).

Game UIs — [BanksiaGUI, *Multi thinking arrows*](https://banksiagui.com/multi-thinking-arrows/) ·
[ChessBase, *Centipawn analysis*](https://en.chessbase.com/post/centipawn-analysis-evaluating-strength-with-an-engine) ·
[TeamLiquid, *Standard vs Grid vs Classic hotkeys*](https://tl.net/forum/starcraft-2/120949-standard-vs-grid-vs-classic-hot-keys) ·
[PCGamesN, *SC2 observer UI mod tools*](https://www.pcgamesn.com/starcraft/starcraft-2s-new-observer-ui-mod-tool-should-make-better-esports-broadcasts) ·
[Chalmers, *Designing Spectator Interfaces for Competitive Video Games*](https://publications.lib.chalmers.se/records/fulltext/224247/224247.pdf) ·
[RTS Clones Wiki, *Minimap interaction*](https://rtsclones.fandom.com/wiki/Minimap_Interaction).

Uncertainty and trust — [Padilla, Kay & Hullman, *Uncertainty Visualization*](http://space.ucmerced.edu/Downloads/publications/Uncertainty_Visualization_Padilla_Kay_Hullman_2022.pdf) ·
[Zhang, Liao & Bellamy, *Effect of Confidence and Explanation on Accuracy and Trust Calibration in AI-Assisted Decision Making*](https://arxiv.org/abs/2001.02114).

Latency and staleness — [Valve, *Source Multiplayer Networking*](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) ·
[Gambetta, *Client-Side Prediction and Server Reconciliation*](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html) ·
[EODHD, *Stale price detection, REST fallback and WebSocket recovery*](https://eodhd.com/financial-academy/fundamental-analysis-examples/real-time-market-data-reliability-stale-price-detection-rest-fallback-and-websocket-recovery) ·
[React optimistic-UI rollback patterns](https://dev.to/stacknotice/react-useoptimistic-optimistic-ui-patterns-that-actually-work-2026-5460).

Accessibility — [W3C, *Understanding SC 2.4.13 Focus Appearance*](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) ·
[WebAIM, *Contrast and Color Accessibility*](https://webaim.org/articles/contrast/) ·
[web.dev, *Animation and motion*](https://web.dev/learn/accessibility/motion) ·
[Okabe–Ito palette / colour-blind-friendly qualitative palettes](https://thenode.biologists.com/data-visualization-with-flying-colors/research/).
