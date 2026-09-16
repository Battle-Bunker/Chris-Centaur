/**
 * THE STRUCTURAL GUARD: no key ever reaches visible text.
 *
 * `docs/design/ux/17-NAMING.md`. Three reports of the same defect — a stage
 * line reading `Bot stages MtFzgU4gnzeINlv1b6AN → right`, a header reading
 * `Game akV8HcVRCwPbMN9WDy26` — and two client-side repairs that both passed
 * on the walkthrough harness. They passed because the harness's ids are five
 * characters long, so the thing under test never happened there.
 *
 * So this file builds its frame THROUGH THE PRODUCTION TRANSLATION, from a
 * TacticToes setup with the ids a real game has: 20-character document ids,
 * the team's first unit keyed by the bare team id and the rest `#n`. It then
 * renders every producer the page draws from and asserts, over the VISIBLE
 * TEXT only, that no opaque token survives.
 *
 * It is ONE assertion, and it is structural: it fails on the defect itself
 * rather than on a symptom somebody remembered to enumerate. It replaces the
 * deleted `humanise` / `setNames` boundary, which could only ever hide it.
 */

import { buildBoardState } from '../firebase/translate';
import { applyEvent, emptyStore, frameAt } from '../lens/store';
import {
  renderFrame,
  renderTimeline,
  initialCursor,
  applyCursorEvent,
  stageSummary,
} from '../lens/view';
import { namesFromBoard, unitName } from '../logic/naming';
import type { TTGameSetup, TTTurn } from '../firebase/tactictoes-types';
import type { LensFrame, TurnEvent, UnitKey } from '../lens/types';

const LensPanel = require('../web/lens-panel.js');

// ---------------------------------------------------------------- the ids
//
// Verbatim shapes from the owner's screenshot: a 20-character centaur document
// id, and its team's second unit under the `#2` slot.
const RED = 'MtFzgU4gnzeINlv1b6AN';
const BLUE = 'akV8HcVRCwPbMN9WDy26';
const GAME = 'QpZ3mK9dLrTvXs2Yb7Wc';

const W = 8;
const H = 7;
const idx = (x: number, y: number) => y * W + x;

const UNITS = [RED, `${RED}#2`, BLUE, `${BLUE}#2`];

/**
 * A REAL GAME'S SETUP — and deliberately WITHOUT letters on two of its units,
 * because a document that names none is exactly the case the naming module
 * exists to cover and exactly the case the old code produced a blank letter
 * (and therefore a printed key) for.
 */
function setup(over: Partial<TTGameSetup> = {}): TTGameSetup {
  return {
    teams: [
      { id: RED, name: 'Chris', color: '#e53935' },
      { id: BLUE, name: 'Charlie', color: '#1e88e5' },
    ],
    snakesPerTeam: 2,
    gamePlayers: [
      { id: RED, teamID: RED, letter: 'A' },
      { id: `${RED}#2`, teamID: RED, letter: 'B' },
      // The game server supplied nothing for Charlie's units.
      { id: BLUE, teamID: BLUE, letter: '' },
      { id: `${BLUE}#2`, teamID: BLUE, letter: '' },
    ],
    boardWidth: W,
    boardHeight: H,
    maxTurnTime: 10,
    ...over,
  };
}

function turnDoc(): TTTurn {
  return {
    playerEnergy: { [RED]: 90, [`${RED}#2`]: 80, [BLUE]: 70, [`${BLUE}#2`]: 60 },
    startTime: null as never,
    endTime: null as never,
    moves: {},
    deaths: {},
    alivePlayers: [...UNITS],
    food: [idx(3, 3)],
    hazards: [],
    playerPieces: {
      [RED]: [idx(1, 1), idx(1, 2)],
      [`${RED}#2`]: [idx(5, 4), idx(5, 3)],
      [BLUE]: [idx(3, 1)],
      [`${BLUE}#2`]: [idx(2, 4)],
    },
    orientation: {
      [RED]: { dx: 0, dy: -1 },
      [`${RED}#2`]: { dx: 0, dy: 1 },
      [BLUE]: { dx: 0, dy: 1 },
      [`${BLUE}#2`]: { dx: 0, dy: -1 },
    },
    winners: [],
  } as unknown as TTTurn;
}

// -------------------------------------------------------------- the assertion

/**
 * The one predicate. A token of 16+ id characters — with or without a `#n`
 * slot — is a key, and a key in visible text is the defect.
 */
const KEY = /[A-Za-z0-9_-]{16,}(#\d+)?/;

/** Visible text: tag names, attribute values and comments are ADDRESSES and
 *  keep their keys (`data-unit="…"` is what the handlers look units up by). */
function visibleText(html: string): string {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expectNoKeys(where: string, html: string): void {
  const text = visibleText(html);
  const hit = KEY.exec(text);
  if (hit) {
    throw new Error(
      `${where} printed an opaque key: "${hit[0]}"\n` +
        `  in: ${text.slice(Math.max(0, hit.index - 60), hit.index + 80)}\n` +
        `  Names are produced on the server (src/logic/naming.ts) and travel on ` +
        `the frame — fix it there, not here. See docs/design/ux/17-NAMING.md.`
    );
  }
}

// ---------------------------------------------------------------- the frame

const anchorFor = (settlement: ReturnType<typeof buildBoardState>): TurnEvent =>
  ({
    id: 'e0',
    gameId: GAME,
    turn: settlement.turn,
    seq: 0,
    atWall: 1_700_000_000_000,
    atWorkMs: 0,
    kind: 'board.arrived',
    actor: { kind: 'server', id: null, name: 'the server', color: null },
    unit: null,
    causedBy: null,
    answers: null,
    payload: {
      boardHash: 'deadbeef',
      deadlineMs: 500,
      turnExpiryTime: 0,
      roster: [...UNITS],
      alive: [...UNITS],
      settlement,
      // Exactly what `ActiveGameManager.lensWriterFor` writes.
      names: namesFromBoard(settlement, {
        teams: [
          { id: RED, name: 'Chris', color: '#e53935' },
          { id: BLUE, name: 'Charlie', color: '#1e88e5' },
        ],
        operators: { op_7: { id: 'op_7', name: 'Ada', color: '#8e24aa' } },
      }),
    },
  }) as unknown as TurnEvent;

function stagedEvent(seq: number, unit: string, to: number): TurnEvent {
  return {
    id: `e${seq}`,
    gameId: GAME,
    turn: 41,
    seq,
    atWall: 1_700_000_000_000 + seq,
    atWorkMs: seq * 3,
    kind: 'stage.requested',
    actor: { kind: 'operator', id: 'op_7', name: 'Ada', color: '#8e24aa' },
    unit,
    causedBy: null,
    answers: null,
    payload: { unit, to, source: 'manual' },
  } as unknown as TurnEvent;
}

/** The kernel's partition over this turn — without it the stage line has no
 *  units to speak about, which is the one way this guard could pass vacuously. */
function partitionEvent(): TurnEvent {
  return {
    id: 'e1',
    gameId: GAME,
    turn: 41,
    seq: 1,
    atWall: 1_700_000_000_001,
    atWorkMs: 2,
    kind: 'partition',
    actor: { kind: 'bot', id: null, name: 'the bot', color: null },
    unit: null,
    causedBy: null,
    answers: null,
    payload: {
      generation: 0,
      epoch: 0,
      posture: 'SIGHTED',
      clusters: [
        {
          id: 0,
          key: `k:${RED}+${RED}#2`,
          generation: 0,
          members: [RED, `${RED}#2`],
          boundedBy: [],
          lineage: [],
          epoch: 0,
          posture: 'SIGHTED',
          basis: 'basis:[]',
        },
      ],
      changes: [],
    },
  } as unknown as TurnEvent;
}

function realFrame(): { frame: LensFrame; events: TurnEvent[] } {
  const settlement = buildBoardState(GAME, setup(), turnDoc(), 41, null);
  const anchor = anchorFor(settlement);
  const events = [anchor, partitionEvent(), stagedEvent(2, RED, 26), stagedEvent(3, `${RED}#2`, 39)];
  let store = emptyStore(anchor);
  for (const e of events.slice(1)) store = applyEvent(store, e);
  return { frame: frameAt(store, 3), events };
}

// ------------------------------------------------------------------- the tests

describe('every entity reaches the page with a human name', () => {
  it('names a real game’s units through the production translation', () => {
    const settlement = buildBoardState(GAME, setup(), turnDoc(), 41, null);
    const byId = new Map(settlement.board.snakes.map((s) => [s.id, s]));
    expect(byId.get(RED)?.name).toBe('Chris A');
    expect(byId.get(`${RED}#2`)?.name).toBe('Chris B');
    // The setup named no letters for Charlie: the naming module assigned them,
    // deterministically, by unit order.
    expect(byId.get(BLUE)?.letter).toBe('A');
    expect(byId.get(BLUE)?.name).toBe('Charlie A');
    expect(byId.get(`${BLUE}#2`)?.name).toBe('Charlie B');
    expect(byId.get(RED)?.teamName).toBe('Chris');
  });

  it('titles the game from its teams, because the document has none', () => {
    const settlement = buildBoardState(GAME, setup(), turnDoc(), 41, null);
    const title = namesFromBoard(settlement, {
      teams: [
        { id: RED, name: 'Chris', color: '#e53935' },
        { id: BLUE, name: 'Charlie', color: '#1e88e5' },
      ],
    }).title;
    expect(title).toBe('Chris vs Charlie, turn 41');
    expectNoKeys('the page header', `<h1>${title}</h1>`);
  });

  it('carries a name on every UnitRow and every staged view', () => {
    const { frame } = realFrame();
    expect(frame.units.length).toBe(4);
    for (const row of frame.units) {
      expect(row.name).toBeTruthy();
      expect(KEY.test(row.name)).toBe(false);
      expect(row.letter).toBeTruthy();
    }
    for (const key of Object.keys(frame.staged)) {
      expect(frame.staged[key]?.name).toBeTruthy();
      expect(KEY.test(String(frame.staged[key]?.name))).toBe(false);
    }
    expect(frame.names.title).toBe('Chris vs Charlie, turn 41');
  });

  it('prints no key in the rail, the lane, the stage line or the header', () => {
    const { frame, events } = realFrame();
    const cursor = applyCursorEvent(initialCursor(), frame, {
      t: 'focus',
      unit: RED as UnitKey,
    });
    const transcript = renderFrame(frame, cursor);

    expectNoKeys('the rail', LensPanel.railHTML(transcript));
    expectNoKeys('the stage line', LensPanel.stageHTML(transcript, null));
    expectNoKeys(
      'the timeline lane',
      LensPanel.laneHTML(
        renderTimeline(events, frame.names)
          .filter((c) => c.op === 'timeline.tick')
          .map((c) => {
            // The page's own `lensLaneRows` shape, off the same tick op.
            const [lane, seq, atWorkMs, kind, operatorId, color, shape, operator, unit, name] =
              c.args;
            return { lane, seq, atWorkMs, kind, operatorId, color, shape, operator, unit, unitName: name };
          }),
        { seq: 2, expanded: true, badge: null }
      )
    );

    // The review's headline and its per-unit rows, in the words review.js uses.
    const dead = frame.units[0];
    expectNoKeys(
      'the review headline',
      `<span>we lost ${unitName(frame.names, dead!.unit)}</span>`
    );

    // And the sentence the defect was reported on, verbatim.
    const line = stageSummary(frame)
      .map((r) => `${r.name} → ${r.to === null ? 'no plan' : r.to}`)
      .join(' · ');
    expect(line).toContain('Chris A');
    expectNoKeys('the stage sentence', `<div>Bot stages ${line}</div>`);
  });

  it('keeps the keys where they address rather than inform', () => {
    const { frame } = realFrame();
    const transcript = renderFrame(
      frame,
      applyCursorEvent(initialCursor(), frame, { t: 'focus', unit: RED as UnitKey })
    );
    // The board's ink is addressed by key — that is not visible text, and it
    // must NOT be renamed, or nothing on the page can be clicked.
    const ink = LensPanel.inkFromTranscript(transcript);
    const addressed = JSON.stringify(ink);
    expect(addressed).toContain(RED);
  });
});
