/**
 * Replay inspection — what a miner sees, on the command line.
 *
 *   node build/bin/read-replay.js <replay.jsonl.gz> [--turns] [--events]
 *                                 [--telemetry] [--config] [--turn N]
 *
 * With no flags it prints the header summary and the result. The flags add
 * per-turn detail. This is a debugging aid; stage-2 mining should import
 * `loadReplay` / `iterateTurns` from `lib/replay` directly.
 */

import { decodeBound } from '../lib/bots';
import { iterateRows, loadReplay } from '../lib/replay';

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : dflt;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const file = process.argv[2];
  if (file === undefined || file.startsWith('--')) {
    throw new Error('usage: read-replay.js <replay.jsonl.gz> [--turns] [--events] [--telemetry] [--config] [--turn N]');
  }

  const rep = await loadReplay(file);
  const h = rep.header;
  const c = h.config;
  console.log(`# ${h.gameId}  (sweep ${h.sweepId})`);
  console.log(`# ${c.size}x${c.size}  ${c.teams.length} teams  budget=${c.budgetMs}ms  cap=${c.turnCap}  seed=${c.seed}`);
  console.log(`# configHash=${h.configHash} boardHash=${h.boardHash} format=v${h.version} node=${h.node}`);
  console.log(`# seats: ${h.seats.map((s) => `${s.seat}=${s.teamID}:${s.bot}`).join('  ')}`);
  console.log(`# turns recorded: ${rep.turns.length}`);

  if (flag('config')) {
    console.log('');
    console.log(JSON.stringify(c, null, 1));
  }

  if (rep.result !== null) {
    const r = rep.result;
    console.log('');
    console.log(`## result: ${r.reason}`);
    for (const p of [...r.placements].sort((a, b) => a.place - b.place)) {
      console.log(
        `   ${p.place}. ${p.bot.padEnd(20)} team=${p.teamID.padEnd(6)} seat=${p.seat} ` +
          `score=${p.score.toFixed(2)} units=${p.finalUnits} material=${p.finalMaterial} ` +
          `${p.eliminatedOnTurn === null ? 'survived' : `eliminated turn ${p.eliminatedOnTurn}`}`
      );
    }
    if (r.errors.length > 0) console.log(`   ${r.errors.length} decisions threw`);
    console.log('   material trajectory:');
    for (const [team, traj] of Object.entries(r.materialTrajectory)) {
      console.log(`     ${team.padEnd(6)} ${traj.join(' ')}`);
    }
  } else {
    console.log('## NO RESULT ROW — this game crashed mid-match');
  }

  const only = arg('turn', '');
  const wantTurns = flag('turns') || flag('events') || flag('telemetry') || only !== '';

  if (wantTurns) {
    console.log('');
    for (const t of rep.turns) {
      if (only !== '' && String(t.turn) !== only) continue;
      const units = (t.board.snakes ?? []).length;
      console.log(
        `-- turn ${t.turn}  units=${units} food=${(t.board.food ?? []).length} ` +
          `potions=${(t.board.invulnerabilityPotions ?? []).length} ` +
          `standings=${t.standings.map((s) => `${s.teamID}:${s.material}`).join(' ')}`
      );
      if (flag('events')) {
        for (const [id, d] of Object.entries(t.events.deaths)) {
          console.log(`     DEATH ${id} ${d.cause} at (${d.cell.x},${d.cell.y})`);
        }
        for (const cl of t.events.clashes) {
          console.log(
            `     CLASH ${cl.kind} at (${cl.cell.x},${cl.cell.y}) players=${cl.playerIDs.join(',')} victims=${cl.victimIDs.join(',')}`
          );
        }
        for (const [id, cells] of Object.entries(t.events.severedCells)) {
          console.log(`     SEVER ${id} lost ${cells.length} cells`);
        }
        if (t.events.promotions.length > 0) console.log(`     PROMOTED ${t.events.promotions.join(',')}`);
        if (t.events.eliminatedTeamIDs.length > 0) {
          console.log(`     REGICIDE teams ${t.events.eliminatedTeamIDs.join(',')}`);
        }
        for (const p of t.world.potionsCollected) {
          console.log(`     POTION ${p.unitID} at (${p.cell.x},${p.cell.y})`);
        }
      }
      if (flag('telemetry')) {
        for (const [team, tel] of Object.entries(t.telemetry)) {
          const ch = tel.chosen;
          console.log(
            `     ${team.padEnd(6)} ${tel.bot.padEnd(20)} wall=${tel.wallMs}ms over=${tel.overrunMs}ms ` +
              `emits=${tel.emissions} plans=${tel.plansEvaluated ?? '-'} slices=${tel.slices ?? '-'} ` +
              (ch === null
                ? ''
                : `bound=[${fmtBound(ch.lo)}, ${fmtBound(ch.hi)}] est=${fmtBound(ch.est)} posture=${ch.posture}`)
          );
        }
      }
      if (flag('turns')) {
        const staged = Object.entries(t.staged)
          .map(([id, s]) => `${id}${s.spoken ? '' : '(unbotted)'}=${s.move === '' ? '-' : s.move}`)
          .join(' ');
        console.log(`     staged: ${staged}`);
      }
    }
  }

  // Row count sanity, streamed rather than from the loaded copy.
  let rows = 0;
  for await (const _r of iterateRows(file)) rows += 1;
  console.log('');
  console.log(`# ${rows} rows total (1 header + ${rep.turns.length} turns + ${rep.result === null ? 0 : 1} result)`);
}

function fmtBound(b: number | string): string {
  const n = decodeBound(b as never);
  if (n === Number.POSITIVE_INFINITY) return 'WIN';
  if (n === Number.NEGATIVE_INFINITY) return 'DEAD';
  return n.toFixed(2);
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(String((err as Error)?.stack ?? err));
    process.exit(1);
  }
);
