/*
 * ENERGY METRICS, read off the local runner's own trace.
 *
 * `src/tests/local-game.ts` prints one line per unit per turn — kind, health at
 * the START of the turn, the cell it stood on and the cell it staged — and a
 * JSON metrics block at the end. That is everything the energy member has to be
 * measured on, so this script parses it rather than adding counters to a file
 * another agent is editing.
 *
 *   HEALTH SPENT is CELLS ENTERED, which is what the rules charge: one health
 *   per cell entered, at `costPerCell` = 1 for every kind
 *   (src/partial-engine/grammar.ts), and the scenarios carry no hazards. A
 *   slider enters one cell per sub-step of its ray, so its spend is the
 *   Chebyshev distance it covered; a knight's jump is ONE cell whatever the
 *   L-offset says; a hold or a pawn rotation enters nothing and spends nothing.
 *
 *   A HOLD is a unit-turn that ended on the cell it began on. For a pawn that
 *   includes its rotation, which is the same decision — it declined to travel.
 *
 * Usage: node scripts/energy-metrics.js <trace file> [<trace file> ...]
 */

const fs = require('fs');

const RAY = new Set(['rook', 'bishop', 'queen']);

/** Cells entered by a unit of `kind` going from (x0,y0) to (x1,y1). */
function cellsEntered(kind, x0, y0, x1, y1) {
  if (x0 === x1 && y0 === y1) return 0;
  if (RAY.has(kind)) return Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return 1;
}

const LINE = /^\s*T\s*(\d+)\s+(\S+)\s+(\S+)\s+hp\s*(-?\d+)\s+\((-?\d+),(-?\d+)\)->\((-?\d+),(-?\d+)\)/;

function parse(file) {
  const text = fs.readFileSync(file, 'utf8');
  const perKind = new Map();
  for (const line of text.split('\n')) {
    const m = LINE.exec(line);
    if (m === null) continue;
    const kind = m[3];
    const hp = Number(m[4]);
    const spent = cellsEntered(kind, Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8]));
    const row = perKind.get(kind) ?? { unitTurns: 0, spent: 0, holds: 0, hpSum: 0, lowHp: 0 };
    row.unitTurns++;
    row.spent += spent;
    row.hpSum += hp;
    if (spent === 0) row.holds++;
    if (hp <= 50) row.lowHp++;
    perKind.set(kind, row);
  }
  const at = text.lastIndexOf('--- metrics ---');
  const json = at === -1 ? '{}' : text.slice(text.indexOf('{', at), text.indexOf('\n}', at) + 2);
  return { perKind, metrics: JSON.parse(json) };
}

const totals = new Map();
const game = {
  turns: 0,
  unitTurns: 0,
  foodEaten: 0,
  reversals: 0,
  dithers: 0,
  stationary: 0,
  starvationDeaths: 0,
  otherDeaths: 0,
};
const causes = {};
for (const file of process.argv.slice(2)) {
  const { perKind, metrics } = parse(file);
  for (const [kind, row] of perKind) {
    const acc = totals.get(kind) ?? { unitTurns: 0, spent: 0, holds: 0, hpSum: 0, lowHp: 0 };
    for (const k of Object.keys(row)) acc[k] += row[k];
    totals.set(kind, acc);
  }
  for (const k of Object.keys(game)) game[k] += metrics[k] ?? 0;
  for (const [c, n] of Object.entries(metrics.deathsByCause ?? {})) causes[c] = (causes[c] ?? 0) + n;
}

const pct = (n, d) => (d === 0 ? '  0.0' : ((100 * n) / d).toFixed(1).padStart(5));
console.log('kind      unitTurns  spend/turn   hold%   meanHp  hp<=50%');
for (const kind of [...totals.keys()].sort()) {
  const r = totals.get(kind);
  console.log(
    `${kind.padEnd(9)} ${String(r.unitTurns).padStart(8)}  ` +
      `${(r.spent / Math.max(1, r.unitTurns)).toFixed(3).padStart(9)}  ` +
      `${pct(r.holds, r.unitTurns)}  ${(r.hpSum / Math.max(1, r.unitTurns)).toFixed(1).padStart(6)}  ` +
      `${pct(r.lowHp, r.unitTurns)}`
  );
}
const pieces = [...totals.entries()].filter(([k]) => k !== 'snake');
const pieceTurns = pieces.reduce((a, [, r]) => a + r.unitTurns, 0);
const pieceSpend = pieces.reduce((a, [, r]) => a + r.spent, 0);
const pieceHolds = pieces.reduce((a, [, r]) => a + r.holds, 0);
console.log(
  `ALL PIECES ${String(pieceTurns).padStart(7)}  ${(pieceSpend / Math.max(1, pieceTurns)).toFixed(3).padStart(9)}  ` +
    `${pct(pieceHolds, pieceTurns)}`
);
console.log(
  `game: turns=${game.turns} unitTurns=${game.unitTurns} ` +
    `food/100=${((100 * game.foodEaten) / Math.max(1, game.unitTurns)).toFixed(2)} ` +
    `reversal%=${pct(game.reversals, game.unitTurns).trim()} ` +
    `dither%=${pct(game.dithers, game.unitTurns).trim()} ` +
    `stationary%=${pct(game.stationary, game.unitTurns).trim()} ` +
    `starvation=${game.starvationDeaths} other=${game.otherDeaths} causes=${JSON.stringify(causes)}`
);
