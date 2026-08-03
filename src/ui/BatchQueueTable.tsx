import React, { useEffect, useMemo, useState } from "react";
import type { AnalysisResult, Spectrum } from "../engine/types";

type Props = {
  spectra: Spectrum[];
  results: Record<string, AnalysisResult | undefined>;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const PAGE_SIZE = 200;

// Render the batch queue with top-correlation summary per file.
function BatchQueueTable({ spectra, results, selectedId, onSelect }: Props) {
  const [page, setPage] = useState(1);
  const total = spectra.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const idToIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < spectra.length; i++) m.set(spectra[i].id, i);
    return m;
  }, [spectra]);

  useEffect(() => {
    if (!selectedId) return;
    const idx = idToIndex.get(selectedId);
    if (idx == null) return;
    const selectedPage = Math.floor(idx / PAGE_SIZE) + 1;
    if (selectedPage !== page) setPage(selectedPage);
  }, [selectedId, idToIndex, page]);

  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);
  const visible = spectra.slice(start, end);
  const analyzedCount = useMemo(() => spectra.reduce((n, s) => (results[s.id] ? n + 1 : n), 0), [spectra, results]);

  return (
    <div className="card">
      <div style={{ fontWeight: 700 }}>Batch queue</div>
      {!!total && (
        <div className="small" style={{ marginTop: 6 }}>
          Showing {start + 1}-{end} of {total} files ({analyzedCount} analyzed)
        </div>
      )}
      {!!totalPages && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button className="btn" onClick={() => setPage(1)} disabled={page <= 1}>{`<<`}</button>
          <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
          <span className="small">Page {page} / {totalPages}</span>
          <button className="btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
          <button className="btn" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>{`>>`}</button>
        </div>
      )}
      <table className="table" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>File</th>
            <th>Top taxon</th>
            <th>Corr</th>
            <th>QC</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => {
            const r = results[s.id];
            const top = r?.rankedTaxa?.[0];
            const label = top?.taxonLabel ?? "-";
            const corrText = top ? top.correlation.toFixed(3) : "-";
            const active = selectedId === s.id;
            const qcLabel = r?.qc.suspect ? "Suspect" : "OK";
            const qcTitle = r?.qc.suspect
              ? r.qc.notes.join("; ")
              : "Spectral quality looks acceptable.";
            return (
              <tr key={s.id} onClick={() => onSelect(s.id)} style={{ cursor: "pointer", background: active ? "#f3f4f6" : undefined }}>
                <td>{s.filename}</td>
                <td>{label}</td>
                <td>{corrText}</td>
                <td title={qcTitle} style={{ color: r?.qc.suspect ? "#b45309" : "#15803d", fontWeight: 600 }}>
                  {qcLabel}
                </td>
              </tr>
            );
          })}
          {!spectra.length && (
            <tr><td colSpan={4} className="small">Drop spectra above to build a batch queue.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default React.memo(BatchQueueTable);
