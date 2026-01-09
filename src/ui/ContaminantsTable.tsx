import React from "react";
import type { AnalysisResult } from "../engine/types";

type Props = { result: AnalysisResult | null };

// Render contaminant matches for the current analysis result.
export default function ContaminantsTable({ result }: Props) {
  if (!result) {
    return (
      <div className="card">
        <div style={{ fontWeight:700 }}>Contaminants</div>
        <div className="small">Run analysis to see contaminant hits.</div>
      </div>
    );
  }

  const hits = result.contaminants ?? [];
  return (
    <div className="card">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
        <div style={{ fontWeight:700 }}>Contaminants</div>
        <div className="small">{hits.length ? `${hits.length} hit(s)` : "None detected"}</div>
      </div>
      <table className="table" style={{ marginTop: 8 }}>
        <thead>
          <tr><th>Name</th><th>Expected</th><th>Matched</th><th>ΔDa</th><th>Intensity</th></tr>
        </thead>
        <tbody>
          {hits.map((h, i) => (
            <tr key={i}>
              <td>{h.name}</td>
              <td>{h.expectedMz.toFixed(3)}</td>
              <td>{h.matchedPeakMz.toFixed(3)}</td>
              <td>{h.deltaDa.toFixed(3)}</td>
              <td>{h.intensity.toFixed(3)}</td>
            </tr>
          ))}
          {!hits.length && <tr><td colSpan={5} className="small">No contaminant matches within tolerance.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
