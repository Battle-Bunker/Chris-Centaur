/**
 * THE PERSISTENT HALF OF THE BOT BINDING — `config_store` rows, and the one
 * registry the process shares.
 *
 * WHY THIS IS A SEPARATE FILE. `./bot-binding.ts` is pure: it parses, it
 * validates, it resolves, and nothing in it can open a socket. That is what
 * lets `TeamDecisionEngine` name a binding port without putting Postgres one
 * import away from every lobster test — the same rule the telemetry port is
 * built on. This file is the other side of that line: it is the only place a
 * bot binding meets a database, and only the process's edges (the transport,
 * the routes, boot) import it.
 *
 * NO SCHEMA CHANGE. Bindings are rows in the existing key/value `config_store`
 * table, the one the config UI already writes. An operator binds a bot with a
 * single upsert and no deploy; see `docs/BOT-BINDING.md` for the keys and the
 * value shapes.
 */

import { ConfigStore } from '../server/configStore';
import { BotRegistry, type BotBindingReader } from './bot-binding';

/** Reads every `config_store` row. The registry picks out the `bot.*` keys —
 * the table is a handful of rows and one read per TTL is cheaper than four
 * point lookups. Never throws: `ConfigStore.getAll` already turns a database
 * failure into an empty map, and the registry keeps its previous bindings when
 * a load comes back empty-handed. */
export function configStoreBotReader(store: ConfigStore = new ConfigStore()): BotBindingReader {
  return () => store.getAll();
}

let instance: BotRegistry | null = null;

/**
 * The process's bot registry.
 *
 * One instance, because the question "which bot is this game playing" must get
 * the same answer at the decision seam and on the read-only route — two
 * registries with independent refresh clocks would disagree for up to a TTL
 * and the UI would then be reporting a bot no decision used.
 */
export function botRegistry(): BotRegistry {
  if (instance === null) instance = new BotRegistry({ read: configStoreBotReader() });
  return instance;
}

/** Test seam: install a registry (or drop the current one with `null`). */
export function setBotRegistryForTests(registry: BotRegistry | null): void {
  instance = registry;
}
