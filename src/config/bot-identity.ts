/**
 * WHO PLAYED THIS TURN — the two identities a decision row must carry.
 *
 * ── THE QUESTION THIS ANSWERS ──────────────────────────────────────────────
 *
 * Every prior measurement of this centaur compared two arms and could not say
 * whether both arms played the bot the manifest named. The process-wide
 * configuration was read from env at boot, never written down, and a decision
 * row recorded only `engine` ('lobster') and `profile` ('lobster-territory') —
 * two names that stay identical across a knob change that moves every move the
 * bot makes. So a replay could say WHAT was decided and never WHO decided it,
 * and an experiment could not rule out that its control and its treatment were
 * the same bot, or that neither was the bot on the manifest.
 *
 * Two identities, obeying different laws:
 *
 *   botId        INPUT-addressed. Names the CONFIGURATION: the engine, the
 *                criterion profile (its name AND its numbers), the candidate
 *                knobs, the resolved staging-safety level. Derived by hashing
 *                those fields, so two processes holding the same config derive
 *                the same id without coordinating, and any knob change — a
 *                weight moved by 0.1, a boolean flipped — changes it.
 *
 *   behaviourId  BUILD-addressed. Names the CODE that ran: see
 *                `./build-identity.ts`. Two rows with the same botId and
 *                different behaviourIds were the same configuration played by
 *                different builds, which is exactly the confound a bot-config
 *                id alone cannot separate.
 *
 * (The design branch's synthesis wants `behaviourId` to be OUTPUT-addressed
 * over a canonical probe suite — an equivalence class rather than a build
 * stamp. There is no probe suite yet; a build address is the sound
 * approximation, because equal builds under equal config ARE behaviourally
 * equal. It is strictly finer than the eventual identity: it will split rows
 * the probe suite would merge, and it never merges rows the suite would split.)
 *
 * ── WHY THE NAME IS NOT IN THE HASH ────────────────────────────────────────
 *
 * `BotSpec.name` is an operator's label for a binding — "the arm I am running
 * this week". Two labels over identical knobs are one bot, and a rename is not
 * a new bot. So the label rides the binding and never the id: the id is a
 * function of behaviour-relevant fields ONLY, which is what makes it possible
 * to ask "did both arms play the same bot" of rows written months apart by
 * operators who never spoke.
 */

import { createHash } from 'crypto';
import type { CandidateKnobs } from '../lobster/candidates';
import type { CriterionProfile } from '../lobster/evaluate/calibration';
import type { StagingSafety } from '../lobster/staging-safety';
import type { CentaurEngineKind } from './centaur-engine';

/** The pair stamped on every decision row and on the turn data the UI reads. */
export interface BotIdentity {
  /** Input address: this configuration, hashed. See `botIdOf`. */
  readonly botId: string;
  /** Build address: the code that ran. See `./build-identity.ts`. */
  readonly behaviourId: string;
}

/**
 * A BOT: everything about a configuration that changes the moves it makes,
 * plus a label that does not.
 *
 * PLAIN DATA, BY CONSTRUCTION. Every field here is a string, number, boolean,
 * or a record of those — which is what makes `botIdOf` reproducible across
 * processes. A field whose value were a function or a class instance could not
 * be hashed to a stable id (see `canonicalOf`), so none is admitted.
 */
export interface BotSpec {
  /** Operator-facing label. Deliberately NOT part of `botId`. */
  readonly name: string;
  readonly engine: CentaurEngineKind;
  /** The criterion profile the evaluator folds — name, weights and horizons. */
  readonly profile: CriterionProfile;
  /** Candidate-layer knob overrides, or absent for the layer's own defaults. */
  readonly candidates?: CandidateKnobs;
  /** Staging-safety level for this bot, or absent to follow the env flag. */
  readonly stagingSafety?: StagingSafety;
}

/** What a non-plain value canonicalises to. Unreachable for a well-typed
 * `BotSpec`; present so a hand-assembled object degrades loudly-but-safely
 * rather than throwing inside a decision. */
export const OPAQUE = '<opaque>';

/**
 * A canonical, order-free string for a plain data value.
 *
 * Object keys are walked in SORTED order and `undefined` members are dropped,
 * so `{a: 1, b: 2}` and `{b: 2, a: 1, c: undefined}` canonicalise identically —
 * two configs that differ only in how they were spelled are one bot.
 *
 * Distinct from `contracts.structuralIdentity`, which serves the same shape but
 * falls back to a PER-PROCESS counter for functions and class instances. That
 * counter is correct for a cache living inside one decision and fatal for an id
 * that gets written to a database and compared across processes — which is the
 * whole point of this one.
 */
export function canonicalOf(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'undefined':
      return 'undef';
    case 'number':
      // -0 and 0 are the same weight; NaN is its own token rather than `null`.
      return Object.is(value, -0) ? '0' : String(value);
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'string':
      return JSON.stringify(value);
    default:
      break;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalOf).join(',')}]`;
  const proto: unknown = Object.getPrototypeOf(value as object);
  if (proto !== Object.prototype && proto !== null) return OPAQUE;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((k) => record[k] !== undefined)
    .map((k) => `${k}:${canonicalOf(record[k])}`)
    .join(',')}}`;
}

/** The behaviour-relevant projection of a spec — everything except the label. */
function behaviourOf(spec: BotSpec): Record<string, unknown> {
  return {
    engine: spec.engine,
    profile: spec.profile,
    candidates: spec.candidates,
    stagingSafety: spec.stagingSafety,
  };
}

/** How many hex characters of the digest ride in the id. 48 bits: a centaur
 * that ran a thousand distinct configs would expect its first collision after
 * roughly 24 million, and the readable form matters because operators type
 * these into queries. */
const BOT_ID_DIGEST_CHARS = 12;

/**
 * The input address of a bot configuration.
 *
 * Shaped `<engine>:<profile name>@<digest>` — readable at the front so a human
 * scanning rows sees what they expect, exact at the back so two rows are the
 * same bot IFF the string matches. The prefix is a courtesy and the digest is
 * the identity: two specs whose profiles share a NAME but differ in a weight
 * get different digests and are different bots, which is precisely the case
 * that invalidated the earlier measurements.
 */
export function botIdOf(spec: BotSpec): string {
  const digest = createHash('sha256')
    .update(canonicalOf(behaviourOf(spec)))
    .digest('hex')
    .slice(0, BOT_ID_DIGEST_CHARS);
  return `${spec.engine}:${spec.profile.name}@${digest}`;
}

/** The full stamp for a spec running on a given build. */
export function botIdentityOf(spec: BotSpec, behaviourId: string): BotIdentity {
  return { botId: botIdOf(spec), behaviourId };
}
