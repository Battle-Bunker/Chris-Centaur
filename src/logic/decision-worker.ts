/**
 * Worker-thread entry for decision chunks. Receives ChunkJob messages,
 * evaluates them with the shared evaluateChunk, and posts results back.
 * All heavy state (evaluator, simulator) is constructed inside evaluateChunk
 * from the job payload, so workers are stateless and interchangeable.
 */

import { parentPort } from 'worker_threads';
import { evaluateChunk, ChunkJob } from './decision-chunk';

if (!parentPort) {
  throw new Error('decision-worker must be run as a worker thread');
}

parentPort.on('message', (msg: { id: number; job: ChunkJob }) => {
  try {
    const result = evaluateChunk(msg.job);
    parentPort!.postMessage({ id: msg.id, result });
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: String((err as Error)?.stack || err) });
  }
});
