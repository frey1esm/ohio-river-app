/**
 * Computes a "nice" rounded axis step for a given raw range, aiming for
 * roughly 5 gridlines (the standard nice-number algorithm: 1/2/5 * 10^n).
 */
function niceStep(rawRange: number): number {
  if (rawRange <= 0) return 1;
  const roughStep = rawRange / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  let niceNormalized: number;
  if (normalized < 1.5) niceNormalized = 1;
  else if (normalized < 3) niceNormalized = 2;
  else if (normalized < 7) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

export interface AxisRange {
  min: number;
  max: number;
}

/**
 * Auto-scales the Y axis to the actual visible data range, never a
 * hardcoded ceiling. Pads by ~12% of the data's own range, then rounds
 * outward to nice tick boundaries. `extraMax` (e.g. a flood threshold, only
 * when the "Flood levels" toggle is on) is folded into the range before
 * padding/rounding, so enabling it expands the scale and disabling it
 * restores the tighter, data-only view.
 */
export function computeYRange(values: number[], extraMax?: number | null): AxisRange {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: 1 };

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (extraMax != null && Number.isFinite(extraMax)) {
    max = Math.max(max, extraMax);
  }

  if (min === max) {
    // A flat series still needs a visible band, not a zero-height axis.
    min -= 1;
    max += 1;
  }

  const rawRange = max - min;
  const pad = rawRange * 0.12;
  const paddedMin = min - pad;
  const paddedMax = max + pad;

  const step = niceStep(paddedMax - paddedMin);
  return {
    min: Math.floor(paddedMin / step) * step,
    max: Math.ceil(paddedMax / step) * step,
  };
}
