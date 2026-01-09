import type { AnalysisParams, AnalysisResult, Contaminant, RefTaxon, SpeciescanDb, Spectrum } from "./types";
import { cropSpectrum, normalizeToMax, snipBaseline, subtractBaseline } from "./preprocess";
import { keepMonoisotopicPeaks, pickPeaks } from "./peakPicking";
import { buildSampleVector, buildTaxonVector, markerMatchesForTaxon, matchContaminants, pearsonCorrelationBinary, scoreTaxa } from "./speciescanScoring";

// Run preprocessing, peak picking, and scoring for a single spectrum.
export function analyzeSpectrum(
  spectrum: Spectrum,
  db: SpeciescanDb,
  contaminants: Contaminant[],
  params: AnalysisParams,
  decoyTaxa: RefTaxon[] = []
): AnalysisResult {
  // Crop first (for both plotting + peak picking)
  const cropped = cropSpectrum(spectrum.mz, spectrum.intensity, params.mzMin, params.mzMax);
  const rawMz = cropped.mz;
  const rawIntensity = cropped.intensity;

  // "Processed" for peak-picking/scoring: currently just optional normalize-to-max.
  // (You can extend this later with Savitzky–Golay + SNIP baseline, etc.)
  let processedMz = rawMz;
  let processedIntensity = rawIntensity;
  if (params.preprocess.enabled) {
    if (params.preprocess.baselineSubtract.enabled) {
      const baseline = snipBaseline(processedIntensity, params.preprocess.baselineSubtract.iterations);
      processedIntensity = subtractBaseline(processedIntensity, baseline);
    }
    if (params.preprocess.normalizeToMax) {
      processedIntensity = normalizeToMax(processedIntensity);
    }
  }

  // Peak picking on processed spectrum
  let peaks = params.peakPicking.enabled
    ? pickPeaks(processedMz, processedIntensity, params.peakPicking.minRelativeIntensity, params.peakPicking.minPeakDistanceDa)
    : Array.from({ length: processedMz.length }, (_, i) => ({ mz: processedMz[i], intensity: processedIntensity[i] }));

  if (params.monoisotopic.enabled) {
    peaks = keepMonoisotopicPeaks(peaks, params.monoisotopic.toleranceDa, params.monoisotopic.distanceDa, params.monoisotopic.maxIsotopes);
  }

  // Speciescan correlation scoring
  const rankedTaxa = scoreTaxa(peaks, db.taxa, params);

  const bestRealScore = rankedTaxa[0]?.correlation ?? NaN;
  let bestDecoyScore = NaN;
  let decoyGap = NaN;
  let qSample = NaN;
  if (decoyTaxa.length) {
    const sampleVector = buildSampleVector(peaks, params);
    let best = -Infinity;
    let ge = 0;
    for (const t of decoyTaxa) {
      const y = buildTaxonVector(t, params);
      const score = pearsonCorrelationBinary(sampleVector, y);
      if (score > best) best = score;
      if (Number.isFinite(bestRealScore) && score >= bestRealScore) ge++;
    }
    bestDecoyScore = best;
    decoyGap = Number.isFinite(bestRealScore) ? bestRealScore - best : NaN;
    qSample = Number.isFinite(bestRealScore) ? (ge + 1) / (decoyTaxa.length + 1) : NaN;
  }

  const taxonMatchesTop: Record<string, any> = {};
  const topN = 15;
  for (const r of rankedTaxa.slice(0, topN)) {
    const t = db.taxa.find(x => x.id === r.taxonId);
    if (!t) continue;
    taxonMatchesTop[r.taxonId] = markerMatchesForTaxon(peaks, t);
  }

  const contaminantHits = matchContaminants(peaks, contaminants, params.contaminantsToleranceDa);

  let maxI = 0;
  for (let i = 0; i < rawIntensity.length; i++) maxI = Math.max(maxI, rawIntensity[i]);

  return {
    spectrumId: spectrum.id,
    filename: spectrum.filename,
    params,

    rawMz,
    rawIntensity,
    processedMz,
    processedIntensity,

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
    qc: {
      mzMin: rawMz.length ? rawMz[0] : params.mzMin,
      mzMax: rawMz.length ? rawMz[rawMz.length - 1] : params.mzMax,
      maxIntensity: maxI,
      peakCount: peaks.length
    }
  };
}
