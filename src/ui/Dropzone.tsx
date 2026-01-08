import React, { useCallback } from "react";

type Props = { onFiles: (files: File[]) => void };

export default function Dropzone({ onFiles }: Props) {
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files);
  }, [onFiles]);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onFiles(files);
    e.target.value = "";
  }, [onFiles]);

  return (
    <div className="card" onDragOver={(e)=>e.preventDefault()} onDrop={onDrop} style={{ borderStyle:"dashed", borderWidth:2 }}>
      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center" }}>
        <div>
          <div style={{ fontWeight:700 }}>Upload mzML / mzXML</div>
          <div className="small">Drag & drop files here, or choose files. Batch supported.</div>
        </div>
        <label className="btn primary" style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
          Choose files
          <input type="file" accept=".mzML,.mzXML,.mzml,.mzxml" multiple onChange={onPick} style={{ display:"none" }} />
        </label>
      </div>
    </div>
  );
}
