/**
 * Decoy taxon generation for per-spectrum permutation testing in ZooMZ.
 *
 * ## Purpose
 *
 * Decoy taxa approximate the null distribution of Pearson binary correlation scores
 * that would be obtained if a spectrum contained no genuine taxon-specific collagen
 * peptide signal. Each decoy has the same number of markers as a real taxon (drawn
 * from the empirical distribution) but at randomly offset m/z positions.
 *
 * ## Null model
 *
 * Under H₀ (no genuine collagen signal), the peak pattern in the spectrum is
 * indistinguishable from random noise. A random marker set — one that cannot
 * systematically match real collagen peptides — should score no better than the
 * real reference database against such noise.
 *
 * Decoy markers are placed at offsets of 1.5–10 Da (random sign) from a randomly
 * chosen real marker position, within the observed m/z range. Two rejection criteria
 * are applied to each candidate placement:
 *
 *   1. Must be ≥ minSepRealDa from any real marker in the database.
 *      Default: 1.5 Da. This prevents decoys from accidentally falling within the
 *      deamidation scoring window, which extends −1.3 Da from the marker position.
 *      (A separation of only 0.6 Da, the previous default of 2×toleranceDa, was
 *      insufficient — decoys placed there could partially overlap deamid windows,
 *      inflating decoy scores and making the test overly conservative.)
 *
 *   2. Must be ≥ toleranceDa from any previously placed marker in the same decoy.
 *      This prevents two decoy markers from falling in the same scoring bin.
 *
 * ## qSample formula (computed in analyze.ts)
 *
 *   qSample = (#{decoys with score ≥ bestRealScore} + 1) / (N_decoys + 1)
 *
 * This is a one-sided permutation p-value with Laplace (+1) correction to avoid q = 0.
 * It is NOT a dataset-level FDR — see confidence.ts for the full statistical framework.
 */

import type { RefMarker, RefTaxon, SpeciescanDb } from "./types";

export type DecoyOptions = {
  /** Number of decoy taxa to generate. Default: max(200, db.taxa.length). */
  nDecoys?: number;
  /** Hard upper limit on decoy count (performance guard). Default: 1000. */
  maxDecoys?: number;
  /** RNG seed for reproducibility. Default: 1337. */
  seed?: number;
  /** Lower bound of the m/z placement window. Default: min of real marker pool. */
  mzMin?: number;
  /** Upper bound of the m/z placement window. Default: max of real marker pool. */
  mzMax?: number;
  /**
   * Minimum separation (Da) between any decoy marker and any real marker.
   * Default: 1.5 Da — chosen to ensure no decoy can fall within the deamidation
   * scoring window (−1.3 Da), which would inflate decoy scores and make the test
   * overly conservative. Do not set below 1.4 Da.
   */
  minSepRealDa?: number;
  /**
   * Minimum separation (Da) between markers within the same decoy taxon.
   * Default: toleranceDa (= 0.3 Da by default, from the contaminant tolerance).
   */
  toleranceDa?: number;
};

// Mulberry32 — fast, deterministic PRNG suitable for reproducible decoy generation.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Binary search: index of the first element ≥ value.
function lowerBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Returns true if any element in sorted[] is within tol of mz.
function isNear(sorted: number[], mz: number, tol: number): boolean {
  if (!sorted.length) return false;
  const idx = lowerBound(sorted, mz);
  if (idx < sorted.length && Math.abs(sorted[idx] - mz) <= tol) return true;
  if (idx > 0 && Math.abs(sorted[idx - 1] - mz) <= tol) return true;
  return false;
}

// Insert mz into a sorted array while preserving sort order.
function insertSorted(sorted: number[], mz: number): void {
  const idx = lowerBound(sorted, mz);
  sorted.splice(idx, 0, mz);
}

/**
 * Build an array of decoy taxa for a given reference database.
 *
 * @returns Array of RefTaxon objects with randomly placed markers.
 *          Empty array if the database has no markers (no scoring possible).
 */
export function buildDecoyTaxa(db: SpeciescanDb, opts: DecoyOptions = {}): RefTaxon[] {
  const markerPool = db.taxa.flatMap(t => t.markers.map(m => m.mz));
  if (!markerPool.length) return [];

  const markerCounts = db.taxa.map(t => t.markers.length).filter(k => k > 0);
  if (!markerCounts.length) return [];

  const maxDecoys    = opts.maxDecoys ?? 1000;
  const nDecoys      = Math.min(opts.nDecoys ?? Math.max(200, db.taxa.length), maxDecoys);
  const toleranceDa  = opts.toleranceDa ?? 0.3;

  // 1.5 Da default — ensures separation from the deamidation scoring window (−1.3 Da).
  // Do NOT lower below 1.4 Da; see module docstring.
  const minSepRealDa = opts.minSepRealDa ?? 1.5;

  // Use reduce to avoid spread on large arrays (which can blow the call stack).
  const mzMin = opts.mzMin ?? markerPool.reduce((a, b) => Math.min(a, b), Infinity);
  const mzMax = opts.mzMax ?? markerPool.reduce((a, b) => Math.max(a, b), -Infinity);

  const realSorted = [...markerPool].sort((a, b) => a - b);
  const rng = mulberry32(opts.seed ?? 1337);

  const decoys: RefTaxon[] = [];

  for (let i = 0; i < nDecoys; i++) {
    // Draw marker count from the empirical distribution.
    const k = markerCounts[Math.floor(rng() * markerCounts.length)] ?? 0;
    const decoyMzSorted: number[] = [];
    const markers: RefMarker[] = [];

    for (let m = 0; m < k; m++) {
      let placed = false;

      for (let attempt = 0; attempt < 200; attempt++) {
        // Base position: a randomly chosen real marker, offset by 1.5–10 Da (random sign).
        const base  = markerPool[Math.floor(rng() * markerPool.length)];
        const delta = 1.5 + rng() * 8.5;
        const sign  = rng() < 0.5 ? -1 : 1;
        let mz = base + sign * delta;

        // Clamp to the observed m/z range.
        if (mz < mzMin) mz = mzMin;
        if (mz > mzMax) mz = mzMax;

        // Reject if too close to any real marker (avoids deamid window contamination).
        if (isNear(realSorted, mz, minSepRealDa)) continue;

        // Reject if too close to an already-placed marker in this decoy.
        if (isNear(decoyMzSorted, mz, toleranceDa)) continue;

        insertSorted(decoyMzSorted, mz);
        markers.push({
          name: `DECOY_${String(i + 1).padStart(3, "0")}_${String(m + 1).padStart(2, "0")}`,
          mz,
        });
        placed = true;
        break;
      }

      // If placement failed after 200 attempts, accept a shorter decoy taxon.
      if (!placed) break;
    }

    decoys.push({ id: `decoy_${i + 1}`, label: `Decoy ${i + 1}`, markers });
  }

  return decoys;
}
