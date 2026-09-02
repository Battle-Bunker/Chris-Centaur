/**
 * SKETCH DEMO — the spine, exercised.
 *
 * Runs the five things the design claims are cheap, on a toy manifest:
 *   1. normalise a roster of diff-expressions into total bot values
 *   2. address them (botId) and diff them (botDiff) — the arm's claim, generated
 *   3. run the checks: Law R (both clauses), Law S, the codecs, ambiguity
 *   4. compute a transfer penalty from two premise records, and the precision
 *      it earns — generated from the coordinate table, never member-computed
 *   5. show names-find/hashes-validate on a carried result across `advance`
 *
 * `npx tsc --noEmit --strict demo.ts manifest.ts && node --experimental-strip-types demo.ts`
 */

import {
  advisoryPrecision,
  collapseAtEmission,
  read,
  spendAttention,
  botDiff,
  botId,
  check,
  creditSpend,
  lineName,
  normalise,
  traceValid,
  transferVariance,
} from './manifest.ts';
import type {
  Bot,
  Budgets,
  Column,
  ReductionResult,
  BotSpec,
  Choice,
  DataEntry,
  FitProvenance,
  Joint,
  JointId,
  Manifest,
  Member,
  Premise,
  TraceRecord,
} from './manifest.ts';

// ------------------------------------------------------------- a manifest

const ok = (): null => null;

const JOINTS: ReadonlyArray<Joint> = [
  { id: 'model/replies', kind: 'model', law: 'lattice-join', allowsDynamic: false, codec: ok },
  {
    id: 'value/terms',
    kind: 'value',
    law: 'mobius',
    allowsDynamic: true,
    maxScopeArity: 2,
    codec: ok,
  },
  {
    id: 'reduce/accept',
    kind: 'reduction',
    law: 'choose-one',
    allowsDynamic: false,
    sites: [
      { site: 'staging/floor', constraint: 'kernel-pinned' },
      { site: 'read/root-est', constraint: 'free' },
      { site: 'thread/interior', constraint: 'kernel-pinned' },
      { site: 'ponder/target', constraint: 'ruling-13' },
    ],
    codec: ok,
  },
  { id: 'order/candidates', kind: 'action', law: 'ordered-sum', allowsDynamic: true, codec: ok },
  { id: 'economy/schedule', kind: 'economy', law: 'partition', allowsDynamic: true, codec: ok },
  { id: 'economy/emit', kind: 'economy', law: 'deadline-meet', allowsDynamic: true, codec: ok },
  { id: 'advice/surface', kind: 'advice', law: 'submodular-budget', allowsDynamic: true, codec: ok },
];

const MANIFEST: Manifest = {
  joints: JOINTS,
  constraints: [
    {
      kind: 'compensating',
      joints: ['value/terms#gamma', 'reduce/accept#epsilon'],
      rule: 'swept as a grid; a single-arm claim over either alone is refused at spec time',
    },
    {
      kind: 'excludes',
      joints: ['advice/surface'],
      rule: 'no joint producing the staged plan may read an advice member',
    },
  ],
  coordinates: [
    {
      group: 'config',
      path: 'config.opponents',
      // Maximum penalty against humans: no human game is in any corpus we have.
      penalty: (fit, live) => (structuralish(live).includes('human') ? 4 : structuralish(fit) === structuralish(live) ? 0 : 1),
    },
    {
      group: 'config',
      path: 'config.regime.budgetMs',
      penalty: (fit, live) => (structuralish(fit) === structuralish(live) ? 0 : 0.5),
    },
    {
      group: 'observable',
      path: 'observable.frame',
      penalty: (fit, live) => (structuralish(fit) === structuralish(live) ? 0 : 0.25),
    },
  ],
};

const structuralish = (v: unknown): string => JSON.stringify(v ?? null);

// --------------------------------------------------------------- members

const FIT: FitProvenance = {
  fitId: 'fit/potion-retrodiction@1',
  corpus: 'batch-1+2/potions-on',
  population: [{ codeRef: '06ddd05', botId: 'a1b2c3d4' }],
  shapes: ['snake6', 'snake5-knight'],
  regime: { budgetMs: 1000, workers: 0, turnLimit: 100 },
  metric: 'model/terminal@1',
  n: 485,
  residualSigma: 0.5,
  heldOut: [],
  identifiability: { params: 3, rankDeficient: false },
};

const MEMBERS = new Map<string, Member>(
  (
    [
      {
        id: 'opp/adversarial@1',
        joint: 'model/replies',
        params: { policy: 'worst-case' },
        primitive: 'bank:min-over-replies',
        soundness: 'sound-writing',
        reads: [],
        writes: ['support.replies'],
      },
      {
        id: 'value/territory@1',
        joint: 'value/terms',
        params: { weights: { material: 10, room: 3 } },
        primitive: 'evaluate:BoundEvaluator',
        soundness: 'sound-writing',
        reads: ['observable.frame'],
        writes: ['value.fold'],
      },
      {
        id: 'value/potion-seek@3',
        joint: 'value/terms',
        params: { weight: 1, windowTurns: 3 },
        primitive: 'evaluate:advisoryEst',
        soundness: 'advisory',
        reads: ['observable.frame', 'data/potion-exposure@1'],
        writes: ['value.fold'],
        fit: FIT,
        scope: ['collector'],
      },
      {
        id: 'reduce/floor-led@1',
        joint: 'reduce/accept',
        params: { epsilon: 1 },
        primitive: 'search:accept',
        soundness: 'advisory',
        reads: ['measure.weight'],
        writes: ['order.rank'],
      },
      {
        id: 'order/gain@1',
        joint: 'order/candidates',
        params: { precedence: ['tier', 'capture', 'food'] },
        primitive: 'candidates:gainOrderKey',
        soundness: 'advisory',
        reads: [],
        writes: ['order.rank'],
        parts: ['order/gain.capture@1'],
      },
      {
        id: 'order/gain.capture@1',
        joint: 'order/candidates',
        params: { rank: 'yes/maybe/no' },
        primitive: 'candidates:captureRank',
        soundness: 'advisory',
        reads: [],
        writes: [],
      },
      {
        id: 'econ/slice-loop@1',
        joint: 'economy/schedule',
        params: { sliceMs: 25 },
        primitive: 'kernel:slice-loop',
        soundness: 'advisory',
        reads: [],
        writes: ['economy.quanta'],
      },
      {
        id: 'econ/commit-late@1',
        joint: 'economy/emit',
        params: { commit: 'late' },
        primitive: 'kernel:emit-barrier',
        soundness: 'advisory',
        reads: [],
        writes: ['economy.deadline'],
      },
      {
        id: 'advice/sacrifice-warrant@1',
        joint: 'advice/surface',
        params: { budget: 3 },
        primitive: 'advice:portfolio',
        soundness: 'advisory',
        reads: ['value.fold'],
        writes: ['operator.surface'],
      },
      {
        // Reachable, never engaged, and blocked by a game mode that does not
        // exist: the self-retiring waiver keeps it alive until invisibility ships.
        id: 'model/observation-fog@1',
        joint: 'model/replies',
        params: { mask: 'per-observer' },
        primitive: 'partial-engine:condition',
        soundness: 'sound-writing',
        reads: [],
        writes: ['support.model'],
        engagementWaiver: { blockedBy: 'game mode: invisibility potions', check: 'mode/invisibility@1' },
      },
    ] as ReadonlyArray<Member>
  ).map((m) => [m.id, m])
);

const DATA: ReadonlyArray<DataEntry> = [
  { id: 'data/potion-exposure@1', provenance: FIT, compose: 'refuse' },
];

// ----------------------------------------------------------- the roster

const fixed = (member: string): Choice => ({ at: 'fixed', member });

const DEFAULTS = new Map<JointId, Choice>([
  ['model/replies', fixed('opp/adversarial@1')],
  ['value/terms', fixed('value/territory@1')],
  ['reduce/accept', fixed('reduce/floor-led@1')],
  ['order/candidates', fixed('order/gain@1')],
  ['economy/schedule', fixed('econ/slice-loop@1')],
  ['economy/emit', fixed('econ/commit-late@1')],
  ['advice/surface', fixed('advice/sacrifice-warrant@1')],
]);

const SHIPPED: BotSpec = { name: 'shipped', bind: {} };

const POTION: BotSpec = {
  name: 'potion-aware',
  extends: 'shipped',
  bind: {
    'value/terms': {
      at: 'composed',
      of: [fixed('value/territory@1'), fixed('value/potion-seek@3')],
    },
  },
};

/** Illegal on purpose: a dynamic choice on a MODEL joint (Law S). */
const ADAPTIVE: BotSpec = {
  name: 'adaptive-model',
  extends: 'shipped',
  bind: {
    'model/replies': {
      at: 'priced',
      by: 'econ/slice-loop@1',
      over: ['opp/adversarial@1'],
      transport: 're-evaluate',
    },
  },
};

const ROSTER = new Map<string, BotSpec>(
  [SHIPPED, POTION, ADAPTIVE].map((s) => [s.name, s])
);

// -------------------------------------------------------------- exercise

const shipped: Bot = normalise(SHIPPED, MANIFEST, ROSTER, DEFAULTS);
const potion: Bot = normalise(POTION, MANIFEST, ROSTER, DEFAULTS);
const adaptive: Bot = normalise(ADAPTIVE, MANIFEST, ROSTER, DEFAULTS);

console.log('shipped     ', botId(shipped));
console.log('potion-aware', botId(potion));
console.log('the arm claim, generated:', JSON.stringify(botDiff(shipped, potion), null, 0));

const findings = check(
  MANIFEST,
  MEMBERS,
  [shipped, potion, adaptive],
  new Set(['opp/adversarial@1', 'value/territory@1', 'order/gain@1', 'order/gain.capture@1', 'econ/slice-loop@1', 'econ/commit-late@1']),
  new Set(['game mode: invisibility potions'])
);
console.log('\nchecks:');
for (const f of findings) console.log(`  [${f.law}] ${f.detail}`);

// The transfer penalty, generated from two premise records.
const fitPremise: Premise = {
  support: null,
  observable: { frame: 'territory' },
  measure: null,
  config: { opponents: [{ kind: 'bot', botId: 'a1b2c3d4' }], regime: { budgetMs: 1000 } },
};
const livePremise: Premise = {
  support: null,
  observable: { frame: 'territory' },
  measure: null,
  config: { opponents: [{ kind: 'human' }], regime: { budgetMs: 9850 } },
};
const transfer = transferVariance(MANIFEST, fitPremise, livePremise);
console.log('\ntransfer variance vs humans at production budget:', transfer.sigma2);
console.log('  by coordinate:', JSON.stringify(transfer.byCoordinate));
console.log('  earned precision in-corpus :', advisoryPrecision(FIT, 0).toFixed(3));
console.log('  earned precision vs humans :', advisoryPrecision(FIT, transfer.sigma2).toFixed(3));

// Names find, hashes validate — a carried line across `advance`.
const line = lineName([7, 3], 'queen->d4');
const trace: TraceRecord = {
  reads: [
    { coordinate: 'support.model', valueHash: 'aaa' },
    { coordinate: 'observable.frame', valueHash: 'bbb' },
  ],
  resultHash: 'ccc',
};
const sameTurn = (c: string): string | undefined => ({ 'support.model': 'aaa', 'observable.frame': 'bbb' }[c]);
const afterSpawn = (c: string): string | undefined => ({ 'support.model': 'zzz', 'observable.frame': 'bbb' }[c]);
console.log('\ncarried line:', line);
console.log('  valid within turn      :', traceValid(trace, sameTurn));
console.log('  valid after a spawn    :', traceValid(trace, afterSpawn), '(name still finds it; the trace refuses it)');

// Edge-credited spend: one cluster evaluation serving three branches.
console.log('\nedge credits for one shared evaluation:',
  JSON.stringify(creditSpend('cluster/3.7', [line, lineName([7], 'rook->a1'), lineName([3], 'pawn->e3')], 9)));

// The reduction returns a SET; the collapse happens once, at emission.
const survivors: ReductionResult = [
  { option: 'plan/a', condition: { support: { replies: 'R1' }, observable: null, measure: null, config: null } },
  { option: 'plan/b', condition: { support: { replies: 'R2' }, observable: null, measure: null, config: null } },
];
console.log('\nreduction survivors (advice reads these verbatim):', survivors.map((s) => s.option).join(', '));
console.log('  collapsed at emission ->', collapseAtEmission(survivors, (a, b) => a.option.localeCompare(b.option))?.option);

// Two currencies, no exchange rate: attention is a hard cap.
const budgets: Budgets = { quanta: 1000, attention: 2 };
console.log('\nattention spend 1 of 2:', JSON.stringify(spendAttention(budgets, 1)));
console.log('attention spend 3 of 2:', JSON.stringify(spendAttention(budgets, 3)));

// The miner's three rules.
const COLUMNS = new Map<string, Column>([
  ['sharePar', { name: 'sharePar' }],
  ['voronoiShare', { name: 'voronoiShare', bound: 441 }],
]);
console.log('\nminer:');
console.log('  known column          :', JSON.stringify(read(COLUMNS, 'sharePar', 1.02)));
console.log('  unknown column        :', JSON.stringify(read(COLUMNS, 'depthEffect', 0.3)));
console.log('  absent value          :', JSON.stringify(read(COLUMNS, 'sharePar', undefined)));
console.log('  statistic at its bound:', JSON.stringify(read(COLUMNS, 'voronoiShare', 441)));

console.log('\ndata entries pinned by version:', DATA.map((d) => d.id).join(', '));

// ---- cycle 14: the index as a PRODUCT of coordinate structures -------------
import { COORDINATES, cloneFindings, combine, purchasableMeets } from './manifest.ts';

const P = (h: number, model: string): Premise => ({
  support: { model }, observable: { horizon: h }, measure: null, config: null,
});
const eqIx = (x: Premise, y: Premise): boolean => JSON.stringify(x) === JSON.stringify(y);
const sameH = (x: Premise, y: Premise): boolean =>
  JSON.stringify((x.observable as { horizon: number }).horizon) ===
  JSON.stringify((y.observable as { horizon: number }).horizon);

console.log('\n--- the index ---');
console.log('purchasable by compute:', purchasableMeets().map((m) => m.path).join(', '));
console.log('NOT purchasable      :',
  COORDINATES.filter((c) => c.meet !== 'compute').map((c) => `${c.path}(${c.meet ?? 'none'})`).join(', '));
console.log('advance is a real computation only at:',
  COORDINATES.filter((c) => c.advance === 'update').map((c) => c.path).join(', ') || '(none)');
console.log('equality does NOT license tightening at:',
  COORDINATES.filter((c) => c.tighten !== true && c.join === true).map((c) => c.path).join(', '));

const same = P(1, 'm1');
console.log('\nsame index      :', JSON.stringify(combine({ bound: { lo: 2, hi: 9 }, at: same }, { bound: { lo: 4, hi: 7 }, at: same }, eqIx, sameH)));
console.log('cross-horizon   :', JSON.stringify(combine({ bound: { lo: 2, hi: 9 }, at: P(1, 'm1') }, { bound: { lo: 5, hi: 6 }, at: P(3, 'm1') }, eqIx, sameH)));
console.log('differing index :', JSON.stringify(combine({ bound: { lo: 2, hi: 9 }, at: P(1, 'm1') }, { bound: { lo: 4, hi: 7 }, at: P(1, 'm2') }, eqIx, sameH)));
console.log('inversion       :', JSON.stringify(combine({ bound: { lo: 8, hi: 9 }, at: same }, { bound: { lo: 1, hi: 2 }, at: same }, eqIx, sameH)));

console.log('\nclone detector:');
for (const f of cloneFindings([
  { name: 'EvalMemoKey', fields: ['weight', 'provenance'], usedAsKey: true },
  { name: 'BasisKey', fields: ['model', 'replies'], usedAsKey: true },
  { name: 'BoardHash', fields: ['bot'], usedAsKey: true, allowed: 'experiment-scale row key, reviewed' },
  { name: 'PlanKey', fields: ['unitId', 'to'], usedAsKey: true },
])) console.log(`  [${f.law}] ${f.detail}`);
