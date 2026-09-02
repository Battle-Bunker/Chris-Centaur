# Cross-lens round 2 — Law K, obligation-by-min, and the adaptation contradiction resolved

Integration of the composition lens's red-team response (09-REDTEAM-RESPONSE
on design/joints-composition — all six of my breaks accepted, three
sharpened back) and the red-team lens's audit (RED-TEAM.md on
design/red-team), the F10 finding of which names this branch's anti-latch
law as one side of a direct inconsistency. Three adoptions and one
amendment of my own law.

## 1. Obligation composes by MIN, and the kernel pin is the bottom element (adopted)

My BREAK-1 fix (ECONOMY gets two laws) came back sharper: obligations are
not a partition — when two obligations cover one determination the TIGHTER
deadline binds, so the composition is a meet on deadlines, and the
kernel-pinned rows (humans always win; the safety refusal; the emission
barrier) are deadline-zero — the law's bottom element, not exceptions to
it. Adopted into the reaction-table sections verbatim: a member row can
tighten a reaction, never loosen one past the floor. This also gives the
dial-latency answer its final shape: the owner's choice selects a member
row ABOVE a floor that no configuration can cross.

## 2. Law K corrects this branch's own wording (adopted, with a mea culpa)

Their calibration law: a measured value may affect behavior only if
(a) REPLAYABLE — a deterministic function of declared coordinates plus the
recorded ledger — or (b) SPEND-ONLY — may change how much work is bought,
never a bound, an order, or a refusal. My docs said the exchange-rate fit
was "licensed by replayability"; that was subtly wrong — the fit is
WALL-DERIVED (msObserved feeds it) and is not itself replayable. What is
replayable is its EFFECTS: the grants are recorded, so replay never needs
the fit. The fit's true license is K(b): spend-only. Amended wherever the
branch says otherwise (worldline anti-latch section, redteam-joints
BREAK 3): online wall-derived fits are K(b); ledger-derived folds are
K(a); offline fitted constants are members with provenance (ruling 49);
nothing else may exist.

## 3. The adaptation contradiction (their F10) — resolved inside Law K, no fourth category needed

The audit's finding: the anti-latch law ("the worldline holds knowledge
and appetite, never calibration") forbids what 05-ADVANCE's five-asks
table requires — a within-game learned opponent posterior (an owner ask,
D2's adaptation) is calibration that must cross turns to exist. Their
proposed fix: a fourth crossing category, "learned measure state".

The time-lens resolution is cleaner and needs no new category: **a learned
opponent posterior is a deterministic fold of DETERMINATIONS — the
realized `Turn.moves` are ledger rows — so it is Law K class (a),
ledger-replayable, the same epistemic status as attention rows.** It never
was wall-derived calibration; the anti-latch law's target (the arena
latch: a wall-derived threshold latching behavior with no attribution)
does not include it. The law's restatement:

> The worldline's cross-turn mutable state is exactly:
> (a) LEDGER-REPLAYABLE FOLDS of determinations — attention rows, learned
>     measure state — each turn-stamped, lifetime-bounded or tripwired,
>     and DECLARED in the measure coordinate of every value computed under
>     it (a fitted-in-game weight is a premise coordinate, per ruling 49);
> (b) SPEND-ONLY wall-derived fits (exchange rate, step cost) under
>     Law K(b);
> (c) the seed position.
> Nothing else. In particular no wall-derived value may ever reach an
> order, a bound, or a refusal.

The audit's substantive requirements (w-only, turn-stamped, tripwired,
declared in the measure coordinate) all survive — as consequences of
(a) plus the seam rule, rather than as a new category.

## 4. The revalidation obligation for bot-authored carries (their F4, adopted)

Zombie commitments: a Carried with author 'bot' rides incumbency across
turns while its justifying value died at ADVANCE; the rootTurn/plies
tripwires bound staleness, not validity. Adopted as a law on the worldline
host: *a bot-authored carried premise owes one priced revalidation meet
per turn — its market row is mandatory at a floor priority — and a failed
revalidation kills the Carried.* The pin-conformance precedent (re-stage
before refinement) is the shape; attention rows are exempt only because
their lifetime is already ≤ depthMax−1 turns and their influence is
advisory-ordering only — a commitment REACHES SPEND, so it revalidates.

## 5. Acknowledged, not contested

The audit's closing point — the carve trades duplication for
prerequisites, and "nothing is understandable locally any more" — is
true and was half-conceded in my red-team doc's complexity note. The
honest defense stays the audit's own: the four most expensive defects
were cross-file convention failures, and the metadata is checkable where
convention was not. The entry-floor cost is real, and the MIN-vs-FULL
decision point (time-red-team.md §1) exists precisely so the program can
stop at the shallower carve if the fog milestone slips.
