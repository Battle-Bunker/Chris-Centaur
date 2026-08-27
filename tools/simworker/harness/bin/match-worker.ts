/**
 * The forked child: run one whole match per message, report the outcome.
 *
 * Nothing is written to the manifest here — the parent owns that file, so there
 * is exactly one writer. The child writes only its own replay, which is a path
 * no other child can collide with (the game id is unique in the job list).
 */

import { makeBot, shutdownDecisionPool, type Bot, type BotName } from '../lib/bots';
import { runMatch } from '../lib/match';
import type { SweepJob } from '../lib/sweep';

interface JobMsg {
  readonly type: 'job';
  readonly job: SweepJob;
  readonly sweepId: string;
  readonly replayDir: string;
}

const send = (msg: unknown): void => {
  process.send?.(msg);
};

process.on('message', (msg: JobMsg) => {
  if (msg?.type !== 'job') return;
  void (async () => {
    let bots: Bot[] | undefined;
    try {
      bots = msg.job.bots.map((b) => makeBot(b as BotName));
      const outcome = await runMatch({
        config: msg.job.config,
        bots: msg.job.bots,
        sweepId: msg.sweepId,
        gameId: msg.job.gameId,
        replayDir: msg.replayDir,
        made: bots,
      });
      send({ type: 'done', jobIndex: msg.job.jobIndex, outcome });
    } catch (err) {
      send({
        type: 'error',
        jobIndex: msg.job.jobIndex,
        error: String((err as Error)?.stack ?? err),
      });
    } finally {
      if (bots) for (const b of bots) b.release();
    }
  })();
});

// The parent kills children when the queue drains, but a child that is asked to
// go away politely still has to let go of the legacy pool's threads first.
process.on('SIGTERM', () => {
  shutdownDecisionPool();
  process.exit(0);
});
process.on('disconnect', () => {
  shutdownDecisionPool();
  process.exit(0);
});

send({ type: 'ready' });
