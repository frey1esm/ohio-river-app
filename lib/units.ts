/** Exact ft/s -> mph conversion factor (3600 / 5280), verified against NOAA/USGS data
 * during the source investigation (docs/river-reverse-engineering.md §3, §11). */
export const FPS_TO_MPH = 0.681818;

export function feetPerSecondToMph(fps: number): number {
  return fps * FPS_TO_MPH;
}

/** Exact conversion, not an approximation (docs/river-v1-spec.md §6). */
export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}
