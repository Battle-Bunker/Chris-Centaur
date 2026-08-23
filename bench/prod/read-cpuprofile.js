// Turn a V8 .cpuprofile into a self-time table with file:line, so a hot spot
// can be cited rather than guessed at.
//
//   node bench/prod/read-cpuprofile.js <file.cpuprofile> [topN]
const fs = require('fs');

const file = process.argv[2];
const topN = Number(process.argv[3] || 25);
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));

const byId = new Map();
for (const node of prof.nodes) byId.set(node.id, node);

// Self time: sum the sample deltas attributed to each node.
const self = new Map();
const deltas = prof.timeDeltas || [];
const samples = prof.samples || [];
for (let i = 0; i < samples.length; i++) {
  const id = samples[i];
  self.set(id, (self.get(id) || 0) + (deltas[i] || 0));
}

const rows = new Map();
for (const [id, us] of self) {
  const node = byId.get(id);
  if (!node) continue;
  const f = node.callFrame;
  const url = (f.url || '').replace(/^file:\/\//, '');
  const key = `${f.functionName || '(anonymous)'}  ${url}:${(f.lineNumber || 0) + 1}`;
  rows.set(key, (rows.get(key) || 0) + us);
}

const total = [...rows.values()].reduce((a, b) => a + b, 0) || 1;
const sorted = [...rows.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
console.log(`# total sampled ${(total / 1000).toFixed(1)} ms over ${samples.length} samples`);
for (const [key, us] of sorted) {
  console.log(`${((us / total) * 100).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(1).padStart(8)} ms  ${key}`);
}
