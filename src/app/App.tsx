import React, { useEffect, useMemo, useRef, useState } from "react";
import Dropzone from "../ui/Dropzone";
import SpectrumPlot from "../ui/SpectrumPlot";
import ResultsTable from "../ui/ResultsTable";
import MarkerMatchTable from "../ui/MarkerMatchTable";
import BatchQueueTable from "../ui/BatchQueueTable";
import SettingsPanel from "../ui/SettingsPanel";
import ContaminantsTable from "../ui/ContaminantsTable";
import TaxonomyPanel from "../ui/TaxonomyPanel";
import * as XLSX from "xlsx";

import type { AnalysisParams, AnalysisResult, Contaminant, DbManifest, RefTaxon, SpeciescanDb, Spectrum } from "../engine/types";
import { parseSpectrumFile } from "../engine/parse";
import { analyzeSpectrum, analyzeSpectrumGroup } from "../engine/analyze";
import { loadContaminants, loadManifest, loadSpeciescanDb } from "../engine/speciescanDb";
import { buildDecoyTaxa } from "../engine/decoys";
import { computeConfidence } from "../engine/confidence";
import { createSpeciescanBenchmarkParams, createStandardParams } from "../engine/presets";
import { downloadText } from "../utils/download";
import { median, iqr } from "../utils/numbers";

// Format a peak match as "mz (intensity)" for Excel cells.
function formatMatch(mz: number | null | undefined, intensity: number | null | undefined): string {
  if (mz == null || intensity == null) return "";
  return `${mz.toFixed(3)} (${intensity.toFixed(3)})`;
}

// QC thresholds applied during Excel export.
const QC_MIN_PEAKS = 30;
const QC_MIN_MARKERS = 3;
const QC_MIN_FRAC = 0.2;
const QC_MAX_MEDIAN_PPM = 50;
const QC_MAX_CONTAMS = 3;

const DEFAULT_PARAMS: AnalysisParams = createStandardParams();

// Deep-merge user settings over defaults, ensuring no missing sub-keys.
function normalizeParams(next: Partial<AnalysisParams>): AnalysisParams {
  return {
    ...DEFAULT_PARAMS,
    ...next,
    preprocess: {
      ...DEFAULT_PARAMS.preprocess,
      ...(next.preprocess ?? {}),
      smoothSG: {
        ...DEFAULT_PARAMS.preprocess.smoothSG,
        ...(next.preprocess?.smoothSG ?? {})
      },
      resampleToGrid: next.preprocess?.resampleToGrid ?? DEFAULT_PARAMS.preprocess.resampleToGrid,
      snipDecreasing: next.preprocess?.snipDecreasing ?? DEFAULT_PARAMS.preprocess.snipDecreasing,
      baselineSubtract: {
        ...DEFAULT_PARAMS.preprocess.baselineSubtract,
        ...(next.preprocess?.baselineSubtract ?? {})
      }
    },
    peakPicking: {
      ...DEFAULT_PARAMS.peakPicking,
      ...(next.peakPicking ?? {})
    },
    monoisotopic: {
      ...DEFAULT_PARAMS.monoisotopic,
      ...(next.monoisotopic ?? {})
    },
    grid: {
      ...DEFAULT_PARAMS.grid,
      ...(next.grid ?? {})
    },
    folderProcessing: {
      ...DEFAULT_PARAMS.folderProcessing,
      ...(next.folderProcessing ?? {})
    },
    fdr: {
      ...DEFAULT_PARAMS.fdr,
      ...(next.fdr ?? {})
    }
  };
}

const LEGACY_DEFAULT_PARAMS = {
  mzMin: 500,
  mzMax: 3500,
  preprocess: {
    enabled: true,
    smoothSG: { enabled: true, halfWindowSize: 2 },   // 2 pts × 0.1 Da = 0.2 Da, matching MALDIquant's 0.15 Da
    normalizeTIC: true,
    normalizeToMax: false,
    baselineSubtract: { enabled: true, iterations: 15 }, // 15 pts × 0.1 Da = 1.5 Da, matching MALDIquant's 1.5 Da
  },
  peakPicking: {
    enabled: true,
    minRelativeIntensity: 0.01,   // fallback when snrThreshold === 0
    minPeakDistanceDa: 0.8,
    snrThreshold: 3.0,            // local SNR (MALDIquant default)
    noiseIterations: 20,          // SNIP iterations for noise estimate
  },
  monoisotopic: {
    enabled: true,
    toleranceDa: 0.25,
    distanceDa: 1.00235,
    maxIsotopes: 10,
    usePoisson: true,             // Poisson-envelope correlation (Breen 2000)
    minCor: 0.95,                 // MALDIquant default
    requireCluster: false,        // lenient: keep unconfirmed peaks
  },
  grid: { startMz: 500, endMz: 3500, stepMz: 0.1 },
  contaminantsToleranceDa: 0.3,
  fdr: { enabled: true, nDecoys: 200, maxDecoys: 1000, seed: 1337, toleranceDa: 0.3 }
};

// Top-level app component for ZooMS analysis workflow.
export default function App() {
  const [manifest, setManifest] = useState<DbManifest | null>(null);
  const [selectedDbFile, setSelectedDbFile] = useState<string | null>(null);

  const [db, setDb] = useState<SpeciescanDb | null>(null);
  const [decoyTaxa, setDecoyTaxa] = useState<RefTaxon[]>([]);
  const [contaminants, setContaminants] = useState<Contaminant[]>([]);
  const [params, setParams] = useState<AnalysisParams>(DEFAULT_PARAMS);

  const [spectra, setSpectra] = useState<Spectrum[]>([]);
  const [results, setResults] = useState<Record<string, AnalysisResult | undefined>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [inspectTaxonId, setInspectTaxonId] = useState<string | null>(null);

  // Plot display controls
  const [displayMode, setDisplayMode] = useState<"raw" | "processed">("processed");
  const [displayNormalizeToMax, setDisplayNormalizeToMax] = useState<boolean>(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingErrors, setProcessingErrors] = useState<{ filename: string; error: string; sourceMode: string; sourcePath: string }[]>([]);
  const [folderRun, setFolderRun] = useState<{ active: boolean; total: number; processed: number; folderLabel: string }>({
    active: false,
    total: 0,
    processed: 0,
    folderLabel: ""
  });
  const cancelFolderRef = useRef(false);

  const selectedSpectrum = useMemo(() => spectra.find(s => s.id === selectedId) ?? null, [spectra, selectedId]);
  const selectedResult = useMemo(() => (selectedId ? results[selectedId] ?? null : null), [results, selectedId]);
  const hasResults = useMemo(() => Object.values(results).some(Boolean), [results]);

  function applyAnalysisMode(mode: AnalysisParams["analysisMode"]) {
    setParams(
      normalizeParams(
        mode === "speciescan_benchmark"
          ? createSpeciescanBenchmarkParams()
          : createStandardParams()
      )
    );
  }

  // Load manifest and default DB on first render.
  useEffect(() => {
    (async () => {
      const m = await loadManifest();
      setManifest(m);
      setSelectedDbFile(m.defaultDb);

      const dbEntry = m.databases.find(d => d.file === m.defaultDb) ?? m.databases[0];
      const loaded = await loadSpeciescanDb(dbEntry.label, dbEntry.file);
      setDb(loaded);
      setDecoyTaxa(params.fdr.enabled
        ? buildDecoyTaxa(loaded, {
          nDecoys: params.fdr.nDecoys,
          maxDecoys: params.fdr.maxDecoys,
          seed: params.fdr.seed,
          mzMin: params.mzMin,
          mzMax: params.mzMax,
          toleranceDa: params.fdr.toleranceDa,
        })
        : []);

      const cont = await loadContaminants(m.contaminantsFile);
      setContaminants(cont);
    })().catch(e => setError(String((e as any)?.message ?? e)));
  }, []);

  // Keep the inspected taxon in sync with the current result.
  useEffect(() => {
    if (selectedResult?.rankedTaxa?.length) setInspectTaxonId(selectedResult.rankedTaxa[0].taxonId);
  }, [selectedResult]);

  // Reload reference DB and contaminants when selection changes.
  async function reloadDb(file: string | null) {
    if (!manifest || !file) return;
    setError(null);
    setBusy(true);
    try {
      const entry = manifest.databases.find(d => d.file === file);
      if (!entry) throw new Error("Unknown DB file");
      const loaded = await loadSpeciescanDb(entry.label, entry.file);
      setDb(loaded);
      setDecoyTaxa(params.fdr.enabled
        ? buildDecoyTaxa(loaded, {
          nDecoys: params.fdr.nDecoys,
          maxDecoys: params.fdr.maxDecoys,
          seed: params.fdr.seed,
          mzMin: params.mzMin,
          mzMax: params.mzMax,
          toleranceDa: params.fdr.toleranceDa,
        })
        : []);
      const cont = await loadContaminants(manifest.contaminantsFile);
      setContaminants(cont);
      setResults({});
      setInspectTaxonId(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!db) return;
    if (!params.fdr.enabled) {
      setDecoyTaxa([]);
      return;
    }
    setDecoyTaxa(buildDecoyTaxa(db, {
      nDecoys: params.fdr.nDecoys,
      maxDecoys: params.fdr.maxDecoys,
      seed: params.fdr.seed,
      mzMin: params.mzMin,
      mzMax: params.mzMax,
      toleranceDa: params.fdr.toleranceDa,
    }));
  }, [db, params.fdr, params.mzMin, params.mzMax]);

  // Parse uploaded files and append to the batch list.
  async function onFiles(files: File[]) {
    setError(null);
    setBusy(true);
    try {
      const parsed: Spectrum[] = [];
      const mode = files.length > 1 ? "batch_upload" : "single";
      for (const f of files) {
        const s = await parseSpectrumFile(f);
        parsed.push({ ...s, sourceMode: mode, sourcePath: "" });
      }
      setSpectra(prev => [...prev, ...parsed]);
      if (parsed.length) setSelectedId(parsed[0].id);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function getFolderLabel(file: File): string {
    const rel = (file as any)?.webkitRelativePath as string | undefined;
    if (!rel) return "";
    const parts = rel.split("/");
    return parts.length ? parts[0] : "";
  }

  function getRelativeFolderPath(file: File): string {
    const rel = (file as any)?.webkitRelativePath as string | undefined;
    if (!rel) return "";
    const parts = rel.split("/");
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/");
  }

  function fileStem(name: string): string {
    return name.replace(/\.(mzml|mzxml)$/i, "");
  }

  function getSampleIdFromFileName(name: string, separator: string): string {
    const stem = fileStem(name);
    const idx = separator ? stem.indexOf(separator) : -1;
    return idx > 0 ? stem.slice(0, idx) : stem;
  }

  function getSmartSampleIdFromFileName(name: string): string {
    const stem = fileStem(name);
    const match = stem.match(/^(.*?)[._-]?([1-9]|[abc])$/i);
    if (!match) return stem;
    const root = match[1]?.trim();
    if (!root) return stem;
    return root;
  }

  function buildFolderGroups(files: File[]) {
    if (!params.folderProcessing.groupReplicates) {
      return files.map((file) => ({
        key: `${getRelativeFolderPath(file)}::${fileStem(file.name)}`,
        sampleId: fileStem(file.name),
        sourcePath: getRelativeFolderPath(file),
        files: [file],
        sourceMode: "folder" as const,
      }));
    }

    const groups = new Map<string, { sampleId: string; sourcePath: string; files: File[] }>();
    for (const file of files) {
      const sourcePath = getRelativeFolderPath(file);
      const sampleId = params.folderProcessing.smartGroupReplicates
        ? getSmartSampleIdFromFileName(file.name)
        : getSampleIdFromFileName(file.name, params.folderProcessing.sampleIdSeparator);
      const key = `${sourcePath}::${sampleId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.files.push(file);
      } else {
        groups.set(key, { sampleId, sourcePath, files: [file] });
      }
    }

    return Array.from(groups.entries()).map(([key, value]) => ({
      key,
      sampleId: value.sampleId,
      sourcePath: value.sourcePath,
      files: value.files,
      sourceMode: "folder_group" as const,
    }));
  }

  async function onFolderFiles(files: File[]) {
    if (!db) {
      setError("Load a reference DB before processing a folder.");
      return;
    }
    const supported = files.filter(f => /\.(mzml|mzxml)$/i.test(f.name));
    if (!supported.length) {
      setError("No supported files found in the selected folder.");
      return;
    }

    const groups = buildFolderGroups(supported);
    const folderLabel = getFolderLabel(supported[0]) || "Selected folder";
    setFolderRun({ active: true, total: groups.length, processed: 0, folderLabel });
    setProcessingErrors([]);
    setError(null);
    setBusy(true);
    cancelFolderRef.current = false;

    for (let i = 0; i < groups.length; i++) {
      if (cancelFolderRef.current) break;
      const group = groups[i];
      try {
        const parsedGroup: Spectrum[] = [];
        for (const file of group.files) {
          try {
            const displayName = group.files.length > 1 ? group.sampleId : file.name;
            const parsed = await parseSpectrumFile(file);
            parsedGroup.push({
              ...parsed,
              id: parsedGroup.length === 0 ? `folder:${group.key}` : parsed.id,
              filename: parsedGroup.length === 0 ? displayName : parsed.filename,
              sourceMode: group.sourceMode,
              sourcePath: group.sourcePath || folderLabel,
              sampleId: group.sampleId,
              replicateCount: group.files.length,
              replicateFilenames: group.files.map(f => f.name),
            });
          } catch (e: any) {
            setProcessingErrors(prev => [
              ...prev,
              {
                filename: file.name,
                error: String(e?.message ?? e),
                sourceMode: group.sourceMode,
                sourcePath: group.sourcePath || folderLabel,
              }
            ]);
          }
        }
        if (!parsedGroup.length) continue;

        const result = parsedGroup.length > 1
          ? analyzeSpectrumGroup(parsedGroup, db, contaminants, params, decoyTaxa)
          : analyzeSpectrum(parsedGroup[0], db, contaminants, params, decoyTaxa);
        const lightResult: AnalysisResult = {
          ...result,
          rawMz: new Float64Array(0),
          rawIntensity: new Float64Array(0),
          processedMz: new Float64Array(0),
          processedIntensity: new Float64Array(0),
          peaks: [],
        };
        const primary = parsedGroup[0];
        setResults(prev => ({ ...prev, [primary.id]: lightResult }));
        setSpectra(prev => [
          ...prev,
          {
            id: primary.id,
            filename: group.files.length > 1 ? group.sampleId : group.files[0].name,
            mz: new Float64Array(0),
            intensity: new Float64Array(0),
            centroided: false,
            sourceMode: group.sourceMode,
            sourcePath: group.sourcePath || folderLabel,
            sampleId: group.sampleId,
            replicateCount: group.files.length,
            replicateFilenames: group.files.map(f => f.name),
          }
        ]);
      } catch (e: any) {
        setProcessingErrors(prev => [
          ...prev,
          {
            filename: group.sampleId,
            error: String(e?.message ?? e),
            sourceMode: group.sourceMode,
            sourcePath: group.sourcePath || folderLabel,
          }
        ]);
      } finally {
        setFolderRun(prev => ({ ...prev, processed: prev.processed + 1 }));
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    setFolderRun(prev => ({ ...prev, active: false }));
    setBusy(false);
  }

  function cancelFolderRun() {
    cancelFolderRef.current = true;
  }

  // Run analysis for selected spectra or a supplied id list.
  async function runAnalysis(ids?: string[]) {
    if (!db) return;
    setError(null);
    setBusy(true);
    try {
      const targets = ids?.length
        ? spectra.filter(s => ids.includes(s.id))
        : (selectedSpectrum ? [selectedSpectrum] : []);

      const next: Record<string, AnalysisResult> = {};
      const errors: string[] = [];
      await new Promise(resolve => setTimeout(resolve, 0));
      for (let i = 0; i < targets.length; i++) {
        const s = targets[i];
        try {
          next[s.id] = analyzeSpectrum(s, db, contaminants, params, decoyTaxa);
        } catch (e: any) {
          errors.push(`${s.filename}: ${String(e?.message ?? e)}`);
        }
        if (i % 5 === 4) await new Promise(resolve => setTimeout(resolve, 0));
      }
      setResults(prev => ({ ...prev, ...next }));
      if (errors.length) setError(`Batch completed with ${errors.length} error(s). First: ${errors[0]}`);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  // Queue analysis for all spectra in the batch.
  function runAll() {
    runAnalysis(spectra.map(s => s.id));
  }

  function exportSettings() {
    const payload = {
      version: 1,
      params,
      displayMode,
      displayNormalizeToMax,
      selectedDbFile: selectedDbFile ?? db?.meta.file ?? null,
      selectedDbLabel: db?.meta.label ?? null
    };
    const json = JSON.stringify(payload, null, 2);
    downloadText("ZooMZ_settings.json", json, "application/json");
  }

  async function importSettings(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const maybeParams = parsed?.params ?? parsed;
      setParams(normalizeParams(maybeParams));

      if (typeof parsed?.displayMode === "string") {
        const nextMode = parsed.displayMode === "raw" ? "raw" : "processed";
        setDisplayMode(nextMode);
      }
      if (typeof parsed?.displayNormalizeToMax === "boolean") {
        setDisplayNormalizeToMax(parsed.displayNormalizeToMax);
      }
      if (typeof parsed?.selectedDbFile === "string" && manifest?.databases?.length) {
        const exists = manifest.databases.some(d => d.file === parsed.selectedDbFile);
        if (exists) {
          setSelectedDbFile(parsed.selectedDbFile);
          reloadDb(parsed.selectedDbFile);
        }
      }
      setError(null);
    } catch (e: any) {
      setError(`Failed to import settings: ${String(e?.message ?? e)}`);
    }
  }

  // Export batch results to a multi-sheet Excel workbook.
  function exportBatchExcel() {
    if (!hasResults) {
      setError("Run analysis before exporting.");
      return;
    }

    const samples = spectra.filter(s => results[s.id]);
    const workbook = XLSX.utils.book_new();

    // Sheet 1: analysis parameters and methods paragraph
    const now = new Date();
    const analysisDateIso = now.toISOString();
    const analysisDateLocal = now.toLocaleString();
    const methodsParagraph = [
      "ZooMZ (Zooarchaeology by mass spectrometry) analyses were performed in the ZooMZ browser app.",
      `Analysis mode: ${params.analysisMode}.`,
      `Spectra were cropped to ${params.mzMin}-${params.mzMax} m/z.`,
      params.preprocess.enabled
        ? `Preprocessing was enabled with SG smoothing ${params.preprocess.smoothSG?.enabled ? `on (halfWindow=${params.preprocess.smoothSG.halfWindowSize}, polyOrder=${params.preprocess.smoothSG.polynomialOrder})` : "off"}, TIC normalisation ${params.preprocess.normalizeTIC ? "on" : "off"}, fixed-grid resampling ${params.preprocess.resampleToGrid ? "on" : "off"}, and baseline subtract ${params.preprocess.baselineSubtract.enabled ? `on (${params.preprocess.snipDecreasing ? "decreasing" : "ascending"} SNIP)` : "off"}.`
        : "Preprocessing was disabled.",
      params.peakPicking.enabled
        ? `Peak picking used a minimum relative intensity threshold of ${params.peakPicking.minRelativeIntensity}, a minimum peak distance of ${params.peakPicking.minPeakDistanceDa} Da, and a local-max half-window of ${params.peakPicking.localMaxHalfWindowSize} points.`
        : "Peak picking was disabled.",
      params.monoisotopic.enabled
        ? `Monoisotopic filtering used tolerance ${params.monoisotopic.toleranceDa} Da, isotope spacing ${params.monoisotopic.distanceDa} Da, and max isotopes ${params.monoisotopic.maxIsotopes}.`
        : "Monoisotopic filtering was disabled.",
      `Folder replicate grouping ${params.folderProcessing.groupReplicates ? `on (separator='${params.folderProcessing.sampleIdSeparator}')` : "off"}.`,
      params.folderProcessing.smartGroupReplicates
        ? "Smart replicate suffix grouping is enabled."
        : "Smart replicate suffix grouping is disabled.",
      `Scoring grid: start ${params.grid.startMz} m/z, end ${params.grid.endMz} m/z, step ${params.grid.stepMz} m/z.`,
      `Contaminant tolerance ${params.contaminantsToleranceDa} Da.`,
      `Analysis date: ${analysisDateLocal} (${analysisDateIso}).`
    ].join(" ");

    const paramsRows: (string | number)[][] = [
      ["Field", "Value"],
      ["Analysis date (local)", analysisDateLocal],
      ["Analysis date (ISO)", analysisDateIso],
      ["Reference DB label", db?.meta.label ?? ""],
      ["Reference DB file", db?.meta.file ?? ""],
      ["Analysis mode", params.analysisMode],
      ["Samples analyzed", samples.length],
      ["Spectra files", samples.map(s => s.filename).join("; ")],
      ["mzMin", params.mzMin],
      ["mzMax", params.mzMax],
      ["Preprocess enabled", params.preprocess.enabled ? "Yes" : "No"],
      ["SG smoothing", params.preprocess.smoothSG?.enabled ? `Yes (halfWindow=${params.preprocess.smoothSG.halfWindowSize}, polyOrder=${params.preprocess.smoothSG.polynomialOrder})` : "No"],
      ["TIC normalisation", params.preprocess.normalizeTIC ? "Yes" : "No"],
      ["Normalize to max (legacy)", params.preprocess.normalizeToMax ? "Yes" : "No"],
      ["Resample to fixed grid", params.preprocess.resampleToGrid ? "Yes" : "No"],
      ["Baseline subtract enabled", params.preprocess.baselineSubtract.enabled ? "Yes" : "No"],
      ["Baseline subtract iterations", params.preprocess.baselineSubtract.iterations],
      ["SNIP decreasing window", params.preprocess.snipDecreasing ? "Yes" : "No"],
      ["Peak picking enabled", params.peakPicking.enabled ? "Yes" : "No"],
      ["Peak min relative intensity", params.peakPicking.minRelativeIntensity],
      ["Peak min distance (Da)", params.peakPicking.minPeakDistanceDa],
      ["Peak local-max half-window (pts)", params.peakPicking.localMaxHalfWindowSize],
      ["Monoisotopic enabled", params.monoisotopic.enabled ? "Yes" : "No"],
      ["Monoisotopic tolerance (Da)", params.monoisotopic.toleranceDa],
      ["Monoisotopic spacing (Da)", params.monoisotopic.distanceDa],
      ["Monoisotopic max isotopes", params.monoisotopic.maxIsotopes],
      ["Require isotope cluster", params.monoisotopic.requireCluster ? "Yes" : "No"],
      ["Folder replicate grouping", params.folderProcessing.groupReplicates ? "Yes" : "No"],
      ["Folder smart grouping", params.folderProcessing.smartGroupReplicates ? "Yes" : "No"],
      ["Folder sample ID separator", params.folderProcessing.sampleIdSeparator],
      ["Folder replicate min peaks", params.folderProcessing.minReplicatePeaks],
      ["Folder replicate max peaks", params.folderProcessing.maxReplicatePeaks],
      ["Scoring grid start (m/z)", params.grid.startMz],
      ["Scoring grid end (m/z)", params.grid.endMz],
      ["Scoring grid step (m/z)", params.grid.stepMz],
      ["Contaminants tolerance (Da)", params.contaminantsToleranceDa],
      ["Methods paragraph", methodsParagraph],
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(paramsRows), "Parameters");

    // Sheet 1: top-10 taxa per sample
    const topHeader = ["Rank", ...samples.map(s => s.filename)];
    const topRows: (string | number)[][] = [topHeader];
    for (let i = 0; i < 10; i++) {
      const row: (string | number)[] = [`${i + 1}`];
      for (const s of samples) {
        const r = results[s.id];
        const t = r?.rankedTaxa?.[i];
        row.push(t ? `${t.taxonLabel} (${t.correlation.toFixed(3)})` : "");
      }
      topRows.push(row);
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(topRows), "Top 10 Taxa");

    // Sheet 2: marker matches (Speciescan-style, samples as rows)
    const markerNameOrder: string[] = [];
    const markerNames = new Set<string>();
    const markerMaps = new Map<string, Map<string, number>>();

    for (const s of samples) {
      const r = results[s.id];
      const top = r?.rankedTaxa?.[0];
      const rows = top ? (r?.taxonMatchesTop[top.taxonId] ?? []) : [];
      const m = new Map<string, number>();
      for (const row of rows) {
        if (!markerNames.has(row.markerName)) {
          markerNames.add(row.markerName);
          markerNameOrder.push(row.markerName);
        }
        if (row.matchedPeakMz != null) {
          m.set(row.markerName, row.matchedPeakMz);
        }
      }
      markerMaps.set(s.id, m);
    }

    const speciescanHeader = [
      "Sample",
      ...markerNameOrder,
      "ZooMS_taxon",
      "Family",
      "Order",
      "Correlation"
    ];
    const speciescanRows: (string | number | null)[][] = [speciescanHeader];
    for (const s of samples) {
      const r = results[s.id];
      const top = r?.rankedTaxa?.[0];
      const topLabel = top?.taxonLabel ?? null;
      const taxon = top ? db?.taxa.find(t => t.id === top.taxonId) ?? null : null;
      const m = markerMaps.get(s.id);
      const row: (string | number | null)[] = [s.filename];
      for (const name of markerNameOrder) {
        row.push(m?.get(name) ?? null);
      }
      row.push(topLabel);
      row.push(taxon?.family ?? null);
      row.push(taxon?.order ?? null);
      row.push(top?.correlation ?? null);
      speciescanRows.push(row);
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(speciescanRows), "Marker Matches");

    // Sheet 3: contaminants per sample
    const contaminantOrder: string[] = [];
    const contaminantNames = new Set<string>();
    const contaminantMaps = new Map<string, Map<string, { mz: number; intensity: number }>>();
    for (const s of samples) {
      const r = results[s.id];
      const rows = r?.contaminants ?? [];
      const m = new Map<string, { mz: number; intensity: number }>();
      for (const row of rows) {
        if (!contaminantNames.has(row.name)) {
          contaminantNames.add(row.name);
          contaminantOrder.push(row.name);
        }
        m.set(row.name, { mz: row.matchedPeakMz, intensity: row.intensity });
      }
      contaminantMaps.set(s.id, m);
    }

    const contHeader = ["Contaminant", ...samples.map(s => s.filename)];
    const contRows: (string | number)[][] = [contHeader];
    for (const name of contaminantOrder) {
      const row: (string | number)[] = [name];
      for (const s of samples) {
        const m = contaminantMaps.get(s.id);
        const match = m?.get(name);
        row.push(formatMatch(match?.mz, match?.intensity));
      }
      contRows.push(row);
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(contRows), "Contaminants");

    // QC Summary (one row per analyzed sample)
    const qcHeader = [
      "spectrumId",
      "filename",
      "sample_id",
      "replicate_count",
      "source_mode",
      "source_path",
      "db_label",
      "db_file",
      "mzMin",
      "mzMax",
      "centroided",
      "peakCount",
      "maxIntensity",
      "spectral_qc_suspect",
      "spectral_qc_notes",
      "tic",
      "nonzeroFraction",
      "peakDensity",
      "dynamicRange",
      "preprocess_enabled",
      "smoothSG_enabled",
      "smoothSG_halfWindowSize",
      "normalizeTIC",
      "normalizeToMax",
      "baselineSubtract_enabled",
      "baselineSubtract_iterations",
      "peakpick_enabled",
      "minRelativeIntensity",
      "minPeakDistanceDa",
      "monoisotopic_enabled",
      "mono_toleranceDa",
      "mono_distanceDa",
      "mono_maxIsotopes",
      "topTaxonId",
      "topTaxonLabel",
      "topCorrelation",
      "markersTotalTop",
      "markersMatchedTop",
      "fracMarkersMatchedTop",
      "medianAbsDeltaDaTop",
      "medianAbsPpmTop",
      "iqrAbsPpmTop",
      "medianMatchedIntensityTop",
      "contaminantsMatched",
      "maxContaminantIntensity",
      "confidence_level",
      "ratio",
      "decoy_gap",
      "target_gap",
      "confidence_notes",
      "nDecoys",
      "bestDecoyScore",
      "decoyGap",
      "qSample",
      "qcFlag",
      "qcNotes",
    ] as const;

    const qcRows = samples.map((s) => {
      const r = results[s.id];
      const qc = r?.qc;
      const top = r?.rankedTaxa?.[0];
      const topTaxonId = top?.taxonId;
      const markerRows = topTaxonId ? (r?.taxonMatchesTop[topTaxonId] ?? []) : [];
      const matchedMarkerRows = markerRows.filter(m => m.matched === true && m.matchedPeakMz != null);

      const absDeltaDa: number[] = [];
      const absPpm: number[] = [];
      const matchedIntensities: number[] = [];
      for (const m of matchedMarkerRows) {
        if (m.matchedPeakMz != null && m.expectedMz > 0) {
          const delta = m.matchedPeakMz - m.expectedMz;
          absDeltaDa.push(Math.abs(delta));
          absPpm.push(Math.abs((delta / m.expectedMz) * 1e6));
        }
        if (m.matchedPeakIntensity != null) matchedIntensities.push(m.matchedPeakIntensity);
      }

      const markersMatchedTop = matchedMarkerRows.length;
      const markersTotalTop = markerRows.length;
      const fracMarkersMatchedTop = markersTotalTop ? (markersMatchedTop / markersTotalTop) : null;
      const medianAbsDeltaDaTop = median(absDeltaDa);
      const medianAbsPpmTop = median(absPpm);
      const iqrAbsPpmTop = iqr(absPpm);
      const medianMatchedIntensityTop = median(matchedIntensities);

      const contaminantsMatched = r?.contaminants?.length ?? 0;
      const maxContaminantIntensity = r?.contaminants?.length
        ? Math.max(...r.contaminants.map(c => c.intensity))
        : null;

      const fdr = r?.fdr;
      const qSample = Number.isFinite(fdr?.qSample ?? NaN) ? (fdr?.qSample ?? null) : null;
      const confidence = computeConfidence({
        bestScore: top?.correlation ?? null,
        bestLabel: top?.taxonLabel ?? null,
        secondScore: r?.rankedTaxa?.[1]?.correlation ?? null,
        secondLabel: r?.rankedTaxa?.[1]?.taxonLabel ?? null,
        bestDecoyScore: fdr?.bestDecoyScore ?? null,
        qSample,
        matchedMarkers: markersMatchedTop,
      });

      const qcNotes: string[] = [];
      const spectralNotes: string[] = [];
      let qcFlag: "OK" | "WARN" | "FAIL" = "OK";
      const peakCount = qc?.peakCount ?? null;
      const spectralSuspect = qc?.suspect ?? false;

      if (peakCount !== null && peakCount < QC_MIN_PEAKS) qcNotes.push("low peak count");
      if (markersMatchedTop < QC_MIN_MARKERS) qcNotes.push("few markers matched");
      if (qcNotes.length) qcFlag = "FAIL";

      if (qcFlag !== "FAIL") {
        if (fracMarkersMatchedTop !== null && fracMarkersMatchedTop < QC_MIN_FRAC) qcNotes.push("low marker fraction");
        if (medianAbsPpmTop !== null && medianAbsPpmTop > QC_MAX_MEDIAN_PPM) qcNotes.push("high ppm error");
        if (contaminantsMatched >= QC_MAX_CONTAMS) qcNotes.push("many contaminants");
        if (qcNotes.length) qcFlag = "WARN";
      }
      if (spectralSuspect) {
        spectralNotes.push(`spectral quality suspect: ${qc?.notes.join("; ") ?? ""}`.trim());
        if (qcFlag === "OK") qcFlag = "WARN";
      }

      return {
        spectrumId: s.id,
        filename: s.filename,
        sample_id: s.sampleId ?? null,
        replicate_count: s.replicateCount ?? 1,
        source_mode: s.sourceMode ?? null,
        source_path: s.sourcePath ?? null,
        db_label: db?.meta.label ?? null,
        db_file: db?.meta.file ?? null,
        mzMin: qc?.mzMin ?? params.mzMin,
        mzMax: qc?.mzMax ?? params.mzMax,
        centroided: s.centroided ?? null,
        peakCount,
        maxIntensity: qc?.maxIntensity ?? null,
        spectral_qc_suspect: spectralSuspect,
        spectral_qc_notes: spectralNotes.join("; "),
        tic: qc?.tic ?? null,
        nonzeroFraction: qc?.nonzeroFraction ?? null,
        peakDensity: qc?.peakDensity ?? null,
        dynamicRange: qc?.dynamicRange ?? null,
        preprocess_enabled: params.preprocess.enabled,
        smoothSG_enabled: params.preprocess.smoothSG?.enabled ?? false,
        smoothSG_halfWindowSize: params.preprocess.smoothSG?.halfWindowSize ?? 10,
        normalizeTIC: params.preprocess.normalizeTIC,
        normalizeToMax: params.preprocess.normalizeToMax,
        baselineSubtract_enabled: params.preprocess.baselineSubtract.enabled,
        baselineSubtract_iterations: params.preprocess.baselineSubtract.iterations,
        peakpick_enabled: params.peakPicking.enabled,
        minRelativeIntensity: params.peakPicking.minRelativeIntensity,
        minPeakDistanceDa: params.peakPicking.minPeakDistanceDa,
        monoisotopic_enabled: params.monoisotopic.enabled,
        mono_toleranceDa: params.monoisotopic.toleranceDa,
        mono_distanceDa: params.monoisotopic.distanceDa,
        mono_maxIsotopes: params.monoisotopic.maxIsotopes,
        topTaxonId: top?.taxonId ?? null,
        topTaxonLabel: top?.taxonLabel ?? null,
        topCorrelation: top?.correlation ?? null,
        markersTotalTop,
        markersMatchedTop,
        fracMarkersMatchedTop,
        medianAbsDeltaDaTop,
        medianAbsPpmTop,
        iqrAbsPpmTop,
        medianMatchedIntensityTop,
        contaminantsMatched,
        maxContaminantIntensity,
        confidence_level: confidence.confidenceLevel,
        ratio: confidence.ratio,
        decoy_gap: confidence.decoyGap,
        target_gap: confidence.targetGap,
        confidence_notes: confidence.notes,
        nDecoys: fdr?.nDecoys ?? 0,
        bestDecoyScore: Number.isFinite(fdr?.bestDecoyScore ?? NaN) ? (fdr?.bestDecoyScore ?? null) : null,
        decoyGap: Number.isFinite(fdr?.decoyGap ?? NaN) ? (fdr?.decoyGap ?? null) : null,
        qSample,
        qcFlag,
        qcNotes: qcNotes.join("; "),
      };
    });

    const qcSheet = XLSX.utils.json_to_sheet(qcRows, { header: [...qcHeader] });
    qcSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(workbook, qcSheet, "QC Summary");

    const qcMarkerHeader = [
      "spectrumId",
      "filename",
      "topTaxonId",
      "topTaxonLabel",
      "markerName",
      "expectedMz",
      "matched",
      "matchedPeakMz",
      "matchedPeakIntensity",
      "deltaDa",
      "ppm",
    ] as const;

    const qcMarkerRows = samples.flatMap((s) => {
      const r = results[s.id];
      const top = r?.rankedTaxa?.[0];
      const topTaxonId = top?.taxonId;
      const rows = topTaxonId ? (r?.taxonMatchesTop[topTaxonId] ?? []) : [];
      return rows.map((m) => {
        const deltaDa = m.matchedPeakMz != null ? (m.matchedPeakMz - m.expectedMz) : null;
        const ppm = (deltaDa != null && m.expectedMz > 0) ? (deltaDa / m.expectedMz) * 1e6 : null;
        return {
          spectrumId: s.id,
          filename: s.filename,
          topTaxonId: top?.taxonId ?? null,
          topTaxonLabel: top?.taxonLabel ?? null,
          markerName: m.markerName,
          expectedMz: m.expectedMz,
          matched: m.matched,
          matchedPeakMz: m.matchedPeakMz ?? null,
          matchedPeakIntensity: m.matchedPeakIntensity ?? null,
          deltaDa,
          ppm,
        };
      });
    });

    const qcMarkerSheet = XLSX.utils.json_to_sheet(qcMarkerRows, { header: [...qcMarkerHeader] });
    XLSX.utils.book_append_sheet(workbook, qcMarkerSheet, "QC Markers");

    if (processingErrors.length) {
      const errorRows = processingErrors.map(e => ({
        filename: e.filename,
        error: e.error,
        source_mode: e.sourceMode,
        source_path: e.sourcePath
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(errorRows), "Errors");
    }

    XLSX.writeFile(workbook, "ZooMZ_results.xlsx");
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>ZooMZ - App for Zooarchaeology by mass spectrometry (ZooMS)</div>
          <div className="small">SpecieScan-style correlation scoring + marker/contaminant analysis. 
            :: <a href="https://github.com/arthuc01/ZooMZ">Github repository</a>
          </div>
        </div>
        <div style={{ display:"flex", gap: 8 }}>
          <button className="btn primary" disabled={busy || !selectedSpectrum || !db} onClick={() => runAnalysis()}>
            Run selected
          </button>
          <button className="btn" disabled={busy || !spectra.length || !db} onClick={runAll}>
            Run batch
          </button>
          <button className="btn" disabled={!hasResults} onClick={exportBatchExcel}>
            Export batch Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor:"#fecaca", background:"#fff5f5" }}>
          <b>Error:</b> {error}
        </div>
      )}

      <Dropzone onFiles={onFiles} onFolderFiles={onFolderFiles} />
      {folderRun.total > 0 && (
        <div className="small" style={{ marginTop: 8 }}>
          Folder: <b>{folderRun.folderLabel}</b> · Processed {folderRun.processed} / {folderRun.total}
          {folderRun.active && (
            <button className="btn" style={{ marginLeft: 8 }} onClick={cancelFolderRun}>Cancel</button>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <div className="col left" style={{ gap: 20 }}>
          <SpectrumPlot
            spectrum={selectedSpectrum}
            result={selectedResult}
            taxonIdForMarkers={inspectTaxonId}
            displayMode={displayMode}
            displayNormalizeToMax={displayNormalizeToMax}
          />
          <ResultsTable
            result={selectedResult}
            selectedTaxonId={inspectTaxonId}
            onSelectTaxon={(id)=>setInspectTaxonId(id)}
          />
          <TaxonomyPanel
            result={selectedResult}
            db={db}
            selectedTaxonId={inspectTaxonId}
            onSelectTaxon={(id)=>setInspectTaxonId(id)}
          />
        </div>
        <div className="col right">
          <SettingsPanel
            manifest={manifest}
            selectedDbFile={selectedDbFile}
            onSelectDbFile={(f)=>{ setSelectedDbFile(f); reloadDb(f); }}
            db={db}
            params={params}
            onChange={(next)=>setParams(normalizeParams(next))}
            onApplyAnalysisMode={applyAnalysisMode}
            onReloadDb={() => reloadDb(selectedDbFile)}
            onExportSettings={exportSettings}
            onImportSettings={importSettings}
            displayMode={displayMode}
            onChangeDisplayMode={setDisplayMode}
            displayNormalizeToMax={displayNormalizeToMax}
            onChangeDisplayNormalizeToMax={setDisplayNormalizeToMax}
          />
          <BatchQueueTable
            spectra={spectra}
            results={results}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <MarkerMatchTable
            result={selectedResult}
            taxonId={inspectTaxonId}
          />
        </div>
      </div>
    </div>
  );
}
