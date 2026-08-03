import { roundHalfEven } from "./rounding";

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

export function buildRegularGrid(startMz: number, endMz: number, stepMz: number): Float64Array {
  const n = Math.floor((endMz - startMz) / stepMz) + 1;
  const mz = new Float64Array(n);
  for (let i = 0; i < n; i++) mz[i] = startMz + i * stepMz;
  return mz;
}

export function resampleToGrid(
  mz: Float64Array,
  intensity: Float64Array,
  startMz: number,
  endMz: number,
  stepMz: number
): { mz: Float64Array; intensity: Float64Array } {
  const gridMz = buildRegularGrid(startMz, endMz, stepMz);
  const gridIntensity = new Float64Array(gridMz.length);
  for (let i = 0; i < mz.length; i++) {
    const x = mz[i];
    if (x < startMz || x > endMz) continue;
    const idx = roundHalfEven((x - startMz) / stepMz);
    if (idx >= 0 && idx < gridIntensity.length) gridIntensity[idx] += intensity[i];
  }
  return { mz: gridMz, intensity: gridIntensity };
}

export function averageIntensityArrays(arrays: Float64Array[]): Float64Array {
  if (!arrays.length) return new Float64Array(0);
  const out = new Float64Array(arrays[0].length);
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i++) out[i] += arr[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= arrays.length;
  return out;
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

// Normalize intensities by Total Ion Current (divide by sum).
// Matches SpecieScan calibrateIntensity(method="TIC") from MALDIquant.
export function normalizeTIC(intensity: Float64Array): Float64Array {
  let total = 0;
  for (let i = 0; i < intensity.length; i++) total += intensity[i];
  if (total <= 0) return new Float64Array(intensity);
  const out = new Float64Array(intensity.length);
  for (let i = 0; i < intensity.length; i++) out[i] = intensity[i] / total;
  return out;
}

// Invert a square matrix using Gauss-Jordan elimination.
function gaussJordan(M: number[][], n: number): number[][] {
  const A: number[][] = M.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0)),
  ]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[maxRow][col])) maxRow = r;
    }
    const _swapRow = A[col]; A[col] = A[maxRow]; A[maxRow] = _swapRow;
    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-14) continue;
    for (let j = 0; j < 2 * n; j++) A[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map(row => row.slice(n));
}

function sgCoefficientMatrix(halfWindow: number, polyOrder: number): Float64Array[] {
  const m = halfWindow;
  const n = 2 * m + 1;
  const p = polyOrder + 1;
  const matrix = Array.from({ length: n }, () => new Float64Array(n));

  for (let row = 0; row <= m; row++) {
    const X: number[][] = Array.from({ length: n }, (_, i) => {
      const x = i - row;
      return Array.from({ length: p }, (_, k) => Math.pow(x, k));
    });
    const XtX: number[][] = Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) =>
        X.reduce((sum, xRow) => sum + xRow[a] * xRow[b], 0)
      )
    );
    const inv = gaussJordan(XtX, p);
    for (let col = 0; col < n; col++) {
      let value = 0;
      for (let a = 0; a < p; a++) value += inv[0][a] * X[col][a];
      matrix[row][col] = value;
    }
  }

  for (let row = m + 1; row < n; row++) {
    const source = matrix[n - 1 - row];
    const reversed = new Float64Array(n);
    for (let col = 0; col < n; col++) reversed[col] = source[n - 1 - col];
    matrix[row] = reversed;
  }

  return matrix;
}

const _sgMatrixCache = new Map<string, Float64Array[]>();
function getCachedSGMatrix(halfWindow: number, polyOrder: number): Float64Array[] {
  const key = `${halfWindow}:${polyOrder}`;
  if (!_sgMatrixCache.has(key)) _sgMatrixCache.set(key, sgCoefficientMatrix(halfWindow, polyOrder));
  return _sgMatrixCache.get(key)!;
}

/**
 * Apply Savitzky-Golay smoothing.
 * Matches MALDIquant smoothIntensity(method="SavitzkyGolay", halfWindowSize).
 * polyOrder defaults to 2 (quadratic, MALDIquant default).
 */
export function smoothSavitzkyGolay(
  intensity: Float64Array,
  halfWindow: number,
  polyOrder = 2
): Float64Array {
  const m = halfWindow;
  const n = intensity.length;
  if (n < 2 * m + 1) return new Float64Array(intensity);
  const coeffs = getCachedSGMatrix(m, polyOrder);
  const windowSize = 2 * m + 1;
  const out = new Float64Array(n);

  for (let i = 0; i < m; i++) {
    let v = 0;
    const row = coeffs[i];
    for (let k = 0; k < windowSize; k++) v += row[k] * intensity[k];
    out[i] = Math.max(0, v);
  }

  const centerRow = coeffs[m];
  for (let i = m; i < n - m; i++) {
    let v = 0;
    for (let k = 0; k < windowSize; k++) v += centerRow[k] * intensity[i - m + k];
    out[i] = Math.max(0, v);
  }

  for (let i = n - m; i < n; i++) {
    let v = 0;
    const row = coeffs[m + 1 + (i - (n - m))];
    const start = n - windowSize;
    for (let k = 0; k < windowSize; k++) v += row[k] * intensity[start + k];
    out[i] = Math.max(0, v);
  }
  return out;
}

/**
 * SNIP baseline estimation in sqrt space with ASCENDING window.
 *
 * Matches MALDIquant removeBaseline(method="SNIP", decreasing=FALSE) —
 * the default. Uses Anscombe/Poisson sqrt transform (not log1p) and
 * ascending window (k = 1..iterations), exactly as in MALDIquant's R source.
 */
export function snipBaseline(
  intensity: Float64Array,
  iterations: number,
  decreasing = false
): Float64Array {
  const n = intensity.length;
  if (n < 3) return new Float64Array(intensity);
  const maxIter = Math.max(1, Math.min(iterations, Math.floor(n / 2) - 1));

  // sqrt (Anscombe) transform — clamp to zero first
  let prev = new Float64Array(n);
  for (let i = 0; i < n; i++) prev[i] = Math.sqrt(Math.max(0, intensity[i]));
  let next = new Float64Array(n);

  const iterOrder: number[] = [];
  if (decreasing) {
    for (let k = maxIter; k >= 1; k--) iterOrder.push(k);
  } else {
    for (let k = 1; k <= maxIter; k++) iterOrder.push(k);
  }

  for (const k of iterOrder) {
    for (let i = 0; i < n; i++) {
      const left = i < k ? prev[i] : prev[i - k];
      const right = i >= n - k ? prev[i] : prev[i + k];
      const avg = 0.5 * (left + right);
      next[i] = avg < prev[i] ? avg : prev[i];
    }
    const tmp = prev; prev = next; next = tmp;
  }

  // Square back to intensity space
  const baseline = new Float64Array(n);
  for (let i = 0; i < n; i++) { const v = prev[i]; baseline[i] = v * v; }
  return baseline;
}

// ─── SuperSmoother noise estimator ────────────────────────────────────────────

const SUPSMU_SPANS: [number, number, number] = [0.05, 0.2, 0.5];
const SUPSMU_BIG = 1e20;
const SUPSMU_SMALL = 1e-7;
const SUPSMU_EPS = 1e-3;

function smoothSuperSmoother(
  x: Float64Array,
  y: Float64Array,
  span: number,
  withAcvr: boolean,
  vsmlsq: number,
  out: Float64Array,
  acvr?: Float64Array
): void {
  const n = y.length;
  let ibw = Math.floor(0.5 * span * n + 0.5);
  if (ibw < 2) ibw = 2;
  const it = 2 * ibw + 1;

  let xm = 0;
  let ym = 0;
  let variance = 0;
  let covariance = 0;
  let totalWeight = 0;

  for (let i = 0; i < Math.min(it, n); i++) {
    const xi = x[i];
    const yi = y[i];
    const prevWeight = totalWeight;
    totalWeight += 1;
    xm = (prevWeight * xm + xi) / totalWeight;
    ym = (prevWeight * ym + yi) / totalWeight;
    if (prevWeight > 0) {
      const tmp = totalWeight * (xi - xm) / prevWeight;
      variance += tmp * (xi - xm);
      covariance += tmp * (yi - ym);
    }
  }

  for (let j = 0; j < n; j++) {
    const outIdx = j - ibw - 1;
    const inIdx = j + ibw;

    if (!(outIdx < 0 || inIdx >= n)) {
      const xo = x[outIdx];
      const yo = y[outIdx];
      const prevWeight = totalWeight;
      totalWeight -= 1;
      if (totalWeight > 0) {
        const tmp = prevWeight * (xo - xm) / totalWeight;
        variance -= tmp * (xo - xm);
        covariance -= tmp * (yo - ym);
        xm = (prevWeight * xm - xo) / totalWeight;
        ym = (prevWeight * ym - yo) / totalWeight;
      } else {
        xm = 0;
        ym = 0;
        variance = 0;
        covariance = 0;
      }

      const xi = x[inIdx];
      const yi = y[inIdx];
      const weightBeforeAdd = totalWeight;
      totalWeight += 1;
      xm = (weightBeforeAdd * xm + xi) / totalWeight;
      ym = (weightBeforeAdd * ym + yi) / totalWeight;
      if (weightBeforeAdd > 0) {
        const tmp = totalWeight * (xi - xm) / weightBeforeAdd;
        variance += tmp * (xi - xm);
        covariance += tmp * (yi - ym);
      }
    }

    let slope = 0;
    if (variance > vsmlsq) slope = covariance / variance;
    out[j] = slope * (x[j] - xm) + ym;

    if (!withAcvr || !acvr) continue;

    let leverage = totalWeight > 0 ? 1 / totalWeight : 0;
    if (variance > vsmlsq) leverage += ((x[j] - xm) * (x[j] - xm)) / variance;
    const adj = 1 - leverage;
    if (adj > 0) acvr[j] = Math.abs(y[j] - out[j]) / adj;
    else if (j > 0) acvr[j] = acvr[j - 1];
    else acvr[j] = 0;
  }

  let j = 0;
  while (j < n) {
    const j0 = j;
    let sumY = out[j];
    let sumW = 1;
    while (j + 1 < n && x[j + 1] <= x[j]) {
      j++;
      sumY += out[j];
      sumW += 1;
    }
    if (j > j0) {
      const avg = sumY / sumW;
      for (let i = j0; i <= j; i++) out[i] = avg;
    }
    j++;
  }
}

/**
 * SuperSmoother noise estimator matching MALDIquant's use of stats::supsmu().
 *
 * This ports the non-periodic, equal-weight path of Friedman's original
 * supersmoother that R exposes via stats::supsmu(x, y). MALDIquant calls this
 * directly for estimateNoise(method="SuperSmoother"), without using the peak
 * picker's halfWindowSize parameter.
 */
export function superSmoother(intensity: Float64Array): Float64Array {
  const n = intensity.length;
  if (n === 0) return new Float64Array(0);
  if (n === 1) return new Float64Array(intensity);

  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = i + 1;

  const i = Math.max(0, Math.floor(n / 4) - 1);
  const j = Math.min(n - 1, 3 * Math.floor(n / 4) - 1);
  const scale = x[j] - x[i];
  const vsmlsq = (SUPSMU_EPS * Math.max(scale, 1)) ** 2;

  const smooth05 = new Float64Array(n);
  const smooth20 = new Float64Array(n);
  const smooth50 = new Float64Array(n);
  const cv05 = new Float64Array(n);
  const cv20 = new Float64Array(n);
  const cv50 = new Float64Array(n);
  const scratch = new Float64Array(n);

  smoothSuperSmoother(x, intensity, SUPSMU_SPANS[0], true, vsmlsq, smooth05, scratch);
  smoothSuperSmoother(x, scratch, SUPSMU_SPANS[1], false, vsmlsq, cv05);

  smoothSuperSmoother(x, intensity, SUPSMU_SPANS[1], true, vsmlsq, smooth20, scratch);
  smoothSuperSmoother(x, scratch, SUPSMU_SPANS[1], false, vsmlsq, cv20);

  smoothSuperSmoother(x, intensity, SUPSMU_SPANS[2], true, vsmlsq, smooth50, scratch);
  smoothSuperSmoother(x, scratch, SUPSMU_SPANS[1], false, vsmlsq, cv50);

  const bestSpan = new Float64Array(n);
  for (let idx = 0; idx < n; idx++) {
    let resmin = SUPSMU_BIG;
    let span = SUPSMU_SPANS[0];
    if (cv05[idx] < resmin) {
      resmin = cv05[idx];
      span = SUPSMU_SPANS[0];
    }
    if (cv20[idx] < resmin) {
      resmin = cv20[idx];
      span = SUPSMU_SPANS[1];
    }
    if (cv50[idx] < resmin) {
      resmin = cv50[idx];
      span = SUPSMU_SPANS[2];
    }
    if (resmin < cv50[idx] && resmin > 0) {
      span = span + (SUPSMU_SPANS[2] - span) * Math.pow(Math.max(SUPSMU_SMALL, resmin / cv50[idx]), 10);
    }
    bestSpan[idx] = span;
  }

  const smoothedSpans = new Float64Array(n);
  smoothSuperSmoother(x, bestSpan, SUPSMU_SPANS[1], false, vsmlsq, smoothedSpans);

  const blended = new Float64Array(n);
  for (let idx = 0; idx < n; idx++) {
    let span = smoothedSpans[idx];
    if (span <= SUPSMU_SPANS[0]) span = SUPSMU_SPANS[0];
    if (span >= SUPSMU_SPANS[2]) span = SUPSMU_SPANS[2];

    const delta = span - SUPSMU_SPANS[1];
    if (delta < 0) {
      const f = -delta / (SUPSMU_SPANS[1] - SUPSMU_SPANS[0]);
      blended[idx] = (1 - f) * smooth20[idx] + f * smooth05[idx];
    } else {
      const f = delta / (SUPSMU_SPANS[2] - SUPSMU_SPANS[1]);
      blended[idx] = (1 - f) * smooth20[idx] + f * smooth50[idx];
    }
  }

  const out = new Float64Array(n);
  smoothSuperSmoother(x, blended, SUPSMU_SPANS[0], false, vsmlsq, out);
  return out;
}

export function subtractBaseline(intensity: Float64Array, baseline: Float64Array): Float64Array {
  const n = intensity.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, intensity[i] - baseline[i]);
  return out;
}

/**
 * Estimate local noise from a baseline-corrected intensity array.
 *
 * Uses a second SNIP pass with fewer iterations. With only ~20 iterations the
 * clipping window is short (~10× narrower than the baseline pass), so the
 * result tracks the local noise floor rather than the broad baseline.
 * The returned array is used as the per-point SNR denominator in peak picking.
 *
 * In practice, for typical MALDI spectra the noise floor after baseline
 * subtraction is close to zero in valleys, giving very high apparent SNR at
 * real peaks. This means the SNR gate passes most candidate peaks, and
 * deisotoping (keepMonoisotopicPeaksPoisson) is the primary filter that
 * selects genuine monoisotopic peaks from the list.
 *
 * Note: superSmoother() is exported for potential future use as a more
 * faithful MALDIquant noise estimator, but it requires a sparse baseline-
 * corrected signal (near-zero between peaks) to give correct SNR values.
 * The resampled 0.1 Da/pt grid used in validation is too dense for it.
 *
 * @param intensity  - baseline-corrected intensity array
 * @param iterations - SNIP iterations for noise window (default 20)
 */
export function estimateLocalNoise(
  intensity: Float64Array,
  iterations = 20
): Float64Array {
  return snipBaseline(intensity, iterations);
}
