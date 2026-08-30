/**
 * THE BOT, AS DATA — the surface that replaced the feature flags.
 *
 * ── WHAT THIS FILE IS A GATE ON ────────────────────────────────────────────
 *
 * Three things, and only the first is ordinary unit testing.
 *
 *   1. DEFAULTS ARE THE SHIPPED BOT. Every field's default is the value that
 *      already ran, term for term. The cross-build identity gate
 *      (`src/tests/core-registry-identity.test.ts`) proves that end-to-end
 *      against a frozen golden; this proves it field by field, so a regression
 *      names the field instead of naming a board.
 *   2. THE ENVIRONMENT CANNOT MOVE IT. Every variable the teardown deleted is
 *      set here at once, and the resolved bot must be unmoved. A
 *      re-introduced `process.env` read anywhere in the resolution fails here,
 *      which is the whole point of writing it down: the owner's ruling was not
 *      only "remove these flags", it was "stop using this strategy".
 *   3. A BAD CONFIG IS A REFUSAL, NOT A SILENT DEFAULT. This is the practical
 *      difference from the flags and the reason the teardown makes measurement
 *      cheaper rather than only tidier. Every `CENTAUR_*` flag parsed exactly
 *      `1|on|true` and warned on nothing, so `yes` and `ON` were silently off
 *      and an arm with a typo was an A/A null wearing a treatment's name —
 *      indistinguishable, after the fact, from a real null result. A contender
 *      file is validated on the way in instead.
 */

import {
  DEFAULT_BOT_CONFIG,
  botConfigFromJson,
  resolveBotConfig,
} from '../bot-config';
import { DEFAULT_KNOBS } from '../candidates';
import { STAGING_SAFETY_DEFAULT, DEFAULT_ROYAL_REACHERS } from '../staging-safety';
import { DEFAULT_TERRITORY_REFINE } from '../evaluate/refine';
import { TIER_TRUTH } from '../tier-truth';
import { SLATE_LEGACY } from '../registry';

describe('the shipped bot is the default of every field', () => {
  test('every default is BY REFERENCE from the constant the shipped code reads', () => {
    // Not retyped values — the actual constants, so a moved default cannot
    // drift away from this file the way a copied literal would. Same
    // discipline the registry's legacy entries are held to.
    expect(DEFAULT_BOT_CONFIG).toEqual({
      name: 'default',
      slate: SLATE_LEGACY,
      territoryRefine: DEFAULT_TERRITORY_REFINE,
      stagingSafety: STAGING_SAFETY_DEFAULT,
      candidates: {},
      engine: 'lobster',
      workers: 'off',
      workersAudit: false,
    });
  });

  test('and those constants are the values that actually shipped', () => {
    expect(DEFAULT_TERRITORY_REFINE).toBe(false);
    expect(STAGING_SAFETY_DEFAULT).toBe('auto');
    expect(DEFAULT_BOT_CONFIG.workers).toBe('off');
    expect(DEFAULT_BOT_CONFIG.engine).toBe('lobster');
    // Not bot fields, and deliberately: these two are CORRECTIONS, so there is
    // no arm to name. Pinned here anyway because this is the file someone
    // reads to find out what a bot can differ in, and "it cannot differ in
    // these" is part of that answer.
    expect(TIER_TRUTH).toBe('full');
    expect(DEFAULT_ROYAL_REACHERS).toBe(false);
    expect(DEFAULT_KNOBS.tierSafeStaging).toBe(true);
    expect(DEFAULT_KNOBS.selfDebuffOrdering).toBe(true);
    expect(DEFAULT_KNOBS.unitFatality).toBe(false);
    expect(DEFAULT_KNOBS.gainOrdering).toBe(true);
  });

  test('an empty config resolves to the shipped bot exactly', () => {
    expect(resolveBotConfig()).toEqual(DEFAULT_BOT_CONFIG);
    expect(resolveBotConfig({})).toEqual(DEFAULT_BOT_CONFIG);
    expect(botConfigFromJson({})).toEqual(DEFAULT_BOT_CONFIG);
  });
});

describe('the environment cannot move a bot', () => {
  const DEAD = {
    CENTAUR_ENGINE: 'legacy',
    CENTAUR_STAGING_SAFETY: 'off',
    CENTAUR_TERRITORY_REFINE: '1',
    CENTAUR_UNIT_FATALITY: '1',
    CENTAUR_TIER_TRUTH: 'off',
    CENTAUR_TIER_DEFENSE: 'off',
    CENTAUR_ROYAL_MARGIN: '1',
    CENTAUR_WORKERS: 'auto',
    CENTAUR_WORKERS_AUDIT: '1',
    CENTAUR_MUTUAL_WIPE_AWARD: '0',
  };
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const [k, v] of Object.entries(DEAD)) {
      saved.set(k, process.env[k]);
      process.env[k] = v;
    }
  });
  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved.clear();
  });

  test('every deleted flag set at once moves nothing', () => {
    expect(resolveBotConfig({})).toEqual(DEFAULT_BOT_CONFIG);
  });

  test('and the constants they used to drive are unmoved too', () => {
    // Read through fresh requires so a module that resolved at import time
    // could not hide behind this test's own module cache.
    jest.resetModules();
    const tier = require('../tier-truth') as typeof import('../tier-truth');
    const knobs = require('../candidates') as typeof import('../candidates');
    const safety = require('../staging-safety') as typeof import('../staging-safety');
    expect(tier.TIER_TRUTH).toBe('full');
    expect(tier.potionBoardEnabled()).toBe(true);
    expect(knobs.DEFAULT_KNOBS.tierSafeStaging).toBe(true);
    expect(knobs.DEFAULT_KNOBS.unitFatality).toBe(false);
    expect(safety.STAGING_SAFETY_DEFAULT).toBe('auto');
    expect(safety.DEFAULT_ROYAL_REACHERS).toBe(false);
  });
});

describe('a contender is named, and its fields take', () => {
  test('a partial is a DIFF from the shipped bot', () => {
    const bot = resolveBotConfig({ name: 'refiner', territoryRefine: true });
    expect(bot.name).toBe('refiner');
    expect(bot.territoryRefine).toBe(true);
    // Everything unnamed is still the shipped bot, which is what makes a
    // contender file readable as "what this arm changes".
    expect(bot.stagingSafety).toBe(DEFAULT_BOT_CONFIG.stagingSafety);
    expect(bot.engine).toBe(DEFAULT_BOT_CONFIG.engine);
    expect(bot.workers).toBe(DEFAULT_BOT_CONFIG.workers);
  });

  test('every field is reachable from JSON', () => {
    const json = {
      name: 'everything',
      slate: 'legacy',
      territoryRefine: true,
      stagingSafety: 'guard',
      candidates: { unitFatality: true, tierSafeStaging: false },
      engine: 'legacy',
      workers: 3,
      workersAudit: true,
    };
    expect(botConfigFromJson(json)).toEqual({
      name: 'everything',
      slate: 'legacy',
      territoryRefine: true,
      stagingSafety: 'guard',
      candidates: { unitFatality: true, tierSafeStaging: false },
      engine: 'legacy',
      workers: 3,
      workersAudit: true,
    });
  });

  test('workers takes the three spellings the pool understands', () => {
    expect(resolveBotConfig({ workers: 'off' }).workers).toBe('off');
    expect(resolveBotConfig({ workers: 'auto' }).workers).toBe('auto');
    expect(resolveBotConfig({ workers: 0 }).workers).toBe(0);
    expect(resolveBotConfig({ workers: 8 }).workers).toBe(8);
  });
});

describe('a bad config is a refusal, not a silent default', () => {
  test('an unknown field is refused BY NAME — the flag system could not do this', () => {
    // The failure this replaces: `CENTAUR_TERITORY_REFINE=1` (one r) was a
    // perfectly quiet no-op, and the arm reported a null.
    expect(() => botConfigFromJson({ teritoryRefine: true })).toThrow(/teritoryRefine/);
    expect(() => botConfigFromJson({ scout: 'observe' })).toThrow(/unknown bot config field/);
  });

  test('a bad value is refused, per field', () => {
    expect(() => botConfigFromJson({ stagingSafety: 'yes please' })).toThrow(/stagingSafety/);
    expect(() => botConfigFromJson({ territoryRefine: 'on' })).toThrow(/boolean/);
    expect(() => botConfigFromJson({ workersAudit: 1 })).toThrow(/boolean/);
    expect(() => botConfigFromJson({ name: 7 })).toThrow(/name/);
    expect(() => botConfigFromJson({ candidates: [] })).toThrow(/candidates/);
    expect(() => botConfigFromJson({ slate: 'aggressive' })).toThrow(/slate/);
    expect(() => botConfigFromJson([])).toThrow(/JSON object/);
    expect(() => botConfigFromJson(null)).toThrow(/JSON object/);
  });

  test('the two values that CAN fall back say so out loud', () => {
    // `engine` and `workers` keep a warn-and-default parse, because both are
    // read by code older than this module and their fallback direction is the
    // safe one. What they must never do is fall back SILENTLY.
    const said: string[] = [];
    const bot = resolveBotConfig(
      { engine: 'LEGACY' as never, workers: 'banana' as never },
      (m) => said.push(m)
    );
    expect(bot.engine).toBe('lobster');
    expect(bot.workers).toBe('off');
    expect(said).toHaveLength(2);
  });
});
