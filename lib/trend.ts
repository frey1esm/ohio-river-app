import type { TrendResult } from "./types";

export interface TrendPoint {
  time: Date;
  value: number;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
/** Approved default tolerance window around the 6-hour target
 * (docs/river-v1-spec.md §3, approved defaults message). */
export const TREND_TOLERANCE_MS = 30 * 60 * 1000;

/**
 * Timestamp-based six-hour trend (docs/river-reverse-engineering.md §9,
 * docs/river-v1-spec.md §3): compares the latest observation against the
 * nearest valid reading to six hours before it, within a tolerance window —
 * never a fixed count of array points. Computed against the full-resolution
 * series passed in; downsampling for chart display must happen elsewhere and
 * never feed this function.
 *
 * `series` must be sorted ascending by time. `steadyEpsilon` is the
 * dead-band below which a delta is reported as "steady" rather than
 * rising/falling (scale-dependent per metric, e.g. ~0.03 ft for stage).
 */
export function computeSixHourTrend(
  series: TrendPoint[],
  steadyEpsilon: number,
): TrendResult {
  if (series.length === 0) {
    return { deltaPerSixHours: null, elapsedHours: null, direction: "unavailable" };
  }

  const latest = series[series.length - 1];
  const target = new Date(latest.time.getTime() - SIX_HOURS_MS);

  let best: TrendPoint | null = null;
  let bestDiff = Infinity;

  for (const point of series) {
    if (point.time.getTime() > latest.time.getTime()) continue;
    if (point === latest) continue;
    const diff = Math.abs(point.time.getTime() - target.getTime());
    if (diff > TREND_TOLERANCE_MS) continue;
    // Tie-break: prefer the chronologically earlier (at-or-before target) candidate.
    if (
      diff < bestDiff ||
      (diff === bestDiff && best && point.time.getTime() < best.time.getTime())
    ) {
      best = point;
      bestDiff = diff;
    }
  }

  if (!best) {
    return { deltaPerSixHours: null, elapsedHours: null, direction: "unavailable" };
  }

  const delta = latest.value - best.value;
  const elapsedHours = (latest.time.getTime() - best.time.getTime()) / (60 * 60 * 1000);
  const direction = Math.abs(delta) < steadyEpsilon ? "steady" : delta > 0 ? "rising" : "falling";

  return { deltaPerSixHours: delta, elapsedHours, direction };
}
