/**
 * THE heuristic registry — the single source of truth for every scoring
 * heuristic. Each entry carries the key's default weight, its config-page
 * slider range and copy, and which config-page section it renders under.
 *
 * Everything else is DERIVED from this table:
 *  - `HeuristicWeights` / `WeightedScores` / `HeuristicStats` types
 *    (board-evaluator re-exports them),
 *  - the BoardEvaluator default weights and its weighted-sum loops,
 *  - `DEFAULT_CONFIG`'s heuristic half (config/game-config.ts),
 *  - the decision-engine `DecisionConfig['weights']` shape,
 *  - the strategy's config→weights extraction and per-move breakdown,
 *  - the /api/config UI metadata that config.html renders its sliders from.
 *
 * Adding a heuristic = adding ONE entry here (plus computing its stat in
 * board-evaluator). Do not re-list heuristic names anywhere else.
 *
 * ORDER MATTERS: registry order is the total-score summation order (float
 * addition is not associative, and exact-value tests depend on the current
 * order) and the within-section order of the config page's sliders. Append
 * new keys at the end of their conceptual group rather than re-sorting.
 */

export interface UiRange {
  min: number;
  max: number;
  step: number;
}

export interface HeuristicSpec {
  /** Default weight — BoardEvaluator fallback and DEFAULT_CONFIG value. */
  default: number;
  /** Config-page slider/number-input range. */
  uiRange: UiRange;
  /** Config-page label. */
  label: string;
  /** Config-page help text under the slider. */
  description: string;
  /** Config-page section id (see CONFIG_SECTIONS). */
  section: string;
}

export const HEURISTICS = {
  // ── My snake ─────────────────────────────────────────────────────────────
  myLength: {
    default: 10.0,
    uiRange: { min: 0, max: 100, step: 0.5 },
    label: 'My Length Weight',
    description: "Value of your snake's length (survival priority)",
    section: 'snake',
  },
  myTerritory: {
    default: 1.0,
    uiRange: { min: 0, max: 100, step: 0.5 },
    label: 'My Territory Weight',
    description: 'Value of controlled Voronoi territory',
    section: 'snake',
  },
  myControlledFood: {
    default: 10.0,
    uiRange: { min: 0, max: 100, step: 0.5 },
    label: 'My Controlled Food Weight',
    description: 'Value of food within your territory',
    section: 'snake',
  },
  myControlledFertile: {
    default: 2.0,
    uiRange: { min: 0, max: 100, step: 0.5 },
    label: 'My Controlled Fertile Ground Weight',
    description: 'Value of fertile tiles within your territory',
    section: 'snake',
  },

  // ── Team ─────────────────────────────────────────────────────────────────
  teamLength: {
    default: 10.0,
    uiRange: { min: 0, max: 100, step: 0.5 },
    label: 'Team Length Weight',
    description: 'Combined team survival value',
    section: 'team',
  },
  teamTerritory: {
    default: 1.0,
    uiRange: { min: 0, max: 100, step: 0.5 },
    label: 'Team Territory Weight',
    description: 'Total team-controlled territory',
    section: 'team',
  },
  teamControlledFood: {
    default: 10.0,
    uiRange: { min: 0, max: 100, step: 0.5 },
    label: 'Team Controlled Food Weight',
    description: 'Food controlled by teammates',
    section: 'team',
  },

  // ── Food / proximity ─────────────────────────────────────────────────────
  foodProximity: {
    default: 50.0,
    uiRange: { min: 0, max: 200, step: 1 },
    label: 'Food Proximity Weight',
    description: 'Attraction to nearby food (normalized [0,1], zeroed when eating)',
    section: 'food',
  },
  foodEaten: {
    default: 200.0,
    uiRange: { min: 0, max: 500, step: 10 },
    label: 'Food Eaten Weight',
    description: 'Direct reward for actually eating food (overrides proximity)',
    section: 'food',
  },

  // ── Enemy (currently zero-weighted but tracked) ──────────────────────────
  enemyTerritory: {
    default: 0,
    uiRange: { min: -100, max: 100, step: 1 },
    label: 'Enemy Territory Weight',
    description: 'Value of enemy-controlled territory',
    section: 'combat',
  },
  enemyLength: {
    default: 0,
    uiRange: { min: -100, max: 100, step: 1 },
    label: 'Enemy Length Weight',
    description: 'Value of enemy snake lengths',
    section: 'combat',
  },

  // ── Safety ───────────────────────────────────────────────────────────────
  edgePenalty: {
    default: 50.0,
    uiRange: { min: 0, max: 200, step: 5 },
    label: 'Edge Penalty Weight',
    description: 'Penalty for being on board edges',
    section: 'safety',
  },

  // ── Space detection ──────────────────────────────────────────────────────
  selfSpace: {
    default: 120,
    uiRange: { min: -200, max: 200, step: 1 },
    label: 'Self Space Weight',
    description:
      'Continuous survival room from the contest-aware conservative region (cells we win the ' +
      'Voronoi race for). sqrt-scaled and length-normalised: room equal to our body length ' +
      'scores 1.0, 4× → 2.0, ¼ → 0.5.',
    section: 'space',
  },
  alliesEnoughSpace: {
    default: 15.0,
    uiRange: { min: -50, max: 50, step: 1 },
    label: 'Allies Enough Space Weight',
    description: 'Allies having space (positive = good teamwork)',
    section: 'space',
  },
  opponentsEnoughSpace: {
    default: -15.0,
    uiRange: { min: -50, max: 50, step: 1 },
    label: 'Opponents Enough Space Weight',
    description: 'Opponents having space (negative = encourage trapping)',
    section: 'space',
  },

  // ── Life/death ───────────────────────────────────────────────────────────
  kills: {
    default: 0,
    uiRange: { min: 0, max: 500, step: 10 },
    label: 'Kills Weight',
    description: 'Reward for eliminating opponents',
    section: 'combat',
  },
  deaths: {
    default: -500,
    uiRange: { min: -1000, max: 0, step: 10 },
    label: 'Deaths Weight',
    description: 'Penalty for your snake dying (negative)',
    section: 'combat',
  },

  // ── Head-to-head risk ────────────────────────────────────────────────────
  enemyH2HRisk: {
    default: -100,
    uiRange: { min: -500, max: 0, step: 5 },
    label: 'Enemy H2H Risk Weight',
    description: 'Penalty for head-to-head collision risk with enemies (negative)',
    section: 'combat',
  },
  allyH2HRisk: {
    default: -50,
    uiRange: { min: -500, max: 0, step: 5 },
    label: 'Ally H2H Risk Weight',
    description: 'Penalty for head-to-head collision risk with allies (negative)',
    section: 'combat',
  },

  // ── User-directed waypoints (centaur UI: alt-click goto, shift-click near).
  // The progress stat is a BOUNDED [0,1] ramp that equals 1 for the optimal
  // next step, so the weight IS the bonus that step receives — not a
  // multiplier on a gradient. Keep both BELOW the deaths (-500) and trapped
  // (-600) weights: that ordering is the whole safety argument, and raising
  // them past the death penalty re-creates "snake dies for the waypoint".
  // (The pre-redesign keys used a ~1/boardSize Manhattan-closeness gradient,
  // hence their magnitudes in the thousands — never port those numbers here.)
  gotoProgress: {
    default: 300,
    uiRange: { min: 0, max: 1000, step: 10 },
    label: 'Goto Progress Weight (green)',
    description:
      'Alt-click target. The stat is a bounded [0,1] ramp that equals 1 for the optimal next ' +
      'step, so this weight IS the bonus that step gets — not a multiplier on a gradient. ' +
      'Keep it below the death (-500) and trapped (-600) penalties or the snake will start ' +
      'dying for targets. Default 300.',
    section: 'combat',
  },
  nearProgress: {
    default: 250,
    uiRange: { min: 0, max: 1000, step: 10 },
    label: 'Near Progress Weight (blue)',
    description:
      'Shift-click target — approach without ever arriving (the bonus peaks one square ' +
      'away and is zero on the target). Same bounded ramp as Goto; default 250, slightly weaker.',
    section: 'combat',
  },

  // ── Offensive aggression (conservative: max stat 2 → max +50, far below
  // the death penalty of -500, so survival always dominates aggression) ─────
  aggression: {
    default: 25,
    uiRange: { min: 0, max: 200, step: 1 },
    label: 'Aggression Weight',
    description:
      'Reward for hunting enemies we strictly out-invulnerate — closing in on or landing ' +
      'on their head/body. Kept conservative so survival always dominates.',
    section: 'aggression',
  },

  // ── Hard trap survival: a clearly-fatal pocket is effectively a death, so
  // this dominates every non-survival heuristic. The candidate-level veto in
  // the decision engine is the hard guarantee; this weight ensures the signal
  // also dominates scoring when a veto is not possible. ────────────────────
  trapped: {
    default: -600,
    uiRange: { min: -2000, max: 0, step: 10 },
    label: 'Trapped Penalty',
    description:
      'Strongly-negative penalty for moving into a clearly-fatal dead-end pocket — one ' +
      'where we can neither chase our own tail nor fit our length. A hard candidate-level ' +
      'veto also blocks such moves whenever a safe alternative exists.',
    section: 'aggression',
  },
} satisfies Record<string, HeuristicSpec>;

export type HeuristicKey = keyof typeof HEURISTICS;

/** Registry keys in registry (= summation = UI) order. */
export const HEURISTIC_KEYS = Object.keys(HEURISTICS) as HeuristicKey[];

/** One weight per heuristic. */
export type HeuristicWeights = { [K in HeuristicKey]: number };

/** One weighted (stat × weight) score per heuristic. */
export type WeightedScores = { [K in HeuristicKey as `${K}Score`]: number };

/** Fresh copy of the default weights (safe to spread/override). */
export function defaultHeuristicWeights(): HeuristicWeights {
  const weights = {} as HeuristicWeights;
  for (const key of HEURISTIC_KEYS) weights[key] = HEURISTICS[key].default;
  return weights;
}

// ── Config-page UI metadata ────────────────────────────────────────────────
// The config page renders itself entirely from this structure (served by
// GET /api/config as `ui`): sections in order, each with its items. Heuristic
// items come straight from the registry; the non-heuristic simulation/centaur
// settings are declared once in EXTRA_CONFIG_UI below.

export interface ConfigUiItem {
  key: string;
  type: 'number' | 'boolean';
  label: string;
  description: string;
  range?: UiRange;
  /** Text next to the checkbox (boolean items only). */
  checkboxLabel?: string;
}

export interface ConfigUiSection {
  id: string;
  emoji: string;
  title: string;
  items: ConfigUiItem[];
}

const CONFIG_SECTIONS: Array<{ id: string; emoji: string; title: string }> = [
  { id: 'snake', emoji: '🐍', title: 'Snake Heuristics' },
  { id: 'team', emoji: '👥', title: 'Team Heuristics' },
  { id: 'combat', emoji: '⚔️', title: 'Combat Heuristics' },
  { id: 'food', emoji: '🍎', title: 'Food & Proximity' },
  { id: 'safety', emoji: '🛡️', title: 'Safety Heuristics' },
  { id: 'space', emoji: '🎯', title: 'Enhanced Space Detection' },
  { id: 'aggression', emoji: '⚔️', title: 'Offensive Aggression' },
  { id: 'centaur', emoji: '🎮', title: 'Centaur Play Mode' },
  { id: 'simulation', emoji: '⚙️', title: 'Simulation Parameters' },
];

/** Non-heuristic config keys' UI metadata (section + within-section order). */
const EXTRA_CONFIG_UI: Array<ConfigUiItem & { section: string }> = [
  {
    key: 'autoFirstMove',
    type: 'boolean',
    label: 'First Move Behavior',
    checkboxLabel: 'Fully automatic from first move',
    description:
      'When OFF, bots wait for human input on the first turn. When ON, bots play ' +
      'automatically from the very first move (pure bot mode).',
    section: 'centaur',
  },
  {
    key: 'idleTimeoutMinutes',
    type: 'number',
    range: { min: 1, max: 120, step: 1 },
    label: 'Idle Timeout (minutes)',
    description:
      'Minutes without user activity before live pages disconnect and the server is allowed ' +
      'to scale to zero. Server picks up changes within ~1 minute; pages read it on load.',
    section: 'centaur',
  },
  {
    key: 'timeoutMs',
    type: 'number',
    range: { min: 100, max: 490, step: 10 },
    label: 'Timeout (ms)',
    description: 'Max time for move calculation',
    section: 'simulation',
  },
  {
    key: 'nearbyDistance',
    type: 'number',
    range: { min: 1, max: 20, step: 1 },
    label: 'Nearby Distance',
    description: 'Distance to consider snakes "nearby"',
    section: 'simulation',
  },
];

function buildConfigUi(): ConfigUiSection[] {
  return CONFIG_SECTIONS.map((section) => {
    const items: ConfigUiItem[] = [];
    for (const key of HEURISTIC_KEYS) {
      const spec = HEURISTICS[key];
      if (spec.section !== section.id) continue;
      items.push({
        key,
        type: 'number',
        label: spec.label,
        description: spec.description,
        range: spec.uiRange,
      });
    }
    for (const extra of EXTRA_CONFIG_UI) {
      if (extra.section !== section.id) continue;
      const item: ConfigUiItem & { section?: string } = { ...extra };
      delete item.section;
      items.push(item);
    }
    return { id: section.id, emoji: section.emoji, title: section.title, items };
  });
}

/** The config page's full UI description; static, built once. */
export const CONFIG_UI: ConfigUiSection[] = buildConfigUi();
