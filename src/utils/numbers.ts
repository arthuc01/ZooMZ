// Compute ppm error between expected and observed values.
export function ppmError(expected: number, observed: number): number {
  return ((observed - expected) / expected) * 1e6;
}

// Compute the arithmetic mean of a list of numbers.
export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Compute the median of a numeric array, or null when empty.
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Compute the interquartile range of a numeric array, or null when < 4 values.
export function iqr(xs: number[]): number | null {
  if (xs.length < 4) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const q1Idx = Math.floor((sorted.length - 1) * 0.25);
  const q3Idx = Math.floor((sorted.length - 1) * 0.75);
  return sorted[q3Idx] - sorted[q1Idx];
}
