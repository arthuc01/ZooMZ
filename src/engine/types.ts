export type Spectrum = {
  id: string;
  filename: string;
  mz: Float64Array;
  intensity: Float64Array;
  centroided?: boolean;
};

export type Peak = { mz: number; intensity: number };
export type RefMarker = { name: string; mz: number };

export type RefTaxon = {
  id: string;
  label: string;
  species?: string;
  family?: string;
  order?: string;
  markers: RefMarker[];
};

export type SpeciescanDb = {
  meta: { label: string; file: string };
  taxa: RefTaxon[];
  markerNames: string[];
};

export type Contaminant = { name: string; mz: number };

export type TaxonScore = {
  taxonId: string;
  taxonLabel: string;
  correlation: number;
};

export type MarkerMatchRow = {
  markerName: string;
  expectedMz: number;
  matched: boolean;
  matchedPeakMz: number | null;
  matchedPeakIntensity: number | null;
};

export type ContaminantHit = {
  name: string;
  expectedMz: number;
  matchedPeakMz: number;
  deltaDa: number;
  intensity: number;
};

export type AnalysisParams = {
  mzMin: number;
  mzMax: number;

  preprocess: {
    enabled: boolean;
    normalizeToMax: boolean;
    baselineSubtract: { enabled: boolean; iterations: number };
  };
  peakPicking: { enabled: boolean; minRelativeIntensity: number; minPeakDistanceDa: number };

  // simple monoisotopic filtering (deisotoping)
  monoisotopic: { enabled: boolean; toleranceDa: number; distanceDa: number; maxIsotopes: number };

  // Speciescan scoring grid
  grid: { startMz: number; endMz: number; stepMz: number };

  contaminantsToleranceDa: number; // typically 0.3

  fdr: {
    enabled: boolean;
    nDecoys: number;
    maxDecoys: number;
    seed: number;
    toleranceDa: number;
  };
};

export type AnalysisResult = {
  spectrumId: string;
  filename: string;
  params: AnalysisParams;

  // For plotting (cropped to mzMin..mzMax)
  rawMz: Float64Array;
  rawIntensity: Float64Array;
  processedMz: Float64Array;
  processedIntensity: Float64Array;

  peaks: Peak[];

  rankedTaxa: TaxonScore[];
  taxonMatchesTop: Record<string, MarkerMatchRow[]>;
  contaminants: ContaminantHit[];

  fdr: {
    nDecoys: number;
    bestDecoyScore: number;
    decoyGap: number;
    qSample: number;
  };

  qc: { mzMin: number; mzMax: number; maxIntensity: number; peakCount: number };
};

export type DbManifest = {
  defaultDb: string;
  databases: { label: string; file: string }[];
  contaminantsFile: string;
};
