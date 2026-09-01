<!-- SNAPSHOT: source scratchpad/batch2-runner.md — synced 2026-09-01T01:13:23Z by the branch-topology housekeeping task.
     This is a point-in-time copy, not the live document. The working copy is the coordinator's
     scratchpad; this branch exists so the owner can reach it if that box is unreachable. -->

# LOBSTER — Batch 2 Runner (self-contained)

You are a local Claude Code agent on the owner's machine with no other
context. Your job: run simulation batch 2 and publish the results. You
are a measurement instrument: never modify bot source, report honestly,
every number ships with its control.

## 1. Repos and branches (fetch these exactly)

| repo | URL | branches you need |
|---|---|---|
| Chris-Centaur (the bot + sim kit) | https://github.com/Battle-Bunker/Chris-Centaur.git | `sim/worker-kit` (kit + specs — your working branch), `claude/mid-turn-collision-logic-mkxurg` (validated baseline bot), `claude/cluster-lookahead` (search-architecture feature branch bot) |
| TacticToes (the game; reference only) | https://github.com/Battle-Bunker/TacticToes.git | default branch |

Work in a folder inside the Linux home directory (`~/...`), never under
`/mnt/c`. You must be able to push new branches named `sim-results/*`
to Chris-Centaur (gh auth login, PAT helper, or SSH remote).

```bash
git clone https://github.com/Battle-Bunker/Chris-Centaur.git
cd Chris-Centaur
git fetch origin sim/worker-kit claude/mid-turn-collision-logic-mkxurg claude/cluster-lookahead
git checkout sim/worker-kit
```

Node 20 LTS (nvm), then `npm ci`.

## 2. The authoritative instructions live in the repo

Read, in order, on `sim/worker-kit`:
1. `tools/simworker/HANDOFF.md` — the full operating manual (setup,
   bundle building per git ref, methodology laws, results protocol).
   It supersedes anything here if they disagree.
2. `tools/simworker/COORDINATION-20260829.md` — addenda with late
   corrections (read every addendum; the newest ones cover: potions
   default ON in specs, contenders selected by bot-config JSON not env
   flags, and batch 2's search question being branch-vs-branch).
3. `tools/learnloop/specs/batch2/` — the specs to run (11 specs,
   ~2,472 games). Each spec prints an `ARM CONFIGS` block with the
   exact `--arm` lines. Run them in the order `P-LIST.json` gives.
   One spec (P11) compares a bot BUILT FROM the baseline branch against
   a bot BUILT FROM the feature branch — the kit's build script takes a
   git ref per contender; follow the spec's arm lines exactly.

## 3. Non-negotiable methodology (summary; details in HANDOFF)

- Every batch carries its concurrent same-night A/A control cell (two
  byte-identical contenders), sized like a treatment cell. Effects are
  claimable only against that control's own band.
- Paired seeds + full 3-seat rotation; a block = one seed through all
  rotations. One contender-pair at a time; record `nproc`, memory, and
  loadavg in the manifest; nothing else heavy on the box.
- Report negative/null results with the same prominence as wins. Never
  patch bot source; if a build fails, document and continue.
- Start with the 10-minute smoke the HANDOFF describes (1 block, small
  board, short budget) to validate the pipeline end-to-end — including
  the push and the draft PR — before the first real cell.

## 4. Results protocol

1. Branch `sim-results/local-<YYYYMMDD>[-<n>]` off
   `claude/mid-turn-collision-logic-mkxurg`.
2. Commit under `results/<batch-id>/`: `manifest.json` (cells,
   contenders with build refs+SHAs and their bot-config JSON, seeds,
   host info, node version, times), replays as `*.jsonl.gz` (sample per
   HANDOFF if >~200MB), `findings.md` (control cell first, then verdict
   lines + tables — lead every table with the `sharePar` column), and
   any local tooling under `tools/simworker-local/`.
3. `git push -u origin <branch>`; open a draft PR titled
   `Sim results: <batch-id>` (base: `claude/mid-turn-collision-logic-mkxurg`).
4. Tell the owner the batch landed.

Never push to any branch outside `sim-results/*`. Never modify `src/`.
