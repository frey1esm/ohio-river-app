import { describe, expect, it } from "vitest";
import { classifyForecast, FORECAST_OUTDATED_MS } from "./forecast";
import type { StageFlowPoint } from "./types";

const now = new Date("2026-09-08T20:00:00Z");

function point(iso: string, stage = 26.5): StageFlowPoint {
  return { time: new Date(iso), stage, flow: 50 };
}

describe("classifyForecast", () => {
  it("is current when issued recently, keeping only future points", () => {
    const issuedAt = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
    const points = [
      point("2026-09-08T18:00:00Z"), // in the past relative to `now`
      point("2026-09-09T00:00:00Z"), // future
      point("2026-09-10T00:00:00Z"), // future
    ];
    const result = classifyForecast(points, issuedAt, now);
    expect(result.freshness).toBe("current");
    expect(result.points).toHaveLength(2);
    expect(result.points.every((p) => p.time.getTime() >= now.getTime())).toBe(true);
  });

  it("flags a forecast issued more than 24h ago as outdated but keeps remaining future points", () => {
    const issuedAt = new Date(now.getTime() - FORECAST_OUTDATED_MS - 1000);
    const points = [point("2026-09-09T00:00:00Z")];
    const result = classifyForecast(points, issuedAt, now);
    expect(result.freshness).toBe("outdated");
    expect(result.points).toHaveLength(1);
  });

  it("is current, not outdated, exactly at the 24h boundary", () => {
    const issuedAt = new Date(now.getTime() - FORECAST_OUTDATED_MS);
    const result = classifyForecast([point("2026-09-09T00:00:00Z")], issuedAt, now);
    expect(result.freshness).toBe("current");
  });

  it("reports unknown freshness when issuedAt is null, without treating it as current", () => {
    const result = classifyForecast([point("2026-09-09T00:00:00Z")], null, now);
    expect(result.freshness).toBe("unknown");
  });

  it("yields empty points (forecast unavailable) when all forecast times have already passed", () => {
    const issuedAt = new Date(now.getTime() - 60 * 60 * 1000);
    const points = [point("2026-09-08T10:00:00Z"), point("2026-09-08T15:00:00Z")];
    const result = classifyForecast(points, issuedAt, now);
    expect(result.points).toHaveLength(0);
    // Freshness is still reported independently of whether any points remain.
    expect(result.freshness).toBe("current");
  });

  it("caps future points at 5 days out, never extending further", () => {
    const issuedAt = new Date(now.getTime());
    const points = [
      point("2026-09-10T00:00:00Z"), // ~1.2 days out
      point("2026-09-20T00:00:00Z"), // ~12 days out, beyond the 5-day cap
    ];
    const result = classifyForecast(points, issuedAt, now);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].time.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("never pads a short forecast to fill 5 days", () => {
    const issuedAt = new Date(now.getTime());
    const points = [point("2026-09-09T00:00:00Z")]; // only ~1 day of forecast
    const result = classifyForecast(points, issuedAt, now);
    expect(result.points).toHaveLength(1);
  });
});
