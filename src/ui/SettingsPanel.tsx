import React from "react";
import type { AnalysisParams, DbManifest, SpeciescanDb } from "../engine/types";

type Props = {
  manifest: DbManifest | null;
  selectedDbFile: string | null;
  onSelectDbFile: (file: string) => void;
  db: SpeciescanDb | null;
  params: AnalysisParams;
  onChange: (p: AnalysisParams) => void;
  onApplyAnalysisMode: (mode: AnalysisParams["analysisMode"]) => void;
  onReloadDb: () => void;
  onExportSettings: () => void;
  onImportSettings: (file: File) => void;

  displayMode: "raw" | "processed";
  onChangeDisplayMode: (m: "raw" | "processed") => void;
  displayNormalizeToMax: boolean;
  onChangeDisplayNormalizeToMax: (v: boolean) => void;
};

// Render analysis and display settings controls.
export default function SettingsPanel(props: Props) {
  const {
    manifest, selectedDbFile, onSelectDbFile, db,
    params, onChange, onApplyAnalysisMode, onReloadDb,
    onExportSettings, onImportSettings,
    displayMode, onChangeDisplayMode,
    displayNormalizeToMax, onChangeDisplayNormalizeToMax
  } = props;

  return (
    <details className="card" open>
      <summary style={{ display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
        <div style={{ fontWeight: 800 }}>Settings</div>
        <button
          className="btn"
          onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); onReloadDb(); }}
        >
          Reload DB
        </button>
      </summary>

      <div className="small" style={{ marginTop: 6 }} title="Select the Speciescan-style reference database used for scoring.">Reference DB</div>
      <select
        className="input"
        value={selectedDbFile ?? ""}
        onChange={(e)=>onSelectDbFile(e.target.value)}
        disabled={!manifest}
        title="Select the Speciescan-style reference database used for scoring."
      >
        {(manifest?.databases ?? []).map(d => (
          <option key={d.file} value={d.file}>{d.label}</option>
        ))}
      </select>

      <div className="small" style={{ marginTop: 10 }} title="Choose the production-style or benchmark-faithful analysis path.">Analysis mode</div>
      <select
        className="input"
        value={params.analysisMode}
        onChange={(e)=>onApplyAnalysisMode(e.target.value as AnalysisParams["analysisMode"])}
        title="SpecieScan benchmark mode applies the benchmark-faithful grid, preprocessing, and replicate-handling defaults."
      >
        <option value="standard">Standard browser mode</option>
        <option value="speciescan_benchmark">SpecieScan benchmark mode</option>
      </select>

      <div className="small" style={{ marginTop: 10 }} title="Control how the spectrum is displayed.">Plot display</div>
      <div style={{ display:"flex", gap: 8 }}>
        <select
          className="input"
          value={displayMode}
          onChange={(e)=>onChangeDisplayMode(e.target.value as any)}
          title="Choose raw data or processed data for the spectrum plot."
        >
          <option value="raw">Raw</option>
          <option value="processed">Processed</option>
        </select>
        <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Scale displayed intensities so the maximum is 1.0.">
          <input type="checkbox" checked={displayNormalizeToMax} onChange={(e)=>onChangeDisplayNormalizeToMax(e.target.checked)} />
          Normalize display to max
        </label>
      </div>

      <div className="small" style={{ marginTop: 10 }} title="Restrict analysis to this m/z range.">m/z window</div>
      <div style={{ display:"flex", gap: 8 }}>
        <input
          className="input"
          type="number"
          value={params.mzMin}
          onChange={(e)=>onChange({ ...params, mzMin: Number(e.target.value) })}
          title="Lower bound of the m/z range used for analysis."
        />
        <input
          className="input"
          type="number"
          value={params.mzMax}
          onChange={(e)=>onChange({ ...params, mzMax: Number(e.target.value) })}
          title="Upper bound of the m/z range used for analysis."
        />
      </div>

      <div className="small" style={{ marginTop: 10 }} title="Optional preprocessing before peak picking and scoring.">Preprocess</div>
      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Enable preprocessing steps prior to peak picking.">
        <input
          type="checkbox"
          checked={params.preprocess.enabled}
          onChange={(e)=>onChange({ ...params, preprocess: { ...params.preprocess, enabled: e.target.checked } })}
        />
        Enable preprocess
      </label>

      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Savitzky-Golay smoothing applied before baseline subtraction (matches SpecieScan / MALDIquant).">
        <input
          type="checkbox"
          checked={params.preprocess.smoothSG?.enabled ?? false}
          onChange={(e)=>onChange({ ...params, preprocess: { ...params.preprocess, smoothSG: { ...(params.preprocess.smoothSG ?? { halfWindowSize: 2 }), enabled: e.target.checked } } })}
          disabled={!params.preprocess.enabled}
        />
        SG smooth (before baseline)
      </label>

      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="TIC normalisation: divide all intensities by their sum. Matches SpecieScan's calibrateIntensity(method='TIC').">
        <input
          type="checkbox"
          checked={params.preprocess.normalizeTIC}
          onChange={(e)=>onChange({ ...params, preprocess: { ...params.preprocess, normalizeTIC: e.target.checked, normalizeToMax: e.target.checked ? false : params.preprocess.normalizeToMax } })}
          disabled={!params.preprocess.enabled}
        />
        TIC normalise (SpecieScan-style)
      </label>

      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Scale intensities so the maximum is 1.0 (legacy, ignored when TIC normalisation is on).">
        <input
          type="checkbox"
          checked={params.preprocess.normalizeToMax && !params.preprocess.normalizeTIC}
          onChange={(e)=>onChange({ ...params, preprocess: { ...params.preprocess, normalizeToMax: e.target.checked } })}
          disabled={!params.preprocess.enabled || params.preprocess.normalizeTIC}
        />
        Normalize to max (legacy)
      </label>

      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Subtract baseline using SNIP algorithm before peak picking.">
        <input
          type="checkbox"
          checked={params.preprocess.baselineSubtract.enabled}
          onChange={(e)=>onChange({ ...params, preprocess: { ...params.preprocess, baselineSubtract: { ...params.preprocess.baselineSubtract, enabled: e.target.checked } } })}
          disabled={!params.preprocess.enabled}
        />
        Baseline subtract (SNIP)
      </label>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 8, marginTop: 6 }}>
        <div>
          <div className="small" title="SG half-window size (points on each side). At 0.1 Da/pt, 2 pts = 0.2 Da, matching MALDIquant's physical 0.15 Da window.">SG half-window</div>
          <input
            className="input"
            type="number"
            step="1"
            min="2"
            max="50"
            value={params.preprocess.smoothSG?.halfWindowSize ?? 2}
            onChange={(e)=>onChange({ ...params, preprocess: { ...params.preprocess, smoothSG: { ...(params.preprocess.smoothSG ?? { enabled: true }), halfWindowSize: Number(e.target.value) } } })}
            disabled={!params.preprocess.enabled || !(params.preprocess.smoothSG?.enabled)}
            title="SG half-window size."
          />
        </div>
        <div>
          <div className="small" title="SNIP baseline iterations. At 0.1 Da/pt, 15 pts = ±1.5 Da effective window, matching MALDIquant's physical window.">SNIP iterations</div>
          <input
            className="input"
            type="number"
            step="1"
            min="1"
            value={params.preprocess.baselineSubtract.iterations}
            onChange={(e)=>onChange({ ...params, preprocess: { ...params.preprocess, baselineSubtract: { ...params.preprocess.baselineSubtract, iterations: Number(e.target.value) } } })}
            disabled={!params.preprocess.enabled || !params.preprocess.baselineSubtract.enabled}
            title="Number of SNIP iterations."
          />
        </div>
      </div>

      <div className="small" style={{ marginTop: 10 }} title="Folder-processing options for technical replicates.">Folder processing</div>
      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Group files like Sample_1.mzML and Sample_2.mzML into one averaged sample during folder runs.">
        <input
          type="checkbox"
          checked={params.folderProcessing.groupReplicates}
          onChange={(e)=>onChange({ ...params, folderProcessing: { ...params.folderProcessing, groupReplicates: e.target.checked } })}
        />
        Group technical replicates
      </label>
      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Auto-detect suffixes like _1/_2/_3 or _a/_b/_c and group those files before analysis.">
        <input
          type="checkbox"
          checked={params.folderProcessing.smartGroupReplicates}
          onChange={(e)=>onChange({ ...params, folderProcessing: { ...params.folderProcessing, smartGroupReplicates: e.target.checked } })}
          disabled={!params.folderProcessing.groupReplicates}
        />
        Smart suffix grouping
      </label>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap: 8, marginTop: 6 }}>
        <div>
          <div className="small" title="Filename separator used to extract the sample ID prefix.">Sample ID separator</div>
          <input
            className="input"
            type="text"
            value={params.folderProcessing.sampleIdSeparator}
            onChange={(e)=>onChange({ ...params, folderProcessing: { ...params.folderProcessing, sampleIdSeparator: e.target.value || "_" } })}
            disabled={!params.folderProcessing.groupReplicates || params.folderProcessing.smartGroupReplicates}
            title="Filename separator used to extract the sample ID prefix."
          />
        </div>
        <div>
          <div className="small" title="Minimum accepted peak count for a replicate before averaging in benchmark mode.">Min replicate peaks</div>
          <input
            className="input"
            type="number"
            step="1"
            value={params.folderProcessing.minReplicatePeaks}
            onChange={(e)=>onChange({ ...params, folderProcessing: { ...params.folderProcessing, minReplicatePeaks: Number(e.target.value) } })}
            disabled={!params.folderProcessing.groupReplicates}
            title="Minimum accepted peak count for a replicate."
          />
        </div>
        <div>
          <div className="small" title="Maximum accepted peak count for a replicate before averaging in benchmark mode.">Max replicate peaks</div>
          <input
            className="input"
            type="number"
            step="1"
            value={params.folderProcessing.maxReplicatePeaks}
            onChange={(e)=>onChange({ ...params, folderProcessing: { ...params.folderProcessing, maxReplicatePeaks: Number(e.target.value) } })}
            disabled={!params.folderProcessing.groupReplicates}
            title="Maximum accepted peak count for a replicate."
          />
        </div>
      </div>

      <div className="small" style={{ marginTop: 10 }} title="Detect peaks before scoring.">Peak picking</div>
      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Enable peak detection on the processed spectrum.">
        <input
          type="checkbox"
          checked={params.peakPicking.enabled}
          onChange={(e)=>onChange({ ...params, peakPicking: { ...params.peakPicking, enabled: e.target.checked } })}
        />
        Enable peak picking
      </label>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap: 8, marginTop: 6 }}>
        <div>
          <div className="small" title="Peaks must be at least this fraction of the max intensity.">Min rel. intensity</div>
          <input
            className="input"
            type="number"
            step="0.001"
            value={params.peakPicking.minRelativeIntensity}
            onChange={(e)=>onChange({ ...params, peakPicking: { ...params.peakPicking, minRelativeIntensity: Number(e.target.value) } })}
            disabled={!params.peakPicking.enabled}
            title="Peaks must be at least this fraction of the max intensity."
          />
        </div>
        <div>
          <div className="small" title="Minimum separation between detected peaks in Daltons.">Min peak distance (Da)</div>
          <input
            className="input"
            type="number"
            step="0.1"
            value={params.peakPicking.minPeakDistanceDa}
            onChange={(e)=>onChange({ ...params, peakPicking: { ...params.peakPicking, minPeakDistanceDa: Number(e.target.value) } })}
            disabled={!params.peakPicking.enabled}
            title="Minimum separation between detected peaks in Daltons."
          />
        </div>
        <div>
          <div className="small" title="Half-window in points used for MALDIquant-style local-max peak calling.">Local-max half-window</div>
          <input
            className="input"
            type="number"
            step="1"
            value={params.peakPicking.localMaxHalfWindowSize}
            onChange={(e)=>onChange({ ...params, peakPicking: { ...params.peakPicking, localMaxHalfWindowSize: Number(e.target.value) } })}
            disabled={!params.peakPicking.enabled}
            title="Half-window in points used for MALDIquant-style local-max peak calling."
          />
        </div>
      </div>

      <div className="small" style={{ marginTop: 10 }} title="Optional deisotoping to keep monoisotopic peaks.">Monoisotopic filtering</div>
      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Remove isotopic peaks based on spacing and tolerance.">
        <input
          type="checkbox"
          checked={params.monoisotopic.enabled}
          onChange={(e)=>onChange({ ...params, monoisotopic: { ...params.monoisotopic, enabled: e.target.checked } })}
        />
        Keep monoisotopic peaks (simple deisotope)
      </label>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 8, marginTop: 6 }}>
        <div>
          <div className="small" title="Allowed m/z deviation when identifying isotopic peaks.">Tolerance (Da)</div>
          <input
            className="input"
            type="number"
            step="0.01"
            value={params.monoisotopic.toleranceDa}
            onChange={(e)=>onChange({ ...params, monoisotopic: { ...params.monoisotopic, toleranceDa: Number(e.target.value) } })}
            disabled={!params.monoisotopic.enabled}
            title="Allowed m/z deviation when identifying isotopic peaks."
          />
        </div>
        <div>
          <div className="small" title="Expected spacing between isotopic peaks.">Isotope spacing (Da)</div>
          <input
            className="input"
            type="number"
            step="0.00001"
            value={params.monoisotopic.distanceDa}
            onChange={(e)=>onChange({ ...params, monoisotopic: { ...params.monoisotopic, distanceDa: Number(e.target.value) } })}
            disabled={!params.monoisotopic.enabled}
            title="Expected spacing between isotopic peaks."
          />
        </div>
        <div>
          <div className="small" title="Maximum number of isotopic peaks to remove per monoisotopic peak.">Max isotopes</div>
          <input
            className="input"
            type="number"
            step="1"
            value={params.monoisotopic.maxIsotopes}
            onChange={(e)=>onChange({ ...params, monoisotopic: { ...params.monoisotopic, maxIsotopes: Number(e.target.value) } })}
            disabled={!params.monoisotopic.enabled}
            title="Maximum number of isotopic peaks to remove per monoisotopic peak."
          />
        </div>
      </div>

      <div className="small" style={{ marginTop: 10 }} title="Binning grid used for correlation scoring.">Scoring grid</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap: 8 }}>
        <div>
          <div className="small" title="Start m/z for the scoring grid.">Start</div>
          <input
            className="input"
            type="number"
            value={params.grid.startMz}
            onChange={(e)=>onChange({ ...params, grid: { ...params.grid, startMz: Number(e.target.value) } })}
            title="Start m/z for the scoring grid."
          />
        </div>
        <div>
          <div className="small" title="End m/z for the scoring grid.">End</div>
          <input
            className="input"
            type="number"
            value={params.grid.endMz}
            onChange={(e)=>onChange({ ...params, grid: { ...params.grid, endMz: Number(e.target.value) } })}
            title="End m/z for the scoring grid."
          />
        </div>
        <div>
          <div className="small" title="Grid spacing in m/z for binning.">Step</div>
          <input
            className="input"
            type="number"
            step="0.1"
            value={params.grid.stepMz}
            onChange={(e)=>onChange({ ...params, grid: { ...params.grid, stepMz: Number(e.target.value) } })}
            title="Grid spacing in m/z for binning."
          />
        </div>
      </div>

      <div className="small" style={{ marginTop: 10 }} title="Settings for contaminant peak matching.">Contaminants</div>
      <div style={{ display:"flex", gap: 8, alignItems:"center" }}>
        <div className="small" title="Max m/z deviation when matching contaminants.">Tolerance (Da)</div>
        <input
          className="input"
          type="number"
          step="0.05"
          value={params.contaminantsToleranceDa}
          onChange={(e)=>onChange({ ...params, contaminantsToleranceDa: Number(e.target.value) })}
          title="Max m/z deviation when matching contaminants."
        />
      </div>

      <div className="small" style={{ marginTop: 10 }} title="Configure target-decoy confidence scoring.">Decoy confidence</div>
      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }} title="Compute per-sample decoy permutation confidence.">
        <input
          type="checkbox"
          checked={params.fdr.enabled}
          onChange={(e)=>onChange({ ...params, fdr: { ...params.fdr, enabled: e.target.checked } })}
        />
        Enable decoy scoring
      </label>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 8, marginTop: 6 }}>
        <div>
          <div className="small" title="Number of decoy taxa to generate.">Decoys (n)</div>
          <input
            className="input"
            type="number"
            step="1"
            min="0"
            value={params.fdr.nDecoys}
            onChange={(e)=>onChange({ ...params, fdr: { ...params.fdr, nDecoys: Number(e.target.value) } })}
            disabled={!params.fdr.enabled}
            title="Number of decoy taxa to generate."
          />
        </div>
        <div>
          <div className="small" title="Maximum allowed decoys for performance.">Max decoys</div>
          <input
            className="input"
            type="number"
            step="1"
            min="0"
            value={params.fdr.maxDecoys}
            onChange={(e)=>onChange({ ...params, fdr: { ...params.fdr, maxDecoys: Number(e.target.value) } })}
            disabled={!params.fdr.enabled}
            title="Maximum allowed decoys for performance."
          />
        </div>
        <div>
          <div className="small" title="Seed for deterministic decoy generation.">Seed</div>
          <input
            className="input"
            type="number"
            step="1"
            value={params.fdr.seed}
            onChange={(e)=>onChange({ ...params, fdr: { ...params.fdr, seed: Number(e.target.value) } })}
            disabled={!params.fdr.enabled}
            title="Seed for deterministic decoy generation."
          />
        </div>
        <div>
          <div className="small" title="Tolerance for excluding decoys near real markers.">Tolerance (Da)</div>
          <input
            className="input"
            type="number"
            step="0.05"
            value={params.fdr.toleranceDa}
            onChange={(e)=>onChange({ ...params, fdr: { ...params.fdr, toleranceDa: Number(e.target.value) } })}
            disabled={!params.fdr.enabled}
            title="Tolerance for excluding decoys near real markers."
          />
        </div>
      </div>

      {db && (
        <div className="small" style={{ marginTop: 10 }}>
          Loaded: <b>{db.meta.label}</b> — {db.taxa.length} taxa, {db.markerNames.length} markers
        </div>
      )}
      <div style={{ display:"flex", gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={onExportSettings}>Export settings (JSON)</button>
        <label className="btn" style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
          Import settings (JSON)
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e)=>{
              const file = e.target.files?.[0];
              if (file) onImportSettings(file);
              e.target.value = "";
            }}
            style={{ display:"none" }}
          />
        </label>
      </div>
    </details>
  );
}
