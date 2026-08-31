#!/usr/bin/env node
/*
 * VERIFY THE A/A NULL IS ACTUALLY A/A — and report the noise floor it measured.
 *
 *   node tools/simworker/bin/verify-null.js --batch <batch-dir> --null <armA>,<armB>
 *
 * ── WHY A NULL CELL IS MANDATORY AND WHY IT MUST BE CHECKED ────────────────
 *
 * An A/A cell is two arms that are the SAME BOT: same bundle, same env, same
 * cells, same seeds, same seat rotation. Its paired delta therefore measures
 * nothing but run-to-run variance, and that number is the only honest yardstick
 * a treatment delta has. Without it "score +0.08" is unreadable — it could be a
 * real effect or it could be less than the noise, and nothing in the number
 * itself says which.
 *
 * The program has repeatedly measured that this floor is NOT small. On a
 * provably inert path, at four blocks per cell, an A/A null produced outcome
 * deltas whose bootstrap intervals EXCLUDED ZERO — d P(first) +0.167
 * [0.056, 0.306] between one baseline and the identical baseline. A treatment
 * delta smaller than that, taken from a cell with no null, is indistinguishable
 * from the machine's mood.
 *
 * And a null nobody checked is worth nothing. "Same bot" is a claim about two
 * directory trees; it is checkable from the manifests and the bundle stamps,
 * and this checks it:
 *
 *   - identical bundle SHA in both arms
 *   - identical engine-flag environment in both arms
 *   - every gameId present in both
 *   - configHash identical game for game
 *   - seat -> bot assignment identical game for game
 *
 * Exit code is 1 if anything differs. An arm pair that fails these is not a
 * null, whatever it was called.
 *
 * ── THE SECOND KIND OF NULL ────────────────────────────────────────────────
 *
 * A/A is one null. The other is the PROVABLY-INERT CELL: a cell where the
 * treatment cannot act by construction — a snake-only roster for a profile
 * whose extra terms are gated on piece class, so the two evaluators are
 * bit-identical there. That null is stronger, because it rides in the same
 * batch as the treatment cells rather than costing a separate pair. Use both
 * when you can. This script checks the A/A kind; the inert-cell kind is
 * asserted by the engine's own tests and named in the spec's `_comment`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const batchDir = path.resolve(arg('batch', ''));
const nullSpec = arg('null', '');
if (arg('batch', '') === '' || nullSpec === '') {
  console.error('usage: verify-null.js --batch <batch-dir> --null <armA>,<armB>');
  process.exit(2);
}
const [nameA, nameB] = nullSpec.split(',');
if (!nameA || !nameB) { console.error('--null takes two comma-separated arm names'); process.exit(2); }

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

/*
 * THE OBJECTIVE'S OWN FLOOR.
 *
 * A treatment quoted against `sharePar` needs a floor measured on `sharePar`.
 * A rank floor will not do: the two are different units, they do not convert,
 * and the objective is measurably noisier per unit of its own range — so
 * reading a share delta against a score floor overstates it.
 *
 * Same formula as `placementsOf` and `aggregate.js`: share of the adjudicated
 * end weight x team count, par 1, and par for everyone on a board with no
 * weight anywhere. On a manifest predating the column the weight falls back to
 * `finalMaterial`, which is the adjudicated weight on every end kind but a
 * mutual wipe; `aggregate.js` is the tool that names those games.
 */
const adjudicatedOf = (r) =>
  r.adjudicatedMaterial === undefined || r.adjudicatedMaterial === null
    ? r.finalMaterial
    : r.adjudicatedMaterial;
function shareParOf(row, res) {
  if (res.sharePar !== undefined && res.sharePar !== null) return res.sharePar;
  const teams = row.results.length;
  if (teams === 0) return 1;
  const total = row.results.reduce((a, r) => a + adjudicatedOf(r), 0);
  return total > 0 ? (teams * adjudicatedOf(res)) / total : 1;
}

function loadArm(name) {
  const dir = path.join(batchDir, 'arms', name);
  if (!fs.existsSync(dir)) return null;
  const meta = readJson(path.join(dir, 'arm.json'));
  const sweeps = new Map();
  for (const sweepId of fs.readdirSync(dir)) {
    const mp = path.join(dir, sweepId, 'manifest.jsonl');
    if (!fs.existsSync(mp)) continue;
    sweeps.set(sweepId, new Map(
      fs.readFileSync(mp, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.gameId, r])
    ));
  }
  return { name, dir, meta, sweeps };
}

const A = loadArm(nameA);
const B = loadArm(nameB);
let bad = 0;
const say = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

if (A === null || B === null) {
  console.error(`missing arm directory: ${A === null ? nameA : nameB}`);
  process.exit(2);
}

// ---- 1. the two arms must be the same BUILD -------------------------------
const shaA = A.meta && A.meta.bundleStamp ? A.meta.bundleStamp.sha : null;
const shaB = B.meta && B.meta.bundleStamp ? B.meta.bundleStamp.sha : null;
if (shaA === null || shaB === null) {
  say(false, `bundle stamp missing (${nameA}=${shaA ?? 'none'} ${nameB}=${shaB ?? 'none'}) — cannot prove these are the same build`);
} else {
  say(shaA === shaB, `same bundle sha: ${shaA.slice(0, 12)} vs ${shaB.slice(0, 12)}`);
}

// ---- 2. the two arms must be the same BOT ---------------------------------
//
// The contender is what an arm IS now that the engine has no feature flags, so
// it is checked first and by value. The env comparison stays because an arm can
// still carry process environment (`DECISION_POOL_SIZE`, a bundle's own test
// seams) and two arms that differ in one are not an A/A pair either.
const botA = JSON.stringify((A.meta && A.meta.botConfig) || null);
const botB = JSON.stringify((B.meta && B.meta.botConfig) || null);
say(botA === botB, `same bot config: ${botA} vs ${botB}`);

// AND THE SAME CONFIG ON THE SAME SEATS. Since 2026-08-30 a config names the
// seat it lands on, so two arms can carry an identical `botConfig` and still
// have aimed it at different seats — which is two different games, not an A/A
// pair. `seatConfigs` is the resolved map and is absent on pre-20260830
// records; a run written by the current runner always has one, so a missing
// pair of them is old data rather than a failure and is reported as such.
const seatsOf = (m) => {
  const s = m && m.seatConfigs;
  if (!s || typeof s !== 'object') return null;
  return JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k]]));
};
const seatA = seatsOf(A.meta);
const seatB = seatsOf(B.meta);
if (seatA === null && seatB === null) {
  console.log('       (no seatConfigs on either arm — a record written before 20260830)');
} else {
  say(seatA === seatB, `same configured seats: ${seatA ?? 'absent'} vs ${seatB ?? 'absent'}`);
}

const envA = JSON.stringify((A.meta && A.meta.envOverrides) || {});
const envB = JSON.stringify((B.meta && B.meta.envOverrides) || {});
say(envA === envB, `same env overrides: ${envA} vs ${envB}`);

// ---- 3. the two arms must have played the same GAMES -----------------------
const sweepIds = new Set([...A.sweeps.keys(), ...B.sweeps.keys()]);
const deltas = new Map(); // metric -> block -> [diffs]
const subjectsUsed = new Map(); // sweepId -> the seat the floor belongs to

for (const sweepId of [...sweepIds].sort()) {
  const a = A.sweeps.get(sweepId);
  const b = B.sweeps.get(sweepId);
  if (!a || !b) { say(false, `sweep ${sweepId}: present in only one arm`); continue; }

  const problems = [];
  let checked = 0;
  for (const [gameId, ra] of a) {
    const rb = b.get(gameId);
    if (rb === undefined) { problems.push(`${gameId}: missing in ${nameB}`); continue; }
    checked++;
    if (ra.configHash !== rb.configHash) problems.push(`${gameId}: configHash ${ra.configHash} vs ${rb.configHash}`);
    const sa = ra.seats.map((s) => `${s.seat}:${s.bot}`).join(',');
    const sb = rb.seats.map((s) => `${s.seat}:${s.bot}`).join(',');
    if (sa !== sb) problems.push(`${gameId}: seats ${sa} vs ${sb}`);
  }
  for (const gameId of b.keys()) if (!a.has(gameId)) problems.push(`${gameId}: missing in ${nameA}`);

  say(problems.length === 0, `sweep ${sweepId}: ${checked} games compared, ${problems.length} problems`);
  for (const p of problems.slice(0, 10)) console.log(`       ${p}`);

  // ---- 4. what the noise floor actually was -------------------------------
  /*
   * THE FLOOR IS A PROPERTY OF A SEAT, AND THIS MAY NOT GUESS WHICH ONE.
   *
   * The first version read `a.values().next().value` — the first row of the
   * manifest — and took the first `lobster*` in its seat list. That is a race
   * on two counts: `manifest.jsonl` is written in COMPLETION order by a worker
   * pool, and the harness rotates seats between games.
   *
   * In an A/A cell both arms are the same build, so a wrong pick cannot invert
   * a sign the way it does in `aggregate.js`. It does something quieter and,
   * for this tool, worse: IT PUBLISHES THE WRONG FLOOR. Measured on
   * 20260831-batch2's own A/A rows, the two seated contenders' `null-snake6`
   * `score` floors are +/-0.0324 (`lobster-territory`) and +/-0.0725
   * (`lobster-material`) — 2.2x apart on the batch's tightest and most-quoted
   * board. Every treatment in the batch is read against this number, so a
   * coin-flip here silently re-scales the whole batch's readability. That run
   * happened to land on `lobster-territory`, which is why its published floors
   * are right; nothing in the old code made that so.
   *
   * So: derived when the cell seats exactly one candidate, declared with
   * `--subject` otherwise, and refused when neither. The floor is quoted
   * beside the seat it belongs to.
   */
  const candidates = (() => {
    const bots = new Set();
    for (const r of a.values()) for (const s of r.seats ?? []) bots.add(s.bot);
    const all = [...bots].sort();
    const lob = all.filter((x) => x.startsWith('lobster'));
    return lob.length > 0 ? lob : all;
  })();
  const declared = arg('subject', '');
  if (declared === '' && candidates.length !== 1) {
    console.log('');
    console.log(`FAIL sweep ${sweepId}: this A/A cell seats ${candidates.length} candidate contenders`);
    console.log(`       (${candidates.join(', ')}) and the noise floor is a property of ONE seat.`);
    console.log('       The floors these seats measure are NOT interchangeable — on 20260831-batch2');
    console.log('       they differ by 2.2x on `null-snake6` score. Declare the seat every treatment');
    console.log('       in this batch will be read against:');
    console.log('');
    console.log(`           --subject ${candidates[0]}`);
    console.log('');
    console.log('       This script does not guess which bot it is measuring.');
    bad++;
    continue;
  }
  const subject = declared || candidates[0];
  subjectsUsed.set(sweepId, subject);
  for (const [gameId, ra] of a) {
    const rb = b.get(gameId);
    if (rb === undefined) continue;
    const pa = ra.results.find((r) => r.bot === subject);
    const pb = rb.results.find((r) => r.bot === subject);
    if (!pa || !pb) continue;
    const key = `${sweepId}::${ra.cell}`;
    if (!deltas.has(key)) deltas.set(key, new Map());
    const byBlock = deltas.get(key);
    if (!byBlock.has(ra.block)) byBlock.set(ra.block, { sharePar: [], score: [], win: [], turns: [] });
    const d = byBlock.get(ra.block);
    d.sharePar.push(shareParOf(rb, pb) - shareParOf(ra, pa));
    d.score.push(pb.score - pa.score);
    d.win.push((pb.place === 1 ? 1 : 0) - (pa.place === 1 ? 1 : 0));
    d.turns.push(rb.turns - ra.turns);
  }
}

console.log('');
console.log('THE MEASURED NOISE FLOOR (this batch, this box, this load)');
console.log('');
console.log('Any treatment delta in this batch that is not comfortably LARGER than the');
console.log('half-width below is a null result. Quote these numbers next to it in findings.md.');
console.log('');
console.log('`sharePar` IS THE OBJECTIVE and its floor is the first line to quote: share of total');
console.log('end weight x team count, par 1, continuous in the weight margin. `score` and `win`');
console.log('(P(first)) are RANK readings kept for continuity with earlier findings. THE FLOORS');
console.log('ARE IN DIFFERENT UNITS AND DO NOT CONVERT — a share delta read against a rank floor');
console.log('is overstated, because the objective is measurably noisier per unit of its own');
console.log('range. Quote each delta against the floor in its own units, and say which.');
console.log('');
for (const [sweepId, subj] of subjectsUsed) {
  console.log(`Floors below are measured on the \`${subj}\` seat (sweep ${sweepId}). A floor is a`);
  console.log('property of one seat; read a treatment against the floor of the seat the treatment');
  console.log('reached, and aggregate that treatment on the same seat.');
}
console.log('');

const mean = (xs) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : null);
const T95 = { 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 12: 2.201, 16: 2.131, 20: 2.093 };

for (const [key, byBlock] of [...deltas].sort()) {
  const blocks = [...byBlock.values()];
  for (const metric of ['sharePar', 'score', 'win', 'turns']) {
    const blockMeans = blocks.map((b) => mean(b[metric])).filter((x) => x !== null);
    const n = blockMeans.length;
    if (n === 0) continue;
    const m = mean(blockMeans);
    if (n === 1) { console.log(`  ${key} ${metric}: ${m.toFixed(4)} (1 block — no interval)`); continue; }
    const sd = Math.sqrt(blockMeans.reduce((acc, x) => acc + (x - m) ** 2, 0) / (n - 1));
    const t = T95[Math.min(n, 20)] ?? 1.96;
    const half = (t * sd) / Math.sqrt(n);
    const excl = m - half > 0 || m + half < 0;
    console.log(
      `  ${key} ${metric}: ${m >= 0 ? '+' : ''}${m.toFixed(4)} ± ${half.toFixed(4)} ` +
      `[${(m - half).toFixed(4)}, ${(m + half).toFixed(4)}] n=${n} blocks${excl ? '   <-- NULL EXCLUDES ZERO' : ''}`
    );
    if (excl) {
      console.log('        The A/A null itself shows a "significant" difference. That is not a bug in');
      console.log('        this script — it is the finding. This box, at this load and this block count,');
      console.log('        cannot resolve an effect of that size. Add blocks or quieten the box; do NOT');
      console.log('        report a treatment effect of comparable magnitude from this batch.');
    }
  }
}

console.log('');
if (bad === 0) {
  console.log(`VERDICT: ${nameA} vs ${nameB} is a valid A/A null.`);
} else {
  console.log(`VERDICT: ${nameA} vs ${nameB} is NOT a valid A/A null — ${bad} check(s) failed.`);
  console.log('Anything this batch says about effect size is unsupported until that is fixed.');
}
process.exit(bad === 0 ? 0 : 1);
