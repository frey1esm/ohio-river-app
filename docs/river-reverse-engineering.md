# Ohio River Page — Reverse Engineering Notes

Source inspected: `ohio-river-app-old/river.php` (2,813 lines, read in full, not executed). All line numbers below refer to that file. This document was originally an evidence-based inspection only, covering investigation and decisions — no rebuild code was written as part of it. **That has since changed: the river-only Next.js app was implemented** (`app/`, `lib/`, `components/`) against the decisions recorded here and in `docs/river-v1-spec.md` — see the 2026-09-09 "Implementation" update below and the spec's Implementation Notes for what was actually built.

A note on scope: the legacy file is a single page with two tabs, **River Conditions** and **Weather**, sharing one PHP request. Per the project brief, the rebuild is river-only; every section below calls out where the two tabs are coupled so those seams are visible before the split.

**Update, 2026-09-08:** the forecast-window question raised in the original §7 is now decided: **show five days of history and up to five days of available NOAA forecast; never extend or fabricate a shorter forecast.** This update also adds live verification of the NOAA CCNO1 observed/forecast endpoints and the NWPS API's own OpenAPI specification (§8), and a proposed timestamp-based six-hour trend calculation (§9). Current-speed and water-temperature validity were **explicitly unresolved** in this pass.

**Update, 2026-09-09:** the flood-status/threshold decision is now made — see §10. Current-speed's validity has been investigated against live USGS and NWS sources (§11): the legacy 36,000 ft² constant and its "calibrated to NWS bulletin" claim are **not supported** by either source, and a v1 scope is now **approved** — USGS `72255` (mean river velocity) for latest value + five-day history, no forecast, no fixed-area fallback (§11.5). Water-temperature has now also been investigated (§12) and **decided**: USGS 03254520 (Licking River), parameter `00010` (°C, converted to °F for display), explicitly labeled as a tributary reading — not USGS 03277200 (Markland Dam), which was evaluated as a genuine mainstem alternative but not chosen for v1 (§12.5). The air-temperature fallback is not retained. All four foundational data-source decisions for the v1 rebuild are now consolidated in `docs/river-v1-spec.md`.

**Update, 2026-09-09 (implementation):** the river-only Next.js app was built against every decision above — NOAA CCNO1 stage/flow/flood-status/forecast, USGS mean river velocity, and USGS Licking River temperature, with the approved five-day forecast window, timestamp-based six-hour trends, and the §13 freshness policy all implemented as specified. The three data sources fetch concurrently server-side with independent error handling (§6), the client polls without a full page reload, and the "Live" indicator now reflects actual per-source status rather than a hardcoded state (§6). Verified: production build, lint, 42 unit tests covering the sentinel-filtering, freshness, forecast-classification, trend, and unit-conversion logic, and a live-data visual check at mobile and desktop widths. See `docs/river-v1-spec.md`'s Implementation Notes for the specific TTLs, timeouts, and other routine choices made to fill in details the approved decisions left open.

---

## 1. River features and interactions

**Header** (`river.php:1656-1669`): static "Port of Cincinnati" eyebrow, "Ohio River" title, an "Updated <time>" subtitle populated from the latest observed reading, and a "Live" badge. The badge is purely decorative — it renders whenever the page reaches the success branch at all (`$fetch_error` is falsy) and does not reflect whether the forecast, meta, or temperature calls individually succeeded (`river.php:178, 1652-1669`).

**Stage hero card** (`river.php:1693-1704`, populated at `:2008-2062`):

- Value: latest observed stage, one decimal, unit "ft".
- Trend: `▲/▼/→` badge from a 6-point delta (see §3).
- Status line: "🟢 Normal", "🟡 Action stage", "🔴 Flood stage", or "🔴 Major flood stage" based on threshold comparison (`:2029-2033`).
- A horizontal bar visualizes stage as a fraction of `major * 1.1`, color-coded green/amber/red/dark-red, with "Low"/action/flood/"Major" tick labels (`:2021-2028, 2034-2035`).

**Current (speed) hero card** (`river.php:1705-1710`, populated at `:2065-2082`): an estimated mph value with its own 6-point trend, and a fixed caption: _"Estimated from NOAA flow · 36,000 ft² channel · calibrated to NWS bulletin"_ (`:2082`). This caption is a claim to verify — see §3 and §4c; nothing in the file shows an actual calibration against an NWS bulletin.

**Stat grid** (`river.php:1713-1730`): three cards — Water Temp (°F, with a "feel" descriptor and a source line), Flow (kcfs, with trend), and "5-Day Peak" (forecast peak stage + delta from current). The "5-Day Peak" label is a claim to verify against the actual forecast window used (see §4b).

**Chart** (`river.php:1738-1764`, built at `:2135-2365`): a Chart.js line chart with three interchangeable modes — Stage, Flow, Current — switched via `setChartTab()` (`:2388-2393`), each with its own y-axis unit. Observed data renders as a solid filled line; forecast (when present) as a dashed line continuing from the last observed point. A "NOW" dashed vertical marker is drawn at the observed/forecast boundary via a custom Chart.js plugin (`:2335-2364`). On the Stage tab only, three dashed horizontal reference lines are added for action/flood/major thresholds (`:2174-2204`). Tooltips are pinned to a fixed position at the top of the chart area rather than following the cursor (`:2125-2133`), and are explicitly dismissed on touch/pointer-up (`:2367-2386`) — a mobile-specific behavior.

**Timestamps**: the "Updated" time and chart x-axis/tooltip labels are formatted with `toLocaleString`/`toLocaleDateString` in the _browser's_ local timezone (`:2012-2018, 2106-2110, 2255-2261`), not a fixed timezone tied to the gauge location.

**Loading**: the PHP script echoes a minimal HTML shell with a full-screen spinner and attempts to flush it to the browser _before_ making any API calls (`:66-85`, `ini_set('output_buffering','off')`, `ob_end_flush()`, `flush()`). Whether this actually reaches the browser early depends on the hosting stack (PHP-FPM/nginx/Apache buffering, mod_deflate, etc. can all silently re-buffer) — the code only _attempts_ early flush, it cannot guarantee it. The spinner is removed by JS only after all rendering functions have run, at the very end of the script (`:2799-2806`).

**Errors**: if the NOAA _observed_ fetch fails, the PHP branch renders only a red error box ("Could not reach NOAA API.") and skips the entire tab UI (`:1652-1654, 178`). Notably, forecast/meta/temperature failures alone do _not_ trigger this path — only the observed-stage call is treated as fatal. See §4 for a related redundant-error-message defect.

**Refresh**: no partial/live refresh exists. The page does a full `location.reload()` every 10 minutes (`:2809`). Because caching is session-based (see §2), a reload inside the cache TTL windows re-renders from cached data server-side rather than re-fetching.

---

## 2. Data sources

All fetches go through one helper, `rw_fetch()` (`:28-60`): server-side cURL (10s timeout, 3 redirects, TLS verified), with results cached in PHP `$_SESSION` keyed by a cache key + timestamp, default TTL 300s unless overridden per call. **This cache is per-visitor session (cookie-scoped), not a shared server-side cache** — every new browser/session triggers a fresh round of all calls; the TTLs only reduce repeat calls from the _same_ visitor within the window.

**River:**
| Data | Endpoint | Cache TTL | Notes |
|---|---|---|---|
| Observed stage/flow | `api.water.noaa.gov/nwps/v1/gauges/CCNO1/stageflow/observed` (`:90`) | 300s (default) | Gauge CCNO1 |
| Forecast stage/flow | `.../gauges/CCNO1/stageflow/forecast` (`:91`) | 900s | |
| Gauge metadata (flood categories) | `.../gauges/CCNO1` (`:92`) | 3600s | |
| Water temperature | `waterservices.usgs.gov/nwis/iv/?sites=03254520&parameterCd=00011&period=PT3H` (`:93`) | 1800s | USGS site 03254520, parameter code **00011** |

Units: stage in feet, flow ("secondary" field) treated as **kcfs** (thousand cubic ft/s) — the UI label and the `flowToMph`/`boater_mph` formulas both assume the raw NOAA "secondary" value is already in thousands of cfs (`:1986-1991, 231`). This unit assumption is not re-verified against the API response and should be confirmed against NWPS documentation for gauge CCNO1 specifically.

USGS parameter code **00011** is labeled in the source comment as "water temp" (`:13`) and the code reads it directly as Fahrenheit with no conversion (`:244`). Historically, USGS sites more commonly publish parameter **00010** (water temp in °C); whether site 03254520 actually reports 00011 in °F, as this code assumes, cannot be confirmed without a live query and should be verified. Separately, site 03254520 is hard-labeled in the UI as _"Licking R. @ Alexandria KY"_ (`:246`) — a Kentucky tributary, not the Ohio River mainstem — so the river page's water-temperature reading is a proxy from a nearby tributary, not a mainstem measurement.

**Weather (shared dependency to flag for the river-only rebuild):**

- 6 river-corridor stations (Madison IN → Maysville KY, `:98-105`) + a "current conditions" call at lat 39.09/lon -84.51 (`:141`) + a 3-hourly forecast call (`cnt=56`, `:142`), all via OpenWeatherMap 2.5, each with its own session cache key (station calls: 600s; forecast: 1800s).
- The OWM API key is a hardcoded literal in source (`:64`) — flagged for the rebuild as something to move to a secret/env var, not reproduced here.
- **Important shared dependency**: the _current conditions_ OWM call (`:141`) is used twice — once to populate the Weather tab, and once as the **fallback source for the river tab's water temperature** when the USGS reading is unavailable (`:253-258`). A river-only rebuild that drops all weather-tab code cannot simply delete this call without also deciding what (if anything) replaces the temperature fallback.
- Windy embed (`:1873-1875, 1908-1922`) is weather-tab only, lazy-loaded on first tab open, no API key in the URL, no dependency on river data.

---

## 3. Calculations

**Current (mph) estimate** — the single formula, duplicated in two places with matching constants:

- PHP, for the hero card (`:225-235`): `boater_mph = round((flow * 1000 / 36000) * 0.681818, 1)`, using the most recent observed row where both stage and flow are present (scanned newest-first).
- JS, for the chart's "Current" mode (`:1986-1991`): `flowToMph(k) = (k * 1000 / CHANNEL_AREA) * FPS_TO_MPH` with `CHANNEL_AREA = 36000` and `FPS_TO_MPH = 0.681818`.
- This is **estimated**, not measured: flow (kcfs) → cfs (×1000) → divide by a **fixed** cross-sectional channel area of 36,000 ft² → ft/s → ×0.681818 (= 3600/5280, the correct ft/s→mph conversion) → mph. The channel-area constant is fixed regardless of actual river stage; see §4c.

**Water temperature**:

- Measured (when available): USGS 00011 value taken as-is in °F (`:244`), converted to °C via `(F−32)×5/9` (`:245`). Labeled "USGS · Licking R. @ Alexandria KY" (`:246`).
- Estimated (fallback, when USGS is unavailable): `water_c = 0.95 × air_c + 1.0`, where `air_c` is OWM current air temperature converted to °C (`:253-258`). This is an unsourced empirical linear approximation — no citation in the code or comments.

**Trends** — "6h" labels are computed from **6 array points**, not 6 elapsed hours:

- `trend6h()` (`:2037-2056`) takes `vals.slice(-6)` and diffs the last against the first of those six _points_, labeling the result e.g. `▲ +0.4ft/6h`.
- The current-speed trend uses the identical 6-point-slice pattern inline (`:2067-2081`).
- Whether six points actually span six hours depends entirely on the spacing baked into the `obs` array the trend function receives, which is **not raw NOAA data** — see the downsampling logic below. This is the "six-point vs. six-hour" question flagged for investigation; it is confirmed as a _labeling assumption_, not a verified time span. See §4a.

**Observed-data downsampling** (`:187-203`): starting from a 5-day cutoff (`strtotime('-5 days')`), the PHP filters out sentinel/missing values (`primary <= -9000` or null) and then keeps only every 16th row **by array index** (`$i % 16 === 0`), always appending the final valid point at the end if not already included. This means the "6h" trend spacing is only as good as (raw NOAA reporting interval × 16) — e.g., 16 rows at a 15-minute native interval ≈ 4 hours per downsampled point, making a 6-point span ≈ 24 hours, not 6. The native reporting interval for CCNO1 is not fetched or asserted anywhere in this file, so this cannot be confirmed from the source alone.

**Forecast window** — a labeling/window mismatch, not just a display quirk:

- Server-side, the forecast rows are filtered to `strtotime('+6 days')` (`:205`) — a **6-day** window.
- The UI, however, labels this "5-Day Peak" (stat card, `:1726`) and "5-Day History + Forecast" (chart section header, `:1734`) and "Forecast (5d)" (chart legend, `:1756`).
- Observed history genuinely is a 5-day window (`cutoff = -5 days`, `:187`), so the "5-day" label is correct for history but not for forecast. This is the "five-day vs. six-day forecast" discrepancy flagged for investigation — confirmed present in the code as written.
- Separately, the _Weather_ tab's "7-Day Forecast" header (`:1850`) groups OWM's 3-hourly forecast data by calendar day, capped in code at 10 days (`:153`) — but OpenWeatherMap's 5-day/3-hour forecast endpoint is documented to return at most 5 days (40 records) regardless of the `cnt=56` parameter requested (`:142`). Whether the live response actually yields 7 distinct calendar-day cards cannot be confirmed without a live call; this is a second, separate 5-vs-N-day question, isolated to the weather tab (not investigated further here — out of scope now that weather is a separate project).

> **Resolved, 2026-09-08:** the river forecast-window question is decided — see the changelog note above and §8/§9 below. A live check of the NOAA forecast endpoint (§8) found the _actual available_ forecast horizon was only ~4.9 days at the time of the check, which is itself evidence for why the app must render whatever NOAA actually returns, capped at 5 days, rather than assuming a fixed 5- or 6-day window exists every time.

**Flood category thresholds** (`:214-223`):

- Primary path reads three thresholds by **fixed array position** — `categories[0]`=action, `[1]`=flood, `[2]`=major — assuming the API always returns exactly three categories in that exact order, with no name-based check in this path.
- Fallback path activates only if that primary path yields nothing, and instead reads a _differently-shaped_ key (`floodCategories`), matching by substring on a `name` field ("action"/"flood" excluding "major"/"major").
- Final fallback, if neither path resolves any threshold: hardcoded `action=38.0, flood=52.0, major=62.0` ft (`:223`), with no citation, date, or source — and no UI indication if this hardcoded fallback (versus live gauge-specific data) is what's actually being displayed.

**Dew point** (weather tab only, not central to the river rebuild): `temp − (100 − humidity)/5` (`:118`) — a crude approximation, not the Magnus/August-Roche-Magnus formula typically used for dew point; flagged only for completeness since it lives in the same `parseWx()` helper.

---

## 4. Potential defects and uncertainties

Investigated per the brief, plus additional findings surfaced while reading the full file. Source comments are treated as claims, not facts, per instructions — several are called out below as unverified.

**a. Six-point vs. six-hour trend.** Confirmed as an assumption, not a guarantee (§3). The "/6h" label is hardcoded text, but the actual elapsed time depends on (raw NOAA interval × 16) via the array-index downsampling at `:193`. If the native interval isn't exactly ~22.5 minutes, the label is wrong. **Resolved, 2026-09-08 (§8):** a live check found the actual native interval is 15 minutes (not ~22.5), so the legacy `%16` downsampling would space points roughly 4 hours apart, not 6 — the "6h" label as originally implemented would have been wrong on this gauge, on this day, by a wide margin. §9 proposes a timestamp-based replacement.

**b. Five-day vs. six-day forecast.** Confirmed present, not just suspected (§3): the fetch/filter window is 6 days (`:205`) while every UI label says 5 days (`:1726, 1734, 1756`). A second, independent 5-vs-N mismatch exists on the Weather tab ("7-Day Forecast" header vs. OWM's actual 5-day/3-hour endpoint limit). **Resolved, 2026-09-08:** decision confirmed as 5 days of history + up to 5 days of _available_ forecast, never padded — see changelog note and §8/§9.

**c. Fixed channel area for current speed.** Confirmed: `CHANNEL_AREA = 36000` ft² is a single hardcoded constant, duplicated in PHP (`:231`) and JS (`:1986`), applied uniformly regardless of actual stage. Physically, a river's cross-sectional area grows with stage/depth, so a fixed-area model will systematically **overstate velocity at high stage** and **understate it at low stage** relative to a stage-aware model. **Confirmed against live official sources, 2026-09-09 (§11):** both USGS's own live index-velocity measurement at the co-located mainstem gauge and the NWS Ohio River Forecast Center's own published bulletin for this exact station imply an effective area of roughly 31,400–34,300 ft², not 36,000 — and the legacy formula underestimates current speed by 9–13% relative to the NWS bulletin's own numbers, for the same flows, same gauge, same day. The "calibrated to NWS bulletin" caption (`:2082`) is **not supported** by the bulletin as it exists today (§11.2). The formula also computes a cross-sectional *average* velocity, not the "mid-channel" reading the UI label claims (§11.3).

**d. Flood-category mapping.** Confirmed fragile: positional-index assumption in the primary path with no name verification, a differently-shaped fallback key, and a hardcoded numeric last-resort fallback (38/52/62 ft) with no source or date (§3). No UI signal distinguishes "live gauge-specific thresholds" from "hardcoded fallback." **Confirmed broken against the live API shape, 2026-09-08 (§8):** the metadata endpoint returns `flood.categories` as a **named object** (`major`/`moderate`/`minor`/`action`), not an indexed array — so the legacy `categories[0]/[1]/[2]` lookup cannot match at all today, and the schema has **four** categories, not the three (action/flood/major) the legacy code modeled. Live official values at check time: action 40 ft, minor 52 ft, moderate 56 ft, major 65 ft — close to, but not identical to, the hardcoded fallback (38/52/62), and missing the moderate tier entirely from the legacy model. Full detail in §8.

**e. Missing-data handling.** Sentinel filtering (`primary <= -9000`, USGS `'-999999'`) is applied consistently for stage/flow/temp. Partial-failure states degrade gracefully at the field level (e.g., stage present but flow absent leaves the Current card at its "—" placeholder rather than crashing). However, silent fallbacks are not surfaced to the user: if the gauge-metadata call fails entirely, the flood thresholds silently become the hardcoded 38/52/62 constants with no visual distinction from live data (see d). Additionally, a **redundant/inconsistent error-UI defect** was found: when the observed-fetch fails, PHP renders a specific error box ("Could not reach NOAA API.", `:1653`), but the `<script>` block still runs unconditionally afterward and, seeing `RIVER` as `null`, immediately overwrites the entire `<body>` with a second, more generic error message ("No river data available.", `:1890-1893`) — so the specific PHP error is shown only momentarily before being replaced.

**f. Temperature source and fallback.** Confirmed two separate open questions (§2, §3): (1) the primary source is a Kentucky tributary gauge (Licking River), not the Ohio River mainstem, despite being the sole water-temperature figure on an "Ohio River" page; (2) the USGS parameter code (00011, assumed already in °F) and the fallback formula (`0.95×air_c+1.0`, unsourced) are both unverified assumptions baked into the code with no citation.

**g. Sequential requests delaying rendering.** Confirmed: all ~11 HTTP calls (4 river + 6 station winds + 2 current/forecast weather, `:90-93, 132-142`) run as blocking, sequential `curl_exec` calls within a single PHP request, with no parallelization (e.g., no `curl_multi`). The early-flush spinner (`:66-85`) only sends the _loading shell_ early — the actual tab markup, hero cards, and the `<script>` block containing all data are not sent until the entire fetch sequence (river **and** weather) completes, because they're built in one linear PHP pass. Consequently, **a user who only ever opens the River tab still pays the full latency cost of all 7 weather-tab API calls** on every page load, since nothing in the PHP code gates the weather fetches behind actual tab selection (that's purely a client-side/JS concern, applied only to the Windy iframe via `windyLoaded`, `:1898,1908-1911`, not to the OWM calls). Worst case (each call near its 10s timeout) could stack to roughly a minute or more of blocking time before content appears, despite the spinner suggesting the page is already "loading."

**Additional findings** (outside the six requested, surfaced during full-file review):

- The Weather tab's "Current Conditions · Newport, KY" header (`:1777`) is paired with coordinates (39.09, -84.51) that correspond to downtown Cincinnati, OH, not Newport, KY — the two are adjacent across the river but not the same location. Worth confirming the label is intentional (a "representative" label) versus a copy-paste leftover.
- The "cached 5 min" note shown near the chart (`:1762, 2019`) reflects only the observed-data TTL (300s) and is a hardcoded string — it says nothing about the different TTLs actually governing forecast (15 min), meta (60 min), or temperature (30 min) data blended into the same page, so it may understate how stale some displayed values can be.
- The "Live" badge (`:1665`) is unconditional once the page reaches the non-error branch; it does not reflect partial failures (e.g., forecast or meta silently failing while observed succeeds).

---

## 5. Mobile layout and iframe dependencies

The brief notes three screenshot symptoms: cramped card text, a wrapping forecast value, and empty space below the chart. Here's what the PHP/CSS in this file can and cannot explain.

**Explained by this file:**

- **Cramped stat-card text**: `.stat-grid` is a fixed 3-column grid (`grid-template-columns: repeat(3, 1fr)`, `:700-705`) with **no responsive breakpoint** anywhere in the stylesheet to collapse it on narrow viewports. By contrast, the 6-station wind grid explicitly collapses to 3 columns under 900px (`:916-920`). On a narrow phone, three equal-width stat cards each get roughly a third of the screen, and their contents (10px uppercase labels, 32px value text, `:737-760`) have no width-based scaling (no `clamp()`, no font-size media query) — this alone is sufficient to explain cramped text without needing to inspect the WordPress wrapper.
- **Wrapping forecast value**: the "5-Day Peak" stat renders a string like `"58.4 ft"` (`:2101`) into the same fixed-32px `.stat-val` styling as the shorter numeric-only Water Temp and Flow cards (`:747-753`), inside the same cramped third-width column described above, with no `white-space: nowrap` or width accommodation specific to that card. The combination of a longer string (number + unit text) and the tightest column width plausibly explains the wrap on its own — again, explainable from this file alone, no WordPress inspection needed.
- **Chart height**: `.chart-wrap` uses a fixed `height: 480px` (`:849-859`) with Chart.js `maintainAspectRatio: false` (`:2225`) — the canvas always renders at exactly 480px regardless of viewport width or how much data is present, which can look sparse but is a deliberate (if not responsive) fixed height, not a bug per se.

**Not resolvable from this file — requires inspecting the WordPress wrapper:**

- **Empty space below the chart**: this file contains no JS that communicates rendered content height back to a parent frame (no `postMessage` calls, no iframe-resize library reference anywhere in the 2,813 lines). The page does set `X-Frame-Options: SAMEORIGIN` (`:18`), confirming it's designed to be iframed from the same origin, but it never tells that parent iframe how tall its content actually is. If the WordPress theme/embed sets a **fixed or one-time-calculated iframe height** (e.g., sized before the spinner-gated content finishes rendering, or sized for a taller state such as when more forecast days are present), a shorter actual render would leave blank space below — but confirming this requires reading the WordPress page template or embed shortcode, which is outside this file and outside the scope of this inspection.

---

## 6. Proposed behavior checklist for the river-only rebuild

Split explicitly between **existing behavior** (documented above, carried forward as-is unless corrected) and **suggested corrections** (flagged defects from §4). No implementation, library choice, or visual redesign is implied here — this is a checklist of _behavior_, for the next planning step.

**Existing behavior to preserve (as observed):**

- [ ] Header with gauge name, "Updated <time>" timestamp (from latest observed reading, browser-local time), and a live-status indicator.
- [ ] Stage hero: current value (ft, 1 decimal), 6-point trend badge, status text (Normal/Action/Flood/Major), and a proportional stage bar with action/flood/major tick labels.
- [ ] Current (speed) hero: estimated mph value, 6-point trend badge, and a caption describing the estimation method.
- [ ] Stat cards: Water Temp (°F + °C + "feel" descriptor + source label), Flow (kcfs + trend), Forecast Peak (value + delta from current + date).
- [ ] Chart with Stage/Flow/Current mode toggle, observed (solid) vs. forecast (dashed) series, a "NOW" marker, and threshold reference lines on the Stage mode.
- [ ] Error state when the primary observed-stage fetch fails.
- [ ] Auto-refresh on a fixed interval (currently full-page reload every 10 minutes).
- [ ] Server-side caching per data source with distinct TTLs.

**Suggested corrections (tied to §4 findings — decisions needed, not yet decided):**

- [x] **Verified:** NOAA CCNO1's native observed-data reporting interval is 15 minutes (confirmed live, §8), so the legacy `%16`-index downsampling does not span 6 hours. §9 proposes a timestamp-based trend calculation to replace it, computed against full-resolution data (not the chart's downsampled series).
- [x] **Decided:** show 5 days of observed history and up to 5 days of forecast — whatever NOAA actually returns, never padded or extended to fill a full 5 days if less is available. Fetch window, UI labels, and chart legend should all read "5-day" consistently once implemented.
- [x] **Decided:** the fixed 36,000 ft² channel-area assumption and its "calibrated to NWS bulletin" claim are not supported by live USGS or NWS data (§11) — replace with USGS 03255000 parameter `72255` ("Mean river velocity"), latest + five-day history, no forecast in v1. Stale readings (>60 min old, §13) stay visible with a "Stale" label; "Unavailable" only when no valid reading exists at all (§11.5, §13).
- [x] **Decided:** derive flood status from NOAA's `status.observed.floodCategory` and stage-bar/reference labels from NOAA's four named thresholds (action/minor/moderate/major); remove the positional-index lookup and the hardcoded 38/52/62 fallback entirely (§10). Never shown as an unqualified "Normal" when stale (>60 min, §13) or when its timestamp can't be established.
- [x] **Decided:** water temperature sources from USGS 03254520 (Licking River), parameter `00010` (°C → °F for display), labeled "Water temperature · Licking River" with an explicit tributary (not mainstem) disclosure — chosen for its proximity to Cincinnati over the more distant Markland Dam mainstem alternative. The air-temperature fallback formula and automatic substitution from USGS 03277200 (Markland Dam) are both removed. Stale after 2 hours (§13), shown with a "Stale" label, not hidden (§12.5).
- [x] **Decided:** approved freshness/staleness policy for v1 — 60-minute threshold for stage, flood status, and mean river velocity; 2-hour threshold for water temperature; product settings, not agency standards; age computed from observation timestamp, not fetch time; stale values stay visible with their timestamp; "Unavailable" only when no valid reading exists; a missing/invalid timestamp means freshness is unknown, never implicitly fresh. Does not apply to forecasts (§13).
- [x] **Implemented (v1 build):** the redundant client/server double error-message no longer applies — the Next.js rebuild has one error path per data source (a `DataResult` union checked once, rendered once), not a PHP fatal branch plus a separate client-side overwrite.
- [x] **Implemented (v1 build):** the Weather tab and every OpenWeatherMap dependency are excluded entirely from the rebuild — resolved outright now that neither current-speed nor water-temperature needs it (§7's remaining OWM question was about the legacy weather tab's *own* need for it, which is moot since that tab doesn't exist in this app).
- [x] **Implemented (v1 build):** the three independent sources (NOAA stage/flow/status, USGS velocity, USGS temperature) are fetched concurrently (`Promise.all`/`Promise.allSettled`), each with its own bounded timeout (8s) and independent error handling — a failed source renders its own "Unavailable" section without blocking or blanking the rest of the page.
- [x] **Implemented (v1 build):** the header's live-status indicator now reflects actual per-source fetch success — "Live" when all three sources succeeded, "Partial" when some did, "Offline" when none did — replacing the legacy's single hardcoded "Live" state. See `docs/river-v1-spec.md`, Implementation Notes.

---

## 7. Questions for the owner

**Resolved since the initial draft:**

- ~~What is NOAA CCNO1's actual observed-data reporting interval?~~ **Answered, 2026-09-08 (§8): 15 minutes**, confirmed from a live response (not a documented guarantee — see §8's caveat on this).
- ~~Is the forecast window supposed to be 5 days or 6 days?~~ **Decided: 5 days of history + up to 5 days of available forecast, never padded.**
- ~~What are the authoritative flood-stage thresholds, and should status be derived from NOAA's own field?~~ **Decided, 2026-09-09 (§10): use `status.observed.floodCategory` for the status label, and NOAA's four named thresholds (action 40 ft / minor 52 ft / moderate 56 ft / major 65 ft at check time) for the stage bar — not the legacy hardcoded fallback or positional lookup.**
- ~~What should replace the current-speed estimate?~~ **Decided, 2026-09-09 (§11.5): USGS 03255000, parameter `72255` (mean river velocity), latest value + five-day history, no forecast in v1, rather than a fixed-area fallback. Stale (>60 min, §13) values stay visible and labeled; "Unavailable" only when no valid reading exists at all.**
- ~~Which water-temperature source should the rebuild use?~~ **Decided, 2026-09-09 (§12.5): USGS 03254520 (Licking River), parameter `00010` (°C → °F for display), labeled "Water temperature · Licking River" with an explicit tributary disclosure — not USGS 03277200 (Markland Dam), evaluated but not chosen; no air-temperature fallback.**
- ~~What staleness threshold should gate the flood-status, mean-river-velocity, and water-temperature features?~~ **Decided, 2026-09-09 (§13): 60 minutes for stage, flood status, and mean river velocity; 2 hours for water temperature. Product settings, not agency standards; computed from observation timestamp, not fetch time.**

**Blocking** (needed before the rebuild's data/calculation layer can be built with confidence):

1. Since the Weather tab is being split into its own future project, should the river-only rebuild drop the OpenWeatherMap dependency entirely (now that both current-speed and water-temperature no longer depend on it in any way), or does the river app still need OpenWeatherMap for anything else? This affects the app's external dependency list (§2).

**Non-blocking** (useful, but resolvable during or after initial build):

2. **Forecast freshness is explicitly unresolved** and is a *separate* question from the observed-data staleness policy in §13 — that policy does not apply to the stage/flow forecast series. How old can a forecast's `issuedTime` (§8.2 confirmed this field exists) be before it should be flagged as outdated, if at all? Not addressed by any decision to date.
3. The ±30-minute tolerance window used to anchor the timestamp-based six-hour trend (§9, step 4) is a distinct concept from the §13 staleness thresholds — it governs how far from a 6-hour-old target a trend anchor point may be, not how old the latest reading may be. It remains a proposed default, not owner-confirmed.
4. Should "Updated" timestamps use the visitor's local timezone (current behavior) or a fixed timezone tied to the gauge's location?
5. Will the new river-only app still run inside the existing WordPress iframe, or is it a standalone page? This determines whether the "empty space below the chart" symptom (§5) is still relevant, or whether it disappears simply by not being iframed the same way.
6. ~~What caching approach should replace PHP's session-scoped cache?~~ **Implemented (v1 build, routine choice — not a separately negotiated policy decision):** a per-source in-memory TTL cache in the Next.js server process — observed 3 min, forecast 15 min, gauge metadata 5 min, velocity 5 min, temperature 10 min — plus a 5-minute client-side poll that refreshes the page's data without a full reload. See `docs/river-v1-spec.md`, Implementation Notes, for the reasoning; the owner is welcome to revise any of these values.
7. Should the app treat NOAA's per-endpoint silence about lookback window, interval, and horizon (§8) as stable enough to hardcode, or should the data layer be defensive about these changing without notice, since NOAA's own spec makes no guarantee?

---

## 8. Live NOAA endpoint verification (2026-09-08)

Per instruction, this round inspected the live public NOAA CCNO1 endpoints and the NWPS API's own documentation. Methodology note: an initial pass used an AI-summarizing fetch tool, which under-read the observed endpoint's response (it reported 961 entries ending mid-August, when the true response has 2,871 entries extending to the retrieval date) — likely a content-length truncation in that tool, silently summarized as if complete. Everything below was cross-checked against the **raw JSON via direct HTTPS request** (`curl`, exact values parsed with a script, not summarized by an intermediate model), to avoid reporting a paraphrase as fact.

**Retrieval time:** 2026-09-08, approximately 20:30–20:50 UTC. All findings below describe **one live response at that moment** — see the explicit "documented vs. observed" split at the end of this section for what is and isn't guaranteed to still hold true tomorrow.

### 8.1 Observed endpoint

Source: `GET https://api.water.noaa.gov/nwps/v1/gauges/CCNO1/stageflow/observed`

- Top-level fields: `pedts` ("HGIR2"), `issuedTime`, `wfo`, `timeZone`, `primaryName`/`primaryUnits`, `secondaryName`/`secondaryUnits`, `data`.
- **Units, confirmed exactly as legacy code assumed**: `primaryName: "Stage"`, `primaryUnits: "ft"`; `secondaryName: "Flow"`, `secondaryUnits: "kcfs"`.
- **2,871 data points**, timestamps `2026-08-09T20:30:00Z` through `2026-09-08T20:00:00Z` — a **~29-day** rolling window, not 5 days (the 5-day cutoff in the legacy code, `river.php:187`, is applied client-side; NOAA itself returns much more).
- **Ordering: strictly ascending** by `validTime`, ISO-8601 UTC (`Z` suffix), one entry per timestamp (no duplicates).
- **Spacing: 15 minutes** between consecutive entries in 2,869 of 2,870 gaps. **One exception**: a 135-minute gap between `2026-09-05T17:00:00Z` and `2026-09-05T19:15:00Z` — i.e., roughly 8 expected readings were simply absent, with no placeholder/null row marking the gap; the series just skips those timestamps entirely.
- **No missing-value sentinels observed in this window** — no nulls, no `-9999`/`-999999`-style values, on either `primary` or `secondary`, across all 2,871 points. This does **not** prove the legacy code's defensive sentinel-filtering (`primary <= -9000`, `river.php:192`) is unnecessary — it proves only that this particular gauge, this particular month, didn't hit that condition. (A sentinel value _was_ observed elsewhere — see §8.3.)
- Each row also carries a `generatedTime` (when that observation was processed/published), distinct from `validTime` (when the reading is valid for) — the legacy code uses only `validTime` and ignores `generatedTime`.

### 8.2 Forecast endpoint

Source: `GET https://api.water.noaa.gov/nwps/v1/gauges/CCNO1/stageflow/forecast`

- Same top-level shape as observed, plus a forecast-specific `issuedTime: "2026-09-08T14:14:00Z"` and per-row `generatedTime: "2026-09-08T14:24:34Z"` (identical across all 20 rows in this response — one forecast run, not incrementally regenerated per row).
- **20 data points**, ascending, `2026-09-08T18:00:00Z` through `2026-09-13T06:00:00Z`.
- **Spacing: a clean 6 hours** between every consecutive pair (19 of 19 gaps, no exceptions) — unlike the observed feed, the forecast feed had zero irregular gaps in this sample.
- **Total horizon: 114 hours from first to last point (4.75 days), or ~117.8 hours (~4.9 days) measured from `issuedTime` to the last point.** This is **less than 5 full days** — direct, concrete evidence for the "never extend or fabricate a shorter forecast" instruction: on this actual day, a naive "always show 5 days of forecast" implementation would have had nothing to show for the last ~2.2 hours of a nominal 5-day window, and padding it would mean inventing data NOAA never issued.
- No missing-value sentinels in this response.

### 8.3 Gauge metadata endpoint

Source: `GET https://api.water.noaa.gov/nwps/v1/gauges/CCNO1`

- Identity: `name: "Ohio River at Cincinnati"`, `lid: "CCNO1"`, `usgsId: "03255000"`, county Hamilton, OH, lat/lon `39.0945044, -84.5104983`, `timeZone: "EST5EDT"`.
  - **Note for §4f/§2**: this gauge's own associated USGS site is **03255000** — a _different_ USGS site number than the **03254520** ("Licking R. @ Alexandria KY") the legacy code queries for water temperature. This corroborates, from NOAA's own metadata rather than just the legacy code's hardcoded label, that the water-temperature reading comes from a different river/gauge than the stage/flow reading. (Per this round's scope, water-temperature source **validity** itself remains unresolved — this is additional corroborating evidence, not a resolution.)
- **Flood categories — this is the important structural finding.** The live `flood.categories` field is a **named object, not an indexed array**:
  ```
  "categories": {
    "major":    { "stage": 65, "flow": -9999 },
    "moderate": { "stage": 56, "flow": -9999 },
    "minor":    { "stage": 52, "flow": -9999 },
    "action":   { "stage": 40, "flow": 255999 }
  }
  ```
  with `"stageUnits": "ft", "flowUnits": "cfs"`. Three of the four categories carry `flow: -9999` — **a confirmed live sighting of a sentinel value**, here meaning "no flow threshold defined for this category" (only `action` has a real flow value). This is a different field and different meaning than the observed/forecast sentinel-filtering in the legacy code, but it confirms NOAA does use `-9999` as a "not applicable" convention somewhere in this API family.
  - The legacy code's primary path (`river.php:214`, `categories[0]/[1]/[2]['stage']`) assumes a **numerically-indexed array of exactly three items**. Against this live response, that lookup fails outright — PHP would find no integer key `0` on an associative array keyed by strings, so `$thresholds['action']` etc. would all resolve to null, and the code would fall through past both the primary path _and_ the name-matching fallback path (which looks for a different key, `floodCategories`, not present at all in this live response) straight to the **hardcoded fallback**: `action=38.0, flood=52.0, major=62.0`.
  - Comparing hardcoded fallback to live truth: action 38 vs. live 40 (off by 2 ft), "flood" 52 vs. live minor 52 (matches, but conflates minor/moderate into one number), major 62 vs. live 65 (off by 3 ft) — and the fallback has no representation of the live "moderate" (56 ft) tier at all.
- `status.observed.floodCategory: "no_flooding"` and `status.forecast.floodCategory: "no_flooding"` — NOAA **already computes and exposes the categorical flood status directly**, alongside the raw stage/flow status values, timestamped. This is a materially simpler and more robust alternative to re-deriving flood status from threshold comparisons client-side (see §7, blocking question 4).
- `normalThreshold: { "value": 25.4, "units": "ft" }` — a reference/normal-pool stage, not modeled anywhere in the legacy code.
- Vertical datum: **NAVD88**, gauge-zero elevation value `428.05`.
- `hydronotes` includes a standing note: _"River Forecasts typically include ONLY 2 days of future rain from forecast issuance time... Occasionally 3 days of future rain included."_ This describes the _precipitation input_ driving the forecast model, not the stage-forecast output horizon — the live forecast response still projected stage ~4.9 days out (§8.2) despite this 2–3 day rainfall-input caveat, so the two are not the same thing and shouldn't be conflated.
- A separate, unrelated hydronote (_"Gauge awaiting repair - automated readings are not available at this time," effective 01/22–02/01_) documents that NOAA itself can mark this gauge as fully non-reporting for a scheduled or recurring window — a whole-response missing-data mode, distinct from the per-point sentinel convention, that a robust client should handle (this note did not appear to be active at the 2026-09-08 retrieval time, since a full and current response was returned).

### 8.4 What is documented vs. what one live response shows

Retrieved and inspected the NWPS OpenAPI specification directly: `https://api.water.noaa.gov/nwps/v1/docs/swagger.json` (human-facing Swagger UI at `https://api.water.noaa.gov/nwps/v1/docs/`). The relevant operation is `GET /nwps/v1/gauges/{identifier}/stageflow/{product}` (`product` enum: `observed`, `forecast`).

**The specification documents:**

- The two path parameters (`identifier`, `product`) and their types.
- Field-level descriptions confirming `validTime` = "the date/time when the observation was made or when the forecast will be valid," `generatedTime` = "the date/time when the product was generated," `primary`/`secondary` = "the primary/secondary value reported at the gauge" (no unit or meaning beyond that — units are only conveyed via the response's own `primaryUnits`/`secondaryUnits` strings, per-gauge, not fixed in the schema).

**The specification does NOT document, anywhere:**

- Any lookback window or date range for the observed endpoint (the ~29 days seen live is not a stated contract).
- Any reporting interval or cadence (the 15-minute spacing seen live is not a stated contract).
- Any forecast horizon (the ~4.9 days seen live is not a stated contract — it could plausibly be shorter or longer on a different day, or for a different gauge).
- Any missing-value or sentinel convention (the `-9999` seen in flood-category flow fields, or the legacy code's `-9000` threshold check, are not mentioned in the schema at all).
- Any query parameters to control date range — there are none; the endpoint takes only `identifier` and `product`.

**Conclusion for the rebuild:** every numeric assumption about interval, lookback, and horizon that this investigation (or the legacy code) relies on is **empirical, observed-only behavior from live responses, not a contractual guarantee from NOAA**. A rebuild should treat these as _defaults observed in practice_, not hardcoded constants immune to change, and should compute things like "how many days of forecast do we actually have" from the response's own timestamps every time, rather than assuming a fixed count of rows or a fixed horizon.

**Sources:**

- [NOAA NWPS — CCNO1 observed](https://api.water.noaa.gov/nwps/v1/gauges/CCNO1/stageflow/observed) (live data endpoint)
- [NOAA NWPS — CCNO1 forecast](https://api.water.noaa.gov/nwps/v1/gauges/CCNO1/stageflow/forecast) (live data endpoint)
- [NOAA NWPS — CCNO1 metadata](https://api.water.noaa.gov/nwps/v1/gauges/CCNO1) (live data endpoint)
- [NOAA NWPS API — Swagger UI](https://api.water.noaa.gov/nwps/v1/docs/) / [raw OpenAPI spec](https://api.water.noaa.gov/nwps/v1/docs/swagger.json)
- [NOAA NWPS — public gauge page for CCNO1](https://water.noaa.gov/gauges/CCNO1) (client-rendered SPA; confirms gauge name "Ohio River at Cincinnati" but exposes no additional interval/horizon documentation beyond the API itself)
- [National Water Prediction Service (NWPS) APIs — overview page](https://water.noaa.gov/about/api)

---

## 9. Proposed timestamp-based six-hour trend calculation

This replaces the legacy "6 points ≈ 6 hours" assumption (`river.php:2037-2056`, §3, §4a) with a calculation anchored to actual elapsed time, using the full-resolution valid observed series — **not** the chart's downsampled series. This is a proposal for the next implementation step, not code written against the app.

**Inputs:** the full array of valid observed readings for a given field (stage, flow, or derived current), each with a real `validTime` and a value, sorted ascending, with sentinel/missing entries already excluded (§4e's existing filtering approach carries forward). "Full valid data" here explicitly means _before_ any chart-oriented downsampling or bucketing is applied — per this round's instruction, downsampling is reserved for chart display only, and headline statistics (the hero-card trend badges) should be computed against this full-resolution series directly.

**Algorithm:**

1. Let `latest` = the last entry in the series (most recent valid `validTime`).
2. Compute `target = latest.validTime − 6 hours`.
3. Search the series for the entry whose `validTime` is closest to `target`, among entries at or before `latest.validTime`.
4. Accept that entry as the trend anchor **only if it falls within a tolerance window** around `target` — e.g., ±30 minutes (twice the confirmed 15-minute native interval, giving headroom for the kind of gap actually observed live in §8.1 without accepting a point so far away it misrepresents "6 hours"). This tolerance should be a named, documented constant, not implicit.
5. **If no entry falls within tolerance** (either because the series doesn't yet span 6 hours — insufficient history — or because a data gap like the observed 135-minute one straddles the target on both sides), the trend is **unavailable**: return/display nothing (or an explicit "insufficient data" state), rather than silently substituting a more-distant point and still labeling it "6h." This is the key behavioral change from the legacy code, which always computed _something_ from whatever 6 points happened to be in its downsampled array, regardless of the actual time span they covered.
6. If an anchor point is found within tolerance, compute the **actual elapsed time** between `anchor.validTime` and `latest.validTime` (not assumed to be exactly 6.0 hours), and the value delta (`latest.value − anchor.value`).
7. Label the trend with the **actual elapsed hours, rounded** (e.g., "+0.4 ft / 5.8h" rather than a hardcoded "/6h") — this is more honest than the legacy display and costs nothing extra, since the real timestamps are already in hand. If the true elapsed time is close enough to 6h (e.g., within tolerance), a simplified "/6h" label is reasonable; if a future design wants the simplified label always, that's a presentation choice to make explicitly, not an accuracy claim to imply silently.
8. Direction (rising/falling/steady) is then derived from the sign and magnitude of the delta exactly as the legacy code does (a small dead-band around zero to avoid noise triggering a direction flip) — that comparison logic itself isn't broken, only the time-anchoring beneath it.

**Edge cases explicitly handled by the steps above:**

- **Insufficient history** (e.g., app cold-start, or a cache/window that doesn't yet span 6 hours): no candidate anchor exists at or before `target` at all → unavailable, not a shorter-window trend mislabeled as 6h.
- **Missing reading near the 6-hour target** (a gap straddling `target`, as actually observed in §8.1): nearest-within-tolerance handles small gaps gracefully; a gap larger than the tolerance on both sides correctly produces "unavailable" rather than reaching further back or forward and quietly changing what "6h" means.
- **Tie-break**: if two candidates are equidistant from `target`, prefer the one at-or-before `target` (chronologically earlier) for determinism.
- **Duplicate/out-of-order timestamps**: not observed live (§8.1 confirmed strictly ascending, unique timestamps for this gauge/window), but a defensive implementation should still sort and de-duplicate defensively before applying this algorithm, since that behavior is not a documented guarantee (§8.4).

**Architectural note tying back to the instruction to "calculate headline statistics from the full valid data; reserve downsampling for chart display":** this implies two separate data paths from the same fetched series — (1) the full valid series, used for hero-card current values and this trend calculation, and (2) a separately-downsampled or resampled series, used only to keep the chart visually readable/performant. The legacy code conflated these into one (`river.php:190-203` downsamples once, and both the chart _and_ the trend function consume that same reduced array) — that conflation is itself part of why the "6h" label was never actually validated against real timestamps. Decoupling them is a data-layer design decision for the next planning step, not implemented here.

---

## 10. Flood-status decision and observed/status timestamp sync (decided 2026-09-09)

**Decision, recorded per owner direction:** use NOAA's reported observed flood category (`status.observed.floodCategory`, §8.3) for the stage status label, and use NOAA's named `action`/`minor`/`moderate`/`major` thresholds (`flood.categories`, §8.3) for the stage bar and reference labels — four tiers, not three. Remove reliance on the legacy hardcoded fallback thresholds (38/52/62 ft) and the positional-index lookup entirely.

### 10.1 How does NOAA's reported status relate to the latest stage observation?

Checked with two independent live metadata fetches, ~3.5 hours apart:

| Fetch time (UTC) | `status.observed.validTime` | `status.observed` value | Latest raw `stageflow/observed` point at that moment |
|---|---|---|---|
| 2026-09-08 ~20:47 | `2026-09-08T20:00:00Z` | 26.75 ft / 57.3 kcfs | *(not independently re-checked at this exact moment)* |
| 2026-09-09 ~00:15 | `2026-09-08T23:00:00Z` | 26.71 ft / 56.4 kcfs | `2026-09-08T23:00:00Z`, 26.71 ft / 56.4 kcfs — **exact match** |

At the second check, `status.observed` matched the raw observed feed's latest point exactly — same timestamp, same values. **But that raw feed's own latest point was itself already ~75 minutes old relative to the 00:15 fetch time** (last 15-minute reading available was for 23:00, with no 23:15/23:30/23:45/00:00 readings yet present) — a real staleness event caught live, not a hypothetical. This is the key finding: **`status.observed` doesn't appear to lag behind the raw feed independently — it mirrors whatever the raw feed's latest point is — but the raw feed itself can and does lag behind wall-clock "now" by more than an hour**, for reasons outside this API's control surface (upstream telemetry/processing delay). A client cannot infer "data is current" merely from `status.observed` being present and non-null.

### 10.2 Handling missing, unknown, stale, or conflicting status

The OpenAPI spec (`swagger.json`, `GaugeStatusObserved`/`GaugeStatusForecast` definitions) types `floodCategory` as a plain **`string`**, with no enum constraint — NOAA does not contractually guarantee a closed set of values (today's live value was `"no_flooding"`; the legacy UI's own categories were `Normal`/`Action`/`Flood`/`Major flood`, a different vocabulary already).

- **Missing**: if the `status` object or `status.observed` is absent from a response, show an explicit "status unavailable" state — never default to a normal-looking display.
- **Unknown/unrecognized value**: if `floodCategory` holds a string the UI doesn't have a mapping for (a plausible future NOAA change, since the field is unconstrained), display it plainly (or a generic "status: `<value>`") rather than silently falling back to "Normal."
- **Stale (decided, §13):** independently compute `now − status.observed.validTime` and compare it against the approved 60-minute threshold. A stale reading is **not hidden** — it stays visible with its own timestamp and a "Stale" label — but it must **never be presented as an unqualified, current-looking "Normal"** (or `no_flooding`). A stale "all clear" is the one failure mode here with real safety weight, which is why this rule is stated explicitly rather than left to the general staleness policy alone.
- **Unknown freshness**: if `status.observed.validTime` is missing or fails to parse, age cannot be computed at all — this is a distinct state from both "fresh" and "stale." Disclose that freshness is unknown explicitly; never default to treating an un-timestamped reading as current.
- **Conflicting/asynchronous**: do not assume `status.observed`, `status.forecast`, and the raw `stageflow` endpoints update in lockstep just because they matched in this session's two-sample check — compute and display staleness for each independently, since nothing in the spec guarantees they're produced by the same pipeline run.

See §13 for the full cross-feature freshness policy (thresholds, the fresh/stale/unavailable/unknown state model, and why these are product settings rather than agency standards).

**Sources:** [NOAA NWPS — CCNO1 metadata](https://api.water.noaa.gov/nwps/v1/gauges/CCNO1) (two live fetches, 2026-09-08 ~20:47 UTC and 2026-09-09 ~00:15 UTC), [NOAA NWPS — CCNO1 observed](https://api.water.noaa.gov/nwps/v1/gauges/CCNO1/stageflow/observed) (live fetch, 2026-09-09 ~00:15 UTC), [NWPS OpenAPI spec](https://api.water.noaa.gov/nwps/v1/docs/swagger.json).

---

## 11. River-current estimate: comparison against official USGS/NWS sources (2026-09-08/09)

### 11.1 Does CCNO1 provide a velocity measurement or estimate directly?

**Not through the NWPS API itself.** The full OpenAPI spec was read end-to-end (all paths: `/gauges`, `/gauges/{id}`, `/gauges/{id}/ratings`, `/gauges/{id}/stageflow`, `/gauges/{id}/stageflow/{product}`, `/monitor`, `/products/stageflow/{id}/{pedts}`, `/reaches/{id}`, `/reaches/{id}/streamflow`) — none expose a velocity field. `stageflow` carries only stage + flow; `ratings` is a stage-to-flow lookup table with no area/velocity column; `reaches/streamflow` (National Water Model output) carries only `flow`.

**But yes, via a different official source.** NOAA's own CCNO1 metadata links this gauge to USGS site **03255000** ("Ohio River at Cincinnati" — the mainstem itself, not the Licking River tributary used for temperature, §8.3). That USGS site's own parameter catalog (retrieved live) shows it has reported, continuously since **2024-10-16**:
- **`72255` — "Mean water velocity for discharge computation, feet per second"**
- `72254` — "Water velocity reading from field sensor, feet per second" (the raw index-sensor reading `72255` is rated from)
- `00060` (discharge) computed via an **"Index Velocity Rating"** — i.e., this site now measures velocity directly and derives discharge from it, rather than the other way around.

A live sample (retrieved 2026-09-09 ~00:20 UTC, `waterservices.usgs.gov/nwis/iv/?sites=03255000&parameterCd=00060,72254,72255,00065&period=P1D`) confirmed real, current values, e.g. `72255 = 1.34 ft/s` at `2026-09-08T20:00:00-04:00`, paired with `00060 = 46000 cfs` and `00065 (gage height) = 26.75 ft` at the same instant.

The index-velocity method itself is a standard, documented USGS technique (an index sensor's reading is converted to a cross-sectional mean velocity via a rating equation, periodically calibrated against field cross-section measurements) — it is not a raw instantaneous measurement across the whole channel at every timestep, but it is official, live, and — critically — already stage-aware, since the rating is built from real surveyed cross-sections at varying stage, unlike a single fixed area constant.

### 11.2 Is there documented support for the legacy 36,000 ft² / "calibrated to NWS bulletin" claim?

**A real bulletin exists.** NWS's Ohio River Forecast Center (Wilmington, OH) issues a text product, **"River Flow and Velocity Forecasts" (RVF)**, that explicitly lists a row for **`CCNO1`** with flow (kcfs) and velocity (mph) for a 4-day outlook. Retrieved live, issued 11:00 AM EDT Tuesday, September 08, 2026:

```
Ohio River...
  Cincinnati                 62.5  1.3    52.8  1.1    47.3  1.0    41.5  0.9
```
(columns: Sep 08 Flow/Vel, Sep 09 Flow/Vel, Sep 10 Flow/Vel, Sep 11 Flow/Vel — "All values are instantaneous model-simulated projections at 7am EST or 8am EDT. Flows are units of kCFS. Velocity units are mph.")

**But the legacy 36,000 ft² constant does not reproduce this bulletin's numbers.** Back-solving the bulletin's own flow/velocity pairs for an implied channel area (`area = flow_cfs ÷ (velocity_mph ÷ 0.681818)`):

| Date | Flow (kcfs) | NWS velocity (mph) | Implied area (ft²) | Legacy formula's velocity (mph) | Legacy vs. NWS |
|---|---|---|---|---|---|
| Sep 08 | 62.5 | 1.3 | 32,779 | 1.18 | −9.1% |
| Sep 09 | 52.8 | 1.1 | 32,730 | 1.00 | −9.1% |
| Sep 10 | 47.3 | 1.0 | 32,258 | 0.90 | −10.4% |
| Sep 11 | 41.5 | 0.9 | 31,439 | 0.79 | −12.7% |

The NWS bulletin's own numbers imply an effective area of **~31,400–32,800 ft²**, not 36,000 — and the legacy formula, using its fixed constant, comes out **9–13% lower** than the NWS's own published velocity at the exact same flows, for the exact same gauge, on the exact same day. This is independently corroborated by the USGS live measurement (§11.1): back-solving `area = 00060 ÷ 72255` from paired live readings at the current stage (~26.7 ft) gave **~34,000–34,300 ft²** — a different figure from the RVF-implied value, but *also* below 36,000.

**Conclusion: the "calibrated to NWS bulletin" claim is not supported by the bulletin as it exists today.** Both independent official sources (USGS live measurement and the NWS forecast bulletin) put the effective area meaningfully below the legacy constant, at the specific stage/flows checked. Neither the RVF bulletin nor the USGS site documents its own area value as a stated constant (RVF's page text includes no explanation of how it computes velocity from flow); both figures above are *back-solved*, not directly published. No live data at flood-stage flows was available in this session to check the high-stage end directly — but since a river's true cross-sectional area necessarily grows with depth, and the fixed 36,000 ft² constant already sits above the true area at low/normal stage, the same fixed constant would be expected to increasingly *overestimate* velocity as stage rises toward flood levels (dividing the same growing flow by a constant that no longer grows with it). That direction follows from the confirmed low-stage bias plus basic channel hydraulics; it was not independently measured at high stage in this round.

**Qualification on precision:** the RVF bulletin publishes flow to one decimal kcfs and velocity to one decimal mph — both already rounded before this document back-solved an implied area from them. The "−9.1%" to "−12.7%" figures above and the "~31,400–32,800 ft²" range are order-of-magnitude comparisons against rounded published values, not a precise measurement of the legacy formula's error, and they should not be read as validating any specific replacement constant. They establish direction and rough scale (the legacy constant is too large, by roughly a tenth) — not a precise figure to hardcode in its place.

### 11.3 Average cross-sectional velocity vs. "mid-channel current"

The legacy formula computes `flow ÷ (fixed area)` — by definition (`Q = A × V_mean`), this is a **cross-sectionally averaged velocity**, not a location-specific reading. The UI's own sub-label, *"Mid-channel · NOAA flow model"* (`river.php:1708`), was never an accurate description of what the number represents — this is true independent of whether the area constant itself is correct.

General open-channel hydraulics (not CCNO1-specific — flagged explicitly as domain knowledge, not a measured local ratio) documents a **velocity index** `k = (depth-averaged/mean velocity) ÷ (surface or index velocity)`, with USGS's own index-velocity-method literature citing a standard laboratory-derived value of **k ≈ 0.85**, while also noting this ratio varies with flow, stage, and channel bathymetry rather than being a fixed universal constant. In plain terms: a true mid-channel/near-surface reading is typically *higher* than the cross-sectional mean by a comparable margin — the opposite direction from what the "Mid-channel" label implies the app is showing (a mean, not a mid-channel peak).

**Sources:** [USGS TM 3-A23, "Computing Discharge Using the Index Velocity Method"](https://pubs.usgs.gov/tm/3a23/pdf/tm3-a23.pdf), [USGS — Index Velocity (hydroacoustics)](https://www.usgs.gov/hydroacoustics/index-velocity).

### 11.4 Options and recommendation

The existing estimate is not well-supported as currently labeled — it's the right order of magnitude but measurably biased low relative to both independent official sources, and its "mid-channel" description doesn't match what a flow-over-area calculation actually produces. Options, presented for the owner to choose among (not decided here):

1. **Keep the derived approach, correct it.** Replace 36,000 ft² with a value grounded in the evidence above (~32,000–34,000 ft², itself only an approximation at the specific stage/flows checked, not a validated all-stage constant), drop the unsubstantiated "calibrated to NWS bulletin" caption, and relabel it as a rough, cross-sectional-average estimate rather than "mid-channel." Cheapest change; still doesn't account for how area changes with stage.
2. **Source "now" values from USGS `72255`** (mean channel velocity, site 03255000) directly. Official, live, updates on the same ~15-minute cadence as stage, and — because it comes from a periodically-recalibrated index-velocity rating — inherently adjusts for changing channel geometry as stage changes, unlike a fixed constant. Only available from 2024-10-16 forward (irrelevant for a live "now" display; only matters if historical backfill before that date is wanted).
3. **Source forecast/outlook values from the NWS RVF bulletin's `CCNO1` row.** Official, purpose-built for exactly this boater-speed use case, but delivered as a fixed-width text product (not JSON) with a once-daily 4-day-ahead snapshot at a fixed 7–8 AM reference time — a different shape and granularity than the continuous stage/flow series used elsewhere on the page, and would need its own text-parsing logic.

Options 2 and 3 aren't mutually exclusive — 2 for the "now" hero value, 3 for a forward-looking outlook — and together they resolve both the accuracy gap and the mid-channel mislabeling without inventing a new constant. That combination is the stronger direction, but it's the owner's call: it adds two new external dependencies (a USGS instantaneous-values fetch, a NWS text-product fetch/parse) with different reliability and parsing characteristics than the JSON APIs used elsewhere on the page. **Omitting the current-speed feature entirely** remains a valid fallback if that added complexity isn't worth a single hero-card stat — noted, but not the default recommendation given how directly options 2/3 resolve the problems found.

**Sources:** [USGS 03255000 parameter catalog](https://waterservices.usgs.gov/nwis/site/?sites=03255000&seriesCatalogOutput=true&format=rdb), [USGS 03255000 instantaneous values](https://waterservices.usgs.gov/nwis/iv/?sites=03255000&parameterCd=00060,72254,72255,00065&period=P1D&format=json) (retrieved 2026-09-09 ~00:20 UTC), [USGS 03255000 current conditions page](https://waterdata.usgs.gov/nwis/uv?site_no=03255000), [NWS Ohio River Forecast Center — River Flow and Velocity Forecasts](https://forecast.weather.gov/product.php?site=NWS&issuedby=TIR&product=RVF) (retrieved 2026-09-09, issuance timestamped 11:00 AM EDT Tuesday, September 08, 2026).

### 11.5 Approved scope for v1 (decided 2026-09-09)

Option 2 from §11.4 is approved, with the following specifics:

- **Source**: USGS site **03255000**, parameter **`72255`** ("Mean water velocity for discharge computation") — confirmed unit `ft/sec` directly from the live API response, not assumed. Convert to mph using the same verified factor used elsewhere in this document: `mph = ft/s × 0.681818`.
- **Coverage**: latest value plus available five-day history. Verified live: a `period=P5D` request against this exact site/parameter returns cleanly — 477 points, a clean 15-minute cadence (476 of 476 gaps measured at exactly 15 minutes, no irregularities in this particular window), all qualified `P` (provisional, USGS's standard real-time-data qualifier, not itself a defect).
- **Label**: "Mean river velocity," shown with its source (USGS 03255000) and observation time — not "Current" or "mid-channel," since §11.3 established the value is a cross-sectional average, not a location-specific reading.
- **Staleness / missing data (decided, §13)**: stale after **60 minutes** past the observation's own timestamp (not fetch time) — the reading stays visible with its timestamp and a "Stale" label, not hidden. **"Unavailable"** only when no valid reading exists at all (fetch failure, or every candidate value filtered out) — never as a stand-in for a merely-stale-but-present value. If the timestamp itself is missing or unparseable, freshness is unknown and must be disclosed as such, not treated as fresh. **Do not substitute the fixed-area estimate** as a fallback under any of these conditions — that estimate is confirmed unsupported (§11.2), not merely deprioritized.
- **No velocity forecast in v1.** Stage and flow keep their existing NOAA forecast display (§8.2); current-speed shows observed/historical values only for now. The NWS RVF bulletin (§11.2) remains a documented option for a future forecast addition, not part of this scope.
- **Methodology description**: the UI/documentation should describe this value as *computed from a field sensor reading via a periodically-calibrated index-velocity rating* (§11.1) — not as a direct measurement across the entire channel cross-section at every instant. This is an accurate, if less simple, description of what USGS's index-velocity method actually produces, and avoids overstating the value's precision.

---

## 12. Water-temperature source verification (2026-09-09, re-verified with fresh instantaneous data)

Investigated per instruction, using only public USGS sources. This section was revised after a follow-up check: the first pass misread a catalog field (see the correction in §12.2) and drew a speculative conclusion the evidence didn't support (removed below). None of the findings change the "keep water-temperature validity unresolved" status from prior rounds on their own — they inform, but do not substitute for, the owner's decision in §12.4.

**A note on data types, since the catalog and the live feed answer different questions:** USGS distinguishes **instantaneous values ("uv")** — the near-real-time feed (5–15 minute cadence here) a "current reading" feature would use — from **daily values ("dv")** — a separate, pre-computed daily statistic (e.g., daily max/min/mean), useful for historical trend charts but not a live "now" reading. Both sites below have both types on file for temperature; everything in this section concerns the "uv" (instantaneous) feed specifically, freshly queried, not the "dv" archive.

### 12.1 Does Ohio River site 03255000 provide current water temperature?

**No.** Re-confirmed against the same full parameter catalog used in §11.1: the complete historical parameter list for this site is gage height (`00065`), discharge (`00060`, via index-velocity rating), velocity (`72254`/`72255`), and a handful of 1940s-era water-quality/discharge/sediment samples, all ending 1945. **Parameters `00010` and `00011` have never been recorded at this site, instantaneous or daily**, in any period covered by USGS's catalog.

### 12.2 What does legacy site 03254520 actually report? (correction from the prior pass)

Confirmed identity (live site-info fetch): **"LICKING RIVER AT HWY 536 NEAR ALEXANDRIA, KY"** — a tributary, not the Ohio River, consistent with the legacy code's own UI label (§2).

**Correction:** the prior pass reported `00011`'s catalog count (120) as "120 instantaneous values" and treated that as evidence of a sparse, barely-populated record. That was a misreading of the catalog field. Checked directly: the site catalog's `count_nu` field, for "uv" rows, is the **number of calendar days spanned by the record**, not the number of individual readings — confirmed by comparing four such rows' stated date ranges against their `count_nu`:

| Site / parameter | Catalog range | Calendar days in range | Catalog `count_nu` |
|---|---|---|---|
| 03254520 `00010` (uv) | 2007-10-01 → 2026-09-08 | 6,918 | 6,917 |
| 03254520 `00011` (uv) | 2026-05-11 → 2026-09-08 | 121 | 120 |
| 03277200 `00010` (uv) | 2011-02-12 → 2026-09-08 | 5,688 | 5,687 |
| 03277200 `00010` (uv, alt.) | 2011-02-10 → 2026-09-08 | 5,690 | 5,689 |

All four match the day-span almost exactly (off by one from an inclusive/exclusive boundary convention). **So "120 records" means 120 calendar days of record — not 120 readings.** A fresh instantaneous-data pull for the last 5 days confirms `00011` is reporting at a complete 15-minute cadence during that window (475 readings across 5 days, essentially matching `00010`'s 477 in the same window) — it is not sparse or intermittent since it started; it is simply **new**, starting 2026-05-11, versus `00010`'s ~19-year record at the same site.

**What remains true, and what was removed:** the one confirmed fact is that parameter `00011` — the exact parameter the legacy code requests (`river.php:93`) — did not exist at this site before 2026-05-11. **The prior pass's further claim — that the legacy app's "measured" temperature path was "likely" non-functional for most of its operational history — is withdrawn.** There is no evidence here of the app's actual deployment date, and nothing about the corrected record shows unreliability; that inference wasn't supportable and shouldn't have been stated as anything more than a labeled guess. What can be said: **if** the app was already running before mid-May 2026, `parameterCd=00011` requests before that date would have returned no data and the fallback would have run instead — a conditional fact about the parameter's availability window, not a claim about what the app actually did.

**Fresh live verification, both parameters, retrieved 2026-09-09 ~00:59 UTC (2026-09-08 ~20:59 EDT):**

| | `00010` (°C) | `00011` (°F) |
|---|---|---|
| Latest valid reading | 27.4°C | 81.3°F |
| Timestamp | 2026-09-08T20:00:00 EDT | 2026-09-08T19:30:00 EDT |
| Age at retrieval | ~60 minutes | ~90 minutes |
| Qualifier | `P` (provisional) | `P` (provisional) |
| Recent gaps (5-day window) | None — clean 15-minute cadence throughout | None — clean 15-minute cadence throughout |

Both parameters are current and gap-free over the checked window, but neither is as fresh as Markland's feed below — the most recent readings available at retrieval time were 60–90 minutes old, consistent with the transmission-lag pattern already seen on this same river system in §10.1 (a real characteristic of these telemetered gauges, not a data quality problem specific to temperature).

### 12.3 A nearby mainstem alternative — freshly re-verified

**USGS 03277200, "Ohio River at Markland Dam near Warsaw, KY"** — a genuine Ohio River mainstem site, confirmed both by its name and by the NWS RVF bulletin's downstream ordering (§11.2), which lists "Markland Dam" immediately after "Cincinnati." Fresh live check, 2026-09-09 ~00:59 UTC:

- **Latest valid reading: 27.2°C, at 2026-09-08T20:50:00 EDT — only ~10 minutes old at retrieval.** Qualifier `P` (provisional).
- **Cadence: 5 minutes** (not 15) — 1,435 readings across the checked 5-day window, with exactly **one gap** (a single 25-minute span on 2026-09-04, versus the expected 5 minutes — one missed reading cycle, otherwise complete).
- Instantaneous (`uv`) record for `00010` runs continuously since 2011-02-10/12 (~15.5 years); a separate daily-values (`dv`) product also exists at this site (not used for "current" purposes).
- **Location, explicitly not Cincinnati:** straight-line distance from the Cincinnati gauge is **~33 miles, south-southwest — downstream**. Actual river-channel distance is longer, since the river meanders; that channel distance wasn't independently measured here. If adopted, this must be surfaced as **"Ohio River at Markland Dam"** (or equivalent explicit location label) — not as a generic "Ohio River" or Cincinnati reading, and not silently substituted in place of the tributary source without that distinction being visible in the UI.
- This was the first suitable candidate found via a bounded, non-exhaustive search — a closer Ohio River mainstem site may exist; a fuller search wasn't performed given this round's scope.

**On current availability, Markland is now the stronger candidate of the two by data freshness and completeness**: 10-minute-old data on a 5-minute cadence with one small gap in 5 days, versus 60–90-minute-old data on a 15-minute cadence (also gap-free) at the Licking River site. Both are live and working; Markland is simply fresher and more frequent at the moment checked. Freshness alone doesn't resolve the location trade-off in §12.4 — it only confirms both options are genuinely available today, not just theoretically.

### 12.4 Recommendation

Per instruction, the air-temperature-derived fallback formula (`0.95 × air_c + 1.0`, §3) should not be retained — it is an unsourced approximation, and both remaining options are now confirmed live and currently reporting. This is a location/identity choice for the owner, not a data-availability question — both sources work right now:

1. **USGS 03277200 (Markland Dam), parameter `00010`.** A real, currently fresh (~10 min old at last check) Ohio River mainstem measurement, continuously available since 2011 — but ~33 straight-line miles downstream of Cincinnati. Must be explicitly labeled "Ohio River at Markland Dam," not presented as a Cincinnati reading.
2. **USGS 03254520 (Licking River), parameter `00010`** — the site's real 19-year record (not the short-history `00011` the legacy code currently requests, per the corrected §12.2). Currently reporting, ~60 minutes old at last check, gap-free. Closer to Cincinnati geographically, but still an explicitly-labeled tributary, not the Ohio River itself.
3. **"Unavailable."** If neither a downstream mainstem reading nor a nearby tributary reading is an acceptable substitute for a true Cincinnati Ohio River measurement, show "Unavailable" rather than reintroducing any derived or estimated value — consistent with the same missing-data principle applied to current-speed in §11.5.

**Sources:** [USGS 03255000 parameter catalog](https://waterservices.usgs.gov/nwis/site/?sites=03255000&seriesCatalogOutput=true&format=rdb), [USGS 03254520 site info](https://waterservices.usgs.gov/nwis/site/?sites=03254520&format=rdb), [USGS 03254520 parameter catalog](https://waterservices.usgs.gov/nwis/site/?sites=03254520&seriesCatalogOutput=true&format=rdb), [USGS 03254520 5-day instantaneous values](https://waterservices.usgs.gov/nwis/iv/?sites=03254520&parameterCd=00010,00011&period=P5D&format=json) (retrieved 2026-09-09 ~00:59 UTC), [USGS site search — mainstem candidates](https://waterservices.usgs.gov/nwis/site/?format=rdb&bBox=-85.3,38.6,-84.2,39.3&parameterCd=00010&siteType=ST&hasDataTypeCd=iv), [USGS 03277200 parameter catalog](https://waterservices.usgs.gov/nwis/site/?sites=03277200&seriesCatalogOutput=true&format=rdb), [USGS 03277200 5-day instantaneous values](https://waterservices.usgs.gov/nwis/iv/?sites=03277200&parameterCd=00010&period=P5D&format=json) (retrieved 2026-09-09 ~00:59 UTC).

### 12.5 Approved decision for v1 (decided 2026-09-09)

**Decision, recorded per owner direction:** option 2 from §12.4 is approved — **USGS 03254520 (Licking River), parameter `00010`** (°C), not option 1 (Markland Dam). Markland was documented above as a genuine, currently-fresher Ohio River mainstem alternative (§12.3), and was briefly under consideration in this session before the owner's direction settled on the Licking River source instead; it remains recorded here as the alternative that was evaluated and not chosen for v1, not as an error to strike out. **Rationale, per owner:** the Licking River site was chosen for its proximity to Cincinnati (~33 straight-line miles closer than Markland Dam, §12.3) — a deliberate trade of geographic closeness against river identity, which is exactly why the explicit tributary disclosure below is required rather than optional.

- **Source**: USGS site **03254520**, parameter **`00010`** ("Temperature, water," confirmed unit `deg C` directly from the live API response) — not the site's `00011` (°F) parameter, whose short history (since 2026-05-11) was the reason to prefer `00010` in the first place (§12.2).
- **Display unit**: convert to °F for display using the exact conversion, `°F = °C × 9/5 + 32` (the same formula already used elsewhere in the legacy code and this document, not an approximation).
- **Label**: **"Water temperature · Licking River"**, shown with observation time — and an explicit, visible statement that this is a **nearby tributary reading, not an Ohio River mainstem measurement** (the Licking River joins the Ohio a short distance from the Cincinnati gauge, but is a distinct waterway — the same distinction already established for this site throughout §2, §3, and §12).
- **Staleness / missing data (decided, §13)**: stale after **2 hours** past the observation's own timestamp (not fetch time) — a longer threshold than stage/flood-status/velocity's 60 minutes, reflecting that water temperature changes slowly and this feed's own live-checked lag (60–90 minutes after timestamp, §12.2) already consumes a large share of a 60-minute window. The reading stays visible with its timestamp and a "Stale" label, not hidden. **"Unavailable"** only when no valid reading exists at all — **no automatic substitution** from USGS 03277200 (Markland) and no reintroduction of the air-temperature-derived fallback formula, under any of these conditions. If the timestamp itself is missing or unparseable, freshness is unknown and must be disclosed as such, not treated as fresh.

---

## 13. Approved freshness/staleness policy for v1 (decided 2026-09-09)

This section consolidates the freshness rules referenced individually in §10.2, §11.5, and §12.5 into one cross-feature policy, and reconciles earlier wording in this document that described "stale" and "Unavailable" as though they were the same outcome (they are not — see the state model below).

**Scope:** this policy governs the four **observed** live-data features approved elsewhere in this document — stage/flow (§8.1), observed flood status (§10), mean river velocity (§11.5), and water temperature (§12.5). **It does not apply to forecasts.** The stage/flow forecast series (§8.2) and any future velocity/temperature forecast are explicitly out of scope here; forecast freshness (e.g., how old a forecast's `issuedTime` can be before it's flagged as outdated) is a separate, still-unresolved question — see §7.

**Thresholds:**

- Stage, observed flood status, and mean river velocity: **stale when the observation is more than 60 minutes old.**
- Water temperature: **stale when the observation is more than 2 hours old.**

**These are product settings, not agency standards.** Neither NOAA nor USGS states a data-quality or update-guarantee number anywhere in their documentation (confirmed absent from the NWPS OpenAPI spec, §8.4, and from USGS's own catalog metadata, §12.2) — these thresholds were chosen for this app, informed by (but not dictated by) the live lag behavior observed during this investigation (stage/status ~75 minutes once, §10.1; temperature 60–90 minutes, §12.2).

**Age is computed from the observation's own timestamp** — NOAA's `validTime`, or USGS's `dateTime` — **never from fetch time**. A value that was slow to arrive over the network is not stale merely because the request took time; a value that arrived instantly but describes an old reading is.

**Four distinct states — this is the correction to earlier wording:**

1. **Fresh** — a valid reading exists and its age is within the applicable threshold.
2. **Stale** — a valid reading exists, but its age exceeds the threshold. **The last valid value stays visible**, shown with its own observation timestamp and a clear **"Stale"** label. It is never hidden and never replaced by "Unavailable" — those two outcomes are distinct, and several earlier passages in this document (§6, §11.5, §12.5, prior to this section) used phrasing like "stale/missing" or "on stale/missing data" that read as though a stale value disappears the same way a missing one does. That was a wording problem, not an intended behavior change — the intended behavior, confirmed here, has always been: stale values are shown and labeled, not hidden.
3. **Unavailable** — no valid reading exists at all: the fetch failed, or every candidate value was filtered out as missing or a sentinel (§4e). This is the only state that withholds the value entirely.
4. **Unknown freshness** — the observation timestamp itself is missing or fails to parse, so age cannot be computed. This is not the same as "fresh": a reading with no usable timestamp must never be presented as current by default. Disclose that freshness is unknown explicitly.

**Flood status carries one additional rule, stated explicitly because of its safety weight (§10.2):** never present a stale flood-status reading as an unqualified, current-looking "Normal" (or `no_flooding`) — a stale "all clear" is more dangerous to get wrong than a stale number. If flood status's own timestamp can't be established, disclose unknown freshness rather than defaulting to a normal-looking display.

**Amended 2026-09-14:** the visible **"Stale"** text label described above was later removed from the UI (owner decision — every stale-eligible reading already shows its own observation timestamp, making the badge redundant), including for flood status, which relaxes the safety rule in the paragraph just above. The state model, thresholds, and "stale values stay visible" behavior are otherwise unchanged. See `docs/river-v1-spec.md` §7 for the current, authoritative wording.

---

## Summary

The legacy page is a single PHP script that blocking-fetches ~11 external endpoints per page load (4 for river, 7 for weather) into a session-scoped cache, then renders a tabbed UI from the results. Across three rounds of live investigation, nearly every core numeric assumption in the legacy code failed to hold up against official live sources: the native observed-data interval is 15 minutes (not the ~22.5 minutes the "6-point/6-hour" trend implicitly assumed); the live forecast horizon checked was under 5 days (validating the "never fabricate a shorter forecast" decision); NOAA's flood-category data is a named four-category object the legacy code's positional lookup cannot parse at all, so the app was very likely always silently using its hardcoded, measurably-wrong fallback thresholds (now replaced with NOAA's own computed status field and named thresholds, §10); the current-speed estimate's fixed 36,000 ft² channel area and its "calibrated to NWS bulletin" claim are not supported by either the USGS's own live velocity measurement at the same gauge or the NWS Ohio River Forecast Center's own published bulletin for this exact station — both approved to be replaced with USGS's directly-measured mean river velocity, no forecast, no fixed-area fallback (§11.5); and the water-temperature source has a real gap — the mainstem gauge has no temperature parameter at all, and the legacy code's specific tributary-site parameter has existed for only about four months, though a follow-up check confirmed that parameter is fully populated (not sparse) since it started (§12) — resolved by adopting the tributary site's real 19-year parameter instead, explicitly labeled as a tributary reading rather than a mainstem measurement (§12.5), over a genuine but ~33-miles-downstream Ohio River mainstem alternative that was evaluated and not chosen. None of the interval/horizon/staleness behavior is a documented API guarantee anywhere in NOAA's specification, so all of it should be designed around defensively, not hardcoded.

All four foundational data-source decisions from this investigation — forecast window, flood status, current-speed source, and water-temperature source — are now made, and a cross-feature freshness policy is approved on top of them (§13): 60 minutes for stage/flood-status/velocity, 2 hours for water temperature, both computed from observation timestamp rather than fetch time, with stale values kept visible and labeled rather than hidden, "Unavailable" reserved for when no valid reading exists at all, and a fourth "unknown freshness" state for a missing or unparseable timestamp. All of this is now consolidated in `docs/river-v1-spec.md`.

The single most important remaining item: **forecast freshness is explicitly not covered by §13's policy and remains unresolved** — nothing in this investigation specifies how old a NOAA forecast's `issuedTime` may be before it should be flagged as outdated, or whether it should be at all (§7). Two smaller items also remain open and are worth keeping distinct from each other and from §13: the ±30-minute tolerance window used to anchor the timestamp-based six-hour trend (§9, a different concept from observation staleness) and whether the OpenWeatherMap dependency should be dropped entirely now that neither current-speed nor water-temperature needs it (§7). Everything else foundational is decided.
