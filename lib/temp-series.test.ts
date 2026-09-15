import { describe, expect, it } from "vitest";
import { gappedTempPoints } from "./temp-series";

const MIN = 60 * 1000;

function series(start: string, stepMin: number, temps: number[]) {
  const t0 = new Date(start).getTime();
  return temps.map((tempF, i) => ({ time: new Date(t0 + i * stepMin * MIN), tempF }));
}

describe("gappedTempPoints", () => {
  it("returns points unchanged when cadence is regular", () => {
    const history = series("2026-09-10T00:00:00Z", 15, [70, 70.2, 70.4, 70.6, 70.8]);
    const out = gappedTempPoints(history);
    expect(out).toHaveLength(5);
    expect(out.every((p) => p.y !== null)).toBe(true);
  });

  it("inserts a single null breakpoint across a long coverage gap", () => {
    const history = [
      ...series("2026-09-10T00:00:00Z", 15, [70, 70.2, 70.4]),
      // ~6 hours later — a real gap in the feed
      ...series("2026-09-10T06:15:00Z", 15, [68, 68.1]),
    ];
    const out = gappedTempPoints(history);
    const nulls = out.filter((p) => p.y === null);
    expect(nulls).toHaveLength(1);
    // The break sits between the last pre-gap and first post-gap reading.
    const nullX = nulls[0].x;
    expect(nullX).toBeGreaterThan(new Date("2026-09-10T00:30:00Z").getTime());
    expect(nullX).toBeLessThan(new Date("2026-09-10T06:15:00Z").getTime());
  });

  it("does not break a series that is merely sparse but evenly spaced", () => {
    const history = series("2026-09-10T00:00:00Z", 60, [70, 71, 72, 73]);
    const out = gappedTempPoints(history);
    expect(out.filter((p) => p.y === null)).toHaveLength(0);
  });

  it("handles a single point and an empty series", () => {
    expect(gappedTempPoints([])).toEqual([]);
    const one = series("2026-09-10T00:00:00Z", 15, [70]);
    expect(gappedTempPoints(one)).toEqual([{ x: one[0].time.getTime(), y: 70 }]);
  });
});
