import React from "react";
import type { AnalysisResult } from "../engine/types";
// import { computeConfidence } from "../engine/confidence";

type Props = {
  result: AnalysisResult | null;
  selectedTaxonId: string | null;
  onSelectTaxon: (id: string) => void;
};

// Render ranked taxa results and selector for marker inspection.
export default function ResultsTable({ result, selectedTaxonId, onSelectTaxon }: Props) {
  if (!result) {
    return (
      <div className="card">
        <div style={{ fontWeight: 700 }}>Results</div>
        <div className="small">Run analysis to see ranked taxa.</div>
      </div>
    );
  }

  const top = result.rankedTaxa[0];
  const displayLabel = top?.taxonLabel ?? "-";

  // PAMPA p-value display
  const pampaP = result.pampaTopP;
  const pampaPDisplay = pampaP === null
    ? "-"
    : pampaP < 1e-4
      ? pampaP.toExponential(2)
      : pampaP.toFixed(4);
  const pampaPColor = pampaP === null
    ? "#9ca3af"
    : pampaP < 0.001 ? "#16a34a"
    : pampaP < 0.05  ? "#d97706"
    : "#ef4444";
  const pampaStar = pampaP === null ? "" : pampaP < 0.001 ? " ***" : pampaP < 0.01 ? " **" : pampaP < 0.05 ? " *" : "";

  const qSample = result.fdr.qSample;
  const qDisplay = Number.isFinite(qSample) ? qSample.toFixed(3) : "-";
  const qColor = Number.isFinite(qSample) && qSample < 0.05 ? "#16a34a" : "#6b7280";
  const qcTitle = result.qc.suspect
    ? `Suspect spectral quality: ${result.qc.notes.join("; ")}`
    : "Spectral quality looks acceptable.";

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>Results</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge warn">{top ? `Top corr: ${top.correlation.toFixed(3)}` : "-"}</span>
          <span className={result.qc.suspect ? "badge warn" : "badge"} title={qcTitle}>
            {result.qc.suspect ? "QC suspect" : "QC ok"}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div className="small">Exact-mode label</div>
        <div style={{ fontWeight: 700, fontStyle: "italic" }}>{displayLabel}</div>
      </div>

      <div className="kv" style={{ marginTop: 10 }}>
        <div className="small">Peaks used</div><div>{result.qc.peakCount}</div>
        <div className="small">m/z range</div>
        <div>{result.qc.mzMin.toFixed(1)} to {result.qc.mzMax.toFixed(1)}</div>
        <div className="small">PAMPA p-value</div>
        <div style={{ fontWeight: 600, color: pampaPColor, fontFamily: "monospace" }}>
          {pampaPDisplay}{pampaStar}
        </div>
        {result.fdr.nDecoys > 0 && (
          <>
            <div className="small" title="Per-spectrum decoy permutation p-value. This is not a batch-level FDR estimate.">
              Permutation p-value
            </div>
            <div style={{ fontFamily: "monospace", color: qColor }} title="Per-spectrum decoy permutation p-value.">
              {qDisplay}
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="small" style={{ marginBottom: 6 }}>Inspect taxon markers:</div>
        <select value={selectedTaxonId ?? ""} onChange={(e) => onSelectTaxon(e.target.value)} style={{ marginBottom: 8 }}>
          {result.rankedTaxa.slice(0, 15).map((t) => (
            <option key={t.taxonId} value={t.taxonId}>
              {t.taxonLabel} (corr {t.correlation.toFixed(3)})
            </option>
          ))}
        </select>

        <table className="table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Taxon</th>
              <th>Correlation</th>
            </tr>
          </thead>
          <tbody>
            {result.rankedTaxa.slice(0, 10).map((t, i) => (
              <tr key={t.taxonId}>
                <td>{i + 1}</td>
                <td>{t.taxonLabel}</td>
                <td>{t.correlation.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
