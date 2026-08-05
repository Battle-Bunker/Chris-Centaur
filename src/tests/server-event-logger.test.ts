/**
 * Boot-forensics ordering tests for ServerEventLogger.
 *
 * The single server_liveness row is both the previous lifetime's death bound
 * (read by boot forensics) and the current lifetime's heartbeat target
 * (overwritten by upsert). These tests force the adversarial ordering — the
 * heartbeat trying to write before the forensic read has completed — and
 * verify the read always wins the race.
 */

// ---- Chainable db mock with controllable timing ----------------------------

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

// Recorded operations, in the order they actually EXECUTED against the "db".
const executed: Array<{ op: string; table: string; values?: any }> = [];
// Gate for the server_liveness SELECT (the forensic read).
let livenessSelectGate: Deferred<any[]>;
// Rows the forensic read returns.
let livenessRows: any[] = [];
// Rows the last-event SELECT returns.
let lastEventRows: any[] = [];

function tableName(t: any): string {
  // Drizzle tables carry their SQL name under a symbol; fall back to scanning.
  for (const s of Object.getOwnPropertySymbols(t ?? {})) {
    if (String(s).includes('Name') && typeof t[s] === 'string') return t[s];
  }
  return 'unknown';
}

jest.mock('../database/db', () => {
  const makeThenable = (exec: () => Promise<any>) => {
    const chain: any = {};
    for (const m of ['from', 'where', 'limit', 'orderBy', 'values', 'onConflictDoUpdate']) {
      chain[m] = (...args: any[]) => {
        chain._args = chain._args || {};
        chain._args[m] = args;
        return chain;
      };
    }
    chain.then = (onOk: any, onErr: any) => exec().then(onOk, onErr);
    chain.catch = (onErr: any) => exec().catch(onErr);
    return chain;
  };
  return {
    db: {
      select: (_fields?: any) => {
        const chain = makeThenable(async () => {
          const table = tableName(chain._args?.from?.[0]);
          if (table === 'server_liveness') {
            // Forensic read: blocks until the test opens the gate.
            const rows = await livenessSelectGate.promise;
            executed.push({ op: 'select', table });
            return rows;
          }
          executed.push({ op: 'select', table });
          return lastEventRows;
        });
        return chain;
      },
      insert: (table: any) => {
        const chain = makeThenable(async () => {
          executed.push({ op: 'insert', table: tableName(table), values: chain._args?.values?.[0] });
          return undefined;
        });
        return chain;
      },
    },
  };
});

import { ServerEventLogger } from '../logic/server-event-logger';

function freshLogger(): ServerEventLogger {
  (ServerEventLogger as any).instance = undefined;
  return ServerEventLogger.getInstance();
}

async function flushMicrotasks(times = 20) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
  executed.length = 0;
  livenessSelectGate = deferred<any[]>();
  livenessRows = [];
  lastEventRows = [];
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('boot forensics vs heartbeat race', () => {
  test('heartbeat upsert never executes before the forensic read of the previous row', async () => {
    const prevLastAlive = new Date('2026-08-01T00:00:00Z');
    livenessRows = [{ id: 1, pid: 111, bootedAt: new Date('2026-07-31T00:00:00Z'), lastAliveAt: prevLastAlive, lastActivityAt: null }];
    lastEventRows = [{ eventType: 'went-idle', timestamp: new Date('2026-07-31T23:50:00Z') }];

    const logger = freshLogger();
    logger.recordBoot({ port: 5000 });

    // Simulate the adversarial ordering: give the (immediate) heartbeat every
    // chance to run, and fire several timer ticks, while the forensic read is
    // still in flight.
    await flushMicrotasks();
    jest.advanceTimersByTime(3 * 60 * 1000);
    await flushMicrotasks();

    expect(executed.filter(e => e.op === 'insert' && e.table === 'server_liveness')).toHaveLength(0);

    // Now let the forensic read complete.
    livenessSelectGate.resolve(livenessRows);
    await flushMicrotasks();

    const livenessOps = executed.filter(e => e.table === 'server_liveness');
    expect(livenessOps.length).toBeGreaterThanOrEqual(2);
    // The FIRST liveness operation must be the read, never an insert.
    expect(livenessOps[0].op).toBe('select');
    // And the boot event recorded the PREVIOUS lifetime's bound, not ours.
    const bootInsert = executed.find(e => e.op === 'insert' && e.table === 'server_events');
    expect(bootInsert).toBeDefined();
    expect(bootInsert!.values.eventType).toBe('boot');
    const detailJson = JSON.parse(bootInsert!.values.detail.queryChunks
      ? extractJson(bootInsert!.values.detail) : String(bootInsert!.values.detail));
    expect(detailJson.prevPid).toBe(111);
    expect(detailJson.prevLastAliveAt).toBe(prevLastAlive.getTime());
    expect(detailJson.prevEndClass).toBe('silent-kill');
  });

  test('normal silent-kill boot: idle previous lifetime classifies as silent-kill', async () => {
    livenessRows = [{ id: 1, pid: 42, bootedAt: new Date('2026-08-01T00:00:00Z'), lastAliveAt: new Date('2026-08-01T01:00:00Z'), lastActivityAt: null }];
    lastEventRows = [{ eventType: 'went-idle', timestamp: new Date('2026-08-01T00:55:00Z') }];
    livenessSelectGate.resolve(livenessRows); // read resolves promptly

    const logger = freshLogger();
    logger.recordBoot();
    await flushMicrotasks();

    const bootInsert = executed.find(e => e.op === 'insert' && e.table === 'server_events');
    const detailJson = JSON.parse(extractJson(bootInsert!.values.detail));
    expect(detailJson.prevEndClass).toBe('silent-kill');
    // Heartbeat lands only after the read.
    const livenessOps = executed.filter(e => e.table === 'server_liveness');
    expect(livenessOps[0].op).toBe('select');
    expect(livenessOps.some(e => e.op === 'insert')).toBe(true);
  });

  test('active previous lifetime classifies as crash', async () => {
    livenessRows = [{ id: 1, pid: 7, bootedAt: new Date('2026-08-01T00:00:00Z'), lastAliveAt: new Date('2026-08-01T01:00:00Z'), lastActivityAt: new Date('2026-08-01T00:59:00Z') }];
    lastEventRows = [{ eventType: 'woke', timestamp: new Date('2026-08-01T00:58:00Z') }];
    livenessSelectGate.resolve(livenessRows);

    const logger = freshLogger();
    logger.recordBoot();
    await flushMicrotasks();

    const bootInsert = executed.find(e => e.op === 'insert' && e.table === 'server_events');
    expect(JSON.parse(extractJson(bootInsert!.values.detail)).prevEndClass).toBe('crash');
  });
});

/** The detail value is a drizzle sql`${json}::jsonb` template — pull out the
 *  bound JSON string parameter. */
function extractJson(detail: any): string {
  if (typeof detail === 'string') return detail;
  const params: string[] = [];
  (function walk(node: any) {
    if (node == null) return;
    if (typeof node === 'string') { params.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.queryChunks) { walk(node.queryChunks); return; }
    if (node.value !== undefined) { walk(node.value); return; }
  })(detail);
  const json = params.find(p => p.startsWith('{'));
  if (!json) throw new Error('No JSON param found in sql detail');
  return json;
}
