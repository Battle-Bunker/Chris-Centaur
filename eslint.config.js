const eslint = require('@typescript-eslint/eslint-plugin');
const parser = require('@typescript-eslint/parser');
const path = require('path');

// ── Keepalive-ownership import restrictions ─────────────────────────────────
// Each restricted module has exactly ONE owning file, exempted via an
// override block below. NOTE: flat-config rule entries REPLACE (never merge)
// across matching blocks, so the restriction list is built per-block from
// this table — an owner's block re-declares every restriction except its own.
const RESTRICTED_IMPORTS = {
  firestoreOnSnapshot: {
    name: 'firebase/firestore',
    importNames: ['onSnapshot'],
    message:
      'onSnapshot subscriptions live only in src/firebase/firebase-interface.ts — ' +
      'the module that owns Firestore listener lifecycle (suspend/resume/watchdog). ' +
      'A listener opened elsewhere would survive suspension and hold the instance up.',
  },
  pgPool: {
    name: 'pg',
    importNames: ['Pool'],
    message:
      'Pool construction lives only in src/database/db.ts — one shared pool whose ' +
      'pool.end() the controller-orchestrated graceful shutdown owns. Import { db, pool } ' +
      'from src/database/db instead.',
  },
  workerThreads: {
    name: 'worker_threads',
    message:
      'worker_threads has exactly two owners, each of which terminates its own ' +
      'workers on idle entry AND at graceful shutdown: src/logic/decision-worker-pool.ts ' +
      '(legacy per-snake chunks; submit through DecisionWorkerPool) and ' +
      'src/lobster/parallel/pool.ts (the lobster evaluation pool; ask the ' +
      'TeamDecisionEngine, whose lifecycle owns it). Their worker entries — ' +
      'src/logic/decision-worker.ts and src/lobster/parallel/worker-entry.ts — are ' +
      'exempt too, because a worker entry is the one file that must read parentPort.',
  },
  ws: {
    name: 'ws',
    message:
      "The 'ws' module is owned by src/server/websocket-server.ts — the server whose " +
      'shutdown() closes every client socket so process exit stays reachable.',
  },
};

function restrictedImports(exceptKeys = [], patterns = []) {
  return [
    'error',
    {
      paths: Object.entries(RESTRICTED_IMPORTS)
        .filter(([key]) => !exceptKeys.includes(key))
        .map(([, entry]) => entry),
      ...(patterns.length > 0 ? { patterns } : {}),
    },
  ];
}

// ── Who may READ the per-branch belief ──────────────────────────────────────
// Core redesign §3.1 gives every branch a posterior alongside its sound
// interval. The increment that landed it made the belief non-deciding and said
// this rule would change deliberately when it got its readers. It has, and this
// is the changed rule.
//
// TWO READERS, AND THEY ARE NAMED: `src/lobster/kernel.ts` (the staging rows)
// and `src/lobster/search/core.ts` (the acceptance comparator's depth rung).
// Both are exempted below by file, not by pattern, so adding a third is a diff
// against this list rather than an import somebody did not notice.
//
// EVERYTHING ELSE IS STILL BANNED, and the two most important bans are the
// ones that never move: the BOUNDS layer, where a density reaching a proof
// would be the one unsound thing in the build; and `search/scout/**`, the
// depth layer itself, which publishes plain numbers and must not be able to
// decide what they are worth. The evaluators and the selection lottery stay
// out for the same reason they always were.
const BELIEF_PATTERN = {
  group: ['**/belief', '**/belief.ts', '../belief', '../../belief'],
  message:
    'This layer may not import src/lobster/belief.ts. Only the kernel and ' +
    'search/core.ts read the per-branch belief; the bounds layer may never ' +
    '(a density reaching a proof is the one unsound move in the build), and ' +
    'the depth layer under search/scout/** may never (it publishes values and ' +
    'does not decide what they are worth). Adding a reader is a change to the ' +
    'named list in eslint.config.js, where it can be reviewed.',
};

const TIMER_MESSAGE_TAIL =
  'from src/server/activity-controller.ts so idle teardown stays reliable: managed ' +
  "timers are registry-tracked, auto-unref'd, paused by scope while idle, and cleared " +
  'at shutdown; transient wrappers are the sanctioned auto-unref one-offs.';

// The two vendored trees are byte-for-byte copies of somebody else's source
// (src/engine-vendor/VENDOR.md, src/partial-engine/VENDOR-MANIFEST.json). They
// must stay identical to their origins, so they are not ours to lint: a style
// fix here would break the sync scripts and the vendor drift tests. Rule
// changes go upstream — to TacticToes, and to snek-centaur-platform.
//
// wire-adapter.ts sits in src/partial-engine/ but is OURS — the translation
// between the wire's weight encoding and the engine's — so it is un-ignored
// and linted like any other file we wrote.
const VENDORED = [
  'src/engine-vendor/**',
  'src/partial-engine/**',
  '!src/partial-engine/wire-adapter.ts',
];

module.exports = [
  {
    files: ['src/**/*.ts'],
    ignores: ['dist/**', 'node_modules/**', '*.js', 'jest.config.js', 'eslint.config.js', ...VENDORED],
    languageOptions: {
      parser: parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: path.resolve(__dirname),
        ecmaVersion: 2020,
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': eslint
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'all',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: false,
          caughtErrors: 'all'
        }
      ],
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-useless-constructor': 'error',
      'no-unused-labels': 'error',
      'no-unreachable': 'error',
      'no-unreachable-loop': 'error'
    }
  },

  // ── Keepalive control: no bare timers outside the ActivityController ──────
  // Unmanaged timers are exactly how idle teardown regressed before the
  // controller existed. Tests are exempt; src/web/** is browser runtime and
  // is not part of the TypeScript lint surface at all.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/server/activity-controller.ts', 'src/tests/**', ...VENDORED],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='setInterval']",
          message:
            'Bare setInterval is banned in server code: use ActivityController.managedInterval ' +
            '(long-lived, scope-aware) or transientInterval (short-lived) ' + TIMER_MESSAGE_TAIL,
        },
        {
          selector: "CallExpression[callee.name='setTimeout']",
          message:
            'Bare setTimeout is banned in server code: use ActivityController.managedTimeout, ' +
            'transientTimeout, or transientDelay ' + TIMER_MESSAGE_TAIL,
        },
      ],
    },
  },

  // ── CL4 contract rule 20: the selection layer has no clock and no RNG ─────
  // "Every stochastic choice draws from the path-addressed PRNG keyed on the
  // logged private per-match seed; per-arm draw counters; no Math.random,
  // Date.now, performance.now in selection/**; the clock reaches selection only
  // through BudgetHandle." A Math.random here would make a decision
  // unreplayable, and an unreplayable decision cannot be attributed to a code
  // change — which is this whole program's measurement discipline. A clock read
  // here would put wall time inside a draw and break the two-budget prefix
  // property. Both are structural, so both are lint errors rather than review
  // notes.
  {
    files: ['src/lobster/selection/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message:
            'Math.random is banned in src/lobster/selection/**: every draw must be a pure ' +
            'function of (decision seed, node, arm, draw index) — see selection/rng.ts. ' +
            'A non-replayable decision cannot be attributed to a code change.',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message:
            'Date.now is banned in src/lobster/selection/**: the clock reaches selection only ' +
            'as a remaining-budget FRACTION the search computed from BudgetHandle, and it ' +
            'reaches exactly one quantity (the temperature). See contract rule 20.',
        },
        {
          selector:
            "MemberExpression[object.name='performance'][property.name='now']",
          message:
            'performance.now is banned in src/lobster/selection/**: see the Date.now message. ' +
            'The one clock is BudgetHandle, and the selection layer never holds it.',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='hrtime']",
          message:
            'process.hrtime is banned in src/lobster/selection/**: see the Date.now message.',
        },
      ],
    },
  },

  // ── CL6 Door A: the scout has no clock, and no route to a bound ──────────
  // The scout spends in RESOLUTION-EQUIVALENTS, converted once from the
  // decision budget the caller already read. A clock read per ply would make
  // the park decision — and therefore the thread set, the findings and the
  // candidate order — a function of how loaded the box was, which is a search
  // whose result cannot be reproduced and therefore cannot be attributed to a
  // code change. Same discipline as `selection/**`, same reason.
  //
  // The bound ban is the firewall (la-outside L2/L8) in its lint form: under a
  // V-one frame, depth may move est, candidate order and scheduler priors, and
  // nothing else. There is no third route, so there is no import.
  {
    files: ['src/lobster/search/scout/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message:
            'Date.now is banned in src/lobster/search/scout/**: the scout spends in ' +
            'resolution-equivalents, converted once from the decision budget. A clock read ' +
            'here makes the thread set a function of the box and fails the determinism gate.',
        },
        {
          selector: "MemberExpression[object.name='performance'][property.name='now']",
          message: 'performance.now is banned in src/lobster/search/scout/**: see the Date.now message.',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='hrtime']",
          message: 'process.hrtime is banned in src/lobster/search/scout/**: see the Date.now message.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message:
            'Math.random is banned in src/lobster/search/scout/**: a thread set that is not a ' +
            'pure function of the board cannot be replayed, and an unreplayable finding cannot ' +
            'be attributed.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/bounds', '**/bounds/*'],
              message:
                'The scout may not import the bounds layer. Depth is provenance, never ' +
                'denomination (la-outside L1): a thread finding reaches a decision only as an ' +
                'ordering term through CL3\'s UnaryLookup seam, which feeds a surrogate and ' +
                'never a bound. There is no second route, so there is no import.',
            },
          ],
        },
      ],
    },
  },

  // ── Keepalive ownership: restricted imports (base — applies everywhere) ───
  {
    files: ['src/**/*.ts'],
    ignores: ['src/tests/**', ...VENDORED],
    rules: {
      'no-restricted-imports': restrictedImports(),
    },
  },
  // Per-owner exemptions: each owner keeps every restriction except its own.
  {
    files: ['src/firebase/firebase-interface.ts'],
    rules: { 'no-restricted-imports': restrictedImports(['firestoreOnSnapshot']) },
  },
  {
    files: ['src/database/db.ts'],
    rules: { 'no-restricted-imports': restrictedImports(['pgPool']) },
  },
  {
    files: [
      'src/logic/decision-worker-pool.ts',
      'src/logic/decision-worker.ts',
      'src/lobster/parallel/pool.ts',
      'src/lobster/parallel/worker-entry.ts',
    ],
    rules: { 'no-restricted-imports': restrictedImports(['workerThreads']) },
  },
  {
    files: ['src/server/websocket-server.ts'],
    rules: { 'no-restricted-imports': restrictedImports(['ws']) },
  },

  // ── Core redesign §3.1: who may read the belief ──────────────────────────
  // The bounds bank, the depth layer, the evaluators and the selection lottery
  // may not import it. `search/core.ts` is exempted by name in the block after
  // this one — flat config's LAST matching entry wins, so the exemption has to
  // come after the ban and not before it. See BELIEF_PATTERN above.
  //
  // LAST IN THE ARRAY ON PURPOSE. Flat-config rule entries REPLACE rather than
  // merge, so a `no-restricted-imports` block placed before the keepalive base
  // block below-the-fold is silently overwritten by it. This block therefore
  // re-declares the base paths alongside the pattern, and sits after every
  // other declaration of the rule.
  //
  // PRE-EXISTING AND DELIBERATELY NOT REPAIRED HERE: the scout's own
  // `no-restricted-imports` (its bounds ban, above) is shadowed by exactly that
  // ordering and does not currently fire. Repairing it would newly constrain
  // the scout, which is out of this increment's scope; it is recorded rather
  // than silently changed.
  {
    files: [
      'src/lobster/bounds/**/*.ts',
      'src/lobster/search/**/*.ts',
      'src/lobster/evaluate/**/*.ts',
      'src/lobster/selection/**/*.ts',
    ],
    rules: { 'no-restricted-imports': restrictedImports([], [BELIEF_PATTERN]) },
  },

  // ── The one exemption inside search/, by name ────────────────────────────
  // `search/core.ts` owns `better()`, which is where a trial is accepted or
  // refused — so it is where a deepened line's value has to be able to speak
  // if depth is to change a decision at all. It reads the belief algebra and
  // nothing else from that module: it folds one observation onto the same
  // near-half assembly the kernel builds, and compares. It still cannot reach
  // a bound (the bounds layer's own ban is unchanged), and the depth layer
  // that PRODUCES the observation still cannot reach the belief at all.
  {
    files: ['src/lobster/search/core.ts'],
    rules: { 'no-restricted-imports': restrictedImports([]) },
  },
];
