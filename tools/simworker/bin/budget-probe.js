#!/usr/bin/env node
/**
 * BUDGET-SENSITIVITY PROBE — does more thinking time change the DECISION?
 *
 * METHODOLOGY §6 pattern (measure without a race), applied to the budget
 * axis: sample recorded positions from a batch's replays, re-run the same
 * bot's decision on the same board at two budgets, and count how often the
 * staged move-set actually differs. Score deltas that never move an argmax
 * are not observable in play; this asks the observable question directly.
 *
 * CONTROL: anytime search under wall clock is nondeterministic, so every
 * position also runs an A/A pair (same budget twice). The 1s-vs-2s flip rate
 * is readable only against that same-budget flip rate — flip(B1,A) vs
 * flip(A,A2). Positions are the unit; the box must be otherwise idle.
 *
 *   node budget-probe.js --bundle <dir> --batch <dir> --arm <name>
 *        [--bot lobster-territory] [--n 60] [--budgets 1000,2000]
 *        [--sample-seed 1] [--out <file.json>]
 */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const BUNDLE = path.resolve(arg('bundle', ''));
const BATCH = path.resolve(arg('batch', ''));
const ARM = arg('arm', 'integrated');
const BOT = arg('bot', 'lobster-territory');
const N = Number(arg('n', '60'));
const [LO, HI] = arg('budgets', '1000,2000').split(',').map(Number);
const SAMPLE_SEED = Number(arg('sample-seed', '1'));
const OUT = arg('out', '');
if (!BUNDLE || !BATCH) { console.error('need --bundle and --bundle/--batch'); process.exit(1); }

const { loadReplay } = require(path.join(BUNDLE, 'harness/build/lib/replay.js'));
const { makeBot, shutdownDecisionPool } = require(path.join(BUNDLE, 'harness/build/lib/bots.js'));

// Deterministic LCG so the sample is reproducible and re-runs extend it.
let rng = SAMPLE_SEED >>> 0;
const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function teamUnits(board, teamID) {
  return (board.snakes ?? []).filter((s) => s.teamID === teamID && s.health > 0 && s.body.length > 0);
}
function movesKey(map, unitIds) {
  const ids = [...unitIds].sort();
  return ids.map((id) => `${id}=${JSON.stringify(map.get(id) ?? null)}`).join('|');
}

async function main() {
  // ---- collect candidate positions from every replay of the chosen arm ----
  const armDir = path.join(BATCH, 'arms', ARM);
  const files = [];
  for (const sweep of fs.readdirSync(armDir)) {
    const d = path.join(armDir, sweep);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl.gz')) files.push(path.join(d, f));
  }
  if (files.length === 0) { console.error('no replays under ' + armDir); process.exit(1); }
  console.log(`# ${files.length} replays under ${ARM}; sampling ${N} positions (seed ${SAMPLE_SEED})`);

  // Sample games first, then a turn+team inside each, so long games do not
  // dominate the sample and each position costs one replay load.
  // A TeamDecisionEngine carries per-game ledger state (see runner.ts: "bots
  // are rebuilt per game"), so reusing one bot across positions from different
  // games corrupts decisions — v1 of this probe did exactly that and returned
  // instant degenerate results. Fresh bot per position, released after.
  const rows = [];
  let flipsLoHi = 0, flipsAA = 0, done = 0, skipped = 0;
  const t0 = Date.now();
  while (done < N && rows.length + skipped < N * 6) {
    const file = files[Math.floor(rand() * files.length)];
    let rep;
    try { rep = await loadReplay(file); } catch { skipped++; continue; }
    if (rep.turns.length < 2) { skipped++; continue; }
    const turnRow = rep.turns[Math.floor(rand() * rep.turns.length)];
    const seatIdx = Math.floor(rand() * rep.header.seats.length);
    const seat = rep.header.seats[seatIdx];
    const units = teamUnits(turnRow.board, seat.teamID);
    if (units.length === 0) { skipped++; continue; }
    const bot = makeBot(BOT);
    const spoken = bot.speaksFor(turnRow.board, seat.teamID);
    if (spoken.length === 0) { skipped++; bot.release(); continue; }
    const seed = rep.header.config.seed;

    // three decisions: HI (A), HI again (A2), LO (B) — interleaved order
    // varies per position so slow-machine drift cannot masquerade as budget.
    const order = rand() < 0.5 ? ['A', 'A2', 'B'] : ['B', 'A', 'A2'];
    const got = {};
    for (const which of order) {
      const budget = which === 'B' ? LO : HI;
      const out = await bot.decide(turnRow.board, turnRow.turn, seat.teamID, Date.now() + budget, seed);
      got[which] = movesKey(out.moves, spoken);
      if (out.telemetry.error) { console.log('#   decide error at ' + rep.header.gameId + ' t' + turnRow.turn + ': ' + out.telemetry.error); }
    }
    bot.release();
    const flipAA = got.A !== got.A2;
    const flipLoHi = got.B !== got.A;
    flipsAA += flipAA ? 1 : 0;
    flipsLoHi += flipLoHi ? 1 : 0;
    done++;
    rows.push({
      game: rep.header.gameId, sweep: rep.header.sweepId, turn: turnRow.turn,
      team: seat.teamID, bot: seat.bot, units: spoken.length, flipLoHi, flipAA,
    });
    if (done % 10 === 0) console.log(`#   ${done}/${N}  flips ${LO}v${HI}: ${flipsLoHi}  A/A@${HI}: ${flipsAA}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  shutdownDecisionPool();

  const p = flipsLoHi / done, q = flipsAA / done;
  const se = (x) => Math.sqrt((x * (1 - x)) / done);
  console.log('');
  console.log(`RESULT positions=${done} (skipped ${skipped})`);
  console.log(`  flip(${LO}ms vs ${HI}ms): ${flipsLoHi}/${done} = ${(100 * p).toFixed(1)}% ± ${(100 * 1.96 * se(p)).toFixed(1)}%`);
  console.log(`  flip(${HI}ms vs ${HI}ms): ${flipsAA}/${done} = ${(100 * q).toFixed(1)}% ± ${(100 * 1.96 * se(q)).toFixed(1)}%  <- same-budget noise floor`);
  console.log(`  excess flips attributable to budget: ${(100 * (p - q)).toFixed(1)} percentage points`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ bundle: BUNDLE, arm: ARM, bot: BOT, n: done, skipped, budgets: [LO, HI], sampleSeed: SAMPLE_SEED, flipsLoHi, flipsAA, rows }, null, 1) + '\n');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
