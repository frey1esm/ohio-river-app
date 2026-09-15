import { fetchStageData } from "./noaa";
import { fetchVelocityForecast } from "./nws-rvf";
import { fetchTemperatureData, fetchVelocityData } from "./usgs";
import type { DataResult, RiverData } from "./types";

async function toResult<T>(promise: Promise<T>): Promise<DataResult<T>> {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await promise;
    return { ok: true, data, fetchedAt };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error", fetchedAt };
  }
}

/**
 * Fetches all four independent river data sources concurrently. Each is
 * wrapped in its own DataResult so a single source failing never blanks the
 * rest of the page — the caller renders an "Unavailable" section for
 * whichever source failed and everything else normally.
 */
export async function getRiverData(): Promise<RiverData> {
  const now = new Date();
  const [stage, velocity, temperature, velocityForecast] = await Promise.all([
    toResult(fetchStageData(now)),
    toResult(fetchVelocityData(now)),
    toResult(fetchTemperatureData(now)),
    toResult(fetchVelocityForecast()),
  ]);
  return { stage, velocity, temperature, velocityForecast };
}
