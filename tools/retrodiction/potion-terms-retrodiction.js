#!/usr/bin/env node
'use strict';
/*
 * MECHANISM RETRODICTION FOR `potionSeek` AND `potionControl` — no games, only
 * replays.
 *
 *   node tools/retrodiction/potion-terms-retrodiction.js \
 *        --replays <dir of *.jsonl.gz> --out <report.json> [--every 4]
 *
 * ── WHAT THIS IS AND IS NOT ────────────────────────────────────────────────
 *
 * DESIGN EVIDENCE, not a promotion measurement. Nothing was played, no arm was
 * run, nothing is written to the learning loop or the promotion ledger. It asks
 * two questions of games we already hold:
 *
 *   (a) TIMING. Of the severs that actually happened, how many were preceded by
 *       a potion collection that `potionSeek` would have recommended at the turn
 *       the collection was decided — and how many collections it would have
 *       recommended never happened at all?
 *   (b) CONTROL. Does `potionControl` read at mid-game predict end-game weight
 *       share?
 *
 * A term that fails (a) is mis-signed. A term that passes (a) and fails (b) is
 * a tactical read with no positional content, which is a finding and not a
 * failure. Neither can promote anything.
 *
 * ── THE POPULATION, AND WHY IT IS SMALL ────────────────────────────────────
 *
 * Only potions-on games are in scope, and there is no choice about it: a body
 * cut requires a strictly higher tier and tier comes only from a potion, so
 * outside the potions-on cells the whole mechanism is absent by rule. The
 * report states the potions-off denominator anyway, so the restriction is
 * visible rather than assumed.
 *
 * ── WHERE REACH COMES FROM ─────────────────────────────────────────────────
 *
 * The same arrival machinery the evaluator uses: `CloudSource` dilates each
 * unit's shells and `earliestShells` stamps `earliest[c]` off them — the exact
 * loop `CloudTimeline.arrival()` runs, minus the Dijkstra nobody reads. The
 * miner builds no reach of its own, so a term that passes here passes on the
 * numbers the live evaluator would have seen.
 *
 * DETERMINISM. No clock is read into any number. The `--every` sample is every
 * Nth turn row in sorted file order, so a re-run on the same corpus reproduces
 * the report exactly.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs' },
});

// src/partial-engine/ is vendored from an ESM package, so its internal imports
// carry the ".js" extension ESM requires. Node's CommonJS resolver does not
// take that shape; this is the same accommodation jest.config.js makes in
// `moduleNameMapper`, for the same reason (the vendored copies stay
// byte-identical to upstream and the drift diff stays clean).
{
  const Module = require('module');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function patched(request, ...rest) {
    if (/^\.{1,2}\//.test(request) && request.endsWith('.js')) {
      try {
        return resolve.call(this, request, ...rest);
      } catch {
        return resolve.call(this, request.slice(0, -3), ...rest);
      }
    }
    return resolve.call(this, request, ...rest);
  };
}

const {
  CloudSource,
  UnitKind,
  bbSet,
  makeGrid,
  makeTerrain,
  orientationOf,
} = require('../../src/partial-engine/index');
const { kindOfWireType } = require('../../src/partial-engine/wire-adapter');
const { earliestShells } = require('../../src/lobster/evaluate/shells');
const { reachFromEarliest } = require('../../src/lobster/evaluate/attack-window');
const {
  bestPotionSeek,
  potionSeek,
  potionSeekNet,
  potionSeekRecommends,
} = require('../../src/lobster/evaluate/potion-seek');
const { potionControlSummary } = require('../../src/lobster/evaluate/potion-control');
const { severExchangeRate } = require('../../src/lobster/evaluate/slider-attack-vector');

/** The potion effect's own length. `TeamSnekProcessor.ts:602`. */
const WINDOW = 3;
const OURS = (bot) => typeof bot === 'string' && bot.startsWith('lobster');

function args() {
  const out = { every: 4 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--replays') out.replays = a[++i];
    else if (a[i] === '--out') out.out = a[++i];
    else if (a[i] === '--every') out.every = Number(a[++i]);
    else if (a[i] === '--limit') out.limit = Number(a[++i]);
  }
  if (!out.replays) throw new Error('--replays <dir> is required');
  return out;
}

function walkReplays(dir) {
  const found = [];
  const stack = [dir];
  while (stack.length > 0) {
    const here = stack.pop();
    for (const e of fs.readdirSync(here, { withFileTypes: true })) {
      const full = path.join(here, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.endsWith('.jsonl.gz')) found.push(full);
    }
  }
  return found.sort();
}

function readReplay(file) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  const out = { header: null, result: null, turns: [] };
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const row = JSON.parse(line);
    if (row.kind === 'header') out.header = row;
    else if (row.kind === 'turn') out.turns.push(row);
    else if (row.kind === 'result') out.result = row;
  }
  return out;
}

// ── the wire's own index convention ─────────────────────────────────────────
// The wire's y grows DOWNWARD and the api board's grows up, so
// full = (apiHeight - y) * (apiWidth + 2) + (x + 1) — the same mapping
// slider-attack-retrodiction.js verified against replays in which a piece
// stayed and its staged number equalled its own square.
const toFull = (x, y, w, h) => (h - y) * (w + 2) + (x + 1);

/** The replay's api board plus its resolved tiers, as the terms read it. */
function toRayBoard(row) {
  const b = row.board;
  const w = b.width;
  const h = b.height;
  const units = [];
  const byId = new Map();
  for (const s of b.snakes || []) {
    if (s.health <= 0 || !s.body || s.body.length === 0) continue;
    const kind = kindOfWireType(s.unitType || 'snake');
    const trail = kind === UnitKind.Snake;
    const occupancy = trail
      ? s.body.map((c) => toFull(c.x, c.y, w, h))
      : [toFull(s.head.x, s.head.y, w, h)];
    const expiry = s.invulnerabilityExpiryTurn;
    const unit = {
      unitId: s.id,
      team: s.teamID,
      kind,
      occupancy,
      weight: trail ? s.body.length : Math.max(1, s.length),
      tier: row.tiers?.[s.id] ?? 0,
      tierExpiresAtTurn: Number.isFinite(expiry) ? expiry : null,
      health: s.health,
      orientation: orientationOf(s.orientation?.dx ?? 0, s.orientation?.dy ?? -1),
    };
    units.push(unit);
    byId.set(s.id, unit);
  }
  const potions = (b.invulnerabilityPotions || []).map((c) => toFull(c.x, c.y, w, h));
  return {
    board: { width: w + 2, height: h + 2, units, turn: row.turn },
    byId,
    potions,
    apiWidth: w,
    apiHeight: h,
  };
}

/**
 * THE ARRIVAL MAP, BORROWED. One dilation per unit through the engine's own
 * `CloudSource`, stamped by `earliestShells` — never a fresh search.
 */
function reachFor(row, ray) {
  const b = row.board;
  const w = b.width;
  const h = b.height;
  const grid = makeGrid(w + 2, h + 2);
  const terrain = makeTerrain(
    grid,
    [],
    (b.hazards || []).map((c) => toFull(c.x, c.y, w, h))
  );
  const food = new Uint32Array(grid.words);
  for (const c of b.food || []) bbSet(food, toFull(c.x, c.y, w, h));
  const potions = new Uint32Array(grid.words);
  for (const c of b.invulnerabilityPotions || []) bbSet(potions, toFull(c.x, c.y, w, h));
  const source = new CloudSource(
    {
      terrain,
      food,
      potions,
      promotionWeight: b.pawnPromotionWeight ?? 10,
      hazardDamage: b.hazardDamage ?? 15,
      maxHealth: 100,
      maxHealthPerKind: null,
    },
    { cacheSize: 64 }
  );
  const grids = new Map();
  let n = 0;
  for (const u of ray.board.units) {
    const record = {
      unitId: n++,
      kind: u.kind,
      team: 0,
      occupancy: u.occupancy,
      heldAtTurn: row.turn,
      health: u.health,
      tier: u.tier,
      tierExpiresAtTurn: u.tierExpiresAtTurn,
      weight: u.weight,
      orientation: u.orientation,
      narrowedTo: null,
    };
    const timeline = source.timelineFor(record);
    grids.set(
      u.unitId,
      earliestShells(timeline, row.turn, row.turn + WINDOW + 1, grid)
    );
  }
  return reachFromEarliest(grids);
}

/** Sever ground truth for one turn, attributing each victim's cells once. */
function severTruth(row) {
  const out = [];
  const attributed = new Set();
  for (const clash of row.events?.clashes || []) {
    if (clash.kind !== 'sever' || !clash.survivorID) continue;
    const victims = [];
    let cells = 0;
    for (const v of clash.playerIDs) {
      if (v === clash.survivorID || attributed.has(v)) continue;
      attributed.add(v);
      victims.push(v);
      cells += (row.events.severedCells?.[v] || []).length;
    }
    out.push({ survivorID: clash.survivorID, victims, cells });
  }
  return out;
}

const blank = () => ({
  games: 0,
  turnRows: 0,
  // ── the denominator ──────────────────────────────────────────────────────
  severEvents: 0,
  severCells: 0,
  collections: 0,
  collectionsByOurs: 0,
  potionTurnsStanding: 0,
  // ── (a1) collections the term would have recommended ─────────────────────
  collectionsScored: 0,
  // Three endpoints of the same recommendation, bracketing the collector's
  // exposure: gain only, near contest, worst-case contest over the window.
  collectionsGainPositive: 0,
  collectionsRecommendedNear: 0,
  collectionsRecommended: 0,
  collectionsRecommendedWorstCase: 0,
  collectionsWithArmedAlly: 0,
  collectionsIntoLiveWindow: 0,
  collectionsContestedNear: 0,
  collectionsContestedWindow: 0,
  collectionsNetSum: 0,
  collectionsGainSum: 0,
  // The 2x2 that is the actual headline for (a): did the collection convert?
  collectionsFollowedBySever: 0,
  collectionsGainPositiveAndSevered: 0,
  collectionsGainZeroAndSevered: 0,
  collectionsRecommendedAndSevered: 0,
  // ── (a2) severs, and what enabled them ───────────────────────────────────
  seversWithPriorCollection: 0,
  seversFromOwnBuff: 0,
  seversFromVictimDebuff: 0,
  seversFromNeither: 0,
  seversRecommended: 0,
  seversRecommendedNear: 0,
  seversGainPositive: 0,
  seversNotRecommended: 0,
  seversUnscorable: 0,
  severCellsRecommended: 0,
  severCellsGainPositive: 0,
  // ── (a3) recommendations that never happened ─────────────────────────────
  sampledTurnTeams: 0,
  sampledWithPotion: 0,
  sampledRecommending: 0,
  sampledRecommendingNear: 0,
  sampledRecommendingGainOnly: 0,
  sampledFollowed: 0,
  sampledFollowedNear: 0,
  sampledFollowedGainOnly: 0,
  // ── cost ─────────────────────────────────────────────────────────────────
  seekCalls: 0,
  seekNs: 0,
  bestSeekCalls: 0,
  bestSeekNs: 0,
  controlCalls: 0,
  controlNs: 0,
});

function fold(into, from) {
  for (const k of Object.keys(from)) into[k] += from[k];
}

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * The residual of `ys` after `xs` is regressed out of it — the arithmetic that
 * turns "control correlates with the end share" into "control correlates with
 * the end share BEYOND WHAT BEING AHEAD ALREADY EXPLAINS". Without it the
 * headline is not a finding: a team that is winning has more units alive and
 * therefore more reach, so it holds more potion ground BECAUSE it is winning.
 */
function residualise(ys, xs) {
  const n = ys.length;
  if (n < 3) return ys.slice();
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  if (sxx === 0) return ys.slice();
  const b = sxy / sxx;
  return ys.map((y, i) => y - my - b * (xs[i] - mx));
}

/** Pearson correlation, and the sample size it rests on. */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return { n, r: null };
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return { n, r: null };
  return { n, r: sxy / Math.sqrt(sxx * syy) };
}

function run() {
  const opt = args();
  const files = walkReplays(opt.replays).slice(0, opt.limit ?? Infinity);
  const cells = new Map();
  const pooled = blank();
  const offCorpus = { games: 0, severEvents: 0, turnRows: 0 };
  // (b) one row per (game, team)
  const control = [];
  let rowCounter = 0;

  const cellFor = (key) => {
    let s = cells.get(key);
    if (s === undefined) {
      s = blank();
      cells.set(key, s);
    }
    return s;
  };

  for (const file of files) {
    const replay = readReplay(file);
    if (replay.header === null) continue;
    if (replay.header.config.potions?.enabled !== true) {
      offCorpus.games += 1;
      offCorpus.turnRows += replay.turns.length;
      for (const row of replay.turns) {
        for (const c of row.events?.clashes || []) {
          if (c.kind === 'sever') offCorpus.severEvents += 1;
        }
      }
      continue;
    }
    const arm = path.basename(path.dirname(path.dirname(file)));
    const key = `${arm}/${replay.header.sweepId}/${replay.header.config.name}`;
    const stats = cellFor(key);
    stats.games += 1;
    const botOf = new Map(replay.header.seats.map((s) => [s.teamID, s.bot]));
    const teams = [...botOf.keys()];

    // ── pass 1: index the turns, the collections and the severs ────────────
    const rowAt = new Map();
    for (const row of replay.turns) rowAt.set(row.turn, row);
    /** turn -> [{unitID, team, cell}] */
    const collectionsAt = new Map();
    for (const row of replay.turns) {
      const list = [];
      for (const c of row.world?.potionsCollected || []) {
        const owner = (row.board.snakes || []).find((s) => s.id === c.unitID);
        list.push({
          unitID: c.unitID,
          team: owner?.teamID ?? null,
          cell: toFull(c.cell.x, c.cell.y, row.board.width, row.board.height),
        });
      }
      if (list.length > 0) collectionsAt.set(row.turn, list);
      stats.collections += list.length;
      for (const c of list) if (OURS(botOf.get(c.team))) stats.collectionsByOurs += 1;
    }

    // ── pass 2: the per-turn work ──────────────────────────────────────────
    const midTurn = replay.turns.length === 0
      ? null
      : replay.turns[Math.floor(replay.turns.length / 2)].turn;
    const scoredCollection = new Map(); // `${turn}|${unitID}` -> {recommended, ...}

    for (const row of replay.turns) {
      stats.turnRows += 1;
      rowCounter += 1;
      const ray = toRayBoard(row);
      if (ray.potions.length > 0) stats.potionTurnsStanding += 1;

      const severs = severTruth(row);
      for (const s of severs) {
        stats.severEvents += 1;
        stats.severCells += s.cells;
      }

      const collections = collectionsAt.get(row.turn) || [];
      const needControl = row.turn === midTurn;
      const sampled = rowCounter % opt.every === 0;
      if (collections.length === 0 && !needControl && !sampled) continue;
      if (ray.board.units.length === 0) continue;

      const reach = reachFor(row, ray);

      // ── (a1) score every collection at the turn it was decided ───────────
      for (const c of collections) {
        const collector = ray.byId.get(c.unitID);
        if (collector === undefined || c.team === null) continue;
        const rate = severExchangeRate(ray.board, c.team);
        const t0 = process.hrtime.bigint();
        const v = potionSeek(ray.board, collector, c.cell, { turn: row.turn, reach });
        stats.seekNs += Number(process.hrtime.bigint() - t0);
        stats.seekCalls += 1;
        if (!v.reachable) continue;
        stats.collectionsScored += 1;
        const gainPositive = v.gain.est > 0;
        const recNear = potionSeekRecommends(v, rate, { exposure: 'near' });
        const rec = potionSeekRecommends(v, rate);
        const recWorst = potionSeekRecommends(v, rate, { worstCase: true });
        if (gainPositive) stats.collectionsGainPositive += 1;
        if (recNear) stats.collectionsRecommendedNear += 1;
        if (rec) stats.collectionsRecommended += 1;
        if (recWorst) stats.collectionsRecommendedWorstCase += 1;
        if (v.armedAllies > 0) stats.collectionsWithArmedAlly += 1;
        if (v.exposure.contestedNear) stats.collectionsContestedNear += 1;
        if (v.exposure.contested) stats.collectionsContestedWindow += 1;
        stats.collectionsNetSum += potionSeekNet(v, rate);
        stats.collectionsGainSum += v.gain.est;
        // Was a window of ours already running when this pickup was made?
        for (const u of ray.board.units) {
          if (u.team !== c.team) continue;
          const expiry = u.tierExpiresAtTurn;
          if (u.tier > 0 && (expiry === null || row.turn <= expiry)) {
            stats.collectionsIntoLiveWindow += 1;
            break;
          }
        }
        // Did this pickup CONVERT — did the team it buffed land a sever inside
        // the three turns it bought? The collection is the unit of account here
        // rather than the sever, because two severs from one window are one
        // decision and counting them twice would inflate the conversion rate.
        let converted = false;
        for (let t = row.turn + 1; t <= row.turn + WINDOW; t++) {
          const later = rowAt.get(t);
          if (later === undefined) continue;
          const laterRay = toRayBoard(later);
          for (const sv of severTruth(later)) {
            const mover = laterRay.byId.get(sv.survivorID);
            if (mover !== undefined && mover.team === c.team && sv.survivorID !== c.unitID) {
              converted = true;
            }
          }
        }
        if (converted) {
          stats.collectionsFollowedBySever += 1;
          if (gainPositive) stats.collectionsGainPositiveAndSevered += 1;
          else stats.collectionsGainZeroAndSevered += 1;
          if (rec) stats.collectionsRecommendedAndSevered += 1;
        }
        scoredCollection.set(`${row.turn}|${c.unitID}`, {
          recommended: rec,
          recommendedNear: recNear,
          gainPositive,
          team: c.team,
          gain: v.gain.est,
        });
      }

      // ── (a3) recommendations the bots did not act on ─────────────────────
      if (sampled) {
        for (const team of teams) {
          stats.sampledTurnTeams += 1;
          if (ray.potions.length === 0) continue;
          const alive = ray.board.units.some((u) => u.team === team);
          if (!alive) continue;
          stats.sampledWithPotion += 1;
          const rate = severExchangeRate(ray.board, team);
          const t0 = process.hrtime.bigint();
          const worst = bestPotionSeek(ray.board, team, ray.potions, rate, {
            turn: row.turn,
            reach,
          });
          const near = bestPotionSeek(ray.board, team, ray.potions, rate, {
            turn: row.turn,
            reach,
            exposure: 'near',
          });
          // The gain endpoint: the window is worth something to somebody,
          // before any exposure is charged. This is the "missed window" count
          // the ruling asks for, read at the endpoint that still discriminates.
          const gainOnly = bestPotionSeek(ray.board, team, ray.potions, rate, {
            turn: row.turn,
            reach,
            exposure: 'none',
          });
          stats.bestSeekNs += Number(process.hrtime.bigint() - t0);
          stats.bestSeekCalls += 3;
          const followedOf = (choice) => {
            if (choice === null) return false;
            for (let t = row.turn; t <= row.turn + choice.value.travelTurns; t++) {
              for (const c of collectionsAt.get(t) || []) {
                if (c.team === team && c.cell === choice.value.potionCell) return true;
              }
            }
            return false;
          };
          if (gainOnly !== null && gainOnly.value.gain.est > 0) {
            stats.sampledRecommendingGainOnly += 1;
            if (followedOf(gainOnly)) stats.sampledFollowedGainOnly += 1;
          }
          if (near !== null && near.net > 0) {
            stats.sampledRecommendingNear += 1;
            if (followedOf(near)) stats.sampledFollowedNear += 1;
          }
          if (worst === null || worst.net <= 0) continue;
          stats.sampledRecommending += 1;
          if (followedOf(worst)) stats.sampledFollowed += 1;
        }
      }

      // ── (b) the mid-game control reading, one row per team ───────────────
      if (needControl) {
        for (const team of teams) {
          const t0 = process.hrtime.bigint();
          const s = potionControlSummary(ray.board, team, ray.potions, {
            turn: row.turn,
            reach,
          });
          stats.controlNs += Number(process.hrtime.bigint() - t0);
          stats.controlCalls += 1;
          const place = (replay.result?.placements || []).find((p) => p.teamID === team);
          const standings = row.standings || [];
          const midTotal = standings.reduce((a, b) => a + (b.material || 0), 0);
          const mine = standings.find((x) => x.teamID === team);
          control.push({
            midMaterialShare: midTotal === 0 ? 0 : (mine?.material || 0) / midTotal,
            cell: key,
            game: path.relative(opt.replays, file),
            team,
            ours: OURS(botOf.get(team)),
            turn: row.turn,
            potionsStanding: ray.potions.length,
            balance: s.balance,
            net: s.net,
            option: s.optionTotal,
            threat: s.threatTotal,
            finalMaterial: place?.finalMaterial ?? 0,
          });
        }
      }
    }

    // ── (a2) attach each sever to what enabled it ──────────────────────────
    for (const row of replay.turns) {
      const ray = toRayBoard(row);
      for (const s of severTruth(row)) {
        const mover = ray.byId.get(s.survivorID);
        const moverTeam = mover?.team ?? null;
        let ownBuff = null;
        let victimDebuff = null;
        for (let c = row.turn - WINDOW; c <= row.turn - 1; c++) {
          for (const col of collectionsAt.get(c) || []) {
            if (moverTeam !== null && col.team === moverTeam && col.unitID !== s.survivorID) {
              ownBuff = { turn: c, unitID: col.unitID };
            }
            if (s.victims.includes(col.unitID)) {
              victimDebuff = { turn: c, unitID: col.unitID };
            }
          }
        }
        if (ownBuff !== null) stats.seversFromOwnBuff += 1;
        if (victimDebuff !== null) stats.seversFromVictimDebuff += 1;
        if (ownBuff === null && victimDebuff === null) stats.seversFromNeither += 1;
        if (ownBuff === null) continue;
        stats.seversWithPriorCollection += 1;
        const scored = scoredCollection.get(`${ownBuff.turn}|${ownBuff.unitID}`);
        if (scored === undefined) {
          stats.seversUnscorable += 1;
          continue;
        }
        if (scored.recommended) {
          stats.seversRecommended += 1;
          stats.severCellsRecommended += s.cells;
        } else stats.seversNotRecommended += 1;
        if (scored.recommendedNear) stats.seversRecommendedNear += 1;
        if (scored.gainPositive) {
          stats.seversGainPositive += 1;
          stats.severCellsGainPositive += s.cells;
        }
      }
    }
  }

  for (const s of cells.values()) fold(pooled, s);

  // ── (b) does mid-game control predict end-game weight share? ─────────────
  const byGame = new Map();
  for (const r of control) {
    const at = byGame.get(r.game);
    if (at === undefined) byGame.set(r.game, [r]);
    else at.push(r);
  }
  const rows = [];
  let rankAgree = 0;
  let rankTotal = 0;
  let rankMaterialAgree = 0;
  let rankMaterialTotal = 0;
  for (const [, teamRows] of byGame) {
    const total = teamRows.reduce((a, b) => a + b.finalMaterial, 0);
    for (const r of teamRows) {
      rows.push({ ...r, endShare: total === 0 ? 0 : r.finalMaterial / total });
    }
    // A within-game statistic, free of the share-sums-to-one dependence: does
    // the team holding the most potion ground at mid-game finish heaviest?
    const bestControl = teamRows.reduce((a, b) => (b.balance > a.balance ? b : a));
    const bestEnd = teamRows.reduce((a, b) => (b.finalMaterial > a.finalMaterial ? b : a));
    const tiedControl = teamRows.filter((r) => r.balance === bestControl.balance).length > 1;
    if (!tiedControl) {
      rankTotal += 1;
      if (bestControl.team === bestEnd.team) rankAgree += 1;
    }
    // The same question asked of the baseline anybody already has: does the
    // team that is heaviest at mid-game finish heaviest? Control has to beat
    // this to be worth anything at all.
    const bestMid = teamRows.reduce((a, b) =>
      b.midMaterialShare > a.midMaterialShare ? b : a
    );
    const tiedMid =
      teamRows.filter((r) => r.midMaterialShare === bestMid.midMaterialShare).length > 1;
    if (!tiedMid) {
      rankMaterialTotal += 1;
      if (bestMid.team === bestEnd.team) rankMaterialAgree += 1;
    }
  }
  const withPotions = rows.filter((r) => r.potionsStanding > 0);
  // THE CONFOUND, and the report leads with it rather than burying it.
  const balances = withPotions.map((r) => r.balance);
  const midShares = withPotions.map((r) => r.midMaterialShare);
  const endShares = withPotions.map((r) => r.endShare);
  const partial = pearson(
    residualise(balances, midShares),
    residualise(endShares, midShares)
  );
  const quartiles = [];
  if (withPotions.length > 0) {
    const sorted = [...withPotions].sort((a, b) => a.balance - b.balance);
    const q = Math.ceil(sorted.length / 4);
    for (let i = 0; i < 4; i++) {
      const slice = sorted.slice(i * q, (i + 1) * q);
      if (slice.length === 0) continue;
      quartiles.push({
        quartile: i + 1,
        n: slice.length,
        meanBalance: mean(slice.map((r) => r.balance)),
        meanEndShare: mean(slice.map((r) => r.endShare)),
      });
    }
  }

  const report = {
    generatedFrom: path.resolve(opt.replays),
    replays: files.length,
    every: opt.every,
    windowTurns: WINDOW,
    potionsOffCorpus: offCorpus,
    pooled,
    control: {
      teamGameRows: rows.length,
      withPotionsStanding: withPotions.length,
      pearsonBalanceVsEndShare: pearson(
        withPotions.map((r) => r.balance),
        withPotions.map((r) => r.endShare)
      ),
      pearsonNetVsEndShare: pearson(
        withPotions.map((r) => r.net),
        withPotions.map((r) => r.endShare)
      ),
      quartiles,
      withinGameRank: { games: rankTotal, agreed: rankAgree },
      withinGameRankMaterialBaseline: {
        games: rankMaterialTotal,
        agreed: rankMaterialAgree,
      },
      confound: {
        pearsonMidMaterialShareVsEndShare: pearson(midShares, endShares),
        pearsonBalanceVsMidMaterialShare: pearson(balances, midShares),
        partialBalanceVsEndShareGivenMidMaterialShare: partial,
      },
    },
    perCell: [...cells.entries()]
      .map(([k, s]) => ({ cell: k, ...s }))
      .sort((a, b) => (a.cell < b.cell ? -1 : 1)),
    cost: {
      seekMeanMicroseconds:
        pooled.seekCalls === 0 ? null : pooled.seekNs / pooled.seekCalls / 1000,
      bestSeekMeanMicroseconds:
        pooled.bestSeekCalls === 0 ? null : pooled.bestSeekNs / pooled.bestSeekCalls / 1000,
      controlMeanMicroseconds:
        pooled.controlCalls === 0 ? null : pooled.controlNs / pooled.controlCalls / 1000,
    },
    note:
      'Design evidence, not a promotion measurement. No arm was run and nothing ' +
      'was written to the learning loop or the promotion ledger.',
  };

  const text = JSON.stringify(report, null, 2);
  if (opt.out) fs.writeFileSync(opt.out, text + '\n');
  else process.stdout.write(text + '\n');
}

run();
