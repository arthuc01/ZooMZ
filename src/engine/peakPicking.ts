import type { Peak } from "./types";

// Pick local maxima above a relative intensity threshold.
export function pickPeaks(
  mz: Float64Array,
  intensity: Float64Array,
  minRelativeIntensity: number,
  minPeakDistanceDa: number
): Peak[] {
  let maxI = 0;
  for (let i = 0; i < intensity.length; i++) maxI = Math.max(maxI, intensity[i]);
  const threshold = maxI * minRelativeIntensity;

  const peaks: Peak[] = [];
  for (let i = 1; i < intensity.length - 1; i++) {
    const y0 = intensity[i - 1];
    const y1 = intensity[i];
    const y2 = intensity[i + 1];
    if (y1 >= threshold && y1 >= y0 && y1 >= y2) peaks.push({ mz: mz[i], intensity: y1 });
  }

  peaks.sort((a, b) => a.mz - b.mz);

  // Enforce minimum m/z separation by keeping the higher intensity peak
  const filtered: Peak[] = [];
  for (const p of peaks) {
    const last = filtered[filtered.length - 1];
    if (!last) {
      filtered.push(p);
      continue;
    }
    if (Math.abs(p.mz - last.mz) >= minPeakDistanceDa) {
      filtered.push(p);
    } else if (p.intensity > last.intensity) {
      filtered[filtered.length - 1] = p;
    }
  }
  return filtered;
}

/**
 * Simple monoisotopic filtering:
 * Keep a peak and remove peaks at mz + n*distance within tolerance (n=1..maxIsotopes).
 * This is a pragmatic alternative to MALDIquant's monoisotopicPeaks.
 */
export function keepMonoisotopicPeaks(
  peaks: Peak[],
  toleranceDa = 0.2,
  distanceDa = 1.00235,
  maxIsotopes = 10
): Peak[] {
  const sorted = [...peaks].sort((a, b) => a.mz - b.mz);
  const removed = new Array(sorted.length).fill(false);
  const keep: Peak[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (removed[i]) continue;
    const p = sorted[i];
    keep.push(p);

    for (let k = 1; k <= maxIsotopes; k++) {
      const target = p.mz + k * distanceDa;
      // scan forward while mz <= target + tol
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].mz > target + toleranceDa) break;
        if (Math.abs(sorted[j].mz - target) <= toleranceDa) removed[j] = true;
      }
    }
  }

  return keep;
}
