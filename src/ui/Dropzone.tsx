import React, { useCallback } from "react";

type Props = {
  onFiles: (files: File[]) => void;
  onFolderFiles: (files: File[]) => void;
};

// File drop/picker control for mzML/mzXML uploads.
export default function Dropzone({ onFiles, onFolderFiles }: Props) {
  // Handle drag-and-drop file selection.
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files);
  }, [onFiles]);

  // Handle file input selection.
  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onFiles(files);
    e.target.value = "";
  }, [onFiles]);

  // Handle folder input selection.
  const onPickFolder = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onFolderFiles(files);
    e.target.value = "";
  }, [onFolderFiles]);

  return (
    <div className="card" onDragOver={(e)=>e.preventDefault()} onDrop={onDrop} style={{ borderStyle:"dashed", borderWidth:2 }}>
      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center" }}>
        <div>
          <div style={{ fontWeight:700 }}>Upload mzML / mzXML</div>
          <div className="small">Drag & drop files here, or choose files. Batch supported.</div>
        </div>
        <div style={{ display:"flex", gap: 8 }}>
          <label className="btn primary" style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
            Choose files
            <input type="file" accept=".mzML,.mzXML,.mzml,.mzxml" multiple onChange={onPick} style={{ display:"none" }} />
          </label>
          <label className="btn" style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
            Process folder…
            <input
              type="file"
              multiple
              // @ts-ignore - non-standard directory selection in Chromium-based browsers
              webkitdirectory="true"
              // @ts-ignore - non-standard directory selection
              directory="true"
              onChange={onPickFolder}
              style={{ display:"none" }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
