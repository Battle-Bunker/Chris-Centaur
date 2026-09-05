#!/usr/bin/env node
/**
 * REBUILD THE `movesets` PROJECTION FROM `turn_events`.
 *
 * The `movesets` table is a materialised projection of the `movesets` frames.
 * It exists for the index `(decision_id, cluster_id, rank)` and not for its
 * content, and a stored table that is a pure fold of stored events is
 * legitimate ONLY IF a boundary test asserts the fold reproduces it AND a
 * rebuild command exists. `src/tests/lens-schema.test.ts` is the test. This is
 * the command. Without both of them the table goes the way of
 * `command_turn_states`, which was a copy of a fold's output kept beside the
 * inputs that generate it, with nothing able to regenerate it — and which
 * therefore drifted.
 *
 * There is no second implementation here. The script calls the SAME
 * `projectMovesets` fold the writer calls, over the same bytes, because a
 * rebuild that used its own copy of the projection logic would prove only that
 * two copies agree today.
 *
 * USAGE
 *   node scripts/lens-rebuild.js                  every decision, rebuilt
 *   node scripts/lens-rebuild.js --game <gameId>  one game
 *   node scripts/lens-rebuild.js --check          compare, change nothing
 *
 * `--check` is the gate's form: it reads what is stored, folds what should be
 * stored, and reports any decision where the two differ — a drift detector you
 * can run against production without writing to it. Without it the script does
 * the destructive thing the gate describes: DELETE, then regenerate.
 *
 * Requires DATABASE_URL.
 */

require('ts-node').register({ transpileOnly: true });

const { projectMovesets } = require('../src/lens/store');
const {
  readTurnEvents,
  readMovesetRows,
  deleteMovesetsFor,
  writeMovesetRows,
} = require('../src/lens/store/persistence');
const { db, pool, dbConfigured } = require('../src/database/db');
const { sql } = require('drizzle-orm');

function parseArgs(argv) {
  const args = { game: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--game') args.game = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else {
      console.error(`lens-rebuild: unknown argument "${argv[i]}"`);
      process.exit(2);
    }
  }
  return args;
}

async function decisionsToRebuild(gameId) {
  const where = gameId ? sql` WHERE game_id = ${gameId}` : sql``;
  const result = await db.execute(
    sql`SELECT id, game_id, turn FROM decisions${where} ORDER BY game_id, turn`
  );
  return result.rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'usage: node scripts/lens-rebuild.js [--game <gameId>] [--check]\n' +
        '  --check  compare stored rows against the fold and report drift; write nothing'
    );
    return 0;
  }
  if (!dbConfigured) {
    console.error('lens-rebuild: DATABASE_URL is not set — nothing to rebuild against');
    return 1;
  }

  const decisions = await decisionsToRebuild(args.game);
  console.log(
    `[lens-rebuild] ${decisions.length} decision(s)` +
      (args.game ? ` for game ${args.game}` : '') +
      (args.check ? ' — CHECK ONLY, nothing will be written' : '')
  );

  let rebuilt = 0;
  let rows = 0;
  const drifted = [];

  for (const decision of decisions) {
    const events = await readTurnEvents(decision.game_id, Number(decision.turn));
    const folded = projectMovesets(decision.id, events);

    if (args.check) {
      const stored = await readMovesetRows(decision.id);
      // Byte comparison, ordered by the fold's own order on both sides, so a
      // difference is a difference in CONTENT and never in row order.
      const key = (r) => `${r.emissionSeq}|${r.clusterId}|${r.movesetKey}`;
      const a = JSON.stringify([...stored].sort((x, y) => key(x).localeCompare(key(y))));
      const b = JSON.stringify([...folded].sort((x, y) => key(x).localeCompare(key(y))));
      if (a !== b) {
        drifted.push({ id: decision.id, stored: stored.length, folded: folded.length });
      }
      rows += folded.length;
      continue;
    }

    // The destructive path, in the order the gate names: DELETE, then
    // regenerate from `turn_events`. Delete-then-insert is the only write path
    // the projection has, so there is exactly one way for a row to exist.
    await deleteMovesetsFor(decision.id);
    await writeMovesetRows(folded);
    rebuilt += 1;
    rows += folded.length;
  }

  if (args.check) {
    if (drifted.length === 0) {
      console.log(`[lens-rebuild] no drift: ${rows} row(s) fold exactly to what is stored`);
      return 0;
    }
    console.error(`[lens-rebuild] DRIFT in ${drifted.length} decision(s):`);
    for (const d of drifted) {
      console.error(`  ${d.id}: ${d.stored} stored row(s), ${d.folded} folded`);
    }
    // A non-zero exit so the check is usable as a gate rather than as a log.
    return 1;
  }

  console.log(`[lens-rebuild] rebuilt ${rebuilt} decision(s), ${rows} row(s)`);
  return 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error('[lens-rebuild] failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
