import React, { useMemo } from "react";
import type { AnalysisResult, MarkerMatchRow } from "../engine/types";

type Props = { result: AnalysisResult | null; taxonId: string | null };

// Render marker match details for a selected taxon.
export default function MarkerMatchTable({ result, taxonId }: Props) {
  // Derive match rows for the selected taxon.
  const rows: MarkerMatchRow[] = useMemo(() => {
    if (!result || !taxonId) return [];
    return result.taxonMatchesTop[taxonId] ?? [];
  }, [result, taxonId]);

  if (!result) {
    return (
      <div className="card">
        <div style={{ fontWeight:700 }}>Marker matches</div>
        <div className="small">Run analysis to see marker-level matches.</div>
      </div>
    );
  }

  if (!taxonId) {
    return (
      <div className="card">
        <div style={{ fontWeight:700 }}>Marker matches</div>
        <div className="small">Select a taxon to inspect.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ fontWeight:700 }}>Marker matches (selected taxon)</div>
      <table className="table" style={{ marginTop: 8 }}>
        <thead>
          <tr><th>Marker</th><th>Expected</th><th>Matched peak</th><th>Intensity</th><th>Match?</th></tr>
        </thead>
        <tbody>
          {rows.map((m, idx) => (
            <tr key={idx}>
              <td>{m.markerName}</td>
              <td>{m.expectedMz.toFixed(3)}</td>
              <td>{m.matchedPeakMz === null ? "-" : m.matchedPeakMz.toFixed(3)}</td>
              <td>{m.matchedPeakIntensity === null ? "-" : m.matchedPeakIntensity.toFixed(3)}</td>
              <td><span className={"badge " + (m.matched ? "good" : "bad")}>{m.matched ? "Yes" : "No"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small" style={{ marginTop: 8 }}>
        Matching windows follow SpecieScan defaults (most markers ±0.3 Da; deamid markers asymmetric).
      </div>
    </div>
  );
}
