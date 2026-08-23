/**
 * Seeded board generation for the production-regime benches.
 *
 * Boards are REALISTIC in the sense that matters for this verification: the
 * shapes the production wire actually hands the decision layer — mixed
 * snake+piece rosters, kings (so regicide is live), two and three teams, 4 to
 * 26 units, 11x11 and larger. Nothing here re-implements a rule; the board is
 * a plain api `Board`, exactly the object `firebase-interface.ts` builds from
 * a turn document, and every rule question about it is answered by the
 * vendored resolver.
 *
 * Placement invariant: NO TWO UNITS SHARE A TURN-START CELL. That is not
 * cosmetic — B2's finding is that a shared start cell breaks the additive
 * floor lemma and the substrate throws `OverlappingUnitsError` on it. A
 * generator that emitted one would be measuring an unreachable board.
 */

import type { Board, Coord, Snake } from '../../src/types/battlesnake';
import { makeRng, type Rng } from './rng';

export type PieceKind = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type UnitSpecKind = PieceKind | 'snake';

/** Piece weight (stack size) by kind — the `length` field pieces carry. */
const WEIGHT: Record<PieceKind, number> = {
  king: 1,
  queen: 4,
  rook: 3,
  bishop: 2,
  knight: 2,
  pawn: 1,
};

export interface Scenario {
  readonly name: string;
  readonly size: number;
  readonly teams: number;
  /** Roster for EVERY team — identical rosters keep the pairing honest. */
  readonly roster: ReadonlyArray<UnitSpecKind>;
  readonly food: number;
  readonly hazards: number;
  readonly hazardDamage?: number;
  /** Snake body length at spawn. */
  readonly snakeLength?: number;
}

export const TEAM_IDS = ['red', 'blue', 'green'] as const;

/**
 * The scenario ladder. Names are load-bearing in the reports: every table row
 * cites the scenario it came from, so nothing is aggregated across shapes.
 */
export const SCENARIOS: Record<string, Scenario> = {
  // 4 units — small enough for exhaustive maximin truth.
  tiny2: { name: 'tiny2', size: 7, teams: 2, roster: ['king', 'snake'], food: 2, hazards: 0 },
  // 6 units on a production-sized board.
  duel11: { name: 'duel11', size: 11, teams: 2, roster: ['king', 'rook', 'snake'], food: 3, hazards: 0 },
  // 12 units, the common mid-game shape.
  mid11: {
    name: 'mid11',
    size: 11,
    teams: 2,
    roster: ['king', 'queen', 'rook', 'knight', 'snake', 'snake'],
    food: 4,
    hazards: 0,
  },
  // 12 units, hazards live.
  haz11: {
    name: 'haz11',
    size: 11,
    teams: 2,
    roster: ['king', 'queen', 'rook', 'knight', 'snake', 'snake'],
    food: 4,
    hazards: 6,
    hazardDamage: 15,
  },
  // 26 units — the contract's anytime-profile board.
  big13: {
    name: 'big13',
    size: 13,
    teams: 2,
    roster: [
      'king', 'queen', 'rook', 'rook', 'bishop', 'bishop', 'knight', 'knight',
      'pawn', 'pawn', 'snake', 'snake', 'snake',
    ],
    food: 5,
    hazards: 0,
  },
  // SNAKES ONLY — the one shape where the legacy path speaks for every unit
  // it owns, so the comparison isolates SEARCH from "legacy has no piece bot".
  snakes11: {
    name: 'snakes11',
    size: 11,
    teams: 2,
    roster: ['snake', 'snake', 'snake'],
    food: 4,
    hazards: 0,
  },
  snakes13: {
    name: 'snakes13',
    size: 13,
    teams: 2,
    roster: ['snake', 'snake', 'snake', 'snake', 'snake'],
    food: 5,
    hazards: 0,
  },
  // 12 units across THREE teams.
  three13: {
    name: 'three13',
    size: 13,
    teams: 3,
    roster: ['king', 'rook', 'bishop', 'snake'],
    food: 4,
    hazards: 0,
  },
  // 24 units across three teams on a bigger board.
  three15: {
    name: 'three15',
    size: 15,
    teams: 3,
    roster: ['king', 'queen', 'rook', 'knight', 'pawn', 'snake', 'snake', 'snake'],
    food: 6,
    hazards: 0,
  },
};

const KEY = (c: Coord): string => `${c.x},${c.y}`;

/** Team anchors: corners for 2 and 3 teams, so no team starts in a pocket. */
function anchorsFor(teams: number, size: number): Coord[] {
  const lo = 1;
  const hi = size - 2;
  if (teams <= 2) {
    return [
      { x: Math.floor(size / 2), y: lo },
      { x: Math.floor(size / 2), y: hi },
    ];
  }
  return [
    { x: lo, y: lo },
    { x: hi, y: hi },
    { x: lo, y: hi },
  ];
}

const DIRS: ReadonlyArray<Coord> = [
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
];

/** Cells within Chebyshev radius `r` of `anchor`, in board bounds. */
function region(anchor: Coord, r: number, size: number): Coord[] {
  const out: Coord[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      out.push({ x, y });
    }
  }
  return out;
}

export interface GeneratedBoard {
  readonly board: Board;
  readonly seed: number;
  readonly scenario: Scenario;
  /** wire ids per team id, in roster order. */
  readonly unitsByTeam: ReadonlyMap<string, ReadonlyArray<string>>;
}

export function generateBoard(scenario: Scenario, seed: number): GeneratedBoard {
  const rng = makeRng(seed);
  const size = scenario.size;
  const occupied = new Set<string>();
  const snakes: Snake[] = [];
  const unitsByTeam = new Map<string, string[]>();
  const anchors = anchorsFor(scenario.teams, size);
  const snakeLength = scenario.snakeLength ?? 3;

  for (let t = 0; t < scenario.teams; t++) {
    const teamID = TEAM_IDS[t] as string;
    const anchor = anchors[t] as Coord;
    // The team faces the board centre — pawn legality reads orientation.
    const centre = { x: (size - 1) / 2, y: (size - 1) / 2 };
    const faceApi: Coord = {
      x: Math.sign(centre.x - anchor.x),
      y: Math.sign(centre.y - anchor.y),
    };
    // Prefer a single cardinal facing; ties resolve to the vertical.
    const facing: Coord = faceApi.y !== 0 ? { x: 0, y: faceApi.y } : { x: faceApi.x, y: 0 };
    const ids: string[] = [];
    let radius = Math.max(2, Math.ceil(Math.sqrt(scenario.roster.length)) + 1);
    let pool: Coord[] = rng.shuffle(region(anchor, radius, size));
    let cursor = 0;

    const takeFree = (): Coord => {
      for (;;) {
        while (cursor < pool.length) {
          const c = pool[cursor++] as Coord;
          if (!occupied.has(KEY(c))) return c;
        }
        radius += 1;
        pool = rng.shuffle(region(anchor, radius, size));
        cursor = 0;
        if (radius > size) throw new Error('board too small for roster');
      }
    };

    scenario.roster.forEach((kind, i) => {
      const id = `${teamID[0]}${i}`;
      ids.push(id);
      if (kind === 'snake') {
        // A snake needs a free head plus `snakeLength-1` free trailing cells.
        let body: Coord[] | null = null;
        for (let attempt = 0; attempt < 400 && body === null; attempt++) {
          const head = takeFree();
          for (const d of rng.shuffle([...DIRS])) {
            const cells: Coord[] = [head];
            let ok = true;
            for (let k = 1; k < snakeLength; k++) {
              const c = { x: head.x - d.x * k, y: head.y - d.y * k };
              if (c.x < 0 || c.y < 0 || c.x >= size || c.y >= size || occupied.has(KEY(c))) {
                ok = false;
                break;
              }
              cells.push(c);
            }
            if (!ok) continue;
            body = cells;
            break;
          }
        }
        if (body === null) throw new Error(`could not place snake ${id}`);
        for (const c of body) occupied.add(KEY(c));
        const head = body[0] as Coord;
        const mid = body[1] as Coord;
        snakes.push({
          id,
          name: id,
          latency: '0',
          health: 100,
          body: body.map((c) => ({ ...c })),
          head: { ...head },
          length: body.length,
          shout: '',
          squad: '',
          letter: String.fromCharCode(65 + i),
          customizations: { color: '#ffffff', head: 'default', tail: 'default' },
          teamID,
          // Full-board convention: dy grows DOWNWARD, so api dy is negated.
          orientation: { dx: head.x - mid.x, dy: -(head.y - mid.y) },
        } as Snake);
        return;
      }
      const at = takeFree();
      occupied.add(KEY(at));
      snakes.push({
        id,
        name: id,
        latency: '0',
        health: 100,
        body: [{ ...at }],
        head: { ...at },
        length: WEIGHT[kind],
        shout: '',
        squad: '',
        letter: String.fromCharCode(65 + i),
        customizations: { color: '#ffffff', head: 'default', tail: 'default' },
        teamID,
        unitType: kind,
        orientation: { dx: facing.x, dy: -facing.y },
      } as Snake);
    });
    unitsByTeam.set(teamID, ids);
  }

  const free: Coord[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!occupied.has(KEY({ x, y }))) free.push({ x, y });
    }
  }
  rng.shuffle(free);
  const food = free.splice(0, scenario.food);
  const hazards = free.splice(0, scenario.hazards);

  const board: Board = {
    width: size,
    height: size,
    food,
    hazards,
    snakes,
    ...(scenario.hazardDamage !== undefined ? { hazardDamage: scenario.hazardDamage } : {}),
  } as Board;
  return { board, seed, scenario, unitsByTeam };
}

/** Scenario roster sanity: how many units a scenario fields in total. */
export function unitCount(s: Scenario): number {
  return s.teams * s.roster.length;
}

export function rngFor(seed: number): Rng {
  return makeRng(seed);
}
