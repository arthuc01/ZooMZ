/**
 * Round using half-to-even semantics like Python's round() and NumPy's np.round.
 */
export function roundHalfEven(value: number, digits = 0): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  const eps = 1e-12;

  if (frac > 0.5 + eps) return (floor + 1) / factor;
  if (frac < 0.5 - eps) return floor / factor;
  return ((floor % 2 === 0 ? floor : floor + 1) / factor);
}
