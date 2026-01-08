import React from "react";
import type { AnalysisResult, Spectrum } from "../engine/types";

type Props = {
  spectra: Spectrum[];
  results: Record<string, AnalysisResult | undefined>;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export default function BatchQueueTable({ spectra, results, selectedId, onSelect }: Props) {
  return (
    <div className="card">
      <div style={{ fontWeight: 700 }}>Batch queue</div>
      <table className="table" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>File</th>
            <th>Top taxon</th>
            <th>Corr</th>
          </tr>
        </thead>
        <tbody>
          {spectra.map((s) => {
            const r = results[s.id];
            const top = r?.rankedTaxa?.[0];
            const corr = top?.correlation;
            const corrText = Number.isFinite(corr) ? corr.toFixed(3) : "-";
            const active = selectedId === s.id;
            return (
              <tr key={s.id} onClick={() => onSelect(s.id)} style={{ cursor: "pointer", background: active ? "#f3f4f6" : undefined }}>
                <td>{s.filename}</td>
                <td>{top ? top.taxonLabel : "-"}</td>
                <td>{corrText}</td>
              </tr>
            );
          })}
          {!spectra.length && (
            <tr><td colSpan={3} className="small">Drop spectra above to build a batch queue.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
