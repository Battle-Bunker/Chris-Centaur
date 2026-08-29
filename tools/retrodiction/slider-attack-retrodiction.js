#!/usr/bin/env node
'use strict';
/*
 * MECHANISM RETRODICTION FOR `sliderAttackVector` — no games, only replays.
 *
 *   node tools/retrodiction/slider-attack-retrodiction.js \
 *        --replays <dir of *.jsonl.gz> --out <report.json> [--every 40]
 *
 * ── WHAT THIS IS AND IS NOT ────────────────────────────────────────────────
 *
 * This is DESIGN EVIDENCE, not a promotion measurement. It writes nothing to
 * the learning loop and nothing to the promotion ledger, and it cannot: no arm
 * was run, no flag was varied, nothing was played. It asks one question of
 * games we already hold — WOULD THE TERM HAVE SEEN THE CUTS THAT ACTUALLY
 * HAPPENED — and one mirror of it — WHEN THE TERM SAYS "CUT HERE", DOES THE
 * CUT MATERIALIZE. A term that fails either is mis-signed or mis-scaled and is
 * dead before it costs a single game.
 *
 * ── THE THREE MEASUREMENTS ─────────────────────────────────────────────────
 *
 * 1. DENOMINATOR. Every sever in the corpus, split by who landed it (slider or
 *    not, and whose bot) and by who suffered it. The term claims only severs by
 *    OUR sliders; the report states the whole population so the claimed share
 *    is visible rather than assumed.
 *
 * 2. RETRODICTION, at the deciding turn. For each sever landed by a slider,
 *    value that slider's WHOLE grammar-legal action set with the term and ask
 *    where the move that was actually played ranks. Destinations that land on
 *    the same cell are one option: a slider staging a square beyond an enemy
 *    body plays the same move as one staging the body cell, because the engine
 *    capture-stops either way.
 *
 * 3. FALSE POSITIVES. Over every slider decision in the corpus, when the term
 *    reads the STAGED move as a sever, did the resolution record one? The gap
 *    is the term's own optimism: the target moved, somebody interposed, or we
 *    died on the way. Reported both ways — a miss (a sever the term did not
 *    see on the staged move) is the same instrument read from the other end.
 *
 * Sampling for (2) and (3) is exhaustive. The `--every` flag samples only the
 * expensive whole-action-set valuation used for the option-surfacing rate, and
 * it samples DETERMINISTICALLY (every Nth decision in file order), so a re-run
 * on the same corpus produces the same report.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs' },
});

// src/partial-engine/ is vendored from an ESM package, so its internal imports
// carry the ".js" extension ESM requires ("./bitgrid.js" for bitgrid.ts). tsc
// resolves that shape natively; Node's CommonJS resolver does not. This is the
// same one-line accommodation jest.config.js makes in `moduleNameMapper`, and
// it is here for the same reason: the vendored copies stay byte-identical to
// upstream and the drift diff stays clean.
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

const { UnitKind } = require('../../src/partial-engine/index');
const { kindOfWireType } = require('../../src/partial-engine/wire-adapter');
const {
  compareSliderAttack,
  orderingScore,
  severExchangeRate,
  sliderAttackOptions,
  sliderAttackVector,
} = require('../../src/lobster/evaluate/slider-attack-vector');
const { indexOccupancy } = require('../../src/lobster/evaluate/ray-crossing');

const SLIDER_KINDS = new Set([UnitKind.Rook, UnitKind.Bishop, UnitKind.Queen]);
const OURS = (bot) => typeof bot === 'string' && bot.startsWith('lobster');

// ── the wire's own index convention ─────────────────────────────────────────
// A staged piece move is the FULL-BOARD index the TacticToes wire carries, and
// the wire's y grows DOWNWARD while the api board's grows up. So the mapping is
// full = (apiHeight - y) * (apiWidth + 2) + (x + 1), verified against replays in
// which a piece stayed: its staged number equals its own square.
const toFull = (x, y, w, h) => (h - y) * (w + 2) + (x + 1);

function args() {
  const out = { every: 40 };
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

/** The replay's api board plus its resolved tiers, as the primitive reads it. */
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
    };
    units.push(unit);
    byId.set(s.id, unit);
  }
  return {
    board: { width: w + 2, height: h + 2, units, turn: row.turn },
    byId,
    apiWidth: w,
    apiHeight: h,
  };
}

/**
 * Ground truth for one turn: who severed whom, and how many cells.
 *
 * Cells are attributed to a victim ONCE. Two movers can register a cut on one
 * owner in the same turn and the engine keeps only the deepest
 * (`turnEngine.ts:556-565`), so counting a victim's severed cells per clash
 * would inflate the corpus total above the number of cells that actually left
 * the board.
 */
function severTruth(row) {
  const bySurvivor = new Map();
  const attributed = new Set();
  for (const clash of row.events?.clashes || []) {
    if (clash.kind !== 'sever' || !clash.survivorID) continue;
    const victims = clash.playerIDs.filter((id) => id !== clash.survivorID);
    let cells = 0;
    const fresh = [];
    for (const v of victims) {
      if (attributed.has(v)) continue;
      attributed.add(v);
      fresh.push(v);
      cells += (row.events.severedCells?.[v] || []).length;
    }
    const at = bySurvivor.get(clash.survivorID);
    if (at === undefined) bySurvivor.set(clash.survivorID, { victims: fresh, cells });
    else {
      at.victims.push(...fresh);
      at.cells += cells;
    }
  }
  return bySurvivor;
}

/**
 * Does `cell` lie on one of this unit's ray LINES from its own square, ignoring
 * everything standing in the way? Distinguishes "the term was blocked out of a
 * cut it could see the shape of" from "the alignment did not exist at all when
 * the decision was made, and was created by the victim's own move".
 */
function onRayLine(unit, cell, width) {
  const origin = unit.occupancy[0];
  const ox = origin % width;
  const oy = (origin / width) | 0;
  const cx = cell % width;
  const cy = (cell / width) | 0;
  const dx = cx - ox;
  const dy = cy - oy;
  if (dx === 0 && dy === 0) return false;
  const orth = dx === 0 || dy === 0;
  const diag = Math.abs(dx) === Math.abs(dy);
  if (unit.kind === UnitKind.Rook) return orth;
  if (unit.kind === UnitKind.Bishop) return diag;
  return orth || diag;
}

const blank = () => ({
  potions: 0,
  games: 0,
  severEvents: 0,
  severCells: 0,
  byOursAnyEvents: 0,
  byOursAnyCells: 0,
  bySliderEvents: 0,
  bySliderCells: 0,
  byOursSliderEvents: 0,
  byOursSliderCells: 0,
  sufferedByOursEvents: 0,
  sufferedByOursCells: 0,
  // retrodiction over slider severs whose mover we can rank
  rankable: 0,
  rankableCells: 0,
  top1: 0,
  top1Cells: 0,
  top3: 0,
  separated: 0,
  separatedCells: 0,
  rankSum: 0,
  optionsSum: 0,
  // the same, restricted to the severs the term can see at all
  seenOnPlayed: 0,
  seenOnPlayedCells: 0,
  seenTop1: 0,
  seenTop1Cells: 0,
  seenSeparated: 0,
  seenSeparatedCells: 0,
  seenRankSum: 0,
  // the severs the static read cannot reach, and why
  unseen: 0,
  unseenCells: 0,
  unseenOnRayLine: 0,
  unseenOffRayLine: 0,
  // the false-positive mirror, over every slider decision
  decisions: 0,
  predicted: 0,
  predictedHit: 0,
  predictedCells: 0,
  predictedCellsOnHit: 0,
  predictedShiftedCellsOnHit: 0,
  predictedHitCells: 0,
  missed: 0,
  // the same prediction read at its pessimistic endpoint (target moves)
  predictedShifted: 0,
  predictedShiftedHit: 0,
  // did the delivered cut land inside [pessimistic, optimistic]?
  bracketed: 0,
  // option surfacing, on the sampled decisions
  sampled: 0,
  sampledFiring: 0,
  sampledTaken: 0,
});

function fold(into, from) {
  for (const k of Object.keys(from)) {
    if (k === 'potions') continue; // a per-cell fact, not a count
    into[k] += from[k];
  }
}

function readReplay(file) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  const out = { header: null, turns: [] };
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const row = JSON.parse(line);
    if (row.kind === 'header') out.header = row;
    else if (row.kind === 'turn') out.turns.push(row);
  }
  return out;
}

/**
 * Rank the played move inside the term's own ordering of the unit's whole
 * action set. Destinations landing on the same cell are ONE option — the engine
 * capture-stops, so they are the same move — and equal-scoring options share a
 * rank, so a term that cannot separate does not get credit for a coin flip.
 */
function rankOfPlayed(board, unit, playedDest, rate) {
  const options = sliderAttackOptions(board, unit, { turn: board.turn });
  const byLanding = new Map();
  for (const o of options) {
    const seen = byLanding.get(o.landing);
    if (seen === undefined || compareSliderAttack(o, seen, rate) > 0) byLanding.set(o.landing, o);
  }
  const distinct = [...byLanding.values()];
  const played = options.find((o) => o.dest === playedDest);
  if (played === undefined) return null;
  const playedOption = byLanding.get(played.landing) ?? played;
  let strictlyBetter = 0;
  for (const o of distinct) {
    if (compareSliderAttack(o, playedOption, rate) > 0) strictlyBetter += 1;
  }
  // The best score any option that cuts NOTHING can reach — the claim the term
  // actually makes is that a sever outranks every alternative that is not one.
  let bestQuiet = -Infinity;
  for (const o of distinct) {
    if (o.realized.severed > 0) continue;
    const s = orderingScore(o, rate);
    if (s > bestQuiet) bestQuiet = s;
  }
  return {
    rank: strictlyBetter + 1,
    options: distinct.length,
    played: playedOption,
    separated: orderingScore(playedOption, rate) > bestQuiet,
    firing: distinct.some((o) => o.realized.severed > 0),
    argmaxLanding: distinct.reduce((a, b) => (compareSliderAttack(b, a, rate) > 0 ? b : a)).landing,
  };
}

function run() {
  const opt = args();
  const files = walkReplays(opt.replays).slice(0, opt.limit ?? Infinity);
  const cells = new Map();
  const pooled = blank();
  let decisionCounter = 0;
  let costNs = 0;
  let costCalls = 0;
  const misses = [];

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
    const arm = path.basename(path.dirname(path.dirname(file)));
    const key = `${arm}/${replay.header.sweepId}/${replay.header.config.name}`;
    const stats = cellFor(key);
    stats.games += 1;
    stats.potions = replay.header.config.potions?.enabled === true ? 1 : 0;
    const botOf = new Map(replay.header.seats.map((s) => [s.teamID, s.bot]));

    for (const row of replay.turns) {
      const { board, byId, apiWidth, apiHeight } = toRayBoard(row);
      const truth = severTruth(row);

      // ── 1. the denominator, over every sever however it was landed ────────
      for (const [survivorId, t] of truth) {
        const mover = byId.get(survivorId);
        const isSlider = mover !== undefined && SLIDER_KINDS.has(mover.kind);
        const ours = OURS(botOf.get(mover?.team));
        stats.severEvents += 1;
        stats.severCells += t.cells;
        if (ours) {
          stats.byOursAnyEvents += 1;
          stats.byOursAnyCells += t.cells;
        }
        if (isSlider) {
          stats.bySliderEvents += 1;
          stats.bySliderCells += t.cells;
          if (ours) {
            stats.byOursSliderEvents += 1;
            stats.byOursSliderCells += t.cells;
          }
        }
        for (const v of t.victims) {
          const victim = byId.get(v);
          if (victim === undefined || !OURS(botOf.get(victim.team))) continue;
          stats.sufferedByOursEvents += 1;
          stats.sufferedByOursCells += (row.events.severedCells?.[v] || []).length;
        }
      }

      // ── 2 + 3. every slider decision this turn ────────────────────────────
      for (const unit of board.units) {
        if (!SLIDER_KINDS.has(unit.kind)) continue;
        const staged = row.staged?.[unit.unitId];
        if (staged === undefined || typeof staged.move !== 'number') continue;
        const rate = severExchangeRate(board, unit.team);
        const index = indexOccupancy(board, board.turn);

        const t0 = process.hrtime.bigint();
        const playedValue = sliderAttackVector(
          board,
          unit,
          staged.move,
          { turn: board.turn },
          index
        );
        costNs += Number(process.hrtime.bigint() - t0);
        costCalls += 1;

        const actual = truth.get(unit.unitId);
        const actualCells = actual === undefined ? 0 : actual.cells;
        const sawIt = playedValue.realized.severed > 0;
        stats.decisions += 1;
        if (playedValue.realized.severedIfTargetMoves > 0) {
          stats.predictedShifted += 1;
          if (actualCells > 0) stats.predictedShiftedHit += 1;
        }
        if (sawIt) {
          stats.predicted += 1;
          stats.predictedCells += playedValue.realized.severed;
          if (actualCells > 0) {
            stats.predictedHit += 1;
            stats.predictedHitCells += actualCells;
            stats.predictedCellsOnHit += playedValue.realized.severed;
            stats.predictedShiftedCellsOnHit += playedValue.realized.severedIfTargetMoves;
            if (
              actualCells >= playedValue.realized.severedIfTargetMoves &&
              actualCells <= playedValue.realized.severed
            ) {
              stats.bracketed += 1;
            }
          } else if (misses.length < 12) {
            misses.push({
              file: path.relative(opt.replays, file),
              turn: row.turn,
              unit: unit.unitId,
              predicted: playedValue.realized.severed,
            });
          }
        } else if (actualCells > 0) {
          stats.missed += 1;
        }

        // The retrodiction proper: rank the played move among all of them.
        if (actualCells > 0) {
          const r = rankOfPlayed(board, unit, staged.move, rate);
          if (r !== null) {
            stats.rankable += 1;
            stats.rankableCells += actualCells;
            stats.rankSum += r.rank;
            stats.optionsSum += r.options;
            if (r.rank === 1) {
              stats.top1 += 1;
              stats.top1Cells += actualCells;
            }
            if (r.rank <= 3) stats.top3 += 1;
            if (r.separated) {
              stats.separated += 1;
              stats.separatedCells += actualCells;
            }
            if (sawIt) {
              stats.seenOnPlayed += 1;
              stats.seenOnPlayedCells += actualCells;
              stats.seenRankSum += r.rank;
              if (r.rank === 1) {
                stats.seenTop1 += 1;
                stats.seenTop1Cells += actualCells;
              }
              if (r.separated) {
                stats.seenSeparated += 1;
                stats.seenSeparatedCells += actualCells;
              }
            } else {
              stats.unseen += 1;
              stats.unseenCells += actualCells;
              // Was the cut cell even on one of this slider's lines when the
              // decision was made? `severedCells` is in api coords.
              // `severedCells` is `occupancy.slice(cut)`, so entry 0 IS the cut
              // cell — the square the mover arrived on.
              let anyOnLine = false;
              for (const v of actual.victims) {
                const cut = (row.events.severedCells?.[v] || [])[0];
                if (cut === undefined) continue;
                if (onRayLine(unit, toFull(cut.x, cut.y, apiWidth, apiHeight), board.width)) {
                  anyOnLine = true;
                }
              }
              if (anyOnLine) stats.unseenOnRayLine += 1;
              else stats.unseenOffRayLine += 1;
            }
          }
        }

        // Option surfacing, on a deterministic sample of ordinary decisions.
        decisionCounter += 1;
        if (actualCells === 0 && decisionCounter % opt.every === 0) {
          const r = rankOfPlayed(board, unit, staged.move, rate);
          if (r !== null) {
            stats.sampled += 1;
            if (r.firing) stats.sampledFiring += 1;
            if (r.firing && r.argmaxLanding === r.played.landing) stats.sampledTaken += 1;
          }
        }
      }
    }
  }

  for (const s of cells.values()) fold(pooled, s);

  const report = {
    generatedFrom: path.resolve(opt.replays),
    replays: files.length,
    every: opt.every,
    pooled,
    perCell: [...cells.entries()]
      .filter(([, s]) => s.severEvents > 0 || s.decisions > 0)
      .map(([key, s]) => ({ cell: key, ...s }))
      .sort((a, b) => (a.cell < b.cell ? -1 : 1)),
    cost: {
      calls: costCalls,
      meanMicroseconds: costCalls === 0 ? null : costNs / costCalls / 1000,
    },
    misses,
    note:
      'Design evidence, not a promotion measurement. No arm was run and nothing ' +
      'was written to the learning loop or the promotion ledger.',
  };

  const text = JSON.stringify(report, null, 2);
  if (opt.out) fs.writeFileSync(opt.out, text + '\n');
  else process.stdout.write(text + '\n');
}

run();
