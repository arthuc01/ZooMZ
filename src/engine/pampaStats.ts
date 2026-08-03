/**
 * pampaStats.ts
 * -------------
 * PAMPA-style analytical p-value for ZooMS marker matching.
 *
 * Reference: Touzet et al., J. Proteome Res. 2025 (PAMPA, src/assignment.py)
 *
 * Model
 * -----
 * Under the null hypothesis, the spectrum's peaks are randomly distributed
 * across the mass range. For a given taxon with n reference markers, the
 * number of markers matched by chance follows a Binomial(n, p) distribution,
 * where p = p_success is the probability that a single marker position falls
 * within the "peak coverage" of the spectrum.
 *
 *   p_success = (union area of all peak ±tolerance windows) / (mass range + 2*tolerance)
 *
 * The analytical p-value is then the survival function:
 *
 *   pvalue = P( Binomial(n, p) >= k ) = binom.sf(k-1, n, p)
 *
 * where k = number of markers actually matched.
 *
 * Fallback: if k < 5, PAMPA returns 1/k as a crude estimate (insufficient
 * data for the binomial model to be reliable). We preserve this behaviour.
 */

import type { MarkerMatchRow, Peak } from "./types";

// ── Log-gamma (Stirling / Lanczos for integers) ─────────────────────────────

/** Log of n! using simple summation (accurate for integer n up to ~10000). */
function logFactorial(n: number): number {
  let r = 0;
  for (let i = 2; i <= n; i++) r += Math.log(i);
  return r;
}

/** Log of C(n, k) — binomial coefficient. */
function logBinomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

// ── Binomial survival function ────────────────────────────────────────────────

/**
 * P(X ≥ k) where X ~ Binomial(n, p).
 * Computed by summing individual binomial probabilities in log space to avoid
 * underflow. Practical for the marker counts seen in ZooMS (n ≤ ~20).
 */
export function binomSF(k: number, n: number, p: number): number {
  if (k <= 0) return 1.0;
  if (k > n) return 0.0;
  if (p <= 0) return 0.0;
  if (p >= 1) return 1.0;

  const logP    = Math.log(p);
  const log1mP  = Math.log(1 - p);
  let total = 0;

  for (let i = k; i <= n; i++) {
    const logProb = logBinomCoeff(n, i) + i * logP + (n - i) * log1mP;
    total += Math.exp(logProb);
  }

  return Math.min(1, Math.max(0, total));
}

// ── p_success: peak-coverage probability ─────────────────────────────────────

/**
 * Compute the probability that a single random marker position falls within
 * the coverage of the spectrum's peaks (each peak covers ±toleranceDa).
 *
 * Algorithm (matches PAMPA's p_success, with the overlap branch fixed to +=):
 *   1. Sort peaks by m/z.
 *   2. Walk through peaks, accumulating the union area of [mz−tol, mz+tol] intervals.
 *   3. Divide by (mzMax − mzMin + 2 * tol).
 */
export function computePSuccess(peaks: Peak[], toleranceDa: number): number {
  if (peaks.length === 0 || toleranceDa <= 0) return 0;

  const sorted = [...peaks].sort((a, b) => a.mz - b.mz);
  const mzMin  = sorted[0].mz;
  const mzMax  = sorted[sorted.length - 1].mz;

  let cover    = 0;
  let maxCover = -Infinity; // right edge of the current union interval

  for (const peak of sorted) {
    const lo = peak.mz - toleranceDa;
    const hi = peak.mz + toleranceDa;

    if (lo < maxCover) {
      // Overlapping interval — add only the newly covered portion
      if (hi > maxCover) {
        cover   += hi - maxCover;
        maxCover = hi;
      }
      // else entirely subsumed — add nothing
    } else {
      // Non-overlapping interval — add full 2*tol window
      cover   += 2 * toleranceDa;
      maxCover = hi;
    }
  }

  const massRange = mzMax - mzMin + 2 * toleranceDa;
  return massRange > 0 ? Math.min(1, cover / massRange) : 0;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Compute the PAMPA analytical p-value for a single taxon.
 *
 * @param matches      Marker match rows for this taxon (from markerMatchesForTaxon).
 * @param peaks        All picked peaks for the spectrum.
 * @param toleranceDa  Mass tolerance used during matching (Da).
 * @returns            One-sided binomial p-value in [0, 1], or null if insufficient data.
 */
export function computePampaPvalue(
  matches: MarkerMatchRow[],
  peaks: Peak[],
  toleranceDa: number
): number | null {
  const n = matches.length;          // total markers for this taxon
  const k = matches.filter(m => m.matched).length; // matched markers

  if (n === 0 || peaks.length === 0) return null;
  if (k === 0) return 1.0;

  // PAMPA fallback: too few matches for the binomial model to be reliable
  if (k < 5) return 1 / k;

  const p = computePSuccess(peaks, toleranceDa);
  if (p <= 0 || p >= 1) return p <= 0 ? 0.0 : 1.0;

  return binomSF(k, n, p);
}
