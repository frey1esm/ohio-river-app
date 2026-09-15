import { describe, expect, it } from "vitest";
import { celsiusToFahrenheit, feetPerSecondToMph, FPS_TO_MPH } from "./units";

describe("unit conversions", () => {
  it("converts ft/s to mph using the verified 3600/5280 factor", () => {
    expect(FPS_TO_MPH).toBeCloseTo(3600 / 5280, 5);
    expect(feetPerSecondToMph(1)).toBeCloseTo(0.681818, 5);
    // Live-verified example from the investigation: 1.34 ft/s -> ~0.91 mph.
    expect(feetPerSecondToMph(1.34)).toBeCloseTo(0.9136, 3);
  });

  it("converts Celsius to Fahrenheit exactly, not approximately", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    // Live-verified example: 28.6 C ~= 83.48 F (matches the live 83.4F reading in the investigation).
    expect(celsiusToFahrenheit(28.6)).toBeCloseTo(83.48, 2);
  });
});
