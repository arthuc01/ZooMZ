import type {
  AnalysisParams,
  AnalysisResult,
  Contaminant,
  Peak,
  RefTaxon,
  SpeciescanDb,
  Spectrum,
} from "./types";
import { computeAssignment } from "./taxonomy";
import { computePampaPvalue } from "./pampaStats";
import {
  averageIntensityArrays,
  cropSpectrum,
  normalizeTIC,
  normalizeToMax,
  resampleToGrid,
  smoothSavitzkyGolay,
  snipBaseline,
  subtractBaseline,
  superSmoother,
} from "./preprocess";
import { median } from "../utils/numbers";
import {
  keepMonoisotopicPeaks,
  keepMonoisotopicPeaksMALDIquant,
  keepMonoisotopicPeaksPoisson,
  keepMonoisotopicPeaksPythonProxy,
  pickPeaks,
  pickPeaksByProminence,
  pickBenchmarkPeaksByProminence,
  pickBenchmarkPeaksByProminenceExact,
  pickPeaksLocalSNR,
  pickPeaksLocalSNRWindow,
} from "./peakPicking";
import {
  buildSampleVector,
  buildTaxonVector,
  markerMatchesForTaxon,
  matchContaminants,
  pearsonCorrelationBinary,
  scoreTaxa,
} from "./speciescanScoring";

const BENCHMARK_DETECT_START_MZ = 800;
const BENCHMARK_DETECT_END_MZ = 3200;
const BENCHMARK_DETECT_STEP_MZ = 0.1;
const SPECIESCAN_EXACT_START_MZ = 800;
const SPECIESCAN_EXACT_END_MZ = 3200;
const SPECIESCAN_EXACT_STEP_MZ = 0.1;
const SPECIESCAN_EXACT_SNR_THRESHOLDS = [3.0, 4.0, 5.0, 7.0, 10.0, 15.0, 20.0];
const SPECIESCAN_EXACT_SG_HALFWIN = 10;
const SPECIESCAN_EXACT_SNIP_ITER = 100;
const SPECIESCAN_EXACT_NOISE_SNIP_ITER = 20;
const SPECIESCAN_EXACT_TARGET_MAX_PEAKS = 100;
const SPECIESCAN_EXACT_CONSENSUS_GAP = 0.02;

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

function snipBaselinePythonExact(intensity: Float64Array, iterations: number): Float64Array {
  const n = intensity.length;
  if (n < 3) return new Float64Array(intensity);
  const maxIter = Math.max(1, Math.min(iterations, Math.floor(n / 2) - 1));
  let s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sqrt(Math.max(0, intensity[i]));

  for (let w = 1; w <= maxIter; w++) {
    const next = new Float64Array(s);
    for (let i = w; i < n - w; i++) {
      const avg = 0.5 * (s[i - w] + s[i + w]);
      if (avg < next[i]) next[i] = avg;
    }
    s = next;
  }

  const baseline = new Float64Array(n);
  for (let i = 0; i < n; i++) baseline[i] = s[i] * s[i];
  return baseline;
}

function applyMonoisotopicFilter(peaks: Peak[], params: AnalysisParams): Peak[] {
  if (!params.monoisotopic.enabled) return peaks;
  return params.monoisotopic.usePoisson
    ? keepMonoisotopicPeaksPoisson(
        peaks,
        params.monoisotopic.minCor ?? 0.95,
        params.monoisotopic.toleranceDa,
        params.monoisotopic.distanceDa,
        2,
        params.monoisotopic.maxIsotopes,
        params.monoisotopic.requireCluster ?? false
      )
    : keepMonoisotopicPeaks(
        peaks,
        params.monoisotopic.toleranceDa,
        params.monoisotopic.distanceDa,
        params.monoisotopic.maxIsotopes
      );
}

function scoreAndFinalize(
  spectrum: Spectrum,
  rawMz: Float64Array,
  rawIntensity: Float64Array,
  processedMz: Float64Array,
  processedIntensity: Float64Array,
  peaks: Peak[],
  db: SpeciescanDb,
  contaminants: Contaminant[],
  params: AnalysisParams,
  decoyTaxa: RefTaxon[]
): AnalysisResult {
  const rankedTaxa = scoreTaxa(peaks, db.taxa, params);
  const bestRealScore = rankedTaxa[0]?.correlation ?? NaN;

  let bestDecoyScore = NaN;
  let decoyGap = NaN;
  let qSample = NaN;

  if (decoyTaxa.length > 0 && Number.isFinite(bestRealScore)) {
    const sampleVector = buildSampleVector(peaks, params);
    let bestDecoy = -Infinity;
    let ge = 0;

    for (const t of decoyTaxa) {
      const y = buildTaxonVector(t, params);
      const score = pearsonCorrelationBinary(sampleVector, y);
      if (score > bestDecoy) bestDecoy = score;
      if (score >= bestRealScore) ge++;
    }

    bestDecoyScore = bestDecoy;
    decoyGap = bestRealScore - bestDecoy;
    qSample = (ge + 1) / (decoyTaxa.length + 1);
  }

  const taxonMatchesTop: Record<string, ReturnType<typeof markerMatchesForTaxon>> = {};
  for (const r of rankedTaxa.slice(0, 15)) {
    const t = db.taxa.find(x => x.id === r.taxonId);
      if (t) taxonMatchesTop[r.taxonId] = markerMatchesForTaxon(peaks, t, params);
  }

  const assignment = computeAssignment(rankedTaxa, db, taxonMatchesTop);
  const topTaxonId = rankedTaxa[0]?.taxonId ?? null;
  const topMatches = topTaxonId ? (taxonMatchesTop[topTaxonId] ?? null) : null;
  const pampaTopP = topMatches ? computePampaPvalue(topMatches, peaks, params.analysisMode === "speciescan_benchmark" ? 0.4 : 0.3) : null;
  const contaminantHits = matchContaminants(peaks, contaminants, params.contaminantsToleranceDa);
  const rawValues = Array.from(rawIntensity);
  let tic = 0;
  let nonzeroCount = 0;
  let maxRawIntensity = 0;
  const topIntensities: number[] = [];
  const positiveValues: number[] = [];
  for (const value of rawValues) {
    if (value > 0) {
      nonzeroCount++;
      positiveValues.push(value);
      if (topIntensities.length < 5) {
        topIntensities.push(value);
        topIntensities.sort((a, b) => a - b);
      } else if (value > topIntensities[0]) {
        topIntensities[0] = value;
        topIntensities.sort((a, b) => a - b);
      }
    }
    tic += value;
    if (value > maxRawIntensity) maxRawIntensity = value;
  }
  const medianPositive = median(positiveValues) ?? 0;
  const dynamicRange = medianPositive > 0 ? maxRawIntensity / medianPositive : Infinity;
  const top5Fraction = tic > 0 ? topIntensities.reduce((a, b) => a + b, 0) / tic : 0;
  const nonzeroFraction = rawValues.length ? nonzeroCount / rawValues.length : 0;
  const peakDensity = processedMz.length ? peaks.length / (processedMz.length / 1000) : 0;
  const qcNotes: string[] = [];
  if (!rawValues.length || tic <= 0) {
    qcNotes.push("no usable signal");
  } else {
    if (peaks.length < 8) qcNotes.push("few peaks");
    if (nonzeroFraction < 0.08) qcNotes.push("sparse signal");
    if (peakDensity > 80) qcNotes.push("very dense peak field");
    if (dynamicRange < 4) qcNotes.push("flat / noisy baseline");
    if (top5Fraction < 0.20) qcNotes.push("diffuse intensity distribution");
  }
  const suspect = qcNotes.length > 0;
  const consensusLabel = (() => {
    const top = rankedTaxa[0];
    const second = rankedTaxa[1];
    if (!top) return null;
    if (params.analysisMode !== "speciescan_exact") return top.taxonLabel;
    if (!assignment || assignment.indistinguishable.length <= 1 || !second) return top.taxonLabel;
    if ((top.correlation - second.correlation) > SPECIESCAN_EXACT_CONSENSUS_GAP) return top.taxonLabel;
    return uniqueLabels(assignment.indistinguishable).join("/");
  })();

  let maxI = 0;
  for (let i = 0; i < rawIntensity.length; i++) {
    if (rawIntensity[i] > maxI) maxI = rawIntensity[i];
  }

  return {
    spectrumId: spectrum.id,
    filename: spectrum.filename,
    params,
    rawMz,
    rawIntensity,
    processedMz,
    processedIntensity,
    consensusLabel,
    peaks,
    rankedTaxa,
    taxonMatchesTop,
    contaminants: contaminantHits,
    fdr: {
      nDecoys: decoyTaxa.length,
      bestDecoyScore,
      decoyGap,
      qSample,
    },
    assignment,
    pampaTopP,
    qc: {
      mzMin: rawMz.length ? rawMz[0] : params.mzMin,
      mzMax: rawMz.length ? rawMz[rawMz.length - 1] : params.mzMax,
      maxIntensity: maxI,
      peakCount: peaks.length,
      tic,
      nonzeroFraction,
      peakDensity,
      dynamicRange,
      suspect,
      notes: qcNotes,
    },
  };
}

function averageGroupedSpectrum(spectra: Spectrum[], params: AnalysisParams): Spectrum {
  const resampled = spectra.map((s) => {
    const cropped = cropSpectrum(s.mz, s.intensity, params.mzMin, params.mzMax);
    const grid = resampleToGrid(
      cropped.mz,
      cropped.intensity,
      params.grid.startMz,
      params.grid.endMz,
      params.grid.stepMz
    );
    return params.preprocess.normalizeTIC
      ? normalizeTIC(grid.intensity)
      : grid.intensity;
  });
  const avgIntensity = averageIntensityArrays(resampled);
  const mz = resampleToGrid(
    new Float64Array(0),
    new Float64Array(0),
    params.grid.startMz,
    params.grid.endMz,
    params.grid.stepMz
  ).mz;
  const first = spectra[0];
  return {
    ...first,
    mz,
    intensity: avgIntensity,
    centroided: false,
  };
}

function benchmarkReplicateGrid(
  spectrum: Spectrum,
  params: AnalysisParams
): { mz: Float64Array; intensity: Float64Array } {
  const cropped = cropSpectrum(spectrum.mz, spectrum.intensity, params.mzMin, params.mzMax);
  const grid = resampleToGrid(
    cropped.mz,
    cropped.intensity,
    BENCHMARK_DETECT_START_MZ,
    BENCHMARK_DETECT_END_MZ,
    BENCHMARK_DETECT_STEP_MZ
  );
  return {
    mz: grid.mz,
    intensity: normalizeTIC(grid.intensity),
  };
}

function benchmarkProcessGrid(
  mz: Float64Array,
  intensity: Float64Array,
  params: AnalysisParams
): { processedMz: Float64Array; processedIntensity: Float64Array; peaks: Peak[] } {
  let processedIntensity: any = new Float64Array(intensity);

  if (params.preprocess.enabled) {
    if (params.preprocess.smoothSG.enabled) {
      processedIntensity = smoothSavitzkyGolay(
        processedIntensity,
        params.preprocess.smoothSG.halfWindowSize,
        params.preprocess.smoothSG.polynomialOrder
      ) as Float64Array;
    }
    if (params.preprocess.baselineSubtract.enabled) {
      const baseline = params.analysisMode === "speciescan_exact"
        ? snipBaselinePythonExact(processedIntensity, params.preprocess.baselineSubtract.iterations)
        : snipBaseline(
            processedIntensity,
            params.preprocess.baselineSubtract.iterations,
            params.preprocess.snipDecreasing
          );
      processedIntensity = subtractBaseline(processedIntensity, baseline) as Float64Array;
    }
    if (params.preprocess.normalizeTIC) {
      processedIntensity = normalizeTIC(processedIntensity) as Float64Array;
    } else if (params.preprocess.normalizeToMax) {
      processedIntensity = normalizeToMax(processedIntensity) as Float64Array;
    }
  }

  let peaks = params.peakPicking.enabled
    ? (params.analysisMode === "speciescan_exact"
        ? pickBenchmarkPeaksByProminenceExact(
            mz,
            processedIntensity,
            params.peakPicking.minPeakDistanceDa,
            250
          )
        : pickBenchmarkPeaksByProminence(
            mz,
            processedIntensity,
            params.peakPicking.minPeakDistanceDa,
            250
          ))
    : Array.from({ length: mz.length }, (_, i) => ({ mz: mz[i], intensity: processedIntensity[i] }));

  peaks = keepMonoisotopicPeaksPythonProxy(
    peaks,
    params.monoisotopic.minCor ?? 0.95,
    2,
    params.monoisotopic.maxIsotopes,
    100
  );
  return { processedMz: mz, processedIntensity, peaks };
}

function mzAxesMatch(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  }
  return true;
}

function averageSpeciescanExactReplicates(
  replicates: Array<{ mz: Float64Array; intensity: Float64Array }>
): { mz: Float64Array; intensity: Float64Array } {
  if (!replicates.length) {
    return { mz: new Float64Array(0), intensity: new Float64Array(0) };
  }

  const firstMz = replicates[0].mz;
  if (replicates.every((rep) => mzAxesMatch(rep.mz, firstMz))) {
    return {
      mz: firstMz,
      intensity: averageIntensityArrays(replicates.map((rep) => rep.intensity)),
    };
  }

  const resampled = replicates.map((rep) =>
    resampleToGrid(
      rep.mz,
      rep.intensity,
      SPECIESCAN_EXACT_START_MZ,
      SPECIESCAN_EXACT_END_MZ,
      SPECIESCAN_EXACT_STEP_MZ
    )
  );
  return {
    mz: resampled[0]?.mz ?? new Float64Array(0),
    intensity: averageIntensityArrays(resampled.map((rep) => rep.intensity)),
  };
}

function speciescanExactReplicateGrid(
  spectrum: Spectrum,
): { mz: Float64Array; intensity: Float64Array } {
  const cropped = cropSpectrum(spectrum.mz, spectrum.intensity, SPECIESCAN_EXACT_START_MZ, SPECIESCAN_EXACT_END_MZ);
  const grid = resampleToGrid(
    cropped.mz,
    cropped.intensity,
    SPECIESCAN_EXACT_START_MZ,
    SPECIESCAN_EXACT_END_MZ,
    SPECIESCAN_EXACT_STEP_MZ
  );
  return {
    mz: grid.mz,
    intensity: normalizeTIC(grid.intensity),
  };
}

function speciescanExactPreprocessAverage(
  intensity: Float64Array,
  params: AnalysisParams
): Float64Array {
  let processedIntensity: Float64Array = new Float64Array(intensity);

  if (params.preprocess.enabled) {
    if (params.preprocess.smoothSG.enabled) {
      processedIntensity = smoothSavitzkyGolay(
        processedIntensity,
        params.preprocess.smoothSG.halfWindowSize,
        params.preprocess.smoothSG.polynomialOrder
      ) as Float64Array;
    }
    if (params.preprocess.baselineSubtract.enabled) {
      const baseline = snipBaseline(
        processedIntensity,
        params.preprocess.baselineSubtract.iterations,
        params.preprocess.snipDecreasing
      );
      processedIntensity = subtractBaseline(processedIntensity, baseline) as Float64Array;
    }
    if (params.preprocess.normalizeTIC) {
      processedIntensity = normalizeTIC(processedIntensity) as Float64Array;
    } else if (params.preprocess.normalizeToMax) {
      processedIntensity = normalizeToMax(processedIntensity) as Float64Array;
    }
  }

  return processedIntensity;
}

function speciescanExactPickPeaks(
  mz: Float64Array,
  processedIntensity: Float64Array,
  params: AnalysisParams
): Peak[] {
  if (mz.length < 3 || processedIntensity.length < 3) return [];

  const rawPeaks = pickBenchmarkPeaksByProminenceExact(
    mz,
    processedIntensity,
    params.peakPicking.minPeakDistanceDa
  );
  if (!rawPeaks.length) return [];

  const mono = keepMonoisotopicPeaksPythonProxy(
    rawPeaks,
    params.monoisotopic.minCor ?? 0.95,
    2,
    params.monoisotopic.maxIsotopes,
    SPECIESCAN_EXACT_TARGET_MAX_PEAKS
  );
  if (mono.length <= SPECIESCAN_EXACT_TARGET_MAX_PEAKS) return mono;

  return [...mono]
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, SPECIESCAN_EXACT_TARGET_MAX_PEAKS)
    .sort((a, b) => a.mz - b.mz);
}

function analyzeSpeciescanExactSpectrumGroup(
  spectra: Spectrum[],
  db: SpeciescanDb,
  contaminants: Contaminant[],
  params: AnalysisParams,
  decoyTaxa: RefTaxon[]
): AnalysisResult {
  const replicateGrids = spectra.map((s) => speciescanExactReplicateGrid(s));
  const averaged = averageSpeciescanExactReplicates(replicateGrids);
  const mz = averaged.mz;
  const avgIntensity = averaged.intensity;
  const processedIntensity = speciescanExactPreprocessAverage(avgIntensity, params);
  const averagedSpectrum: Spectrum = {
    ...spectra[0],
    mz,
    intensity: avgIntensity,
    centroided: false,
  };
  const averagedProcessedPeaks = speciescanExactPickPeaks(mz, processedIntensity, params);
  return scoreAndFinalize(
    averagedSpectrum,
    mz,
    avgIntensity,
    mz,
    processedIntensity,
    averagedProcessedPeaks,
    db,
    contaminants,
    params,
    decoyTaxa
  );
}

function analyzeBenchmarkSpectrumGroup(
  spectra: Spectrum[],
  db: SpeciescanDb,
  contaminants: Contaminant[],
  params: AnalysisParams,
  decoyTaxa: RefTaxon[]
): AnalysisResult {
  const replicateGrids = spectra.map((s) => benchmarkReplicateGrid(s, params));
  const avgIntensity = averageIntensityArrays(replicateGrids.map((g) => g.intensity));
  const mz = replicateGrids[0]?.mz ?? new Float64Array(0);
  const averagedSpectrum: Spectrum = {
    ...spectra[0],
    mz,
    intensity: avgIntensity,
    centroided: false,
  };
  const { processedMz, processedIntensity, peaks } = benchmarkProcessGrid(mz, avgIntensity, params);
  return scoreAndFinalize(
    averagedSpectrum,
    mz,
    avgIntensity,
    processedMz,
    processedIntensity,
    peaks,
    db,
    contaminants,
    params,
    decoyTaxa
  );
}

function analyzeStandardSpectrum(
  spectrum: Spectrum,
  db: SpeciescanDb,
  contaminants: Contaminant[],
  params: AnalysisParams,
  decoyTaxa: RefTaxon[]
): AnalysisResult {
  let cropped = cropSpectrum(spectrum.mz, spectrum.intensity, params.mzMin, params.mzMax);
  if (params.preprocess.resampleToGrid) {
    cropped = resampleToGrid(
      cropped.mz,
      cropped.intensity,
      params.grid.startMz,
      params.grid.endMz,
      params.grid.stepMz
    );
  }

  const rawMz = cropped.mz;
  const rawIntensity = cropped.intensity;
  let processedMz = rawMz;
  let processedIntensity: any = rawIntensity;

  if (params.preprocess.enabled) {
    if (params.preprocess.smoothSG?.enabled) {
      processedIntensity = smoothSavitzkyGolay(
        processedIntensity,
        params.preprocess.smoothSG.halfWindowSize,
        params.preprocess.smoothSG.polynomialOrder
      ) as Float64Array;
    }
    if (params.preprocess.baselineSubtract.enabled) {
      const baseline = snipBaseline(
        processedIntensity,
        params.preprocess.baselineSubtract.iterations,
        params.preprocess.snipDecreasing
      );
      processedIntensity = subtractBaseline(processedIntensity, baseline) as Float64Array;
    }
    if (params.preprocess.normalizeTIC) {
      processedIntensity = normalizeTIC(processedIntensity) as Float64Array;
    } else if (params.preprocess.normalizeToMax) {
      processedIntensity = normalizeToMax(processedIntensity) as Float64Array;
    }
  }

  let peaks = params.peakPicking.enabled
    ? (
        params.peakPicking.snrThreshold > 0
          ? pickPeaksByProminence(
              processedMz,
              processedIntensity,
              params.peakPicking.minPeakDistanceDa,
              250
            )
          : pickPeaks(
              processedMz,
              processedIntensity,
              params.peakPicking.minRelativeIntensity,
              params.peakPicking.minPeakDistanceDa
            )
      )
    : Array.from({ length: processedMz.length }, (_, i) => ({
        mz: processedMz[i],
        intensity: processedIntensity[i],
      }));

  peaks = applyMonoisotopicFilter(peaks, params);
  return scoreAndFinalize(
    spectrum,
    rawMz,
    rawIntensity,
    processedMz,
    processedIntensity,
    peaks,
    db,
    contaminants,
    params,
    decoyTaxa
  );
}

export function analyzeSpectrumGroup(
  spectra: Spectrum[],
  db: SpeciescanDb,
  contaminants: Contaminant[],
  params: AnalysisParams,
  decoyTaxa: RefTaxon[] = []
): AnalysisResult {
  if (!spectra.length) throw new Error("No spectra supplied for analysis.");
  if (params.analysisMode === "speciescan_exact") {
    return analyzeSpeciescanExactSpectrumGroup(spectra, db, contaminants, params, decoyTaxa);
  }
  if (params.analysisMode === "speciescan_benchmark") {
    return analyzeBenchmarkSpectrumGroup(spectra, db, contaminants, params, decoyTaxa);
  }
  const spectrum = spectra.length > 1 ? averageGroupedSpectrum(spectra, params) : spectra[0];
  return analyzeStandardSpectrum(spectrum, db, contaminants, params, decoyTaxa);
}

/**
 * Run the full ZooMZ analysis pipeline for a single spectrum.
 */
export function analyzeSpectrum(
  spectrum: Spectrum,
  db: SpeciescanDb,
  contaminants: Contaminant[],
  params: AnalysisParams,
  decoyTaxa: RefTaxon[] = []
): AnalysisResult {
  return analyzeSpectrumGroup([spectrum], db, contaminants, params, decoyTaxa);
}
