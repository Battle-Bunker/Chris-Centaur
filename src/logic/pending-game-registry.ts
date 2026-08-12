/**
 * PendingGameRegistry holds the games this centaur has been invited to whose
 * lobbies have NOT started yet (invite status 'pending'). The Firebase
 * interface keeps each entry's settings live from the lobby's setup doc; the
 * /play lobby renders them as non-clickable "pending" bubbles. Entries leave
 * the registry when the invite flips to 'started' (the normal game flow takes
 * over) or is deleted (team removed from the lobby).
 */

export interface PendingGameInfo {
  sessionID: string;
  gameID: string;
  boardWidth: number | null;
  boardHeight: number | null;
  snakesPerTeam: number | null;
  maxTurnTime: number | null;
  // `ours` marks the team controlled by THIS centaur (setup team id ==
  // configured centaur id) so the UI can say which centaur we are.
  teams: Array<{ id: string; name: string; color: string; ours: boolean }>;
}

export class PendingGameRegistry {
  private static instance: PendingGameRegistry;

  private pending = new Map<string, PendingGameInfo>(); // key: gameID
  private listeners: Array<() => void> = [];

  private constructor() {}

  public static getInstance(): PendingGameRegistry {
    if (!PendingGameRegistry.instance) {
      PendingGameRegistry.instance = new PendingGameRegistry();
    }
    return PendingGameRegistry.instance;
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  upsert(info: PendingGameInfo): void {
    this.pending.set(info.gameID, info);
    this.notify();
  }

  remove(gameID: string): void {
    if (this.pending.delete(gameID)) this.notify();
  }

  has(gameID: string): boolean {
    return this.pending.has(gameID);
  }

  list(): PendingGameInfo[] {
    return Array.from(this.pending.values());
  }
}
