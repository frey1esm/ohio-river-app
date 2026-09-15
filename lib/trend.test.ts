import { describe, expect, it } from "vitest";
import { computeSixHourTrend, TrendPoint } from "./trend";

const t = (iso: string): Date => new Date(iso);

function series(...entries: [string, number][]): TrendPoint[] {
  return entries.map(([time, value]) => ({ time: t(time), value }));
}

describe("computeSixHourTrend", () => {
  it("computes a rising trend when a reading exists exactly 6h before the latest", () => {
    const s = series(
      ["2026-09-08T14:00:00Z", 26.0],
      ["2026-09-08T20:00:00Z", 26.5],
    );
    const result = computeSixHourTrend(s, 0.03);
    expect(result.direction).toBe("rising");
    expect(result.deltaPerSixHours).toBeCloseTo(0.5, 5);
    expect(result.elapsedHours).toBeCloseTo(6, 5);
  });

  it("computes a falling trend", () => {
    const s = series(
      ["2026-09-08T14:00:00Z", 26.5],
      ["2026-09-08T20:00:00Z", 26.0],
    );
    const result = computeSixHourTrend(s, 0.03);
    expect(result.direction).toBe("falling");
    expect(result.deltaPerSixHours).toBeCloseTo(-0.5, 5);
  });

  it("reports steady when the delta is within the epsilon dead-band", () => {
    const s = series(
      ["2026-09-08T14:00:00Z", 26.0],
      ["2026-09-08T20:00:00Z", 26.02],
    );
    const result = computeSixHourTrend(s, 0.03);
    expect(result.direction).toBe("steady");
  });

  it("accepts an anchor within the +/-30 minute tolerance, not just an exact match", () => {
    // Target is 14:00Z; anchor at 14:25Z is 25 minutes off, within the 30-minute tolerance.
    const s = series(
      ["2026-09-08T14:25:00Z", 26.0],
      ["2026-09-08T20:00:00Z", 26.4],
    );
    const result = computeSixHourTrend(s, 0.03);
    expect(result.direction).toBe("rising");
    expect(result.elapsedHours).toBeCloseTo(5.5833, 3);
  });

  it("rejects an anchor just outside the +/-30 minute tolerance", () => {
    // Target is 14:00Z; only candidate is 31 minutes off.
    const s = series(
      ["2026-09-08T14:31:00Z", 26.0],
      ["2026-09-08T20:00:00Z", 26.4],
    );
    const result = computeSixHourTrend(s, 0.03);
    expect(result.direction).toBe("unavailable");
    expect(result.deltaPerSixHours).toBeNull();
  });

  it("is unavailable when a gap straddles the target on both sides beyond tolerance", () => {
    const s = series(
      ["2026-09-08T13:00:00Z", 25.0], // 1h before target, outside tolerance
      ["2026-09-08T15:00:00Z", 25.2], // 1h after target, outside tolerance
      ["2026-09-08T20:00:00Z", 26.4], // latest; target = 14:00Z
    );
    const result = computeSixHourTrend(s, 0.03);
    expect(result.direction).toBe("unavailable");
  });

  it("is unavailable with insufficient history (single point)", () => {
    const s = series(["2026-09-08T20:00:00Z", 26.4]);
    const result = computeSixHourTrend(s, 0.03);
    expect(result.direction).toBe("unavailable");
    expect(result.elapsedHours).toBeNull();
  });

  it("is unavailable with an empty series", () => {
    const result = computeSixHourTrend([], 0.03);
    expect(result.direction).toBe("unavailable");
  });

  it("picks the chronologically earlier candidate on an exact tie", () => {
    // Target 14:00Z; two candidates equidistant (10 min before/after).
    const s = series(
      ["2026-09-08T13:50:00Z", 25.0],
      ["2026-09-08T14:10:00Z", 25.5],
      ["2026-09-08T20:00:00Z", 26.4],
    );
    const result = computeSixHourTrend(s, 0.03);
    // Earlier candidate (13:50) -> delta = 26.4 - 25.0 = 1.4
    expect(result.deltaPerSixHours).toBeCloseTo(1.4, 5);
  });
});
