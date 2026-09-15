/**
 * Shared types for the river data layer.
 *
 * Freshness model (see docs/river-v1-spec.md §7 and docs/river-reverse-engineering.md §13):
 * a displayed value is always one of four states, never conflated:
 *   - "fresh"   : a valid reading exists and is within its threshold.
 *   - "stale"   : a valid reading exists but is older than its threshold. It stays
 *                 visible with its own observation timestamp — never hidden — but
 *                 (per owner decision, 2026-09-14) gets no separate "Stale" badge,
 *                 since the timestamp already discloses the age.
 *   - "unknown" : a valid value exists but its observation timestamp is missing or
 *                 unparseable, so age cannot be computed. Never treated as fresh.
 * A fourth outcome, total absence of any valid value, is represented by the
 * `ok: false` branch of DataResult below ("Unavailable") rather than by a
 * freshness state, since there is nothing to label as fresh/stale/unknown.
 */
export type Freshness = "fresh" | "stale" | "unknown";

/** A point-in-time reading with its own observation timestamp. */
export interface TimestampedValue<T> {
  value: T;
  /** The observation's own timestamp (not fetch time). Null means unknown/unparseable. */
  observedAt: Date | null;
}

/** Wraps a timestamped value with its computed freshness relative to a threshold. */
export interface FreshValue<T> extends TimestampedValue<T> {
  freshness: Freshness;
}

/**
 * Outcome of fetching one independent data source. A failed or empty source
 * never blanks the whole page — callers render an "Unavailable" state for
 * this one section while the rest of the page renders normally.
 */
export type DataResult<T> =
  | { ok: true; data: T; fetchedAt: string }
  | { ok: false; error: string; fetchedAt: string };

/** A single observed or forecast stage/flow reading from NOAA NWPS. */
export interface StageFlowPoint {
  time: Date;
  /** Stage, feet. */
  stage: number | null;
  /** Flow, kcfs. */
  flow: number | null;
}

/** NOAA's four named flood-category thresholds (stage, feet). Any may be absent. */
export interface FloodThresholds {
  action: number | null;
  minor: number | null;
  moderate: number | null;
  major: number | null;
}

export interface FloodStatus {
  /** NOAA's own reported category string, e.g. "no_flooding". Never remapped. */
  category: string;
}

export interface StageData {
  /** Full-resolution valid observed series, ascending, trimmed to 5 days. */
  observed: StageFlowPoint[];
  /** Latest valid flow reading (kcfs), classified against the same 60-minute
   * threshold as stage/flood-status/velocity (docs/river-v1-spec.md §7) —
   * flow shares the NOAA observed feed's timestamps but is tracked
   * separately since a point's flow can be null while its stage is valid. */
  latestFlow: FreshValue<number> | null;
  /** Remaining future forecast points NOAA actually returned, capped at 5
   * days from now — never padded or fabricated to fill a shorter window. */
  forecast: StageFlowPoint[];
  forecastIssuedAt: Date | null;
  /** Forecast freshness is a separate, distinct concept from observed-data
   * freshness (docs/river-v1-spec.md §7's policy does not cover forecasts). */
  forecastFreshness: ForecastFreshness;
  thresholds: FloodThresholds;
  floodStatus: FreshValue<FloodStatus> | null;
}

export interface TrendResult {
  /** null when there's insufficient data within tolerance of the 6h target. */
  deltaPerSixHours: number | null;
  /** Actual elapsed hours between the anchor and latest reading, when available. */
  elapsedHours: number | null;
  direction: "rising" | "falling" | "steady" | "unavailable";
}

export interface VelocityData {
  latest: FreshValue<number> | null; // mph
  /** Ascending, last 5 days, mph. */
  history: { time: Date; mph: number }[];
}

export interface TemperatureData {
  latest: FreshValue<number> | null; // Fahrenheit
  /** Ascending, last 5 days, °F. Same Licking River source as `latest`
   * (USGS 03254520, parameter 00010, °C converted). Powers the chart's
   * Temp tab; empty when the source is unavailable. */
  history: { time: Date; tempF: number }[];
}

/** NWS Ohio RFC "River Flow and Velocity Forecasts" (RVF) bulletin, parsed
 * for gauge CCNO1 (docs/river-reverse-engineering.md §11.2, lib/nws-rvf.ts). */
export interface VelocityForecast {
  /** False when the bulletin fetched fine but had no parseable CCNO1 entry
   * — a structural gap, distinct from a fetch failure (DataResult ok:false). */
  available: boolean;
  max: { time: Date; velocityMph: number } | null;
  /** Actual number of forecast days parsed — never a hardcoded assumption. */
  windowDays: number;
  issuedAt: Date | null;
  sourceUrl: string;
}

/** Classification of the stage/flow forecast's own freshness (separate from observed-data freshness). */
export type ForecastFreshness = "current" | "outdated" | "unknown";

export interface RiverData {
  stage: DataResult<StageData>;
  velocity: DataResult<VelocityData>;
  temperature: DataResult<TemperatureData>;
  /** NWS Ohio RFC's RVF bulletin (docs/river-reverse-engineering.md §11.2)
   * — a velocity forecast, distinct from `velocity`'s USGS observations.
   * `data.available` can be false even on a successful fetch (the bulletin
   * loaded but had no parseable CCNO1 entry) — see lib/nws-rvf.ts. */
  velocityForecast: DataResult<VelocityForecast>;
}
