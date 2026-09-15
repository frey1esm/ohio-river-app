"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatFloodCategory,
  formatObservedTime,
  formatObservedTimeShort,
  formatTrend,
  floodStatusColor,
} from "@/lib/format";
import { computeSixHourTrend } from "@/lib/trend";
import type { FloodThresholds, RiverData } from "@/lib/types";
import { reviveRiverData, type RiverDataWire } from "@/lib/wire";
import FreshnessBadge from "./FreshnessBadge";
import InfoPopover from "./InfoPopover";
import RiverChart, { type ChartMode } from "./RiverChart";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const EMPTY_THRESHOLDS: FloodThresholds = { action: null, minor: null, moderate: null, major: null };

function ThermometerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={spinning ? "spin" : ""}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 4v6h-6" />
    </svg>
  );
}

export default function RiverDashboard({ initialData }: { initialData: RiverData }) {
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [chartMode, setChartMode] = useState<ChartMode>("stage");
  const chartSectionRef = useRef<HTMLDivElement>(null);

  const showTemperatureChart = useCallback(() => {
    setChartMode("temp");
    chartSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/river", { cache: "no-store" });
      if (res.ok) {
        const wire = (await res.json()) as RiverDataWire;
        setData(reviveRiverData(wire));
      }
      // A non-OK response or thrown error simply keeps the last known good
      // data on screen — a failed refresh must never blank the page.
    } catch {
      // Network error: keep showing the last successful data.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { stage, velocity, temperature, velocityForecast } = data;

  const stageObserved = stage.ok ? stage.data.observed : [];
  const stageForecast = stage.ok ? stage.data.forecast : [];
  const thresholds = stage.ok ? stage.data.thresholds : EMPTY_THRESHOLDS;
  const velocityHistory = velocity.ok ? velocity.data.history : [];

  const latestStage = stageObserved.length > 0 ? stageObserved[stageObserved.length - 1] : null;
  const stageTrend = computeSixHourTrend(
    stageObserved.filter((p) => p.stage !== null).map((p) => ({ time: p.time, value: p.stage as number })),
    0.03,
  );
  const velocityLatest = velocity.ok ? velocity.data.latest : null;
  const velocityTrend = computeSixHourTrend(
    velocityHistory.map((p) => ({ time: p.time, value: p.mph })),
    0.05,
  );

  const temperatureLatest = temperature.ok ? temperature.data.latest : null;
  const temperatureHistory = temperature.ok ? temperature.data.history : [];

  const tempReadingText = temperatureLatest ? `${temperatureLatest.value.toFixed(1)}°F` : "—°F";
  const tempNeedsWarning = !temperatureLatest || temperatureLatest.freshness !== "fresh";
  const tempShortcutLabel = !temperatureLatest
    ? "Water temperature unavailable. Open the water temperature chart."
    : temperatureLatest.freshness === "stale"
      ? `Water temperature ${tempReadingText}, Licking River — reading is stale. Open the water temperature chart.`
      : temperatureLatest.freshness === "unknown"
        ? `Water temperature ${tempReadingText}, Licking River — reading freshness unknown. Open the water temperature chart.`
        : `Water temperature ${tempReadingText}, Licking River. Open the water temperature chart.`;

  // Crest: highest stage in whatever forecast NOAA actually returned
  // (5-day cap, never padded — decision 2).
  let crestValue: number | null = null;
  let crestTime: Date | null = null;
  if (stage.ok && stageForecast.length > 0) {
    const peak = stageForecast.reduce((a, b) => ((b.stage ?? -Infinity) > (a.stage ?? -Infinity) ? b : a));
    crestValue = peak.stage;
    crestTime = peak.time;
  }
  const forecastFreshness = stage.ok ? stage.data.forecastFreshness : "unknown";

  // Max velocity forecast: NWS Ohio RFC's RVF bulletin, entirely separate
  // from the USGS velocity observation above (decision: see chat summary —
  // no fixed-area extrapolation, no hardcoded value; "Unavailable" if the
  // bulletin can't be parsed).
  const rvf = velocityForecast.ok ? velocityForecast.data : null;
  const rvfAvailable = rvf?.available && rvf.max != null;

  const floodStatus = stage.ok ? stage.data.floodStatus : null;
  const statusColor = floodStatus ? floodStatusColor(floodStatus.value.category) : "var(--muted)";

  const allOk = stage.ok && velocity.ok && temperature.ok;
  const anyOk = stage.ok || velocity.ok || temperature.ok;
  const liveLabel = allOk ? "Live" : anyOk ? "Partial" : "Offline";

  return (
    <div className="page">
      <div className="top-bar">
        <div className="top-bar-loc">
          Cincinnati <span className="top-bar-sep">·</span>{" "}
          <span className={`top-bar-status ${liveLabel.toLowerCase()}`}>{liveLabel}</span>
        </div>
        <div className="top-bar-right">
          <span className="top-bar-time">{latestStage ? formatObservedTime(latestStage.time) : "—"}</span>
          <button className="refresh-btn" onClick={refresh} disabled={refreshing} aria-label="Refresh river data now">
            <RefreshIcon spinning={refreshing} />
          </button>
        </div>
      </div>

      <div className="main-pad">
        {!stage.ok && (
          <div className="error-box">
            River stage/flow data unavailable ({stage.error}). Other sections below may still be current.
          </div>
        )}

        <div className="panel">
          <div className="panel-readings">
            <div className="readings-primary">
              <div className="column-heading column-heading-current">Current Conditions</div>
              <div className="card-label-row stage-label-row">
                <span className="label-left">
                  <span className="hero-label">River stage</span>
                  <InfoPopover label="river stage">
                    Measured by NOAA at gauge CCNO1 (Ohio River at Cincinnati). The status below is NOAA&apos;s own
                    reported flood category. Turn on &quot;Flood levels&quot; on the chart to see the
                    action/minor/moderate/major thresholds plotted.
                  </InfoPopover>
                </span>
                <button type="button" className="temp-shortcut" onClick={showTemperatureChart} aria-label={tempShortcutLabel}>
                  <ThermometerIcon />
                  <span className="temp-shortcut-val">{tempReadingText}</span>
                  {tempNeedsWarning && (
                    <span className="temp-shortcut-warn" aria-hidden="true">
                      !
                    </span>
                  )}
                </button>
              </div>
              <div className="stage-value-row">
                <span className="stage-value">{latestStage?.stage != null ? latestStage.stage.toFixed(1) : "—"}</span>
                <span className="stage-unit">ft</span>
              </div>
              <div className="status-line" style={{ color: statusColor }}>
                {floodStatus ? (
                  <>
                    {formatFloodCategory(floodStatus.value.category)}
                    <FreshnessBadge freshness={floodStatus.freshness} />
                  </>
                ) : (
                  "Status unavailable"
                )}
              </div>
              <div className="reading-meta">
                {formatTrend(stageTrend, "ft")} · NOAA
                {latestStage ? ` · ${formatObservedTimeShort(latestStage.time)}` : ""}
              </div>

              <div className="velocity-row">
                <div className="card-label-row">
                  <span className="stat-lbl">Mean velocity</span>
                  <InfoPopover label="mean velocity">
                    Computed from a field sensor reading via a calibrated index-velocity rating at USGS 03255000 —
                    not measured directly across the entire channel, and not the old fixed-area estimate (found
                    unsupported by both USGS and NWS data).
                  </InfoPopover>
                </div>
                {velocityLatest ? (
                  <>
                    <div className="velocity-value-row">
                      <span className="velocity-value">{velocityLatest.value.toFixed(2)}</span>
                      <span className="velocity-unit">mph</span>
                    </div>
                    <div className="reading-meta">
                      {formatTrend(velocityTrend, "mph")}
                      <FreshnessBadge freshness={velocityLatest.freshness} />
                      {" · USGS · "}
                      {formatObservedTimeShort(velocityLatest.observedAt)}
                    </div>
                  </>
                ) : (
                  <div className="unavailable-note">Unavailable</div>
                )}
              </div>
            </div>

            <div className="readings-divider" />

            <div className="readings-forecast">
              <div className="column-heading column-heading-forecast">Forecast</div>
              <div className="card-label-row">
                <span className="forecast-label">Peak stage</span>
                <InfoPopover label="peak stage">
                  Highest stage in NOAA&apos;s available forecast, capped at 5 days out — never padded if NOAA has
                  issued less. A forecast older than 24 hours is marked outdated but still shown.
                </InfoPopover>
              </div>
              {crestValue != null ? (
                <>
                  <div className="forecast-value-row">
                    <span className="forecast-value">{crestValue.toFixed(1)}</span>
                    <span className="forecast-unit">ft</span>
                  </div>
                  <div className="forecast-sub">{crestTime ? formatObservedTimeShort(crestTime) : ""}</div>
                  {forecastFreshness === "outdated" && <span className="badge badge-outdated">Outdated</span>}
                  {forecastFreshness === "unknown" && <span className="badge badge-unknown">Freshness unknown</span>}
                </>
              ) : (
                <div className="unavailable-note">{stage.ok ? "Forecast unavailable" : "Unavailable"}</div>
              )}

              <div className="forecast-sep" />

              <div className="card-label-row">
                <span className="forecast-label">Max velocity</span>
                <InfoPopover label="max velocity forecast">
                  From NWS Ohio River Forecast Center&apos;s River Flow and Velocity Forecasts bulletin for gauge
                  CCNO1 — a separate official source from the USGS observation above. Shows the maximum over
                  whatever forecast window NWS actually issued (see the day count below), never assumed to be 5
                  days. Not derived from USGS observations and not the retired fixed-channel-area formula.
                </InfoPopover>
              </div>
              {rvfAvailable && rvf?.max ? (
                <>
                  <div className="forecast-value-row">
                    <span className="forecast-value">{rvf.max.velocityMph.toFixed(2)}</span>
                    <span className="forecast-unit">mph</span>
                  </div>
                  <div className="forecast-sub">{formatObservedTimeShort(rvf.max.time)}</div>
                  <div className="forecast-sub">NWS · {rvf.windowDays}d fcst</div>
                </>
              ) : (
                <div className="unavailable-note">Unavailable</div>
              )}
            </div>
          </div>

          <div className="panel-sep" />

          <div className="panel-chart" ref={chartSectionRef}>
            <RiverChart
              observed={stageObserved}
              forecast={stageForecast}
              thresholds={thresholds}
              velocityHistory={velocityHistory}
              temperatureHistory={temperatureHistory}
              temperatureLatest={temperatureLatest}
              mode={chartMode}
              onModeChange={setChartMode}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
