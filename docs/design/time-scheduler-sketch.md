# Scheduler engineering sketch — grants, cutoff, market, conversion

The builder-facing companion: the four policies of the compute-sequencing
joint as pseudo-code, each row carrying its precedent. Supersedes nothing;
makes increments 1, 2 and 4 concrete.

---

## 1. The cutoff check in kernel terms (increment 1)

Today (`kernel.ts applyPinEvents`, case "commit"): any commit with a known
destination sets `epochChanged = true` unconditionally → new basis, plans
cleared, session killed. With cutoff:

    case commit(unit u, to t):
      committedUnits.add(u)                          // unconditional (V4 R7a)
      staged = wirePlan.get(u)?.to
      pinAgrees = pins.find(u)?.to === t || pins.find(u) === undefined
      if (staged === t && pinAgrees):
        // CUTOFF: the determination contradicts nothing on the wire or in
        // the pin set. Remove u from the variable set; re-key values that
        // cited u's action-freedom as now-fixed (they recompute to equal
        // bounds — the enemy reply set and every other unit's candidates
        // are untouched); NO epoch, NO basis drop, NO session death.
        variables.remove(u)
        conformance.push({kind: 'commit-agree', latencyMs: ~0, slicesBefore: 0})
      else:
        // the commit moves u somewhere else: today's path, scoped by
        // citations (only u's cluster re-derives)
        epochChanged = true

Watch-item for the builder: the ratchet basis may keep its floor across a
commit-agree ONLY because nothing the floor was proved over changed — state
that in the code comment with the Salsa-backdating citation, because it is
the one place this design deliberately does NOT drop a basis on an event.
Acceptance addition to increment 1's game: the operator commits the staged
move at slice 8 — time-to-conform ≈ 0, zero plans cleared, session alive
(vs today: full teardown). Measured beside the contradicting-commit case.

## 2. Grant policy (increment 2 + 4)

Phase rows, in the order the agent/worldline consults them:

    refine grant (agent attached):
      target  = CPP.targetTotalQuanta(turnBudget, boardClass)   // fitted member
      carried = ledger.carriedQuanta(turn)                      // ponder inherited
      grant   = clamp(target - carried, minTranche, latencyCapQuanta())
      // Lc0 PR1195 precedent: budget the TREE TOTAL INCLUDING REUSED NODES
      // and fund the difference — their list of difficulties (moves left
      // unknown, noisy NPS, unknown reuse fraction, early stops) is ours
      // verbatim, and their answer is this shape.

    instability extension:
      if leaderFlippedWithin(k tranches) and deadlineAllows:
        one extra refine grant (bounded; Stockfish/cpw "best move changed"
        + Hansen-Zilberstein monitoring-cost frame)

    SETTLED-EARLY CONVERSION (new row; Lc0 smart pruning precedent —
    "search stops when it is impossible for the best move to be overtaken";
    cpw premature termination: "only one legal move"):
      if staged move is settled (sound dominance over all live rivals, or
      every commandable unit committed):
        stop refine grants; remaining turn budget flows to ponder grants
        targeting turn N+1 — the analog of a ponder-hit "move immediately",
        except our wire already holds the move and the surplus funds the
        window instead of the clock.

    ponder grants (no agent attached / settled):
      geometric ladder (IJCAI-99 stochastic-deadline contracts):
        g_i = g_0 * r^i   (defaults g_0 = one thread-open + 2 plies,
                           r = 2; both inherited-unfitted members)
      each g_i spent via the hypothesis market; harvest whole at
      observe(resolution) — torn plies discarded (already atomic).

## 3. The hypothesis market (increment 4)

    nextHypothesis(phase):
      if phase == refine:
        reserve floor first: >= (1 - tithe) of refine quanta to the actual
        frontier (rebase-transfer §4.2 anti-feint reserve, unchanged)
        tithe split: threads on actual frontier (deepen-shallowest rule,
        unchanged) ; speculative pin fibers at their market weight while
        tentative pins exist
      if phase == ponder:
        weights: W0 witness replies (1.0 each, inherited-unfitted),
                 concern rows by floor damage (their carried rank),
                 W2 dodge-cover tail (0.25, inherited-unfitted)
        ruling-13 pin: this site's weights may never read a learned
        supplier until the owner opens the D2 socket (the per-site
        constraint column from the joints red-team, BREAK 4)
      draw by seeded weighted sample over eligible rows (the existing
      Gumbel machinery; the draw is ledger-replayable by construction)

    THE BID TYPE (search-theory C-T2, answered): a bid is a SHORT
    PROFILE, never a scalar. Zilberstein/Russell's composition result
    says optimal allocation across components REQUIRES per-component
    performance profiles — a scalar bid cannot express "improves fast
    for 40ms then flattens", which is almost certainly the enumeration's
    shape (the v0 CPP confirms it: joints/plies saturate by 500ms while
    plan pricing keeps climbing). Minimum viable bid:

        bid = { marginalAtSmall,      // quality/quantum at one min-tranche
                marginalAtLarge,      // ... at the saturating grant
                saturationQuanta }    // where the component flattens

    read off the component's CPP slice (their doc 07 supplies the
    y-axis; this market is the mechanism; neither works alone). The
    scheduler then solves a small knapsack over bids per grant instead
    of an argmax over scalars — same seeded draw for ties, still
    ledger-replayable.

    THE FLIP FACTOR'S CHEAP ESTIMATORS (librarian d36-37, cannot-wait
    relay — the survey's cheapest open item, now specified): two shipped
    implementations of P(refinement flips the choice) run on byproducts
    the loop already produces and discards —

        · tranches since the incumbent last changed
        · incumbent changes this tranche
        · the incumbent's value trend (a 4-slot ring of recent readings)
        · share of work landing under the incumbent's subtree

    No model, no intervals, usable BEFORE the bank completes (the
    interval-overlap form of the flip factor needs priced bounds; these
    need only the loop's own history). The kernel already half-counts
    them: StickyStager flips, depthChangedLeader, emissions-per-slice —
    increment 2 promotes them to per-hypothesis ledger fields. Three of
    the four double as C48's margin discriminator, giving the interim
    proxy real teeth before the runner-up field lands:
    stopped-changing-its-mind + value trend flat = exhausted (reading a);
    flipping-at-the-same-score = the evaluator cannot separate the plans
    (reading b — coarse evaluator).

    THE PER-HYPOTHESIS CAVEAT (ours, and it is load-bearing): count
    per hypothesis, NEVER globally — a plan reads "stable" exactly when
    the market stopped funding its revision, so a global counter turns
    defunding into fake convergence and the market talks itself into
    starving whatever it already starves. Each hypothesis's stability
    counters are denominated in ITS OWN granted quanta (the ledger's
    hypothesisId stamp makes this free).

## 4. Falsifier deltas introduced by this sketch

- commit-agree cutoff: measured time-to-conform ≈ 0 AND zero killed
  entries on the acceptance game, or the cutoff claim is wrong.
- settled-early conversion: on boards where dominance settles early, the
  arm with conversion must show carried-quanta at N+1 > 0 with unchanged
  turn-N staging quality; if staging quality moves, the settled test is
  leaking (dominance was not actually proved) — refuse and count.
- funded-difference refine grants: at equal targetTotal, arms with and
  without a window policy must converge in strength as the window policy's
  yield is subtracted — if they do not, carriedQuanta is mispriced and the
  Lc0-shaped accounting is wrong for this game.
