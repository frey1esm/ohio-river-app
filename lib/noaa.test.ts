import { describe, expect, it } from "vitest";
import { latestValidFlow, parsePoint, parsePoints, type NwpsDatum } from "./noaa";
import type { StageFlowPoint } from "./types";

describe("parsePoint (NOAA sentinel/missing-data handling)", () => {
  it("parses a normal valid point", () => {
    const result = parsePoint({ validTime: "2026-09-08T20:00:00Z", primary: 26.75, secondary: 57.3 });
    expect(result).toEqual({ time: new Date("2026-09-08T20:00:00Z"), stage: 26.75, flow: 57.3 });
  });

  it("drops a point whose primary (stage) is the NOAA sentinel value", () => {
    const result = parsePoint({ validTime: "2026-09-08T20:00:00Z", primary: -9999, secondary: 57.3 });
    expect(result).toBeNull();
  });

  it("drops a point whose primary is exactly at the sentinel boundary (-9000)", () => {
    const result = parsePoint({ validTime: "2026-09-08T20:00:00Z", primary: -9000, secondary: 57.3 });
    expect(result).toBeNull();
  });

  it("keeps a point with primary just above the sentinel boundary", () => {
    const result = parsePoint({ validTime: "2026-09-08T20:00:00Z", primary: -8999, secondary: 57.3 });
    expect(result).not.toBeNull();
    expect(result?.stage).toBe(-8999);
  });

  it("drops a point whose primary is null", () => {
    const result = parsePoint({ validTime: "2026-09-08T20:00:00Z", primary: null, secondary: 57.3 });
    expect(result).toBeNull();
  });

  it("keeps the point but nulls out flow when secondary is the sentinel value", () => {
    const result = parsePoint({ validTime: "2026-09-08T20:00:00Z", primary: 26.75, secondary: -9999 });
    expect(result).toEqual({ time: new Date("2026-09-08T20:00:00Z"), stage: 26.75, flow: null });
  });

  it("keeps the point but nulls out flow when secondary is null", () => {
    const result = parsePoint({ validTime: "2026-09-08T20:00:00Z", primary: 26.75, secondary: null });
    expect(result?.flow).toBeNull();
    expect(result?.stage).toBe(26.75);
  });
});

describe("parsePoints", () => {
  const raw: NwpsDatum[] = [
    { validTime: "2026-09-08T20:30:00Z", primary: 27.0, secondary: 60 },
    { validTime: "2026-09-08T20:00:00Z", primary: 26.75, secondary: 57.3 }, // out of order
    { validTime: "2026-09-08T20:15:00Z", primary: -9999, secondary: 58 }, // sentinel, dropped
  ];

  it("filters sentinels and sorts ascending by time", () => {
    const result = parsePoints(raw);
    expect(result).toHaveLength(2);
    expect(result[0].time.toISOString()).toBe("2026-09-08T20:00:00.000Z");
    expect(result[1].time.toISOString()).toBe("2026-09-08T20:30:00.000Z");
  });

  it("returns an empty array for undefined input", () => {
    expect(parsePoints(undefined)).toEqual([]);
  });

  it("returns an empty array when every point is sentinel/missing", () => {
    const allInvalid: NwpsDatum[] = [
      { validTime: "2026-09-08T20:00:00Z", primary: -9999, secondary: null },
      { validTime: "2026-09-08T20:15:00Z", primary: null, secondary: null },
    ];
    expect(parsePoints(allInvalid)).toEqual([]);
  });
});

describe("latestValidFlow (flow gets its own 60-minute freshness rule, docs/river-v1-spec.md §7)", () => {
  const now = new Date("2026-09-08T21:00:00Z");

  it("classifies the last point's flow as fresh when recent", () => {
    const observed: StageFlowPoint[] = [
      { time: new Date("2026-09-08T20:45:00Z"), stage: 26.7, flow: 57 },
    ];
    const result = latestValidFlow(observed, now);
    expect(result?.freshness).toBe("fresh");
    expect(result?.value).toBe(57);
  });

  it("skips backward past a point whose flow is null to find the latest valid one", () => {
    const observed: StageFlowPoint[] = [
      { time: new Date("2026-09-08T20:30:00Z"), stage: 26.7, flow: 57 },
      // Most recent point has valid stage but missing/sentinel-filtered flow.
      { time: new Date("2026-09-08T20:45:00Z"), stage: 26.75, flow: null },
    ];
    const result = latestValidFlow(observed, now);
    // Must report the 20:30 flow reading, not treat the series as flow-less.
    expect(result?.value).toBe(57);
    expect(result?.observedAt).toEqual(new Date("2026-09-08T20:30:00Z"));
  });

  it("reports the flow reading as stale using the same 60-minute threshold as stage", () => {
    const observed: StageFlowPoint[] = [
      { time: new Date("2026-09-08T19:00:00Z"), stage: 26.7, flow: 57 }, // 2h old
    ];
    const result = latestValidFlow(observed, now);
    expect(result?.freshness).toBe("stale");
  });

  it("returns null when no point in the series has a valid flow", () => {
    const observed: StageFlowPoint[] = [
      { time: new Date("2026-09-08T20:45:00Z"), stage: 26.7, flow: null },
    ];
    expect(latestValidFlow(observed, now)).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(latestValidFlow([], now)).toBeNull();
  });
});
