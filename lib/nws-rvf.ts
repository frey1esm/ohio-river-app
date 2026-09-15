import { cached } from "./cache";
import { fetchJsonWithTimeout } from "./http";
import type { VelocityForecast } from "./types";

/**
 * NWS Ohio River Forecast Center's "River Flow and Velocity Forecasts"
 * (RVF) product for CCNO1 (docs/river-reverse-engineering.md §11.2). Used
 * ONLY for a velocity forecast — current velocity itself still comes from
 * USGS 03255000/72255 (observations, decision 5). This is a genuinely
 * different, official source: a real structured government API
 * (api.weather.gov/products), not HTML scraping, confirmed live to issue
 * once daily with a stable LID-keyed line for this exact gauge (CCNO1).
 */
const RVF_LIST_URL = "https://api.weather.gov/products/types/RVF/locations/TIR";
const RVF_TTL_MS = 60 * 60 * 1000; // matches the confirmed ~once-daily issuance cadence
const FETCH_TIMEOUT_MS = 8000;

export interface RvfEntry {
  time: Date;
  flowKcfs: number;
  velocityMph: number;
}

interface RvfLocationsResponse {
  "@graph"?: { id: string; issuanceTime: string }[];
}

interface RvfProductResponse {
  issuanceTime: string;
  productText: string;
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/**
 * Parses the CCNO1 (Cincinnati) row out of the RVF bulletin's raw text.
 * Both the date-header line ("Sep 08   Sep 09   Sep 10   Sep 11") and the
 * LID-keyed data line ("CCNO1  62.5/1.3  / 52.8/1.1  / ...") are located by
 * their fixed structural anchors, not a hardcoded count of columns — the
 * bulletin's actual column count becomes `windowDays`, never assumed.
 *
 * All values are documented as instantaneous projections at "7am EST or
 * 8am EDT" (docs/river-reverse-engineering.md §11.2) — both are exactly
 * 12:00 UTC, so no DST detection is needed to build each entry's timestamp.
 */
export function parseRvfCincinnati(productText: string, issuedAt: Date): RvfEntry[] {
  const lines = productText.split(/\r?\n/);
  const anchorIndex = lines.findIndex((l) => /Forecast Point/i.test(l));
  if (anchorIndex <= 0) return [];
  const dateHeaderLine = lines[anchorIndex - 1];

  const dateMatches = [...dateHeaderLine.matchAll(/([A-Z][a-z]{2})\s+(\d{2})/g)];
  if (dateMatches.length === 0) return [];

  const dataLine = lines.find((l) => /^CCNO1\b/.test(l.trim()));
  if (!dataLine) return [];
  const pairMatches = [...dataLine.matchAll(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/g)];
  if (pairMatches.length === 0) return [];

  const count = Math.min(dateMatches.length, pairMatches.length);
  const issuedYear = issuedAt.getUTCFullYear();
  const issuedMonth = issuedAt.getUTCMonth();

  const entries: RvfEntry[] = [];
  for (let i = 0; i < count; i++) {
    const [, monAbbr, dayStr] = dateMatches[i];
    const month = MONTHS[monAbbr];
    if (month === undefined) continue;
    // Handle a December-issued bulletin whose forecast rolls into January.
    const year = month < issuedMonth - 6 ? issuedYear + 1 : issuedYear;
    const day = Number.parseInt(dayStr, 10);
    const [, flowStr, velStr] = pairMatches[i];
    entries.push({
      time: new Date(Date.UTC(year, month, day, 12, 0, 0)),
      flowKcfs: Number.parseFloat(flowStr),
      velocityMph: Number.parseFloat(velStr),
    });
  }
  return entries;
}

function unavailable(): VelocityForecast {
  return {
    available: false,
    max: null,
    windowDays: 0,
    issuedAt: null,
    sourceUrl: "https://forecast.weather.gov/product.php?site=NWS&issuedby=TIR&product=RVF",
  };
}

export async function fetchVelocityForecast(): Promise<VelocityForecast> {
  const listing = await cached("nws:rvf:list", RVF_TTL_MS, () =>
    fetchJsonWithTimeout<RvfLocationsResponse>(RVF_LIST_URL, FETCH_TIMEOUT_MS),
  );
  const latest = listing["@graph"]?.[0];
  if (!latest) return unavailable();

  const product = await cached(`nws:rvf:product:${latest.id}`, RVF_TTL_MS, () =>
    fetchJsonWithTimeout<RvfProductResponse>(`https://api.weather.gov/products/${latest.id}`, FETCH_TIMEOUT_MS),
  );
  const issuedAt = new Date(product.issuanceTime);
  const entries = parseRvfCincinnati(product.productText, issuedAt);
  if (entries.length === 0) return unavailable();

  const max = entries.reduce((a, b) => (b.velocityMph > a.velocityMph ? b : a));
  return {
    available: true,
    max: { time: max.time, velocityMph: max.velocityMph },
    windowDays: entries.length,
    issuedAt,
    sourceUrl: "https://forecast.weather.gov/product.php?site=NWS&issuedby=TIR&product=RVF",
  };
}
