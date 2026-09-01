'use strict';
/*
 * THE EVALUATOR-SELECTION LADDER — overnight R1 (batch3-roster.md), the
 * top-ranked item in the "worth more resources" list: is `lobster-territory`
 * the right default evaluator once ANY piece is fielded?
 *
 * Both-sides-one-game: [lobster-territory, lobster-material, reflex] seated
 * in ONE game with rotateSeats:true, so the contrast is within-game. Two
 * IDENTICAL arms (self-flooring) buy the reading and its own A/A floor from
 * the same games. Owner shape (cells.js DEFAULTS: 2000ms/25x25/turnCap120/
 * 3x6), potions ON (the library default), hazard 'interior' (cross layout).
 *
 * CHUNKED BY CELL — pass one cell name per invocation so a batch is one cell
 * (32 blocks x 3 rotations x 2 arms = 192 games, ~owner-shape cost) rather
 * than committing to all six (1,152 games) in one untimed launch.
 *
 *   node mkroster.js <cellName> <blocks> <seedBase> <out.json>
 *
 * cellName one of: snake6, snake5-knight, snake5-rook, snake5-queen,
 * queen2-snake4, mix-king. (rook/queen2 rosters added to cells.js for this
 * ladder — see the comment there.)
 */
const fs = require('fs');
const cells = require(process.env.KIT + '/tools/learnloop/lib/cells.js');

const roster = process.argv[2];
const blocks = Number(process.argv[3] || 32);
const seedBase = Number(process.argv[4] || 5001);
const out = process.argv[5];

const VALID_ROSTERS = ['snake6', 'snake5-knight', 'snake5-rook', 'snake5-queen', 'queen2-snake4', 'mix-king'];
if (!roster || !VALID_ROSTERS.includes(roster)) {
  console.error('usage: mkroster.js <roster> <blocks> <seedBase> <out.json>');
  console.error('roster one of:', VALID_ROSTERS.join(' '));
  process.exit(1);
}

// The cell NAME is deliberately NOT the bare roster name: 'snake5-knight' and
// 'snake5-queen' are in cells.js's LEGACY_POTIONS_OFF set (their ledger
// history is potions-off), and R1 needs potions ON. A distinct name with a
// 'potion' marker sidesteps that guard cleanly and keeps this ladder's cells
// unambiguous from anything already in the ledger or in this runner's own
// earlier batches (which used the same roster words at a different shape).
const cellName = `potion-ladder-${roster}`;

const spec = cells.spec(
  'pp-roster-ladder',
  [
    'Evaluator-selection ladder, overnight R1: is lobster-territory the right',
    'default once a piece is fielded? [territory, material, reflex] within one',
    'game, rotateSeats. Two identical arms self-floor. Owner shape, potions ON,',
    'hazard interior (cross). Chunked one cell per batch.',
  ],
  [cells.cell(cellName, { roster, hazards: 'interior' }, {})],
  undefined, // bots default to FIELD = [lobster-territory, lobster-material, reflex]
  blocks,
  { seedBase }
);

fs.writeFileSync(out, JSON.stringify(spec, null, 1) + '\n');
console.log(
  'wrote', out,
  '| roster', roster,
  '| cell', cellName,
  '| games/arm', cells.gamesPerArm(spec),
  '| blocks', blocks,
  '| seeds', spec.seeds[0], '..', spec.seeds[spec.seeds.length - 1]
);
