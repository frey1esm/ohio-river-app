import type { TrendResult } from "./types";

/**
 * Formats date and time as two separate `toLocaleString` calls joined by a
 * literal we control, rather than one call requesting both date and time
 * fields together. A single combined call lets the engine's own ICU/CLDR
 * data choose how to join them (e.g. ", " vs " at "), and that choice isn't
 * pinned across ICU versions — Node's bundled ICU and Safari's produced
 * different joiners for the same options here, which is exactly a
 * server/client hydration mismatch (SSR renders with Node's, the browser
 * re-renders with its own). Formatting each half separately sidesteps that
 * engine-specific combining logic entirely.
 */
function joinDateAndTime(datePart: string, timePart: string): string {
  return `${datePart}, ${timePart}`;
}

export function formatObservedTime(date: Date | null): string {
  if (!date) return "unknown time";
  const datePart = date.toLocaleString("en-US", { month: "short", day: "numeric" });
  const timePart = date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return joinDateAndTime(datePart, timePart);
}

/**
 * Compact date-and-time form for tight card meta rows and forecast valid
 * times alike — weekday stands in for the date (readings and forecasts in
 * this app are always within a ~5-day window, so a weekday is unambiguous)
 * paired with the time, so every reading/forecast timestamp shows both,
 * never time-only. Minutes are omitted only when exactly on the hour.
 */
export function formatObservedTimeShort(date: Date | null): string {
  if (!date) return "unknown";
  const weekday = date.toLocaleString("en-US", { weekday: "short" });
  const timePart = date.toLocaleString("en-US", {
    hour: "numeric",
    minute: date.getMinutes() === 0 ? undefined : "2-digit",
    timeZoneName: "short",
  });
  return `${weekday} ${timePart}`;
}

/**
 * NOAA's `floodCategory` is an open string with no enum guarantee
 * (docs/river-reverse-engineering.md §10.2) — this only reformats
 * underscores/casing for display, it never maps to a fixed lookup table
 * that could silently drop an unrecognized value.
 */
export function formatFloodCategory(category: string): string {
  return category
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatTrend(trend: TrendResult, unit: string, decimals = 2): string {
  if (trend.direction === "unavailable" || trend.deltaPerSixHours === null || trend.elapsedHours === null) {
    return "Insufficient data";
  }
  const magnitude = Math.abs(trend.deltaPerSixHours).toFixed(decimals);
  const hours = trend.elapsedHours.toFixed(1);
  if (trend.direction === "steady") return `→ Steady (${hours}h)`;
  const arrow = trend.direction === "rising" ? "▲" : "▼";
  const sign = trend.direction === "rising" ? "+" : "−";
  return `${arrow} ${sign}${magnitude} ${unit} / ${hours}h`;
}

export function trendDirectionClass(trend: TrendResult): "rising" | "falling" | "steady" {
  return trend.direction === "unavailable" ? "steady" : trend.direction;
}

/**
 * A visual color cue for the stage bar, derived from NOAA's own reported
 * category string. Unrecognized categories fall back to a neutral color
 * rather than a reassuring green, since defaulting an unknown status to
 * "safe" would be the wrong direction to guess (docs/river-v1-spec.md §7's
 * flood-status safety rule).
 */
export function floodStatusColor(category: string | null): string {
  if (!category) return "var(--muted)";
  const c = category.toLowerCase();
  if (c.includes("major")) return "#f43f5e";
  if (c.includes("moderate")) return "#dc2626";
  if (c.includes("minor")) return "#f59e0b";
  if (c.includes("action")) return "#d97706";
  if (c.includes("no_flooding") || c === "normal") return "#10b981";
  return "var(--muted)";
}
