import React from "react";
import type { AnalysisParams, DbManifest, SpeciescanDb } from "../engine/types";

type Props = {
  manifest: DbManifest | null;
  selectedDbFile: string | null;
  onSelectDbFile: (file: string) => void;
  db: SpeciescanDb | null;
  params: AnalysisParams;
  onChange: (p: AnalysisParams) => void;
  onReloadDb: () => void;

  displayMode: "raw" | "processed";
  onChangeDisplayMode: (m: "raw" | "processed") => void;
  displayNormalizeToMax: boolean;
  onChangeDisplayNormalizeToMax: (v: boolean) => void;
};

// Render analysis and display settings controls.
export default function SettingsPanel(props: Props) {
  const {
    manifest, selectedDbFile, onSelectDbFile, db,
    params, onChange, onReloadDb,
    displayMode, onChangeDisplayMode,
    displayNormalizeToMax, onChangeDisplayNormalizeToMax
  } = props;

  return (
    <div className="card">
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontWeight: 800 }}>Settings</div>
        <button className="btn" onClick={onReloadDb}>Reload DB</button>
      </div>

      <div className="small" style={{ marginTop: 6 }}>Reference DB</div>
      <select
        className="input"
        value={selectedDbFile ?? ""}
        onChange={(e)=>onSelectDbFile(e.target.value)}
        disabled={!manifest}
      >
        {(manifest?.databases ?? []).map(d => (
          <option key={d.file} value={d.file}>{d.label}</option>
        ))}
      </select>

      <div className="small" style={{ marginTop: 10 }}>Plot display</div>
      <div style={{ display:"flex", gap: 8 }}>
        <select className="input" value={displayMode} onChange={(e)=>onChangeDisplayMode(e.target.value as any)}>
          <option value="raw">Raw</option>
          <option value="processed">Processed</option>
        </select>
        <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }}>
          <input type="checkbox" checked={displayNormalizeToMax} onChange={(e)=>onChangeDisplayNormalizeToMax(e.target.checked)} />
          Normalize display to max
        </label>
      </div>

      <div className="small" style={{ marginTop: 10 }}>m/z window</div>
      <div style={{ display:"flex", gap: 8 }}>
        <input
          className="input"
          type="number"
          value={params.mzMin}
          onChange={(e)=>onChange({ ...params, mzMin: Number(e.target.value) })}
        />
        <input
          className="input"
          type="number"
          value={params.mzMax}
          onChange={(e)=>onChange({ ...params, mzMax: Number(e.target.value) })}
        />
      </div>

      <div className="small" style={{ marginTop: 10 }}>Preprocess</div>
      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }}>
        <input
          type="checkbox"
          checked={params.preprocess.enabled}
          onChange={(e)=>onChange({ ...params, preprocess: { ...params.preprocess, enabled: e.target.checked } })}
        />
        Enable preprocess
      </label>

      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }}>
        <input
          type="checkbox"
          checked={params.preprocess.normalizeToMax}
          onChange={(e)=>onChange({ ...params, preprocess: { ...params.preprocess, normalizeToMax: e.target.checked } })}
          disabled={!params.preprocess.enabled}
        />
        Normalize (processed) to max
      </label>

      <div className="small" style={{ marginTop: 10 }}>Peak picking</div>
      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }}>
        <input
          type="checkbox"
          checked={params.peakPicking.enabled}
          onChange={(e)=>onChange({ ...params, peakPicking: { ...params.peakPicking, enabled: e.target.checked } })}
        />
        Enable peak picking
      </label>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 8, marginTop: 6 }}>
        <div>
          <div className="small">Min rel. intensity</div>
          <input
            className="input"
            type="number"
            step="0.001"
            value={params.peakPicking.minRelativeIntensity}
            onChange={(e)=>onChange({ ...params, peakPicking: { ...params.peakPicking, minRelativeIntensity: Number(e.target.value) } })}
            disabled={!params.peakPicking.enabled}
          />
        </div>
        <div>
          <div className="small">Min peak distance (Da)</div>
          <input
            className="input"
            type="number"
            step="0.1"
            value={params.peakPicking.minPeakDistanceDa}
            onChange={(e)=>onChange({ ...params, peakPicking: { ...params.peakPicking, minPeakDistanceDa: Number(e.target.value) } })}
            disabled={!params.peakPicking.enabled}
          />
        </div>
      </div>

      <div className="small" style={{ marginTop: 10 }}>Monoisotopic filtering</div>
      <label className="small" style={{ display:"flex", gap: 6, alignItems:"center" }}>
        <input
          type="checkbox"
          checked={params.monoisotopic.enabled}
          onChange={(e)=>onChange({ ...params, monoisotopic: { ...params.monoisotopic, enabled: e.target.checked } })}
        />
        Keep monoisotopic peaks (simple deisotope)
      </label>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 8, marginTop: 6 }}>
        <div>
          <div className="small">Tolerance (Da)</div>
          <input
            className="input"
            type="number"
            step="0.01"
            value={params.monoisotopic.toleranceDa}
            onChange={(e)=>onChange({ ...params, monoisotopic: { ...params.monoisotopic, toleranceDa: Number(e.target.value) } })}
            disabled={!params.monoisotopic.enabled}
          />
        </div>
        <div>
          <div className="small">Isotope spacing (Da)</div>
          <input
            className="input"
            type="number"
            step="0.00001"
            value={params.monoisotopic.distanceDa}
            onChange={(e)=>onChange({ ...params, monoisotopic: { ...params.monoisotopic, distanceDa: Number(e.target.value) } })}
            disabled={!params.monoisotopic.enabled}
          />
        </div>
        <div>
          <div className="small">Max isotopes</div>
          <input
            className="input"
            type="number"
            step="1"
            value={params.monoisotopic.maxIsotopes}
            onChange={(e)=>onChange({ ...params, monoisotopic: { ...params.monoisotopic, maxIsotopes: Number(e.target.value) } })}
            disabled={!params.monoisotopic.enabled}
          />
        </div>
      </div>

      <div className="small" style={{ marginTop: 10 }}>Scoring grid</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap: 8 }}>
        <div>
          <div className="small">Start</div>
          <input
            className="input"
            type="number"
            value={params.grid.startMz}
            onChange={(e)=>onChange({ ...params, grid: { ...params.grid, startMz: Number(e.target.value) } })}
          />
        </div>
        <div>
          <div className="small">End</div>
          <input
            className="input"
            type="number"
            value={params.grid.endMz}
            onChange={(e)=>onChange({ ...params, grid: { ...params.grid, endMz: Number(e.target.value) } })}
          />
        </div>
        <div>
          <div className="small">Step</div>
          <input
            className="input"
            type="number"
            step="0.1"
            value={params.grid.stepMz}
            onChange={(e)=>onChange({ ...params, grid: { ...params.grid, stepMz: Number(e.target.value) } })}
          />
        </div>
      </div>

      <div className="small" style={{ marginTop: 10 }}>Contaminants</div>
      <div style={{ display:"flex", gap: 8, alignItems:"center" }}>
        <div className="small">Tolerance (Da)</div>
        <input
          className="input"
          type="number"
          step="0.05"
          value={params.contaminantsToleranceDa}
          onChange={(e)=>onChange({ ...params, contaminantsToleranceDa: Number(e.target.value) })}
        />
      </div>

      {db && (
        <div className="small" style={{ marginTop: 10 }}>
          Loaded: <b>{db.meta.label}</b> — {db.taxa.length} taxa, {db.markerNames.length} markers
        </div>
      )}
    </div>
  );
}
