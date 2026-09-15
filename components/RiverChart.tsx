"use client";

import { Chart, type ChartDataset, type Plugin } from "chart.js/auto";
import "chartjs-adapter-date-fns";
import { useEffect, useRef, useState } from "react";
import { computeYRange } from "@/lib/chart-scale";
import { formatObservedTime } from "@/lib/format";
import { gappedTempPoints } from "@/lib/temp-series";
import type { FloodThresholds, FreshValue, StageFlowPoint } from "@/lib/types";
import FreshnessBadge from "./FreshnessBadge";
import InfoPopover from "./InfoPopover";

export type ChartMode = "stage" | "flow" | "velocity" | "temp";

interface Props {
  observed: StageFlowPoint[];
  forecast: StageFlowPoint[];
  thresholds: FloodThresholds;
  velocityHistory: { time: Date; mph: number }[];
  temperatureHistory: { time: Date; tempF: number }[];
  temperatureLatest: FreshValue<number> | null;
  mode: ChartMode;
  onModeChange: (mode: ChartMode) => void;
}

// Cyan Classic palette: bright cyan observed, amber dashed forecast.
const COLORS = {
  observed: "#22d3ee",
  observedFill: "rgba(34,211,238,0.10)",
  forecast: "#fbbf24",
  forecastFill: "rgba(251,191,36,0.05)",
  velocity: "#22d3ee",
  velocityFill: "rgba(34,211,238,0.10)",
  grid: "rgba(148,197,214,0.08)",
  tick: "#7d94b3",
  now: "rgba(226,238,246,0.55)",
  thresholds: {
    action: "rgba(217,119,6,0.65)",
    minor: "rgba(244,114,44,0.65)",
    moderate: "rgba(239,68,68,0.7)",
    major: "rgba(190,24,74,0.75)",
  },
};

type TimePoint = { x: number; y: number | null };
type ValuePoint = { time: Date; value: number };

interface BuiltConfig {
  datasets: ChartDataset<"line", TimePoint[]>[];
  unit: string;
  yRange: { min: number; max: number };
  /** The observed/forecast boundary, as a real timestamp — not an array
   * index, since observed (15-min) and forecast (6-hour) points no longer
   * share one index space now that the x-axis is a true time scale. */
  nowTime: number | null;
  thresholdLines: { value: number; color: string; label: string }[];
  currentPoint: ValuePoint | null;
  /** Highest forecast value (only present for stage/flow, never velocity — decision 5, no velocity forecast). */
  peakPoint: ValuePoint | null;
}

function decimalsForUnit(unit: string): number {
  if (unit === "ft") return 1;
  if (unit === "mph") return 2;
  if (unit === "°F") return 1;
  return 0;
}

/**
 * A real time-based x-axis, not an array-index "category" axis. This
 * matters: observed points are ~15 minutes apart and forecast points are
 * ~6 hours apart (24x sparser). On an index-based axis, both series get
 * treated as equally-spaced "slots," which squeezed several real days of
 * forecast into a sliver a few percent of the chart's width. A time scale
 * positions every point by its actual timestamp, so forecast gets the
 * screen width its real time span deserves.
 */
function buildStageOrFlowConfig(
  observed: StageFlowPoint[],
  forecast: StageFlowPoint[],
  field: "stage" | "flow",
  unit: string,
  thresholds: FloodThresholds | null,
  floodLevelsOn: boolean,
): BuiltConfig {
  const observedPoints: TimePoint[] = observed.map((p) => ({ x: p.time.getTime(), y: p[field] }));
  const lastObserved = observed[observed.length - 1];

  // Prepend the last observed point so the forecast line visually connects
  // rather than starting with a gap.
  const forecastPoints: TimePoint[] =
    forecast.length > 0 && lastObserved
      ? [
          { x: lastObserved.time.getTime(), y: lastObserved[field] },
          ...forecast.map((p) => ({ x: p.time.getTime(), y: p[field] })),
        ]
      : [];

  const datasets: ChartDataset<"line", TimePoint[]>[] = [
    {
      label: "Observed",
      data: observedPoints,
      borderColor: COLORS.observed,
      backgroundColor: COLORS.observedFill,
      borderWidth: 3,
      pointRadius: 0,
      tension: 0.25,
      fill: true,
      spanGaps: false,
    },
  ];

  if (forecastPoints.length > 0) {
    datasets.push({
      label: "Forecast",
      data: forecastPoints,
      borderColor: COLORS.forecast,
      backgroundColor: COLORS.forecastFill,
      borderWidth: 2.5,
      borderDash: [6, 4],
      pointRadius: 0,
      tension: 0.25,
      fill: true,
      spanGaps: false,
    });
  }

  const allValues = [...observedPoints, ...forecastPoints]
    .map((p) => p.y)
    .filter((v): v is number => v != null);

  const thresholdLines: { value: number; color: string; label: string }[] = [];
  let extraMax: number | null = null;
  if (field === "stage" && thresholds && floodLevelsOn) {
    const tiers: [number | null, string, string][] = [
      [thresholds.action, COLORS.thresholds.action, "Action"],
      [thresholds.minor, COLORS.thresholds.minor, "Minor"],
      [thresholds.moderate, COLORS.thresholds.moderate, "Moderate"],
      [thresholds.major, COLORS.thresholds.major, "Major"],
    ];
    for (const [val, color, label] of tiers) {
      if (val === null) continue;
      thresholdLines.push({ value: val, color, label: `${label} ${val}ft` });
      extraMax = extraMax === null ? val : Math.max(extraMax, val);
    }
  }

  const yRange = computeYRange(allValues, extraMax);
  const nowTime = forecast.length > 0 && lastObserved ? lastObserved.time.getTime() : null;

  let currentPoint: ValuePoint | null = null;
  for (let i = observed.length - 1; i >= 0; i--) {
    if (observed[i][field] != null) {
      currentPoint = { time: observed[i].time, value: observed[i][field] as number };
      break;
    }
  }

  let peakPoint: ValuePoint | null = null;
  for (const p of forecast) {
    if (p[field] != null && (peakPoint === null || (p[field] as number) > peakPoint.value)) {
      peakPoint = { time: p.time, value: p[field] as number };
    }
  }

  return { datasets, unit, yRange, nowTime, thresholdLines, currentPoint, peakPoint };
}

function buildVelocityConfig(history: { time: Date; mph: number }[]): BuiltConfig {
  const points: TimePoint[] = history.map((p) => ({ x: p.time.getTime(), y: p.mph }));
  const last = history[history.length - 1];
  return {
    datasets: [
      {
        label: "Mean river velocity",
        data: points,
        borderColor: COLORS.velocity,
        backgroundColor: COLORS.velocityFill,
        borderWidth: 3,
        pointRadius: 0,
        tension: 0.25,
        fill: true,
        spanGaps: false,
      },
    ],
    unit: "mph",
    yRange: computeYRange(points.map((p) => p.y).filter((v): v is number => v != null)),
    nowTime: null,
    thresholdLines: [],
    currentPoint: last ? { time: last.time, value: last.mph } : null,
    peakPoint: null,
  };
}

function buildTempConfig(history: { time: Date; tempF: number }[]): BuiltConfig {
  const points = gappedTempPoints(history);
  const last = history[history.length - 1];
  return {
    datasets: [
      {
        label: "Observed",
        data: points,
        borderColor: COLORS.observed,
        backgroundColor: COLORS.observedFill,
        borderWidth: 3,
        pointRadius: 0,
        tension: 0.25,
        fill: true,
        spanGaps: false,
      },
    ],
    unit: "°F",
    yRange: computeYRange(points.map((p) => p.y).filter((v): v is number => v != null)),
    nowTime: null,
    thresholdLines: [],
    currentPoint: last ? { time: last.time, value: last.tempF } : null,
    peakPoint: null,
  };
}

/** A point near the plot's left/right edge needs its label anchored away
 * from the edge (not centered on the point) or the text clips against the
 * canvas boundary — this was visibly cutting "0.96" down to "0.9" for the
 * last point of a chart with no forecast (velocity mode). */
function edgeAwareLabelX(
  pointX: number,
  chartArea: { left: number; right: number },
  margin = 28,
): { x: number; align: CanvasTextAlign } {
  if (pointX > chartArea.right - margin) return { x: chartArea.right, align: "right" };
  if (pointX < chartArea.left + margin) return { x: chartArea.left, align: "left" };
  return { x: pointX, align: "center" };
}

/** Draws the "Now" divider between observed and forecast, threshold
 * reference-line labels, and value callouts at the latest observed point
 * and the forecast peak — all positioned via the scales' own time/value
 * pixel conversion, not dataset-index bookkeeping. */
function buildAnnotationPlugin(cfg: BuiltConfig): Plugin<"line"> {
  const unit = cfg.unit;
  return {
    id: "riverAnnotations",
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      ctx.save();

      if (cfg.nowTime != null) {
        const x = scales.x.getPixelForValue(cfg.nowTime);
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = COLORS.now;
        ctx.lineWidth = 1.5;
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "600 11px sans-serif";
        ctx.fillStyle = COLORS.now;
        ctx.textAlign = "center";
        ctx.fillText("Now", x, chartArea.top - 4);
      }

      for (const t of cfg.thresholdLines) {
        const y = scales.y.getPixelForValue(t.value);
        if (y < chartArea.top || y > chartArea.bottom) continue;
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 1;
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "600 10px sans-serif";
        ctx.fillStyle = t.color;
        ctx.textAlign = "right";
        ctx.fillText(t.label, chartArea.right - 4, y - 3);
      }

      const decimals = decimalsForUnit(unit);
      let currentPx: { x: number; y: number } | null = null;

      if (cfg.currentPoint) {
        const x = scales.x.getPixelForValue(cfg.currentPoint.time.getTime());
        const y = scales.y.getPixelForValue(cfg.currentPoint.value);
        currentPx = { x, y };
        ctx.beginPath();
        ctx.fillStyle = COLORS.observed;
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "700 12px sans-serif";
        ctx.fillStyle = "#f4f8fb";
        const label = edgeAwareLabelX(x, chartArea);
        ctx.textAlign = label.align;
        ctx.fillText(cfg.currentPoint.value.toFixed(decimals), label.x, y - 12);
      }

      if (cfg.peakPoint) {
        const x = scales.x.getPixelForValue(cfg.peakPoint.time.getTime());
        const y = scales.y.getPixelForValue(cfg.peakPoint.value);
        // The peak and current points can be close together (a nearly-flat
        // forecast) — push the peak's label further up when it would
        // otherwise sit right on top of the current-value label.
        const closeToCurrent = currentPx != null && Math.abs(x - currentPx.x) < 40 && Math.abs(y - currentPx.y) < 20;
        const labelOffset = closeToCurrent ? 26 : 12;
        ctx.beginPath();
        ctx.fillStyle = COLORS.forecast;
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "700 12px sans-serif";
        ctx.fillStyle = COLORS.forecast;
        const label = edgeAwareLabelX(x, chartArea);
        ctx.textAlign = label.align;
        ctx.fillText(cfg.peakPoint.value.toFixed(decimals), label.x, y - labelOffset);
      }

      ctx.restore();
    },
  };
}

const TABS: { id: ChartMode; label: string }[] = [
  { id: "stage", label: "Stage" },
  { id: "flow", label: "Flow" },
  { id: "velocity", label: "Velocity" },
  { id: "temp", label: "Temp" },
];

export default function RiverChart({
  observed,
  forecast,
  thresholds,
  velocityHistory,
  temperatureHistory,
  temperatureLatest,
  mode,
  onModeChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  // Flood-levels toggle is stage-only local UI state; nothing outside the
  // chart needs it, so unlike `mode` it stays here.
  const [floodLevelsOn, setFloodLevelsOn] = useState(false);

  const stageOrFlow = mode === "stage" || mode === "flow";
  const showForecastLegend = stageOrFlow && forecast.length > 0;

  const hasData =
    mode === "velocity"
      ? velocityHistory.length > 0
      : mode === "temp"
        ? temperatureHistory.length > 0
        : observed.length > 0;

  useEffect(() => {
    if (!canvasRef.current || !hasData) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return;
    }

    const cfg =
      mode === "stage"
        ? buildStageOrFlowConfig(observed, forecast, "stage", "ft", thresholds, floodLevelsOn)
        : mode === "flow"
          ? buildStageOrFlowConfig(observed, forecast, "flow", "kcfs", null, false)
          : mode === "velocity"
            ? buildVelocityConfig(velocityHistory)
            : buildTempConfig(temperatureHistory);

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: { datasets: cfg.datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 22, right: 8, left: 0, bottom: 0 } },
        plugins: {
          legend: { display: false },
          // Hover/tap tooltip is intentionally off — the annotation plugin
          // below already labels the current value, forecast peak, and
          // threshold lines directly on the chart.
          tooltip: { enabled: false },
        },
        scales: {
          x: {
            type: "time",
            time: { unit: "day" },
            ticks: {
              color: COLORS.tick,
              // One tick per calendar day, every day shown — not thinned by
              // autoSkip — since the two-line label below is narrow enough
              // that even the ~10-day stage/flow span (5 history + 5
              // forecast) fits without crowding.
              autoSkip: false,
              font: { size: 11 },
              // Two-line tick label — weekday initial ("M", "T", "W"...)
              // stacked above the day-of-month number — rather than relying
              // on Chart.js's own date-adapter formatting.
              callback: (value) => {
                const d = new Date(value as number);
                const weekday = d.toLocaleDateString("en-US", { weekday: "narrow" });
                return [weekday, String(d.getDate())];
              },
            },
            grid: { color: COLORS.grid },
            border: { display: false },
          },
          y: {
            min: cfg.yRange.min,
            max: cfg.yRange.max,
            ticks: { color: COLORS.tick, font: { size: 11 } },
            grid: { color: COLORS.grid },
            border: { display: false },
            title: { display: true, text: cfg.unit, color: COLORS.tick, font: { size: 11 } },
          },
        },
      },
      plugins: [buildAnnotationPlugin(cfg)],
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [mode, observed, forecast, thresholds, velocityHistory, temperatureHistory, hasData, floodLevelsOn]);

  const headerTitle =
    mode === "stage"
      ? "River stage (ft)"
      : mode === "flow"
        ? "Flow (kcfs)"
        : mode === "velocity"
          ? "Mean velocity (mph)"
          : "Water temperature · Licking River";

  const headerSource =
    mode === "velocity" ? "USGS 03255000" : mode === "temp" ? "USGS 03254520" : "NOAA CCNO1";

  return (
    <div className="chart-root">
      <div className="chart-toolbar">
        <div className="ctab-group" role="tablist" aria-label="Chart mode">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={mode === tab.id}
              className={`ctab ${mode === tab.id ? "active" : ""}`}
              onClick={() => onModeChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {mode === "stage" && (
          <button
            type="button"
            role="switch"
            aria-checked={floodLevelsOn}
            aria-label="Toggle flood level reference lines"
            className="flood-toggle"
            onClick={() => setFloodLevelsOn((v) => !v)}
          >
            <span>Flood levels</span>
            <span className={`switch ${floodLevelsOn ? "on" : ""}`}>
              <span className="switch-knob" />
            </span>
          </button>
        )}
      </div>
      <div className="chart-section">
        <div className="chart-header">
          <span className="chart-header-title">{headerTitle}</span>
          <span className="chart-header-source">
            Source: {headerSource}
            <InfoPopover label="data source">
              {mode === "velocity" ? (
                "USGS 03255000, parameter 72255 — computed from a field sensor reading via a calibrated index-velocity rating, not measured directly across the entire channel."
              ) : mode === "temp" ? (
                <>
                  Water temperature · Licking River. USGS site 03254520, parameter 00010 (°C, converted to
                  °F). A nearby tributary reading, not an Ohio River mainstem measurement — chosen for its
                  proximity to Cincinnati. No air-temperature fallback; if this source is unavailable the
                  reading shows as unavailable rather than estimated.
                  <br />
                  <br />
                  Latest observation:{" "}
                  {temperatureLatest
                    ? `${temperatureLatest.value.toFixed(1)}°F · ${formatObservedTime(temperatureLatest.observedAt)}`
                    : "unavailable"}
                  {temperatureLatest && temperatureLatest.freshness !== "fresh" && (
                    <>
                      {" "}
                      <FreshnessBadge freshness={temperatureLatest.freshness} />
                    </>
                  )}
                </>
              ) : (
                "NOAA National Water Prediction Service, gauge CCNO1 (Ohio River at Cincinnati)."
              )}
            </InfoPopover>
          </span>
        </div>
        <div className="chart-wrap">
          {hasData ? (
            <canvas ref={canvasRef} role="img" aria-label={`${mode} chart`} />
          ) : (
            <div
              className="unavailable-note"
              style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}
            >
              {mode === "velocity"
                ? "Velocity data unavailable"
                : mode === "temp"
                  ? "Water temperature history unavailable"
                  : "Stage/flow data unavailable"}
            </div>
          )}
        </div>
        <div className="bottom-bar">
          <div className="legend">
            <div className="leg-item">
              <div className="leg-solid" />
              <span>Observed</span>
            </div>
            {showForecastLegend && (
              <div className="leg-item">
                <div className="leg-dashed" />
                <span>Forecast</span>
              </div>
            )}
          </div>
          <div className="sources">
            5 days history{stageOrFlow ? " · up to 5 days forecast" : " only"}
          </div>
        </div>
      </div>
    </div>
  );
}
