#!/usr/bin/env node
/**
 * THE O1 INSTRUMENTATION RUN — 05-BUILD-ORDER §(d) gate 9.
 *
 * Four of `04-SYNTHESIS.md` §3's five "MEASURED" answers are estimates until
 * something counts them, and 05 says one run settles them together because
 * they are all counts of the same objects:
 *
 *   O1     emissions / clusters / projections / events per turn
 *   Q5     emission cadence — tens or thousands? (the lane's decimation gate)
 *   §3.3 3 are `LENS_TOPK = 5` and `LENS_ROW_CAP = 24` right? — the coverage
 *          curve `planDistance(staged, nearest retained row)`
 *   §3.3 6 `promote` hits vs epoch changes, before [CHANGE 2] is defended
 *
 * The fifth (Q8, the widen-banner-to-accept latency) is not measurable here at
 * all: it is a distribution over HUMAN reaction times and it needs operator
 * sessions, not a bot playing itself.
 *
 * THE RUN IS THE SHIPPED ONE. `local-game.ts --nodes` plays the game, and the
 * lens rides on `KernelInput.lens` through the same sink production uses —
 * `ingestLensEvents` through a `SeqWriter`, one writer per (game, turn), with
 * the substrate-to-wire translation and the `movesets` projection. Measuring a
 * second assembly would report the second assembly's numbers.
 *
 * BYTES ARE THE STORED FORM. `encodeEventRow` then `JSON.stringify`, which is
 * what `turn_events.payload` holds. Anything else would be measuring the
 * process's heap.
 *
 * USAGE
 *   node scripts/lens-measure.js                          mixed + snakes, 20 turns
 *   node scripts/lens-measure.js --turns 30 --nodes 550
 *   node scripts/lens-measure.js --persist --game g1      also write the rows
 *
 * `--persist` writes one scenario's rows to `DATABASE_URL` so that
 * `npm run lens:rebuild` and `npm run lens:check` (gate 8) have a real
 * recorded session to run against.
 */

'use strict';

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });

const { runGame, SCENARIOS, DEFAULT_NODE_BUDGET } = require('../src/tests/local-game');
const { clearGeometryCache } = require('../src/lobster/substrate');
const {
  encodeEventRow,
  ingestLensEvents,
  makeSeqWriter,
  projectMovesets,
} = require('../src/lens/store');

function parseArgs(argv) {
  const args = {
    scenarios: ['mixed', 'snakes'],
    turns: 20,
    nodes: DEFAULT_NODE_BUDGET,
    seed: 1,
    persist: false,
    game: 'lens-o1',
    json: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--persist') args.persist = true;
    else if (arg === '--scenarios') args.scenarios = argv[++i].split(',');
    else if (arg === '--turns') args.turns = Number(argv[++i]);
    else if (arg === '--nodes') args.nodes = Number(argv[++i]);
    else if (arg === '--seed') args.seed = Number(argv[++i]);
    else if (arg === '--game') args.game = argv[++i];
    else if (arg === '--json') args.json = argv[++i];
    else {
      console.error(`lens-measure: unknown argument "${arg}"`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------- statistics

/** A distribution, reported the way a decision about a constant needs it: the
 *  tail is what a cap has to survive, so the maximum is never averaged away. */
function stats(values) {
  if (values.length === 0) return { n: 0, mean: 0, p50: 0, p90: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: Math.round((sum / sorted.length) * 100) / 100,
    p50: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1],
  };
}

/**
 * `planDistance` — the number of units on which two assignments disagree
 * (02 §5, Finding D-1). The coverage curve is this, from the staged plan to
 * the NEAREST retained row: 0 means the reservoir held exactly what was
 * staged, and a distance equal to the cluster's size means it held nothing
 * about it at all.
 *
 * OVER THE ROW'S OWN UNITS, and not over the whole plan. A retained row is a
 * CLUSTER RESTRICTION — an assignment to the members of one component — and
 * the staged plan is the whole team's. Counting the units the row does not
 * mention would make every row on a 3-cluster board at least distance 2 from
 * everything, which measures the partition rather than the reservoir.
 */
function planDistance(staged, row) {
  const want = new Map(staged.map((m) => [m.unit, m.to]));
  let differ = 0;
  for (const move of row) {
    if (want.get(move.unit) !== move.to) differ++;
  }
  return differ;
}

// ------------------------------------------------------------------ the run

async function measureScenario(name, args) {
  const spec = SCENARIOS[name];
  if (spec === undefined) throw new Error(`unknown scenario ${name}`);

  /** One record per (turn, team) decision, pushed the moment the lens opens on
   *  it and mutated by its own sink. */
  const perDecision = [];
  /** Every writer, so `--persist` can hand the rows over afterwards. */
  const writers = [];

  await runGame(
    { ...spec, maxTurns: args.turns, seed: args.seed, nodeBudget: args.nodes },
    {
      scores: false,
      lensFor: (turn, teamId) => {
        // ONE WRITER PER (gameId, turn), exactly as the manager assigns them.
        // The team rides in the game id because two teams decide on one board
        // turn here and each is its own decision.
        const gameId = `${args.game}:${name}:${teamId}`;
        const writer = makeSeqWriter(gameId, turn);
        writers.push({ gameId, turn, writer });
        let sub = null;
        const record = {
          turn,
          team: teamId,
          gameId,
          emissions: 0,
          partitions: 0,
          clusters: 0,
          clusterSizes: [],
          movesetFrames: 0,
          rowsPerCluster: [],
          conditionals: 0,
          refusals: 0,
          epochChanges: 0,
          promoteHits: 0,
          witnessRefuters: 0,
          rowsSeen: 0,
          coverage: null,
          events: 0,
          bytes: 0,
          projectionRows: 0,
        };
        perDecision.push(record);
        let lastEpoch = null;
        const contexts = new Set();
        let lastEmissionMoves = [];

        return {
          attach: (s) => {
            sub = s;
          },
          sink: (event) => {
            const written = ingestLensEvents(writer, [event], {
              t0AtWall: 0,
              unitKeyOf: (unitId) => {
                const unit = sub === null ? undefined : sub.unitOf(unitId);
                return unit === undefined ? null : unit.wireId;
              },
            });
            for (const row of written) {
              record.events++;
              // BYTES ARE THE STORED FORM: the row as `turn_events` holds it.
              record.bytes += Buffer.byteLength(JSON.stringify(encodeEventRow(row)), 'utf8');
            }

            if (event.kind === 'partition') {
              record.partitions++;
              record.clusters = Math.max(record.clusters, event.clusters.length);
              for (const cluster of event.clusters) record.clusterSizes.push(cluster.members.length);
              if (lastEpoch !== null && event.epoch !== lastEpoch) record.epochChanges++;
              lastEpoch = event.epoch;
            } else if (event.kind === 'emission') {
              record.emissions++;
              const payload = written[0] === undefined ? null : written[0].payload;
              lastEmissionMoves = payload && payload.moves ? payload.moves : [];
              if (lastEpoch !== null && event.record.epoch !== lastEpoch) record.epochChanges++;
              lastEpoch = event.record.epoch;
            } else if (event.kind === 'movesets') {
              record.movesetFrames++;
              record.rowsPerCluster.push(event.rows.length);
              record.rowsSeen += event.rows.length;
              for (const row of event.rows) {
                if (row.dominance && row.dominance.kind === 'refuted-by-witness') {
                  record.witnessRefuters++;
                }
                if (lastEmissionMoves.length > 0) {
                  const d = planDistance(lastEmissionMoves, row.moves);
                  record.coverage = record.coverage === null ? d : Math.min(record.coverage, d);
                }
              }
              record.projectionRows = projectMovesets(gameId, writer.written).length;
            } else if (event.kind === 'conditional') {
              record.conditionals++;
              // [CHANGE 2]'s counter: a context key seen before is a PROMOTE
              // rather than a fresh speculative entry.
              const key = event.ranking.contextKey;
              if (contexts.has(key)) record.promoteHits++;
              contexts.add(key);
            } else if (event.kind === 'refusal') {
              record.refusals++;
            }
          },
        };
      },
    }
  );

  clearGeometryCache();

  /** Per BOARD turn, summed over the teams that decided in it. */
  const perTurn = new Map();
  for (const d of perDecision) {
    const held = perTurn.get(d.turn) ?? { events: 0, bytes: 0, emissions: 0 };
    held.events += d.events;
    held.bytes += d.bytes;
    held.emissions += d.emissions;
    perTurn.set(d.turn, held);
  }
  return { name, perDecision, perTurn, writers };
}

/**
 * THE RECORDED SESSION, in Postgres — what gate 8 runs against.
 *
 * `decisions` and `turn_events` are written from what the writer stamped, and
 * `movesets` from the SAME `projectMovesets` fold the live writer queues, so
 * `lens:check` compares the stored projection against a re-fold of the stored
 * events rather than against a second copy of the projection logic.
 */
async function persist(recorded, args) {
  const {
    writeEventRows,
    writeDecision,
    writeMovesetRows,
    deleteMovesetsFor,
  } = require('../src/lens/store/persistence');
  const { pool, dbConfigured } = require('../src/database/db');
  if (!dbConfigured) {
    console.error('lens-measure: --persist needs DATABASE_URL');
    process.exit(1);
  }
  let events = 0;
  let rows = 0;
  for (const scenario of recorded) {
    for (const { gameId, turn, writer } of scenario.writers) {
      if (writer.written.length === 0) continue;
      const id = `${gameId}:${turn}`;
      await writeDecision({
        id,
        gameId,
        turn,
        botId: `bot:${args.game}`,
        behaviourId: `behaviour:${args.game}`,
        engine: 'lobster',
        profile: 'territory',
        input: {
          boardHash: '',
          asTeam: 0,
          seed: args.seed,
          assumptions: [],
          initialPins: [],
          modelled: [],
          botId: `bot:${args.game}`,
          behaviourId: `behaviour:${args.game}`,
          nodeBudget: args.nodes,
          liveBudgetMs: 0,
          kernelOptions: {},
        },
        summary: { emissions: writer.written.length },
        startedAt: 0,
        endedAt: 0,
      });
      await writeEventRows(writer.written.map(encodeEventRow));
      const projected = projectMovesets(id, writer.written);
      await deleteMovesetsFor(id);
      await writeMovesetRows(projected);
      events += writer.written.length;
      rows += projected.length;
    }
  }
  process.stderr.write(`[lens-measure] persisted ${events} event row(s), ${rows} projection row(s)\n`);
  await pool.end();
}

/** The report, per scenario. */
function report(name, decisions, turns) {
  const emissions = decisions.map((d) => d.emissions);
  const clusters = decisions.map((d) => d.clusters);
  const clusterSizes = decisions.flatMap((d) => d.clusterSizes);
  const rowsPerCluster = decisions.flatMap((d) => d.rowsPerCluster);
  const eventsPerTurn = [...turns.values()].map((t) => t.events);
  const bytesPerTurn = [...turns.values()].map((t) => t.bytes);
  const emissionsPerTurn = [...turns.values()].map((t) => t.emissions);
  const coverage = decisions.map((d) => d.coverage).filter((d) => d !== null);
  const projections = decisions.map((d) => d.projectionRows);
  return {
    scenario: name,
    decisions: decisions.length,
    turns: turns.size,
    emissionsPerDecision: stats(emissions),
    emissionsPerTurn: stats(emissionsPerTurn),
    clustersPerDecision: stats(clusters),
    clusterSize: stats(clusterSizes),
    movesetsPerCluster: stats(rowsPerCluster),
    projectionRowsPerDecision: stats(projections),
    eventsPerTurn: stats(eventsPerTurn),
    bytesPerTurn: stats(bytesPerTurn),
    coverageDistance: stats(coverage),
    coverageAtZero: coverage.filter((d) => d === 0).length,
    epochChanges: decisions.reduce((a, d) => a + d.epochChanges, 0),
    promoteHits: decisions.reduce((a, d) => a + d.promoteHits, 0),
    conditionals: decisions.reduce((a, d) => a + d.conditionals, 0),
    refusals: decisions.reduce((a, d) => a + d.refusals, 0),
    rowsSeen: decisions.reduce((a, d) => a + d.rowsSeen, 0),
    witnessRefuters: decisions.reduce((a, d) => a + d.witnessRefuters, 0),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reports = [];
  const recorded = [];
  for (const name of args.scenarios) {
    process.stderr.write(`[lens-measure] ${name}: ${args.turns} turns at ${args.nodes} nodes\n`);
    const measured = await measureScenario(name, args);
    reports.push(report(name, measured.perDecision, measured.perTurn));
    recorded.push(measured);
  }
  if (args.persist) await persist(recorded, args);
  const out = JSON.stringify(reports, null, 2);
  if (args.json) {
    require('fs').writeFileSync(args.json, out + '\n');
    process.stderr.write(`[lens-measure] wrote ${args.json}\n`);
  } else {
    process.stdout.write(out + '\n');
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[lens-measure] failed:', err);
    process.exit(1);
  });
