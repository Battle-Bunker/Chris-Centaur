'use strict';
/*
 * PER-SEAT BOT ISOLATION — which seats an arm's `bot` config is allowed to
 * reach, and the refusal when that is ambiguous.
 *
 * ── THE DEFECT THIS FILE EXISTS TO CLOSE ───────────────────────────────────
 *
 * `run-pair.js` used to merge an arm's `bot=` config into EVERY lobster
 * contender the spec seated, in a loop. On a spec that seats one lobster
 * contender that is harmless and invisible. On a spec that seats two — which is
 * exactly the shape the cheapest experiments in this program have — it is a
 * measurement defect, and a quiet one:
 *
 *   "contenders": { "noGain": { "bot": { "candidates": { "gainOrdering": false } } } },
 *   "bots": ["noGain", "lobster-territory", "reflex"]
 *
 * The design intends ONE seat to lose the knob so the contrast lives inside the
 * game. The old merge took it away from `lobster-territory` as well, so the
 * treatment arm was two ablated lobsters against a control arm of two intact
 * ones. If the knob is worth the same to both seats the contrast CANCELS
 * EXACTLY, and the arm reports a null it never had the power to distinguish
 * from a real one. Only a seat the config did not touch — a `reflex` seat, say
 * — stays unconfounded, and reading a lobster question off the reflex seat is a
 * detour, not a design.
 *
 * The rule this file enforces is therefore one line: A BOT CONFIG APPLIES TO
 * ITS OWN SEAT AND TO NO OTHER SEAT. Where "its own seat" is not determined by
 * what the operator typed, the harness REFUSES and says which seats it could
 * have meant. A refusal costs a retyped command; the guess cost two of the
 * seven probes in the 20260830 overnight most of their power.
 *
 * ── THE TWO SPELLINGS ──────────────────────────────────────────────────────
 *
 *   bot=<json|path>              THE IMPLICIT TARGET — "the subject seat".
 *   bot@<contender>=<json|path>  THE EXPLICIT TARGET — that seat, by name.
 *
 * The implicit form resolves against the seats an arm-level config has ever
 * been able to reach: `lobster-territory` (the program's subject seat by
 * convention, and the one `aggregate.js --subject` defaults to reading) plus
 * any contender the spec DECLARES. Resolving to exactly one of those is the
 * only case in which it applies; zero and two-or-more are both refusals, with
 * the candidate list printed. That keeps every spec in the library that seats
 * `[lobster-territory, lobster-material, reflex]` working exactly as it did —
 * one reachable seat, unambiguous — and refuses precisely the shape that used
 * to contaminate silently.
 *
 * The explicit form reaches ANY seated seat whose driving code is a lobster
 * base, `lobster-material` included. It is the spelling every multi-lobster
 * spec should use, and the two forms may not be mixed in one arm: an arm that
 * names one seat explicitly has said what it means, and an implicit target
 * beside it would be a second, unnamed one.
 *
 * ── WHAT ISOLATION IS ASSERTED AGAINST ─────────────────────────────────────
 *
 * Not this file. `bin/selftest.js` builds a two-lobster spec, gives the two
 * contenders DIFFERENT configs, plays a game, and reads the per-seat
 * `health[].mechanism.flags` stamp out of the manifest — the resolved bot, as
 * the engine actually resolved it, not as the spec asked. Each seat must show
 * its own config and neither may show the other's. A transform that looks right
 * and a stamp that reads right are different claims, and only the second one is
 * evidence.
 */

/**
 * The bases that are driven by `TeamDecisionOptions` and therefore actually
 * read a `BotConfig`. Mirrors `harness/lib/bots.ts` LOBSTER_BASES; kept as a
 * literal here because this file is plain node with no build step and must run
 * from a fresh clone, against bundles it has not compiled.
 */
const LOBSTER_BASES = ['lobster-territory', 'lobster-slider', 'lobster-slider-royal', 'lobster-material'];

/** The seat an untargeted `bot=` has ever been able to reach, by convention. */
const IMPLICIT_SUBJECT = 'lobster-territory';

class ArmSpecError extends Error {}

/** The base that supplies a seated name's driving code. */
function baseOf(spec, name) {
  const c = (spec.contenders ?? {})[name];
  if (c === undefined) return name;
  return c.base ?? IMPLICIT_SUBJECT;
}

/** Every seated name whose driving code reads a BotConfig at all. */
function configurableSeats(spec) {
  const bots = spec.bots ?? [];
  return bots.filter((b) => LOBSTER_BASES.includes(baseOf(spec, b)));
}

/**
 * The seats an UNTARGETED `bot=` is allowed to resolve to. Deliberately
 * narrower than `configurableSeats`: a built-in `lobster-material` seat is
 * configurable but is never what a bare `bot=` meant, and silently widening the
 * implicit target is how a contrast gets cancelled.
 */
function implicitTargets(spec) {
  const bots = spec.bots ?? [];
  const declared = spec.contenders ?? {};
  return bots.filter((b) => b === IMPLICIT_SUBJECT || declared[b] !== undefined);
}

/**
 * Resolve an arm's configs to `<contender> -> BotConfig`, refusing anything
 * ambiguous. `arm.bot` is the untargeted config or null; `arm.botTargets` is a
 * plain object of explicit `bot@name=` configs (may be empty).
 */
function resolveArmTargets(spec, arm) {
  const targets = arm.botTargets ?? {};
  const explicit = Object.keys(targets);
  const bots = spec.bots ?? [];
  const seated = new Set(bots);

  if (arm.bot != null && explicit.length > 0) {
    throw new ArmSpecError(
      `arm "${arm.name}": bot= and bot@${explicit[0]}= were both given.\n` +
        '  An arm that names a seat has said which seat it means; a bare bot= beside it is a\n' +
        '  second, unnamed target. Name every seat you are configuring, or name none of them.'
    );
  }

  for (const name of explicit) {
    if (!seated.has(name)) {
      throw new ArmSpecError(
        `arm "${arm.name}": bot@${name}= names a seat this spec does not seat.\n` +
          `  The spec seats: ${bots.join(', ')}\n` +
          '  A config aimed at an empty seat configures nothing and the arm would play the\n' +
          "  shipped bot under the treatment's name."
      );
    }
    const base = baseOf(spec, name);
    if (!LOBSTER_BASES.includes(base)) {
      throw new ArmSpecError(
        `arm "${arm.name}": bot@${name}= targets a seat whose base is "${base}", which is not\n` +
          '  driven by TeamDecisionOptions and would ignore the config silently.\n' +
          `  Seats that read a bot config here: ${configurableSeats(spec).join(', ') || '(none)'}`
      );
    }
  }

  if (arm.bot == null) return { ...targets };

  const candidates = implicitTargets(spec);
  if (candidates.length === 0) {
    throw new ArmSpecError(
      `arm "${arm.name}": bot= was given but the spec seats no contender for it to configure.\n` +
        `  The spec seats: ${bots.join(', ') || '(nothing)'}\n` +
        '  Declare a contender in the spec, or aim the config with bot@<seat>=.'
    );
  }
  if (candidates.length > 1) {
    // THE ISOLATION REFUSAL. This is the whole point of the file: the old code
    // resolved this case by configuring ALL of them, which is a contaminated
    // pairing that reports as a null.
    throw new ArmSpecError(
      `arm "${arm.name}": bot= is AMBIGUOUS — this spec seats ${candidates.length} configurable\n` +
        `  contenders: ${candidates.join(', ')}\n` +
        '  A bot config applies to ONE seat. Applying it to all of them is what this refusal\n' +
        '  exists to prevent: if the knob is worth the same to both seats the within-game\n' +
        '  contrast cancels exactly, and the arm reports a null it had no power to tell from\n' +
        '  a real one. Name the seat:\n' +
        candidates.map((c) => `      --arm '${arm.name}=<bundle>,bot@${c}=<json>'`).join('\n') +
        '\n  Repeat bot@<seat>= to configure more than one seat; each is applied to its own.'
    );
  }
  return { [candidates[0]]: arm.bot };
}

/**
 * The arm's own spec: the shared one with this arm's configs merged into THE
 * SEATS THEY NAME and no others, and everything that defines the boards
 * untouched.
 *
 * The untouched half is the pairing guarantee, so it is structural rather than
 * asserted — `sweepId`, `cells`, `seeds` and `rotateSeats` are carried by the
 * spread from the shared spec and are never read off the arm.
 */
function specForArm(spec, arm) {
  const resolved = resolveArmTargets(spec, arm);
  const names = Object.keys(resolved);
  if (names.length === 0) return spec;

  const contenders = { ...(spec.contenders ?? {}) };
  for (const name of names) {
    const existing = contenders[name] ?? {};
    contenders[name] = {
      ...existing,
      // A contender that wears a built-in's name must declare that built-in as
      // its base, or `checkContenders` refuses it — see bots.ts on why a
      // manifest row's name may never mean two different bots.
      base: existing.base ?? baseOf(spec, name),
      bot: { ...(existing.bot ?? {}), ...resolved[name] },
    };
  }
  return { ...spec, contenders };
}

module.exports = {
  ArmSpecError,
  LOBSTER_BASES,
  IMPLICIT_SUBJECT,
  baseOf,
  configurableSeats,
  implicitTargets,
  resolveArmTargets,
  specForArm,
};
