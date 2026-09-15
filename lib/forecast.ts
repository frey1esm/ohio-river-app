import type { ForecastFreshness, StageFlowPoint } from "./types";

/** Approved default: a forecast issued more than 24h ago is "Outdated"
 * (approved defaults message — distinct from, and not covered by, the
 * observed-data staleness policy in docs/river-v1-spec.md §7). */
export const FORECAST_OUTDATED_MS = 24 * 60 * 60 * 1000;

export interface ForecastState {
  /** Remaining future forecast points, capped at 5 days from `now`. Never
   * padded — if NOAA returned fewer than 5 days, this is shorter than 5 days. */
  points: StageFlowPoint[];
  freshness: ForecastFreshness;
}

/**
 * Classifies forecast freshness and filters to "remaining future
 * predictions" per the approved defaults: an old issuance still shows its
 * remaining future points with an "Outdated" warning rather than hiding
 * them; a missing issuance time is "unknown" freshness, not treated as
 * current; and if no future points remain at all (all forecast times have
 * already passed), the caller should render "Forecast unavailable" — an
 * empty `points` array signals that regardless of `freshness`.
 */
export function classifyForecast(
  allForecastPoints: StageFlowPoint[],
  issuedAt: Date | null,
  now: Date = new Date(),
): ForecastState {
  const fiveDaysOut = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const points = allForecastPoints.filter(
    (p) => p.time.getTime() >= now.getTime() && p.time.getTime() <= fiveDaysOut.getTime(),
  );

  let freshness: ForecastFreshness;
  if (!issuedAt || Number.isNaN(issuedAt.getTime())) {
    freshness = "unknown";
  } else {
    freshness = now.getTime() - issuedAt.getTime() > FORECAST_OUTDATED_MS ? "outdated" : "current";
  }

  return { points, freshness };
}
