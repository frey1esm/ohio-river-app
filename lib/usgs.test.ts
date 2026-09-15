import { describe, expect, it } from "vitest";
import { parseUsgsSeries, type UsgsResponse } from "./usgs";

function wrap(values: { value: string; dateTime: string }[]): UsgsResponse {
  return { value: { timeSeries: [{ values: [{ value: values.map((v) => ({ ...v, qualifiers: ["P"] })) }] }] } };
}

describe("parseUsgsSeries (USGS sentinel/missing-data handling)", () => {
  it("parses normal numeric values", () => {
    const result = parseUsgsSeries(
      wrap([{ value: "1.34", dateTime: "2026-09-08T20:00:00.000-04:00" }]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeCloseTo(1.34, 5);
  });

  it("drops the historical USGS blank-string sentinel", () => {
    const result = parseUsgsSeries(wrap([{ value: "", dateTime: "2026-09-08T20:00:00.000-04:00" }]));
    expect(result).toHaveLength(0);
  });

  it("drops the historical USGS -999999 sentinel", () => {
    const result = parseUsgsSeries(
      wrap([{ value: "-999999", dateTime: "2026-09-08T20:00:00.000-04:00" }]),
    );
    expect(result).toHaveLength(0);
  });

  it("drops a non-numeric value defensively", () => {
    const result = parseUsgsSeries(wrap([{ value: "NaN-ish", dateTime: "2026-09-08T20:00:00.000-04:00" }]));
    expect(result).toHaveLength(0);
  });

  it("drops a value with an unparseable dateTime", () => {
    const result = parseUsgsSeries(wrap([{ value: "1.0", dateTime: "not-a-date" }]));
    expect(result).toHaveLength(0);
  });

  it("sorts ascending by time even if the source is out of order", () => {
    const result = parseUsgsSeries(
      wrap([
        { value: "2.0", dateTime: "2026-09-08T20:15:00.000-04:00" },
        { value: "1.0", dateTime: "2026-09-08T20:00:00.000-04:00" },
      ]),
    );
    expect(result[0].value).toBe(1.0);
    expect(result[1].value).toBe(2.0);
  });

  it("returns an empty array when the response shape is missing expected nesting", () => {
    expect(parseUsgsSeries({})).toEqual([]);
  });
});
