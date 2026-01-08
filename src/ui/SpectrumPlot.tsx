import React, { useMemo } from "react";
import Plot from "react-plotly.js";
import type { AnalysisResult, Spectrum } from "../engine/types";

type Props = {
  spectrum: Spectrum | null;
  result: AnalysisResult | null;
  taxonIdForMarkers: string | null;
  displayMode: "raw" | "processed";
  displayNormalizeToMax: boolean;
};

function toArrays(mz: Float64Array, intensity: Float64Array, normalizeToMax: boolean) {
  const x = Array.from(mz);
  let y = Array.from(intensity);
  if (normalizeToMax) {
    let maxI = 0;
    for (const v of y) maxI = Math.max(maxI, v);
    if (maxI > 0) y = y.map(v => v / maxI);
  }
  return { x, y };
}

export default function SpectrumPlot({ spectrum, result, taxonIdForMarkers, displayMode, displayNormalizeToMax }: Props) {
  const line = useMemo(() => {
    if (!spectrum) return null;

    // Prefer the analysis-cropped arrays so plot window matches mzMin..mzMax
    if (result) {
      if (displayMode === "processed") return toArrays(result.processedMz, result.processedIntensity, displayNormalizeToMax);
      return toArrays(result.rawMz, result.rawIntensity, displayNormalizeToMax);
    }

    // Fallback (no analysis run yet)
    return toArrays(spectrum.mz, spectrum.intensity, displayNormalizeToMax);
  }, [spectrum, result, displayMode, displayNormalizeToMax]);

  const overlays = useMemo(() => {
    if (!result || !taxonIdForMarkers) return null;

    const markerRows = result.taxonMatchesTop[taxonIdForMarkers] ?? [];
    const matched = markerRows
      .filter(r => r.matched && r.matchedPeakMz != null && r.matchedPeakIntensity != null)
      .map(r => ({ mz: r.matchedPeakMz as number, intensity: r.matchedPeakIntensity as number }));

    // Set of matched peak m/z (rounded) for colouring picked peaks
    const matchedSet = new Set<number>(matched.map(m => Number(m.mz.toFixed(4))));

    return { markerRows, matched, matchedSet };
  }, [result, taxonIdForMarkers]);

  if (!spectrum || !line) {
    return (
      <div className="card">
        <div style={{ fontWeight: 800 }}>Spectrum</div>
        <div className="small" style={{ marginTop: 6 }}>Load an mzML/mzXML file to view spectrum.</div>
      </div>
    );
  }

  // Traces
  const data: any[] = [];

  data.push({
    x: line.x,
    y: line.y,
    type: "scattergl",
    mode: "lines",
    name: displayMode === "processed" ? "Processed spectrum" : "Spectrum",
    hovertemplate: "m/z=%{x:.4f}<br>I=%{y:.3g}<extra></extra>",
  });

  if (result) {
    const peakX = result.peaks.map(p => p.mz);
    const peakY = result.peaks.map(p => p.intensity);

    const colors = overlays
      ? peakX.map((mz: number) => overlays.matchedSet.has(Number(mz.toFixed(4))) ? "rgba(34,197,94,0.95)" : "rgba(107,114,128,0.55)")
      : peakX.map(() => "rgba(107,114,128,0.55)");

    data.push({
      x: peakX,
      y: peakY,
      type: "scattergl",
      mode: "markers",
      name: "Picked peaks",
      marker: { size: 6, color: colors },
      hovertemplate: "peak m/z=%{x:.4f}<br>I=%{y:.3g}<extra></extra>",
    });

    // Marker match overlay bars (fixed: width + overlay)
    if (overlays && overlays.matched.length) {
      data.push({
        x: overlays.matched.map(m => m.mz),
        y: overlays.matched.map(m => m.intensity),
        type: "bar",
        name: "Marker matches",
        opacity: 0.30,
        width: overlays.matched.map(() => 0.6), // important for continuous x axis
        hovertemplate: "matched m/z=%{x:.4f}<br>I=%{y:.3g}<extra></extra>",
      });
    }

    // Contaminants as red X markers
    if (result.contaminants?.length) {
      data.push({
        x: result.contaminants.map(c => c.matchedPeakMz),
        y: result.contaminants.map(c => c.intensity),
        type: "scattergl",
        mode: "markers",
        name: "Contaminants",
        marker: { size: 10, symbol: "x", color: "rgba(239,68,68,0.95)" },
        hovertemplate: "contam %{text}<br>m/z=%{x:.4f}<br>I=%{y:.3g}<extra></extra>",
        text: result.contaminants.map(c => c.name),
      });
    }
  }

  return (
    <div className="card" style={{ height: 420 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontWeight: 800 }}>Spectrum</div>
        <div className="small">{spectrum.filename}</div>
      </div>
      <div style={{ height: 380 }}>
        <Plot
          data={data}
          layout={{
            margin: { l: 40, r: 10, t: 10, b: 40 },
            xaxis: { title: "m/z" },
            yaxis: { title: displayNormalizeToMax ? "Intensity (norm.)" : "Intensity", rangemode: "tozero" },
            legend: { orientation: "h" },
            barmode: "overlay",
          }}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
          config={{ displayModeBar: true, responsive: true }}
        />
      </div>
      <div className="small" style={{ marginTop: 8 }}>
        Green peaks + translucent bars indicate marker matches for the selected taxon; red X marks contaminants.
      </div>
    </div>
  );
}
