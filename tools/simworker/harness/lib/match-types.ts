/**
 * Types shared between the match loop and the replay format, kept in their own
 * module so `replay.ts` (which a stage-2 miner imports on its own) does not
 * drag the whole engine in behind it.
 */

import type { TurnEvents } from './sim';

export type TeamEvents = TurnEvents;

export interface TeamStandingRow {
  readonly teamID: string;
  readonly seat: number;
  readonly units: number;
  readonly material: number;
  readonly health: number;
  readonly hasKing: boolean;
  readonly alive: boolean;
}
