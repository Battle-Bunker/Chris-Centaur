'use strict';
/*
 * THE HAZARD DOSE-RESPONSE — does the potion-ordering harm scale with the
 * hazard damage it is supposed to be walking into?
 *
 * WHAT THIS TESTS. Cycles k1+k2 found `potionOrder` (a potion pickup sorted as
 * a gain, zero evaluator cost) scoring -0.145 [-0.258, -0.035] against `plain`
 * on the interior-hazard cell, replicated across two independent runs. On the
 * two hazard-FREE cells the same setting is worth nothing (+0.021, +0.069).
 * The proposed mechanism is that chasing potions routes units across hazard
 * cells.
 *
 * That is a dose-response claim, so it gets a dose-response test: the SAME
 * cell at three hazard damage ratios, everything else held fixed.
 *
 *   dmg 0.05  the same hazard geometry with most of the teeth removed. The
 *             kit REFUSES damageRatio 0 with layout 'cross' ("hazard cells
 *             that do nothing"), which is a correct guard, so the low rung is
 *             a third of the standing dose rather than none of it. If the harm
 *             persists undiminished here, it is not about damage and the
 *             mechanism is wrong.
 *   dmg 0.15  the programme's standing interior-hazard cell; the value k1/k2
 *             measured, so this rung is also a third replication.
 *   dmg 0.30  double the damage. The mechanism predicts roughly double the
 *             harm.
 *
 * A monotone harm rising with damage confirms it. A flat profile says the
 * hazard cell differs from the others for some other reason and the story is
 * wrong — which is worth knowing before anyone changes the ordering code.
 */
const fs = require('fs');
const cells = require(process.env.KIT + '/tools/learnloop/lib/cells.js');

const blocks = Number(process.argv[2] || 24);
const budget = Number(process.argv[3] || 200);
const size = Number(process.argv[4] || 21);
const turnCap = Number(process.argv[5] || 80);
const seedBase = Number(process.argv[6] || 4201);
const out = process.argv[7];
const opts = { blocks, budget, size, turnCap, seedBase };

function dosed(name, dmg) {
  const c = cells.cell(name, { roster: 'snake6', hazards: 'interior' }, opts);
  // The cell vocabulary has no damage axis, so it is set here explicitly and
  // the cell carries its dose in its NAME — one name, one board.
  c.config.hazards = { layout: 'cross', damageRatio: dmg };
  c.config.name = name;
  return c;
}

const spec = {
  _comment: [
    'THE HAZARD DOSE-RESPONSE for the potion-ordering harm found in k1+k2.',
    'Same cell, three damage ratios, everything else fixed.',
  ],
  sweepId: 'pp-hazard-dose',
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
  seeds: cells.seedsFor('pp-hazard-dose', blocks, seedBase),
  rotateSeats: true,
  cells: [
    dosed('potion-hazdose05-snake6', 0.05),
    dosed('potion-hazdose15-snake6', 0.15),
    dosed('potion-hazdose30-snake6', 0.30),
  ],
};

fs.writeFileSync(out, JSON.stringify(spec, null, 1) + '\n');
console.log('wrote', out, '| games/arm', spec.cells.length * spec.seeds.length * spec.bots.length,
  '| blocks', blocks, '| seeds', spec.seeds[0], '..', spec.seeds[spec.seeds.length - 1]);
