import { cached } from "./cache";
import { classifyFreshness, FRESHNESS_THRESHOLDS_MS } from "./freshness";
import { fetchJsonWithTimeout } from "./http";
import type { FloodStatus, FloodThresholds, FreshValue, StageData, StageFlowPoint } from "./types";
import { classifyForecast } from "./forecast";

// Gauge CCNO1, Ohio River at Cincinnati (docs/river-reverse-engineering.md §8, §10).
const OBSERVED_URL = "https://api.water.noaa.gov/nwps/v1/gauges/CCNO1/stageflow/observed";
const FORECAST_URL = "https://api.water.noaa.gov/nwps/v1/gauges/CCNO1/stageflow/forecast";
const META_URL = "https://api.water.noaa.gov/nwps/v1/gauges/CCNO1";

const FETCH_TIMEOUT_MS = 8000;
// Per-source TTLs, deliberately not one shared value (docs/river-reverse-engineering.md §2, §13).
const TTL_OBSERVED_MS = 3 * 60 * 1000;
const TTL_FORECAST_MS = 15 * 60 * 1000;
const TTL_META_MS = 5 * 60 * 1000;

/** NOAA's sentinel for missing/invalid values (docs/river-reverse-engineering.md §4e, §8.1). */
const SENTINEL_THRESHOLD = -9000;
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export interface NwpsDatum {
  validTime: string;
  primary: number | null;
  secondary: number | null;
}

interface NwpsStageFlowResponse {
  issuedTime?: string;
  data: NwpsDatum[];
}

interface NwpsFloodCategoryDatum {
  stage?: number | null;
}

interface NwpsMetadata {
  flood?: {
    categories?: {
      major?: NwpsFloodCategoryDatum;
      moderate?: NwpsFloodCategoryDatum;
      minor?: NwpsFloodCategoryDatum;
      action?: NwpsFloodCategoryDatum;
    };
  };
  status?: {
    observed?: {
      floodCategory?: string;
      validTime?: string;
    };
  };
}

export function parsePoint(d: NwpsDatum): StageFlowPoint | null {
  if (d.primary === null || d.primary === undefined || d.primary <= SENTINEL_THRESHOLD) {
    return null;
  }
  const flow =
    d.secondary !== null && d.secondary !== undefined && d.secondary > SENTINEL_THRESHOLD
      ? d.secondary
      : null;
  return { time: new Date(d.validTime), stage: d.primary, flow };
}

export function parsePoints(data: NwpsDatum[] | undefined): StageFlowPoint[] {
  if (!data) return [];
  return data
    .map(parsePoint)
    .filter((p): p is StageFlowPoint => p !== null)
    .sort((a, b) => a.time.getTime() - b.time.getTime());
}

/**
 * Finds the most recent observed point with a valid (non-null) flow value
 * and classifies its freshness. Flow is tracked separately from stage
 * because a point's flow can be sentinel/missing while its stage is still
 * valid (docs/river-reverse-engineering.md §4e) — the latest *valid* flow
 * reading is not always the same point as the latest observed row.
 */
export function latestValidFlow(
  observed: StageFlowPoint[],
  now: Date = new Date(),
): FreshValue<number> | null {
  for (let i = observed.length - 1; i >= 0; i--) {
    const p = observed[i];
    if (p.flow !== null) {
      return classifyFreshness<number>(
        { value: p.flow, observedAt: p.time },
        FRESHNESS_THRESHOLDS_MS.observedDefault,
        now,
      );
    }
  }
  return null;
}

async function fetchObserved(): Promise<NwpsStageFlowResponse> {
  return cached("noaa:observed", TTL_OBSERVED_MS, () =>
    fetchJsonWithTimeout<NwpsStageFlowResponse>(OBSERVED_URL, FETCH_TIMEOUT_MS),
  );
}

async function fetchForecast(): Promise<NwpsStageFlowResponse> {
  return cached("noaa:forecast", TTL_FORECAST_MS, () =>
    fetchJsonWithTimeout<NwpsStageFlowResponse>(FORECAST_URL, FETCH_TIMEOUT_MS),
  );
}

async function fetchMeta(): Promise<NwpsMetadata> {
  return cached("noaa:meta", TTL_META_MS, () =>
    fetchJsonWithTimeout<NwpsMetadata>(META_URL, FETCH_TIMEOUT_MS),
  );
}

/**
 * Fetches and assembles NOAA stage/flow/flood-status data for CCNO1.
 *
 * The observed feed is treated as load-bearing: if it fails, this function
 * throws (the caller renders the whole stage section as unavailable), since
 * there is no stage value to show at all without it — matching the legacy
 * app's one fatal-error condition (docs/river-reverse-engineering.md §1).
 * Forecast and metadata fetches are independent and degrade gracefully:
 * a failure there yields an empty forecast / absent thresholds / null flood
 * status rather than failing the whole section, exactly as in the legacy app.
 */
export async function fetchStageData(now: Date = new Date()): Promise<StageData> {
  const [observedResult, forecastResult, metaResult] = await Promise.allSettled([
    fetchObserved(),
    fetchForecast(),
    fetchMeta(),
  ]);

  if (observedResult.status === "rejected") {
    throw observedResult.reason instanceof Error
      ? observedResult.reason
      : new Error("Failed to fetch NOAA observed stage/flow data");
  }

  const cutoff = new Date(now.getTime() - FIVE_DAYS_MS);
  const observed = parsePoints(observedResult.value.data).filter(
    (p) => p.time.getTime() >= cutoff.getTime(),
  );

  const latestFlow = latestValidFlow(observed, now);

  const forecastRaw =
    forecastResult.status === "fulfilled" ? forecastResult.value : { data: [] as NwpsDatum[] };
  const allForecastPoints = parsePoints(forecastRaw.data);
  const issuedTimeRaw = forecastResult.status === "fulfilled" ? forecastResult.value.issuedTime : undefined;
  const forecastIssuedAt = issuedTimeRaw ? new Date(issuedTimeRaw) : null;
  const { points: forecast, freshness: forecastFreshness } = classifyForecast(
    allForecastPoints,
    forecastIssuedAt && !Number.isNaN(forecastIssuedAt.getTime()) ? forecastIssuedAt : null,
    now,
  );

  const meta = metaResult.status === "fulfilled" ? metaResult.value : {};
  const categories = meta.flood?.categories;
  const thresholds: FloodThresholds = {
    action: categories?.action?.stage ?? null,
    minor: categories?.minor?.stage ?? null,
    moderate: categories?.moderate?.stage ?? null,
    major: categories?.major?.stage ?? null,
  };

  const statusObserved = meta.status?.observed;
  const floodStatus =
    statusObserved?.floodCategory !== undefined
      ? classifyFreshness<FloodStatus>(
          {
            value: { category: statusObserved.floodCategory },
            observedAt: statusObserved.validTime ? new Date(statusObserved.validTime) : null,
          },
          FRESHNESS_THRESHOLDS_MS.observedDefault,
          now,
        )
      : null;

  return { observed, latestFlow, forecast, forecastIssuedAt, forecastFreshness, thresholds, floodStatus };
}
