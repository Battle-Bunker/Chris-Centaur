# Validation status — see `PROMOTION-STATUS.md`

**The page you want is [`PROMOTION-STATUS.md`](./PROMOTION-STATUS.md) in this
directory.** It renders as *"Validation status"*; only its filename still says
otherwise, and this file exists so the owner-facing name resolves too.

## Why the file was not simply renamed

Owner ruling 2026-08-30 bans "promotion" from owner-facing text. A filename sits
on the edge of that: the page is owner-facing, its name is not really prose, and
the name is load-bearing in a way the prose is not —
`promotion-ledger.json`, `bin/render-status.js`'s default `--out`, the batch-2
README, `HANDOFF.md`, `tools/simworker/COORDINATION-*.md`, the mirror on
`sim/worker-kit` and dozens of `closedIn` strings inside the ledger itself all
name it. Renaming would break every one of those to change a word, and a broken
link is a worse outcome for a reader than an old filename.

So: **the content carries the new vocabulary, the path stays stable, and this
alias makes the new name findable.** If the rename is ever wanted for real, it is
a mechanical follow-up (`git mv`, then update the `--out` default and the
references above) and this file becomes the redirect it already is.

## The vocabulary, in one line

The loop's stored statuses (`dark`, `promoted`, …) are schema constants and row
identities keyed to every historical measurement; they keep their spelling. The
rendered page translates them — *merged, not selected* / *VALIDATED* — and
`docs/BRANCHING.md` is the binding policy behind the words.
