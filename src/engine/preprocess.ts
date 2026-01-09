// Crop a spectrum to the [mzMin, mzMax] window.
export function cropSpectrum(mz: Float64Array, intensity: Float64Array, mzMin: number, mzMax: number): { mz: Float64Array; intensity: Float64Array } {
  let start = 0;
  while (start < mz.length && mz[start] < mzMin) start++;
  let end = start;
  while (end < mz.length && mz[end] <= mzMax) end++;
  return {
    mz: new Float64Array(mz.subarray(start, end)),
    intensity: new Float64Array(intensity.subarray(start, end))
  };
}

// Normalize intensities to the maximum value in the array.
export function normalizeToMax(intensity: Float64Array): Float64Array {
  let maxI = 0;
  for (let i = 0; i < intensity.length; i++) maxI = Math.max(maxI, intensity[i]);
  if (maxI <= 0) return intensity;
  const out = new Float64Array(intensity.length);
  for (let i = 0; i < intensity.length; i++) out[i] = intensity[i] / maxI;
  return out;
}
