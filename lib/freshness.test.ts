import { describe, expect, it } from "vitest";
import { classifyFreshness, FRESHNESS_THRESHOLDS_MS } from "./freshness";

describe("classifyFreshness", () => {
  const now = new Date("2026-09-08T20:00:00Z");

  it("is fresh exactly at the threshold boundary", () => {
    const observedAt = new Date(now.getTime() - FRESHNESS_THRESHOLDS_MS.observedDefault);
    const result = classifyFreshness({ value: 26.5, observedAt }, FRESHNESS_THRESHOLDS_MS.observedDefault, now);
    expect(result.freshness).toBe("fresh");
  });

  it("is stale just past the threshold", () => {
    const observedAt = new Date(now.getTime() - FRESHNESS_THRESHOLDS_MS.observedDefault - 1000);
    const result = classifyFreshness({ value: 26.5, observedAt }, FRESHNESS_THRESHOLDS_MS.observedDefault, now);
    expect(result.freshness).toBe("stale");
    // Stale values keep their value and timestamp, they are never dropped.
    expect(result.value).toBe(26.5);
    expect(result.observedAt).toEqual(observedAt);
  });

  it("is fresh well within threshold", () => {
    const observedAt = new Date(now.getTime() - 5 * 60 * 1000);
    const result = classifyFreshness({ value: 1.3, observedAt }, FRESHNESS_THRESHOLDS_MS.observedDefault, now);
    expect(result.freshness).toBe("fresh");
  });

  it("uses the longer temperature threshold when specified", () => {
    const observedAt = new Date(now.getTime() - 90 * 60 * 1000); // 90 min old
    const stageResult = classifyFreshness({ value: 70, observedAt }, FRESHNESS_THRESHOLDS_MS.observedDefault, now);
    const tempResult = classifyFreshness({ value: 70, observedAt }, FRESHNESS_THRESHOLDS_MS.temperature, now);
    expect(stageResult.freshness).toBe("stale"); // 90 min > 60 min threshold
    expect(tempResult.freshness).toBe("fresh"); // 90 min < 120 min threshold
  });

  it("is unknown freshness when the timestamp is null", () => {
    const result = classifyFreshness({ value: 26.5, observedAt: null }, FRESHNESS_THRESHOLDS_MS.observedDefault, now);
    expect(result.freshness).toBe("unknown");
    // The value itself is still carried through, just not labeled fresh.
    expect(result.value).toBe(26.5);
  });

  it("is unknown freshness when the timestamp fails to parse (NaN date)", () => {
    const invalidDate = new Date("not-a-real-date");
    const result = classifyFreshness(
      { value: 26.5, observedAt: invalidDate },
      FRESHNESS_THRESHOLDS_MS.observedDefault,
      now,
    );
    expect(result.freshness).toBe("unknown");
    expect(result.observedAt).toBeNull();
  });

  it("never reports unknown freshness as fresh", () => {
    const result = classifyFreshness({ value: 0, observedAt: null }, FRESHNESS_THRESHOLDS_MS.observedDefault, now);
    expect(result.freshness).not.toBe("fresh");
  });
});
