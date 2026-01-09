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

// Estimate baseline using a simple SNIP algorithm on log1p intensities.
export function snipBaseline(intensity: Float64Array, iterations: number): Float64Array {
  const n = intensity.length;
  if (n < 3) return new Float64Array(intensity);

  const maxIter = Math.max(1, Math.min(iterations, Math.floor(n / 2) - 1));
  const logY = new Float64Array(n);
  for (let i = 0; i < n; i++) logY[i] = Math.log1p(Math.max(0, intensity[i]));

  let prev = logY;
  let next = new Float64Array(n);

  for (let k = 1; k <= maxIter; k++) {
    next.set(prev);
    for (let i = k; i < n - k; i++) {
      const avg = 0.5 * (prev[i - k] + prev[i + k]);
      if (avg < next[i]) next[i] = avg;
    }
    const tmp = prev;
    prev = next;
    next = tmp;
  }

  const baseline = new Float64Array(n);
  for (let i = 0; i < n; i++) baseline[i] = Math.expm1(prev[i]);
  return baseline;
}

export function subtractBaseline(intensity: Float64Array, baseline: Float64Array): Float64Array {
  const n = intensity.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, intensity[i] - baseline[i]);
  return out;
}
