import React, { useMemo } from "react";
import type { AnalysisResult, MarkerMatchRow } from "../engine/types";

type Props = { result: AnalysisResult | null; taxonId: string | null };

function ppm(observed: number, expected: number): string {
  return (((observed - expected) / expected) * 1e6).toFixed(1);
}

export default function MarkerMatchTable({ result, taxonId }: Props) {
  const rows: MarkerMatchRow[] = useMemo(() => {
    if (!result || !taxonId) return [];
    return result.taxonMatchesTop[taxonId] ?? [];
  }, [result, taxonId]);

  const nMatched = rows.filter(r => r.matched).length;

  if (!result) {
    return (
      <div className="card">
        <div style={{ fontWeight: 700 }}>Marker diagnostics</div>
        <div className="small">Run analysis to see marker-level matches.</div>
      </div>
    );
  }

  if (!taxonId) {
    return (
      <div className="card">
        <div style={{ fontWeight: 700 }}>Marker diagnostics</div>
        <div className="small">Select a taxon to inspect.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>Marker diagnostics</div>
        <span className="badge" style={{ background: nMatched === rows.length ? "#22c55e" : nMatched > 0 ? "#f59e0b" : "#ef4444", color: "#fff" }}>
          {nMatched}/{rows.length} matched
        </span>
      </div>

      <table className="table" style={{ marginTop: 8, fontSize: "0.82rem" }}>
        <thead>
          <tr>
            <th>Marker</th>
            <th>Expected (Da)</th>
            <th>Observed (Da)</th>
            <th>Δ (Da)</th>
            <th>Δ (ppm)</th>
            <th>Intensity</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, idx) => {
            const deltaDa = m.matchedPeakMz !== null ? (m.matchedPeakMz - m.expectedMz).toFixed(3) : null;
            const deltaPpm = m.matchedPeakMz !== null ? ppm(m.matchedPeakMz, m.expectedMz) : null;
            return (
              <tr key={idx} style={{ opacity: m.matched ? 1 : 0.45 }}>
                <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{m.markerName}</td>
                <td>{m.expectedMz.toFixed(3)}</td>
                <td>{m.matchedPeakMz === null ? "—" : m.matchedPeakMz.toFixed(3)}</td>
                <td>{deltaDa ?? "—"}</td>
                <td>{deltaPpm ?? "—"}</td>
                <td>{m.matchedPeakIntensity === null ? "—" : m.matchedPeakIntensity.toExponential(2)}</td>
                <td>
                  <span style={{
                    display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                    background: m.matched ? "#22c55e" : "#ef4444"
                  }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="small" style={{ marginTop: 6 }}>
        Windows: ±0.3 Da standard; deamidated markers −1.3/+0.3 Da asymmetric.
      </div>
    </div>
  );
}
