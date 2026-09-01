'use strict';
/*
 * THE CHANNEL LADDER — plain, the ORDERING half alone, and both halves.
 *
 * Derived from $SP/ppruns/mkorder.js (the builder's version) with two
 * deliberate changes, both from sandbox cycle c1:
 *
 *  1. The knight cell is DROPPED. c1 measured its A/A floor at
 *     -0.490 [-0.689, -0.267] — an interval between two IDENTICAL arms
 *     that excludes zero. A cell whose floor is broken cannot carry a
 *     reading, and its third of the machine time buys nothing. Piece-cell
 *     floor characterization is queue item 3 and belongs in its own run.
 *  2. Blocks default to 24, not 8. c1's floors came back 0.20-0.40 wide at
 *     8 blocks per arm; the rungs of this ladder are expected to sit
 *     inside that, so 8 blocks cannot separate them.
 *
 * THE RUNGS
 *   plain         the shipped bot.
 *   potionOrder   the shipped evaluator, `candidates.potionOrdering` on: a
 *                 pickup sorts as a gain, so the collection move enters the
 *                 priced set. NO evaluator cost at all.
 *   potionBoth    the ordering slot AND the potion-aware evaluator lineup.
 *
 * WHY THIS IS THE EXPERIMENT c1 DEMANDS. c1's mechanism table showed the
 * potion-aware bot evaluating 28-44% fewer plans per decision than plain
 * inside the same millisecond budget, while its advisory lineup fired
 * 195-227 times per decision and engaged on 21-39% of them. The arm
 * therefore confounds the ADVICE with its PRICE. The middle rung has the
 * advice channel open and the price at zero, so the ladder separates them.
 */
const fs = require('fs');
const cells = require(process.env.KIT + '/tools/learnloop/lib/cells.js');

const blocks = Number(process.argv[2] || 24);
const budget = Number(process.argv[3] || 200);
const size = Number(process.argv[4] || 21);
const turnCap = Number(process.argv[5] || 80);
const seedBase = Number(process.argv[6] || 4001);
const out = process.argv[7];
const opts = { blocks, budget, size, turnCap, seedBase };

const spec = {
  _comment: [
    'THE CHANNEL LADDER — the potion doctrine split into its advice and its price.',
    'Both-sides-one-game: three contenders in ONE game with rotateSeats, so G is a',
    'within-game contrast; two identical arms, so the between-arm difference of G is',
    'this cell’s own A/A floor, bought by the same games.',
  ],
  sweepId: 'pp-potion-channel',
  contenders: {
    potionBoth: {
      base: 'lobster-territory',
      bot: { name: 'potionBoth', slate: 'potion-aware', candidates: { potionOrdering: true } },
    },
    potionOrder: {
      base: 'lobster-territory',
      bot: { name: 'potionOrder', candidates: { potionOrdering: true } },
    },
    plain: { base: 'lobster-territory', bot: { name: 'plain' } },
  },
  bots: ['potionBoth', 'potionOrder', 'plain'],
  seeds: cells.seedsFor('pp-potion-channel', blocks, seedBase),
  rotateSeats: true,
  cells: [
    cells.cell('potion-snake6', { roster: 'snake6' }, opts),
    cells.cell('potion-hazard-snake6', { roster: 'snake6', hazards: 'interior' }, opts),
  ],
};

fs.writeFileSync(out, JSON.stringify(spec, null, 1) + '\n');
console.log('wrote', out, '| games/arm', spec.cells.length * spec.seeds.length * spec.bots.length,
  '| blocks/arm', blocks, '| seeds', spec.seeds[0], '..', spec.seeds[spec.seeds.length - 1]);
