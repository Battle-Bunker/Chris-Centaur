# 09 — DESIGN TOKENS: one sheet, and what it is made of

UX lens, document 9. Six passes over one day — `ux-ia`, `ux-latency`,
`ux-secondary`, `ux-manual`, `ux-alerts`, `ux-review` — each added styling to
the surface it owned, and each of them was right to. What none of them could
do from inside its own file is see the other five. This document counts what
that cost, and §2 is the sheet that pays it back.

The rule this work is answerable to is the owner's standing one, applied to
CSS as to code: **delete duplication by factoring onto parameterised
abstractions**. The constraint it is answerable to is stronger than usual:
**the gate is pixel identity**. Nothing here is allowed to look different.
So §1 counts the near-duplicates and says which of them *mean* something and
which are accidents of six people typing a grey from memory — and §2 gives
each of them a name without moving a single one of them, because a value that
is wrong and a value that is duplicated are two different bugs and only the
second is a refactor.

---

## 1. The inventory

Eleven files carry the interface's styling:

| file | what it styles | owner (pass) |
|---|---|---|
| `src/web/chrome.css` | the lobby chrome — `/play`, `/history`, `/activity`, `/config`, `/connection-debug`; two delimited blocks (`UX-SECONDARY`, `UX-REVIEW`) | ux-secondary, ux-review |
| `src/web/play-game.html` `<style>` | the operator page: board frame, roster, the whole `.lens-*` rail, the modals | ux-ia (+ everyone) |
| `src/web/latency.js` | the ladder strip, as a CSS string injected once | ux-latency |
| `src/web/alerts.js` | the alert button, popover and the board-edge ring | ux-alerts |
| `src/web/tour.js` | the spotlight, the dim panels and the card | ux-manual |
| `src/web/board-renderer.js` | the canvas — every colour is a JS literal, nothing cascades | (pre-existing) |
| `src/web/page-chrome.js` | one geometry literal (`paddingTop`) | ux-secondary |
| `src/web/lens-panel.js` | geometry only — `left`/`width` percentages, and one colour that comes from the frame | ux-ia |
| `src/web/review.js` | nothing: it renders `class=` and lets `chrome.css` say how | ux-review |
| `src/lens/view/index.ts`, `cursor.ts` | nothing: the view model emits a draw transcript, never a style | ux-ia |

The last two rows are the point of the whole architecture and they held. The
first six are where the day's cost is.

### 1.1 The counts, before

Every literal, counted by a script over the eleven files (`#rgb`, `#rrggbb`,
`rgb()`/`rgba()`, and the declarations that carry a duration, radius, font
size, font weight, z-index, shadow or spacing):

| dimension | distinct values | occurrences |
|---|---|---|
| **colours** | **211** | **491** |
| — of which neutral (chroma ≤ 12) | **69** | 267 |
| — of which chromatic | **87** | — |
| — of which `rgba()` washes | 55 | — |
| durations | 11 | 21 |
| radii | 13 | 80 |
| font sizes | 20 | 136 |
| font weights | 5 | 52 |
| z-indices | 16 | 19 |
| shadows | 14 | 15 |
| spacing values (padding/margin/gap/inset) | 95 | 263 |

Two hundred and eleven colours on a surface whose own research document
(`01-RESEARCH.md` #17) says the hue budget was already over at **eleven**.

### 1.2 The near-duplicates

Sixty-nine of the 211 colours are neutral. Sorted by luminance and clustered at
a maximum channel delta of 13 (≈5 % of the range — below what anyone can name
without a colour picker), they collapse to **eighteen** clusters:

```
#141414 #10151a #161616 #14181e #1a1a1a #1b1b1b #1c1c1c #1e1e1e #1f1f1f #202020
#1e1f22 #1b2026 #222222 #232323 #242424 #22262b #262626 #1f2a1f #23282e #282828 #2a2a2a #2b2b2b
#2c2c2c #2e2e2e #2f2f2f #303030 #2e332e #333333 #343434 #383838
#33373b #3a3a3a #3a3d41 #3d3d3d
#444444 #4a4a4a
#555555 #55595e #5c5c5c
#666666 #6b6b6b #6d6d6d #6e6e6e
#777777 #7a7a7a
#888888 #8a8a8a #8d8d8d
#999999 #9a9a9a #9e9e9e #a2a2a2 #a6a6a6
#a8a8a8 #aaaaaa #ababab
#bbbbbb #bdbdbd #c4c4c4
#c2c7cd #cccccc
#d8d8d8 #dcdcdc #dddddd #e0e0e0
#e8e8e8 #eeeeee
```

The named cases:

* **Five panel greys inside 5 %**: `#2c2c2c` `#2e2e2e` `#2f2f2f` `#303030`
  `#333333` — a card border, a strip separator, a hover ground, a card hover
  ground and a button ground, written by four different passes.
* **Four quiet-ink greys inside 5 %**: `#666666` (×10) `#6b6b6b` `#6d6d6d`
  `#6e6e6e`. `#6e6e6e` is `--ink-faint`, which already *is* a token;
  `#6d6d6d` is `.lat-num`'s resting ink and is a **contrast failure**
  (2.77 : 1, `05-EVALUATION.md` §3 A-1); `#6b6b6b` is the board's `fixed` ink
  on a light board. Three roles, one perceptual grey, no name shared.
* **Five mid greys inside 5 %**: `#999999` `#9a9a9a` (×16) `#9e9e9e` `#a2a2a2`
  `#a6a6a6` — plus `#a8a8a8` `#aaaaaa` `#ababab` one cluster up, which is eight
  greys spanning 5 % of the range doing one job: *secondary ink*.
* **`#888888` is the most-written literal on the surface** — 24 occurrences, in
  five files, and it is three different things: the canvas's unit-colour
  fallback (a **contrast failure**, 4.05 : 1, A-1), the ladder mount's resting
  ink, and the board's own border.
* **Three near-identical dark grounds**: `#1a1a1a` (the body, ×7), `#1b1b1b`,
  `#161616` (the alert popover), against `#1c1c1c` (the clock track).
* **Three focus rings**: `#8ab4f8` (`--focus`, and `tour.js`'s own hand-typed
  copy of it, four times), `#7aa2f7` (`alerts.js` — one point of hue and two of
  lightness away from `--focus`, in a file that could not see it), and
  `#ffffff`, which survives on the lobby nav links alone by a specificity
  accident (§1.5). Three rings for one WCAG requirement.

Chromatic near-duplicates are fewer and mostly *are* meaning (below), with two
exceptions worth naming:

* **green**: `#4CAF50` (×19 in play-game.html + ×6 elsewhere), `#43a047`
  (health bar), `#66bb6a` (health *text*, lifted for AA), `#3c6e3e`
  (chip border), `#5f8f61` (card hover border), `#81c784` (`--lens-ours`),
  `#8fbf6a` / `#7fbf6a` (the ladder's THINKING dot and its `ack` chip — two
  greens **one point apart**, in one file, in adjacent rules).
* **amber**: `#E69F00` (`--warn`, Okabe–Ito), `#d8a13a` (the ladder's warn),
  `#FFB74D` (`--lens-open`), `#ffca28` (food), `#FFC107` / `#FF8F00` (clash),
  `#FFD700` (a highlight), `rgba(240,198,70,…)` (a ring). Seven ambers.

### 1.3 Which values encode meaning

The distinction the sheet is built on. A value **means** something when a
document says what it means and a reader is supposed to decode it; it is
**incidental** when it was chosen to look right and any neighbouring value
would have done.

**Meaning-bearing — these become semantic tokens, and a change to one is a
change to the interface:**

| value(s) | what it encodes | authority |
|---|---|---|
| `#4CAF50` go · `#E69F00` warn · `#D55E00` stop · `#56B4E9` cool | the Okabe–Ito operator palette: live / degraded / down / neutral, chosen for separation under protanopia, deuteranopia and tritanopia *and* for distinct luminance | `01` #17, `04` §2.1 |
| `#4CAF50` LIVE · `#8fbf6a` THINKING · `#d8a13a` DEGRADED · `#d8a13a`+`opacity .5` STALE · `#b03a2e` DISCONNECTED | **the ladder's five rungs**, and the rule that nothing is red for a recoverable state — DEGRADED and STALE are amber, DISCONNECTED is the only red | `03` §3, `01` §4 |
| `#35734a` → `#8a7524` → `#c9503f` → `#3a3a3a` | the clock fill's four states: running, warn, urgent, past. Brightness first, hue second | `03` §2.1, `05` H-7 |
| `#B39DFF` lens · `#4DB6AC` foil · `#FF8A65` refused · `#FFB74D` no-plan · `#9A9A9A` fixed · `#81c784` ours (dark), and their light-board pair `#7B4FE0` / `#00897B` / `#D84315` / `#6B6B6B` | the lens vocabulary — and the one genuine **light/dark pair** on this surface: the board is white, the rail is `#1a1a1a`, and every lens token exists twice for that reason | `02` §3.2, board-renderer `LENS_THEME` |
| `#e53935` → `#fb8c00` → `#43a047` (bar) and `#ef5350` → `#ffa726` → `#66bb6a` (text) | the health ramp, at two contrast grades: a bar is a non-text mark and owes 3 : 1, the roster's `♥` is text at 11 px and owes 4.5 : 1 | `05` §3 A-1 |
| `#d81b1b` hazard · `#ffca28` food · `#FF8F00`/`#FFC107` clash · `#FFD700` highlight · `rgba(56,174,255,.8)` eye | the board's own signal set, which the lens violet must never be mistakable for | board-renderer §lens |
| `#8ab4f8` | the focus ring — WCAG 2.4.7/2.4.13, and the one indicator all 62 tab stops share | `05` §3 A-5 |
| `2px` outline, `2px` offset | the focus indicator's geometry, likewise | `05` §3 A-5 |
| `rgba(255,214,130,.92)` / `rgba(255,176,96,.96)` / `rgba(198,214,235,.72)` at 3 px and 5 px | alert priority as **weight and opacity**, hue only as a second reading | `06` §4 |
| `0.45` brightness → `1.25` | the review strip's four weights — brightness, because that is what the periphery reads | `07` §2 |
| durations `140ms`/`620ms` (alert ring), `900ms` (ladder arrival), `.18s` (tour), `0.12s`/`0.15s`/`0.2s` (chrome) | every one of them is under `prefers-reduced-motion`, and the preference is the meaning | `01` ch.10, `05` §3 A-4 |
| `--lens-size` 11/12/13 px + `calc()`/`max(9px, …)` derivations | density: **one number in three steps, a scale and not a second design** | `05` §4 |

**Incidental — these become palette tokens, named for the value and not the
job, and a change to one is a refactor:** every neutral in §1.2 that is not in
the table above (57 of the 69), the panel and border greys, the card grounds,
the hover grounds, the shadows (`0 8px 24px`, `0 6px 24px`, `0 20px 60px`,
`0 18px 50px`, `0 2px 12px`, `0 2px 10px` — six drop shadows, no two alike, all
"a panel floats"), the radii (`4px` ×32 is the house radius; `3px`, `5px`,
`6px`, `8px`, `9px`, `10px`, `12px` are seven more), and the spacing values
(95 distinct, of which the top nine cover 60 % of the uses).

### 1.4 The z-index ladder, which is meaning nobody wrote down

Sixteen distinct values across five files, and the ordering between them is
load-bearing — `alerts.js` has a **comment** reasoning about `2000` in a file
that cannot see it, because `2000` is declared in `play-game.html`:

```
5   board overlay          20  resize grip        25  toast
26  roster id control      30  (page)             40  latency overlay
60  tour link              70  tour layer         71  tour card
1000 header / page chrome  1500 alert popover     2000 page modals
2500 alert ring            3000 login gate        11000 keysheet
```

`.al-pulse` at 2500 is deliberately **above** the page's own modals and below
the login gate, and the only place that fact is written is a comment in a file
that does not contain either number. That is the clearest single argument in
this inventory for one sheet: a layering order is a shared abstraction whether
or not anybody factors it.

### 1.5 Dead CSS

Proved unreferenced by grepping every selector against the pages, the injected
CSS strings and every `className`/`classList`/`setAttribute('class')` site:

* `chrome.css:48–51` — `.game-card:focus-visible, .nav-links a:focus-visible {
  outline: 2px solid #fff; outline-offset: 2px }`. Half of it is dead and half
  of it is not, which is the more interesting finding: `.game-card:focus-visible`
  is restated at `:161–167` at equal specificity and later, so the card's ring
  is `var(--focus)`; but `.nav-links a:focus-visible` is `(0,2,1)` against that
  block's `a:focus-visible` at `(0,1,1)`, so **the nav links keep a white
  ring** while every other tab stop on the page has a blue one.
  `04-SECONDARY-SCREENS.md` §2 says what was meant — *"`:focus-visible` gets a
  2 px `#8ab4f8` ring with a 2 px offset on **every** interactive element in
  the chrome"* — so the whole rule goes, and the nav links join the ring the
  design specified. This is the one **named, intended pixel change** in the
  pass (§4).
* `chrome.css:57–60` — the `prefers-reduced-motion` block that restores
  `.game-card { transition: border-color 0.2s }` and `transform: none`: the
  `:172–176` block already sets `transition: border-color .12s, background-color
  .12s` and `:hover { transform: none }` unconditionally, later in the file, so
  under the preference the earlier rule loses on order and the `transform` it
  cancels is already cancelled. **Dead.**
* `.lens-arrival-pulse` — no users at all; `05-EVALUATION.md` H-13 records it
  and P-7 asks for the animation to be built. **Kept on purpose**, and the
  reason is now written beside it.

Everything else in the eleven files is referenced. The `.rv-*` block was
checked selector by selector against `review.js`; the `.lat-*` and `.al-*`
blocks against their own modules; the `.lens-*` block against `lens-panel.js`
and the view's draw transcript.

### 1.6 What the count becomes

§2 is the sheet. The arithmetic it is aiming at:

* one name per distinct value, so that `#888888` is written once and read 24
  times, instead of written 24 times;
* one **place** for each of: the ladder's five rungs, the four clock states,
  the lens vocabulary in both board themes, the health ramp at both contrast
  grades, the focus ring, the alert priorities, the z-index ladder, the
  motion durations;
* the `prefers-reduced-motion` rule stated **once**, as a token override, in
  place of the four separate `@media` blocks that state it now;
* and no pixel moved.

---

## 2. The sheet

`src/web/tokens.css` — see the file itself, which is the normative copy. It is
`@import`ed by the first line of `chrome.css` (so every lobby page gets it for
free) and linked directly by `play-game.html` (which does **not** link
`chrome.css`: the two files style different pages with overlapping selector
names, and linking one into the other would restyle the operator page). The
JS modules that inject their own stylesheets write `var(--token)` into those
strings, which resolves against the same `:root`; `board-renderer.js`, which
paints a canvas and cannot cascade, reads its colours once at init with
`getComputedStyle(document.documentElement).getPropertyValue(name)` and falls
back to its own literal when the sheet is absent — `board-test.html` links no
stylesheet at all, and must keep drawing the board it always drew.

The groups, in cascade order:

1. **palette** — raw values, named for what they are: `--grey-1a`, `--white`,
   `--okabe-orange`. No opinion about use.
2. **semantic roles** — what the interface means by them: `--ink`, `--panel`,
   `--go`, `--focus`, `--lat-degraded`, `--lens-foil`, `--health-text-low`.
   Every one of these points at a palette token.
3. **component tokens** — where one component needs its own handle:
   `--lat-clock-fill-urgent`, `--al-ring-p1`, `--tour-card-bg`, `--rv-cell-bg`.
4. **scales** — `--radius-*`, `--z-*`, `--dur-*`, `--shadow-*`, `--space-*`.

### 2.1 Light, dark, and why there is no light chrome

The `prefers-color-scheme` axis on this surface is **the board, not the OS**.
`board-renderer.js` has carried a `LENS_THEME` pair since the lens shipped —
every lens token exists twice because the board is white and the rail is
`#1a1a1a`, and a violet that reads on one is invisible on the other. That pair
is now in the sheet, once, as `--lens-*-on-light` / `--lens-*-on-dark`, and the
renderer reads it.

A light *chrome* is not introduced here, and the omission is deliberate rather
than an oversight: the operator page's ground is `#1a1a1a` unconditionally,
`04-SECONDARY-SCREENS.md` designs every contrast ratio in `05` §3 against that
ground, and the harness Chromium reports `prefers-color-scheme: light`. Adding
a light block would therefore repaint the entire surface on the next
screenshot, against ratios nobody has measured. That is a design decision for
whoever takes `P-4` and the operator-colour work — and when they do, the place
to make it is a `@media (prefers-color-scheme: light)` block that re-points
group 2 and nothing else, which is what the sheet is shaped for.

### 2.2 Reduced motion, once

Four `@media (prefers-reduced-motion: reduce)` blocks — in `chrome.css`,
`latency.js`, `alerts.js` and `tour.js` — each naming its own selectors. They
become one block in the sheet that sets every `--dur-*` token to `0s`. A
transition of zero duration and a `transition: none` are the same pixels, and
an animation of zero duration leaves the element at its own resting style,
which is what `animation: none` did. `chrome.css`'s belt-and-braces universal
rule stays: it catches anything not yet tokenised, which is the correct shape
for a catch-all.

---

## 3. What §2 did not do

* **It moved no value.** Every near-duplicate in §1.2 still has its own token
  and its own hex. Collapsing `#999999`/`#9a9a9a`/`#9e9e9e`/`#a2a2a2`/`#a6a6a6`
  onto one grey is now a one-line edit in one file — and it is a *design*
  edit, with a screenshot to approve, not a refactor.
* **It did not fix the seven remaining contrast failures** of `05` §3. Four of
  them are now single tokens (`--unit-colour-fallback` `#888888`,
  `--lat-num-ink` `#6d6d6d`, `--lat-num-bad` `#e0685a`, and the three operator
  badges' hues), which is the whole of what stands between them and P-4/P-10.
* **It did not touch `--lens-size`.** The density scale is already a
  parameterised abstraction and already correct (`05` §4); it moved into the
  sheet unchanged.

---

## 4. The gate, and the one intended change

The pass is gated on **pixel identity**: `scripts/lens-walkthrough.js` (all
four drills) and `scripts/alerts-drill.js`, before and after, image by image.
Two runs of the walkthrough against two fresh servers already differ on 12 of
its 48 images — the live-board full-page shots, where `/dev/step` timing, the
ping readout and the tour's transition phase all move — so the gate is stated
against that measured floor: **every image that is byte-identical across two
baseline runs must stay byte-identical after the change**, and the twelve that
are not must diff no worse than they diff against themselves.

Beside the screenshots there is a stronger, fully deterministic gate that a
tokenisation makes possible and a screenshot cannot give: for every element in
the DOM, at every state the walkthrough visits, in both `prefers-reduced-motion`
settings, the **entire resolved computed style** is captured and compared. A
value → `var()` substitution that is correct changes nothing there, and a
typo — a token that resolves to nothing, a fallback that differs in the last
digit — changes exactly one property on one element and says which.

One change is intended and is not zero:

* **the lobby nav links' focus ring goes from `#ffffff` to `#8ab4f8`**, which
  is what `04-SECONDARY-SCREENS.md` §2 specified and a specificity accident
  prevented (§1.5). It is visible only while a nav link holds focus, which no
  screenshot in either drill does.
