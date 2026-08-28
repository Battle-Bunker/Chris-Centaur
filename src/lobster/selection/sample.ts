/**
 * THE SAMPLER — Gumbel-top-k, the temperature schedule, and the draw ledger.
 *
 * ── WHAT IT RETURNS, AND WHY THAT IS THE WHOLE SOUNDNESS ARGUMENT ──────────
 *
 * Every function here returns a **PERMUTATION** of the list it was given.
 * Never a subset, never a filtered list, never `undefined` for an arm it did
 * not like. Contract rule 18, verbatim: *"A probability orders; only a proof
 * shrinks. Every probabilistic interface that touches a closure set returns a
 * permutation of it (typed; checked). Set-shrinking has exactly three doors:
 * `prunedLedger` (max side), a per-world domination certificate,
 * `withNarrowing`/`declareTruncatedFloor` (min side)."*
 *
 * That is not a formality, it is what makes the owner's ruling legal in this
 * codebase at all. The search already takes a PREFIX of a best-first list — a
 * max-side cap, which can only lower an achievable floor and therefore needs no
 * declaration (`search/order.ts::topCandidates`). This layer changes *which
 * list* the prefix is taken of, and nothing else. Sampling chooses where prices
 * are spent; it never chooses which priced plan wins. `better()` still
 * adjudicates on the proved floor, and this directory is grep-banned from the
 * comparator modules (contract rule 17).
 *
 * ── GUMBEL-TOP-K, IN ONE LINE ──────────────────────────────────────────────
 *
 *     take the top-k of  (w_a / T + Gumbel_a)
 *
 * is an exact draw of a k-subset WITHOUT REPLACEMENT with probability
 * proportional to `softmax(w/T)` — so "sample the cap" is one sort, not k
 * sequential normalised draws. Sorting the WHOLE list rather than selecting k
 * costs an `n log n` on a list of ≤ 40 and buys the permutation rule 18 wants.
 *
 * ── THE TEMPERATURE, AND OWNER Q1 ──────────────────────────────────────────
 *
 * Q1 asked how cold the lottery may run when time is short. The default it
 * shipped with — *"always on, but cooling sharply as the clock runs down"* — is
 * implemented as
 *
 *     T(f) = max(T_min, T₀ · f^γ),   f = fraction of the decision's budget left
 *
 * with `T₀ = 0.25` lat, `γ = 2` (that is the "sharply"), and `T_min = 0.02` lat
 * (that is the "always on": the floor is above zero, so the lottery never
 * closes). 0.25 lat is well under the 1-lat lattice step, so even at full clock
 * the draw explores INSIDE the ordering channel and essentially never prices a
 * material blunder ahead of a clearly better plan.
 *
 * With `λ_rank = T₀` (see `prior.ts`) the schedule has a closed form a reader
 * can check by hand — the probability of drawing the option at rank r is
 *
 *     P(r) ∝ (r + 1)^(−T₀/T)
 *
 * so at full clock it is Zipf (exponent 1) and at the floor it is
 * `(r+1)^−12.5`, which is the deterministic prefix to twelve decimal places.
 * Hot early to spread prices across basins, cold late to refine the leader.
 *
 * READING THE CLOCK IS LEGAL HERE AND NOWHERE ELSE IN THE DIRECTORY. A
 * temperature is SCHEDULER state (firewall rule 9 / L5's scheduler exemption);
 * it is never board-belief state, it never reaches a bound, and it cannot reach
 * `better()`. The clock is not read *by* this module either: the caller hands
 * down a fraction it computed from `BudgetHandle`, which is why
 * `no-restricted-globals` can ban `Date.now`/`performance.now`/`Math.random`
 * under `selection/**` without exception.
 */

import type { WeightRegime } from "./prior";
import { gumbel } from "./rng";
import { DEFAULT_WIDEN, type WidenSchedule } from "./widen";

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

export const SAMPLED_CAP_ENV = "CENTAUR_SAMPLED_CAP";

/**
 * PER-ENGINE, NEVER PROCESS-WIDE — this branch's standing rule, learned the
 * hard way: a process-wide flag moves every lobster seat on the board at once
 * and a paired experiment on it measures nothing. The environment is only the
 * default a caller that names nothing inherits; `SearchTuning.sampledCap`
 * overrides it, so one seat can carry the lottery while the seat across the
 * board does not.
 *
 * DEFAULT OFF. With it off nothing in this directory is constructed, no draw is
 * taken, no clock is read, and the search is byte-for-byte the one that
 * shipped.
 */
export function sampledCapFrom(env: NodeJS.ProcessEnv): boolean {
  const raw = env[SAMPLED_CAP_ENV];
  return raw === "1" || raw === "on" || raw === "true";
}

export function sampledCapEnabled(): boolean {
  return sampledCapFrom(process.env);
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface SamplingTuning {
  /** Opening temperature, in lat. */
  readonly t0: number;
  /** How sharply the temperature falls with the remaining budget. */
  readonly gamma: number;
  /** The floor. Above zero, because owner Q1's default is "always on". */
  readonly tMin: number;
  /** Lat per place in a prior order. Equal to `t0` gives the Zipf identity. */
  readonly lambdaRank: number;
  /** Lat per unit of material weight, in the unit lottery. */
  readonly wMaterial: number;
  /** Lat per lat of surrogate gain, in the proposal lottery. */
  readonly wSurrogate: number;
  /** The progressive-widening schedule. Inert at the shipped `candidateCap`. */
  readonly widen: WidenSchedule;
  /**
   * WHICH CHANNELS DRAW — three flags, because three mechanisms, and this
   * branch's standing rule is that a feature folded into a neighbour's flag can
   * only ever be measured as a sum.
   *
   *   `candidates`  the per-unit cap becomes a membership draw. THE ONE THE
   *                 RULING IS ABOUT: the exploitable blind spot is the options
   *                 we never price, and this is the only channel that changes
   *                 WHICH options those are.
   *   `units`       the sweep's visit order. Measured to COST under scarcity
   *                 and to buy nothing — see the probe, and `DEFAULT_SAMPLING`.
   *   `proposals`   CL3's composed joints, when more exist than budget.
   */
  readonly channels: {
    readonly candidates: boolean;
    readonly units: boolean;
    readonly proposals: boolean;
  };
  /**
   * The private per-match seed. NEVER ON THE WIRE — see `rng.ts`. Zero (the
   * default) makes the stream a pure function of the board: replayable, and
   * predictable in principle, which is the one operational step a deployment
   * owes this ruling.
   */
  readonly matchSeed: number;
}

export const DEFAULT_SAMPLING: SamplingTuning = {
  t0: 0.25,
  gamma: 2,
  tMin: 0.02,
  lambdaRank: 0.25,
  wMaterial: 0.25 * Math.log(1.5),
  wSurrogate: 1,
  widen: DEFAULT_WIDEN,
  channels: { candidates: true, units: false, proposals: true },
  matchSeed: 0,
};

/**
 * THE ONE-OPTIMISM TRIPWIRE (contract rule 26's S=0 ablation).
 *
 * Zero the temperature and the prior and selection must collapse to pure
 * ceiling order — no second exploration constant may be hiding anywhere. A
 * `t0` of 0 takes the exact branch in `permute`: no draws at all, a stable sort
 * by weight descending, ties by original index. On the candidate channel, where
 * every weight is a rank logit scaled by `lambdaRank = 0`, that is the identity
 * permutation — i.e. exactly `topCandidates`.
 */
export const ABLATED_SAMPLING: SamplingTuning = {
  ...DEFAULT_SAMPLING,
  t0: 0,
  tMin: 0,
  lambdaRank: 0,
  channels: { candidates: true, units: true, proposals: true },
};

/** Every channel drawing. What the probe measures the unit channel's cost on. */
export const ALL_CHANNELS: SamplingTuning = {
  ...DEFAULT_SAMPLING,
  channels: { candidates: true, units: true, proposals: true },
};

/** `T(f) = max(T_min, T₀ · f^γ)`. Pure; the caller supplies the fraction. */
export function temperatureAt(tuning: SamplingTuning, remainingFraction: number): number {
  if (tuning.t0 <= 0) return 0;
  const f = remainingFraction > 1 ? 1 : remainingFraction > 0 ? remainingFraction : 0;
  const t = tuning.t0 * Math.pow(f, tuning.gamma);
  return t > tuning.tMin ? t : tuning.tMin;
}

// ---------------------------------------------------------------------------
// Node addresses
// ---------------------------------------------------------------------------

/**
 * Node tags. A node is a place in the search where a set is ordered; an ARM is
 * a member of that set. Distinct tags keep the sweep's draws for unit 3 out of
 * the polish's draws for unit 3 — the same arm at two different decisions is
 * two different questions and must not share a stream.
 */
export const NODE_SWEEP_UNITS = 0x51_00_00_01;
export const NODE_SWEEP_CANDIDATES = 0x51_00_00_02;
export const NODE_PAIR_REPAIR = 0x51_00_00_03;
export const NODE_POLISH = 0x51_00_00_04;
export const NODE_PROPOSALS = 0x51_00_00_05;

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * What the sampler tells the operator. Rides `EmitRecord.selection`, which is
 * an audit field and is NOT forwarded to the wire (`forwardPlan` sends a
 * `CentaurMove` and a `GameState` view and nothing else).
 */
export interface SelectionReport {
  /** The decision seed actually used. Logged so the harness replays it. */
  readonly seed: number;
  /** The private per-match seed this decision was derived from. */
  readonly matchSeed: number;
  /** Rounds (slices) the sampler ran in. */
  readonly rounds: number;
  /** Temperature at the first and the last round — the schedule, observed. */
  readonly tFirst: number;
  readonly tLast: number;
  /** Permutations produced, and arms permuted across all of them. */
  readonly permutations: number;
  readonly arms: number;
  /** Uniform draws taken. One per arm per permutation. */
  readonly draws: number;
  /** The most severe weight regime any channel reported (rule 26). */
  readonly regime: WeightRegime;
  /** Arms whose rank was at or beyond the cap they were being sampled into —
   * options a deterministic prefix could not have reached. */
  readonly farAdmitted: number;
  /** Arms admitted in total, far or near. */
  readonly admitted: number;
}

const SEVERITY: Record<WeightRegime, number> = { normal: 0, "win-clipped": 1, vacuous: 2 };

// ---------------------------------------------------------------------------
// The sampler
// ---------------------------------------------------------------------------

export class SelectionSampler {
  /** Per-NODE visit counters — the draw index. See the note on `permute`. */
  private readonly visits = new Map<number, number>();
  private rounds = 0;
  private temp: number;
  private tFirst = 0;
  private tLast = 0;
  private permutations = 0;
  private arms = 0;
  private draws = 0;
  private regime: WeightRegime = "normal";
  private farAdmitted = 0;
  private admitted = 0;

  constructor(
    readonly seed: number,
    readonly tuning: SamplingTuning,
  ) {
    this.temp = tuning.t0 <= 0 ? 0 : tuning.t0;
  }

  /**
   * Open a round. `remainingFraction` is the share of the decision's budget
   * still unspent, read ONCE per slice by the caller from `BudgetHandle`.
   *
   * Once per slice and not once per draw, deliberately. Every draw of a round
   * shares one temperature, so the round is a coherent policy rather than a
   * drift; and the step-clock replay probe stays byte-identical between two
   * runs because the number of clock reads is a function of the slice count and
   * not of how much sampling happened inside a slice (arch-s1 correction 7 —
   * the yield-count hazard, in its selection-layer form).
   */
  beginRound(remainingFraction: number): void {
    this.temp = temperatureAt(this.tuning, remainingFraction);
    if (this.rounds === 0) this.tFirst = this.temp;
    this.tLast = this.temp;
    this.rounds++;
  }

  get temperature(): number {
    return this.temp;
  }

  /** Stamp the regime a weight builder reported. Most severe wins. */
  noteRegime(regime: WeightRegime): void {
    if (SEVERITY[regime] > SEVERITY[this.regime]) this.regime = regime;
  }

  /**
   * Record that `count` arms were actually admitted from a permutation of
   * `total`, of which those whose ORIGINAL rank was ≥ `count` are "far" — the
   * options a deterministic prefix of the same width could not have reached.
   * This is i2's falsifier instrument, counted at the seam where the far option
   * enters rather than reconstructed afterwards.
   */
  noteAdmitted(cap: number): void {
    const n = this.lastN < cap ? this.lastN : cap;
    for (let i = 0; i < n; i++) {
      this.admitted++;
      if ((this.slots[i] as number) >= cap) this.farAdmitted++;
    }
  }

  /**
   * ONE PERMUTATION, by Gumbel-top-k.
   *
   * `node` addresses the decision point; the arm address is the item's index in
   * `items`, which is stable for a session because candidate sets are built
   * once per session and cached. The draw index is the node's VISIT COUNT.
   *
   * Per-node counters rather than per-arm ones, and they are equivalent HERE
   * for a reason worth writing down: every arm of a node is drawn on every
   * visit to it (a permutation touches the whole list), and the arm set at a
   * node is fixed for the session — so "arm a's k-th draw" and "the k-th visit
   * to a's node" are the same event. One `Map` lookup per permutation instead
   * of one per arm is the difference between a 3 µs pass and a 30 µs one, and
   * the prefix-determinism property the per-arm form exists to buy is
   * preserved exactly: a budget that reaches this node twice takes its first
   * two draws whatever happened elsewhere.
   *
   * `weights` must be finite — `prior.ts::clipCeilings` is what guarantees it
   * (contract rule 26) — and is asserted here rather than trusted, because an
   * infinity in a sampling key is a silent unconditional selection.
   */
  permute<T>(items: ReadonlyArray<T>, node: number, weights: ReadonlyArray<number>): ReadonlyArray<T> {
    if (items.length <= 1) return items;
    const draw = this.visits.get(node) ?? 0;
    this.visits.set(node, draw + 1);
    this.permutations++;
    this.arms += items.length;
    if (this.temp > 0) this.draws += items.length;
    return this.at(items, node, weights, draw);
  }

  /**
   * THE SAME PERMUTATION THE NEXT VISIT WILL PRODUCE, without taking it.
   *
   * This is how §3.0 note 3 is met: *"the dispatch sequence is decided by the
   * seeded sampler ON THE COORDINATOR, BEFORE ANY WORKER RUNS, and is a pure
   * function of (seed, board, epoch, slice), never of worker timing."* The
   * end-of-slice speculation has to name the plans the NEXT slice will sweep,
   * and the next slice's draw index at a node is exactly this node's current
   * visit count — so peeking is not an approximation of the dispatch order, it
   * IS the dispatch order, computed one slice early. Taking a real draw here
   * instead would consume the very value the next sweep is about to use and the
   * two would disagree by construction.
   *
   * No counter moves and no telemetry is recorded: a peek is not a decision.
   */
  peek<T>(items: ReadonlyArray<T>, node: number, weights: ReadonlyArray<number>): ReadonlyArray<T> {
    if (items.length <= 1) return items;
    return this.at(items, node, weights, this.visits.get(node) ?? 0);
  }

  /**
   * SCRATCH, REUSED ACROSS CALLS — W2's discipline, applied to a hot loop that
   * runs a few dozen times a slice.
   *
   * A permutation allocated three arrays per call (keys, order, output) and the
   * first two never outlive it. Two typed buffers grown to the largest list
   * this sampler has seen turn that into one allocation per DECISION for the
   * output the caller keeps, and take the measured cost from 108 ns/arm to the
   * figure the report carries. `order` stays a plain `Int32Array` so
   * `lastOrder` can be read as ranks without a copy.
   */
  private keys = new Float64Array(0);
  private slots = new Int32Array(0);

  private at<T>(
    items: ReadonlyArray<T>,
    node: number,
    weights: ReadonlyArray<number>,
    draw: number,
  ): ReadonlyArray<T> {
    const n = items.length;
    if (this.keys.length < n) {
      this.keys = new Float64Array(n * 2);
      this.slots = new Int32Array(n * 2);
    }
    const keys = this.keys;
    const order = this.slots;
    const t = this.temp;
    if (t <= 0) {
      // THE ABLATION BRANCH. No draws at all: an ordering on the weights alone,
      // so "zero the exploration apparatus" collapses to pure weight order
      // EXACTLY rather than approximately. No float is generated, so no float
      // noise can enter.
      for (let i = 0; i < n; i++) {
        order[i] = i;
        keys[i] = weights[i] as number;
      }
    } else {
      const seed = this.seed;
      for (let i = 0; i < n; i++) {
        const w = weights[i] as number;
        if (!Number.isFinite(w)) {
          throw new Error(
            `selection: non-finite weight ${String(w)} at node ${node} arm ${i} — ` +
              "contract rule 26 requires every sampling weight to be clipped finite " +
              "(prior.ts::clipCeilings); an infinity here is an unconditional selection",
          );
        }
        order[i] = i;
        keys[i] = w / t + gumbel(seed, node, i, draw);
      }
    }
    // DESCENDING BY KEY, TIES BY ORIGINAL INDEX — and by INSERTION SORT, not by
    // `Array.prototype.sort`.
    //
    // Not a micro-optimisation looking for a home: these lists are a unit's
    // option set (four on a trail unit, twenty-odd on a queen) and a cluster's
    // k-best, so `n` is under about forty always. At that size the comparator
    // CALL dominates the comparison, and a closure comparator over a captured
    // array is the expensive kind. Insertion sort is also STABLE by
    // construction, which is what makes "ties by original index" a property of
    // the algorithm rather than a clause in a comparator that has to be
    // remembered — and the ablation depends on that stability being exact.
    for (let i = 1; i < n; i++) {
      const slot = order[i] as number;
      const key = keys[slot] as number;
      let j = i - 1;
      while (j >= 0) {
        const other = order[j] as number;
        const otherKey = keys[other] as number;
        if (otherKey > key || (otherKey === key && other < slot)) break;
        order[j + 1] = other;
        j--;
      }
      order[j + 1] = slot;
    }
    const out = new Array<T>(n);
    for (let i = 0; i < n; i++) out[i] = items[order[i] as number] as T;
    this.lastN = n;
    return out;
  }

  /** How long the last permutation was. The permutation itself lives in the
   * scratch and is valid until the next `permute`; `noteAdmitted` reads it
   * there, and `lastOrder` copies it out for tests. */
  private lastN = 0;

  /** The index permutation the last `permute` produced — original ranks, in
   * output order. Copies out of the scratch; read it immediately. */
  get lastOrder(): ReadonlyArray<number> {
    const out = new Array<number>(this.lastN);
    for (let i = 0; i < this.lastN; i++) out[i] = this.slots[i] as number;
    return out;
  }

  /**
   * How much work this node has already had — the progressive-widening
   * schedule's `N`.
   *
   * DENOMINATED IN NODE VISITS, NOT IN RESOLUTIONS, and the deviation is worth
   * naming rather than hiding. `mtl/ev-mcts-bandit.md` §13 asks for
   * resolutions ("cost is denominated in resolutions, never visits") and lists
   * `PlanCandidate.resolutions` as the accounting delta that would supply them;
   * that field is not in this tree, and adding it touches every price site in
   * the core. At the SHIPPED schedule the two are indistinguishable, because
   * `k0 = ceiling` makes `k(N) ≡ ceiling` for every N — the widening is inert
   * and nothing reads this number. A builder who lowers `k0` below the cap owes
   * the resolutions counter first, and this comment is the debt.
   */
  visitsOf(node: number): number {
    return this.visits.get(node) ?? 0;
  }

  report(): SelectionReport {
    return {
      seed: this.seed,
      matchSeed: this.tuning.matchSeed,
      rounds: this.rounds,
      tFirst: this.tFirst,
      tLast: this.tLast,
      permutations: this.permutations,
      arms: this.arms,
      draws: this.draws,
      regime: this.regime,
      farAdmitted: this.farAdmitted,
      admitted: this.admitted,
    };
  }
}
