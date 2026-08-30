# SCHEMA — the principal terminology ledger

The failure this exists to stop: **an AI coordinator writing a briefing in
codebase jargon the human it is briefing has never been given.** Not once — the
owner has now corrected it three separate times, ending with

> "you really suck at empathizing with what I already understand"

and the instruction to build a memory system so the coordinator can *deduce by
elimination* when a concept needs explaining before it gets used.

The ledger lives in the repo, on the same branches the work lives on, so every
session — the cloud coordinator, the local sim worker, a post-compaction resume
that has forgotten everything — reads the same state.

---

## 1. Files

| file | what it is |
|---|---|
| `ledger.json` | **the artifact.** Everything else is a query against it or a rendering of it. |
| `FAMILIARITY.md` | generated human view, grouped by state. Never hand-edited. |
| `check-briefing.js` | reads a draft briefing on stdin, flags jargon, exits nonzero. |
| `render-view.js` | regenerates `FAMILIARITY.md`; `--check` fails on drift; `--sort` fixes merge order. |
| `lib/glossary.js` | load / validate / match. No dependencies. |
| `selftest.js` | 50 assertions, incl. deliberately malformed ledgers that `validate()` must reject, and the 20260830 vocabulary ban. |
| `USAGE.md` | the operating protocol. Read that one first if you are here to write a briefing. |

---

## 2. The familiarity state machine

Four states. A term sits in exactly one of them per principal.

```
                    (seeded from code / agent reports)
                                  │
                                  ▼
                            ┌───────────┐
       we define it in a    │ internal  │   never briefed — define inline
       briefing, with a     └─────┬─────┘   at first use, or avoid
       date and a place           │
                                  ▼
                            ┌───────────┐
                            │  defined  │◄──────── re-defined after a
                            └─────┬─────┘          correction (keeps
                                  │                redefineOnNextUse)
        principal uses it         │                        ▲
        correctly, with a         ▼                        │
        quote                ┌──────────┐                  │
                             │  native  │                  │
                             └────┬─────┘                  │
                                  │                        │
        ┌─────────────────────────┴────────────────────────┘
        │  principal says they do not know it — from ANY state, including
        ▼  native. This edge always exists and always wins.
   ┌────────────┐
   │ corrected  │  never auto-expires. Re-define at EVERY use.
   └────────────┘
```

| state | meaning | may I use it in a briefing? |
|---|---|---|
| `native` | The principal used the term correctly **themselves**. The strongest evidence there is: it is a fact about them, not about us. | Yes, unqualified. |
| `defined` | We formally defined it for them in a dedicated briefing, on a date, in a named place. | Yes. A one-clause reminder after a long gap is courtesy, not obligation. |
| `corrected` | The principal explicitly flagged it as unfamiliar. | **No** — not without re-defining it inline at that use, every time. |
| `internal` | It exists in the code or in agent reports and has **never** been briefed. | **No** — define it inline at first use, or say it in native words. |

### The edges, and what each one costs

- **`internal` → `defined`** — you defined it in a briefing. Requires an
  evidence entry naming *which* briefing. "We explained it somewhere, probably"
  is precisely the belief this system exists to kill.
- **`defined` → `native`** — the principal used it correctly on their own.
  Requires a **verbatim quote fragment**. This is a claim about a human being;
  it is not yours to assert.
- **anything → `corrected`** — the principal said they did not know it.
  Requires their own words. Available from `native` too: a term they once used
  correctly can still be one they have lost, and their say-so outranks our
  record of them.
- **`corrected` → `defined`** — you re-defined it after the correction. The
  entry keeps `everCorrected: true` and `redefineOnNextUse: true` **forever**,
  and the checker keeps raising a NOTE on it. Corrections do not expire, decay,
  or get quietly forgotten after enough sessions. That asymmetry is the point:
  the cost of over-explaining is a wasted sentence, the cost of
  under-explaining is a briefing the reader cannot follow and does not say so.
- **`corrected` → `native`** — only the principal can make this happen, by using
  the term correctly themselves, with a quote. Nothing we do promotes out of
  `corrected`.

### The second kind of `corrected`: a BAN

Added 2026-08-30. The owner banned two words — **"dark"** and
**"promoted / promotion"** — from owner-facing text, prescribing
*in-collection / selectable*, *validated* and *merged* instead. That is not an
unfamiliarity: he knows exactly what they mean and used them himself. But the
behaviour a ban needs is identical to the behaviour a correction needs — block
every use, never auto-expire, refuse to clear without an explicit `--ack` — and
`corrected` is the only state that has it.

So a ban is filed as `corrected` with:

- the ruling as the **`quote`** (it is the human's own words, which rule 4 wants);
- a **`note` beginning `THIS IS A BAN`**, which is what tells a reader — and
  `check-briefing.js`, which switches its message on it — that the entry is not
  a claim that the principal was confused;
- a **`gloss` that says `SAY INSTEAD:`** and names the replacement. A ban with no
  replacement gets ignored, because the drafter still needs a word.

`selftest.js` asserts all four of those on both banned terms, so a later tidy-up
that moves either back to `defined` fails the gate rather than silently
re-opening the word. The filenames those words are baked into
(`promotion-ledger.json`, `PROMOTION-STATUS.md`) stay as they are — a path is not
prose — and the longer `defined` phrase `promotion ledger` shields the bare word
so naming the file in a briefing still passes.

There is no `forgotten` state and no time-based decay. Decay would be an
inference about a human's memory that we have no evidence for; the ledger only
records events that actually happened.

---

## 3. Evidence rules

**A familiarity claim gets the same epistemic hygiene as an experimental claim.**
The whole ledger is worthless the first time someone writes down a guess.

Every term carries an `evidence` array, oldest first. Every entry has:

```jsonc
{
  "date": "2026-08-28",          // YYYY-MM-DD; a trailing x marks an approximate day
  "to": "native",                // the state this event moved the term INTO
  "quote": "…",                  // verbatim fragment (required for corrected)
  "attestation": "…",            // OR: where it was observed, when no fragment was kept
  "where": "…"                   // which briefing / message / report
}
```

Enforced by `lib/glossary.js validate()`, which `check-briefing.js` and
`render-view.js` both run on load — a broken ledger exits 2 rather than quietly
passing a draft:

1. Every term has **at least one dated evidence entry**. No state without an event.
2. The term's `state` must equal the `to` of its **last** evidence entry. You
   cannot change a state without recording why.
3. `native` and `corrected` are claims about the human, so they need the human's
   own words — a **`quote`**, or failing that an explicit **`attestation`**
   saying where it was seen. `attestation` is the weaker grade, is rendered as
   weaker in `FAMILIARITY.md`, and should be upgraded to a quote the next time
   the principal uses the term.
4. `corrected` needs a real **`quote`**. Attestation is not enough: we do not get
   to paraphrase someone telling us we confused them.
5. `defined` needs a **`where`**. A definition with no location did not happen.
6. `corrected` must carry `redefineOnNextUse: true`.
7. Terms are **sorted by lowercased `term`** (see §5).

`selftest.js` proves these rules bite by mutating the real ledger into five
different broken shapes and asserting each one is rejected.

---

## 4. Entry shape

```jsonc
{
  "term": "expandCluster",              // the canonical spelling
  "state": "internal",
  "gloss": "the operation that adds units to a live cluster mid-simulation.
            The owner's phrasing is \"expanding out clusters dynamically\".",
  "aliases": ["Door A", "Door B"],      // optional: other spellings that mean this
  "match": ["gate()", "gate staleness"],// optional: overrides what the checker
                                        // matches on. Use for terms whose bare
                                        // word is ordinary English.
  "note": "…",                          // optional: a caveat for the drafter
  "everCorrected": true,                // optional: was corrected at some point
  "redefineOnNextUse": true,            // required on corrected; kept after re-definition
  "evidence": [ … ]                     // oldest first
}
```

`gloss` is written **for the human, not for us**: it is the sentence you would
paste into a briefing to define the term. A gloss that only another agent could
parse has failed at the one job it has.

The `match` field is the honesty valve on the checker. `claim`, `arm`, `basis`
and `pending` are all real internal jargon *and* all ordinary English words. A
checker that fires on every occurrence of "the claim is" gets switched off within
a day, and then the system protects nothing. So those entries match on qualified
forms (`claim field`, `ScoreBounds.pending`) and say so in the gloss.

---

## 5. Merge rule

Ledger updates are **append-heavy JSON edited from several branches at once** —
the cloud coordinator on `claude/cluster-lookahead`, the local sim session on
`sim/worker-kit`, sometimes both in the same hour.

**Keep `terms` sorted by lowercased `term`.** Sorted, an append is a small
insertion at a stable line and git merges it hand-over-fist. Unsorted, every
append lands at the end of the array and every pair of branches conflicts on the
same closing lines.

- `validate()` **fails** on an unsorted list, so drift cannot survive a run.
- `node render-view.js --sort` rewrites the file in canonical order after a messy
  merge.
- Evidence arrays are append-only and oldest-first, so two sessions adding
  evidence to *different* terms never touch the same lines.
- On a genuine conflict inside one term: **take both evidence entries**, in date
  order, and re-derive `state` from the newest. Never drop a correction to
  resolve a conflict.
- The directory is mirrored **verbatim** to `sim/worker-kit`; `home.mirror` in
  the ledger records that. Data may diverge briefly and be re-synced; code must
  not. Same rule as `tools/learnloop/`.

---

## 6. Update protocol (mechanics; the *when* is in USAGE.md)

Adding a definition you just gave:

1. Find the entry (or add one, in sorted position).
2. Set `state` to `defined`; append an evidence entry with today's date, `to:
   "defined"`, and a `where` naming the briefing.
3. `node tools/principal-glossary/render-view.js`
4. Commit `ledger.json` **and** `FAMILIARITY.md` together. They are one change.

Promoting to native after the principal uses a term:

1. Append evidence with `to: "native"` and the **quote fragment** — the actual
   words, trimmed, not a paraphrase.
2. Set `state: "native"`. Re-render. Commit.

Recording a correction:

1. Append evidence with `to: "corrected"` and their quote.
2. Set `state: "corrected"`, `redefineOnNextUse: true`, `everCorrected: true`.
3. Sharpen the `gloss` to say what to use *instead* (see the `trail` entry: "in a
   briefing prefer 'snake'"). A correction that does not leave behind a better
   word will be re-made.
4. Re-render. Commit. **In the same work cycle as the correction** — a
   correction recorded "later" is a correction recorded never.

Adding a principal: append an object to `principals` with a new `id`, its own
`terms` array, and its own `notes`. Nothing is shared between principals except
the checker's stoplist — familiarity is per-person by construction, because it
is a fact about a person.
