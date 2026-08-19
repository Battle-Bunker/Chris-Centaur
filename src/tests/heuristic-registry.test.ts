/**
 * Guards the heuristic registry's "single source of truth" invariants:
 * the config UI must cover every config key exactly once (a heuristic with a
 * bad section id would silently vanish from the page), defaults must be
 * expressible on their own sliders, and DEFAULT_CONFIG's heuristic half must
 * be exactly the registry defaults.
 */

import {
  CONFIG_UI,
  HEURISTICS,
  HEURISTIC_KEYS,
  defaultHeuristicWeights,
} from '../config/heuristics';
import { DEFAULT_CONFIG } from '../config/game-config';

describe('heuristic registry', () => {
  test('config UI covers every config key exactly once', () => {
    const uiKeys = CONFIG_UI.flatMap(section => section.items.map(item => item.key));
    expect(new Set(uiKeys).size).toBe(uiKeys.length);
    expect([...uiKeys].sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort());
  });

  test('every numeric UI item carries a range; booleans none', () => {
    for (const section of CONFIG_UI) {
      for (const item of section.items) {
        if (item.type === 'number') {
          expect(item.range).toBeDefined();
          expect(item.range!.min).toBeLessThan(item.range!.max);
          expect(item.range!.step).toBeGreaterThan(0);
        } else {
          expect(item.range).toBeUndefined();
        }
      }
    }
  });

  test('every heuristic default lies within its own slider range', () => {
    for (const key of HEURISTIC_KEYS) {
      const spec = HEURISTICS[key];
      expect(spec.default).toBeGreaterThanOrEqual(spec.uiRange.min);
      expect(spec.default).toBeLessThanOrEqual(spec.uiRange.max);
    }
  });

  test('DEFAULT_CONFIG heuristic half equals the registry defaults', () => {
    const weights = defaultHeuristicWeights();
    for (const key of HEURISTIC_KEYS) {
      expect(DEFAULT_CONFIG[key]).toBe(HEURISTICS[key].default);
      expect(weights[key]).toBe(HEURISTICS[key].default);
    }
  });
});
