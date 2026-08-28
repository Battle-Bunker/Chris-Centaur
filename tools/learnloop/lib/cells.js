'use strict';
/*
 * THE CELL VOCABULARY — one definition, two generators.
 *
 * `tools/simworker/bin/make-specs.js` writes the standing spec library;
 * `tools/learnloop/bin/make-promotion-batch.js` writes the next batch's specs
 * from the promotion ledger. Both must speak the same rosters, the same board
 * conditions and the same seed derivation, or two cells that share a name
 * describe different experiments and the ledger's history stops meaning
 * anything.
 *
 * So the vocabulary lives here and both require it. On the sim/worker-kit
 * branch `make-specs.js` requires this file directly; on
 * `claude/cluster-lookahead`, where `tools/simworker/` does not exist, only the
 * promotion generator uses it. `bin/selftest.js` asserts that the specs this
 * module builds are byte-identical to the committed library wherever the
 * library is present.
 *
 * ── THE SHAPE EVERYTHING IS BUILT AROUND ───────────────────────────────────
 *
 * The owner's target: 2 s turns, 3 teams x 6 units each, 25x25 boards. 25 is
 * the harness's maximum board size, so this is the top of the supported range
 * in every dimension at once, and every other cell is that shape with ONE axis
 * moved.
 *
 * ── SEEDS AND BLOCKS ───────────────────────────────────────────────────────
 *
 * A BLOCK is one seed played through every cyclic seat rotation — 3 games on a
 * 3-team board. Blocks, not games, are the unit of resampling. Seeds are a
 * fixed arithmetic sequence from a per-cell base, so two batches of the same
 * cell at different block counts NEST: the 16-block run contains the 8-block
 * run's seeds, and "we added blocks" is a strictly stronger statement rather
 * than a different experiment.
 */

const DEFAULTS = {
  blocks: 16,
  budget: 2000,
  size: 25,
  turnCap: 120,
  seedBase: 4001,
};

const TEAMS = ['red', 'blue', 'green'];

/**
 * ROSTERS — six units a side, varied by what pieces are on the board.
 *
 * `snake6` is not merely one more roster. It is the NULL ROSTER for every
 * treatment gated on piece class: the slider profile's extra terms are switched
 * off when nothing on the board is a piece, and the staging guard's whole
 * regression is a snake-only phenomenon. On this roster those arms are
 * bit-identical to their baseline, so the contrast measured there is the
 * run-to-run noise floor and nothing else — a null that rides along inside the
 * treatment batch instead of costing a separate pair.
 */
const ROSTERS = {
  snake6: ['snake', 'snake', 'snake', 'snake', 'snake', 'snake'],
  'snake5-pawn': ['pawn', 'snake', 'snake', 'snake', 'snake', 'snake'],
  'snake5-knight': ['knight', 'snake', 'snake', 'snake', 'snake', 'snake'],
  'snake5-queen': ['queen', 'snake', 'snake', 'snake', 'snake', 'snake'],
  'mix-king': ['king', 'queen', 'rook', 'knight', 'snake', 'snake'],
};

/** Board-condition axes, one step off the baseline each. */
const POTIONS = {
  off: { enabled: false },
  on: { enabled: true, spawnRate: 0.15, initial: 2, effectTurns: 3 },
};
const HAZARDS = {
  none: { layout: 'none' },
  // "Interior" hazards. `border` is the edge and `random` is not reproducible
  // across board sizes in a way a reader can picture, so the interior arm is
  // `cross` — a deterministic pair of bands through the middle that every team
  // must cross or route around, at the default damageRatio (0.15 of the
  // reference kind's max health, i.e. a COST rather than a wall).
  interior: { layout: 'cross', damageRatio: 0.15 },
};
const FOOD = {
  normal: { initial: 6, spawnRate: 0.5 },
  sparse: { initial: 4, spawnRate: 0.15 },
};

/**
 * Bots seated in EVERY arm of a cross-build comparison.
 *
 * The contender sits in one seat and a fixed reference field fills the others.
 * In a CROSS-BRANCH pair the field is compiled from each branch too, so "the
 * same in both arms" is an assumption that holds exactly to the extent the
 * branches did not change those paths — which is what the A/A null and the
 * inert `snake6` cell are for.
 */
const FIELD = ['lobster-territory', 'lobster-material', 'reflex'];

/** A stable per-cell seed offset: identical seeds across cells would correlate
 * their noise, so every cell gets its own arithmetic sequence. */
function seedsFor(cellName, blocks, seedBase = DEFAULTS.seedBase) {
  let h = 0;
  for (const ch of cellName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const base = seedBase + (h % 1000) * 100;
  return Array.from({ length: blocks }, (_, i) => base + i);
}

function cell(name, { roster, potions = 'off', hazards = 'none', food = 'normal' }, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    cell: name,
    config: {
      name,
      size: o.size,
      teams: TEAMS,
      roster: ROSTERS[roster],
      budgetMs: o.budget,
      turnCap: o.turnCap,
      food: FOOD[food],
      hazards: HAZARDS[hazards],
      potions: POTIONS[potions],
    },
  };
}

function spec(sweepId, comment, cells, bots = FIELD, blocks = DEFAULTS.blocks, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    _comment: comment,
    sweepId,
    bots,
    seeds: seedsFor(sweepId, blocks, o.seedBase),
    rotateSeats: true,
    cells,
  };
}

/** Games per ARM for one spec. A paired cell runs two arms, so double it. */
function gamesPerArm(s) {
  return s.cells.length * s.seeds.length * (s.rotateSeats === false ? 1 : s.bots.length);
}

module.exports = {
  DEFAULTS,
  TEAMS,
  ROSTERS,
  POTIONS,
  HAZARDS,
  FOOD,
  FIELD,
  seedsFor,
  cell,
  spec,
  gamesPerArm,
};
