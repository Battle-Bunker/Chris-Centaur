# 12 — PREFERENCES: one store, and what belongs in it

UX lens, document 12. In one day six passes each grew their own persisted
state, and each of them was right to: an operator who picks the vim scheme
wants it next morning, an operator who mutes an alert class wants it to stay
muted, and a reviewer who bookmarks a turn wants the bookmark. What none of
them could do from inside its own file is see the other five. So the product
now has **eleven `localStorage` keys, five spellings of "read a value back
safely", four different ways of failing on a corrupt one, and one migration
already hand-written in an inline `<script>`**.

The rule this work is answerable to is the owner's standing one, applied here
as to CSS and to code: **delete duplication by factoring onto parameterised
abstractions**. Six special cases become one schema-driven store; the six
modules keep their behaviour exactly and lose their storage code.

Answerable to `02-IA-AND-CONTROLS.md` §3.1 (the key schemes and the density
scale), `03-LATENCY.md` §3 (the wire strip), `04-SECONDARY-SCREENS.md` (the
shared chrome), `06-ALERTS.md` §2 (the mute, the volume, the per-event
opt-out — WCAG 1.4.2), `07-REVIEW.md` §5 (bookmarks) and `09-DESIGN-TOKENS.md`
for the shape of this argument: **nothing here is allowed to behave
differently**, and the gate is the walkthrough's own drills plus pixel
identity at rest.

---

## 1. The inventory — what was persisted, and by whom

Every `localStorage` read and write in `src/web/**` and `src/lens/view/**`,
counted before the change. `src/lens/view/**` holds **none**: the view model
emits a draw transcript and never touches storage, which is the property that
lets the same fold run in a test, in replay and in the page.

| key | written by | shape | meaning | after |
|---|---|---|---|---|
| `lensKeyScheme` | `play-game.html` (inline) | `'bracket' \| 'vim' \| 'lefthand'` | which spelling of the one action set (`lens-panel.js`) | `lens.scheme` |
| `lensDensity` | `play-game.html` (inline) | `'compact' \| 'default' \| 'roomy'` | the rail's type scale | `lens.density` |
| `unitTagDisplayMode` | `play-game.html` (inline) | `'always' \| 'ours' \| 'never'` | which unit tags are drawn at rest | `board.tagMode` |
| `unitTagsHiddenByDefault` | *(dead — read only)* | `'1'` | the two-state ancestor of the above | migrated → `board.tagMode` |
| `unitTagsTranslucentDefault` | *(dead — read only)* | `'1'` | its own ancestor | migrated → `board.tagMode` |
| `boardSizePx` | `play-game.html` (inline) | integer as string, 300–1400 | the board box the operator dragged to | `board.sizePx` |
| `centaurAlerts` | `alerts.js` | `{muted, volume, notify, events:{id→bool}}` | master mute, volume, desktop opt-in, per-event opt-out | `alerts.*` (4) |
| `lensTourDone` | `tour.js` | `'1'` (a tour VERSION) | the tour has been completed at this version | `tour.doneVersion` |
| `centaur.reviewMarks` | `review.js` | `{gameId → [{turn, focus, at}]}` | the reviewer's bookmarks | `review.marks` |
| `centaur.lastTurn` | `replay-deeplink.js` | `{gameId → turn}` | where this browser last was in a replay | **not a preference** — §4 |
| `wsDebugConnId` | `connection-debug.js` | opaque id | the debugger's queue identity | **not a preference** — §4 |

Nine preferences, eleven keys, five files. Three of the four failure modes
below appear at least twice:

* **`lensDensity`** validates its enum (`'compact' \| 'roomy' \| 'default'`,
  anything else ignored) — correct.
* **`boardSizePx`** validates `Number.isFinite` but **not the range**: a
  hand-edited `99999` is honoured as a preference and only clamped on the way
  to the element, so the operator's stored size is a number the product can
  never show.
* **`lensKeyScheme`** does not validate at all; `LensPanel.setScheme` happens
  to fall back to `bracket`, so the bug is absent by luck in another file.
* **`centaurAlerts`** is the one that does it properly — parse in a `try`,
  then a typed check per field — and it is 22 lines of hand-written schema.
* **`lensTourDone`** compares to a version string, which is the only migration
  strategy in the set that survives a change of meaning.
* **`centaur.reviewMarks`** parses in a `try` and returns `{}` on garbage, but
  never validates the *shape* inside: a corrupt array of marks reaches the
  renderer.

And the storage call itself is written five times, each with its own comment
about private mode: `try { … } catch (_e) { /* ignore */ }` in the inline
script, `stored()`/`store()` in `tour.js`, `readMarks()`/`writeMarks()` in
`review.js`, `loadPrefs()`/`savePrefs()` in `alerts.js`, and a bare
`localStorage.getItem` inside a `try` in `replay-deeplink.js`.

---

## 2. The schema — one table, one key, one shape

`src/web/prefs.js` holds **one** table. Everything else in the module — the
defaults, the validation, the migration, the settings panel's controls, the
export document — is derived from it, so a new preference is a row and never
a code path.

### 2.1 The storage key is versioned; the preference names are namespaced

```
localStorage['centaur.prefs.v1'] = {
  v: 1,
  at: 1757030400000,            // when this document was last written
  migrated: ['lensKeyScheme'],  // legacy keys folded in, for the record
  values: { 'lens.scheme': 'vim', 'alerts.volume': 0.25, … }
}
```

**One key, not one key per preference.** A single document is one `storage`
event to react to, one atomic write, one export, and one place a corrupt
profile can be reset from. The *version* lives in the key so that a future
`v2` can read `v1` through exactly the machinery §3 uses for the legacy keys —
a migration is a table entry, not a new mechanism.

**The names inside are namespaced** `group.name`, and the group is the module
that owns the preference. The namespace is not decoration: it is what lets
`reset('alerts')` and the panel's per-group section be written once.

Only preferences that differ from their default are stored. A default that
changes therefore reaches every operator who never touched it, which is the
behaviour a default is for.

### 2.2 The types

Five type descriptors, and no preference may have a type outside them —
because every type is a validator, a control in the panel and a line in the
export at the same time.

| type | fields | validated as | panel control |
|---|---|---|---|
| `boolean` | — | `typeof === 'boolean'` | checkbox |
| `number` | `min`, `max`, `step`, `integer` | finite, in range, rounded when `integer` | range + readout |
| `enum` | `values`, `labels` | member of `values` | `<select>` |
| `flags` | `ids`, `labels` | object; each known id boolean, unknown ids dropped | one checkbox per id |
| `opaque` | `summary` | JSON-serialisable; shape checked by the owning module | count + *Forget* |

`opaque` is the deliberate escape hatch, and it has exactly one occupant:
`review.marks` is a per-game map of bookmark arrays, not a control anybody
would ever render as a widget. It is a preference by §4's test — it is
persisted, per operator, and its loss is an annoyance and not a corruption —
so it belongs in the store even though the panel can only count it and offer
to forget it.

### 2.3 The table

| id | group | type | default | read by |
|---|---|---|---|---|
| `lens.scheme` | lens | `enum` `bracket\|vim\|lefthand` | `bracket` | `play-game.html` → `LensPanel.setScheme` |
| `lens.density` | lens | `enum` `compact\|default\|roomy` | `default` | `play-game.html` → `.lens-compact` / `.lens-roomy` |
| `board.tagMode` | board | `enum` `always\|ours\|never` | `always` | `play-game.html` → `BoardRenderer` |
| `board.sizePx` | board | `number` 300–1400, integer | `550` | `play-game.html` → the canvas box |
| `alerts.muted` | alerts | `boolean` | `false` | `alerts.js` |
| `alerts.volume` | alerts | `number` 0–1 step 0.05 | `0.6` | `alerts.js` |
| `alerts.notify` | alerts | `boolean` | `false` | `alerts.js` |
| `alerts.events` | alerts | `flags` over the catalogue's six ids | all `true` | `alerts.js` |
| `wire.numbers` | wire | `boolean` | `true` | `latency.js` — the four-number strip |
| `tour.doneVersion` | tour | `enum` `''\|'1'` | `''` | `tour.js` |
| `review.marks` | review | `opaque` | `{}` | `review.js` |
| `chrome.landing` | chrome | `enum` the five screens | `play` | `page-chrome.js` — where the brand goes |

Twelve preferences in seven groups. Two of them are new and both are one line
in the module that reads them: `wire.numbers` gives `03-LATENCY.md`'s strip
the opt-out its own §3 asks for (the state word and the clock stay — what a
glance answers is never a preference), and `chrome.landing` lets an operator
who lives in `/history` stop being sent to `/play` by the brand mark. Both
default to today's behaviour, which is why the pixel gate holds.

### 2.4 Validation on read — the failure is a fallback, never a throw

```
read(id)  = validate(stored[id]) ?? default(id)
```

One function, driven by the type descriptor. A value that fails validation is
**not** written back over and is **not** thrown on: `get` returns the default,
the panel shows the default, and the next `set` of that id replaces the
corrupt value. A whole document that fails to parse is discarded the same way
— every preference falls back at once, and the page comes up. A storage object
that throws on access (a locked-down profile, a private window with site data
off) leaves the store in memory-only mode: every preference works for the
session and nothing persists, which is what all five hand-written versions
were trying to do in their `catch`.

The store never throws out of `get`, `set`, `reset`, `export` or `import`.
That is the property the six modules were each paying for separately.

---

## 3. The migration — every existing key, losslessly

One table, applied once, on the first load after this ships:

| legacy key | becomes | rule |
|---|---|---|
| `lensKeyScheme` | `lens.scheme` | validated as its enum; an unknown scheme falls back to `bracket` |
| `lensDensity` | `lens.density` | as its enum |
| `unitTagDisplayMode` | `board.tagMode` | as its enum |
| `unitTagsHiddenByDefault` | `board.tagMode` | `'1'` → `never`; only if `unitTagDisplayMode` did not already answer |
| `unitTagsTranslucentDefault` | `board.tagMode` | as above — this is the inline script's own migration, moved into the table it belongs in |
| `boardSizePx` | `board.sizePx` | parsed, then **clamped** into 300–1400 (the one behaviour change: an out-of-range stored size is now stored in range) |
| `centaurAlerts` | `alerts.muted`, `alerts.volume`, `alerts.notify`, `alerts.events` | per field, each through its own type |
| `lensTourDone` | `tour.doneVersion` | verbatim; `tour.js` still compares it to its own `VERSION` |
| `centaur.reviewMarks` | `review.marks` | verbatim |

**Ordering is first-writer-wins**, so the modern key beats the two dead
ancestors it replaced. A legacy value that fails its type is dropped and the
default stands — which is the same rule as §2.4 and not a second one.

After a *successful* write of the new document the legacy keys are removed,
and their names are recorded in `migrated` inside it. Nothing is lost: the
values are in the document that just landed, and the record says where they
came from. If the write fails (quota, private mode) the legacy keys are left
exactly where they are, because a migration that deletes the only copy is not
a migration.

`centaur.lastTurn` and `wsDebugConnId` are **not touched** — §4.

---

## 4. What is a preference, and what is session state

A **preference** is: *persisted*, *per operator*, *set deliberately*, and
*about how the product behaves rather than where the operator is in it*. It
belongs in the store, it appears in the panel, and it is in the export.

**Session state** is everything that is about *this visit*: a cursor, a
selection, a scroll offset, a filter, a position in a replay, a connection's
identity. It may still be persisted — persistence is not the test — but it is
not a preference, it does not appear in the panel, and it is not exported,
because handing your preferences to another operator must not hand them your
place in a game.

The test, stated so the next reader can apply it without asking: **would you
be annoyed, or confused, to find this the same on a different machine
tomorrow?** Annoyed → session state. Confused if it *weren't* → preference.

By that test:

| state | verdict | why |
|---|---|---|
| the key scheme, the density, the tag mode, the board size | preference | how the product behaves; you would be confused to lose it |
| the alert mute, volume, desktop opt-in, per-event opt-outs | preference | the same, and WCAG 1.4.2 requires the mute to persist |
| the tour's completion | preference | a one-way flag about *you*, not about a game |
| review bookmarks | preference | deliberately set, per operator, about no single session |
| `centaur.lastTurn` — the last turn viewed per game | **session** | where you are, not how it behaves; a deep link is the shareable form of it |
| `wsDebugConnId` | **session** | a connection's identity; it is diagnostic plumbing |
| the lens cursor, the focused unit, the staged moves, the undo stack | **session** | the whole point is that they are about this turn |
| the list filter on `/play` and `/history` | **session** | it is cleared by `Esc`, and it is about this visit |
| the scrub position, `viewMode`, the expanded lane | **session** | position in a game |
| the operator's name (`sessionStorage`) | **session** | it is per game and per tab, by design |

Two consequences worth stating. `replay-deeplink.js` keeps its own key and its
own code — it is deliberately *outside* this store, and the doc says so
instead of leaving the next reader to wonder whether it was missed. And
`tour.doneVersion` is in the store but is not a control anybody sets: the
panel shows it as *Reset the guided tour*, which is the only operation on it
an operator ever wants.

---

## 5. The settings panel

**One popover, `Ctrl+,`, on every screen.** It is built by `prefs.js` itself,
not by the chrome, because `play-game.html` does not load `page-chrome.js` and
an operator who learns a chord on one screen must find it on the other. Where
there *is* chrome — the five secondary screens — `page-chrome.js` adds a
`Settings` chip beside the status chips and a row to its key sheet, so the
chord is discoverable and not folklore.

The panel is **generated from the table in §2.3**: one `<section>` per group in
declaration order, one control per row chosen by type, a *Reset group* button
beside each heading, and *Reset everything* at the foot. There is no
per-preference layout code, which is the whole point — `wire.numbers` cost one
table row and no panel work at all.

`alerts.js` keeps its own small popover on the alert button. It is not a
second store: it reads and writes the same four preferences through `Prefs`,
and a change made in either surface is reflected in the other on the next
paint through the same subscription every other module uses. Two affordances
onto one value is a UI decision (the mute must be one click from the alert
that is annoying you); two *stores* would be the duplication this document is
about.

**Export and import are clipboard, not file.** The sandbox the drills run in
blocks downloads, and a preferences document is a few hundred bytes of JSON —
so *Copy* writes the whole document to the clipboard, the same JSON sits in a
textarea in the panel for a browser that refuses clipboard access, and
*Import* parses whatever is in that textarea. Import is **per preference**:
every id that validates is applied, every id that does not is listed by name
in the panel's status line, and an unknown id is reported rather than stored.
A half-valid document therefore lands its valid half, which is what an
operator pasting a colleague's setup actually wants.

### 5.1 Change events

`Prefs.subscribe(fn)` fires with the ids that changed, from three sources:

1. a `set` in this page — the panel, or a module's own affordance (the Alt tap
   that cycles the tag mode, the drag that resizes the board);
2. a `reset` or a successful `import`;
3. **another tab** — the `storage` event on `centaur.prefs.v1`, diffed against
   what this page holds, so only the ids that actually changed are announced.

Modules re-render from the ids they care about and from nothing else. That
third source is the one no module had before: two tabs open on the same game
used to disagree about the density until one of them was reloaded.

---

## 6. The gate

* `npx tsc --noEmit -p .`, `npx eslint "src/**/*.ts"`, `node --check` on every
  changed `.js`, `npm run build:lens`.
* `npx jest --maxWorkers=2 "src/tests/lens-" src/tests/local-game-determinism.test.ts`.
* `scripts/lens-walkthrough.js` — every drill green, now five of them.
* `scripts/alerts-drill.js` — 46 checks, including the two that read
  `Alerts.prefs()` back after a reload, which now reads through the store.
* `scripts/lens-soak.js` — 200 turns; the store adds one listener and one
  object and must show up as neither growth nor a leak.
* **Pixel identity at rest**: every preference defaults to what shipped, the
  panel is `hidden` until it is asked for, and the chrome chip is the only new
  ink anywhere — on five screens the walkthrough photographs by element crop,
  never by full page.

### 6.1 The prefs drill

New in `scripts/lens-walkthrough.js`, and it runs **last**, because it is the
one drill that deliberately changes what the page looks like. Three parts:

1. **Round trip.** Every preference is set *through the panel* — not through
   `Prefs.set`, because a panel that writes to the wrong id is exactly the bug
   a store makes possible — then the page is reloaded and **each module is
   asked what it read**: `LensPanel.activeScheme()`, the rail's density class,
   the tag mode, the canvas box, `Alerts.prefs()`, the wire strip's attribute.
   A preference that persists but that nobody reads is not a preference.
2. **Migration.** Storage is cleared, the nine legacy keys are planted with
   known values, the page is loaded, and the drill asserts every value arrived
   at its new id, that the legacy keys are gone, and that `migrated` names
   them.
3. **Corruption.** A document with a bad enum, an out-of-range number, a
   string where a boolean belongs and a truncated payload is planted; the page
   must load with **no exception** and every corrupt id must read its default
   while the valid ids beside them survive.

Then the store is reset, so the profile the next run inherits is the shipped
one.
