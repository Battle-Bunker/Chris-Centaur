'use strict';
/*
 * THE PIECE-CELL FLOOR, CHARACTERIZED (queue item 3).
 *
 * THE PROBLEM. Three independent runs have now produced a piece-bearing cell
 * whose A/A floor EXCLUDES ZERO between two byte-identical arms:
 *   - overnight finding 2, a queen cell on the feature bundle: +0.271 [0.037, 0.506]
 *   - batch 2's `headline-mix-king`, whose sharePar floor widened to ±0.53
 *   - sandbox c1's knight cell: -0.490 [-0.688, -0.270]
 * The programme has read all three as "piece cells have no usable floor", i.e.
 * a property of piece boards. That reading has never been tested against two
 * rival explanations, and it blocks every piece-cell result in the programme.
 *
 * THE THREE HYPOTHESES
 *   H1  BOARD. Piece boards genuinely have a wider outcome distribution.
 *       Prediction: the floor is wide but falls as 1/sqrt(n) like any other.
 *   H2  HEAVY TAIL. The distribution has rare large excursions, so a small
 *       sample understates the spread and an 8-block interval excludes zero by
 *       luck. Prediction: `floorscale.js` ratios well under 1 at small n, and
 *       the interval stops excluding zero once enough blocks are drawn.
 *   H3  SERVICE. Piece cells are the most search-hungry, so the CPU-service
 *       swing documented in item 1's results does the most damage there.
 *       Prediction: the between-arm plans/decision gap is larger on this cell
 *       than on the snake cells, and tracks the floor.
 *
 * All three are distinguishable from ONE run of enough blocks, because
 * `floorscale.js` separates H2 and `armservice.js` separates H3.
 *
 * The contenders are the channel ladder's, so these games also add a
 * piece-cell rung to item 1 at no extra cost — but the floor is the point,
 * and the rung is only readable if the floor turns out to be sound.
 */
const fs = require('fs');
const cells = require(process.env.KIT + '/tools/learnloop/lib/cells.js');

const blocks = Number(process.argv[2] || 48);
const budget = Number(process.argv[3] || 200);
const size = Number(process.argv[4] || 21);
const turnCap = Number(process.argv[5] || 80);
const seedBase = Number(process.argv[6] || 4101);
const out = process.argv[7];
const opts = { blocks, budget, size, turnCap, seedBase };

const spec = {
  _comment: [
    'THE PIECE-CELL FLOOR — one cell, many blocks, so the floor can be plotted',
    'against block count instead of assumed. Two identical arms.',
  ],
  sweepId: 'pp-piece-floor',
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
  seeds: cells.seedsFor('pp-piece-floor', blocks, seedBase),
  rotateSeats: true,
  cells: [cells.cell('potion-snake5-knight', { roster: 'snake5-knight' }, opts)],
};

fs.writeFileSync(out, JSON.stringify(spec, null, 1) + '\n');
console.log('wrote', out, '| games/arm', spec.cells.length * spec.seeds.length * spec.bots.length,
  '| blocks', blocks, '| seeds', spec.seeds[0], '..', spec.seeds[spec.seeds.length - 1]);
