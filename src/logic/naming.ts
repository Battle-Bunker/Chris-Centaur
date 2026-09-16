/**
 * THE ONE NAMING AUTHORITY.
 *
 * Every entity this server can show a human — a team, a unit, an operator, a
 * game — is named HERE, once, on the server, and the name travels with the
 * thing. Nothing downstream derives a name, guesses one, or repairs one: a
 * page that receives a key and no name prints the key, and a 20-character
 * document id is negative information (`docs/design/ux/17-NAMING.md`).
 *
 * The rule the whole file exists to keep: **an id is an address, a name is
 * content**. Addresses stay in attributes, handlers and maps; names are the
 * only thing that reaches visible text.
 *
 * DEPENDENCY-FREE ON PURPOSE. This module is imported by the Firebase
 * translation, by the game manager, by the lens reducer and — through the
 * `window.LensView` bundle — by the browser. It therefore imports TYPES only,
 * so bundling it costs nothing and the browser runs the same assignment the
 * server ran.
 */

import type { BoardSnapshot, Snake } from '../types/battlesnake';
import type { TTGameSetup } from '../firebase/tactictoes-types';

/** Letters in the order a team's units take them. */
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * A key long enough that a reader learns nothing from it. TacticToes document
 * ids are 20 characters; the guard test (`src/tests/lens-naming.test.ts`) uses
 * the same threshold, so anything this module is willing to PRINT is shorter
 * than anything the guard is willing to fail on.
 */
export const OPAQUE_KEY_CHARS = 16;

/** The Nth letter of a team's roster: `A…Z`, then `AA`, `AB`, … */
export function letterAt(index: number): string {
  if (index < 0) return '?';
  if (index < LETTERS.length) return LETTERS[index] as string;
  const first = Math.floor(index / LETTERS.length) - 1;
  return `${LETTERS[first] as string}${LETTERS[index % LETTERS.length] as string}`;
}

/** Is this string an opaque id rather than something a person would say? */
export function isOpaqueKey(text: string | null | undefined): boolean {
  if (!text) return false;
  const base = String(text).split('#')[0] as string;
  return base.length >= OPAQUE_KEY_CHARS && /^[A-Za-z0-9_-]+$/.test(base);
}

/**
 * THE LAST RESORT, and it is still not a key. A name is unavailable only when
 * nothing upstream carried one; the reader gets a short, obviously-partial
 * handle rather than twenty characters of document id.
 */
export function shortenKey(key: string): string {
  const text = String(key);
  const [base, slot] = text.split('#');
  const head = (base as string).slice(0, 4);
  return slot === undefined ? `${head}…` : `${head}…#${slot}`;
}

/** `team_red` → `Team Red`. Returns null when there is nothing to prettify. */
export function prettify(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  if (isOpaqueKey(raw)) return null;
  return String(raw)
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => (w.length > 1 && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export interface TeamIdentity {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
}

export interface UnitIdentity {
  readonly unit: string;
  readonly letter: string;
  /** `<team name> <letter>` — the whole of what a reader is shown. */
  readonly name: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly color: string | null;
}

export interface OperatorIdentity {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
}

/**
 * EVERY NAME A GAME HAS, as one value. It rides on the turn's anchor event, so
 * a fold that has the anchor has every name — including for units the board
 * has since dropped, which is exactly when a reader most needs them.
 */
export interface NameDirectory {
  /** "Chris vs Charlie" — the game's own title, never its id. */
  readonly title: string;
  readonly teams: Readonly<Record<string, TeamIdentity>>;
  readonly units: Readonly<Record<string, UnitIdentity>>;
  readonly operators: Readonly<Record<string, OperatorIdentity>>;
}

export const EMPTY_DIRECTORY: NameDirectory = Object.freeze({
  title: 'Game',
  teams: Object.freeze({}),
  units: Object.freeze({}),
  operators: Object.freeze({}),
});

/** A team's human name: what it was given, else a prettified id, else a short
 *  handle. NEVER the raw document id. */
export function teamNameOf(team: { id?: string | null; name?: string | null } | null | undefined): string {
  const given = team?.name ? String(team.name).trim() : '';
  if (given && !isOpaqueKey(given)) return given;
  const pretty = prettify(team?.id ?? null);
  if (pretty) return pretty;
  return team?.id ? `Team ${shortenKey(String(team.id))}` : 'Team';
}

/** A unit's human name — the one composition rule, stated once. */
export function unitNameOf(teamName: string, letter: string): string {
  const team = teamName.trim();
  const l = letter.trim();
  // With no team to qualify it, a unit IS its letter — the glyph on the board.
  if (!team) return l || 'Unit';
  if (!l) return team;
  // A team name that already ends in the letter ("Chris A") must not become
  // "Chris A A": the composition is idempotent. A ONE-WORD team name is never
  // treated as already carrying a letter, or a team called "A" would name its
  // first unit "A" and its second "A B".
  const words = team.split(/\s+/);
  return words.length > 1 && words[words.length - 1] === l ? team : `${team} ${l}`;
}

/** A game with no better name than its document id is called by a SHORT form
 *  of that id — head and tail, enough to tell two games apart, never the whole
 *  twenty characters. */
export function gameFallbackTitle(gameId: string | null | undefined): string {
  const id = gameId ? String(gameId).trim() : '';
  if (!id) return 'Game';
  if (id.length <= 10) return `Game ${id}`;
  return `Game ${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** The game's title, from the teams that are playing it. */
export function gameTitleOf(teams: ReadonlyArray<{ name: string }>, turn?: number | null): string {
  const names = teams.map((t) => t.name).filter(Boolean);
  const base = names.length === 0 ? 'Game' : names.join(' vs ');
  return turn == null || turn < 0 ? base : `${base}, turn ${turn}`;
}

/** One unit as a naming input: its key, its team, and whatever letter/name the
 *  game server happened to supply (either may be absent). */
export interface UnitInput {
  readonly unit: string;
  readonly teamId: string | null;
  readonly letter?: string | null;
  readonly name?: string | null;
}

export interface TeamInput {
  readonly id: string;
  readonly name?: string | null;
  readonly color?: string | null;
}

/**
 * THE ASSIGNMENT. Deterministic and total: every unit handed in comes back
 * with a letter and a name, whether or not the game server supplied either.
 *
 * Letters are assigned per team IN THE ORDER THE UNITS ARRIVE, skipping
 * letters the server itself already claimed, so a board that carries letters
 * keeps exactly the letters it carries and a board that carries none still
 * reads `A B C`.
 */
export function assignNames(
  teams: ReadonlyArray<TeamInput>,
  units: ReadonlyArray<UnitInput>,
  options: { readonly title?: string | null; readonly turn?: number | null } = {}
): NameDirectory {
  const teamOut: Record<string, TeamIdentity> = {};
  const order: string[] = [];
  const noteTeam = (input: TeamInput): TeamIdentity => {
    const held = teamOut[input.id];
    if (held) return held;
    const made: TeamIdentity = {
      id: input.id,
      name: teamNameOf(input),
      color: input.color ?? null,
    };
    teamOut[input.id] = made;
    order.push(input.id);
    return made;
  };
  for (const team of teams) noteTeam(team);

  // A unit whose team was never declared still belongs to one; the unit key's
  // own stem is that team's id (TacticToes keys a team's first unit by the
  // team id itself and the rest `${teamId}#${k}`).
  const teamIdFor = (u: UnitInput): string =>
    u.teamId ?? (String(u.unit).split('#')[0] as string);

  const taken = new Map<string, Set<string>>();
  const next = new Map<string, number>();
  for (const u of units) {
    const id = teamIdFor(u);
    const given = u.letter ? String(u.letter).trim() : '';
    if (!given) continue;
    let set = taken.get(id);
    if (!set) {
      set = new Set<string>();
      taken.set(id, set);
    }
    set.add(given);
  }

  const unitOut: Record<string, UnitIdentity> = {};
  for (const u of units) {
    const id = teamIdFor(u);
    const team = teamOut[id] ?? noteTeam({ id });
    let letter = u.letter ? String(u.letter).trim() : '';
    if (!letter) {
      const claimed = taken.get(id) ?? new Set<string>();
      let i = next.get(id) ?? 0;
      while (claimed.has(letterAt(i))) i++;
      letter = letterAt(i);
      claimed.add(letter);
      taken.set(id, claimed);
      next.set(id, i + 1);
    }
    // A NAME THE SERVER SUPPLIED IS ONLY A NAME IF IT IS ONE. TacticToes falls
    // back to the raw player id when its setup has no row for the unit, and
    // that fallback is the defect this module exists to stop.
    const supplied = u.name ? String(u.name).trim() : '';
    const name =
      supplied && !isOpaqueKey(supplied) ? supplied : unitNameOf(team.name, letter);
    unitOut[u.unit] = {
      unit: u.unit,
      letter,
      name,
      teamId: id,
      teamName: team.name,
      color: team.color,
    };
  }

  const title =
    options.title && String(options.title).trim() && !isOpaqueKey(options.title)
      ? String(options.title).trim()
      : gameTitleOf(order.map((id) => teamOut[id] as TeamIdentity), options.turn ?? null);

  return { title, teams: teamOut, units: unitOut, operators: {} };
}

/** The directory a BOARD implies: its snakes' teams, in board order. */
export function namesFromBoard(
  snapshot: BoardSnapshot | null | undefined,
  options: {
    readonly title?: string | null;
    readonly teams?: ReadonlyArray<TeamInput>;
    readonly operators?: Readonly<Record<string, OperatorIdentity>>;
  } = {}
): NameDirectory {
  const snakes: ReadonlyArray<Snake> = snapshot?.board?.snakes ?? [];
  const teams: TeamInput[] = [...(options.teams ?? [])];
  const seen = new Set(teams.map((t) => t.id));
  for (const s of snakes) {
    const id = s.teamID ?? s.squad ?? (String(s.id).split('#')[0] as string);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    teams.push({ id, name: s.teamName ?? null, color: s.customizations?.color ?? null });
  }
  const dir = assignNames(
    teams,
    snakes.map((s) => ({
      unit: s.id,
      teamId: s.teamID ?? s.squad ?? null,
      letter: s.letter ?? null,
      name: s.name ?? null,
    })),
    { title: options.title ?? null, turn: snapshot?.turn ?? null }
  );
  return options.operators ? { ...dir, operators: options.operators } : dir;
}

/** The directory a SETUP document implies — the authority, because it lists
 *  every unit including the ones already dead. */
export function namesFromSetup(
  setup: TTGameSetup,
  options: { readonly title?: string | null; readonly turn?: number | null } = {}
): NameDirectory {
  return assignNames(
    (setup.teams ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color })),
    (setup.gamePlayers ?? []).map((gp) => ({
      unit: gp.id,
      teamId: gp.teamID,
      letter: gp.letter,
    })),
    options
  );
}

/** Two directories, later wins per key. Used where a board is richer than the
 *  setup for one turn and poorer for another. */
export function mergeDirectories(base: NameDirectory, over: NameDirectory): NameDirectory {
  return {
    title: over.title && over.title !== 'Game' ? over.title : base.title,
    teams: { ...base.teams, ...over.teams },
    units: { ...base.units, ...over.units },
    operators: { ...base.operators, ...over.operators },
  };
}

/** A unit's name out of a directory. TOTAL — never a key, never empty. */
export function unitName(dir: NameDirectory | null | undefined, unit: string | null | undefined): string {
  if (unit == null || unit === '') return 'no unit';
  // The evaluator's residue sentinel is a reading, not a unit.
  if (String(unit) === '#-1') return 'the evaluator residue';
  const hit = dir?.units?.[unit];
  if (hit) return hit.name;
  return isOpaqueKey(unit) ? `Unit ${shortenKey(String(unit))}` : String(unit);
}

/** A unit's letter out of a directory — the board glyph's own handle. */
export function unitLetter(dir: NameDirectory | null | undefined, unit: string | null | undefined): string {
  if (unit == null) return '';
  const hit = dir?.units?.[unit];
  if (hit) return hit.letter;
  return isOpaqueKey(unit) ? shortenKey(String(unit)) : String(unit);
}

/** An operator's name. TOTAL, for the same reason. */
export function operatorName(
  dir: NameDirectory | null | undefined,
  id: string | null | undefined,
  declared?: string | null
): string {
  const given = declared ? String(declared).trim() : '';
  if (given && !isOpaqueKey(given)) return given;
  if (id == null || id === '') return 'the bot';
  const hit = dir?.operators?.[id];
  if (hit) return hit.name;
  return isOpaqueKey(id) ? `Operator ${shortenKey(String(id))}` : String(id);
}

/**
 * STAMP THE NAMES ONTO THE WIRE'S OWN SNAKES. The board that leaves this
 * server carries `name`, `letter` and `teamName` on every unit, so no consumer
 * — the board renderer, the roster, a log reader — has to reconstruct one.
 */
export function applyNames<T extends Snake>(snakes: ReadonlyArray<T>, dir: NameDirectory): T[] {
  return snakes.map((s) => {
    const hit = dir.units[s.id];
    if (!hit) return s;
    return { ...s, name: hit.name, letter: hit.letter, teamName: hit.teamName };
  });
}

/**
 * A MACHINE KEY, SAID OUT LOUD. Evaluator feature keys (`lobster-territory`,
 * `h2h_risk`) are addresses in the ledger and words on the screen; the screen
 * gets the words. Hyphens and underscores are the key's own word breaks.
 */
export function featureLabel(key: string | null | undefined): string {
  if (key == null || key === '') return '';
  return String(key).split(/[-_.]+/).filter(Boolean).join(' ');
}
