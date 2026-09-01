# coordination/

This branch is a **data / knowledge branch**, not a code branch. It is not
meant to merge into `primary` or into any feature branch, and there is no PR
open for it — see docs/BRANCHING.md's branch table on `claude/cluster-lookahead`
for where it sits relative to everything else.

## What this is

A synced copy of the coordinating agent's scratchpad knowledge artifacts —
the running record of standing owner directives, in-flight experiment state,
architecture memos, and cross-agent synthesis that normally lives only in
`$SP` (the scratchpad directory) on whichever box is currently running the
coordinator session. That scratchpad is the **working copy**: it is what
gets read and edited turn to turn, and it is authoritative.

This branch exists so the owner (or another session) can still reach that
knowledge if the box holding the live scratchpad becomes unreachable —
container interruption, usage exhaustion locking the session out, or the
session simply ending. A GitHub branch survives all of those; a scratchpad
directory on one box does not.

## What's in here

Point-in-time snapshots, each carrying a short header naming its scratchpad
source file and the time it was synced:

| file | scratchpad source | what it is |
|---|---|---|
| `PINS-SNAPSHOT.md` | `synthesis-pins.md` | standing owner directives, rulings, and pinned findings — the compaction-surviving record |
| `capability-ledger.md` | `capability-ledger.md` | capability/tooling ledger |
| `experiment-queue.md` | `experiment-queue.md` | queued and in-flight experiments |
| `attention-queue.md` | `attention-queue.md` | items awaiting owner or agent attention |
| `process-diagnosis.md` | `process-diagnosis.md` | process-level diagnosis notes |
| `core-redesign.md` | `core-redesign.md` | core architecture redesign notes |
| `dof-synthesis.md` | `dof-synthesis.md` | degrees-of-freedom synthesis notes |
| `rebase-transfer-design.md` | `rebase-transfer-design.md` | rebase/transfer design notes (5 dilemmas essay) |
| `batch2-runner.md` | `batch2-runner.md` | batch-2 runner notes |

## Freshness

Refreshed periodically as part of the coordinator's heartbeat / sync cycle
(per owner ruling 2026-09-01, twelfth message: "heartbeat re-arms include a
sync step"), not continuously. A file here can lag its scratchpad source —
check the header timestamp, and treat the live scratchpad as ground truth
whenever both are reachable.

## Why no PR

This branch was deliberately not opened as a PR. It carries no code change
for anyone to review or merge; it is a mirror, refreshed by overwriting its
own history going forward, not by pull request.
