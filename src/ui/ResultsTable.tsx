import React from "react";
import type { AnalysisResult } from "../engine/types";
import { computeConfidence } from "../engine/confidence";

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
  const second = result.rankedTaxa[1];
  const qSample = Number.isFinite(result.fdr?.qSample ?? NaN) ? result.fdr?.qSample ?? null : null;
  const hasFdr = (result.fdr?.nDecoys ?? 0) > 0 && qSample != null;
  const topTaxonId = top?.taxonId ?? null;
  const markerRows = topTaxonId ? (result.taxonMatchesTop[topTaxonId] ?? []) : [];
  const matchedMarkers = markerRows.filter(m => m.matched && m.matchedPeakMz != null).length;
  const confidence = computeConfidence({
    bestScore: top?.correlation ?? null,
    bestLabel: top?.taxonLabel ?? null,
    secondScore: second?.correlation ?? null,
    secondLabel: second?.taxonLabel ?? null,
    bestDecoyScore: result.fdr?.bestDecoyScore ?? null,
    qSample: result.fdr?.qSample ?? null,
    matchedMarkers,
  });
  const confidenceLabel = confidence.confidenceLevel;
  const confidenceClass = confidenceLabel === "High"
    ? "badge good"
    : (confidenceLabel === "Medium" ? "badge warn" : (confidenceLabel === "Low" ? "badge bad" : (confidenceLabel === "Rejected" ? "badge bad" : "badge")));

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>Results</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={confidenceClass}>{confidenceLabel}</span>
          <span className="badge warn">{top ? `Top corr: ${top.correlation.toFixed(3)}` : "-"}</span>
        </div>
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
              <th title="Confidence reflects separation from decoy matches and competing taxa, not just statistical significance.">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {result.rankedTaxa.slice(0, 10).map((t, i) => (
              <tr key={t.taxonId}>
                <td>{i + 1}</td>
                <td>{t.taxonLabel}</td>
                <td>{t.correlation.toFixed(3)}</td>
                <td><span className={confidenceClass}>{confidenceLabel}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasFdr && (
        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ marginBottom: 6 }}>FDR details</div>
          <div className="kv">
            <div className="small">Decoys</div><div>{result.fdr.nDecoys}</div>
            <div className="small">Best decoy score</div><div>{result.fdr.bestDecoyScore.toFixed(3)}</div>
            <div className="small">Decoy gap</div><div>{result.fdr.decoyGap.toFixed(3)}</div>
            <div className="small">q-sample</div><div>{qSample?.toFixed(3)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
