# USAGE — the operating protocol

For the coordinator (and any session that briefs a human principal). The state
machine and evidence rules are in `SCHEMA.md`; this is the part you follow every
time you write to the owner.

---

## The protocol, in ten lines

1. **Before drafting** an owner briefing, open `FAMILIARITY.md` — or just draft
   it and pipe it through the checker, which is the same consult done properly.
2. `node tools/principal-glossary/check-briefing.js < draft.md` — exit 0 ships,
   exit 1 does not, exit 2 means the ledger is broken and you fix that first.
3. **BLOCK = `internal` or `corrected`.** Either define it inline in the sentence
   that uses it, or say it in a `native` word instead. Do not append a glossary.
4. **BLOCK = a jargon-shaped token the ledger has never heard of** (camelCase,
   PascalCase, UPPER_SNAKE, ALLCAPS, `CL7`-style codenames). New jargon. Same fix.
5. **At first use of any non-native term: define it inline AND write the
   definition event into `ledger.json` in the same work cycle.** Not next turn.
6. **The principal uses a term correctly → promote to `native` with their quote.**
   This is the elimination half: what they demonstrate, you stop explaining.
7. **The principal says they do not know a term → demote to `corrected` with
   their quote, now.** Corrections never auto-expire and never decay by time.
8. After any ledger edit: `node render-view.js`, then commit `ledger.json` and
   `FAMILIARITY.md` in one commit. `--check` fails on drift, so don't skip it.
9. **Mirror to `sim/worker-kit`** — the local sim session briefs the same human.
10. **Compaction:** the standing-directives file carries a one-line *pointer*
    here, never a copy. The ledger is the state; a copy is a stale second truth.

---

## The three commands

```sh
# Before you send anything to the owner.
node tools/principal-glossary/check-briefing.js < draft.md
node tools/principal-glossary/check-briefing.js --principal chris --file draft.md

# After you edit the ledger. --check fails if the view has drifted.
node tools/principal-glossary/render-view.js

# The gate.
node tools/principal-glossary/selftest.js        # 31 assertions, no dependencies
```

Useful flags: `--ack term1,term2` (you re-defined it inline at that use — the ack
is echoed as a debt you still owe the ledger), `--strict` (debts fail too),
`--code` (also scan fenced/inline code, which is skipped by default), `--json`,
`--quiet`, `--ledger PATH`.

---

## What the checker is actually doing

It reads your draft as prose and asks three questions.

**Is this a word the principal has never been given?** Terms in `internal` or
`corrected` are matched literally, with word boundaries and a plain plural. A
longer `defined` phrase shields a shorter unsafe word nested inside it — writing
"trail unit" is fine even though bare "trail" is corrected — because a checker
that cries wolf gets switched off, and then it protects nothing.

**Is this a word *nobody* has ever written down?** Any token shaped like
identifier jargon and absent from the ledger entirely gets flagged. This is the
net for jargon that has not been seeded yet, and it is why the seed does not need
to be complete: shape catches what enumeration missed. When it fires on something
ordinary, add that token to `checker.stoplist` in the ledger — which is a claim
that it is plain English or a proper noun, **not** a way to silence real jargon.
If it is project vocabulary, give it an entry instead.

**Did you already fix it here?** If the draft looks like it defines a flagged
term in place — `VOC (= value of computation)`, `X means Y`, `X — the thing
that…` — the finding drops from BLOCK to **LEDGER OWED**: you did the right thing
in the prose and now owe the ledger the event. `--strict` makes those fail too,
which is what you want in a gate that runs unattended.

Corrected terms are the exception: they always BLOCK, and clearing one takes an
explicit `--ack`. That extra friction is deliberate. Those are the terms a human
already told us they did not understand.

---

## Worked example

Draft:

> The kernel carries the ratchet across rounds, and a new gainWeighting pass
> reorders candidates before the second round of node evaluation.

```
BLOCKING — 2 term(s) chris has never been given:
  L1  ratchet
        INTERNAL: lives in code/agent reports, never briefed to chris
        it means: the monotone tightening of bounds that must never reset across rounds.
  L2  gainWeighting
        NEW JARGON SHAPE (camelCase) and absent from the ledger.
```

Rewrite — define in the sentence that uses it, in his own vocabulary:

> Bounds only ever tighten as the rounds go on; a later round can narrow a
> candidate's floor and ceiling but never widen them back out. We added a pass
> that re-orders candidates by how much we expect each one to gain from more
> compute time, so the expensive rounds start with the branches most likely to
> change the answer.

Then, same work cycle: `ratchet` stays `internal` (we avoided it rather than
defined it — nothing to record); `gainWeighting` gets seeded as `internal` so the
next session's checker knows the word exists. Had you chosen to define "ratchet"
by name instead, it moves to `defined` with today's date and a `where`.

That is the whole discipline: **use his words, or lend him yours on the spot and
write down that you lent them.**

---

## Two branches, one ledger

`claude/cluster-lookahead` is home. The whole directory is mirrored verbatim to
`sim/worker-kit`, because the local sim session briefs the same human and must
not undo the coordinator's work by shipping a report full of `arm`, `sweepId` and
`B0-only`. Same rule as `tools/learnloop/`: **data may diverge briefly and be
re-synced; code may not.** Edit here, copy the directory across, note it in the
commit.

Entries stay sorted by term so two branches appending on the same day merge
without a conflict. After a messy merge: `node render-view.js --sort`.

---

## Compaction

The standing-directives file (`scratchpad/synthesis-pins.md`, directive 0e) must
carry **one line** pointing at this ledger, and nothing more. Not a copy of the
term lists — a copy is a second truth that goes stale the first time either side
is edited, and a compaction that preserves the stale copy while dropping the
pointer is worse than no memory at all.

The line to keep:

> `0e. TERMINOLOGY: consult tools/principal-glossary/ (ledger.json + check-briefing.js) on claude/cluster-lookahead before every owner briefing. The ledger is the state; never copy it into this file.`

---

## Honest limits of the seed

- 47 of the 65 `native` entries rest on an **attestation** rather
  than a retained verbatim fragment: they were seeded from a session transcript
  that was not quoted line by line. `FAMILIARITY.md` marks them, and they are the
  weakest rows in the ledger. Upgrade each with the owner's own words the next
  time he uses the term.
- The `internal` set is a top-slice of the highest-traffic jargon in
  `scratchpad/synthesis-pins.md`, the `cl*-report.md` files and the `arch-*.md`
  memos. It is **not complete and was never meant to be** — the shape heuristic
  is what covers the tail. Seed what the shape net catches, as it catches it.
- `native` means *he used the word*, which is not the same as *he shares our
  model of the thing*. It licenses using the word without a definition. It does
  not license assuming he agrees with what we mean by it.
