import type { RefMarker, RefTaxon, SpeciescanDb } from "./types";

export type DecoyOptions = {
  nDecoys?: number;
  maxDecoys?: number;
  seed?: number;
  mzMin?: number;
  mzMax?: number;
  toleranceDa?: number;
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

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

function isNear(sorted: number[], mz: number, tol: number): boolean {
  if (!sorted.length) return false;
  const idx = lowerBound(sorted, mz);
  if (idx < sorted.length && Math.abs(sorted[idx] - mz) <= tol) return true;
  if (idx > 0 && Math.abs(sorted[idx - 1] - mz) <= tol) return true;
  return false;
}

function insertSorted(sorted: number[], mz: number) {
  const idx = lowerBound(sorted, mz);
  sorted.splice(idx, 0, mz);
}

export function buildDecoyTaxa(db: SpeciescanDb, opts: DecoyOptions = {}): RefTaxon[] {
  const markerPool = db.taxa.flatMap(t => t.markers.map(m => m.mz));
  if (!markerPool.length) return [];

  const markerCounts = db.taxa.map(t => t.markers.length).filter(k => k > 0);
  if (!markerCounts.length) return [];

  const maxDecoys = opts.maxDecoys ?? 1000;
  const nDecoys = Math.min(opts.nDecoys ?? Math.max(200, db.taxa.length), maxDecoys);
  const mzMin = opts.mzMin ?? Math.min(...markerPool);
  const mzMax = opts.mzMax ?? Math.max(...markerPool);
  const toleranceDa = opts.toleranceDa ?? 0.3;
  const minSepReal = toleranceDa * 2;

  const realSorted = [...markerPool].sort((a, b) => a - b);
  const rng = mulberry32(opts.seed ?? 1337);

  const decoys: RefTaxon[] = [];
  for (let i = 0; i < nDecoys; i++) {
    const k = markerCounts[Math.floor(rng() * markerCounts.length)] ?? 0;
    const decoyMzSorted: number[] = [];
    const markers: RefMarker[] = [];

    for (let m = 0; m < k; m++) {
      let placed = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const base = markerPool[Math.floor(rng() * markerPool.length)];
        const delta = 5 + rng() * 45;
        const sign = rng() < 0.5 ? -1 : 1;
        let mz = base + sign * delta;
        if (mz < mzMin) mz = mzMin;
        if (mz > mzMax) mz = mzMax;

        if (isNear(realSorted, mz, minSepReal)) continue;
        if (isNear(decoyMzSorted, mz, toleranceDa)) continue;

        insertSorted(decoyMzSorted, mz);
        markers.push({
          name: `DECOY_${String(i + 1).padStart(3, "0")}_${String(m + 1).padStart(2, "0")}`,
          mz,
        });
        placed = true;
        break;
      }
      if (!placed) break;
    }

    decoys.push({ id: `decoy_${i + 1}`, label: `Decoy ${i + 1}`, markers });
  }

  return decoys;
}
