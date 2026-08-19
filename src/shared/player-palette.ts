/**
 * The operator colour palette: a FIXED, ORDERED list handed out by arrival
 * order, so a player's colour is predictable from when they joined and any
 * prefix of the list is as mutually distinct as the remaining colour space
 * allows.
 *
 * WHY ORDERED RATHER THAN HASHED
 * The previous scheme hashed the player's name into an unordered nine-colour
 * set and linearly probed for a free slot. Probing guarantees only that two
 * players hold DIFFERENT entries, never that they hold entries anyone can
 * tell apart — and that set carried near-duplicates: a teal beside a cyan, a
 * purple beside a magenta beside the board's own selection purple, and an
 * orange sitting almost exactly on the food glyph. Because the starting index
 * was a name hash, a two- or three-player game drew an ARBITRARY subset, so
 * the near-duplicate pairs collided as readily as any other combination — the
 * whole list only ever appeared in a nine-player game. Walking a deliberately
 * ordered list from index 0 removes both failure modes: the pairs that
 * co-occur in a small game are exactly the ones chosen to be furthest apart.
 *
 * THE DESIGN RULE (distances are Euclidean in OKLab, hues and lightness in
 * OKLCH)
 * 1. Reserved-colour clearance. Every entry sits at least 0.12 OKLab from
 *    every hue the board already owns, and at least 0.10 from its neutrals
 *    (which a colour separates from by having chroma at all, not by hue).
 * 2. No yellows or yellow-greens. The whole OKLCH hue band 56°-148° is
 *    excluded — fertile ground IS yellow, so a unit in that hue dissolves
 *    into the terrain it stands on.
 * 3. Mid-tone lightness (OKLCH L 0.42-0.76) at the highest chroma sRGB holds
 *    for that hue, so every entry separates from BOTH the white cell behind
 *    it and the black grid and outlines drawn over it.
 * 4. Prefix dispersion. The order is a farthest-point walk: each entry is the
 *    remaining colour furthest (on a hue-dominant metric) from every entry
 *    already placed. The first four are a blue, a red, a green and a violet —
 *    a quarter turn apart each — and the separation floor only relaxes as the
 *    palette lengthens, which is the best a 12-wide set can do once the
 *    reserved hues are carved out.
 * 5. No lightness twins as neighbours. Consecutive entries differ by at least
 *    59° of hue, so "player 8" is never "player 7, but lighter". The two
 *    teal-ish and two blue-violet-ish entries a 12-wide palette is forced
 *    into sit at non-adjacent positions.
 *
 * Twelve entries cover far more operators than a game ever has; past the end
 * the list wraps, which is the only point at which two players share a
 * colour.
 */
export const PLAYER_PALETTE: readonly string[] = [
  '#156cdd', // 0  azure blue      L 0.55  C 0.19  H 258
  '#ff4d6d', // 1  coral rose      L 0.68  C 0.21  H 015
  '#0a7e3a', // 2  emerald green   L 0.52  C 0.14  H 150
  '#8629c0', // 3  violet          L 0.50  C 0.22  H 308
  '#119ba7', // 4  cyan teal       L 0.63  C 0.11  H 205
  '#c70389', // 5  magenta         L 0.55  C 0.23  H 348
  '#88411a', // 6  rust brown      L 0.46  C 0.11  H 046
  '#12cdae', // 7  turquoise       L 0.76  C 0.14  H 176
  '#9b84ff', // 8  periwinkle      L 0.69  C 0.18  H 290
  '#05556f', // 9  deep petrol     L 0.42  C 0.08  H 228
  '#8e0746', // 10 crimson wine    L 0.42  C 0.17  H 002
  '#06726e', // 11 deep teal-green L 0.50  C 0.09  H 191
];

/**
 * The board's own colours, as drawn by src/web/board-renderer.js. Kept beside
 * the palette because rule 1 above is only meaningful next to the list it
 * clears — the palette test measures against exactly these.
 *
 * Several are painted semi-transparently over a white cell, so what the eye
 * actually compares a player colour against is the COMPOSITE, not the source
 * value: the fertile hatch is rgba(240,198,70,0.85), the hazard wash
 * rgba(220,30,30,0.18) with rgba(200,12,12,0.9) lattice bars over it, and the
 * orientation eye's stroke rgba(56,174,255,0.8). Those are flattened here.
 *
 * `humanArrow` earns its place too: it is the green a staged arrow falls back
 * to when the command has no identified operator, so it is drawn at exactly
 * the size and in exactly the role a player-coloured arrow is.
 */
export const RESERVED_BOARD_COLORS: Readonly<Record<string, string>> = {
  fertileHatch: '#f2cf62',
  hazardLattice: '#cd2020',
  hazardWash: '#f9d7d7',
  food: '#f5811f',
  selectionRing: '#e040fb',
  orientationEyeFill: '#80d8ff',
  orientationEyeStroke: '#60beff',
  humanArrow: '#4caf50',
};

/**
 * The board's achromatic furniture: the cell, the grid and text drawn on it,
 * and the grey a bot-sourced arrow uses. A player colour separates from these
 * by HAVING a hue, so they carry a lower distance floor than the colours
 * above — a saturated teal is unmistakable next to grey at a tenth of the
 * OKLab distance that would be needed to tell it from another teal.
 */
export const NEUTRAL_BOARD_COLORS: Readonly<Record<string, string>> = {
  cell: '#ffffff',
  grid: '#000000',
  botArrow: '#888888',
  secondaryArrow: '#9e9e9e',
};

/**
 * The colour for the Nth player to arrive in a game (0-based). Wraps past the
 * end of the palette, which is the only way two live players collide.
 */
export function colorForArrivalIndex(arrivalIndex: number): string {
  const n = PLAYER_PALETTE.length;
  // Guard against a negative or non-integer index reaching the modulo.
  const i = Number.isFinite(arrivalIndex) ? Math.max(0, Math.floor(arrivalIndex)) : 0;
  return PLAYER_PALETTE[i % n];
}
