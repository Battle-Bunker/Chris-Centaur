/**
 * THE ONE BOARD MEMO.
 *
 * Ten call sites across `evaluate/` and `candidates.ts` hand-rolled the same
 * five-line get-or-compute over a module- or instance-level `WeakMap`: look
 * up the key, return a hit, else compute, store, return. `perBoard` and
 * `perBoardPerTeam` state that once.
 *
 * Neither function decides what the key IS. Most caches key on the
 * `EngineSubstrate` itself; `contestField` and `tierIsLive` key on
 * `sub.marshalled` instead, because a modelled sibling is a `Proxy` over its
 * parent and the marshalled board is the one object it hands straight
 * through — see their own call sites for why that distinction matters there.
 * `workspaceFor` keys on `sub.family` for a different reason of its own. That
 * choice stays at each call site, unchanged, passed in as `key`.
 */

export function perBoard<K extends object, T>(cache: WeakMap<K, T>, key: K, compute: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const made = compute();
  cache.set(key, made);
  return made;
}

export function perBoardPerTeam<K extends object, T>(
  cache: WeakMap<K, Map<number, T>>,
  key: K,
  team: number,
  compute: () => T
): T {
  let perTeam = cache.get(key);
  if (perTeam === undefined) {
    perTeam = new Map<number, T>();
    cache.set(key, perTeam);
  }
  const hit = perTeam.get(team);
  if (hit !== undefined) return hit;
  const made = compute();
  perTeam.set(team, made);
  return made;
}
