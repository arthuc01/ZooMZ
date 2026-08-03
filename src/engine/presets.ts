import type { AnalysisParams } from "./types";

export function createStandardParams(): AnalysisParams {
  return {
    analysisMode: "standard",
    mzMin: 500,
    mzMax: 3500,
    preprocess: {
      enabled: true,
      smoothSG: { enabled: true, halfWindowSize: 2, polynomialOrder: 3 },
      normalizeTIC: true,
      normalizeToMax: false,
      resampleToGrid: false,
      snipDecreasing: false,
      baselineSubtract: { enabled: true, iterations: 15 },
    },
    peakPicking: {
      enabled: true,
      minRelativeIntensity: 0.01,
      minPeakDistanceDa: 0.8,
      snrThreshold: 3.0,
      localMaxHalfWindowSize: 20,
      noiseIterations: 20,
    },
    monoisotopic: {
      enabled: true,
      toleranceDa: 0.25,
      distanceDa: 1.00235,
      maxIsotopes: 10,
      usePoisson: true,
      minCor: 0.95,
      requireCluster: false,
    },
    grid: { startMz: 500, endMz: 3499.9, stepMz: 0.1 },
    folderProcessing: {
      groupReplicates: false,
      smartGroupReplicates: false,
      sampleIdSeparator: "_",
      minReplicatePeaks: 45,
      maxReplicatePeaks: 105,
    },
    contaminantsToleranceDa: 0.3,
    fdr: { enabled: true, nDecoys: 200, maxDecoys: 1000, seed: 1337, toleranceDa: 0.3 }
  };
}

export function createSpeciescanBenchmarkParams(): AnalysisParams {
  return {
    ...createStandardParams(),
    analysisMode: "speciescan_benchmark",
    mzMin: 800,
    mzMax: 3200,
    preprocess: {
      enabled: true,
      smoothSG: { enabled: true, halfWindowSize: 2, polynomialOrder: 3 },
      normalizeTIC: true,
      normalizeToMax: false,
      resampleToGrid: true,
      snipDecreasing: false,
      baselineSubtract: { enabled: true, iterations: 15 },
    },
    peakPicking: {
      enabled: true,
      minRelativeIntensity: 0.01,
      minPeakDistanceDa: 0.5,
      snrThreshold: 3.0,
      localMaxHalfWindowSize: 20,
      noiseIterations: 20,
    },
    monoisotopic: {
      enabled: true,
      toleranceDa: 0.0001,
      distanceDa: 1.00235,
      maxIsotopes: 10,
      usePoisson: true,
      minCor: 0.95,
      requireCluster: false,
    },
    grid: { startMz: 600, endMz: 3500, stepMz: 0.5 },
    folderProcessing: {
      groupReplicates: true,
      smartGroupReplicates: false,
      sampleIdSeparator: "_",
      minReplicatePeaks: 45,
      maxReplicatePeaks: 105,
    },
    contaminantsToleranceDa: 0.3,
    fdr: { enabled: true, nDecoys: 200, maxDecoys: 1000, seed: 1337, toleranceDa: 0.3 }
  };
}

export function createSpeciescanExactParams(): AnalysisParams {
  return {
    ...createStandardParams(),
    analysisMode: "speciescan_exact",
    mzMin: 800,
    mzMax: 3200,
    preprocess: {
      enabled: true,
      smoothSG: { enabled: true, halfWindowSize: 2, polynomialOrder: 3 },
      normalizeTIC: true,
      normalizeToMax: false,
      resampleToGrid: true,
      snipDecreasing: false,
      baselineSubtract: { enabled: true, iterations: 15 },
    },
    peakPicking: {
      enabled: true,
      minRelativeIntensity: 0.01,
      minPeakDistanceDa: 0.5,
      snrThreshold: 3.0,
      localMaxHalfWindowSize: 20,
      noiseIterations: 20,
    },
    monoisotopic: {
      enabled: true,
      toleranceDa: 0.0001,
      distanceDa: 1.00235,
      maxIsotopes: 10,
      usePoisson: true,
      minCor: 0.95,
      requireCluster: false,
    },
    grid: { startMz: 500, endMz: 3500, stepMz: 0.1 },
    folderProcessing: {
      groupReplicates: true,
      smartGroupReplicates: false,
      sampleIdSeparator: "_",
      minReplicatePeaks: 45,
      maxReplicatePeaks: 105,
    },
    contaminantsToleranceDa: 0.4,
    fdr: { enabled: true, nDecoys: 200, maxDecoys: 1000, seed: 1337, toleranceDa: 0.4 }
  };
}
