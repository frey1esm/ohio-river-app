export interface TempPoint {
  time: Date;
  tempF: number;
}

export interface GappedPoint {
  x: number;
  y: number | null;
}

/**
 * Turns an ascending water-temperature series into Chart.js point data,
 * inserting a `null` breakpoint wherever consecutive observations are more
 * than ~3x the series' own typical cadence apart (floor of 45 minutes).
 * Chart.js with `spanGaps: false` then leaves those stretches open instead
 * of drawing a straight line across hours of missing data — a flat
 * interpolation there would read as real, steady readings.
 */
export function gappedTempPoints(history: TempPoint[]): GappedPoint[] {
  if (history.length < 2) {
    return history.map((p) => ({ x: p.time.getTime(), y: p.tempF }));
  }

  const deltas: number[] = [];
  for (let i = 1; i < history.length; i++) {
    deltas.push(history[i].time.getTime() - history[i - 1].time.getTime());
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const gapThreshold = Math.max(median * 3, 45 * 60 * 1000);

  const out: GappedPoint[] = [{ x: history[0].time.getTime(), y: history[0].tempF }];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].time.getTime();
    const cur = history[i].time.getTime();
    if (cur - prev > gapThreshold) {
      out.push({ x: prev + (cur - prev) / 2, y: null });
    }
    out.push({ x: cur, y: history[i].tempF });
  }
  return out;
}
