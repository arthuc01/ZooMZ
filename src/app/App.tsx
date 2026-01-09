import React, { useEffect, useMemo, useState } from "react";
import Dropzone from "../ui/Dropzone";
import SpectrumPlot from "../ui/SpectrumPlot";
import ResultsTable from "../ui/ResultsTable";
import MarkerMatchTable from "../ui/MarkerMatchTable";
import BatchQueueTable from "../ui/BatchQueueTable";
import SettingsPanel from "../ui/SettingsPanel";
import ContaminantsTable from "../ui/ContaminantsTable";

import type { AnalysisParams, AnalysisResult, Contaminant, DbManifest, SpeciescanDb, Spectrum } from "../engine/types";
import { parseSpectrumFile } from "../engine/parse";
import { analyzeSpectrum } from "../engine/analyze";
import { loadContaminants, loadManifest, loadSpeciescanDb } from "../engine/speciescanDb";
import { downloadText } from "../utils/download";

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

  // Load manifest and default DB on first render.
  useEffect(() => {
    (async () => {
      const m = await loadManifest();
      setManifest(m);
      setSelectedDbFile(m.defaultDb);

      const dbEntry = m.databases.find(d => d.file === m.defaultDb) ?? m.databases[0];
      const loaded = await loadSpeciescanDb(dbEntry.label, dbEntry.file);
      setDb(loaded);

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
          next[s.id] = analyzeSpectrum(s, db, contaminants, params);
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

  // Export marker matches for the selected taxon as CSV.
  function exportSelected() {
    if (!selectedSpectrum || !selectedResult || !inspectTaxonId) return;
    const rows = selectedResult.taxonMatchesTop[inspectTaxonId] ?? [];
    // Escape CSV cells safely.
    const csvEscape = (value: string) => {
      const needsQuotes = /[",\r\n]/.test(value);
      const escaped = value.replace(/"/g, '""');
      return needsQuotes ? `"${escaped}"` : escaped;
    };
    const csv = [
      ["markerName","expectedMz","matched","matchedPeakMz","matchedPeakIntensity"].join(","),
      ...rows.map(r => [
        csvEscape(r.markerName),
        r.expectedMz.toFixed(6),
        r.matched ? "1" : "0",
        r.matchedPeakMz === null ? "" : r.matchedPeakMz.toFixed(6),
        r.matchedPeakIntensity === null ? "" : String(r.matchedPeakIntensity)
      ].join(","))
    ].join("\r\n");

    downloadText(selectedSpectrum.filename.replace(/\.(mzml|mzxml)$/i, "") + "_marker_matches.csv", csv, "text/csv");
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>ZooMS Browser</div>
          <div className="small">SpecieScan-style correlation scoring + marker/contaminant overlays.</div>
        </div>
        <div style={{ display:"flex", gap: 8 }}>
          <button className="btn primary" disabled={busy || !selectedSpectrum || !db} onClick={() => runAnalysis()}>
            Run selected
          </button>
          <button className="btn" disabled={busy || !spectra.length || !db} onClick={runAll}>
            Run batch
          </button>
          <button className="btn" disabled={!selectedResult || !inspectTaxonId} onClick={exportSelected}>
            Export selected-tax. markers CSV
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
        <div className="col left">
          <SpectrumPlot
            spectrum={selectedSpectrum}
            result={selectedResult}
            taxonIdForMarkers={inspectTaxonId}
            displayMode={displayMode}
            displayNormalizeToMax={displayNormalizeToMax}
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
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <div className="col left">
          <ResultsTable
            result={selectedResult}
            selectedTaxonId={inspectTaxonId}
            onSelectTaxon={(id)=>setInspectTaxonId(id)}
          />
        </div>
        <div className="col right">
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
