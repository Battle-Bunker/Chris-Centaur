# realizedResolution — the replay-re-base constructor, sketched to the tricky cases

Companion to `time-worldline.md` §2.1 and increment 3
(feature/replay-rebase). Pseudo-code plus the exhaustive list of cases where
"replay the realized turn" could diverge from what the server did, each with
its resolution or its named residual. The point of writing these down before
building: the checksum makes every residual SAFE (mismatch → marshal
fallback + counter), so the list below is about keeping the divergence
counter at zero, not about correctness.

## The constructor

    realizedResolution(prevRoot: EngineSubstrate, doc: Turn):
        orders = ordersFrom(prevRoot, doc)          // per-slot codes
        res    = prevRoot.engine.resolve(prevRoot.state, orders, { strict })
        if !checksum(res, doc): return { divergent: true, res: null }
        return { divergent: false, res }            // door-consumable

    checksum(res, doc):
        for every unit in doc.playerPieces:  occupancy equal (decoded), health equal
        for every id in doc.deaths:          death present in res.deaths, same cause+cell
        res has no extra deaths; severedCells equal per unit

## ordersFrom — per previous-root unit, in slot order

| realized behavior (from the doc) | order code |
|---|---|
| moved: `doc.moves[id]` present and ≠ head cell | the end square, wire→engine cell index (the marshal's existing cell mapping, reused) |
| stayed, orientation unchanged | `NO_ORDER` (kind default: piece holds, snake continues straight — see snake case below) |
| rotated: no move, `doc.orientation[id]` ≠ previous | rotate code `ACTION_ROTATE − orientationIndex` |
| died mid-path: absent from `moves`, present in `deaths` | the death cell as destination (path prefix up to the death cell — see case 3) |

## The tricky cases, exhaustively

1. **Truncated sliders.** The doc records the STOP square, not the staged
   intent. Feeding the stop square regenerates the same path prefix (a
   slider's path to any cell of its ray is the ray walked to that cell), so
   every cell is entered at the same sub-step and every adjudication
   replays. Intent beyond the stop is inert: adjudication reads entered
   cells and attempted edge crossings only, and a blocked unit never
   attempts the edge beyond its stop. Residual: none.
2. **Snakes that "stayed"** did not stay — a snake with no legal staged move
   runs the kind default (continue straight). `NO_ORDER` reproduces exactly
   that default; the doc's `moves[id]` will show the head cell it actually
   entered, so prefer the moved row (end square) and reserve `NO_ORDER` for
   pieces. Residual: none.
3. **Dead units.** A unit that died entering cell c: order = c; the replay
   walks the same prefix and the contest at c re-adjudicates from frozen
   tier/weight — same outcome (the engine is deterministic on the same
   snapshot). A unit that died AT HOME (body-blocked on its first step,
   self-collision, regicide): `doc.deaths[id].cell` + cause disambiguate;
   regicide deaths need no order semantics at all (the team sweep is
   end-of-turn). Residual: a unit that died with `cause: wall` staged an
   off-board destination the doc does not record — replay with the death
   cell reproduces the death only if the wall adjudication keys on the
   attempted cell; if it keys on the staged destination, use the doc's
   death record directly and skip replay for that unit (a named
   `order-unrecoverable` sub-case, checksummed like everything else).
4. **Pawns.** Pawn legality depends on targets (food + occupancy at plan
   time). The replay plans against the SAME previous board, so the target
   set is identical; a diagonal capture's end square is its staged square.
   Residual: none.
5. **Rotations.** `moves` absent + orientation delta → rotate code. A unit
   that both failed its move AND fell back to default may also show an
   orientation change (movement rewrites facing); order precedence is:
   moved ⇒ end square; not moved but re-oriented per the rotation rule ⇒
   rotate code; else `NO_ORDER`. The orientation REWRITE for movers is
   server-side (outside resolveTurn) — the replay takes post-turn facing
   from the doc verbatim rather than recomputing it (game-state half).
6. **The game-state half is copied, never replayed** (resolveTurn's own
   exclusion list): food/hazard/potion spawns, potion pickups and
   tier/effect changes, pawn promotion, orientation rewrite, scores. These
   are doc facts; the door-bound state takes them as inputs. The replayed
   `Resolution`'s state is used for premise-matching and the checksum; the
   next root's item boards, tiers, and unit types come from the doc.
7. **Exhaustion recovery.** A unit that exhausted and recovered on food
   appears in the doc alive at its halt cell. Replay reproduces the halt;
   the food phase inside `resolve` must see the same food board (it does —
   the previous root's), so recovery replays. Checksummed by health anyway.
8. **Turn-limit / elimination turns.** The final turn's doc carries winners;
   replay is unnecessary (no next decision). Skip.

## What the divergence counter is expected to catch

Genuine rules drift between the vendored server engine and the partial
engine (the thing differential testing catches offline today), engine
version skew after a TacticToes deploy, and any case-analysis error in the
table above. Each is exactly what we want surfaced per-turn in production —
at the price of one bounded `resolve` call per turn (~ms; one fully-ordered
resolution, no enumeration).

## The stochastic-rule seduction (red-team lens §5, answered)

Their attack: the first random rule beyond spawn (a teleport potion, a
misfire chance) makes replay diverge every turn, and the marshal fallback
silently converts the free differential test into a permanently-firing
alarm everyone learns to ignore. The answer is a classification duty plus
a counter taxonomy, both cheap:

- **Every new rule is classified at vendor-sync time** into the replayed
  half or the copied half. Game-state randomness (like spawns) joins the
  copied half — zero impact. Movement/collision randomness genuinely
  removes its PHASE from the replayed half: the phase is copied, the
  checksum's declared coverage shrinks by exactly that phase, and the
  door's premise machinery treats the phase's outcome as it treats
  spawns — a doc fact no premise predicted.
- **The counters are typed**: `replay-divergence` (checksummed replayed
  content disagreed — a bug, page someone) vs `unreplayable-phase`
  (declared, expected, counted per phase — a coverage statement, not an
  alarm). Alarm fatigue is a symptom of one counter meaning two things;
  the split is the same refuse-don't-default discipline the miners
  already learned.
- **The full repair is one additive wire field**: if the server publishes
  the phase's random draws (outcome record or seed — the same class of
  polish as `stateDigest`), the phase rejoins the replayed half. So the
  design degrades by DECLARED COVERAGE per random rule, never by silent
  rot, and each rule's coverage is individually recoverable at the price
  of one published field.

## TacticToes asks (amended per rollup fold §4 — localization promoted)

Still additive, but no longer uniformly "polish": `Turn.subStepCount` AND
per-sub-step digests are PROMOTED to the replay-rebase increment's
engine-ask list — a per-turn checksum detects divergence but cannot
localize it, and GGPO's named desync causes (unordered-collection
iteration first) are this path's hazards verbatim; a divergence that
names its sub-step names its adjudication tier. Remaining true polish:
`Turn.exhaustions` (settled events verbatim) and a whole-turn
`stateDigest` (one string compare; a redactable integrity anchor for the
fog programme). None of it BLOCKS any increment — the marshal fallback
stands either way.
