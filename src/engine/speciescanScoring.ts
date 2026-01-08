import type { AnalysisParams, Contaminant, ContaminantHit, MarkerMatchRow, Peak, RefTaxon, TaxonScore } from "./types";

export const DEFAULT_DEAMID_MARKERS = new Set<string>([
  "COL1a1_586___618",
  "COL1a1_586___618_16",
  "COL1_1_508_519",
  "COL1a2_502___519",
  "COL1a2_793___816",
]);

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function setWindowBinary(arr: Uint8Array, startMz: number, stepMz: number, mz: number, leftDa: number, rightDa: number) {
  const n = arr.length;
  const leftMz = mz + leftDa;
  const rightMz = mz + rightDa;

  let i0 = Math.ceil((leftMz - startMz) / stepMz);
  let i1 = Math.floor((rightMz - startMz) / stepMz);

  i0 = clampInt(i0, 0, n - 1);
  i1 = clampInt(i1, 0, n - 1);

  for (let i = i0; i <= i1; i++) arr[i] = 1;
}

export function buildSampleVector(peaks: Peak[], params: AnalysisParams): Uint8Array {
  const { startMz, endMz, stepMz } = params.grid;
  const n = Math.floor((endMz - startMz) / stepMz);
  const x = new Uint8Array(n);

  // SpecieScan: for each peak p, set 1 where (p-x) in (-0.3, +1.3) => x in (p-1.3, p+0.3)
  for (const p of peaks) setWindowBinary(x, startMz, stepMz, p.mz, -1.3, +0.3);
  return x;
}

export function buildTaxonVector(taxon: RefTaxon, params: AnalysisParams): Uint8Array {
  const { startMz, endMz, stepMz } = params.grid;
  const n = Math.floor((endMz - startMz) / stepMz);
  const y = new Uint8Array(n);

  for (const m of taxon.markers) {
    const isDeamid = DEFAULT_DEAMID_MARKERS.has(m.name);
    if (isDeamid) setWindowBinary(y, startMz, stepMz, m.mz, -1.3, +0.3);
    else setWindowBinary(y, startMz, stepMz, m.mz, -0.3, +0.3);
  }
  return y;
}

export function pearsonCorrelationBinary(x: Uint8Array, y: Uint8Array): number {
  const n = x.length;
  if (y.length !== n) throw new Error("Vector length mismatch");

  let sumX = 0, sumY = 0, sumXY = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    sumX += xi;
    sumY += yi;
    sumXY += (xi & yi);
  }

  const meanX = sumX / n;
  const meanY = sumY / n;

  const varX = meanX - meanX * meanX;
  const varY = meanY - meanY * meanY;

  if (varX <= 0 || varY <= 0) return 0;

  const cov = (sumXY / n) - (meanX * meanY);
  return cov / Math.sqrt(varX * varY);
}

function nearestPeakWithin(peaksSorted: Peak[], targetMz: number, leftDa: number, rightDa: number): Peak | null {
  const minMz = targetMz + leftDa;
  const maxMz = targetMz + rightDa;

  let lo = 0, hi = peaksSorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (peaksSorted[mid].mz < minMz) lo = mid + 1;
    else hi = mid;
  }

  let best: Peak | null = null;
  let bestDist = Infinity;
  for (let i = lo; i < peaksSorted.length; i++) {
    const p = peaksSorted[i];
    if (p.mz > maxMz) break;
    const d = Math.abs(p.mz - targetMz);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

export function markerMatchesForTaxon(peaks: Peak[], taxon: RefTaxon): MarkerMatchRow[] {
  const sorted = [...peaks].sort((a,b)=>a.mz-b.mz);
  return taxon.markers.map(m => {
    const isDeamid = DEFAULT_DEAMID_MARKERS.has(m.name);
    const left = isDeamid ? -1.3 : -0.3;
    const right = +0.3;
    const best = nearestPeakWithin(sorted, m.mz, left, right);
    return {
      markerName: m.name,
      expectedMz: m.mz,
      matched: !!best,
      matchedPeakMz: best ? best.mz : null,
      matchedPeakIntensity: best ? best.intensity : null,
    };
  });
}

export function scoreTaxa(peaks: Peak[], taxa: RefTaxon[], params: AnalysisParams): TaxonScore[] {
  const x = buildSampleVector(peaks, params);

  const scores: TaxonScore[] = [];
  for (const t of taxa) {
    const y = buildTaxonVector(t, params);
    const corr = pearsonCorrelationBinary(x, y);
    scores.push({ taxonId: t.id, taxonLabel: t.label, correlation: corr });
  }

  scores.sort((a,b)=>b.correlation - a.correlation);
  return scores;
}

export function matchContaminants(peaks: Peak[], contaminants: Contaminant[], tolDa: number): ContaminantHit[] {
  const sorted = [...peaks].sort((a,b)=>a.mz-b.mz);
  const hits: ContaminantHit[] = [];
  for (const c of contaminants) {
    const best = nearestPeakWithin(sorted, c.mz, -tolDa, +tolDa);
    if (!best) continue;
    hits.push({ name: c.name, expectedMz: c.mz, matchedPeakMz: best.mz, deltaDa: best.mz - c.mz, intensity: best.intensity });
  }
  hits.sort((a,b)=>b.intensity-a.intensity);
  return hits;
}

export function matchedPeakMzSetFromMatches(rows: MarkerMatchRow[]): Set<number> {
  const s = new Set<number>();
  for (const r of rows) {
    if (r.matched && r.matchedPeakMz !== null) s.add(Number(r.matchedPeakMz.toFixed(4)));
  }
  return s;
}
