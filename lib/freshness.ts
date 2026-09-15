import type { Freshness, FreshValue, TimestampedValue } from "./types";

/**
 * Approved v1 freshness thresholds (docs/river-v1-spec.md §7,
 * docs/river-reverse-engineering.md §13). Product settings, not agency
 * standards — chosen for this app, not derived from a NOAA/USGS guarantee.
 */
export const FRESHNESS_THRESHOLDS_MS = {
  /** Stage, observed flood status, and mean river velocity. */
  observedDefault: 60 * 60 * 1000,
  /** Water temperature — longer, because it changes slowly and this feed's
   * own live-checked lag (60-90 min) already consumes most of a 60-min window. */
  temperature: 2 * 60 * 60 * 1000,
} as const;

/**
 * Classifies a timestamped value's freshness against `thresholdMs`, computed
 * from the observation's own timestamp — never from fetch/"now" time for
 * anything but the comparison itself. A missing or invalid timestamp is
 * "unknown" freshness, never implicitly "fresh".
 */
export function classifyFreshness<T>(
  value: TimestampedValue<T>,
  thresholdMs: number,
  now: Date = new Date(),
): FreshValue<T> {
  if (!value.observedAt || Number.isNaN(value.observedAt.getTime())) {
    return { ...value, observedAt: null, freshness: "unknown" };
  }
  const ageMs = now.getTime() - value.observedAt.getTime();
  const freshness: Freshness = ageMs > thresholdMs ? "stale" : "fresh";
  return { ...value, freshness };
}

export function ageMs(observedAt: Date, now: Date = new Date()): number {
  return now.getTime() - observedAt.getTime();
}
