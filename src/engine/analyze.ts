import type { AnalysisParams, AnalysisResult, Contaminant, SpeciescanDb, Spectrum } from "./types";
import { cropSpectrum, normalizeToMax } from "./preprocess";
import { keepMonoisotopicPeaks, pickPeaks } from "./peakPicking";
import { markerMatchesForTaxon, matchContaminants, scoreTaxa } from "./speciescanScoring";

// Run preprocessing, peak picking, and scoring for a single spectrum.
export function analyzeSpectrum(spectrum: Spectrum, db: SpeciescanDb, contaminants: Contaminant[], params: AnalysisParams): AnalysisResult {
  // Crop first (for both plotting + peak picking)
  const cropped = cropSpectrum(spectrum.mz, spectrum.intensity, params.mzMin, params.mzMax);
  const rawMz = cropped.mz;
  const rawIntensity = cropped.intensity;

  // "Processed" for peak-picking/scoring: currently just optional normalize-to-max.
  // (You can extend this later with Savitzky–Golay + SNIP baseline, etc.)
  let processedMz = rawMz;
  let processedIntensity = rawIntensity;
  if (params.preprocess.enabled && params.preprocess.normalizeToMax) {
    processedIntensity = normalizeToMax(processedIntensity);
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
    qc: {
      mzMin: rawMz.length ? rawMz[0] : params.mzMin,
      mzMax: rawMz.length ? rawMz[rawMz.length - 1] : params.mzMax,
      maxIntensity: maxI,
      peakCount: peaks.length
    }
  };
}
