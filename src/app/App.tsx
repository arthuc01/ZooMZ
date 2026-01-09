import React, { useEffect, useMemo, useState } from "react";
import Dropzone from "../ui/Dropzone";
import SpectrumPlot from "../ui/SpectrumPlot";
import ResultsTable from "../ui/ResultsTable";
import MarkerMatchTable from "../ui/MarkerMatchTable";
import BatchQueueTable from "../ui/BatchQueueTable";
import SettingsPanel from "../ui/SettingsPanel";
import ContaminantsTable from "../ui/ContaminantsTable";
import * as XLSX from "xlsx";

import type { AnalysisParams, AnalysisResult, Contaminant, DbManifest, RefTaxon, SpeciescanDb, Spectrum } from "../engine/types";
import { parseSpectrumFile } from "../engine/parse";
import { analyzeSpectrum } from "../engine/analyze";
import { loadContaminants, loadManifest, loadSpeciescanDb } from "../engine/speciescanDb";
import { buildDecoyTaxa } from "../engine/decoys";

const DEFAULT_PARAMS: AnalysisParams = {
  mzMin: 500,
  mzMax: 3500,
  preprocess: { enabled: true, normalizeToMax: true },
  peakPicking: { enabled: true, minRelativeIntensity: 0.05, minPeakDistanceDa: 0.8 },
  monoisotopic: { enabled: true, toleranceDa: 0.2, distanceDa: 1.00235, maxIsotopes: 5 },
  grid: { startMz: 500, endMz: 3500, stepMz: 0.1 },
  contaminantsToleranceDa: 0.3
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

  const selectedSpectrum = useMemo(() => spectra.find(s => s.id === selectedId) ?? null, [spectra, selectedId]);
  const selectedResult = useMemo(() => (selectedId ? results[selectedId] ?? null : null), [results, selectedId]);
  const hasResults = useMemo(() => Object.values(results).some(Boolean), [results]);

  // Load manifest and default DB on first render.
  useEffect(() => {
    (async () => {
      const m = await loadManifest();
      setManifest(m);
      setSelectedDbFile(m.defaultDb);

      const dbEntry = m.databases.find(d => d.file === m.defaultDb) ?? m.databases[0];
      const loaded = await loadSpeciescanDb(dbEntry.label, dbEntry.file);
      setDb(loaded);
      setDecoyTaxa(buildDecoyTaxa(loaded, { mzMin: params.mzMin, mzMax: params.mzMax, toleranceDa: 0.3 }));

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
      setDecoyTaxa(buildDecoyTaxa(loaded, { mzMin: params.mzMin, mzMax: params.mzMax, toleranceDa: 0.3 }));
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

  // Parse uploaded files and append to the batch list.
  async function onFiles(files: File[]) {
    setError(null);
    setBusy(true);
    try {
      const parsed: Spectrum[] = [];
      for (const f of files) parsed.push(await parseSpectrumFile(f));
      setSpectra(prev => [...prev, ...parsed]);
      if (parsed.length) setSelectedId(parsed[0].id);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
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

  // Format a match as "mz (intensity)" for Excel cells.
  function formatMatch(mz: number | null | undefined, intensity: number | null | undefined): string {
    if (mz == null || intensity == null) return "";
    return `${mz.toFixed(3)} (${intensity.toFixed(3)})`;
  }

  // Compute the median of a numeric array, or null when empty.
  function median(numbers: number[]): number | null {
    if (!numbers.length) return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
  }

  // Compute the interquartile range of a numeric array, or null when empty.
  function iqr(numbers: number[]): number | null {
    if (numbers.length < 4) return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    const q1Idx = Math.floor((sorted.length - 1) * 0.25);
    const q3Idx = Math.floor((sorted.length - 1) * 0.75);
    return sorted[q3Idx] - sorted[q1Idx];
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
      `Spectra were cropped to ${params.mzMin}-${params.mzMax} m/z.`,
      params.preprocess.enabled
        ? `Preprocessing was enabled with normalize-to-max ${params.preprocess.normalizeToMax ? "on" : "off"}.`
        : "Preprocessing was disabled.",
      params.peakPicking.enabled
        ? `Peak picking used a minimum relative intensity threshold of ${params.peakPicking.minRelativeIntensity} and a minimum peak distance of ${params.peakPicking.minPeakDistanceDa} Da.`
        : "Peak picking was disabled.",
      params.monoisotopic.enabled
        ? `Monoisotopic filtering used tolerance ${params.monoisotopic.toleranceDa} Da, isotope spacing ${params.monoisotopic.distanceDa} Da, and max isotopes ${params.monoisotopic.maxIsotopes}.`
        : "Monoisotopic filtering was disabled.",
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
      ["Samples analyzed", samples.length],
      ["Spectra files", samples.map(s => s.filename).join("; ")],
      ["mzMin", params.mzMin],
      ["mzMax", params.mzMax],
      ["Preprocess enabled", params.preprocess.enabled ? "Yes" : "No"],
      ["Normalize to max", params.preprocess.normalizeToMax ? "Yes" : "No"],
      ["Peak picking enabled", params.peakPicking.enabled ? "Yes" : "No"],
      ["Peak min relative intensity", params.peakPicking.minRelativeIntensity],
      ["Peak min distance (Da)", params.peakPicking.minPeakDistanceDa],
      ["Monoisotopic enabled", params.monoisotopic.enabled ? "Yes" : "No"],
      ["Monoisotopic tolerance (Da)", params.monoisotopic.toleranceDa],
      ["Monoisotopic spacing (Da)", params.monoisotopic.distanceDa],
      ["Monoisotopic max isotopes", params.monoisotopic.maxIsotopes],
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

    // Sheet 2: marker matches for each sample's top-ranked taxon
    const markerNameOrder: string[] = [];
    const markerNames = new Set<string>();
    const markerMaps = new Map<string, Map<string, { mz: number; intensity: number }>>();

    for (const s of samples) {
      const r = results[s.id];
      const top = r?.rankedTaxa?.[0];
      const rows = top ? (r?.taxonMatchesTop[top.taxonId] ?? []) : [];
      const m = new Map<string, { mz: number; intensity: number }>();
      for (const row of rows) {
        if (!markerNames.has(row.markerName)) {
          markerNames.add(row.markerName);
          markerNameOrder.push(row.markerName);
        }
        if (row.matchedPeakMz != null && row.matchedPeakIntensity != null) {
          m.set(row.markerName, { mz: row.matchedPeakMz, intensity: row.matchedPeakIntensity });
        }
      }
      markerMaps.set(s.id, m);
    }

    const markerHeader = ["Marker", ...samples.map(s => s.filename)];
    const markerRows: (string | number)[][] = [markerHeader];
    for (const name of markerNameOrder) {
      const row: (string | number)[] = [name];
      for (const s of samples) {
        const m = markerMaps.get(s.id);
        const match = m?.get(name);
        row.push(formatMatch(match?.mz, match?.intensity));
      }
      markerRows.push(row);
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(markerRows), "Marker Matches");

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
    const QC_MIN_PEAKS = 30;
    const QC_MIN_MARKERS = 3;
    const QC_MIN_FRAC = 0.2;
    const QC_MAX_MEDIAN_PPM = 50;
    const QC_MAX_CONTAMS = 3;

    const qcHeader = [
      "spectrumId",
      "filename",
      "db_label",
      "db_file",
      "mzMin",
      "mzMax",
      "centroided",
      "peakCount",
      "maxIntensity",
      "preprocess_enabled",
      "normalizeToMax",
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
      "nDecoys",
      "bestDecoyScore",
      "decoyGap",
      "qSample",
      "confidenceLabel",
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
      const qSample = Number.isFinite(fdr?.qSample ?? NaN) ? fdr?.qSample ?? null : null;
      const confidenceLabel = qSample == null
        ? null
        : (qSample <= 0.01 ? "High" : (qSample <= 0.05 ? "Medium" : "Low"));

      const qcNotes: string[] = [];
      let qcFlag: "OK" | "WARN" | "FAIL" = "OK";
      const peakCount = qc?.peakCount ?? null;

      if (peakCount !== null && peakCount < QC_MIN_PEAKS) qcNotes.push("low peak count");
      if (markersMatchedTop < QC_MIN_MARKERS) qcNotes.push("few markers matched");
      if (qcNotes.length) qcFlag = "FAIL";

      if (qcFlag !== "FAIL") {
        if (fracMarkersMatchedTop !== null && fracMarkersMatchedTop < QC_MIN_FRAC) qcNotes.push("low marker fraction");
        if (medianAbsPpmTop !== null && medianAbsPpmTop > QC_MAX_MEDIAN_PPM) qcNotes.push("high ppm error");
        if (contaminantsMatched >= QC_MAX_CONTAMS) qcNotes.push("many contaminants");
        if (qcNotes.length) qcFlag = "WARN";
      }

      return {
        spectrumId: s.id,
        filename: s.filename,
        db_label: db?.meta.label ?? null,
        db_file: db?.meta.file ?? null,
        mzMin: qc?.mzMin ?? params.mzMin,
        mzMax: qc?.mzMax ?? params.mzMax,
        centroided: s.centroided ?? null,
        peakCount,
        maxIntensity: qc?.maxIntensity ?? null,
        preprocess_enabled: params.preprocess.enabled,
        normalizeToMax: params.preprocess.normalizeToMax,
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
        nDecoys: fdr?.nDecoys ?? 0,
        bestDecoyScore: Number.isFinite(fdr?.bestDecoyScore ?? NaN) ? fdr?.bestDecoyScore ?? null : null,
        decoyGap: Number.isFinite(fdr?.decoyGap ?? NaN) ? fdr?.decoyGap ?? null : null,
        qSample,
        confidenceLabel,
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

      <Dropzone onFiles={onFiles} />

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
        </div>
        <div className="col right">
          <SettingsPanel
            manifest={manifest}
            selectedDbFile={selectedDbFile}
            onSelectDbFile={(f)=>{ setSelectedDbFile(f); reloadDb(f); }}
            db={db}
            params={params}
            onChange={setParams}
            onReloadDb={() => reloadDb(selectedDbFile)}
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
          <MarkerMatchTable result={selectedResult} taxonId={inspectTaxonId} />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <ContaminantsTable result={selectedResult} />
      </div>

      <div className="small" style={{ marginTop: 14 }}>
        Local dev: <code>npm install</code> then <code>npm run dev</code>. Reference DBs live in <code>public/reference_dbs</code>.
      </div>
    </div>
  );
}
