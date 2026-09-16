/**
 * THE heuristic registry — the single source of truth for every scoring
 * heuristic. Each entry carries the key's default weight, its config-page
 * slider range and copy, and which config-page section it renders under.
 *
 * Everything else is DERIVED from this table:
 *  - `HeuristicWeights` / `WeightedScores` types,
 *  - `DEFAULT_CONFIG`'s heuristic half (config/game-config.ts),
 *  - the per-move breakdown a decision row carries,
 *  - the /api/config UI metadata that config.html renders its sliders from.
 *
 * WHAT IS LEFT, AND WHY IT IS SO SHORT. This table used to carry the whole
 * legacy board evaluator's matrix — territory, space, food, aggression, the
 * h2h and piece-threat risks, the trapped veto — because that evaluator read
 * every one of them. It is gone, and so are they: the search scores through
 * `src/lobster/evaluate/`, whose criterion profiles are its own and are not
 * operator sliders. What remains is the set the PIECE candidate scorer and
 * the waypoint re-bias in `server/active-game-manager.ts` actually read, plus
 * the non-heuristic runtime settings below. A weight nothing reads is a
 * slider that lies.
 *
 * ORDER MATTERS: registry order is the within-section order of the config
 * page's sliders. Append new keys at the end of their conceptual group rather
 * than re-sorting.
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
  // ── Health loss (drives NATURAL hazard avoidance — no hazard-specific
  // heuristic exists anywhere else). The stat is the shared projected health
  // COST of the candidate move (movementCost + hazardDamage × hazard squares
  // entered — see turn-oracle.ts), so it is usually just
  // 1 (the ordinary per-move decay) and jumps by hazardDamage (default 100)
  // whenever the move enters a hazard square; eating cancels the movement
  // term. At the default weight, an ordinary move costs a negligible -5,
  // while one hazard square costs -505 — comparable to deaths (-500) and
  // trapped (-600), so a survivable-but-costly hazard entry is decisively
  // outweighed by any non-fatal alternative without hard-coding "hazard" as
  // a concept anywhere in the scoring.
  //
  // The projection also resolves DEATH along the path — a wall, a snake body
  // segment the mover cannot survive entering (ally bodies included), a lost
  // piece contest, or hazard doses that exhaust it — as a cost that takes the
  // projected health to zero. A full-health unit therefore reports 100, and
  // this weight charges -500 for it: the same magnitude as the deaths weight,
  // which is exactly the owner's point that the health heuristic should be
  // the thing that notices. ─────────────────────────────────────────────────
  healthLoss: {
    default: -5,
    uiRange: { min: -50, max: 0, step: 1 },
    label: 'Health Loss Weight',
    description:
      'Penalty per point of projected health cost the move incurs (movement + hazard ' +
      'damage on entry). Scaled so hazardDamage (default 100) dominates a handful of extra ' +
      'steps and rivals the deaths/trapped penalties — steers away from hazards without a ' +
      'hazard-specific rule (negative).',
    section: 'safety',
  },

  // ── Life/death ───────────────────────────────────────────────────────────
  // The stat is now really computed: the number of ENEMY units the candidate
  // move destroys, read off the same contest the cost projection already
  // resolves (turn-oracle.ts). The default stays 0 so enabling
  // the reward is the owner's decision, not a silent behaviour change.
  kills: {
    default: 0,
    uiRange: { min: 0, max: 500, step: 10 },
    label: 'Kills Weight',
    description:
      'Reward per ENEMY unit this move destroys (a piece contest we win, or a snake head ' +
      'square we take at a strictly higher tier). Default 0 — off until you want the bot ' +
      'hunting.',
    section: 'combat',
  },
  deaths: {
    default: -500,
    uiRange: { min: -1000, max: 0, step: 10 },
    label: 'Deaths Weight',
    description: 'Penalty for your snake dying (negative)',
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

  // ── Friendly fire. The engine's contests have NO friendly exemption
  // (the engine's cell contest compares tier then frozen weight and never teams),
  // so our own move kills an ally exactly the way it kills an enemy — and
  // since score IS total weight, the harm is precisely the weight we destroy.
  // The stat is that weight, so the penalty scales with what is lost.
  //
  // Magnitude: at -400 even the lightest possible ally — a weight-1 piece —
  // costs more than every positive term on the board put together (the largest
  // is a user waypoint at 300, then foodEaten 200, selfSpace 120), so no
  // ordinary positional gain and no operator target can ever buy a friendly
  // kill. It sits just UNDER the deaths penalty (-500) for that minimum case,
  // which is the honest ordering: spending a weight-1 ally is a real
  // sacrifice, but not worse than dying ourselves, and a deliberate one stays
  // expressible. It scales past trapped (-600) at weight 2 and reaches the
  // thousands for a real snake or a queen, which is what killing that much of
  // our own team is worth. It is deliberately NOT a veto: only regicide is. ──
  allyCasualty: {
    default: -400,
    uiRange: { min: -2000, max: 0, step: 10 },
    label: 'Ally Casualty Weight',
    description:
      'Penalty per point of OUR OWN weight the move destroys — a piece contest we win against ' +
      'an ally, or an ally snake we sever. Score is total weight, so the stat is exactly what ' +
      'the team loses. Scaled above every positive heuristic so no positional gain or waypoint ' +
      'ever buys a friendly kill (negative).',
    section: 'combat',
  },

  // ── Regicide: the catastrophe, not a penalty. The engine eliminates a team
  // configured with kings the moment its LAST king dies and removes every unit
  // it still owns that turn (TeamSnekProcessor.applyRegicide), so our score
  // goes from our whole total weight to zero and the game is over. Nothing
  // else on the board is in that class: deaths is -500 and trapped -600, and
  // the entire rest of the matrix cannot reach a thousand, so -100000 is not a
  // tuning knob — it is "no sum of everything else comes close". The hard
  // guarantee is the veto in pickBestMove (snakes) and bestPieceCandidate
  // (pieces), exactly as trapped/fatal are vetoed; this weight makes the
  // scoring agree with the veto wherever a veto cannot apply (every candidate
  // commits regicide, or a human is reading the breakdown). ──────────────────
  regicide: {
    default: -100000,
    uiRange: { min: -1000000, max: 0, step: 1000 },
    label: 'Regicide Penalty (our last king)',
    description:
      'Penalty for a move that kills our team\'s LAST king — our own unit taking it, or our ' +
      'king walking into a fatal square. The engine then eliminates our whole team and our ' +
      'score becomes zero, so this dominates every other term and the move is also vetoed ' +
      'outright (negative).',
    section: 'combat',
  },

  // ── The same rule pointed the other way: taking an enemy team's LAST king
  // ends THAT team. Deliberately conservative — it can only fire on a move
  // that literally eliminates an opponent, so it cannot swing ordinary play,
  // and at 2000 it outranks every positional term (so a winning capture is
  // taken) while staying 50× below our own regicide (so we never trade our
  // king for theirs). ──────────────────────────────────────────────────────
  enemyRegicide: {
    default: 2000,
    uiRange: { min: 0, max: 100000, step: 100 },
    label: 'Enemy Regicide Reward (their last king)',
    description:
      "Reward for a move that takes an enemy team's LAST king, eliminating that whole team. " +
      'Fires only on a genuinely winning capture; set well below our own regicide penalty so ' +
      'the trade is never worth making.',
    section: 'combat',
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
  { id: 'combat', emoji: '⚔️', title: 'Combat Heuristics' },
  { id: 'safety', emoji: '🛡️', title: 'Safety Heuristics' },
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
