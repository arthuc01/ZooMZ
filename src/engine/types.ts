import type { TaxonomyAssignment } from "./taxonomy";
export type Spectrum = {
  id: string;
  filename: string;
  mz: Float64Array;
  intensity: Float64Array;
  centroided?: boolean;
  sourceMode?: "single" | "batch_upload" | "folder" | "folder_group";
  sourcePath?: string;
  sampleId?: string;
  replicateCount?: number;
  replicateFilenames?: string[];
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
  analysisMode: "standard" | "speciescan_benchmark" | "speciescan_exact";
  mzMin: number;
  mzMax: number;

  preprocess: {
    enabled: boolean;
    /** Savitzky-Golay smoothing applied before baseline subtraction. */
    smoothSG: { enabled: boolean; halfWindowSize: number; polynomialOrder: number };
    /** TIC normalisation (divide by sum) - matches SpecieScan / MALDIquant. Preferred over normalizeToMax. */
    normalizeTIC: boolean;
    /** Legacy max-normalisation. Ignored when normalizeTIC is true. */
    normalizeToMax: boolean;
    /** Resample to a fixed regular grid before preprocessing. */
    resampleToGrid: boolean;
    /** Use the Morhac-style decreasing SNIP clipping window. */
    snipDecreasing: boolean;
    baselineSubtract: { enabled: boolean; iterations: number };
  };
  peakPicking: {
    enabled: boolean;
    /** Global relative-intensity threshold (fraction of max). Used when snrThreshold === 0. */
    minRelativeIntensity: number;
    minPeakDistanceDa: number;
    /** Local-SNR threshold -- matches MALDIquant SNR=3. Set to 0 to use minRelativeIntensity. */
    snrThreshold: number;
    /** Local-max half-window in points for MALDIquant-style peak calling. */
    localMaxHalfWindowSize: number;
    /** SNIP iterations for the local noise estimate (second pass, default 20). */
    noiseIterations: number;
  };

  monoisotopic: {
    enabled: boolean;
    toleranceDa: number;
    distanceDa: number;
    maxIsotopes: number;
    /** Use Poisson-envelope correlation (Breen 2000) -- matches MALDIquant monoisotopicPeaks. */
    usePoisson: boolean;
    /** Minimum Pearson r to accept an isotope cluster. MALDIquant default: 0.95. */
    minCor: number;
    /** Drop peaks with no confirmed isotope cluster (strict MALDIquant mode). Default false. */
    requireCluster: boolean;
  };

  // Speciescan scoring grid
  grid: { startMz: number; endMz: number; stepMz: number };

  folderProcessing: {
    /** Group technical replicates by sample ID prefix during folder runs. */
    groupReplicates: boolean;
    /** Auto-detect replicate suffixes like _1/_2/_3 or _a/_b/_c when grouping folder files. */
    smartGroupReplicates: boolean;
    /** Sample ID separator used to extract the group key from filenames. */
    sampleIdSeparator: string;
    /** Keep only replicates with at least this many peaks before averaging in benchmark mode. */
    minReplicatePeaks: number;
    /** Keep only replicates with at most this many peaks before averaging in benchmark mode. */
    maxReplicatePeaks: number;
  };

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
  consensusLabel?: string | null;

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

  qc: {
    mzMin: number;
    mzMax: number;
    maxIntensity: number;
    peakCount: number;
    tic: number;
    nonzeroFraction: number;
    peakDensity: number;
    dynamicRange: number;
    suspect: boolean;
    notes: string[];
  };

  /** PAMPA-style taxonomy assignment computed from ranked taxa. */
  assignment: TaxonomyAssignment | null;

  /** PAMPA analytical p-value for top-ranked taxon. Binomial: P(Binom(n,p) >= k_matched). Null when insufficient data. */
  pampaTopP: number | null;
};

export type DbManifest = {
  defaultDb: string;
  databases: { label: string; file: string }[];
  contaminantsFile: string;
};
