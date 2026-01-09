import React from "react";
import type { AnalysisResult } from "../engine/types";

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

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>Results</div>
        <span className="badge warn">{top ? `Top corr: ${top.correlation.toFixed(3)}` : "—"}</span>
      </div>

      <div className="kv" style={{ marginTop: 10 }}>
        <div className="small">Peaks used</div><div>{result.qc.peakCount}</div>
        <div className="small">m/z range</div><div>{result.qc.mzMin.toFixed(1)}–{result.qc.mzMax.toFixed(1)}</div>
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
