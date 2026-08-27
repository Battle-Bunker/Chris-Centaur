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

function restrictedImports(exceptKeys = []) {
  return [
    'error',
    {
      paths: Object.entries(RESTRICTED_IMPORTS)
        .filter(([key]) => !exceptKeys.includes(key))
        .map(([, entry]) => entry),
    },
  ];
}

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
];
