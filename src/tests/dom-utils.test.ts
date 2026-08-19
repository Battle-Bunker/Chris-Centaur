/**
 * Unit tests for the shared web-page helpers
 * (src/web/dom-utils.js — shared verbatim with the browser pages).
 *
 * Pins the ONE null-safe escapeHtml (the six per-page copies it replaced
 * diverged: play-game's crashed/emitted "null"/"undefined" on nullish input)
 * and the fmtTime/fmtDur formats previously duplicated between
 * connection-debug.js and connection-debug.html.
 */
const { escapeHtml, fmtTime, fmtDur, openGame } = require('../web/dom-utils.js');

describe('escapeHtml', () => {
  test('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('&')">`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;&amp;&#39;)&quot;&gt;'
    );
  });

  test('is null-safe: null and undefined render as empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('stringifies non-string input', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(false)).toBe('false');
  });

  test('leaves plain text untouched', () => {
    expect(escapeHtml('Red Rockets A')).toBe('Red Rockets A');
  });
});

describe('fmtDur', () => {
  test('null-safe: nullish renders as empty string', () => {
    expect(fmtDur(null)).toBe('');
    expect(fmtDur(undefined)).toBe('');
  });

  test('sub-second durations in milliseconds', () => {
    expect(fmtDur(0)).toBe('0ms');
    expect(fmtDur(999)).toBe('999ms');
  });

  test('sub-minute durations in tenths of seconds', () => {
    expect(fmtDur(1000)).toBe('1.0s');
    expect(fmtDur(3540)).toBe('3.5s');
    expect(fmtDur(59999)).toBe('60.0s');
  });

  test('minute durations as m s', () => {
    expect(fmtDur(60000)).toBe('1m 0s');
    expect(fmtDur(137250)).toBe('2m 17s');
  });
});

describe('fmtTime', () => {
  test('appends zero-padded milliseconds to the local time', () => {
    // The hh:mm:ss part is locale/timezone-dependent; pin the shape and the
    // millisecond suffix.
    expect(fmtTime(1700000000482)).toMatch(/^\d{1,2}:\d{2}:\d{2}\.482$/);
    expect(fmtTime(1700000000007)).toMatch(/\.007$/);
  });
});

describe('openGame', () => {
  test('navigates to the encoded game URL on the module global', () => {
    // Under require() the UMD wrapper binds `global` to the module context;
    // openGame writes through global.location, so stub it there.
    const g = globalThis as any;
    const hadLocation = 'location' in g;
    const saved = g.location;
    g.location = { href: 'about:blank' };
    try {
      openGame('game/1 2');
      expect(g.location.href).toBe('/game/game%2F1%202');
    } finally {
      if (hadLocation) g.location = saved;
      else delete g.location;
    }
  });
});
