'use strict';
/*
 * THE POTION-VALUE SWEEP — at what settings does collecting potions PAY?
 *
 * WHY THIS IS THE RIGHT NEXT EXPERIMENT. The replays settled the question the
 * ladder cycles were circling. `candidates.potionOrdering` makes the bot
 * collect 22-45% more potions than the byte-identical bot without it, in the
 * same games, at zero search cost. THE COLLECTING CAPABILITY IS BUILT AND
 * WORKING. On the hazard-free cell it collects 45% more potions and scores
 * +0.021 [-0.143, 0.213] — no score. The prize is too small.
 *
 * So the open question is not about the bot any more, it is about the GAME:
 * how valuable does a potion have to be before chasing it is worth the tempo?
 * `effectTurns` is the dial. Hazards are OFF on every cell here so that the
 * hazard interaction found in k1+k2 cannot confound the value reading.
 *
 *   effectTurns 3   the current setting — reproduces the known null
 *   effectTurns 8   a potion that lasts a normal exchange
 *   effectTurns 20  a potion that is decisive
 *
 * If G crosses zero at a reachable setting, the owner has a potion-intelligent
 * bot TODAY: the flag exists, it is free, and it wins on boards where potions
 * matter. If it never crosses, the honest finding is that invulnerability
 * potions are not worth chasing in this game at any setting the harness
 * offers — which stops the potion effort rather than deepening it.
 *
 * Only two contenders, so the third seat is a fixed reference and the field is
 * constant across the three cells; a within-game contrast is not independent
 * of its field, so the field must not vary while the dial does.
 */
const fs = require('fs');
const cells = require(process.env.KIT + '/tools/learnloop/lib/cells.js');

const blocks = Number(process.argv[2] || 24);
const budget = Number(process.argv[3] || 200);
const size = Number(process.argv[4] || 21);
const turnCap = Number(process.argv[5] || 80);
const seedBase = Number(process.argv[6] || 4301);
const out = process.argv[7];
const opts = { blocks, budget, size, turnCap, seedBase };

function valued(name, effectTurns) {
  const c = cells.cell(name, { roster: 'snake6' }, opts);
  c.config.potions = { enabled: true, spawnRate: 0.15, initial: 2, effectTurns };
  c.config.name = name;
  return c;
}

const spec = {
  _comment: [
    'THE POTION-VALUE SWEEP — effectTurns 3 / 8 / 20, hazards off, the working',
    'potionOrdering flag on. Finds where collecting potions starts to pay.',
  ],
  sweepId: 'pp-potion-value',
  contenders: {
    potionOrder: {
      base: 'lobster-territory',
      bot: { name: 'potionOrder', candidates: { potionOrdering: true } },
    },
    plain: { base: 'lobster-territory', bot: { name: 'plain' } },
  },
  bots: ['potionOrder', 'plain', 'reflex'],
  seeds: cells.seedsFor('pp-potion-value', blocks, seedBase),
  rotateSeats: true,
  cells: [
    valued('potion-val03-snake6', 3),
    valued('potion-val08-snake6', 8),
    valued('potion-val20-snake6', 20),
  ],
};

fs.writeFileSync(out, JSON.stringify(spec, null, 1) + '\n');
console.log('wrote', out, '| games/arm', spec.cells.length * spec.seeds.length * spec.bots.length,
  '| blocks', blocks, '| seeds', spec.seeds[0], '..', spec.seeds[spec.seeds.length - 1]);
