/**
 * FIVE WIRES, NAMED — the harness's latency profiles.
 *
 * `docs/design/ux/03-LATENCY.md` §3.5 gave the walkthrough server a constant
 * delay and a uniform jitter, which is enough to reach every rung of the
 * ladder and is not enough to ask whether the ladder is RIGHT. A constant
 * delay has no distribution, so a notch drawn from a distribution cannot be
 * wrong against it; a uniform jitter has no tail, so a band sized off a
 * quantile is never tested; and neither of them ever does the one thing a
 * real bad connection does, which is to be fine for a second and then stop.
 *
 * These five are the wires the round is designed against. Each is stated as a
 * ROUND TRIP, because that is the number every other tool an operator has ever
 * seen states — a game's net graph, a `ping`, a chess server's lag readout —
 * and it is split evenly across the two hops, so a profile applied to one hop
 * only (`--profile-down=mobile`) is half of it, which is exactly the asymmetry
 * that tells an old board apart from a late press.
 *
 *   lan          5 ms       the machine next to you. The control.
 *   regional    40 ± 10     one hop through a city. Comfortable.
 *   continental 120 ± 30    coast to coast, or a sea crossing.
 *   mobile      200 ± 80    a phone: a wide jitter tail, 2 % loss, and the
 *                           handover stall that is the real experience of one.
 *   saturated   60 base     bufferbloat. The link is not slow; the buffer in
 *                           front of it is deep, so the delay CLIMBS while the
 *                           turn is talking and drains between turns
 *                           (Gettys, *Bufferbloat*, ACM Queue 9(11), 2011).
 *
 * The numbers are ordinary-internet figures rather than measurements of this
 * repository's production wire, which nobody has: they are stated here so that
 * a reader can disagree with them in one place.
 */

import type { HopShaping, TransportShaping } from '../server/websocket-server';

export interface LatencyProfile {
  readonly name: string;
  /** Round-trip propagation, ms. Each hop gets half. */
  readonly rttMs: number;
  /** Round-trip ± jitter. Each hop gets half. */
  readonly jitterRttMs: number;
  /** Per-hop loss, 0..1. */
  readonly lossRate: number;
  /** An occasional hold that blocks the frames behind it too. */
  readonly stallMs: number;
  readonly stallRate: number;
  /** The bottleneck, bytes per ms. 0 ⇒ the link is not the bottleneck. */
  readonly rateBytesPerMs: number;
  /** Tail drop for a frame that would wait longer than this. */
  readonly queueMaxMs: number;
  readonly note: string;
}

const P = (
  name: string,
  rttMs: number,
  jitterRttMs: number,
  note: string,
  extra: Partial<LatencyProfile> = {}
): LatencyProfile => ({
  name,
  rttMs,
  jitterRttMs,
  lossRate: 0,
  stallMs: 0,
  stallRate: 0,
  rateBytesPerMs: 0,
  queueMaxMs: 0,
  note,
  ...extra,
});

export const LATENCY_PROFILES: Readonly<Record<string, LatencyProfile>> = {
  free: P('free', 0, 0, 'the dev box: both hops in one process'),
  lan: P('lan', 5, 0, 'the machine next to you'),
  regional: P('regional', 40, 10, 'one hop through a city'),
  continental: P('continental', 120, 30, 'coast to coast, or a sea crossing'),
  mobile: P('mobile', 200, 80, 'a phone, handovers and all', {
    lossRate: 0.02,
    stallMs: 800,
    stallRate: 0.015,
  }),
  // 25 B/ms is 200 kbit/s of goodput. A turn of this game offers ~55 KB of
  // `lens-frames` (03 §1.2), so on a 1.5 s turn the offered load is a little
  // over the service rate and the queue climbs a few hundred ms per turn and
  // drains between them — which is bufferbloat's actual signature and the one
  // thing a constant delay can never produce. The tail drop is the bound the
  // bloated buffer does not have; it applies to superseded frames only unless
  // `--loss-any` is set, so the fold is not silently holed by the queue.
  saturated: P('saturated', 60, 10, 'bufferbloat: a deep buffer in front of a slow link', {
    rateBytesPerMs: 25,
    queueMaxMs: 1200,
  }),
};

export const PROFILE_NAMES: ReadonlyArray<string> = Object.keys(LATENCY_PROFILES);

export function profileOf(name: string): LatencyProfile | null {
  return LATENCY_PROFILES[name] ?? null;
}

/** One hop's worth of a profile: half the round trip, all of the rest. */
export function hopShapingOf(p: LatencyProfile): HopShaping {
  return {
    baseMs: p.rttMs / 2,
    jitterMs: p.jitterRttMs / 2,
    lossRate: p.lossRate,
    stallMs: p.stallMs,
    stallRate: p.stallRate,
    rateBytesPerMs: p.rateBytesPerMs,
    queueMaxMs: p.queueMaxMs,
  };
}

/**
 * The `TransportShaping` two named profiles imply. Null when both hops are
 * free — the shipped wire, and the state in which nothing is installed at all.
 */
export function shapingOf(
  down: LatencyProfile | null,
  up: LatencyProfile | null,
  opts: { readonly seed?: number; readonly lossAny?: boolean } = {}
): TransportShaping | null {
  const d = down === null ? null : hopShapingOf(down);
  const u = up === null ? null : hopShapingOf(up);
  const free = (h: HopShaping | null): boolean =>
    h === null ||
    ((h.baseMs ?? 0) === 0 && (h.jitterMs ?? 0) === 0 && (h.lossRate ?? 0) === 0 &&
      (h.stallRate ?? 0) === 0 && (h.rateBytesPerMs ?? 0) === 0);
  if (free(d) && free(u)) return null;
  return {
    down: d ?? {},
    up: u ?? {},
    seed: opts.seed ?? 1,
    lossAny: opts.lossAny === true,
  };
}
