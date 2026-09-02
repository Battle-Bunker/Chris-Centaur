# 05 — Worked scenario: one contested midgame, every port firing

OPERATOR-GUIDANCE lens, sixth document. A single trace to keep the carve
honest — the sibling convention (belief's 03, time's worked timeline). Board:
piece-heavy 3-team cell (the starved stratum), our roster a queen (Q), a
rook (R), two snakes (s1, s2), king (K). Enemy red has a queen near our
king's file; enemy blue is farming the north-east. Potions on, turn 41.

Operators: Ada (captain), Ben. Live guidance table at turn 41:

| id | author | utterance (UI gesture) | compiled coordinates |
|---|---|---|---|
| u1 | Ada | shift-click NE potion cluster with s2 ("stay near") | ⟨value-field(proximity-ramp, potential form) + attention | s2 | cell | standing | A1⟩ |
| u2 | Ben | "the red queen is in play" (threat-mark gesture on her) | ⟨support-demand + attention | team | unit(redQ) | standing/maintenance | A2 + A0⟩ |
| u3 | Ben | "if she crosses the file, K retreats to the corner pocket" | ⟨value-field(goto-ramp) | K | cell | activate: crossed(file), until(arrived, latched) | A1⟩ |
| u4 | Ada | "reds will rush the potion" (line-tilt gesture) | ⟨belief-weight | team | unit(redQ)+cells | turns(5) | A1⟩ |
| u5 | Ada | risk dial on s1 down to "ice" | ⟨appetite | s1 | none | standing | A1⟩ |
| u6 | Ada | "hold the wire until I look at R" | ⟨deadline(hold) | team | none | turn | A1-on-obligation⟩ |

**Decision 41 compiles `GuidanceContext`**, `guidanceId = g41a`. What each
port does, in pipeline order:

1. **Generation/ordering.** R has 68 legal options; the slider cap admits a
   4-prefix. u1 touches s2 only; nothing operator-shaped touches R —
   ordering unchanged there. s2's candidate order gains the u1 stat slot;
   its NE-ward moves enter the prefix above the positional tail.
2. **Support.** u2 forces redQ into the contestant set even though she has
   no contact this turn — the restricted matrix gains her column block. The
   team floor drops 3.1 weight-units (honest: her file threat now priced).
   The emit record's basis notes the demand with u2's id.
3. **Attention.** u2's bounty seeds a scout thread on redQ's file lines;
   u1's bounty biases which cluster the first deepen serves. Lever ORDER
   unchanged (catch-up → … → deepen).
4. **Belief-weight.** u4 tilts the advised reading of red replies toward
   the potion rush at the fitted ε. `estAdvised` re-ranks two near-tied
   plans for s1/s2 coverage; `estSound` and every floor ignore it. The
   ordering flip's emit record cites u4.
5. **Appetite.** s1's reads use the "ice" curvature: among plans the floors
   tie, s1's coverage move beats its tempo move. No bound moved.
6. **u3 is dormant** — `activate: crossed(file)` is false on the observed
   board. It costs nothing (compiled to an inactive row; no field built).
7. **Obligation.** u6 adds a hold row: the submitter's early-commit is
   withheld; kernel deadline rows still bind by MIN; clock expiry still
   wins. Ada selects R (A0 selection bounty via the shipped
   compute-follows-attention path), inspects, releases the hold.
8. **Emission.** Plans stage through the unchanged gates. The staged set's
   every score carries `g41a`; `CommandTurnState` snapshots the six rows.

**Turn 42, the interesting half.** Red queen crosses the file.

- u3 **activates** at ingestion (predicate on the authoritative board): K
  gains the corner goto field; ADVANCE carried u2's thread attention, so
  the file lines are warm; the retreat is found priced, not panicked.
- u2 is `maintenance`: still violated, still live.
- Ben, seeing the warrant surface ("s2's death seals the NE corridor for
  +21 net" — an ADVICE artifact, id w7), disagrees with the bot's refusal
  to consider it, and **pins** s2's blocking move: an A4 determination,
  `provokedBy: w7` on the pin's log row. `matchPin` resolves it from the
  pruned ledger; `conform()` repairs the joint plan around it; the kernel
  pays for it. The bot never proposed it as a staged move and never
  unpins it. Uptake telemetry gets its first real row (w7 → acted-on).
- Ada's u1 for s2 now conflicts with Ben's pin. No arbitration needed:
  A4 outranks A1 by the ladder; the frustration surface shows u1
  "outvoted by pin (Ben)" — attribution, not silence.

**Turn 43.** s2 is dead as priced; the corridor holds. u1's scope names a
dead unit → invalidated by its own member (`target-died`), row retired
visibly. K arrives at the pocket → u3 retires (latched). The guidance table
is three rows lighter without anyone cleaning up, because lifecycles are
data. `guidanceId` changed each turn; the replay shows what was asked, when
it activated, and which asks won.

**What this trace certifies** (each a falsifier from the earlier docs):
empty-vs-active compile paths (u3 dormant), widen-only floor movement (u2),
advised-only belief-weight (u4), MIN-only obligations (u6), A4-over-A1 with
attribution (Ben's pin vs u1), lifecycle self-cleaning (u1/u3), and the
OUT→IN handshake (w7 → pin).
