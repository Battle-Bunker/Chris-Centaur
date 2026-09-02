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
 * ── THE BOARD IS POTIONS-ON ────────────────────────────────────────────────
 *
 * Owner ruling, 2026-08-29: potions are ALWAYS ON in real games. A cell built
 * here is potions-on unless it is an explicit off-control, and the names that
 * already carry ledger history keep the board they were measured on. See
 * `POTION_DEFAULT` for the guard that keeps one name meaning one board.
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

/**
 * POTIONS ARE ON. THAT IS THE BOARD, AND IT IS NOT AN AXIS ANY MORE.
 *
 * Owner ruling, 2026-08-29: potions are ALWAYS ON in real games, at spawn rate
 * 0.15. The library was built the other way round — potions off by default,
 * with `potion-` cells as a treatment — and that had a consequence nobody
 * chose: of 2,592 batch-1 replays, 2,400 were potions-off, and those 2,400
 * games contain ZERO sever events, because a body cut requires a strictly
 * higher tier and tier comes only from a potion. Nine tenths of the corpus was
 * measuring a game in which the sharpest rule in the rule set cannot fire.
 *
 * So the default flips. A cell generated from here is potions-on unless it is
 * an EXPLICIT off-control.
 *
 * ── AND THE NAMES DO NOT SILENTLY CHANGE MEANING ───────────────────────────
 *
 * This file's whole purpose is that a cell name denotes one board, because the
 * promotion ledger's history is keyed on cell names. Flipping a default would
 * break that outright: `headline-mix-king` has eighteen measurement rows behind
 * it and every one of them was played with potions off.
 *
 * So the flip is guarded three ways, and all three are checks rather than
 * comments:
 *
 *   1. LEGACY NAMES ARE PINNED. Every cell name that already carries ledger
 *      history keeps the board it was measured on. Its rows stay true and it
 *      stays schedulable as an off-control, which is what the ruling says
 *      off-cells are for.
 *   2. THE NAME MUST AGREE WITH THE BOARD. A name containing `nopotion` is
 *      potions-off; a name containing `potion` is potions-on; building one
 *      against the other throws.
 *   3. EVERYTHING ELSE IS ON. A new name with no marker gets the default, and
 *      the default is on.
 */
const POTION_DEFAULT = 'on';

/**
 * Cell names with measurement history in `promotion-ledger.json`, all of it
 * played potions-OFF. Pinned so the ledger's rows keep describing the games
 * that produced them. A name is retired from this set only by retiring the
 * name.
 *
 * The test is HISTORY, not habit: `base-mix-king` and `sparse-mix-king` are in
 * the committed library and have never been played, so they carry nothing that
 * a changed board could falsify, and they take the new default like any other
 * cell. Membership here is checkable — `grep '"<name>"' promotion-ledger.json`.
 */
const LEGACY_POTIONS_OFF = new Set([
  'hazard-mix-king',
  'headline-mix-king',
  'null-nopotion-mix-king',
  'null-snake6',
  'snake5-knight',
  'snake5-pawn',
  'snake5-queen',
]);

const marksNoPotion = (name) => /(^|-)nopotion(-|$)/.test(name);
const marksPotion = (name) => !marksNoPotion(name) && /(^|-)potion(-|$)/.test(name);

/** The potion setting a cell name implies, before any explicit override. */
function potionsFor(name, explicit) {
  const implied = LEGACY_POTIONS_OFF.has(name)
    ? 'off'
    : marksNoPotion(name)
      ? 'off'
      : marksPotion(name)
        ? 'on'
        : POTION_DEFAULT;
  if (explicit === undefined) return implied;
  if (explicit !== 'on' && explicit !== 'off') {
    throw new Error(`cell "${name}": potions must be "on" or "off", got ${JSON.stringify(explicit)}`);
  }
  if (explicit !== implied && (LEGACY_POTIONS_OFF.has(name) || marksNoPotion(name) || marksPotion(name))) {
    throw new Error(
      `cell "${name}": name says potions ${implied}, caller says ${explicit}. ` +
        'A cell name denotes one board — rename the cell rather than re-pointing it, ' +
        'or the ledger rows behind the old name stop describing the games that made them.'
    );
  }
  return explicit;
}

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

function cell(name, { roster, potions, hazards = 'none', food = 'normal' }, opts = {}) {
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
      potions: POTIONS[potionsFor(name, potions)],
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
  POTION_DEFAULT,
  LEGACY_POTIONS_OFF,
  potionsFor,
  HAZARDS,
  FOOD,
  FIELD,
  seedsFor,
  cell,
  spec,
  gamesPerArm,
};
