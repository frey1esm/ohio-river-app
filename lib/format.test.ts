import { beforeAll, describe, expect, it } from "vitest";
import { formatObservedTime, formatObservedTimeShort } from "./format";

beforeAll(() => {
  // Pinned so the formatted output (and therefore the assertions below) is
  // independent of whatever timezone the machine running the tests is in.
  process.env.TZ = "America/New_York";
});

describe("formatObservedTime", () => {
  it("returns the unknown-time fallback for null", () => {
    expect(formatObservedTime(null)).toBe("unknown time");
  });

  it("joins date and time with a fixed ', ' separator, not an engine-chosen one", () => {
    // Date and time are formatted via two separate toLocaleString calls
    // joined by a literal we control (see lib/format.ts) specifically
    // because a single combined call lets the engine's own ICU/CLDR data
    // pick the joiner — Node and Safari picked different ones for the same
    // options here ("Sep 14, 9:00 PM EDT" vs "Sep 14 at 9:00 PM EDT"),
    // which is a server/client hydration mismatch. This locks in the
    // engine-independent shape.
    const result = formatObservedTime(new Date("2026-09-14T20:00:00.000Z"));
    expect(result).toBe("Sep 14, 4:00 PM EDT");
    expect(result).not.toContain(" at ");
  });
});

describe("formatObservedTimeShort", () => {
  it("returns the unknown fallback for null", () => {
    expect(formatObservedTimeShort(null)).toBe("unknown");
  });

  it("includes minutes when not exactly on the hour", () => {
    const result = formatObservedTimeShort(new Date("2026-09-14T20:15:00.000Z"));
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}:15 PM EDT$/);
  });

  it("omits minutes when exactly on the hour", () => {
    const result = formatObservedTimeShort(new Date("2026-09-14T20:00:00.000Z"));
    expect(result).toMatch(/^[A-Z][a-z]{2} 4 PM EDT$/);
    expect(result).not.toContain(":00");
  });
});
