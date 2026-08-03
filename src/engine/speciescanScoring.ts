import type { AnalysisParams, Contaminant, ContaminantHit, MarkerMatchRow, Peak, RefTaxon, TaxonScore } from "./types";

export const DEFAULT_DEAMID_MARKERS = new Set<string>([
  "COL1a1_586___618",
  "COL1a1_586___618_16",
  "COL1_1_508_519",
  "COL1a2_502___519",
  "COL1a2_793___816",
]);

const EXACT_GRID_START_MZ = 500;
const EXACT_GRID_END_MZ = 3500;
const EXACT_GRID_STEP_MZ = 0.1;
const EXACT_GRID = Array.from(
  { length: Math.round((EXACT_GRID_END_MZ - EXACT_GRID_START_MZ) / EXACT_GRID_STEP_MZ) },
  (_, i) => EXACT_GRID_START_MZ + i * EXACT_GRID_STEP_MZ
);

function markerWindowForMode(markerName: string, params: AnalysisParams): { leftDa: number; rightDa: number } {
  if (params.analysisMode === "speciescan_benchmark") {
    return { leftDa: -0.4, rightDa: +0.4 };
  }
  if (params.analysisMode === "speciescan_exact") {
    return { leftDa: -1.3, rightDa: +0.3 };
  }
  const isDeamid = DEFAULT_DEAMID_MARKERS.has(markerName);
  return isDeamid
    ? { leftDa: -1.3, rightDa: +0.3 }
    : { leftDa: -0.3, rightDa: +0.3 };
}

function sampleWindowForMode(params: AnalysisParams): { leftDa: number; rightDa: number } {
  if (params.analysisMode === "speciescan_benchmark") {
    return { leftDa: -0.4, rightDa: +0.4 };
  }
  if (params.analysisMode === "speciescan_exact") {
    return { leftDa: -1.3, rightDa: +0.3 };
  }
  return { leftDa: -1.3, rightDa: +0.3 };
}

function vectorLength(params: AnalysisParams): number {
  const span = (params.grid.endMz - params.grid.startMz) / params.grid.stepMz;
  return params.analysisMode === "speciescan_exact" ? Math.round(span) : Math.round(span) + 1;
}

// Clamp an integer to an inclusive range.
function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function lowerBound(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Mark a window around an m/z in a binned binary vector.
function setWindowBinary(
  arr: Uint8Array,
  startMz: number,
  stepMz: number,
  mz: number,
  leftDa: number,
  rightDa: number,
  exactMode: boolean
) {
  const n = arr.length;
  const leftMz = mz + leftDa;
  const rightMz = mz + rightDa;

  if (exactMode && startMz === EXACT_GRID_START_MZ && stepMz === EXACT_GRID_STEP_MZ) {
    const i0 = clampInt(upperBound(EXACT_GRID, leftMz), 0, n);
    const i1 = clampInt(lowerBound(EXACT_GRID, rightMz), 0, n);
    for (let i = i0; i < i1; i++) arr[i] = 1;
    return;
  }

  let i0 = exactMode
    ? Math.floor((leftMz - startMz) / stepMz) + 1
    : Math.round((leftMz - startMz) / stepMz);
  let i1 = exactMode
    ? Math.ceil((rightMz - startMz) / stepMz)
    : Math.round((rightMz - startMz) / stepMz) + 1;

  i0 = clampInt(i0, 0, n);
  i1 = clampInt(i1, 0, n);

  for (let i = i0; i < i1; i++) arr[i] = 1;
}

// Build a binary presence vector for sample peaks on the scoring grid.
export function buildSampleVector(peaks: Peak[], params: AnalysisParams): Uint8Array {
  const { startMz, stepMz } = params.grid;
  const n = vectorLength(params);
  const x = new Uint8Array(n);
  const exactMode = params.analysisMode === "speciescan_exact";

  const window = sampleWindowForMode(params);
  for (const p of peaks) setWindowBinary(x, startMz, stepMz, p.mz, window.leftDa, window.rightDa, exactMode);
  return x;
}

// Build a binary presence vector for a taxon's reference markers.
export function buildTaxonVector(taxon: RefTaxon, params: AnalysisParams): Uint8Array {
  const { startMz, stepMz } = params.grid;
  const n = vectorLength(params);
  const y = new Uint8Array(n);
  const exactMode = params.analysisMode === "speciescan_exact";

  for (const m of taxon.markers) {
    const window = markerWindowForMode(m.name, params);
    setWindowBinary(y, startMz, stepMz, m.mz, window.leftDa, window.rightDa, exactMode);
  }
  return y;
}

// Compute Pearson correlation on binary vectors.
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

// Find the nearest peak to a target m/z within a tolerance window.
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

// Match picked peaks to a taxon's markers with SpecieScan tolerances.
export function markerMatchesForTaxon(peaks: Peak[], taxon: RefTaxon, params: AnalysisParams): MarkerMatchRow[] {
  const sorted = [...peaks].sort((a,b)=>a.mz-b.mz);
  return taxon.markers.map(m => {
    const window = markerWindowForMode(m.name, params);
    const best = nearestPeakWithin(sorted, m.mz, window.leftDa, window.rightDa);
    return {
      markerName: m.name,
      expectedMz: m.mz,
      matched: !!best,
      matchedPeakMz: best ? best.mz : null,
      matchedPeakIntensity: best ? best.intensity : null,
    };
  });
}

// Score all taxa against a sample using binary correlation.
export function scoreTaxa(peaks: Peak[], taxa: RefTaxon[], params: AnalysisParams): TaxonScore[] {
  const x = buildSampleVector(peaks, params);

  const scores: TaxonScore[] = [];
  for (const t of taxa) {
    const y = buildTaxonVector(t, params);
    const corr = pearsonCorrelationBinary(x, y);
    scores.push({ taxonId: t.id, taxonLabel: t.label, correlation: corr });
  }

  scores.sort((a, b) => {
    const delta = b.correlation - a.correlation;
    if (Math.abs(delta) > 1e-12) return delta;
    return b.taxonLabel.localeCompare(a.taxonLabel);
  });
  return scores;
}

// Locate contaminant peaks within a symmetric tolerance window.
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

// Collect matched peak m/z values (rounded) for quick lookup.
export function matchedPeakMzSetFromMatches(rows: MarkerMatchRow[]): Set<number> {
  const s = new Set<number>();
  for (const r of rows) {
    if (r.matched && r.matchedPeakMz !== null) s.add(Number(r.matchedPeakMz.toFixed(4)));
  }
  return s;
}
