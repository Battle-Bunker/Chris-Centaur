#!/usr/bin/env node
'use strict';
/*
 * THE SYNTHETIC MINI-BATCH — a batch with known answers, so the ingest can be
 * tested against something other than its own output.
 *
 *   node tools/learnloop/fixtures/make-fixture.js [--out fixtures/mini-batch]
 *
 * Four arms over two cells and six blocks:
 *
 *   nullA / nullB  the SAME bundle and env under two names. Their paired delta
 *                  is pure synthetic jitter, and the ingest must call it a
 *                  valid A/A null and report a small floor.
 *   base / treat   a treatment with three planted effects, each chosen because
 *                  it is a shape the real program has actually produced:
 *
 *     1. A MECHANISM EFFECT WELL OUTSIDE THE FLOOR — `wasmRuns` goes from 0 to
 *        a large number on the treatment arm. This is the ENGAGEMENT signal,
 *        and the ingest must be able to say the arm ran.
 *     2. A SHAPE EFFECT — the cap rate roughly doubles on the treatment arm,
 *        which is P5's anomaly in miniature. The drift table must flag it.
 *     3. A PLACEMENT EFFECT THAT IS INSIDE THE NOISE on one cell and outside
 *        it on the other, so the power refusal has something to refuse.
 *
 * Everything is generated from a fixed integer PRNG: the fixture is committed,
 * and re-running this script must reproduce it byte for byte.
 */

const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const outDir = path.resolve(arg('out', path.join(__dirname, 'mini-batch')));

/** xorshift32 — deterministic, and the same generator the aggregator uses. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

const CELLS = [
  { cell: 'headline-mix-king', configHash: 'aaaa1111bbbb2222', size: 25 },
  { cell: 'null-snake6', configHash: 'cccc3333dddd4444', size: 25 },
];
const BOTS = ['lobster-territory', 'lobster-material', 'reflex'];
const TEAMS = ['red', 'blue', 'green'];
const BLOCKS = 6;
const SEED_BASE = 7000;

/**
 * One arm's rows. `effect` carries the planted differences; `jitterSeed` is
 * per-arm, so nullA and nullB differ only by jitter, which is exactly what an
 * A/A pair is.
 */
function rowsFor(armName, { jitterSeed, effect }) {
  const r = rng(jitterSeed);
  const rows = [];
  for (const c of CELLS) {
    for (let b = 0; b < BLOCKS; b++) {
      const seed = SEED_BASE + b;
      for (let rot = 0; rot < BOTS.length; rot++) {
        const seats = BOTS.map((_, i) => ({
          seat: i,
          teamID: TEAMS[i],
          bot: BOTS[(i + rot) % BOTS.length],
        }));
        const subject = 'lobster-territory';
        const subjectSeat = seats.find((s) => s.bot === subject);
        const cellEffect = effect[c.cell] ?? {};
        // Placement: a base rate plus jitter plus the planted shift.
        const raw = 0.5 + (r() - 0.5) * 0.30 + (cellEffect.score ?? 0);
        const score = Math.max(0, Math.min(1, Number(raw.toFixed(4))));
        const place = score > 0.75 ? 1 : score > 0.35 ? 2 : 3;
        const capped = r() < (cellEffect.capRate ?? 0.2);
        const decisions = 40 + Math.floor(r() * 10);
        /*
         * THE END WEIGHTS CARRY THE PLANTED ANSWER TOO.
         *
         * `sharePar` — the objective since the 2026-08-29 ruling — is share of
         * total end weight x teams, so a fixture whose weights are a STEP
         * FUNCTION OF `place` plants its effect in the rank column and not in
         * the objective. It did until 20260831: the planted -0.30 was visible
         * in `score` and invisible in `sharePar`, so the fixture could not have
         * caught an extractor that read the objective wrongly. The weights now
         * track the planted score continuously, which is also the truer model —
         * the objective is continuous in the weight margin and that continuity
         * is the whole reason the ruling preferred it to a rank.
         */
        const TOTAL_WEIGHT = 30;
        const subjWeight = Math.max(0, Math.round(TOTAL_WEIGHT * score));
        const otherWeight = Math.max(0, Math.round((TOTAL_WEIGHT - subjWeight) / 2));
        const results = seats.map((s) => ({
          seat: s.seat,
          bot: s.bot,
          teamID: s.teamID,
          place: s.bot === subject ? place : place === 1 ? 2 : 1,
          score: s.bot === subject ? score : Number((1 - score).toFixed(4)),
          finalUnits: s.bot === subject ? (place === 1 ? 4 : 0) : 2,
          finalMaterial: s.bot === subject ? subjWeight : otherWeight,
          eliminatedOnTurn: s.bot === subject && place !== 1 ? 40 : null,
        }));
        const health = seats.map((s) => ({
          seat: s.seat,
          bot: s.bot,
          decisions,
          illegal: 0,
          unstaged: 0,
          stagedNothing: 0,
          overruns: s.bot === subject ? (cellEffect.overruns ?? 0) : 0,
          worstOverrunMs: 0,
          worstWallMs: 1900 + Math.floor(r() * 100),
          plansEvaluated: 20 + Math.floor(r() * 400),
          assumptions: 0,
          boundViolations: 0,
          boundsInversions: 0,
          ratchetRefusals: 0,
          errors: 0,
          deathsSelf: Math.floor(r() * 3),
          deathsTeammate: 0,
          deathsWall: Math.floor(r() * 2),
          deathsExhaustion: Math.floor(r() * 4) + (cellEffect.exhaustion ?? 0),
          // CL7's mechanism fold. Absent on the base arm in the same way a
          // pre-CL7 bundle's rows are absent: the key is simply not there.
          ...(s.bot === subject && effect.mechanism
            ? { mechanism: { ...effect.mechanism } }
            : {}),
        }));
        rows.push({
          sweepId: 'f1-fixture',
          gameId: `${c.cell}-s${seed}-r${rot}`,
          cell: c.cell,
          block: `${c.cell}#${seed}`,
          rotation: rot,
          configHash: c.configHash,
          seed,
          configName: c.cell,
          size: c.size,
          teamCount: 3,
          unitsPerTeam: 6,
          budgetMs: 2000,
          turnCap: 120,
          hazardDamage: 15,
          hazardLayout: 'none',
          foodSpawnRate: 0.5,
          fertile: false,
          potions: false,
          seats,
          turns: capped ? 120 : 60 + Math.floor(r() * 40),
          endKind: capped ? 'turn-cap' : 'last-team-standing',
          terminal: capped ? 'cap' : 'decisive',
          reason: capped ? 'turn cap' : 'last team standing',
          results,
          health,
          subjectSeat: subjectSeat ? subjectSeat.seat : 0,
        });
      }
    }
  }
  return rows;
}

const ARMS = {
  // The A/A pair: identical bundle, identical env, different jitter only.
  nullA: {
    jitterSeed: 0x1111_1111,
    sha: 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1',
    env: {},
    effect: {},
  },
  nullB: {
    jitterSeed: 0x2222_2222,
    sha: 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1',
    env: {},
    effect: {},
  },
  // The treatment pair.
  base: {
    jitterSeed: 0x3333_3333,
    sha: 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1',
    env: {},
    effect: {
      mechanism: { wasmRuns: 0, wasmRefused: 0, clusterJoints: 0, ceilingDecided: 1 },
      'headline-mix-king': { capRate: 0.2 },
      'null-snake6': { capRate: 0.2 },
    },
  },
  treat: {
    jitterSeed: 0x4444_4444,
    sha: 'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2',
    env: { CENTAUR_WASM: 'on' },
    effect: {
      mechanism: { wasmRuns: 812, wasmRefused: 4, clusterJoints: 0, ceilingDecided: 1 },
      // Planted effect 2: the cap rate roughly doubles — P5 in miniature.
      'headline-mix-king': { capRate: 0.45, score: -0.30 },
      // Planted effect 3: a placement shift small enough to sit inside the
      // synthetic jitter, so the power refusal has something to refuse.
      'null-snake6': { capRate: 0.42, score: 0.02 },
    },
  },
};

fs.rmSync(outDir, { recursive: true, force: true });
for (const [name, a] of Object.entries(ARMS)) {
  const dir = path.join(outDir, 'arms', name, 'f1-fixture');
  fs.mkdirSync(dir, { recursive: true });
  const rows = rowsFor(name, a);
  fs.writeFileSync(path.join(dir, 'manifest.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(
    path.join(outDir, 'arms', name, 'arm.json'),
    JSON.stringify(
      { arm: name, bundleStamp: { sha: a.sha, ref: 'fixture' }, envOverrides: a.env },
      null,
      1
    ) + '\n'
  );
}
fs.writeFileSync(
  path.join(outDir, 'README.md'),
  [
    '# mini-batch — the ingest fixture',
    '',
    'Generated by `make-fixture.js`; committed so `bin/selftest.js` has a batch',
    'with known answers. Re-running the generator must reproduce it byte for byte.',
    '',
    'Four arms, two cells, six blocks, three rotations = 36 games per arm.',
    '',
    '| arm | bundle | env | planted |',
    '|---|---|---|---|',
    '| nullA | f1f1… | — | nothing. |',
    '| nullB | f1f1… | — | nothing. Same bundle and env as nullA: this pair is the A/A null. |',
    '| base | f1f1… | — | wasmRuns 0. |',
    '| treat | f2f2… | CENTAUR_WASM=on | wasmRuns 812 (engagement), cap rate ~0.2 → ~0.45 (shape), score −0.30 on headline and +0.02 on snake6 (placement, one outside the noise and one inside). |',
    '',
    'What the ingest must say about it, and what `selftest.js` asserts:',
    '',
    '1. nullA vs nullB is a VALID A/A null (same sha, same env, every game paired).',
    '2. The drift table raises a `cap-rate-asymmetry` event on both cells.',
    '3. Engagement on `treat` is TRUE for `wasmRuns` and NULL (not false) for a',
    '   counter no row carries — an old batch that cannot say is not a batch saying no.',
    '4. The headline placement delta lands outside the null floor and the snake6 one',
    '   does not.',
  ].join('\n') + '\n'
);

console.log(`wrote the mini-batch fixture -> ${outDir}`);
