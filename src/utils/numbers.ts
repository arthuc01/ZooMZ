// Compute ppm error between expected and observed values.
export function ppmError(expected: number, observed: number): number {
  return ((observed - expected) / expected) * 1e6;
}
// Compute the arithmetic mean of a list of numbers.
export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  return xs.reduce((a,b)=>a+b, 0) / xs.length;
}
