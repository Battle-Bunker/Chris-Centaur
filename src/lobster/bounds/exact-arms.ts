/**
 * THE GATE ARMS THE EXACT-REPLY ORACLE IS POINTED AT, AND HOW ONE IS RUN.
 *
 * The sixteen arms are the ones `CENTAUR_DEBUG_INVERSION` runs — four
 * scenarios at seeds 1..3, and `potions` on the four further seeds the potion
 * board is gated on. Two suites read this table and they differ only in HOW
 * MANY of its rows they take, which is why the table and the runner live here
 * rather than in either of them:
 *
 *   `exact-reply.test.ts`       the four seed-1 arms — the default `npx jest`
 *   `exact-reply.gate.test.ts`  all sixteen — `npm run gate:exact`
 *
 * That split is a TEST SELECTION and not a switch inside the instrument: both
 * suites run the same arms the same way, and the second one runs more of them.
 * Nothing on the decision path imports this file; it is here, beside the
 * oracle it drives, so that neither suite has to own a copy of the other's
 * loop.
 *
 * EVERY ARM IS A PREFIX OF ITS OWN GAME, at a sampled rate. The prefix is a
 * real game with real boards, and every world the oracle settles inside it is
 * a complete concrete world through the same engine — so a floor above one is
 * a proof the floor is wrong. A short arm is a weaker SAMPLE and never a
 * weaker argument. The whole-length sweep (thirty turns, sixty on the potion
 * seeds, one plan in ten) is a runner command rather than a suite, because it
 * is forty minutes of settlements; it is the one
 * `docs/design/decision-lens/08-DEPTH-VERDICT.md` §7.1 reports from.
 */

import { runGame, SCENARIOS } from "../../tests/local-game";
import {
  exactStats,
  resetExactCheckSettings,
  resetExactStats,
  type ExactStats,
} from "./exact-reply";

export interface ExactArm {
  readonly scenario: string;
  readonly seed: number;
  /** Turns of the arm's own game to play. */
  readonly turns: number;
  /** Audit one priced plan in every `rate`. */
  readonly rate: number;
  /** Worlds per check. */
  readonly cap: number;
}

/** The four scenarios, at the three seeds the inversion gate runs them on. */
const SCENARIO_NAMES = ["mixed", "snakes", "sparse", "potions"] as const;

const armsOf = (): ExactArm[] => {
  const out: ExactArm[] = [];
  for (const scenario of SCENARIO_NAMES) {
    for (const seed of [1, 2, 3]) {
      out.push({ scenario, seed, turns: 6, rate: 60, cap: 128 });
    }
  }
  // The potion board is the one 08 §7 reported the defect on, and it is gated
  // on four further seeds at twice the length.
  for (const seed of [4, 5, 6, 8]) {
    out.push({ scenario: "potions", seed, turns: 10, rate: 40, cap: 128 });
  }
  return out;
};

/** All sixteen. */
export const ARMS: ReadonlyArray<ExactArm> = armsOf();

/** One arm per scenario — what an ordinary `npx jest` can afford. */
export const SEED_ONE_ARMS: ReadonlyArray<ExactArm> = ARMS.filter((a) => a.seed === 1);

/**
 * Play one arm with the audit on, and hand back what it saw.
 *
 * The env is the instrument's own switch and it is set and cleared around the
 * game rather than for the process, so an arm that throws cannot leave the
 * oracle armed for the next one. The returned object is a COPY: `exactStats`
 * is a module singleton the next arm resets.
 */
export async function runExactArm(arm: ExactArm): Promise<ExactStats> {
  const spec = SCENARIOS[arm.scenario];
  if (spec === undefined) throw new Error(`unknown scenario ${arm.scenario}`);
  process.env.CENTAUR_EXACT_CHECK = String(arm.rate);
  process.env.CENTAUR_EXACT_CAP = String(arm.cap);
  resetExactCheckSettings();
  resetExactStats();
  try {
    await runGame({ ...spec, seed: arm.seed, maxTurns: arm.turns, nodeBudget: 550 });
  } finally {
    delete process.env.CENTAUR_EXACT_CHECK;
    delete process.env.CENTAUR_EXACT_CAP;
    resetExactCheckSettings();
  }
  return {
    ...exactStats,
    skips: { ...exactStats.skips },
    classes: { ...exactStats.classes },
  };
}

/** One line per arm, with the DEFECT COUNTS PER CLASS the run found. */
export function armLine(arm: ExactArm, stats: ExactStats): string {
  return (
    `  [exact ${arm.scenario}/${arm.seed}] checks=${stats.checks} ` +
    `worlds=${stats.worlds} complete=${stats.complete} ` +
    `floor=${stats.floorViolations} ceiling=${stats.ceilingViolations} ` +
    `classes=${JSON.stringify(stats.classes)} skips=${JSON.stringify(stats.skips)}`
  );
}
