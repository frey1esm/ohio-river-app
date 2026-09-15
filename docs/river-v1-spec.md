# Ohio River App — v1 Specification (Approved Decisions)

This document consolidates the owner-approved decisions from the investigation recorded in [`river-reverse-engineering.md`](./river-reverse-engineering.md) into a single reference for the v1 river-only rebuild. It was originally written as a specification of *decided behavior* with no implementation — **that implementation now exists** (`app/`, `lib/`, `components/`); see §8, Implementation Notes, for what was actually built and which routine details it settled.

**Status markers used throughout:**
- ✅ **Approved** — the owner has explicitly decided this.
- 🔶 **Proposed, not yet approved** — a specific detail (usually a numeric threshold) that has been suggested during investigation but never confirmed by the owner. These are called out individually; nothing in this document should be read as owner-approved unless marked ✅.
- 🛠 **Implemented** — a routine detail the owner authorized filling in without a separate approval cycle (build session, 2026-09-09). Distinct from ✅: the owner can revise these freely, they were never presented as a decision to approve.

Every feature below links back to its full evidence and reasoning in the reverse-engineering document, referenced as `§N`.

---

## 1. Scope: river-only

✅ **Approved.** The v1 app covers River Conditions only. The legacy Weather tab (current conditions, 6-station wind grid, 7-day OWM forecast, Windy radar embed) is excluded — it is a separate, future project (project brief; reverse-engineering `§1`, `§2`).

**Consequence, not itself a decision:** the legacy OpenWeatherMap dependency existed for two reasons — powering the Weather tab, and serving as the fallback source for water temperature (reverse-engineering `§2`). Decision 6 below removes the water-temperature fallback's use of OWM. 🛠 **Implemented:** the v1 build has no OpenWeatherMap dependency at all — no API key, no fetch, not in `package.json` — since nothing in the river-only app needs it once the Weather tab and the OWM-based temperature fallback are both gone.

---

## 2. Forecast window: five days of history, up to five days of available forecast

✅ **Approved.** Show five days of observed stage/flow history and up to five days of *available* NOAA forecast. Never extend, pad, or fabricate a forecast to fill a full five days if NOAA has issued less (reverse-engineering `§3`, `§4b`, `§8.2`).

- **Source:** NOAA NWPS, gauge CCNO1 — `GET /nwps/v1/gauges/CCNO1/stageflow/observed` and `.../stageflow/forecast`.
- **Units:** stage in feet, flow in kcfs — both confirmed directly from the live API's own `primaryUnits`/`secondaryUnits` fields (reverse-engineering `§8.1`), not assumed.
- **Display behavior:**
  - History: trim the observed feed to the most recent 5 days by `validTime`. NOAA's own default lookback is much longer (~29 days observed live, reverse-engineering `§8.1`), so the client must do this trimming — it is not something the API does on request.
  - Forecast: show only "remaining future predictions" — forecast points at or after the current time — up to a 5-day cap measured from now. If NOAA's forecast horizon is shorter than 5 days (confirmed live at ~4.9 days on the day checked, reverse-engineering `§8.2`), show only what exists. Do not interpolate, repeat the last value, or otherwise manufacture points to reach 5 days.
- **Missing/stale data:** if the observed fetch fails entirely, this is the existing fatal-error condition already in the legacy app (reverse-engineering `§1`, "Errors") — carried forward as existing behavior. The forecast has its own, separate freshness policy, decided below (this was previously unresolved).
- **Forecast freshness — ✅ approved (build-authorized defaults message):**
  - A forecast issued more than **24 hours** ago is flagged **"Outdated"** — but its remaining future points are still shown, with the warning, not hidden. This is explicitly separate from and does not use the §7 observed-data thresholds.
  - When no future forecast points remain at all (every point's time has already passed), show **"Forecast unavailable"** — distinct from, and overriding, the outdated/current label, since there's nothing to qualify.
  - If the forecast's issuance time is missing or unparseable, show **"Freshness unknown"** rather than treating an un-timestamped forecast as current.
- **Acceptance criteria:**
  - Given NOAA's forecast response spans fewer than 5 days, the UI shows exactly that many remaining days and no more.
  - Given NOAA's forecast response spans 5 or more days, the UI shows exactly 5 days from now, not more.
  - The observed history window is always computed from the response's own timestamps (last 5 days by `validTime`), never assumed to already be 5 days just because that's the common case.
  - Given a forecast issued 25 hours ago with remaining future points, those points are shown with an "Outdated" badge, not hidden.
  - Given a forecast where every point's time has already passed, the UI shows "Forecast unavailable," regardless of how old the issuance was.

---

## 3. Timestamp-based six-hour trends, computed from full-resolution data

✅ **Approved (general approach).** Stage and current-speed trend indicators are computed from **actual elapsed time between real observation timestamps**, not from a fixed count of array points — replacing the legacy `%16`-index downsampling that produced a "6h" label with no verified relationship to 6 actual hours (reverse-engineering `§3`, `§4a`, `§9`). Trend calculations use the **full-resolution valid observed series**; any downsampling or bucketing is reserved for chart rendering only and must never feed the trend calculation (reverse-engineering `§9`, architectural note).

- **Source:** the same full observed series already fetched for decision 2 (NOAA NWPS observed stage/flow), before any chart-oriented downsampling is applied.
- **Algorithm (reverse-engineering `§9`, steps 1–8):**
  1. Take the latest valid observed reading.
  2. Compute a target time 6 hours before it.
  3. Find the observed reading closest to that target time, at or before the latest reading.
  4. Accept it as the trend anchor only if it falls within a tolerance window around the target — **✅ approved at ±30 minutes** (build-authorized defaults message), twice the confirmed 15-minute native interval.
  5. If no reading falls within tolerance (insufficient history, or a data gap straddles the target), the trend is **unavailable** — do not substitute a more distant point and still call it "6h."
  6. Compute the actual elapsed time and value delta between the anchor and the latest reading.
  7. Label the trend with the **actual elapsed hours**, not a hardcoded "6h," unless the true elapsed time is close enough to 6 hours that a simplified "/6h" label is a deliberate presentation choice (not an unstated accuracy claim).
  8. Direction (rising/falling/steady) follows the existing sign/magnitude-comparison logic, unchanged.
- **Missing/insufficient data:** insufficient history or a gap that straddles the 6-hour target both produce an explicit "unavailable" trend state — never a silently-recomputed trend over a different, unlabeled time span. (This is a distinct concept from the §7 observation-staleness policy: it's about whether a *derived* trend can be computed at all from the available anchor points, not about whether the *underlying* observation is old. A perfectly fresh latest reading can still produce an "unavailable" trend if no anchor point exists near the 6-hour target.)
- **Acceptance criteria:**
  - Given a data gap that puts the nearest candidate reading outside the tolerance window on both sides of the target, the trend badge shows "unavailable," not a number.
  - Given fewer than ~6 hours of history available at all, the trend badge shows "unavailable," not a trend computed over whatever shorter span exists mislabeled as "6h."
  - The displayed elapsed-time label matches the actual timestamps used, not an assumed constant.
- 🛠 **Implemented:** the chart displays the actual elapsed hours (step 7's default), e.g. "−0.05 ft / 6.0h," rather than always simplifying to "/6h" — a routine presentation choice, not a separate policy decision, and easy to change if the owner prefers the simplified form.

---

## 4. NOAA-reported flood status and named thresholds

✅ **Approved.** Use NOAA's own reported observed flood category (`status.observed.floodCategory`) for the stage status label, and NOAA's four **named** thresholds (`action`, `minor`, `moderate`, `major`, from `flood.categories`) for the stage bar and reference labels. Remove the legacy positional-index lookup (`categories[0]/[1]/[2]`, which fails against the live API's named-object shape) and the hardcoded fallback thresholds (38/52/62 ft) entirely (reverse-engineering `§10`, `§4d`, `§8.3`).

- **Source:** NOAA NWPS gauge metadata — `GET /nwps/v1/gauges/CCNO1`, fields `status.observed.floodCategory` and `flood.categories.{action,minor,moderate,major}.stage`.
- **Units:** stage thresholds in feet (confirmed live: `stageUnits: "ft"`, reverse-engineering `§8.3`). Live values at the time checked were action 40 ft, minor 52 ft, moderate 56 ft, major 65 ft — fetched live each time, never hardcoded.
- **Display behavior:** the stage bar and any reference lines show all **four** named tiers, not the legacy's three (which had conflated minor/moderate into one "flood" tier). The status label uses NOAA's own category string directly rather than a client-side threshold comparison.
- **Freshness / conflict handling** (reverse-engineering `§10.1`, `§10.2`, `§13`):
  - **Missing:** if `status` or `status.observed` is absent from a response, show an explicit "status unavailable" state — never default to a normal-looking display.
  - **Unknown/unrecognized value:** `floodCategory` is typed as an open string with no enum guarantee (confirmed against the NWPS OpenAPI spec, reverse-engineering `§8.4`, `§10.2`) — an unrecognized value should be shown plainly (or as a generic "status: `<value>`"), not silently mapped to "Normal."
  - **Stale (✅ approved threshold, §7):** stale when `now − status.observed.validTime` exceeds **60 minutes**. A stale reading **stays visible**, shown with its own timestamp and a "Stale" label — it is not hidden and not the same as "unavailable." **It must never be presented as an unqualified, current-looking "Normal"** (or `no_flooding`) — a stale "all clear" carries real safety weight, which is why this rule is called out specifically rather than left to the general policy alone.
  - **Unknown freshness (✅ approved, §7):** if `status.observed.validTime` is missing or fails to parse, age cannot be computed — this is distinct from both "fresh" and "stale." Disclose that freshness is unknown; never default to treating an un-timestamped reading as current.
  - **Conflicting/asynchronous:** do not assume `status.observed`, `status.forecast`, and the raw stage/flow feeds update in lockstep. In two live checks they matched exactly, but nothing in NOAA's specification guarantees that — compute and display staleness for each independently.
- **Acceptance criteria:**
  - Given `flood.categories` returns any subset or superset of the four named tiers, the UI renders whichever are present by name — it never assumes a fixed count or order.
  - Given `status.observed` is missing, null, or absent, the UI shows an explicit unavailable state, never a default "Normal"/green appearance.
  - Given `status.observed.floodCategory` holds a string not in the UI's known set, the UI displays it rather than falling back silently.
  - Given `status.observed.validTime` is more than 60 minutes old, the UI shows the last valid category with a visible "Stale" label and its timestamp — never as an unqualified "Normal," and never simply hidden.
  - Given `status.observed.validTime` is missing or unparseable, the UI discloses unknown freshness rather than defaulting to a normal-looking display.

---

## 5. Mean river velocity (replacing the legacy "current speed" estimate)

✅ **Approved.** Replace the legacy fixed-area derivation (`flow ÷ 36,000 ft² × 0.681818`) — confirmed unsupported by both a live USGS measurement and the NWS Ohio River Forecast Center's own bulletin for this exact gauge (reverse-engineering `§4c`, `§11.2`) — with a directly-sourced USGS measurement (reverse-engineering `§11.5`).

- **Source:** USGS site **03255000** (the Ohio River mainstem gauge NOAA's own CCNO1 metadata links to, reverse-engineering `§11.1`), parameter **`72255`** ("Mean water velocity for discharge computation").
- **Units:** confirmed live as `ft/sec` directly from the API response (not assumed). Convert to mph for display using the verified factor `mph = ft/s × 0.681818` (the same conversion already used elsewhere in this investigation).
- **Coverage:** latest value plus available five-day history. A `period=P5D` request against this exact site/parameter was verified live to return cleanly (477 points, a clean 15-minute cadence, reverse-engineering `§11.5`).
- **Display behavior:**
  - Label: **"Mean river velocity"** — not "Current" and not "mid-channel." The legacy label was established to be inaccurate regardless of the area constant's correctness, since `flow ÷ area` is by definition a cross-sectional average, not a location-specific reading (reverse-engineering `§11.3`).
  - Shown with its source (USGS 03255000) and observation time.
  - Methodology note: this value should be described as *computed from a field sensor reading via a periodically-calibrated index-velocity rating*, not as a direct measurement across the entire channel cross-section at every instant (reverse-engineering `§11.1`, `§11.5`) — an accurate, if less simple, description of what USGS's index-velocity method produces.
  - **No velocity forecast in v1.** Stage and flow retain their existing NOAA forecast display (decision 2); current-speed shows observed/historical values only. The NWS Ohio RFC's "River Flow and Velocity Forecasts" bulletin (reverse-engineering `§11.2`) remains a documented option for a *future* forecast addition, explicitly out of v1 scope.
- **Missing/stale data (✅ approved threshold, §7):** stale when the observation is more than **60 minutes** old, computed from the reading's own timestamp, not fetch time. A stale reading **stays visible**, shown with its timestamp and a "Stale" label — not hidden. **"Unavailable"** is reserved for when no valid reading exists at all (fetch failure, or every candidate filtered out) — it is not interchangeable with "stale." If the timestamp is missing or unparseable, freshness is unknown and must be disclosed as such. **Do not substitute the legacy fixed-area estimate** as a fallback under any of these conditions — that estimate is confirmed unsupported (decision rationale above), not merely deprioritized.
- **Acceptance criteria:**
  - Given the USGS `72255` feed's latest reading is more than 60 minutes old, the UI shows that value with its timestamp and a "Stale" label — it does not hide the value and does not fall back to computing a fixed-area estimate from NOAA flow data.
  - Given no valid `72255` reading exists at all, the UI shows "Unavailable" — distinct from the stale case above.
  - The displayed value is always labeled "Mean river velocity," sourced and timestamped, never presented as a forecast.
  - The five-day history series comes from the same USGS parameter, not reconstructed from NOAA flow data.

---

## 6. Water temperature — Licking River (corrected decision)

✅ **Approved, 2026-09-09.** Use **USGS 03254520 (Licking River), parameter `00010`**. This corrects an earlier in-session consideration of USGS 03277200 (Ohio River at Markland Dam) — a genuine Ohio River mainstem reading that was evaluated as a serious alternative (reverse-engineering `§12.3`) but was not the owner's final choice. Markland is not part of the v1 decision; it remains documented in the reverse-engineering doc as the alternative that was considered.

**Rationale, per owner:** the Licking River site was chosen for its **proximity to Cincinnati** — it sits close to the gauge, versus Markland Dam's ~33 straight-line miles downstream (reverse-engineering `§12.3`). This is a deliberate trade of geographic closeness against river identity (a tributary reading close by, rather than a genuine but distant mainstem reading) — which is exactly why the explicit tributary disclosure below is a requirement, not an optional nicety.

- **Source:** USGS site **03254520** ("Licking River at Hwy 536 near Alexandria, KY"), parameter **`00010`** ("Temperature, water," confirmed live as `deg C`) — not the site's `00011` (°F) parameter, which the legacy code used and which has only existed at this site since 2026-05-11, a much shorter record than `00010`'s ~19 years (reverse-engineering `§12.2`).
- **Units:** source data is °C; convert to °F for display using the exact conversion `°F = °C × 9/5 + 32` (not an approximation).
- **Display behavior:**
  - Label: **"Water temperature · Licking River"**, shown with observation time.
  - The display must make clear, visibly, that this is a **nearby tributary reading, not an Ohio River mainstem measurement** — the same distinction already established throughout the reverse-engineering investigation (`§2`, `§3`, `§12`). This is a stronger requirement than the legacy code's small italic source line, which named the site but didn't characterize it as a different waterway.
- **Missing/stale data (✅ approved threshold, §7):** stale when the observation is more than **2 hours** old — a longer threshold than stage/flood-status/velocity's 60 minutes, reflecting that water temperature changes slowly and this feed's own live-checked lag (60–90 minutes after timestamp, reverse-engineering `§12.2`) already consumes a large share of a 60-minute window. A stale reading **stays visible**, shown with its timestamp and a "Stale" label — not hidden. **"Unavailable"** is reserved for when no valid reading exists at all — **no automatic substitution** from USGS 03277200 (Markland) and **no reintroduction of the legacy air-temperature-derived fallback formula** (`0.95 × air_c + 1.0`, confirmed unsourced, reverse-engineering `§3`, `§12.4`) under any of these conditions. If the timestamp is missing or unparseable, freshness is unknown and must be disclosed as such.
- **Acceptance criteria:**
  - Given the USGS `00010` feed's latest reading at 03254520 is more than 2 hours old, the UI shows that value with its timestamp and a "Stale" label — it does not hide the value and does not fall back to Markland or an air-temperature estimate.
  - Given no valid `00010` reading exists at all, the UI shows "Unavailable" — distinct from the stale case above.
  - The displayed value is always labeled "Water temperature · Licking River" with its tributary disclosure visible, never presented as an Ohio River mainstem reading.
  - Unit conversion is always °C → °F via the exact formula above, applied to the raw `00010` value — the app never reads a Fahrenheit-native parameter for this feature.

---

## 7. Freshness and staleness policy (approved for v1)

✅ **Approved, 2026-09-09.** This is the cross-feature policy referenced by decisions 4, 5, and 6 above. It reconciles earlier wording elsewhere in this specification and in the reverse-engineering document that described "stale" and "Unavailable" as though they were the same outcome — they are not.

**Scope:** governs the **observed** data in decisions 4 (flood status), 5 (mean river velocity), and 6 (water temperature), and the observed portion of decision 2 (stage **and flow** — flow gets the same rule as stage, applied to the most recent observed row with a valid flow value, since a point's flow can be missing while its stage is still valid). **It does not apply to forecasts** — decision 2 above has its own, separate, now-approved forecast-freshness policy (Outdated/Unavailable/Freshness unknown), not this one.

**Thresholds:**
- Stage, observed flow, observed flood status, and mean river velocity: **stale when the observation is more than 60 minutes old.**
- Water temperature: **stale when the observation is more than 2 hours old.**

**These are product settings, not agency standards.** Neither NOAA nor USGS states a data-quality or update-guarantee number anywhere in their documentation (reverse-engineering `§8.4`, `§12.2`) — these thresholds were chosen for this app, informed by but not dictated by the live lag behavior observed during the investigation.

**Age is computed from the observation's own timestamp** (NOAA's `validTime`, or USGS's `dateTime`) — **never from fetch time.**

**Four distinct states:**
1. **Fresh** — a valid reading exists, within threshold.
2. **Stale** — a valid reading exists, past threshold. **The last valid value stays visible**, with its own timestamp and a clear **"Stale"** label. Never hidden; never treated as equivalent to "Unavailable."
3. **Unavailable** — no valid reading exists at all (fetch failed, or every candidate was filtered out as missing/sentinel). The only state that withholds the value entirely.
4. **Unknown freshness** — the observation timestamp is missing or fails to parse, so age cannot be computed. Distinct from "fresh": disclose unknown freshness explicitly; never default to treating an un-timestamped reading as current.

**Flood status carries one additional rule, given its safety weight:** never present a stale flood-status reading as an unqualified, current-looking "Normal" (or `no_flooding`). If its timestamp can't be established, disclose unknown freshness rather than defaulting to a normal-looking display.

**Amendment, 2026-09-14 — the "Stale" label itself is removed from the UI.** The classification above (thresholds, four states, computing age from observation time) is unchanged, and a stale reading still stays visible with its own timestamp — only the separate visible **"Stale" text badge** is gone, superseding the "clear 'Stale' label" wording above. Rationale (owner decision): every reading that can be "stale" already displays its own observation timestamp right next to it, so the badge was restating what the timestamp already communicates. This *does* relax the flood-status safety rule as originally written — a stale "No Flooding" now renders with no distinct stale qualifier beyond its timestamp, whereas before it always carried a visible "Stale" badge specifically because an unqualified-looking "Normal" was judged too risky to show. The **"Freshness unknown"** badge is unaffected and still shown — dropping the timestamp itself (not just aging past a threshold) is a different, still-flagged condition.

---

## 8. Implementation Notes (v1 build, 2026-09-09)

The app was implemented against every decision above (`app/`, `lib/`, `components/` in this repository). This section records the routine details the build had to settle that weren't themselves policy decisions — marked 🛠 throughout — plus what was verified.

**Architecture:**
- **Data layer** (`lib/noaa.ts`, `lib/usgs.ts`, `lib/river-data.ts`): each of the three sources (NOAA stage/flow/flood-status, USGS velocity, USGS temperature) is fetched independently with its own `AbortController`-based **8-second timeout** and wrapped in a `DataResult<T>` (`{ ok: true, data } | { ok: false, error }`). All three fetch **concurrently** via `Promise.all`/`Promise.allSettled` — one source failing never blocks or blanks the others, matching the "a failed source must not blank the entire page" requirement.
- **Server-side caching** (`lib/cache.ts`): a per-source in-memory TTL cache, not a single shared TTL, chosen per source's own cadence: observed 3 min, forecast 15 min, gauge metadata 5 min, velocity 5 min, temperature 10 min. 🛠 These are starting defaults, not the product of a fresh investigation round — reasonable given each feed's confirmed native interval (docs/river-reverse-engineering.md §8, §11.5, §12.2), easy to retune.
- **Client refresh**: the dashboard polls `/api/river` every **5 minutes** and on a manual "Refresh now" button, updating React state in place — no `location.reload()`, unlike the legacy app's full-page reload every 10 minutes. A failed poll silently keeps the last known-good data on screen.
- **"Live" indicator**: 🛠 now reflects actual per-source fetch success — "Live" (all three `ok`), "Partial" (some), "Offline" (none) — replacing the legacy's single hardcoded "Live" state (a previously-flagged defect, reverse-engineering §4, §6). Note this reflects *fetch* success, not reading *freshness* — a source can be "Live" (successfully fetched) while its latest reading is individually marked "Stale"; those are deliberately separate signals, one about connectivity and one about data age.
- **Flow's own freshness**: implementing §7's "stale after 60 minutes" rule surfaced that flow needed the same per-reading freshness treatment as stage — a point's flow can be missing while its stage is valid (docs/river-reverse-engineering.md §4e), so the latest *valid* flow reading isn't always the latest observed row. `lib/noaa.ts`'s `latestValidFlow()` finds and classifies it independently, mirroring how flood status is already handled.

**Styling:** the legacy dark palette, card language, and hero/stat-card structure (docs/river-reverse-engineering.md §1) were ported to fix, not preserve, the two mobile defects the investigation identified: the stat grid now reflows (3 columns → 2 → 1 as width narrows) instead of a rigid 3-column grid with no breakpoint, and the chart height is `clamp()`-based instead of a flat 480px. 🛠 The legacy's animated wave-background SVG flourish and the six-station wind-compass styling were not ported — the former is decorative and unrelated to the mobile-crowding/empty-space defects being fixed, and the latter belonged entirely to the excluded Weather tab.

**Verified:**
- `npm run build` (production build) and `npm run lint` both pass clean.
- 47 unit tests (`npm test`, Vitest) covering the pure transformations: NOAA/USGS sentinel-value filtering, the six-hour trend algorithm (exact match, tolerance boundary, ties, insufficient history), freshness classification at both thresholds and their boundaries, forecast classification (outdated/unknown/no-remaining-points/5-day cap), and the unit conversions.
- A live browser check (Playwright, headless Chromium) at 390px and 1200px widths against the running app with real network calls to NOAA and USGS: real data rendered (no stuck-loading or blank state), zero console errors, zero failed/non-2xx requests, no overlapping cards, no leftover "Weather" text anywhere, and a responsive chart height (240px mobile vs. 380px desktop, confirmed via the rendered DOM, not just the CSS rule). A second check, run later in the same session, incidentally caught genuine live staleness (the NOAA feed's real transmission lag exceeded 60 minutes) and confirmed the app displayed "Stale" badges with timestamps rather than hiding the values — an end-to-end confirmation of §7's policy against real conditions, not just the unit tests' synthetic cases.
- **Not verified**: no automated visual-regression or component-level UI test exists (the 47 tests are all pure-function unit tests over `lib/`, not React component rendering tests) — the mobile/desktop layout check above was a one-time manual/scripted visual inspection, not a repeatable test in the suite. A prolonged real outage of any single source, or a genuinely malformed API response shape, was not exercised — only the documented sentinel/missing-value conventions were.

---

## Unresolved items carried into implementation planning

Resolved by the build-authorized defaults message (2026-09-09) and no longer open: forecast freshness (§2, now Outdated/Unavailable/Freshness unknown), the ±30-minute trend tolerance (§3, now ✅ approved), the OpenWeatherMap dependency (§1, now 🛠 confirmed absent from the build entirely), and the observed-data caching/TTL strategy (reverse-engineering §7, now 🛠 implemented — see §8 above).

These remain explicitly **not** decided and should not be treated as approved:

1. Non-blocking items already tracked in reverse-engineering `§7`: timestamp timezone display (currently the visitor's local timezone) and WordPress-iframe vs. standalone hosting (the app is currently built and verified as standalone only — no iframe integration was implemented or tested).
2. The specific per-source cache TTLs and 8-second fetch timeout (§8 above) are 🛠 routine implementation defaults, not reviewed against any particular load or latency target — worth revisiting if real-world usage shows them too aggressive or too lax.
3. No automated UI/component-level test coverage exists yet (§8, "Not verified") — only pure-function unit tests and a one-time manual visual check.

---

## Summary

All four foundational data-source decisions for v1 are now made and **implemented**: a five-day-history/up-to-five-day-forecast window sourced from NOAA (never fabricated, with its own now-approved forecast-freshness policy), NOAA's own flood-status field and named four-tier thresholds (replacing a positional lookup confirmed broken against the live API), USGS's directly-measured mean river velocity (replacing an unsupported fixed-area estimate), and USGS's Licking River temperature reading — chosen for its proximity to Cincinnati, with an explicit tributary disclosure, over the more distant Markland Dam mainstem alternative that was evaluated and not chosen. The cross-feature freshness policy (§7) — 60 minutes for stage/flow/flood-status/velocity, 2 hours for temperature — and the timestamp-based six-hour trend (§3, ±30-minute tolerance) are both approved and implemented, with a four-state fresh/stale/unavailable/unknown-freshness model that explicitly corrects earlier wording conflating "stale" with "unavailable." The build was verified via production build, lint, 47 unit tests, and a live browser check at mobile and desktop widths — including one that incidentally caught and correctly displayed a genuine live staleness event.

**The single most important remaining item, if any:** none of the foundational decisions remain open. What's left is lower-stakes and implementation-tunable — the exact cache TTLs and fetch timeout (§8), the visitor-local-timezone display choice, and whether component/UI-level automated tests should be added alongside the existing pure-function unit tests. None of these block using or extending the v1 app as built.
