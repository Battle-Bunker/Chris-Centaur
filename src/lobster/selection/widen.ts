/**
 * PROGRESSIVE WIDENING — the schedule half of the one exploration apparatus.
 *
 * Contract rule 26: *"There is exactly one exploration apparatus — the widening
 * schedule plus the temperature — and zeroing it collapses selection to pure
 * ceiling order."* No `c_puct`, no visit-count bonus, no virtual-loss constant:
 * within a slice, sampling WITHOUT REPLACEMENT is the de-duplication, and
 * across slices the weights are rebuilt from current bounds. Two knobs, and
 * this file is one of them.
 *
 *     k(N) = ⌈k0 + C · N^α⌉,   clamped to [1, ceiling]
 *
 * `N` is resolutions spent — work, never wall time and never a visit count
 * (`mtl/ev-mcts-bandit.md` §13: *"cost is denominated in resolutions, never
 * visits"*). `α = 0.5` puts `√N` where PUCT's `√N_parent` actually belongs: as
 * the RATE AT WHICH NEW ARMS ARE ADMITTED, not as a bonus on arms already
 * evaluated. A cluster that has PROVED its arms are close together earns the
 * right to look at more of them; one whose leader is dominating does not.
 *
 * ── WHY THE SHIPPED DEFAULT IS INERT, AND WHY THAT IS NOT A COP-OUT ────────
 *
 * `k0 = ceiling` ships, which makes `k(N) ≡ ceiling` for every N: the sampled
 * draw is the SAME SIZE as the deterministic prefix it replaces. That is a
 * measurement decision, not a timidity one. The stage's own empirical gate is
 * the **equal-strength gate** — *"pooled placement of the sampled arm within
 * the concurrent null of the deterministic twin AT EQUAL WALL CLOCK; the ruling
 * buys unpredictability, not strength"*. A schedule that started at `k0 = 4`
 * would make the sampled arm do a THIRD LESS WORK per sweep than its twin, and
 * every number in the comparison would then be measuring the budget change
 * rather than the lottery. One knob, one mechanism: the membership is what
 * moves, and it moves at constant width.
 *
 * The schedule is live behind `SamplingTuning.widen`, is tested here, and is
 * the natural home of the CL6 expansion's arity growth. Nothing else in the
 * tree has to change to raise it.
 */

export interface WidenSchedule {
  /** Arms admitted at zero spend. */
  readonly k0: number;
  /** Growth coefficient. */
  readonly c: number;
  /** Growth exponent. 0.5 ties admission to √N. */
  readonly alpha: number;
}

/** `(k0 = 8, C = 2, α = 0.5)` — inert at the shipped `candidateCap` of 8. */
export const DEFAULT_WIDEN: WidenSchedule = { k0: 8, c: 2, alpha: 0.5 };

/**
 * How many arms this node may consider, given the resolutions already spent on
 * it and the ceiling the caller will not go above.
 *
 * The ceiling is the SEARCH TUNING'S OWN CAP (`candidateCap`,
 * `pairRepairPerUnit`, `polishPerUnit`, …). Widening may narrow below it and
 * may grow back up to it; it may never exceed it, because that would make the
 * sampled arm cost more than the twin it is measured against and would silently
 * spend budget the anytime kernel promised somewhere else.
 */
export function widenTo(schedule: WidenSchedule, spent: number, ceiling: number): number {
  if (ceiling <= 1) return Math.max(0, ceiling);
  const n = spent > 0 ? spent : 0;
  const k = Math.ceil(schedule.k0 + schedule.c * Math.pow(n, schedule.alpha));
  if (!Number.isFinite(k)) return ceiling;
  return Math.max(1, Math.min(ceiling, k));
}

/** True when the schedule cannot move: `k(N) ≥ ceiling` for every N ≥ 0. */
export function widenInert(schedule: WidenSchedule, ceiling: number): boolean {
  return Math.ceil(schedule.k0) >= ceiling;
}
