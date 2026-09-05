# 02 — INFORMATION ARCHITECTURE AND CONTROLS

UX lens, document 2. What the operator sees at a glance, what is one key away,
what stops competing for attention, and what every control does — written
against the shipped surface (`src/web/play-game.html`, `lens-panel.js`,
`board-renderer.js`, `keynav-machine.js`, `src/lens/view/**`), the design it
implements (`decision-lens/02-INSPECTION-UI.md`), the audit of what that design
actually says (`decision-lens/09-AUDIT.md`), the walk that photographed it
(`decision-lens/10-WALKTHROUGH.md` and its PNGs), the measured numbers
(`decision-lens/07-MEASURED.md`), and the research that names the human
preferences it has to meet (`ux/01-RESEARCH.md`).

§1 is the audit and the hierarchy. §2 is what was built. §3 is the controls,
the two alternate hotkey schemes and the confirm-vs-undo policy. §4 is the
evidence.

---

## 1. The audit, and the hierarchy that comes out of it

### 1.1 The operator's task, under the clock

One operator, one turn, three facts that set the whole budget:

* the deadline is `arrival + gameTimeout − 50 ms`, and `gameTimeout` falls back
  to **500 ms** (`active-game-manager.ts`), while `02 §2.2`'s own lane is drawn
  against 1,500 ms. The interface must work at the short end;
* the kernel emits **7–10 times per board turn** (`07 §1`), so the panel
  redraws under the reader up to ten times inside that budget;
* the walk measured the rail at **735 px tall, six columns in 380 px, a
  three-line prose clause in every row** (`10 §5`) — and called it "the next
  thing 02 §3.7 will have to answer for".

The operator's job in that half-second is not to read a table. It is, in order:
**(a)** is anything of mine unplanned, fatal or frozen; **(b)** what is the bot
about to do; **(c)** do I disagree; **(d)** if I disagree, change it and be sure
the change is what I saw. Everything on screen is answerable to one of those
four questions or it is noise.

### 1.2 What the shipped surface gets right, and must not be broken

The audit is not a demolition. These are load-bearing and survive verbatim:

| kept | why |
|---|---|
| one transcript, two sources (`renderFrame` → `LensPanel`) | the rail and the board cannot drift, and live and replay cannot fork again (`09 §A1`, `10 §2`) |
| the honest empty state (`emptyStateLine`) | four distinguishable emptinesses beat one "no data" (`09 §A3`) |
| grades, never a bare number (`~` estimated, `·` unpriced) | a number nobody took is the old table's lie |
| the mandatory joint residual, drawn at zero | a breakdown that adds up wrongly is the same lie again |
| only disagreement draws (filled / hollow / ring) | the board is a difference display (`02 §3.4`) |
| the widen banner: additive uncertainty staged, subtractive applied | nothing re-orders under the reader (`02 §1.6`) |
| the exact pin count before the press | it is what makes a determination checkable — and what makes a dialog unnecessary (§3.4) |
| hover never commits the cursor | a lens that re-ranks under the pointer is unusable (T4) |

### 1.3 What the audit finds

**F-1 — the answer to (b) is not on the surface at all.** Nothing anywhere says
*"the bot is about to move A to 108 and C to 118"*. It is derivable — from the
staged arrows on the board, one unit at a time, by eye — and it is the single
most-asked question of the turn. `01-idle.png` shows the rail's whole answer at
the top of a live turn: *"No unit focused — click one, or Tab."*

**F-2 — the answer to (a) does not exist.** There is no count of my units, of
what is staged, held, pinned or unplanned. RTS UIs solved this in 1999 with the
idle-worker key (`01 §2` #6); our surface makes the operator scan a
three-team roster for it. This is the largest single gap.

**F-3 — the deadline is encoded in the one channel the periphery cannot
read.** A 12 px text pill in the page header, 700 px from where the eye is
(`01 §1` P1, #7, #10). Peripheral vision reads brightness, size and motion.

**F-4 — the rail is one flat plane of 10–12 px text.** Everything is disclosed
simultaneously, so nothing is: the conditional table's five rows carry six
columns each and a prose `unless` clause, and rank 1 — the row that is actually
going to happen — is drawn exactly like rank 5, which is not. Depth is not
hidden; it is undifferentiated.

**F-5 — the foil is behind a key.** `F` reveals the runner-up. The contrastive
pair is the thing the evidence says actually improves a human's decision
(`01 §1` P5, #18), and it is the one object that is only there if you know to
ask for it.

**F-6 — bounds are printed as text.** `-51.6 [93.0]`, `⌈w⌉`, `-61.85…∞`. About
one reader in three misreads an interval even with a correct key beside it, and
`∞` reads as a big number rather than as *nothing is proved above this*.

**F-7 — the affordance vocabulary is inconsistent.** `pin` appears as a padlock
chip on the board, as `🔒 unit → cell why (by)` text in the fixed strip, as the
word "pinned" in the focus line, and as a count inside the lock label. `hold` is
an amber shield on the board and a badge in the header. `goto`/`near` are only
in the help pane. Six controls, six vocabularies, no single place that says what
is available for the focused unit right now.

**F-8 — the keyboard has one scheme and it is discoverable only in a modal.**
`Ctrl+/` is a full, excellent reference — and it is a page-covering overlay that
costs the operator the board. There is nothing on screen at rest that says
`[`/`]` walk the list. Nothing accommodates a left-hand-on-keyboard /
right-hand-on-mouse operator, or a vim reader.

**F-9 — colour is doing work alone in three places.** The refused/stale
`#FF8A65` vs the ordinary `#8FA6A2` head note; the foil's teal vs the lens's
violet in the moveset assignment cell; the operator colours on lane ticks.
`02 §3.2`'s own rule — *shape carries the meaning, colour only reinforces* — is
stated and not enforced.

**F-10 — density is fixed.** 11 px everywhere. An operator on a 27" screen at
arm's length and one on a laptop have the same rail.

**F-11 — noise, in the strict sense of "answers none of (a)–(d) during the
turn":** the provenance footer (a cross-fiber comparison guard, needed *after*
the turn), the four-token legend (needed once, on first read), the `unless`
prose on rows 3–5, the lane's hollow attention ticks, and `panel.advice`'s
count of items that are not rendered anywhere.

### 1.4 The hierarchy

Five layers. The rule for placing a thing is its **latency budget**, not its
importance in the abstract: *at what point in the turn does an operator need
this, and how long may it take them to get it.*

| layer | budget | what is in it | why here |
|---|---|---|---|
| **L0 — glance** | 0–300 ms, no saccade, no reading | the turn clock as a depleting bar welded to the board's top edge; the board itself with its staged arrows | preattentive channels are brightness, size and motion; a shape at the point of gaze is read without a fixation, a text pill in the header is not (`01` P1, #7, #10) |
| **L1 — one sentence** | under 1 s, one fixation, no interaction | **the stage line** (*"Bot stages A→108 · C→118 · B holds"*) and **the business strip** (`3 units · 2 staged · 1 unplanned · 1 held`) | these are questions (a) and (b), and they are asked every turn whether or not a unit is focused. Top of the rail, largest type in it, fixed position |
| **L2 — the decision** | 1–3 s, one fixation each | focus line; **rank 1 and the foil as two full-size rows** with bands, assignments and what each is betting on; ranks 3+ as one line each; the control bar with the exact pin count | question (c). Two rows is the contrastive pair the evidence says moves decisions; the rest is a list you may walk, not a list you must read |
| **L3 — one unmodified key away** | on demand, never a chord | ranks 3–5 (`[` `]`), the breakdown (`B`), the foil expanded (`F`), the intra-turn timeline (`,` `.`), the candidate list, the `unless` prose | expert operators scan; progressive disclosure earns its keep only when every layer is exactly one press deep (`01` P2) |
| **L4 — present, quiet, not competing** | after the turn | provenance, legend, lane detail, attention ticks, advice index | needed to check a number, never to take a decision inside 500 ms |

Three placement rules fall out of it, and they are the ones a future change has
to argue with:

1. **Nothing above L2 may move.** The stage line, the strip and the lock
   affordance keep their box and their key whatever they say; only their text
   changes. (`01` P3, extended to the affordance.)
2. **Nothing in L3 costs a modifier.** `Shift+Space` is the sole exception and
   it is deliberately the hardest gesture on the surface (§3.4).
3. **Every layer draws its own absence.** A count that cannot be known is not
   printed as zero — the business strip has no `fatal` segment until a fatal
   consent exists this turn, because the page cannot know fatality for a unit
   it has not staged.

### 1.5 Where I disagree with `01-RESEARCH.md`

* **The one-shot confirm on `|P*| > 1` does not simply go.** Research's change 7
  says the exact count makes the dialog redundant. Half right: the count makes a
  *modal* redundant, and a modal on a 500 ms clock is a lost turn. But
  `Shift+Space` spends A4 determination on units the operator never looked at
  (`02 §1.4`), and undo does not un-spend authority a peer has already seen. The
  answer is an **in-place arm-then-press** — the affordance itself becomes the
  confirmation, costs no modal, no new screen region and one keystroke — plus
  the undo. §3.4.
* **Watch-vs-intervene layouts (change 12) are not built.** Mockup B builds it
  and it loses (§1.6): the overlay covers the board it is explaining. Reserved,
  not adopted.
* **Emission coalescing (change 9) is not built here.** It is a transport-side
  cadence decision and `ux-latency` owns transport; the rail must not grow a
  second timer that disagrees with theirs.
* **The last-safe-press mark is drawn but not computed here.** The clock rail
  renders a mark wherever `window.__latencyLastSafePressMs` puts it, and draws
  nothing when nobody has set it: the shape is ours, the number is
  `ux-latency`'s.

### 1.6 The three mockups, and which one wins

All three are at the real board size in the walkthrough's own 1500 × 950
viewport (`mockups/*.html`, self-contained; `mockups/shoot.js` re-shoots them).

**A — `a-rail-two-rows.png` · rail beside the board, two full-size rows.**
Clock on the board's edge; stage line and business strip at the top of the rail;
the decision as rank 1 + the foil at readable size with bands, then three
one-line rows; one control bar; a persistent key strip. Board 550 px, rail
380 px, everything in one 1500 px view with no scrolling.

**B — `b-watch-first.png` · watch first, intervene on demand.** The board takes
800 px and carries each unit's plan on the unit; the rail keeps only L0/L1; the
whole decision apparatus is an overlay opened with `W`. It is the best *watching*
layout of the three and it fails the moment the operator intervenes: the
overlay covers the board — in the shot it is standing on top of blue B — so the
one gesture it is for is the one gesture that hides the evidence. Moving it off
the board turns it back into A with an extra mode.

**C — `c-bottom-deck.png` · the decision as a deck under the board.** The table
finally gets six columns at 13 px and a full-width breakdown line. It costs a
vertical saccade between the arrows and the row that explains them, on every
row walked, on a 500 ms clock — and it shrinks the board to 440 px to pay for
it. Right for a post-game review tool, wrong for a turn clock.

**Winner: A**, with two ideas taken from the others: B's per-unit plan label
(as the stage line, which says the same thing in one place instead of eleven)
and C's insistence that the breakdown gets a full-width line rather than a
four-column table crammed into 380 px. §2 is A, built.

---

## 2. What was built

*(§2, §3 and §4 land with the implementation.)*
