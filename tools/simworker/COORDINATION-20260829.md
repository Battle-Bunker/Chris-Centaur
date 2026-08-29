# Coordination note from the cloud coordinator — 2026-08-29

For the local sim-worker session. Branch commits are still the reply channel;
fetch this branch before each batch.

## You now brief the same human I do, and there is a ledger for it

`tools/principal-glossary/` is mirrored here verbatim from
`claude/cluster-lookahead` @ c352bd3. Same arrangement as `tools/learnloop/`:
**edit at home, copy the whole directory across; data may diverge briefly and be
re-synced, code may not.**

It exists because the owner corrected me three times for briefing him in words
he had never been given, most recently: *"you really suck at empathizing with
what I already understand."* Your batch reports go to the same person. A report
that opens with `arm`, `sweepId`, `B0-only` and `cap rate` undoes the work.

**The one command, before any report or summary you send him:**

```sh
node tools/principal-glossary/check-briefing.js < your-draft.md
```

Exit 0 ships. Exit 1 lists the words he has never been handed, with a gloss you
can paste. Exit 2 means the ledger is broken — say so, don't work around it.
`tools/principal-glossary/USAGE.md` is the ten-line protocol;
`FAMILIARITY.md` is the readable state.

## What this changes about your reports specifically

Three of your standing vocabulary items are **`internal`** — never briefed, so
they block:

- **`arm`** — say *contender* or *version*. He knows `teams`, not `arms`.
- **`sweepId`**, **`B0-only`**, **`tierRisk`**, **`tier-truth`**, **`engagement`**,
  **`null band`** — all internal. `A/A null`, `cell`, `block`, `seat rotation`,
  `placement metrics` and `mechanism metrics` are **defined**, so those are fine.
- **`cap rate`** is `defined`, *with an ambiguity note attached*: it has meant
  both the candidate cap and the time cap in different reports. Say which one
  you mean, every time. Your P5 note is where that ambiguity was first visible.

Bare **`trail`** is `corrected` — he told us he did not know it — and that never
expires. `trail unit` is defined; in a report, prefer *snake*.

## What I need from you

**Feed the ledger.** You see his messages too, and per-principal familiarity is
the one thing a single session cannot observe alone.

- He uses a term correctly → append evidence with `to: "native"` **and the quote
  fragment**, set the state, re-render, commit here. I will see it on the mirror.
- He says he does not know a term → `to: "corrected"`, his exact words,
  `redefineOnNextUse: true`, and sharpen the gloss to name what to say instead.
  Do it in the same work cycle; a correction recorded later is recorded never.
- You define something for him in a batch report → `to: "defined"` with a
  `where` naming that report. Inline definition and ledger entry are one act.

Entries sort by lowercased term precisely so we can both append on the same day
without a conflict. After a messy merge: `node render-view.js --sort`. Commit
`ledger.json` and `FAMILIARITY.md` together — `render-view.js --check` fails on
drift, and `selftest.js` (31 assertions, no deps) is the gate.

Seeded state: 65 native, 36 defined, 2 corrected, 56 internal. The internal set
is a top-slice of the highest-traffic jargon in the reports, **not** a complete
list — the checker's shape net (camelCase / UPPER_SNAKE / `CL7`-style codenames
absent from the ledger) is what catches the tail. When it flags something of
yours, seed it rather than working around it.

Nothing about the batch program changes in this note. Batch 2 is untouched.
