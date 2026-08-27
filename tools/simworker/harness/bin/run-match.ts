/**
 * ONE MATCH from the command line — for probing a config before sweeping it.
 *
 *   node build/bin/run-match.js --preset mix23 --bots a,b,c [--seed 1]
 *                               [--cap 60] [--budget 150] [--sweep adhoc]
 *                               [--set food.spawnRate=1.5 --set size=19]
 *
 * `--set` takes dotted paths into the config, so a one-off probe does not need
 * a spec file. Values parse as JSON when they can and stay strings otherwise.
 * `--config <file.json>` uses a literal config object instead of a preset.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BOT_NAMES, isBotName, type BotName } from '../lib/bots';
import { normalizeConfig, type MatchConfigInput } from '../lib/config';
import { describeConfig, runMatch } from '../lib/match';
import { preset, PRESET_NAMES } from '../lib/presets';
import { shutdownDecisionPool } from '../lib/bots';
import { resolveOutRoot } from '../lib/outdir';

const REPLAY_ROOT = resolveOutRoot();

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : dflt;
}

/** Every `--set a.b=c`, applied in order. */
function applySets(target: Record<string, unknown>): void {
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== '--set') continue;
    const pair = process.argv[i + 1];
    if (pair === undefined) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) throw new Error(`--set needs path=value, got "${pair}"`);
    const dotted = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      /* a bare string is fine */
    }
    const parts = dotted.split('.');
    let node = target;
    for (const p of parts.slice(0, -1)) {
      if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
      node = node[p] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = value;
  }
}

async function main(): Promise<void> {
  const botsArg = arg('bots', '');
  if (botsArg === '') throw new Error(`--bots is required; known: ${BOT_NAMES.join(', ')}`);
  const bots = botsArg.split(',');
  for (const b of bots) if (!isBotName(b)) throw new Error(`unknown bot "${b}"; known: ${BOT_NAMES.join(', ')}`);

  const configFile = arg('config', '');
  const presetName = arg('preset', 'mix23');
  const base: Record<string, unknown> =
    configFile !== ''
      ? (JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown>)
      : ({ ...preset(presetName) } as unknown as Record<string, unknown>);
  if (configFile === '' && !PRESET_NAMES.includes(presetName)) {
    throw new Error(`unknown preset "${presetName}"; known: ${PRESET_NAMES.join(', ')}`);
  }

  base.seed = Number(arg('seed', String(base.seed ?? 1)));
  base.turnCap = Number(arg('cap', String(base.turnCap ?? 60)));
  base.budgetMs = Number(arg('budget', String(base.budgetMs ?? 150)));
  applySets(base);

  const config = normalizeConfig(base as unknown as MatchConfigInput);
  const desc = describeConfig(config);
  const sweepId = arg('sweep', 'adhoc');
  const gameId = arg('game', `${config.name ?? 'match'}-s${config.seed}-${Date.now()}`);
  const replayDir = path.join(REPLAY_ROOT, sweepId);

  console.log(`# ${config.size}x${config.size} ${config.teams.length} teams  seed=${config.seed} ` +
    `budget=${config.budgetMs}ms cap=${config.turnCap}`);
  console.log(`# seats: ${config.teams.map((t, i) => `${i}=${t}:${bots[i]}`).join('  ')}`);
  console.log(`# hazards=${config.hazards.layout}@${desc.hazardDamage} fertile=${config.fertile.enabled} ` +
    `potions=${config.potions.enabled} food=${config.food.initial}+${config.food.spawnRate}/t`);
  for (const [kind, r] of Object.entries(desc.hazardRegimes)) {
    console.log(`#   hazard vs ${kind}: ${r.regime} (${r.doses} doses of ${r.damage} against ${r.maxHealth} hp)`);
  }

  const started = Date.now();
  const outcome = await runMatch({
    config,
    bots: bots as ReadonlyArray<BotName>,
    sweepId,
    gameId,
    replayDir,
  });

  console.log('');
  console.log(`## ${outcome.turns} turns in ${((Date.now() - started) / 1000).toFixed(1)}s — ${outcome.reason}`);
  for (const p of [...outcome.placements].sort((a, b) => a.place - b.place)) {
    console.log(
      `   ${p.place}. ${p.bot.padEnd(20)} team=${p.teamID.padEnd(6)} score=${p.score.toFixed(2)} ` +
        `units=${p.finalUnits} material=${p.finalMaterial}`
    );
  }
  console.log('');
  for (const s of outcome.seats) {
    const c = outcome.counters[s.teamID]!;
    console.log(
      `   ${s.teamID.padEnd(6)} ${s.bot.padEnd(20)} decisions=${c.decisions} emits=${c.emissions} ` +
        `illegal=${c.illegal} unstaged=${c.unstaged} stagedNothing=${c.stagedNothing} ` +
        `overruns=${c.overruns}(worst ${c.worstOverrunMs}ms) plans=${c.plansEvaluated} ` +
        `assumptions=${c.assumptions} threw=${c.errors.length}`
    );
  }
  console.log('');
  console.log(`# held at widest: ${outcome.worstHeldObserved} / MAX_FROZEN ${outcome.maxFrozenCapacity}`);
  console.log(`# replay: ${outcome.replayPath}`);
  shutdownDecisionPool();
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(String((err as Error)?.stack ?? err));
    process.exit(1);
  }
);
