# Validation path — proving fog readiness before the game grows fog

Addendum to `04-SYNTHESIS.md` steps 5–7. Two practical designs the build
sequence needs and the other docs only imply, plus the measurement plan.

---

## 1. The masker is one pure function, built once, used twice

`applyMask(fullTurn, visibilityRule, teamId) → ObservationRecord` is a pure
function of public data. Build it in the BOT repo's harness first:

- the sim kit already replays full `Turn` records; a fog cell is a paired
  game where one seat's ingestion is fed `applyMask(turn, rule, seat)`
  instead of the turn — no game-engine change, no arena, runnable TODAY on
  the committed replay corpus and in live paired games;
- when TacticToes grows the feature, the SAME function moves into the
  processor to write the per-team views (vendored back, like the engine).
  One implementation, so the harness's fog and production's fog cannot
  drift — the discipline the one-translation rule already enforces for
  boards, applied to observations.

Consequence for sequencing: bot-side fog (04-doc steps 6–7) validates
end-to-end BEFORE the TacticToes work (step 5) lands, and step 5's
acceptance ("view docs match masked full record") is a byte-comparison
against the harness's own masker.

## 2. The observer's ledger — the one genuinely stateful addition

Today's bot is memoryless across turns at the ingestion layer: every turn's
board arrives whole, `observedTurns` defaults to "seen now", and staleness is
zero. Under fog the substrate path is READY (substrate.ts:781 already computes
per-unit staleness from `observedTurns` and stamps `heldAtTurn` accordingly)
— but a hidden unit is ABSENT from the incoming facts, so someone must
remember its last-seen snapshot to hold it FROM.

That someone is the observer's ledger: `unitId → { snapshot, lastSeenTurn,
trace }` — last-seen state, observation age, and the ConditioningTrace
accumulated while hidden. Properties that keep it honest:

- **A cache, not a truth.** Views are stored documents; the ledger is
  reconstructible by replaying `applyMask` output from the game's start, so a
  process restart loses nothing and no recovery protocol is owed beyond
  "re-read the views".
- **It lives at ingestion, above the one-translation seam.** The substrate
  keeps receiving a full roster (visible units from facts, hidden units from
  ledger snapshots) plus `observedTurns` — the existing contract, unchanged.
  Nothing below ingestion learns fog exists except through staleness, which
  is the whole point.
- **It is the rebase programme's natural home.** The cross-turn belief
  carry (`condition(dilate(S), obs)`) and the search-priority carry the
  owner's interruption/rebase directive asks for are the same lifecycle;
  one cross-turn object owning "what survives a turn boundary" serves both.

## 3. Fog cells in the kit

- **Paired twins carry over**: same seeds, one arm's seat masked, the other
  full — the fog TAX is the sharePar delta, now measured against the real
  planned schema instead of the retired arena injection.
- **Rule ladder as cells**: effectTurns of invisibility, redaction variants
  (item boards truthful vs not — pricing 03-doc §7's game-design dilemma
  with numbers before the owner must choose), one-hidden-unit vs
  team-hidden.
- **Both-sides-one-game** (batch-3 roster trick): both teams under fog in
  one game halves the games needed for symmetric rules.

## 4. Gates and instruments

1. **Degenerate-mask identity (the step-6 gate):** with an empty visibility
   rule, `applyMask` is the identity and the fog-capable bot must be
   BYTE-IDENTICAL to the current bot over the replay identity suite. Fog
   capability may cost nothing while unused — same bar the teardown work
   held.
2. **Reappearance oracle = 0 violations** over every fog game the harness
   runs — thrown IN HARNESS AND TESTS ONLY; in production it QUARANTINES
   (rebuild from the reveal, log, count) rather than forfeiting a turn
   (09-doc §6, the rounding-forfeit lesson). Its coverage is highest exactly
   where conditioning was aggressive, so the harness adds seeded
   narrow-cloud scenarios; the soundness burden stays on the per-rung
   arguments, with the oracle as the always-on audit.
3. **Hedged-preparation telemetry** (the removal/hedging split, 04-doc §3):
   when the scheduler pre-spends against a game-held width — conditional
   frontiers per possible reveal — record the spend and, on reveal, whether
   the prepared frontier was the one entered (hedge hit rate) and the
   latency saved. This is the fog-side instrument of the time lens's ponder
   economics; without it a sweep cannot tell "hedged well" from "hedged at
   all".
4. **Support-width telemetry:** per hidden unit per turn: `possibleCount`,
   saturation flag, C1 collapse events, trace depth. The fog analogue of
   depthEffectRate — "conditioning-effect rate": fraction of decisions where
   a C0/C1 narrowing changed the staged move (paired against a
   dilation-only arm, the same paired-whole-decision method the depth
   landing used).
5. **Mechanism report rows:** the belief provenance column (02-doc step 2)
   plus mask size and ledger age — so a sweep can tell "played blind and
   wide" from "played blind and narrow" without reading source.
6. **Weight-entropy column** (09-doc §5): entropy of the supplied weight vs
   mask size per decision — cover weights legitimately flatten as fog
   widens, and without this column an entropy drift reads as ε drift.
7. **The three pre-registered bands** (09-doc §9): posture residency,
   lever-spend shift (catchup on game-held units predicted ZERO), and
   frozen-slot occupancy (TooManyHeldError predicted ZERO) — published in
   the fog-cell spec before the first run.

## 5. What this doc deliberately does not add

No fog-specific strategy content (when to buy invisibility, how to hunt a
hidden unit) — those are D1/D6 terms and weight-supplier members to be
raced as collection entries once the substrate above exists. The epistemics
line ends where opinions begin: everything here is support, evidence, and
measurement.
