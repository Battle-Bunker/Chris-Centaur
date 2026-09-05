# 04 — THE SECONDARY SCREENS

UX lens, document 4: everything the operator uses *around* the live view —
`/play` (find or enter a game), `/config` (bot identity and binding),
`/history` (browse past games into the lens), `/activity` (what the bot did
unattended), plus the shared chrome the four of them are supposed to have in
common (`chrome.css`, `server-status-badge.js`, `firebase-status-banner.js`,
`dom-utils.js`) and `/connection-debug`.

Answerable to `01-RESEARCH.md` — its principles P1–P5 and its pattern
catalogue — and to `docs/BOT-BINDING.md` and
`decision-lens/02-INSPECTION-UI.md` §Replay for what a path into the lens has
to land on.

The screens were photographed under Playwright against
`src/tests/secondary-screens-server.ts` (a sibling of the walkthrough server:
the shipped static mount, the shipped `GameWebSocketServer` +
`ActiveGameManager` behind `subscribe-lobby`, the shipped read-only bot-binding
routes over an in-memory `config_store`, and fixture data for the four read
routes that otherwise need Postgres). `scripts/secondary-screens-shots.js`
takes the pictures and writes what the console said beside them. Before:
`screens/before-*.png`; after: `screens/after-*.png`.

---

## 1. Findings

Ranked by what each one costs an operator, not by how hard it is to fix.
**Cost** is per-encounter: how much of the journey it eats.

### F1 — There is no bot-binding surface at all. `/config` is a different product.

*Journey: bind a bot identity to a game and know it took. Cost: the journey is
impossible in the UI.*

`docs/BOT-BINDING.md` documents two identities (`botId`, `behaviourId`), four
resolution scopes (`bot.game.<id>`, `bot.centaur.<id>`, `bot.default`,
env/built-in), a catalog, three value shapes, and a **refusal** path where a
binding with a typo'd weight key is rejected whole and the game quietly plays
the default. Two read-only routes already serve every bit of it
(`GET /api/play/game/:gameId/bot`, `GET /api/bots`).

Nothing in `src/web` calls either route. `/config` is the *heuristics* page —
sliders over `DEFAULT_CONFIG`. So:

* the operator cannot see which bot a game is playing without curling a route;
* `observed: true/false` — the difference between "this is what actually
  decided" and "this is what the next decision would resolve to" — has no
  rendering anywhere;
* a **refused** binding is invisible. The documented failure mode ("an operator
  whose stored bot has a typo'd weight key otherwise sees a game quietly
  playing the default and no reason anywhere", `routes/play.ts`) is exactly the
  silent degradation `01` §4 calls "the only unacceptable failure".

This is the single largest gap on the secondary screens, and it is the one the
brief names as a journey.

### F2 — `/config` is a second visual product wearing a second brand, with no way out.

*Journey: all of them. Cost: every visit; and it is a navigational dead end.*

`config.html` links no stylesheet, carries no `.header`/`.nav-links`, and paints
a `#667eea → #764ba2` gradient behind a white card with 2.5 rem type and emoji
section headings. The other three pages are `#1a1a1a` / `#e0e0e0` with a fixed
60 px header. It is titled "🐍 Team Snek Bot Configuration"; the product is
called Centaur everywhere else.

It has **no navigation links at all**. Once there the only way back is the
browser's Back button. `01` P2 — one key away, never two — is not merely
unmet; the affordance does not exist.

Consequences that compound: the page's own alerts (`showAlert`) are inserted
*above* the config grid, so an alert appearing or auto-hiding after 3 s pushes
every control down — a layout shift under the cursor, against `01` P3. And
`showAlert` interpolates `error.message` straight into `innerHTML`.

### F3 — Nothing on `/history` reaches a turn. The path into the lens starts at the beginning.

*Journey: browse past games and open a turn in replay at the lens. Cost: the
whole second half of the journey, every time.*

A history card is `onclick="openGame(id)"` → `/game/<id>`, and
`play-game.html` has no URL state at all (one `URLSearchParams` read in the
whole file, for a dev clock bias). So the operator lands on the replay at the
*head*, and every "the thing I wanted to look at was around turn 180" costs a
scrub. There is no deep link, no resume, and nothing to paste into a message
to another operator. `02-INSPECTION-UI` §2.2 gives replay a playhead and a
turn domain; nothing addresses it from outside.

Related, same page: the card headline is the **team label**, which is the same
string on every row ("Chris Centaur"), rendered 15 px bold. The things that
actually distinguish two rows — outcome, turn count, when — are 12 px `#888`.
The one preattentive slot on the row is spent on the one field that never
varies (`01` P1).

### F4 — `/activity` never answers its own question.

*Journey: understand what the bot did while unattended. Cost: the operator has
to do the arithmetic by hovering.*

The page draws periods and markers well — `activity-periods.js` correctly
reconstructs silent kills from heartbeat forensics, which is real work — and
then reports "16 events" as its summary. The operator's question is "how much
of the last week was the bot up, how much of that was billed idle, and did it
die". Every one of those is derivable from `periods` in the page already and
none is stated. Hover-per-band is the only way to read a duration.

Below that:

* **The legend costs more vertical space than it buys.** Nine items wrapping to
  two rows, above the fold, permanently. Two of its swatches
  (`repeating-linear-gradient` hatch, dashed border) are drawn at 14×10 px and
  are effectively invisible at that size — see `before-activity.png`.
* **The five marker types differ only in hue** — same 4 px circle, five colours,
  and `woke`'s green is the same green as the `active` band. That is a
  conjunction search where a pop-out was available, and it is not
  colour-vision-safe (`01` #17).
* **The canvas is mouse-only.** Zoom is `wheel`, pan is `pointerdown`; the
  element is not focusable and has no keyboard path, so the page's only real
  interaction is unavailable from the keyboard.
* The tooltip is absolutely positioned inside `.chart-wrap`, which is
  `overflow: hidden` — a tooltip near the lower edge is clipped.
* The chart is a fixed 260 px in a 900 px viewport; roughly 45 % of the page is
  empty (`before-activity.png`).

### F5 — Health is not readable from the periphery on the pages that are not live.

*Journey: see at a glance whether the centaur and the game server are healthy.
Cost: a saccade and a guess, on three of five screens.*

`server-status-badge.js` documents — correctly — why `/history` and `/config`
must not show a live server badge: they hold no socket, and polling to make one
truthful would itself hold the autoscale instance up. That reasoning is sound
and stays.

But the conclusion drawn from it was "show nothing", and the consequence is
that on `/history`, `/config` and `/activity` the *only* Firebase signal is a
red banner that appears when things are already broken. There is no positive
reading, so silence means both "healthy" and "never asked".

The data to fix it is already fetched and already free:
`firebase-status-banner.js` does one `GET /api/firebase-status` on load and
re-fetches on `visibilitychange` — no interval, by design. That single response
is enough for a header chip that says *what it knows and when it asked*.
Meanwhile the live pages put their two badges in the **bottom-left corner**,
farthest from where the eye rests (`01` #7).

### F6 — The lobby's entry affordance is not a link.

*Journey: find or enter a game and get to the live view fast. Cost: every
entry, plus the whole keyboard.*

`<div class="game-card" onclick="openGame('...')">` — so: no keyboard focus, no
`Enter`, no middle-click or ⌘-click into a new tab, no URL preview in the status
bar, nothing for a screen reader, and no browser history semantics. The lobby
has **no hotkeys at all**, on a product whose live view is built around single
unmodified keys (`01` #5). There is no filter, so finding a game among many is
a visual scan.

There is also an injection-shaped seam: the game id is interpolated into a
JavaScript string literal inside an HTML attribute
(`onclick="openGame('${game.gameId}')"`) with no escaping in `play.html`, and
with *HTML* escaping — which is the wrong escaping for that context — in
`history.html`.

### F7 — Cards are 170 px tall and say four short things.

*Journey: find a game fast. Cost: scanning; a handful of games fills the
viewport.*

`before-play.png`: each card is a 150 px minimap beside four lines of text,
with the turn number — the one number that says "how far along is this" — at
12 px `#888`, the same weight as the board dimensions. `startedAt` is rendered
as an absolute wall-clock time ("Started Sep 5, 1:49 PM"), which the operator
must subtract from *now* to get the reading they wanted. Nothing says how fresh
the card is, which is `01` §4's Clock B at lobby scale: a lobby that has not
had a `lobby-update` in three minutes looks exactly like one that just got one.

### F8 — The hover affordance moves the thing under the cursor.

*Journey: all. Cost: small per encounter, constant.*

`.game-card:hover { transform: translateY(-2px) }` in `chrome.css` — the card
under the pointer jumps 2 px when the pointer arrives. `01` P3's rule is that
nothing re-orders or moves under the cursor; a hover state should change ink,
not position. It also animates unconditionally (`transition: all 0.2s`), with
no `prefers-reduced-motion` path (`01` change 10).

### F9 — No page says which page it is, and two of five can't reach the others.

*Journey: all. Cost: orientation on every navigation.*

`/play` links History + Config. `/history` links Play + Config. `/activity`
links Play + History + Config. **`/activity` is linked from nowhere.**
`/connection-debug` has a single "← Back to Play". `/config` links nothing.
No page marks the current page in its own nav, so the nav teaches neither where
you are nor where you can go.

### F10 — Accessibility gaps that are cheap to close.

*Journey: all. Cost: unbounded for some operators, zero information for the
rest.*

* No `:focus-visible` styling anywhere in `chrome.css`; the default ring is
  invisible against `#333` chips (WCAG 2.4.13, `01` change 10).
* `.game-card` is a `div` with a click handler — no role, no `tabindex`.
* The activity canvas carries no accessible name or textual alternative.
* `.ws-status` and the two corner badges encode state in hue plus a text label;
  the text saves them, but the badge dot's `2s` pulse animation is
  unconditional — no `prefers-reduced-motion` (`01` change 10).
* `history.html` writes a database-sourced colour straight into a `style`
  attribute (`escapeHtml(group.team_color)`), where `play.html` learned to run
  the same value through a `safeColor` allowlist. Two pages, two rules, one
  value.

### F11 — Small correctness and duplication seams.

*Cost: none today; each is a foot-gun.*

* `history.html`'s weight glyph is `⚖️` — an emoji, in a chrome that has no
  emoji font in headless Chromium, and it renders as tofu in
  `before-history.png`.
* `safeColor` exists once (`play.html`) and is missing where it is equally
  needed (`history.html`), while `dom-utils.js` is the file that exists to hold
  exactly this.
* `/api/logs/games` is unbounded and `history.html` renders all of it with no
  filter, no paging and no count guard.

### Not a finding

`board-test.html` is unlinked from every navigation, but it is *not* dead: it
is served by a route (`src/index.ts:82`) and is the only exercise of
`board-renderer.js`'s territory fixtures.
`decision-lens/02-INSPECTION-UI.md` §D8 already proposes its removal on
grounds that belong to that document, not this one. Nothing under `src/web`
is provably unreferenced: every script there is loaded by at least one page,
and `invulnerability-potion.png` is fetched by `board-renderer.js`.

---

## 2. The plan

Written before the work, one item per finding; §3 records what
landed. Each item names the finding it closes. Nothing here changes a decision, a
binding's resolution, or anything on the wire: the two bot routes stay
read-only, no new polling was introduced, and no fetch was added that a page
did not already make except the once-per-game bot readback in §2.2, which is
issued once per game id and cached.

### 2.1 Shared chrome (F2, F5, F8, F9, F10)

`chrome.css` gains one clearly delimited block at the end of the file — every
rule in it is inside `/* ── UX-SECONDARY ── */ … /* ── END UX-SECONDARY ── */`,
so the merge with `ux-ia`'s edits is a trivial one.

* The header becomes a three-slot grid: **brand · page name** on the left, nav
  in the middle, **status chips** on the right — moving health from the
  bottom-left corner (`01` #7: cooldowns belong near the gaze) into the one
  place the eye already passes on every page.
* `page-chrome.js` (new, shared) renders the same nav on all five pages, marks
  the current one with `aria-current="page"` and a persistent left rule, and
  owns the status chips and the shortcut keys. It reads the Firebase chip from
  the status `firebase-status-banner.js` already fetched — **no new request and
  no interval**.
* A chip is a **shape plus a word plus a brightness**, never a hue alone: `●`
  live, `◐` degraded/paused, `○` unknown, `✕` down. Colour reinforces.
* `:focus-visible` gets a 2 px `#8ab4f8` ring with a 2 px offset on every
  interactive element in the chrome, and `prefers-reduced-motion: reduce` kills
  the badge pulse, the card transition and the chip animation.
* `.game-card:hover` no longer translates; it changes border and background
  only.

### 2.2 `/play` — the game list (F6, F7)

* A card is an `<a href="/game/<id>">`. The `onclick`-with-interpolated-id is
  gone, and with it the JS-string-in-an-attribute seam.
* Rows are half the height: the **turn number is the headline**, the elapsed
  time is relative ("14m ago"), the id is a monospace tail, and the minimap is
  96 px.
* Each of the first nine rows carries its own **index chip `1`…`9`**, which is
  also its hotkey. `/` focuses the filter, `↑ ↓` move the selection, `Enter`
  opens it, `Escape` clears the filter, `Ctrl+/` opens the key list — the same
  chord `play-game.html` uses.
* **Freshness**, `01` §4 Clock B at lobby scale: the status bar carries the age
  of the last `lobby-update` and moves `LIVE → 30 s+ → 2 min+` by *brightness
  and word*, never by a red banner.
* Each card reads back its **bound bot** from `GET /api/play/game/:id/bot`,
  once per game id, cached — the name, the scope it resolved from, and a `~`
  marker when `observed` is false.

### 2.3 `/config` — bot identity and binding, then heuristics (F1, F2)

The page is rebuilt in the shared dark chrome, keeps its heuristics registry
rendering exactly as it was, and gains the surface `docs/BOT-BINDING.md`
describes:

* **Identity**: this deployment's `behaviourId` and its reading
  (`git:` / `pkg:+dist:` / `unknown`), and the bindable catalog from
  `GET /api/bots`.
* **Readback**: pick a live game, see what the seam resolved — `botId`,
  `source`, `key`, `observed`, `stagingSafety`, `candidates` — with `observed`
  drawn as the distinction it is, not as a boolean field.
* **Refusals**: any refused binding is drawn at the top of the panel in full,
  because the documented failure is that it is invisible.
* **Composer with commitment and undo**: choose a scope (game / centaur /
  deployment) and a bot, and the page writes out the exact `config_store` key,
  the exact JSON value, the exact upsert **and the exact `DELETE` that undoes
  it**, both copyable. `01` P4 asks for release to be as visible as
  commitment; here they are rendered together, and neither is a dialog.
* **"Did it take?"** is a `Verify` button that re-reads the route and states
  the answer against the binding you staged — took / still resolving from a
  different scope / refused, with the reason. This is the readback the journey
  needs, and it needs no write endpoint: the two routes stay read-only, as
  `routes/play.ts` intends.
* The heuristics half gains what it lacked: a **live diff** of which values
  differ from what was loaded, `Save` naming exactly what it wrote, and
  `Revert` restoring the loaded values with no round trip. The alert region is
  a fixed-height line in the action bar, so nothing shifts under the cursor.
  Alert text is set with `textContent`.

### 2.4 `/history` — the path into the lens (F3, F10, F11)

* **Deep link**: a row opens `/game/<id>#turn=<n>`, and `replay-deeplink.js`
  (new, shared, 60 lines) teaches the viewer to honour it — it waits for the
  page's own turn domain to exist and then commits one scrub, and thereafter
  keeps `#turn=` in step with the playhead via `replaceState`, so the URL in
  the address bar is always the turn on screen and is always pasteable. One
  `<script src>` line was added to `play-game.html`; nothing else in that file
  was touched.
* **Resumable**: the viewer records the last turn viewed per game in
  `localStorage`, and the history row offers `↩ resume at turn K` beside
  `open at turn …`, which takes a typed turn.
* The row is re-ranked: the **outcome** is the headline (`WON` / `LOST` /
  `DRAW` / `UNFINISHED`, a word and a shape, not a hue), then turns, then the
  relative time; the team label — identical on every row — drops to a chip and
  the id to a monospace tail.
* `/` filter, `↑ ↓ Enter`, `1`…`9`, same as the lobby.
* `safeColor` moves into `dom-utils.js` and both pages use it; the `⚖️` emoji
  becomes a plain `·len` reading.

### 2.5 `/activity` — readability (F4, F10)

* A **summary strip** above the chart, computed from the periods already
  reconstructed: window, uptime, active vs idle (with idle's share, since idle
  is the billed waste the page exists to expose), boots, and ends by class —
  graceful, crash, silent kill. That is the answer to "what did the bot do
  while I was away", stated rather than left to hovering.
* Markers get **distinct shapes** — boot `▲`, shutdown `▼`, woke `●`,
  went-idle `■`, suspended `◆` — so the search is a pop-out and does not depend
  on hue. Colour still reinforces.
* The legend collapses to one compact row and its two invisible swatches are
  drawn on canvas at a size where they read.
* The chart is taller and the tooltip escapes the clipping container.
* The canvas is focusable with an accessible name; `← →` pan, `+ -` zoom,
  `Home` returns to now, `r` reloads.

### 2.6 `/connection-debug` (F9)

Adopts the shared chrome and nav, so it is no longer a page you can only leave
in one direction.
