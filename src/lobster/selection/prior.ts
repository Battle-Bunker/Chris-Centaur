/**
 * THE WEIGHTS — what the lottery is weighted BY.
 *
 * The owner's ruling settles the MECHANISM (weighted random, never
 * deterministic best-first). R-B1's measurement settles the INPUTS, and it
 * settles them by elimination:
 *
 *   · the overhang index is degenerate — at fixed anchors
 *     `hi*(a) = core.best(a) + a position-wide constant`, so it orders the
 *     frontier identically to the material ceiling in 100.00% of 2,983
 *     schedulable positions. The frame apparatus supplies LEVEL, NOT ORDER;
 *   · its challenger term ρ̂ is anti-correlated (ρ = −0.61) with the narrowing
 *     it is defined to predict, and is worse than random from the second
 *     escalation.
 *
 * So the honest inputs are the **material ceiling** (a level, per unit) plus
 * the **cheap priors already computed** (an order, per option) — no frame
 * endpoints, no anchors, no certificates, and therefore no round-fusion
 * Stage 3 prerequisite.
 *
 * ── WHERE THE "INTEGRATED PRIORS" ACTUALLY LIVE, AND WHY THIS FILE IS SHORT ─
 *
 * The brief asks for weights built from CL1's fatality prior, CL2's edge-EV and
 * a material-ceiling base. Two of those three are ALREADY INTEGRATED, into one
 * number, by the layer below: `CandidateSet.candidates` arrives *ordered
 * best-first* from the candidate layer, whose `orderKey` folds the tier
 * verdicts, the fatality prunes (CL1) and the edge-EV slot (CL2) into a single
 * comparison. CL1's own seed says so in as many words — *"the candidate list
 * arrives best-first from a layer that has already spent real evidence on the
 * order, so RANK IS THE PRIOR and the seed does not re-derive it"*
 * (`search/cluster-seed.ts`, `singletonPotential`).
 *
 * Re-deriving those terms here would (a) cost a second `assess()` per unit per
 * decision, which CL3 measured as the reason `EnumRequest.unary` ships
 * unsupplied, and (b) integrate them a second time, differently, which is how a
 * codebase grows two priors that disagree. So this file reads the rank and adds
 * exactly one thing the rank cannot carry: the CROSS-UNIT LEVEL, which is a
 * material quantity and is what R-B1 says the frame was only ever supplying.
 *
 * ── THE SHAPE, IN LAT ──────────────────────────────────────────────────────
 *
 *   candidate a of unit u, at rank r in u's own best-first list:
 *       w(a) = λ_rank · (−log(r + 1))
 *
 *   unit u, at rank d in the danger order, material weight m_u:
 *       w(u) = λ_rank · (−log(d + 1)) + W_MATERIAL · clip(m_u)
 *
 *   composed cluster joint p, at rank j in CL3's k-best list:
 *       w(p) = λ_rank · (−log(j + 1)) + W_SURROGATE · (Ṽ(p) − Ṽ(incumbent))
 *
 * `−log(rank+1)` and not a linear ladder, and the choice is the whole design.
 * At the schedule's opening temperature `λ_rank = T₀` exactly (see
 * `sample.ts`), which makes the softmax over ranks come out as
 *
 *       P(rank r) ∝ 1/(r + 1)
 *
 * — a Zipf lottery over the generator's own order. That is heavy-tailed enough
 * that an option at rank 12 of 30 still enters a top-8 draw a measurable
 * fraction of the time, which is the ONLY thing that can answer i2's falsifier:
 * a linear ladder, or a rank-squared one, buries the far options exactly where
 * the deterministic prefix already buried them.
 */

/**
 * NOTHING IS IMPORTED FROM THE LOBSTER TREE, not even a type. Every signature
 * here is structural — counts, numbers and booleans — which is what makes the
 * one-way-import law (contract rule 17's grep; `bounds/**` imports nothing from
 * `search/**`) a fact about this directory rather than a promise about it, and
 * lets `contracts.ts` name `SelectionReport` without a cycle.
 */

/** The material lattice step, as `search/edge-ev.ts` defines it. */
export const LAT = 10;

/**
 * WHAT ONE PLACE IN THE GENERATOR'S ORDER IS WORTH, in lat.
 *
 * Equal to the temperature schedule's `t0` on purpose: at full clock the
 * softmax over `λ·(−log(r+1))` collapses to `∝ 1/(r+1)` exactly. Changing this
 * without changing `t0` breaks that identity, which is the one statement about
 * this lottery a reader can check by hand.
 */
export const LAMBDA_RANK = 0.25;

/**
 * WHAT ONE UNIT OF MATERIAL WEIGHT IS WORTH IN THE UNIT LOTTERY, in lat.
 *
 * `0.25 · ln(1.5)`, so that at the opening temperature one extra unit of
 * material weight multiplies a unit's odds of being swept first by exactly
 * 1.5×. A heavier unit is worth more improvement attention and that is all this
 * term claims; it is deliberately small enough that it never outranks a whole
 * danger class, because a unit that the priced resolution says DIES is where
 * the value is, whatever it weighs.
 */
export const W_MATERIAL = 0.25 * Math.log(1.5);

/**
 * WHAT ONE LAT OF SURROGATE GAIN IS WORTH IN THE PROPOSAL LOTTERY.
 *
 * 1.0 — the surrogate is already denominated in lat, so this is the identity
 * and the constant exists to be zeroed by the ablation rather than to be tuned.
 */
export const W_SURROGATE = 1;

/**
 * WHICH REGIME A WEIGHT VECTOR WAS BUILT IN — stamped on every draw
 * (contract rule 26).
 *
 *   `normal`       every ceiling-derived term is finite.
 *   `win-clipped`  at least one arm carries an INFINITE ceiling. It enters the
 *                  weights at one lattice step above the best finite arm, so it
 *                  is top-of-scale and still SAMPLEABLE AROUND — the hole R-B1
 *                  §9 found, where a raw `+∞` makes any argmax scheduler select
 *                  that arm unconditionally and for ever. Dominance and the
 *                  witness veto keep using the TRUE infinite ceiling, so the
 *                  arm is never spuriously eliminated: it leaves the pool by
 *                  proof and by nothing else.
 *   `vacuous`      every ceiling-derived term is `−∞`. The pool routes to the
 *                  prior-only channel exactly as `voc.ts:509-516` already does
 *                  for the vacuous posture: `−∞ + anything = −∞` would starve
 *                  every arm identically and turn the lottery into its index
 *                  tie-break, so the material half is dropped and the ranks
 *                  decide.
 */
export type WeightRegime = "normal" | "win-clipped" | "vacuous";

export interface ClippedCeilings {
  readonly values: ReadonlyArray<number>;
  readonly regime: WeightRegime;
}

/**
 * CONTRACT RULE 26, implemented once, for every channel that carries a ceiling.
 *
 * ```
 * clip(c) = min(c, G_top)
 * G_top   = (max FINITE ceiling over the live pool) + LAT      # one lattice step
 * ```
 *
 * and its mirror at the bottom, which the rule's VACUOUS clause implies and
 * which this build actually exercises: a `−∞` arm (CL1's `sealed` mark — a unit
 * that dies whatever it does) is floored to one lattice step BELOW the worst
 * finite arm rather than left at `−∞`. Contract rule 18 is why: *a probability
 * ORDERS, only a proof shrinks*. A `−∞` weight is a probability-zero arm, and a
 * probability-zero arm has been removed from the closure set by a policy rather
 * than by a proof. Floored, it sorts last and stays in the permutation, which
 * is the only shape rule 18 permits.
 *
 * Every arm infinite in the same direction ⇒ every clip is equal and the prior
 * decides, which is the rule's own "(if every live ceiling is WIN: all clip
 * equal; the prior decides)".
 */
export function clipCeilings(ceilings: ReadonlyArray<number>): ClippedCeilings {
  let maxFinite = Number.NEGATIVE_INFINITY;
  let minFinite = Number.POSITIVE_INFINITY;
  let anyWin = false;
  let allBottom = ceilings.length > 0;
  for (const c of ceilings) {
    if (Number.isFinite(c)) {
      allBottom = false;
      if (c > maxFinite) maxFinite = c;
      if (c < minFinite) minFinite = c;
    } else if (c === Number.POSITIVE_INFINITY) {
      allBottom = false;
      anyWin = true;
    }
  }
  if (allBottom) {
    // Every arm vacuous: the material half carries no information at all, so it
    // is dropped rather than clipped. The caller's prior term is the whole
    // weight, which is the posture channel's own policy.
    return { values: ceilings.map(() => 0), regime: "vacuous" };
  }
  const anyFinite = Number.isFinite(maxFinite);
  const top = anyFinite ? maxFinite + LAT : LAT;
  const bottom = anyFinite ? minFinite - LAT : -LAT;
  const values = ceilings.map((c) => (c > top ? top : c < bottom ? bottom : c));
  return { values, regime: anyWin ? "win-clipped" : "normal" };
}

/** `−log(rank + 1)`. Integer ranks in, lat-free logits out. */
export function rankLogit(rank: number): number {
  return -Math.log(rank + 1);
}

/**
 * THE UNIT'S MATERIAL CEILING TERM, and the one place `−∞` legitimately enters.
 *
 * A unit CL1's rung-0 classifier has `sealed` — one that dies in every world it
 * was offered — contributes `−∞`: there is no world in which its material
 * survives, so its ceiling in the material channel is the lattice bottom. That
 * is not a policy judgement about where to spend attention, it is what the
 * classifier proved, and routing it through `clipCeilings` is what keeps it an
 * ORDERING statement (last in the permutation) rather than an exclusion.
 *
 * `forced` is the opposite fact and is handled by the caller, not here: a
 * forced unit's domain is a singleton, so there is nothing to sample.
 */
export function unitCeiling(weight: number, sealed: boolean): number {
  return sealed ? Number.NEGATIVE_INFINITY : weight;
}

/**
 * The weight vector for the SWEEP ORDER — which unit gets improvement
 * attention, in what order.
 *
 * `dangerRank` is the unit's place in the existing `dangerOrder`, which is the
 * integrated prior for units exactly as the candidate list is for options:
 * dead in the floor-justifying world first, then anything the resolver named at
 * all, then unit id. This function re-weights that order; it never re-derives
 * it, and it never drops a unit from it.
 */
export function unitWeights(
  ceilings: ReadonlyArray<number>,
  lambdaRank: number,
  wMaterial: number,
): { readonly weights: ReadonlyArray<number>; readonly regime: WeightRegime } {
  const clipped = clipCeilings(ceilings);
  const material = clipped.regime === "vacuous" ? 0 : wMaterial;
  const weights = ceilings.map(
    (_c, rank) => lambdaRank * rankLogit(rank) + material * (clipped.values[rank] as number),
  );
  return { weights, regime: clipped.regime };
}

/**
 * The weight vector for ONE UNIT'S OPTIONS.
 *
 * Rank only, and §"where the integrated priors actually live" is why: within a
 * unit the material ceiling is a constant (it is the same piece), so a
 * per-candidate material term would be a constant added to every arm — which
 * cannot reorder anything, and is exactly the ordering-inertness CL2 measured
 * on φ_health. The level belongs on the unit channel, where units differ; the
 * order belongs here, where the candidate layer already computed it.
 */
export function candidateWeights(count: number, lambdaRank: number): ReadonlyArray<number> {
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = lambdaRank * rankLogit(i);
  return out;
}

/**
 * The weight vector for CL3's composed cluster joints.
 *
 * The rank half is the k-best order the enumeration produced (its MAP first,
 * then its Hamming-floor diverse alternates). The level half is the SURROGATE
 * GAIN over the plan the search is holding — the same µs quantity
 * `offerClusterJoints` already gates on, so this costs one `score()` call per
 * proposal that the offer loop was going to make anyway.
 *
 * A gain of `null` (the enumeration did not run, or produced no scorer) leaves
 * the ranks as the whole weight, which is the honest reading of "we have no
 * level for these".
 */
export function proposalWeights(
  gains: ReadonlyArray<number | null>,
  lambdaRank: number,
  wSurrogate: number,
): { readonly weights: ReadonlyArray<number>; readonly regime: WeightRegime } {
  const known = gains.map((g) => (g === null ? Number.NEGATIVE_INFINITY : g));
  const clipped = clipCeilings(known);
  const level = clipped.regime === "vacuous" ? 0 : wSurrogate;
  const weights = gains.map(
    (_g, rank) => lambdaRank * rankLogit(rank) + level * (clipped.values[rank] as number),
  );
  return { weights, regime: clipped.regime };
}
