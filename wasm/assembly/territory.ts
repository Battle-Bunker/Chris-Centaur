// ───────────────────────────────────────────────────────────────────────────
// THE TERRITORY KERNELS, IN WEBASSEMBLY.
//
// THIS FILE IS ASSEMBLYSCRIPT, NOT TYPESCRIPT. It lives outside `src/` for
// that reason: `i32`, `load<T>` and `ctz` are not TypeScript, and tsconfig
// includes `src/**/*`. `scripts/build-wasm.js` compiles it to
// `wasm/territory.wasm` and embeds those exact bytes in
// `src/lobster/wasm/module.ts`.
//
// ── THE CONTRACT WITH THE HOST ─────────────────────────────────────────────
//
// The memory is IMPORTED (`--importMemory`), so the host owns it and the
// evaluator's workspace slabs are typed-array VIEWS onto it. That is the whole
// point of this round: the bitboards, the decisive grid, the rank column and
// every unit's `earliest()` arrival grid already LIVE here, written in place by
// the JS sweep, so a kernel call marshals nothing at all. The alternative — a
// module with its own memory and a copy per call — was measured by the
// prototype at 2.06x against 2.43x resident, and that gap is the whole of what
// this design is buying.
//
// Every kernel takes ONE argument: a byte offset to a DESCRIPTOR, an i32 block
// the host fills with the sizes and the pointers. One argument rather than
// fifteen because the field OFFSETS are exported as wasm globals below and the
// host reads them off the instance — so the two sides cannot drift, which a
// fifteen-argument signature cannot promise.
//
// ── WHAT IS NOT HERE ───────────────────────────────────────────────────────
//
// No allocation, no GC types, no imports beyond the memory: the module compiles
// with `--runtime stub` and every export is a raw i32 call. Nothing here
// restates a RULE — the contest comparator stays in `contest.ts` and reaches
// this file only as the dense integer RANKS `territory.ts` computes by calling
// it. A packed `(tier << 16) | weight` key would have been faster still and is
// exactly the restatement W2 refused; see `territory.ts`'s header.
// ───────────────────────────────────────────────────────────────────────────

/** `NEVER` as `partial-engine` defines it. Asserted against the host's copy. */
export const NEVER: i32 = 0x7fffffff;

// ── Descriptor layout ──────────────────────────────────────────────────────
// Exported as wasm globals so the host reads them rather than restating them.

export const D_WORDS: i32 = 0;
export const D_CELLS: i32 = 1;
export const D_NT: i32 = 2;
export const D_NP: i32 = 3;
export const D_TURNS: i32 = 4;
export const D_TMIN: i32 = 5;
export const D_AS_TEAM: i32 = 6;
export const D_DOMAIN: i32 = 7;
export const D_DECISIVE: i32 = 8;
export const D_RANKS: i32 = 9;
export const D_EARLIEST: i32 = 10;
export const D_ENT_TEAM: i32 = 11;
export const D_TRAIL_SLOTS: i32 = 12;
export const D_PIECE_SLOTS: i32 = 13;
export const D_OURS_BOARD: i32 = 14;
export const D_THEIRS_BOARD: i32 = 15;
/** Scratch the kernel hoists per-unit pointers into: i32[2 * (nT + nP)]. */
export const D_SCRATCH: i32 = 16;
export const D_OUT_OURS: i32 = 17;
export const D_OUT_THEIRS: i32 = 18;
export const D_LEN: i32 = 19;

@inline
function fld(pd: i32, i: i32): i32 {
  return load<i32>(pd + (i << 2));
}

/**
 * PLANE 2 — `territory.ts`'s `displace`, cell for cell.
 *
 * Walks the trail-domain bitboard. Per cell: the strongest trail claim standing
 * at the decisive turn, then the challenger pieces that arrive by then and beat
 * it, earliest first with the rank as the tie-break, and a rank tie among
 * challengers settles nothing. Writes `ours`/`theirs` back into the descriptor.
 *
 * The per-unit `earliest` POINTER and rank-column BASE are hoisted into scratch
 * before the cell walk — two loads per unit per cell that the JS arm pays
 * through `entEarliest[e]` and `e * turns` inside the loop. The hoist is
 * semantics-preserving and the JS arm can have it too; `wasmab.js` measures a
 * hoisted JS arm alongside this one so the wasm number is not quietly claiming
 * credit for it.
 */
export function displace(pd: i32): void {
  const words = fld(pd, D_WORDS);
  const nT = fld(pd, D_NT);
  const nP = fld(pd, D_NP);
  const turns = fld(pd, D_TURNS);
  const tMin = fld(pd, D_TMIN);
  const asTeam = fld(pd, D_AS_TEAM);
  const pDomain = fld(pd, D_DOMAIN);
  const pDecisive = fld(pd, D_DECISIVE);
  const pRanks = fld(pd, D_RANKS);
  const pEarly = fld(pd, D_EARLIEST);
  const pEntTeam = fld(pd, D_ENT_TEAM);
  const pTrail = fld(pd, D_TRAIL_SLOTS);
  const pPiece = fld(pd, D_PIECE_SLOTS);
  const pOurs = fld(pd, D_OURS_BOARD);
  const pTheirs = fld(pd, D_THEIRS_BOARD);
  const scratch = fld(pd, D_SCRATCH);

  // Hoist: [0, nT) trail earliest ptrs, then trail rank bases, then the same
  // two for pieces. `winnerTeam` is hoisted with them so the winning branch
  // does not re-load the slot index.
  const tEarly = scratch;
  const tRank = tEarly + (nT << 2);
  const pEarlyC = tRank + (nT << 2);
  const pRankC = pEarlyC + (nP << 2);
  const pTeamC = pRankC + (nP << 2);
  for (let k = 0; k < nT; k++) {
    const e = load<i32>(pTrail + (k << 2));
    store<i32>(tEarly + (k << 2), load<i32>(pEarly + (e << 2)));
    store<i32>(tRank + (k << 2), pRanks + ((e * turns) << 2));
  }
  for (let k = 0; k < nP; k++) {
    const e = load<i32>(pPiece + (k << 2));
    store<i32>(pEarlyC + (k << 2), load<i32>(pEarly + (e << 2)));
    store<i32>(pRankC + (k << 2), pRanks + ((e * turns) << 2));
    store<i32>(pTeamC + (k << 2), load<i32>(pEntTeam + (e << 2)));
  }

  let ours: i32 = 0;
  let theirs: i32 = 0;

  for (let word = 0; word < words; word++) {
    let bits = load<u32>(pDomain + (word << 2));
    if (bits == 0) continue;
    const base = word << 5;
    const oursWord = load<u32>(pOurs + (word << 2));
    const theirsWord = load<u32>(pTheirs + (word << 2));
    while (bits != 0) {
      const lowest = bits & (~bits + 1);
      const c = base + <i32>ctz(bits);
      bits = bits & (bits - 1);

      // The domain IS the sweep's write set, so `decisive` is live here.
      const D = load<i32>(pDecisive + (c << 2));
      const at = D - tMin;
      const cOff = c << 2;

      let claim: i32 = -1;
      for (let k = 0; k < nT; k++) {
        if (load<i32>(load<i32>(tEarly + (k << 2)) + cOff) != D) continue;
        const m = load<i32>(load<i32>(tRank + (k << 2)) + (at << 2));
        if (m > claim) claim = m;
      }
      if (claim < 0) continue;

      let bestArrival: i32 = NEVER;
      let winner: i32 = -1;
      let winnerRank: i32 = -1;
      let tied = false;
      for (let k = 0; k < nP; k++) {
        const a = load<i32>(load<i32>(pEarlyC + (k << 2)) + cOff);
        if (a > D) continue;
        const m = load<i32>(load<i32>(pRankC + (k << 2)) + (at << 2));
        if (m <= claim) continue;
        if (winner < 0 || a < bestArrival) {
          bestArrival = a;
          winner = k;
          winnerRank = m;
          tied = false;
        } else if (a == bestArrival) {
          if (m > winnerRank) {
            winner = k;
            winnerRank = m;
            tied = false;
          } else if (m == winnerRank) {
            tied = true;
          }
        }
      }

      if (winner >= 0 && !tied) {
        if (load<i32>(pTeamC + (winner << 2)) == asTeam) ours++;
        else theirs++;
        continue;
      }
      if ((oursWord & lowest) != 0) ours++;
      else if ((theirsWord & lowest) != 0) theirs++;
    }
  }

  store<i32>(pd + (D_OUT_OURS << 2), ours);
  store<i32>(pd + (D_OUT_THEIRS << 2), theirs);
}

/**
 * THE DECISIVE STAMP — the inner block of the plane-1 sweep, per turn.
 *
 * `decisive[c] = t` for every set bit of `newT`, which is the cells decided at
 * this turn. In JS this is `Math.clz32` on a bitboard word walk with a `Number`
 * per cell; here it is `ctz` and an i32 store.
 */
export function stampDecisive(pNewT: i32, words: i32, pDecisive: i32, t: i32): void {
  for (let word = 0; word < words; word++) {
    let bits = load<u32>(pNewT + (word << 2));
    if (bits == 0) continue;
    const base = word << 5;
    while (bits != 0) {
      store<i32>(pDecisive + ((base + <i32>ctz(bits)) << 2), t);
      bits = bits & (bits - 1);
    }
  }
}

/**
 * `earliest[c]` from a unit's arriving fronts — `shells.ts`'s `stampFronts`.
 *
 * Called once per `Shells` object, not once per evaluation: the grid then STAYS
 * in linear memory for every later partition that reads it. `pFronts` is
 * `u32[count * words]`, the fronts already copied in; `heldAtTurn` seeds the
 * stamp. `out` is `i32[cells]` and is filled with NEVER first, exactly as the
 * JS does.
 */
export function stampFronts(
  pFronts: i32,
  count: i32,
  words: i32,
  cells: i32,
  heldAtTurn: i32,
  pOut: i32
): void {
  for (let c = 0; c < cells; c++) store<i32>(pOut + (c << 2), NEVER);
  for (let i = 0; i < count; i++) {
    const stamp = heldAtTurn + i;
    const row = pFronts + ((i * words) << 2);
    for (let word = 0; word < words; word++) {
      let bits = load<u32>(row + (word << 2));
      if (bits == 0) continue;
      const base = word << 5;
      while (bits != 0) {
        const off = pOut + ((base + <i32>ctz(bits)) << 2);
        if (load<i32>(off) > stamp) store<i32>(off, stamp);
        bits = bits & (bits - 1);
      }
    }
  }
}

// ── `sweepTurn`'s descriptor ───────────────────────────────────────────────

export const S_WORDS: i32 = 0;
export const S_NT: i32 = 1;
export const S_NTEAMS: i32 = 2;
export const S_TURN: i32 = 3;
export const S_NEED_DECISIVE: i32 = 4;
export const S_FRONT_ROWS: i32 = 5;
export const S_ENT_MINE: i32 = 6;
export const S_ENT_HELD: i32 = 7;
export const S_ENT_TEAM: i32 = 8;
export const S_TRAIL_SLOTS: i32 = 9;
export const S_TEAM_LIST: i32 = 10;
export const S_SEEN_ROWS: i32 = 11;
export const S_MULTI_ROWS: i32 = 12;
export const S_PLANE_ROWS: i32 = 13;
export const S_OUR_CUM: i32 = 14;
export const S_THEIR_CUM: i32 = 15;
export const S_OUR_STEP: i32 = 16;
export const S_THEIR_STEP: i32 = 17;
export const S_OURS_BOARD: i32 = 18;
export const S_THEIRS_BOARD: i32 = 19;
export const S_COVERED_PREV: i32 = 20;
export const S_NEW_T: i32 = 21;
export const S_HIT: i32 = 22;
export const S_OTHERS: i32 = 23;
export const S_DECISIVE: i32 = 24;
export const S_LEN: i32 = 25;

/**
 * PLANE 1 — the team-level cover sweep, the per-unit ownership planes and the
 * decisive stamp, for ONE absolute turn.
 *
 * Everything it reads is resident: the fronts are copied into linear memory
 * once per `Shells` object (`pFrontRow[k]` is the row for entry slot k at this
 * turn, or 0 when the horizon does not cover it), and every board is a
 * workspace slab that is already a view onto this memory.
 *
 * Returns 1 when anything was newly covered at this turn, 0 otherwise — the
 * `anyNew` short-circuit, so the host can skip the rest exactly as the JS does.
 */
export function sweepTurn(pd: i32): i32 {
  const words = fld(pd, S_WORDS);
  const nT = fld(pd, S_NT);
  const nTeams = fld(pd, S_NTEAMS);
  const t = fld(pd, S_TURN);
  const needDecisive = fld(pd, S_NEED_DECISIVE);
  const pFrontRow = fld(pd, S_FRONT_ROWS);
  const pMine = fld(pd, S_ENT_MINE);
  const pHeld = fld(pd, S_ENT_HELD);
  const pTeam = fld(pd, S_ENT_TEAM);
  const pTrail = fld(pd, S_TRAIL_SLOTS);
  const pTeams = fld(pd, S_TEAM_LIST);
  const pSeen = fld(pd, S_SEEN_ROWS);
  const pMulti = fld(pd, S_MULTI_ROWS);
  const pPlanes = fld(pd, S_PLANE_ROWS);
  const ourCum = fld(pd, S_OUR_CUM);
  const theirCum = fld(pd, S_THEIR_CUM);
  const ourStep = fld(pd, S_OUR_STEP);
  const theirStep = fld(pd, S_THEIR_STEP);
  const oursBoard = fld(pd, S_OURS_BOARD);
  const theirsBoard = fld(pd, S_THEIRS_BOARD);
  const coveredPrev = fld(pd, S_COVERED_PREV);
  const newT = fld(pd, S_NEW_T);
  const hit = fld(pd, S_HIT);
  const others = fld(pd, S_OTHERS);
  const decisive = fld(pd, S_DECISIVE);

  for (let i = 0; i < words; i++) {
    store<u32>(ourStep + (i << 2), 0);
    store<u32>(theirStep + (i << 2), 0);
  }
  for (let k = 0; k < nT; k++) {
    const e = load<i32>(pTrail + (k << 2));
    const f = load<i32>(pFrontRow + (k << 2));
    if (f == 0) continue;
    const dst = load<u8>(pMine + e) == 1 ? ourStep : theirStep;
    for (let i = 0; i < words; i++) {
      const o = dst + (i << 2);
      store<u32>(o, load<u32>(o) | load<u32>(f + (i << 2)));
    }
  }
  for (let i = 0; i < words; i++) {
    const off = i << 2;
    const oc = load<u32>(ourCum + off) | load<u32>(ourStep + off);
    const tc = load<u32>(theirCum + off) | load<u32>(theirStep + off);
    store<u32>(ourCum + off, oc);
    store<u32>(theirCum + off, tc);
    store<u32>(oursBoard + off, load<u32>(oursBoard + off) | (oc & ~tc));
    store<u32>(theirsBoard + off, load<u32>(theirsBoard + off) | (tc & ~oc));
  }

  let anyNew: u32 = 0;
  for (let i = 0; i < words; i++) {
    const off = i << 2;
    const prev = load<u32>(coveredPrev + off);
    const now = prev | load<u32>(ourStep + off) | load<u32>(theirStep + off);
    const fresh = now & ~prev;
    store<u32>(newT + off, fresh);
    store<u32>(coveredPrev + off, now);
    anyNew |= fresh;
  }
  if (anyNew == 0) return 0;

  for (let ti = 0; ti < nTeams; ti++) {
    const team = load<i32>(pTeams + (ti << 2));
    const seen = load<i32>(pSeen + (team << 2));
    const multi = load<i32>(pMulti + (team << 2));
    for (let i = 0; i < words; i++) {
      store<u32>(seen + (i << 2), 0);
      store<u32>(multi + (i << 2), 0);
    }
    for (let k = 0; k < nT; k++) {
      const e = load<i32>(pTrail + (k << 2));
      // A HELD teammate is not in this team's blocking set.
      if (load<u8>(pHeld + e) == 1 && load<i32>(pTeam + (e << 2)) == team) continue;
      const f = load<i32>(pFrontRow + (k << 2));
      if (f == 0) continue;
      for (let i = 0; i < words; i++) {
        const off = i << 2;
        const h = load<u32>(f + off) & load<u32>(newT + off);
        store<u32>(multi + off, load<u32>(multi + off) | (h & load<u32>(seen + off)));
        store<u32>(seen + off, load<u32>(seen + off) | h);
      }
    }
  }

  for (let k = 0; k < nT; k++) {
    const e = load<i32>(pTrail + (k << 2));
    const f = load<i32>(pFrontRow + (k << 2));
    if (f == 0) continue;
    const team = load<i32>(pTeam + (e << 2));
    const seen = load<i32>(pSeen + (team << 2));
    const multi = load<i32>(pMulti + (team << 2));
    for (let i = 0; i < words; i++) {
      const off = i << 2;
      store<u32>(hit + off, load<u32>(f + off) & load<u32>(newT + off));
    }
    if (load<u8>(pHeld + e) == 1) {
      for (let i = 0; i < words; i++) {
        const off = i << 2;
        store<u32>(others + off, load<u32>(seen + off));
      }
    } else {
      for (let i = 0; i < words; i++) {
        const off = i << 2;
        const h = load<u32>(hit + off);
        store<u32>(others + off, (load<u32>(seen + off) & ~h) | (load<u32>(multi + off) & h));
      }
    }
    const own = load<i32>(pPlanes + (k << 2));
    for (let i = 0; i < words; i++) {
      const off = i << 2;
      store<u32>(own + off, load<u32>(own + off) | (load<u32>(hit + off) & ~load<u32>(others + off)));
    }
  }

  if (needDecisive != 0) stampDecisive(newT, words, decisive, t);
  return 1;
}


/**
 * The per-unit owned counts and the trail domain, after the sweep.
 *
 * `owned[k] = popcount(plane_k & notWall)`, and `domain = coveredPrev & notWall`
 * — the two whole-board passes `partitionOf` runs between the sweep and plane 2.
 * Writes the counts into `pOwned` (i32[nT]).
 */
export function foldPlanes(
  pPlanes: i32,
  nT: i32,
  words: i32,
  pNotWall: i32,
  pOwned: i32,
  pCoveredPrev: i32,
  pDomain: i32
): void {
  for (let k = 0; k < nT; k++) {
    const own = load<i32>(pPlanes + (k << 2));
    let n: i32 = 0;
    for (let i = 0; i < words; i++) {
      n += <i32>popcnt(load<u32>(own + (i << 2)) & load<u32>(pNotWall + (i << 2)));
    }
    store<i32>(pOwned + (k << 2), n);
  }
  for (let i = 0; i < words; i++) {
    const off = i << 2;
    store<u32>(pDomain + off, load<u32>(pCoveredPrev + off) & load<u32>(pNotWall + off));
  }
}

/**
 * `ours`/`theirs` when no piece can displace: popcount of the two side boards
 * masked to open ground. Written into `pOut` (i32[2]).
 */
export function countSides(
  pOursBoard: i32,
  pTheirsBoard: i32,
  pNotWall: i32,
  words: i32,
  pOut: i32
): void {
  let ours: i32 = 0;
  let theirs: i32 = 0;
  for (let i = 0; i < words; i++) {
    const mask = load<u32>(pNotWall + (i << 2));
    ours += <i32>popcnt(load<u32>(pOursBoard + (i << 2)) & mask);
    theirs += <i32>popcnt(load<u32>(pTheirsBoard + (i << 2)) & mask);
  }
  store<i32>(pOut, ours);
  store<i32>(pOut + 4, theirs);
}
