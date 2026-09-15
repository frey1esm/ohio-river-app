import { describe, expect, it } from "vitest";
import { computeYRange } from "./chart-scale";

describe("computeYRange", () => {
  it("scales tightly to real data, never defaulting to a hardcoded ceiling like 30", () => {
    // Stage hovering around 26-29 ft, well below any flood threshold.
    const range = computeYRange([26.8, 27.5, 28.9, 27.0]);
    expect(range.max).toBeLessThan(32);
    expect(range.min).toBeGreaterThan(20);
    expect(range.max).toBeGreaterThanOrEqual(28.9);
    expect(range.min).toBeLessThanOrEqual(26.8);
  });

  it("expands to include an extraMax (flood threshold) only when provided", () => {
    const tight = computeYRange([26.8, 27.5, 28.9]);
    const expanded = computeYRange([26.8, 27.5, 28.9], 65);
    expect(expanded.max).toBeGreaterThanOrEqual(65);
    expect(expanded.max).toBeGreaterThan(tight.max);
  });

  it("ignores a lower extraMax that the data already exceeds", () => {
    const withoutExtra = computeYRange([26.8, 27.5, 28.9]);
    const withLowExtra = computeYRange([26.8, 27.5, 28.9], 27);
    expect(withLowExtra.max).toBe(withoutExtra.max);
  });

  it("produces a visible band for a perfectly flat series instead of a zero-height axis", () => {
    const range = computeYRange([50, 50, 50]);
    expect(range.max).toBeGreaterThan(range.min);
  });

  it("filters out non-finite values before computing the range", () => {
    const range = computeYRange([26.8, NaN, 28.9, Infinity, -Infinity]);
    expect(range.max).toBeGreaterThanOrEqual(28.9);
    expect(Number.isFinite(range.min)).toBe(true);
    expect(Number.isFinite(range.max)).toBe(true);
  });

  it("falls back to a default range for an empty input", () => {
    expect(computeYRange([])).toEqual({ min: 0, max: 1 });
  });

  it("rounds bounds outward to nice tick values, not raw padded decimals", () => {
    const range = computeYRange([26.83, 28.91]);
    // Raw padding alone would give ugly bounds like 26.5804/29.1596; the
    // nice-step rounding should land on clean 0.5-increment boundaries instead.
    expect(range).toEqual({ min: 26.5, max: 29.5 });
    expect(range.min).toBeLessThanOrEqual(26.83);
    expect(range.max).toBeGreaterThanOrEqual(28.91);
  });
});
