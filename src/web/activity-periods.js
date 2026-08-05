/**
 * Period/segment reconstruction for the /activity timeline.
 *
 * Shared between the browser page (activity.html, via <script src>) and the
 * Jest unit tests (src/tests/activity-periods.test.ts, via require) — this is
 * the single source of truth for how raw server events become drawable
 * periods.
 *
 * Input: events ascending by ts: {ts, type, detail} where type is one of
 *   boot | shutdown | woke | went-idle | suspended.
 * Output: periods: {
 *   start, end, endKnown, openEnded, startUnknown?,
 *   endClass: 'graceful'|'crash'|'silent-kill'|'unknown'|null,
 *   deadUntil: ts|null,  // when endKnown=false: gap from `end` to `deadUntil`
 *                        // is "scaled to zero / dead" until the next boot
 *   segments: [{start, end, state: 'active'|'idle'}]
 * }
 *
 * Key rule: a boot event whose detail carries prevLastAliveAt (written by the
 * liveness heartbeat forensics) closes the previous end-unknown period at the
 * last heartbeat instead of at the boot itself — the remainder of the gap is
 * genuinely "scaled to zero", not "up but idle".
 */
(function (global) {
  'use strict';

  function buildPeriods(events, serverNow) {
    const periods = [];
    let cur = null;
    let segStart = 0;
    let segState = 'idle';

    function closeSegment(at) {
      if (!cur) return;
      if (at > segStart) cur.segments.push({ start: segStart, end: at, state: segState });
    }
    function closePeriod(at, endKnown, openEnded, endClass, deadUntil) {
      if (!cur) return;
      closeSegment(at);
      cur.end = at;
      cur.endKnown = endKnown;
      cur.openEnded = !!openEnded;
      cur.endClass = endClass || null;
      cur.deadUntil = deadUntil != null ? deadUntil : null;
      periods.push(cur);
      cur = null;
    }

    function applyActivity(ev) {
      if (ev.type === 'woke' && segState !== 'active') {
        closeSegment(ev.ts);
        segStart = ev.ts;
        segState = 'active';
      } else if (ev.type === 'went-idle' && segState !== 'idle') {
        closeSegment(ev.ts);
        segStart = ev.ts;
        segState = 'idle';
      } else if (ev.type === 'shutdown') {
        const sig = ev.detail && ev.detail.signal;
        const cls = sig === 'uncaughtException' || sig === 'unhandledRejection' ? 'crash' : 'graceful';
        closePeriod(ev.ts, true, false, cls, null);
      }
      // 'suspended' events do not change activity state — rendered as markers.
    }

    for (const ev of events) {
      if (ev.type === 'boot') {
        if (cur) {
          // Previous process never wrote a shutdown. If this boot carries
          // heartbeat forensics, close the dead period at its last heartbeat
          // — the rest of the gap is scaled-to-zero, not "up but idle".
          const d = ev.detail || {};
          const lastAlive = typeof d.prevLastAliveAt === 'number' ? d.prevLastAliveAt : null;
          if (lastAlive != null && lastAlive > cur.start && lastAlive < ev.ts) {
            closePeriod(lastAlive, false, false, d.prevEndClass || 'unknown', ev.ts);
          } else {
            // No heartbeat data (pre-feature boot): fall back to closing at
            // the boot itself with an unknown end.
            closePeriod(ev.ts, false, false, 'unknown', ev.ts);
          }
        }
        cur = { start: ev.ts, segments: [], end: 0, endKnown: true, openEnded: false, endClass: null, deadUntil: null };
        segStart = ev.ts;
        segState = 'idle';
      } else if (!cur) {
        // Events before the first loaded boot: synthesize an "unknown start"
        // period so activity before the fetch window's first boot still shows.
        cur = { start: ev.ts, segments: [], end: 0, endKnown: true, openEnded: false, endClass: null, deadUntil: null, startUnknown: true };
        segStart = ev.ts;
        segState = 'idle';
        applyActivity(ev);
      } else {
        applyActivity(ev);
      }
    }

    // Still-open period: extend to serverNow as a live, open-ended period.
    if (cur) closePeriod(Math.max(serverNow, segStart), true, true, null, null);
    return periods;
  }

  const api = { buildPeriods };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ActivityPeriods = api;
  }
})(typeof window !== 'undefined' ? window : this);
