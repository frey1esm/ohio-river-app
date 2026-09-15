import { cached } from "./cache";
import { classifyFreshness, FRESHNESS_THRESHOLDS_MS } from "./freshness";
import { fetchJsonWithTimeout } from "./http";
import { celsiusToFahrenheit, feetPerSecondToMph } from "./units";
import type { TemperatureData, VelocityData } from "./types";

// Ohio River mainstem gauge at Cincinnati (linked from NOAA CCNO1 metadata) —
// mean channel velocity, parameter 72255 (docs/river-reverse-engineering.md §11).
const VELOCITY_SITE = "03255000";
const VELOCITY_PARAM = "72255";
// Licking River tributary — water temperature, parameter 00010, °C
// (docs/river-reverse-engineering.md §12; chosen for proximity to Cincinnati, §12.5).
const TEMPERATURE_SITE = "03254520";
const TEMPERATURE_PARAM = "00010";

const FETCH_TIMEOUT_MS = 8000;
const TTL_VELOCITY_MS = 5 * 60 * 1000;
const TTL_TEMPERATURE_MS = 10 * 60 * 1000;

/** USGS's own historical sentinel/blank conventions
 * (docs/river-reverse-engineering.md §3). */
const INVALID_USGS_VALUES = new Set(["", "-999999"]);

export interface UsgsValue {
  value: string;
  qualifiers?: string[];
  dateTime: string;
}

export interface UsgsResponse {
  value?: {
    timeSeries?: {
      values?: { value?: UsgsValue[] }[];
    }[];
  };
}

export interface ParsedUsgsPoint {
  time: Date;
  value: number;
}

export function parseUsgsSeries(raw: UsgsResponse): ParsedUsgsPoint[] {
  const rawValues = raw.value?.timeSeries?.[0]?.values?.[0]?.value ?? [];
  const points: ParsedUsgsPoint[] = [];
  for (const v of rawValues) {
    if (INVALID_USGS_VALUES.has(v.value)) continue;
    const num = Number.parseFloat(v.value);
    if (!Number.isFinite(num)) continue;
    const time = new Date(v.dateTime);
    if (Number.isNaN(time.getTime())) continue;
    points.push({ time, value: num });
  }
  return points.sort((a, b) => a.time.getTime() - b.time.getTime());
}

function usgsIvUrl(site: string, param: string, period: string): string {
  return `https://waterservices.usgs.gov/nwis/iv/?sites=${site}&parameterCd=${param}&period=${period}&format=json`;
}

/**
 * Mean river velocity from USGS 03255000 parameter 72255, converted to mph.
 * No fixed-area estimate is ever substituted (docs/river-v1-spec.md §5) — an
 * empty or failed fetch simply yields no data, which the caller renders as
 * "Unavailable".
 */
export async function fetchVelocityData(now: Date = new Date()): Promise<VelocityData> {
  const raw = await cached("usgs:velocity", TTL_VELOCITY_MS, () =>
    fetchJsonWithTimeout<UsgsResponse>(usgsIvUrl(VELOCITY_SITE, VELOCITY_PARAM, "P5D"), FETCH_TIMEOUT_MS),
  );
  const points = parseUsgsSeries(raw);
  const history = points.map((p) => ({ time: p.time, mph: feetPerSecondToMph(p.value) }));
  const last = points[points.length - 1];
  const latest = last
    ? classifyFreshness(
        { value: feetPerSecondToMph(last.value), observedAt: last.time },
        FRESHNESS_THRESHOLDS_MS.observedDefault,
        now,
      )
    : null;
  return { latest, history };
}

/**
 * Water temperature from USGS 03254520 parameter 00010 (°C), converted to
 * °F. No air-temperature fallback is ever substituted
 * (docs/river-v1-spec.md §6).
 */
export async function fetchTemperatureData(now: Date = new Date()): Promise<TemperatureData> {
  const raw = await cached("usgs:temperature", TTL_TEMPERATURE_MS, () =>
    fetchJsonWithTimeout<UsgsResponse>(
      usgsIvUrl(TEMPERATURE_SITE, TEMPERATURE_PARAM, "P5D"),
      FETCH_TIMEOUT_MS,
    ),
  );
  const points = parseUsgsSeries(raw);
  const history = points.map((p) => ({ time: p.time, tempF: celsiusToFahrenheit(p.value) }));
  const last = points[points.length - 1];
  const latest = last
    ? classifyFreshness(
        { value: celsiusToFahrenheit(last.value), observedAt: last.time },
        FRESHNESS_THRESHOLDS_MS.temperature,
        now,
      )
    : null;
  return { latest, history };
}
