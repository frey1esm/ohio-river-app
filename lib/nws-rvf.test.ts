import { describe, expect, it } from "vitest";
import { parseRvfCincinnati } from "./nws-rvf";

// A trimmed but structurally real excerpt of the live RVF bulletin
// (docs/river-reverse-engineering.md §11.2), captured 2026-09-09.
const REAL_BULLETIN = `
783
FGUS51 KTIR 081507
RVFTIR
River Flow and Velocity Forecasts
NWS Ohio River Forecast Center, Wilmington, OH
11:00AM EDT Tuesday, September 08, 2026

Note: All forecasts include expected precipitation through the first 48 hours.

All values are instantaneous model-simulated projections at 7am EST or 8am EDT.
Flows are units of kCFS.  Velocity units are mph.   * = HEC-RAS estimations

                               Sep 08       Sep 09       Sep 10       Sep 11
Forecast Point...            Flow  Vel    Flow  Vel    Flow  Vel    Flow  Vel

Ohio River...
  Meldahl Dam                58.6  2.0    50.4  1.9    44.8  1.8    37.8  1.7
  Cincinnati                 62.5  1.3    52.8  1.1    47.3  1.0    41.5  0.9
  Markland Dam               71.7  1.9    59.0  1.7    51.7  1.6    48.0  1.5

.BR TIR 20260908 Z DH12/DC202609081500/DUE/DQG/QRIFF/QFIFF/DRH+06/QRIFF/QFIFF
.B1 DRH+12/QRIFF/QFIFF/DRH+18/QRIFF/QFIFF
MELO1  58.6/2.0  / 50.4/1.9  / 44.8/1.8  / 37.8/1.7
CCNO1  62.5/1.3  / 52.8/1.1  / 47.3/1.0  / 41.5/0.9
MKLK2  71.7/1.9  / 59.0/1.7  / 51.7/1.6  / 48.0/1.5
.END
$$
`;

const issuedAt = new Date("2026-09-08T15:07:00Z");

describe("parseRvfCincinnati", () => {
  it("parses all four entries from the real live bulletin fixture", () => {
    const entries = parseRvfCincinnati(REAL_BULLETIN, issuedAt);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      time: new Date("2026-09-08T12:00:00Z"),
      flowKcfs: 62.5,
      velocityMph: 1.3,
    });
    expect(entries[3]).toEqual({
      time: new Date("2026-09-11T12:00:00Z"),
      flowKcfs: 41.5,
      velocityMph: 0.9,
    });
  });

  it("builds each timestamp at 12:00 UTC (7am EST == 8am EDT, no DST logic needed)", () => {
    const entries = parseRvfCincinnati(REAL_BULLETIN, issuedAt);
    for (const e of entries) {
      expect(e.time.getUTCHours()).toBe(12);
      expect(e.time.getUTCMinutes()).toBe(0);
    }
  });

  it("never hardcodes a fixed window length — reflects however many columns are actually present", () => {
    const threeColumnBulletin = REAL_BULLETIN.replace(
      /Sep 08       Sep 09       Sep 10       Sep 11/,
      "Sep 08       Sep 09       Sep 10",
    ).replace(/CCNO1  62.5\/1.3  \/ 52.8\/1.1  \/ 47.3\/1.0  \/ 41.5\/0.9/, "CCNO1  62.5/1.3  / 52.8/1.1  / 47.3/1.0");
    const entries = parseRvfCincinnati(threeColumnBulletin, issuedAt);
    expect(entries).toHaveLength(3);
  });

  it("returns an empty array when the CCNO1 line is missing entirely", () => {
    const withoutCincinnati = REAL_BULLETIN.split("\n")
      .filter((l) => !l.startsWith("CCNO1"))
      .join("\n");
    expect(parseRvfCincinnati(withoutCincinnati, issuedAt)).toEqual([]);
  });

  it("returns an empty array when the date header is missing", () => {
    const withoutHeader = REAL_BULLETIN.split("\n")
      .filter((l) => !/Sep 08\s+Sep 09/.test(l))
      .join("\n");
    expect(parseRvfCincinnati(withoutHeader, issuedAt)).toEqual([]);
  });

  it("returns an empty array for a completely malformed/unrelated text", () => {
    expect(parseRvfCincinnati("not a real bulletin at all", issuedAt)).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseRvfCincinnati("", issuedAt)).toEqual([]);
  });

  it("rolls a December-issued bulletin's later-month dates into the next year", () => {
    const decemberBulletin = REAL_BULLETIN.replace(
      /Sep 08       Sep 09       Sep 10       Sep 11/,
      "Dec 30       Dec 31       Jan 01       Jan 02",
    );
    const decemberIssue = new Date("2026-12-30T15:07:00Z");
    const entries = parseRvfCincinnati(decemberBulletin, decemberIssue);
    expect(entries[0].time.getUTCFullYear()).toBe(2026); // Dec 30
    expect(entries[2].time.getUTCFullYear()).toBe(2027); // Jan 01 rolls to next year
    expect(entries[2].time.getUTCMonth()).toBe(0); // January
  });

  it("truncates to the shorter of mismatched date/value column counts rather than crashing", () => {
    // Four dates but only three flow/vel pairs on the data line.
    const mismatched = REAL_BULLETIN.replace(
      /CCNO1  62.5\/1.3  \/ 52.8\/1.1  \/ 47.3\/1.0  \/ 41.5\/0.9/,
      "CCNO1  62.5/1.3  / 52.8/1.1  / 47.3/1.0",
    );
    const entries = parseRvfCincinnati(mismatched, issuedAt);
    expect(entries).toHaveLength(3);
  });
});
