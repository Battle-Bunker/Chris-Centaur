/**
 * A process-wide pool of worker threads evaluating decision chunks. One pool
 * serves every concurrent snake decision, so parallelism spans BOTH across
 * snakes and across simulations within a snake: each snake's chunks queue
 * FIFO and workers drain them as they free up.
 *
 * Sizing: DECISION_POOL_SIZE env override, else all-but-one CPU (min 2).
 *
 * Fallback: when the compiled worker file isn't available (ts-node dev,
 * ts-jest) or worker spawn fails, chunks run inline on the calling thread via
 * the same evaluateChunk — identical results, just without parallelism.
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { evaluateChunk, ChunkJob, ChunkResult } from './decision-chunk';

interface PendingEntry {
  resolve: (result: ChunkResult) => void;
  reject: (err: Error) => void;
}

export class DecisionWorkerPool {
  private static shared: DecisionWorkerPool | null = null;

  static getShared(): DecisionWorkerPool {
    if (!DecisionWorkerPool.shared) {
      DecisionWorkerPool.shared = new DecisionWorkerPool();
    }
    return DecisionWorkerPool.shared;
  }

  readonly size: number;
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ id: number; job: ChunkJob }> = [];
  private pending = new Map<number, PendingEntry>();
  private nextId = 1;
  private inline = false;

  constructor(size?: number) {
    const envSize = parseInt(process.env.DECISION_POOL_SIZE || '', 10);
    this.size = size ?? (Number.isFinite(envSize) && envSize >= 0
      ? envSize
      : Math.max(2, os.cpus().length - 1));

    const workerFile = path.join(__dirname, 'decision-worker.js');
    if (this.size === 0 || !fs.existsSync(workerFile)) {
      this.inline = true;
      if (this.size !== 0) {
        console.warn(`[DecisionWorkerPool] ${workerFile} not found (ts-node/test run?) — evaluating chunks inline on the main thread`);
      }
      return;
    }

    try {
      for (let i = 0; i < this.size; i++) {
        this.spawnWorker(workerFile);
      }
      console.log(`[DecisionWorkerPool] ${this.size} worker threads ready`);
    } catch (err) {
      console.error('[DecisionWorkerPool] Failed to spawn workers — falling back to inline evaluation:', err);
      this.shutdown();
      this.inline = true;
    }
  }

  private spawnWorker(workerFile: string): void {
    const worker = new Worker(workerFile);
    worker.unref();
    worker.on('message', (msg: { id: number; result?: ChunkResult; error?: string }) => {
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        if (msg.error !== undefined) entry.reject(new Error(msg.error));
        else entry.resolve(msg.result!);
      }
      this.release(worker);
    });
    worker.on('error', (err) => {
      console.error('[DecisionWorkerPool] Worker crashed — respawning:', err);
      this.workers = this.workers.filter(w => w !== worker);
      this.idle = this.idle.filter(w => w !== worker);
      try {
        this.spawnWorker(workerFile);
      } catch (respawnErr) {
        console.error('[DecisionWorkerPool] Respawn failed:', respawnErr);
      }
    });
    this.workers.push(worker);
    this.idle.push(worker);
  }

  private release(worker: Worker): void {
    const next = this.queue.shift();
    if (next) {
      worker.postMessage(next);
    } else {
      this.idle.push(worker);
    }
  }

  submit(job: ChunkJob): Promise<ChunkResult> {
    if (this.inline) {
      // Yield to the event loop between inline chunks so staging writes,
      // Firestore listeners and the web UI stay responsive.
      return new Promise((resolve, reject) => {
        setImmediate(() => {
          try {
            resolve(evaluateChunk(job));
          } catch (err) {
            reject(err as Error);
          }
        });
      });
    }

    const id = this.nextId++;
    return new Promise<ChunkResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const worker = this.idle.pop();
      if (worker) {
        worker.postMessage({ id, job });
      } else {
        this.queue.push({ id, job });
      }
    });
  }

  shutdown(): void {
    for (const worker of this.workers) {
      void worker.terminate();
    }
    this.workers = [];
    this.idle = [];
    this.queue = [];
    for (const [, entry] of this.pending) {
      entry.reject(new Error('DecisionWorkerPool shut down'));
    }
    this.pending.clear();
  }
}
