import { uid } from "../utils/id";
import type { Contaminant, DbManifest, RefMarker, RefTaxon, SpeciescanDb } from "./types";
import { parseCsv, toNumberMaybe } from "./csv";

export async function loadManifest(): Promise<DbManifest> {
  const res = await fetch("/reference_dbs/manifest.json");
  if (!res.ok) throw new Error("Failed to load DB manifest");
  return (await res.json()) as DbManifest;
}

export async function loadSpeciescanDb(label: string, file: string): Promise<SpeciescanDb> {
  const res = await fetch(`/reference_dbs/${file}`);
  if (!res.ok) throw new Error(`Failed to load reference DB: ${file}`);
  const text = await res.text();
  const table = parseCsv(text);
  if (table.length < 2) throw new Error(`Reference DB ${file} looks empty`);

  const header = table[0].map(h => (h ?? "").trim());
  const rows = table.slice(1);

  const idxOrder = header.findIndex(h => h.toLowerCase() === "order");
  const idxFamily = header.findIndex(h => h.toLowerCase() === "family");
  const idxSpecies = header.findIndex(h => h.toLowerCase() === "species");
  const idxTaxon = header.findIndex(h => h.toLowerCase() === "zooms_taxon");

  const startIdx = (idxTaxon >= 0 ? idxTaxon + 1 : (idxSpecies >= 0 ? idxSpecies + 1 : 0));
  const markerCols: number[] = [];
  for (let c = startIdx; c < header.length; c++) markerCols.push(c);
  const markerNames = markerCols.map(c => header[c]).filter(Boolean);

  const taxa: RefTaxon[] = rows.map(r => {
    const order = idxOrder >= 0 ? (r[idxOrder] ?? "").trim() : undefined;
    const family = idxFamily >= 0 ? (r[idxFamily] ?? "").trim() : undefined;
    const species = idxSpecies >= 0 ? (r[idxSpecies] ?? "").trim() : undefined;
    const zoomsTaxon = idxTaxon >= 0 ? (r[idxTaxon] ?? "").trim() : "";

    const label2 = zoomsTaxon || species || "Unknown";

    const markers: RefMarker[] = [];
    for (const col of markerCols) {
      const v = toNumberMaybe(r[col] ?? "");
      if (v !== null) markers.push({ name: header[col], mz: v });
    }

    return { id: uid("taxon"), label: label2, species, family, order, markers };
  });

  return { meta: { label, file }, taxa, markerNames };
}

export async function loadContaminants(file: string): Promise<Contaminant[]> {
  const res = await fetch(`/reference_dbs/${file}`);
  if (!res.ok) return [];
  const text = await res.text();
  const table = parseCsv(text);
  if (table.length < 2) return [];

  const header = table[0].map(h => (h ?? "").trim().toLowerCase());
  const rows = table.slice(1);

  const idxName = header.findIndex(h => h === "name" || h === "contaminant" || h === "label");
  const idxMz = header.findIndex(h => h === "mz" || h === "m/z" || h === "mass");

  const out: Contaminant[] = [];
  for (const r of rows) {
    if (idxMz >= 0) {
      const mz = toNumberMaybe(r[idxMz] ?? "");
      if (mz === null) continue;
      const name = idxName >= 0 ? (r[idxName] ?? "").trim() : "Contaminant";
      out.push({ name: name || "Contaminant", mz });
      continue;
    }
    let mz: number | null = null;
    for (const cell of r) {
      const v = toNumberMaybe(cell ?? "");
      if (v !== null) { mz = v; break; }
    }
    if (mz !== null) {
      const name = idxName >= 0 ? (r[idxName] ?? "").trim() : "Contaminant";
      out.push({ name: name || "Contaminant", mz });
    }
  }
  return out;
}
