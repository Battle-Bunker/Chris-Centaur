/** TEMPORARY DIAGNOSTIC — not for commit. */
import type { Board, Coord, Snake } from '../../types/battlesnake';
import { makeSubstrate, clearGeometryCache, EngineSubstrate } from '../substrate';
import { heldOf, worldsOf, type LawCase } from './laws';
import { standingOf } from './features';
import type { Candidate, JointPlan, UnitId } from '../contracts';

const TURN = 40;
const OURS = 'red';
const THEIRS = 'blue';
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function unitOf(id: string, body: ReadonlyArray<Coord>, teamID: string, extra: Record<string, unknown> = {}): Snake {
  return { id, name: id, latency: '0', health: 90, body: [...body], head: body[0] as Coord,
    length: body.length, shout: '', squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 }, teamID, ...extra } as unknown as Snake;
}
const PIECES = ['queen', 'rook', 'bishop', 'knight', 'pawn'] as const;
function boardAt(seed: number, size: number, perSide: number, food: number, potions: number): Board | null {
  const r = rng(seed);
  const taken = new Set<number>();
  const free = (): Coord | null => {
    for (let tries = 0; tries < 60; tries++) {
      const x = 1 + Math.floor(r() * (size - 2));
      const y = 1 + Math.floor(r() * (size - 2));
      const c = y * size + x;
      if (taken.has(c)) continue;
      taken.add(c); return { x, y } as Coord;
    }
    return null;
  };
  const snakes: Snake[] = [];
  for (const team of [OURS, THEIRS]) {
    for (let i = 0; i < perSide; i++) {
      const head = free();
      if (head === null) return null;
      if (r() < 0.5) {
        const len = 2 + Math.floor(r() * 3);
        const body: Coord[] = [head];
        let ok = true;
        for (let k = 1; k < len; k++) {
          const prev = body[k - 1] as Coord;
          const next = { x: prev.x, y: prev.y - 1 } as Coord;
          const c = next.y * size + next.x;
          if (next.y < 0 || taken.has(c)) { ok = false; break; }
          taken.add(c); body.push(next);
        }
        if (!ok || body.length < 2) return null;
        snakes.push(unitOf(`${team}${i}`, body, team));
      } else {
        const kind = PIECES[Math.floor(r() * PIECES.length)] as string;
        const weight = 1 + Math.floor(r() * 3);
        snakes.push(unitOf(`${team}${i}`, [head], team, { unitType: kind, length: weight }));
      }
    }
  }
  const foodAt: Coord[] = [];
  for (let i = 0; i < food; i++) { const c = free(); if (c !== null) foodAt.push(c); }
  const potionAt: Coord[] = [];
  for (let i = 0; i < potions; i++) { const c = free(); if (c !== null) potionAt.push(c); }
  return { width: size, height: size, food: foodAt, hazards: [], snakes,
    ...(potionAt.length > 0 ? { invulnerabilityPotions: potionAt, invulnerabilityPotionsEnabled: true } : {}) } as Board;
}
function caseFor(board: Board, seed: number): LawCase | null {
  const stages = board.snakes.filter((s) => (s as { teamID: string }).teamID === OURS).map((s) => s.id);
  if (stages.length === 0) return null;
  const sub = makeSubstrate({ board, turn: TURN, asTeam: OURS, modeled: stages });
  const r = rng(seed + 7919);
  const orders = new Map<string, number>();
  try {
    for (const wireId of stages) {
      const unit = sub.unitOfWireId(wireId);
      if (unit === undefined) return null;
      const options = sub.actionsOf(unit.unitId);
      if (options.length === 0) return null;
      orders.set(wireId, (options[Math.floor(r() * options.length)] as Candidate).to);
    }
  } finally { sub.release(); }
  return { name: `board ${seed}`, board, turn: TURN, asTeam: OURS, stages, orders };
}
function planFor(sub: EngineSubstrate, c: LawCase): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const wireId of c.stages) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) throw new Error('no unit');
    const to = c.orders.get(wireId) as number;
    plan.set(unit.unitId, { unitId: unit.unitId, from: -1, to, path: sub.pathFor(unit.unitId, to) ?? [] });
  }
  return plan;
}
const SHAPES = [
  { perSide: 1, size: 7, food: 1, potions: 0 },
  { perSide: 2, size: 7, food: 2, potions: 0 },
  { perSide: 2, size: 7, food: 1, potions: 2 },
  { perSide: 3, size: 8, food: 2, potions: 0 },
  { perSide: 3, size: 8, food: 2, potions: 2 },
  { perSide: 1, size: 6, food: 1, potions: 1 },
];

const HALTING = new Set(['contest', 'edge', 'bodyBlock', 'durable', 'exhaustion', 'grammar', 'sever']);

interface Info { wire: string; cell: number; trav: ReadonlyArray<number>; origin: number; fate: string; kinds: string[] }
function infoOf(sub: EngineSubstrate, plan: JointPlan, asTeam: number): Info[] {
  return sub.withResolution(plan, asTeam, ({ resolution }) => {
    const st = standingOf(sub, resolution, asTeam);
    const out: Info[] = [];
    for (const s of st) {
      if (s.team !== asTeam || s.held) continue;
      const u = sub.unitOf(s.unitId);
      const wire = u?.wireId ?? '?';
      const trav = (resolution.traversed as Record<string, ReadonlyArray<number>>)[wire] ?? [];
      const fate = (resolution.fates as Record<string, string>)[wire] ?? 'alive';
      const kinds = [...new Set(resolution.ledger.filter((d) => d.unitId === wire).map((d) => d.kind as string))];
      out.push({ wire, cell: s.cell, trav, origin: (u?.cells[0] ?? -1) as number, fate, kinds });
    }
    return out;
  });
}

afterEach(() => clearGeometryCache());

test('d1 diag 2: does a kind filter stay sound?', () => {
  let boards = 0, worlds = 0, moved = 0, badHalt = 0;
  const size = { all: 0, halt: 0, n: 0 };
  const movedKinds: Record<string, number> = {};
  const examples: string[] = [];
  for (let seed = 1; boards < 240 && seed <= 1440; seed++) {
    const shape = SHAPES[seed % SHAPES.length] as (typeof SHAPES)[number];
    const board = boardAt(seed, shape.size, shape.perSide, shape.food, shape.potions);
    if (board === null) continue;
    let c: LawCase | null = null;
    try { c = caseFor(board, seed); } catch { c = null; }
    if (c === null) continue;
    const sub = makeSubstrate({ board: c.board, turn: c.turn, asTeam: c.asTeam, modeled: c.stages });
    try {
      if (heldOf(sub, c).length === 0) continue;
      const asTeam = sub.teamNumber(c.asTeam);
      const pinfo = infoOf(sub, planFor(sub, c), asTeam);
      boards++;
      for (const p of pinfo) {
        size.n++;
        const cont = p.fate === 'contingent';
        size.all += cont ? new Set([p.cell, p.origin, ...p.trav]).size : 1;
        size.halt += cont && p.kinds.some((k) => HALTING.has(k)) ? new Set([p.cell, p.origin, ...p.trav]).size : 1;
      }
      for (const world of worldsOf(sub, c, 96)) {
        const winfo = infoOf(sub, world.plan, asTeam);
        worlds++;
        for (const w of winfo) {
          const p = pinfo.find((x) => x.wire === w.wire);
          if (p === undefined || w.cell === p.cell) continue;
          moved++;
          for (const k of p.kinds) movedKinds[k] = (movedKinds[k] ?? 0) + 1;
          const gated = p.fate === 'contingent' && p.kinds.some((k) => HALTING.has(k));
          const set = gated ? new Set([p.cell, p.origin, ...p.trav]) : new Set([p.cell]);
          if (!set.has(w.cell)) {
            badHalt++;
            if (examples.length < 6) examples.push(`${c.name} ${w.wire}: ${w.cell} kinds=${JSON.stringify(p.kinds)} fate=${p.fate}`);
          }
        }
      }
    } catch { /* skip */ } finally { sub.release(); }
  }
  console.log(`boards=${boards} worlds=${worlds} moved=${moved} badHalt=${badHalt}`);
  console.log(`units=${size.n} avg all=${(size.all/size.n).toFixed(3)} halt=${(size.halt/size.n).toFixed(3)}`);
  console.log(`kinds present on relocations: ${JSON.stringify(movedKinds)}`);
  for (const e of examples) console.log('  ' + e);
}, 900000);
