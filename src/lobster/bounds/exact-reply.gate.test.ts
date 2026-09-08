/**
 * THE SIXTEEN GATE ARMS — `npm run gate:exact`.
 *
 * The same sixteen arms `CENTAUR_DEBUG_INVERSION=1` runs: four scenarios at
 * seeds 1..3, and `potions` on the four further seeds the potion board is
 * gated on. The inversion gate compares the bank's own members against each
 * other, so it sees a rung that disagrees with its siblings and is blind to
 * the failure that matters more — a floor that is wrong on EVERY rung at once,
 * where both bounds move together and the bracket stays the right way up.
 * This suite settles concrete worlds and can refute exactly that.
 *
 * IT IS NOT IN THE DEFAULT SUITE, and the reason is time and nothing else:
 * sixteen arms cost about four minutes of settlements. `exact-reply.test.ts`
 * runs the seed-1 arm of each scenario on every `npx jest`, out of this same
 * table and through this same runner (`exact-arms.ts`), so the selection
 * changes how many arms run and never how one is run. `jest.config.js` keeps
 * this file out of the default run by path; the npm script names it back in.
 *
 * The whole-length sweep — thirty turns, sixty on the potion seeds, one plan
 * in ten — is a runner command rather than a suite, because it is forty
 * minutes of settlements. It is the sweep
 * `docs/design/decision-lens/08-DEPTH-VERDICT.md` §7.1 reports from:
 *
 *     CENTAUR_EXACT_CHECK=10 CENTAUR_EXACT_CAP=128 \
 *       node dist/tests/local-game.js <scenario> <turns> <seed> --nodes
 */

import { ARMS, armLine, runExactArm } from './exact-arms';

describe('the sixteen gate arms: no floor above a concrete reply', () => {
  for (const arm of ARMS) {
    test(`${arm.scenario} seed ${arm.seed}`, async () => {
      const stats = await runExactArm(arm);
      console.log(armLine(arm, stats));
      // Anti-vacuity: the arm has to have looked at real worlds at all.
      expect(stats.checks).toBeGreaterThan(10);
      expect(stats.worlds).toBeGreaterThan(100);
      expect(stats.classes).toEqual({});
      expect(stats.floorViolations).toBe(0);
      expect(stats.ceilingViolations).toBe(0);
    }, 900_000);
  }
});
