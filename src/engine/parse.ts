import pako from "pako";
import { uid } from "../utils/id";
import type { Spectrum } from "./types";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeBinary(b64: string, dataType: "float32" | "float64", compressed: boolean): Float64Array {
  let bytes = base64ToBytes(b64.replace(/\s+/g, ""));
  if (compressed) bytes = pako.inflate(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dataType === "float64" ? (bytes.byteLength / 8) : (bytes.byteLength / 4);
  const out = new Float64Array(n);
  let off = 0;
  for (let i = 0; i < n; i++) {
    out[i] = dataType === "float64" ? dv.getFloat64(off, true) : dv.getFloat32(off, true);
    off += dataType === "float64" ? 8 : 4;
  }
  return out;
}

function getText(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}

function parseMzML(xmlText: string): { mz: Float64Array; intensity: Float64Array } {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserErr = doc.querySelector("parsererror");
  if (parserErr) throw new Error("Invalid XML (mzML): parsererror");

  const spectrum = doc.querySelector("spectrum");
  if (!spectrum) throw new Error("mzML: no <spectrum> found");

  const bdas = Array.from(spectrum.querySelectorAll("binaryDataArray"));

  let mzB64: string | null = null;
  let intB64: string | null = null;
  let mzType: "float32" | "float64" = "float64";
  let intType: "float32" | "float64" = "float64";
  let mzCompressed = false;
  let intCompressed = false;

  for (const bda of bdas) {
    const cvParams = Array.from(bda.querySelectorAll("cvParam"));
    const hasMz = cvParams.some(p => p.getAttribute("name") === "m/z array");
    const hasInt = cvParams.some(p => p.getAttribute("name") === "intensity array");
    if (!hasMz && !hasInt) continue;

    const is64 = cvParams.some(p => p.getAttribute("name") === "64-bit float");
    const is32 = cvParams.some(p => p.getAttribute("name") === "32-bit float");
    const isZlib = cvParams.some(p => p.getAttribute("name") === "zlib compression");

    const binEl = bda.querySelector("binary");
    const b64 = getText(binEl);
    if (!b64) continue;

    if (hasMz) {
      mzB64 = b64;
      mzType = is32 ? "float32" : "float64";
      mzCompressed = isZlib;
    }
    if (hasInt) {
      intB64 = b64;
      intType = is32 ? "float32" : "float64";
      intCompressed = isZlib;
    }
  }

  if (!mzB64 || !intB64) throw new Error("mzML: could not locate both m/z and intensity arrays in first spectrum");

  const mz = decodeBinary(mzB64, mzType, mzCompressed);
  const intensity = decodeBinary(intB64, intType, intCompressed);

  const n = Math.min(mz.length, intensity.length);
  return {
    mz: new Float64Array(mz.subarray(0, n)),
    intensity: new Float64Array(intensity.subarray(0, n))
  };
}

function parseMzXML(xmlText: string): { mz: Float64Array; intensity: Float64Array } {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserErr = doc.querySelector("parsererror");
  if (parserErr) throw new Error("Invalid XML (mzXML): parsererror");

  const scan = doc.querySelector("scan");
  if (!scan) throw new Error("mzXML: no <scan> found");

  const peaksEl = scan.querySelector("peaks");
  if (!peaksEl) throw new Error("mzXML: no <peaks> found");

  const b64 = getText(peaksEl);
  if (!b64) throw new Error("mzXML: empty <peaks>");

  const precisionAttr = peaksEl.getAttribute("precision");
  const precision = precisionAttr === "32" ? 32 : 64;

  const compressionType = peaksEl.getAttribute("compressionType");
  const compressed = (compressionType ?? "").toLowerCase() === "zlib";

  const dataType = precision === 32 ? "float32" : "float64";
  const arr = decodeBinary(b64, dataType, compressed);

  const nPairs = Math.floor(arr.length / 2);
  const mz = new Float64Array(nPairs);
  const intensity = new Float64Array(nPairs);
  for (let i = 0; i < nPairs; i++) {
    mz[i] = arr[i * 2];
    intensity[i] = arr[i * 2 + 1];
  }
  return { mz, intensity };
}

export async function parseSpectrumFile(file: File): Promise<Spectrum> {
  const name = file.name.toLowerCase();
  const text = await file.text();

  let mz: Float64Array, intensity: Float64Array;
  if (name.endsWith(".mzml")) ({ mz, intensity } = parseMzML(text));
  else if (name.endsWith(".mzxml")) ({ mz, intensity } = parseMzXML(text));
  else throw new Error("Unsupported file type. Please upload .mzML or .mzXML");

  return { id: uid("spec"), filename: file.name, mz, intensity, centroided: true };
}
