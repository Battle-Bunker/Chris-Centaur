---
name: move_evaluations JSONB format
description: The decision_logs.move_evaluations blob shape after the heuristic-breakdown deletion.
---

# `decision_logs.move_evaluations` shape

Stored as `{evaluations: [...]}`. Each element is a CANDIDATE ENUMERATION row —
`{move, score, dest?, projectedTerritoryCells?}` — the moves a unit could make
this turn and where they land. It is what the viewer draws candidate cells and
arrow-key steering from.

**It is NOT a score decomposition.** The per-candidate `breakdown` blob (one
column per heuristic: stat x weight = weighted, plus average/marginal impact and
a set of legacy wire aliases) was DELETED on 2026-09-01 under the owner's
radical-refactor licence — see `docs/REFACTORING.md`. Nothing writes it, nothing
reads it, and no reader should reintroduce a fallback for it. Historic rows
still hold the old fat blob; readers simply ignore the extra keys.

**Legacy gotchas (historic rows only):**
- Games logged before 2025-12-17 stored a bare array (just the evaluations, no
  wrapper object). Readers must handle both the array and the object form.
- Games logged before the turn_states split embedded `territoryCells` and
  `cellOwnership` in this blob; modern games carry those once per turn on
  `turn_states`. Read whichever the row's era provides.
