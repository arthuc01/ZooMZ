import type { Peak } from "./types";
import { roundHalfEven } from "./rounding";

const BENCHMARK_ENV_LO = 800.0;
const BENCHMARK_ENV_HI = 3200.0;
const BENCHMARK_ENV_STEP = 0.1;
const BENCHMARK_ENV_N = 8;
const BENCHMARK_ENV_MASSES = Array.from(
  { length: roundHalfEven((BENCHMARK_ENV_HI - BENCHMARK_ENV_LO) / BENCHMARK_ENV_STEP) + 1 },
  (_, i) => BENCHMARK_ENV_LO + i * BENCHMARK_ENV_STEP
);
const BENCHMARK_ENV_LAMS = BENCHMARK_ENV_MASSES.map((mass) => Math.max(0.1, ((mass - 1.00728) * 1.000495) / 111.1));
const BENCHMARK_ENV_LOGFAC = (() => {
  const out = new Float64Array(BENCHMARK_ENV_N);
  for (let i = 1; i < BENCHMARK_ENV_N; i++) out[i] = out[i - 1] + Math.log(i);
  return out;
})();
const BENCHMARK_ENV_TABLE = BENCHMARK_ENV_LAMS.map((lambda) => {
  const raw = new Float64Array(BENCHMARK_ENV_N);
  let max = -Infinity;
  for (let k = 0; k < BENCHMARK_ENV_N; k++) {
    const lp = -lambda + k * Math.log(lambda) - BENCHMARK_ENV_LOGFAC[k];
    raw[k] = lp;
    if (lp > max) max = lp;
  }
  const env = new Float64Array(BENCHMARK_ENV_N);
  let peak = 0;
  for (let k = 0; k < BENCHMARK_ENV_N; k++) {
    env[k] = Math.exp(raw[k] - max);
    if (env[k] > peak) peak = env[k];
  }
  if (peak > 0) {
    for (let k = 0; k < BENCHMARK_ENV_N; k++) env[k] /= peak;
  }
  return env;
});

function lowerBound(sorted: Peak[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].mz < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function benchmarkEnvForMass(mass: number): Float64Array {
  let idx = roundHalfEven((mass - BENCHMARK_ENV_LO) / BENCHMARK_ENV_STEP);
  if (idx < 0) idx = 0;
  if (idx >= BENCHMARK_ENV_TABLE.length) idx = BENCHMARK_ENV_TABLE.length - 1;
  return BENCHMARK_ENV_TABLE[idx];
}

function pearsonCorr(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2 || y.length !== n) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;

  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  const denom = Math.sqrt(dx2 * dy2);
  return denom > 1e-12 ? num / denom : 0;
}

function normaliseSum(arr: number[]): number[] {
  const sum = arr.reduce((acc, value) => acc + value, 0);
  return sum > 0 ? arr.map((value) => value / sum) : arr.map(() => 0);
}

// Shared min-distance enforcer
function enforceMinDistance(peaks: Peak[], minPeakDistanceDa: number): Peak[] {
  peaks.sort((a, b) => a.mz - b.mz);
  const out: Peak[] = [];
  for (const p of peaks) {
    const last = out[out.length - 1];
    if (!last || Math.abs(p.mz - last.mz) >= minPeakDistanceDa) {
      out.push(p);
    } else if (p.intensity > last.intensity) {
      out[out.length - 1] = p;
    }
  }
  return out;
}

// Pick local maxima above a relative intensity threshold.
export function pickPeaks(
  mz: Float64Array,
  intensity: Float64Array,
  minRelativeIntensity: number,
  minPeakDistanceDa: number
): Peak[] {
  let maxI = 0;
  for (let i = 0; i < intensity.length; i++) maxI = Math.max(maxI, intensity[i]);
  const threshold = maxI * minRelativeIntensity;

  const peaks: Peak[] = [];
  for (let i = 1; i < intensity.length - 1; i++) {
    const y0 = intensity[i - 1];
    const y1 = intensity[i];
    const y2 = intensity[i + 1];
    if (y1 >= threshold && y1 >= y0 && y1 >= y2) peaks.push({ mz: mz[i], intensity: y1 });
  }

  return enforceMinDistance(peaks, minPeakDistanceDa);
}

/**
 * Simple monoisotopic filtering (greedy deisotoping).
 * Keep a peak and remove peaks at mz + n*distance within tolerance.
 * Preserved for backward compatibility; prefer keepMonoisotopicPeaksPoisson.
 */
export function keepMonoisotopicPeaks(
  peaks: Peak[],
  toleranceDa = 0.2,
  distanceDa = 1.00235,
  maxIsotopes = 10
): Peak[] {
  const sorted = [...peaks].sort((a, b) => a.mz - b.mz);
  const removed = new Array(sorted.length).fill(false);
  const keep: Peak[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (removed[i]) continue;
    const p = sorted[i];
    keep.push(p);
    for (let k = 1; k <= maxIsotopes; k++) {
      const target = p.mz + k * distanceDa;
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].mz > target + toleranceDa) break;
        if (Math.abs(sorted[j].mz - target) <= toleranceDa) removed[j] = true;
      }
    }
  }
  return keep;
}

// Local-SNR peak picking

/**
 * Pick local maxima using a local SNR criterion rather than a global
 * relative-intensity threshold.
 *
 * Matches MALDIquant's detectPeaks(method="SuperSmoother", SNR=3):
 * a peak is accepted when intensity[i] > snrThreshold * noise[i],
 * where noise is pre-computed (e.g. via estimateLocalNoise / second SNIP pass).
 *
 * @param mz               m/z array (profile spectrum, equally or unequally spaced).
 * @param intensity        Baseline-corrected and normalised intensities.
 * @param noise            Local noise estimate at each point (same length as intensity).
 * @param snrThreshold     Minimum intensity/noise ratio to accept a peak (MALDIquant default: 3).
 * @param minPeakDistanceDa Minimum separation between returned peaks in Da.
 */
export function pickPeaksLocalSNR(
  mz: Float64Array,
  intensity: Float64Array,
  noise: Float64Array,
  snrThreshold: number,
  minPeakDistanceDa: number
): Peak[] {
  const peaks: Peak[] = [];
  for (let i = 1; i < intensity.length - 1; i++) {
    const y1 = intensity[i];
    const localNoise = Math.max(noise[i], 1e-30);   // guard against /0
    if (
      y1 > snrThreshold * localNoise &&
      y1 >= intensity[i - 1] &&
      y1 >= intensity[i + 1]
    ) {
      peaks.push({ mz: mz[i], intensity: y1 });
    }
  }
  return enforceMinDistance(peaks, minPeakDistanceDa);
}

export function pickPeaksLocalSNRWindow(
  mz: Float64Array,
  intensity: Float64Array,
  noise: Float64Array,
  snrThreshold: number,
  halfWindowSize: number
): Peak[] {
  const peaks: Peak[] = [];
  const h = Math.max(1, Math.floor(halfWindowSize));
  for (let i = h; i < intensity.length - h; i++) {
    const y1 = intensity[i];
    const localNoise = Math.max(noise[i], 1e-30);
    if (!(y1 > snrThreshold * localNoise)) continue;

    let isLocalMax = true;
    for (let j = i - h; j <= i + h; j++) {
      if (j === i) continue;
      if (intensity[j] > y1) {
        isLocalMax = false;
        break;
      }
    }
    if (isLocalMax) peaks.push({ mz: mz[i], intensity: y1 });
  }
  return peaks;
}

/**
 * Pick local maxima using a local SNR criterion and enforce a minimum peak
 * separation in array indices rather than Daltons.
 *
 * This mirrors the Python exact-validation path more closely, where
 * scipy.signal.find_peaks(distance=...) operates on sample points.
 */
export function pickPeaksLocalSNRByIndexDistance(
  mz: Float64Array,
  intensity: Float64Array,
  noise: Float64Array,
  snrThreshold: number,
  minPeakDistancePts: number
): Peak[] {
  const candidates: { idx: number; mz: number; intensity: number }[] = [];
  for (let i = 1; i < intensity.length - 1; i++) {
    const y1 = intensity[i];
    const localNoise = Math.max(noise[i], 1e-30);
    if (
      y1 > snrThreshold * localNoise &&
      y1 >= intensity[i - 1] &&
      y1 >= intensity[i + 1]
    ) {
      candidates.push({ idx: i, mz: mz[i], intensity: y1 });
    }
  }

  if (!candidates.length) return [];

  const ordered = [...candidates].sort((a, b) => b.intensity - a.intensity);
  const kept: { idx: number; mz: number; intensity: number }[] = [];
  const minDist = Math.max(1, Math.floor(minPeakDistancePts));

  for (const cand of ordered) {
    let tooClose = false;
    for (const prev of kept) {
      if (Math.abs(cand.idx - prev.idx) < minDist) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) kept.push(cand);
  }

  return kept
    .sort((a, b) => a.mz - b.mz)
    .map((p) => ({ mz: p.mz, intensity: p.intensity }));
}

/**
 * Pick peaks by prominence — a scale-invariant quality metric.
 *
 * Prominence of a peak = its height minus the highest of the two base levels
 * found by tracing down each side until a higher peak (or the edge) is reached.
 * This is identical to scipy.signal.peak_prominences and topographic prominence.
 *
 * On the dense 0.1 Da/pt resampled grid produced by the ZooMZ preprocessor,
 * SNIP-20 noise ≈ 0 everywhere (the bin-summed background fills every bin), so
 * an SNR gate passes ~1400 raw peaks. Prominence correctly ranks peaks by how
 * much they stand out locally, regardless of the absolute noise floor.
 *
 * Algorithm (O(n) with monotonic stack):
 *   1. Find all local maxima (each index i where intensity[i] ≥ neighbours).
 *   2. For each peak, trace left/right until a strictly higher sample is found;
 *      the base on each side is the minimum of the signal over that interval.
 *   3. Prominence = peakHeight − max(leftBase, rightBase).
 *   4. Sort by descending prominence, keep top `maxPeaks`, enforce min distance.
 *
 * @param mz               m/z array.
 * @param intensity        Baseline-corrected TIC-normalised intensity array.
 * @param minPeakDistanceDa Minimum m/z separation between returned peaks.
 * @param maxPeaks         Maximum number of peaks to return (default 250 before
 *                         deisotoping, or 100 for final output).
 */
export function pickPeaksByProminence(
  mz: Float64Array,
  intensity: Float64Array,
  minPeakDistanceDa: number,
  maxPeaks = 250
): Peak[] {
  return pickBenchmarkPeaksByProminenceInternal(mz, intensity, minPeakDistanceDa, maxPeaks, false);
}

function pickBenchmarkPeaksByProminenceInternal(
  mz: Float64Array,
  intensity: Float64Array,
  minPeakDistanceDa: number,
  maxPeaks: number,
  strictLocalMaxima: boolean
): Peak[] {
  const n = intensity.length;
  if (n < 3) return [];

  // Step 1: find all local maxima
  const peakIdx: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const left = intensity[i - 1];
    const mid = intensity[i];
    const right = intensity[i + 1];
    if (strictLocalMaxima ? (mid > left && mid > right) : (mid >= left && mid >= right)) {
      peakIdx.push(i);
    }
  }
  if (peakIdx.length === 0) return [];

  // Step 2-3: compute prominence for each peak
  // Left base: minimum intensity between this peak and the nearest higher peak to the left.
  // Right base: minimum intensity between this peak and the nearest higher peak to the right.
  const prominences = new Float64Array(peakIdx.length);
  for (let pi = 0; pi < peakIdx.length; pi++) {
    const idx = peakIdx[pi];
    const h   = intensity[idx];

    // Left side: scan left until intensity > h or edge
    let leftBase = h;
    for (let j = idx - 1; j >= 0; j--) {
      if (intensity[j] > h) break;
      if (intensity[j] < leftBase) leftBase = intensity[j];
    }

    // Right side: scan right until intensity > h or edge
    let rightBase = h;
    for (let j = idx + 1; j < n; j++) {
      if (intensity[j] > h) break;
      if (intensity[j] < rightBase) rightBase = intensity[j];
    }

    prominences[pi] = h - Math.max(leftBase, rightBase);
  }

  // Step 4: sort by descending prominence, keep top maxPeaks
  const order = Array.from({ length: peakIdx.length }, (_, i) => i)
    .sort((a, b) => prominences[b] - prominences[a]);

  const raw: Peak[] = order
    .slice(0, maxPeaks)
    .map(pi => ({ mz: mz[peakIdx[pi]], intensity: intensity[peakIdx[pi]] }));

  return enforceMinDistance(raw, minPeakDistanceDa);
}

/**
 * Benchmark peak picker mirroring the Track B validation peak path:
 * local maxima on the 0.1 Da grid, minimum 0.5 Da separation by index,
 * top peaks by prominence, then downstream monoisotopic filtering.
 */
export function pickBenchmarkPeaksByProminence(
  mz: Float64Array,
  intensity: Float64Array,
  minPeakDistanceDa: number,
  maxPeaks = 250
): Peak[] {
  return pickBenchmarkPeaksByProminenceInternal(mz, intensity, minPeakDistanceDa, maxPeaks, false);
}

/**
 * SciPy-like exact peak picker for the Speciescan exact path.
 * Uses strict local maxima so flat zero plateaus are not promoted to peaks.
 */
export function pickBenchmarkPeaksByProminenceExact(
  mz: Float64Array,
  intensity: Float64Array,
  minPeakDistanceDa: number,
  maxPeaks = 250
): Peak[] {
  const n = intensity.length;
  if (n < 3) return [];

  const minDistPts = Math.max(1, roundHalfEven(minPeakDistanceDa / BENCHMARK_ENV_STEP));

  const peakIdx: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (intensity[i] >= intensity[i - 1] && intensity[i] >= intensity[i + 1]) {
      peakIdx.push(i);
    }
  }
  if (peakIdx.length === 0) return [];

  const orderByHeight = [...peakIdx].sort((a, b) => intensity[b] - intensity[a]);
  const distanceKept: number[] = [];
  for (const idx of orderByHeight) {
    let tooClose = false;
    for (const kept of distanceKept) {
      if (Math.abs(idx - kept) < minDistPts) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) distanceKept.push(idx);
  }

  const prominences = new Float64Array(distanceKept.length);
  for (let pi = 0; pi < distanceKept.length; pi++) {
    const idx = distanceKept[pi];
    const h = intensity[idx];

    let leftBase = h;
    for (let j = idx - 1; j >= 0; j--) {
      if (intensity[j] > h) break;
      if (intensity[j] < leftBase) leftBase = intensity[j];
    }

    let rightBase = h;
    for (let j = idx + 1; j < n; j++) {
      if (intensity[j] > h) break;
      if (intensity[j] < rightBase) rightBase = intensity[j];
    }

    prominences[pi] = h - Math.max(leftBase, rightBase);
  }

  const order = Array.from({ length: distanceKept.length }, (_, i) => i)
    .sort((a, b) => prominences[b] - prominences[a])
    .slice(0, maxPeaks);

  const raw: Peak[] = order.map((pi) => ({ mz: mz[distanceKept[pi]], intensity: intensity[distanceKept[pi]] }));
  return raw.sort((a, b) => a.mz - b.mz);
}

/**
 * Benchmark monoisotopic filter mirroring the Track B validation peak path.
 * Keeps any peak that is not marked as an isotope satellite and only removes
 * satellites of accepted Poisson-like clusters.
 */
export function keepMonoisotopicPeaksPythonProxy(
  peaks: Peak[],
  minCor = 0.95,
  minSize = 2,
  maxSize = 10,
  targetMax = 100
): Peak[] {
  if (!peaks.length) return peaks;

  const sorted = [...peaks].sort((a, b) => a.mz - b.mz);
  const n = sorted.length;
  const satellite = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    if (satellite[i]) continue;

    const mass = sorted[i].mz;
    const env = benchmarkEnvForMass(mass);
    const cluster: number[] = [i];

    for (let k = 1; k < maxSize; k++) {
      const target = mass + k * 1.00235;
      let j = lowerBound(sorted, target);
      let found = -1;
      const tol = Math.max(0.05, Math.min(0.35, 1e-4 * mass));

      for (const jj of [j - 1, j]) {
        if (jj < 0 || jj >= n) continue;
        if (
          Math.abs(sorted[jj].mz - target) <= tol &&
          sorted[jj].intensity <= sorted[cluster[cluster.length - 1]].intensity * 1.1
        ) {
          found = jj;
          break;
        }
      }

      if (found < 0) break;
      cluster.push(found);
    }

    if (cluster.length < minSize) continue;

    const obs = cluster.map((idx) => sorted[idx].intensity);
    const th = Math.min(obs.length, env.length);
    const obsSlice = obs.slice(0, th);
    const exp = Array.from(env.slice(0, th));
    const maxExp = Math.max(...exp);
    if (maxExp > 0) {
      const maxObs = Math.max(...obsSlice);
      for (let k = 0; k < th; k++) exp[k] = (exp[k] / maxExp) * maxObs;
    }
    const cor = pearsonCorr(normaliseSum(obsSlice), normaliseSum(exp));

    if (cor >= minCor) {
      for (let c = 1; c < cluster.length; c++) satellite[cluster[c]] = 1;
    }
  }

  const kept = sorted.filter((_, i) => !satellite[i]);
  if (kept.length <= targetMax) return kept;

  return [...kept]
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, targetMax)
    .sort((a, b) => a.mz - b.mz);
}

// Poisson-envelope monoisotopic filter

// Poisson mean (lambda) as a function of mass -- Breen et al. 2000.
function poissonLambda(mass: number): number {
  return 0.000594 * mass + 0.03091;
}

// Poisson PMF: P(X = k | lambda). Uses log-space for numerical stability.
function dpois(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);   // subtract log(k!)
  return Math.exp(logP);
}

/**
 * Monoisotopic peak filtering using Poisson-envelope correlation.
 *
 * Implements the MALDIquant monoisotopicPeaks algorithm (Breen et al. 2000):
 *   1. For each candidate monoisotopic peak at mass m, build isotope clusters
 *      of size minSize..maxSize by looking for peaks at m + k*distanceDa.
 *   2. Compare observed relative intensities against the theoretical Poisson
 *      envelope (lambda = 0.000594*m + 0.03091).
 *   3. Accept the cluster -- and mark isotope satellites for removal -- when the
 *      Pearson correlation >= minCor.
 *
 * Peaks that start an accepted cluster are kept (monoisotopic).
 * Peaks that are isotope satellites of an accepted cluster are removed.
 * Peaks that cannot start any accepted cluster are either kept (requireCluster=false,
 * default) or removed (requireCluster=true, strict MALDIquant behaviour).
 *
 * @param peaks           Input peak list (any order).
 * @param minCor          Minimum Pearson r to accept an isotope cluster (default 0.95).
 * @param toleranceDa     Absolute m/z tolerance for finding isotope partners (default 0.25 Da).
 * @param distanceDa      Expected isotope spacing in Da (default 1.00235, neutron mass).
 * @param minSize         Minimum cluster size to test (default 2).
 * @param maxSize         Maximum cluster size to test (default 10).
 * @param requireCluster  If true, drop peaks with no confirmed isotope cluster.
 *                        Matches strict MALDIquant behaviour; default false is more lenient.
 */
export function keepMonoisotopicPeaksPoisson(
  peaks: Peak[],
  minCor = 0.95,
  toleranceDa = 0.25,
  distanceDa = 1.00235,
  minSize = 2,
  maxSize = 10,
  requireCluster = false
): Peak[] {
  if (peaks.length === 0) return peaks;
  const sorted = [...peaks].sort((a, b) => a.mz - b.mz);
  const n = sorted.length;
  const isSatellite    = new Uint8Array(n);   // 1 = confirmed isotope satellite
  const isMonoisotopic = new Uint8Array(n);   // 1 = confirmed monoisotopic

  for (let i = 0; i < n; i++) {
    if (isSatellite[i]) continue;

    const mass   = sorted[i].mz;
    const lambda = poissonLambda(mass);

    // Try cluster sizes from largest down to smallest (like MALDIquant)
    for (let size = maxSize; size >= minSize; size--) {
      const clusterIdx: number[] = [i];
      let complete = true;

      for (let k = 1; k < size; k++) {
        const target = mass + k * distanceDa;
        let bestJ = -1, bestDist = Infinity;
        for (let j = i + 1; j < n; j++) {
          if (sorted[j].mz > target + toleranceDa) break;
          const d = Math.abs(sorted[j].mz - target);
          if (d <= toleranceDa && d < bestDist) { bestDist = d; bestJ = j; }
        }
        if (bestJ < 0) { complete = false; break; }
        clusterIdx.push(bestJ);
      }

      if (!complete) continue;

      // Poisson correlation check
      const obsRaw  = clusterIdx.map(idx => sorted[idx].intensity);
      const theoRaw = Array.from({ length: size }, (_, k) => dpois(k, lambda));
      const r = pearsonCorr(normaliseSum(obsRaw), normaliseSum(theoRaw));

      if (r >= minCor) {
        isMonoisotopic[i] = 1;
        for (let ci = 1; ci < clusterIdx.length; ci++) isSatellite[clusterIdx[ci]] = 1;
        break;  // accepted -- no need to try smaller sizes
      }
    }
  }

  return sorted.filter((_, i) => {
    if (isSatellite[i]) return false;       // definitely remove
    if (isMonoisotopic[i]) return true;     // definitely keep
    return !requireCluster;                 // unconfirmed: keep unless strict mode
  });
}

/**
 * MALDIquant-style monoisotopic peak selector.
 *
 * This mirrors MALDIquant's .monoisotopic() / .monoisotopicPattern():
 * cluster sizes are tested from largest to smallest, isotopic partner matching
 * uses a mass-relative tolerance (mass * tolerance), and only peaks that begin
 * a confirmed isotope cluster are returned.
 */
export function keepMonoisotopicPeaksMALDIquant(
  peaks: Peak[],
  minCor = 0.95,
  tolerance = 1e-4,
  distanceDa = 1.00235,
  minSize = 2,
  maxSize = 10
): Peak[] {
  if (!peaks.length) return [];

  const sorted = [...peaks].sort((a, b) => a.mz - b.mz);
  const acceptedBySize: Array<Array<number[]>> = [];

  for (let size = maxSize; size >= minSize; size--) {
    const accepted: number[][] = [];

    for (let i = 0; i < sorted.length; i++) {
      const mass = sorted[i].mz;
      const tolDa = mass * tolerance;
      const cluster: number[] = [i];
      let complete = true;

      for (let k = 1; k < size; k++) {
        const target = mass + k * distanceDa;
        const start = lowerBound(sorted, target - tolDa);
        let bestIdx = -1;
        let bestDist = Infinity;

        for (let j = start; j < sorted.length; j++) {
          const delta = sorted[j].mz - target;
          if (delta > tolDa) break;
          const absDelta = Math.abs(delta);
          if (absDelta <= tolDa && absDelta < bestDist) {
            bestDist = absDelta;
            bestIdx = j;
          }
        }

        if (bestIdx < 0) {
          complete = false;
          break;
        }
        cluster.push(bestIdx);
      }

      if (!complete) continue;

      const obs = normaliseSum(cluster.map((idx) => sorted[idx].intensity));
      const theo = normaliseSum(Array.from({ length: size }, (_, k) => dpois(k, poissonLambda(mass))));
      if (pearsonCorr(obs, theo) > minCor) accepted.push(cluster);
    }

    if (!accepted.length) {
      acceptedBySize.push([]);
      continue;
    }

    const seenWithinSize = new Set<number>();
    const dedupedWithinSize: Array<number[]> = [];
    for (const cluster of accepted) {
      const filtered = cluster.map((idx) => {
        if (seenWithinSize.has(idx)) return -1;
        seenWithinSize.add(idx);
        return idx;
      });
      if (filtered.every((idx) => idx >= 0)) dedupedWithinSize.push(filtered);
    }
    acceptedBySize.push(dedupedWithinSize);
  }

  const seenAcrossSizes = new Set<number>();
  const monoisotopicIdx: number[] = [];
  for (const clusters of acceptedBySize) {
    for (const cluster of clusters) {
      if (cluster.some((idx) => seenAcrossSizes.has(idx))) continue;
      for (const idx of cluster) seenAcrossSizes.add(idx);
      monoisotopicIdx.push(cluster[0]);
    }
  }

  monoisotopicIdx.sort((a, b) => a - b);
  return monoisotopicIdx.map((idx) => sorted[idx]);
}
