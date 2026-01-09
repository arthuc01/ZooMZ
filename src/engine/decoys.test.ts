import { buildDecoyTaxa } from "./decoys";
import type { SpeciescanDb } from "./types";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function isNear(sorted: number[], mz: number, tol: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < mz) lo = mid + 1;
    else hi = mid;
  }
  if (lo < sorted.length && Math.abs(sorted[lo] - mz) <= tol) return true;
  if (lo > 0 && Math.abs(sorted[lo - 1] - mz) <= tol) return true;
  return false;
}

export function runDecoySelfTest() {
  const db: SpeciescanDb = {
    meta: { label: "test", file: "test.csv" },
    taxa: [
      { id: "t1", label: "T1", markers: [{ name: "m1", mz: 600 }, { name: "m2", mz: 700 }] },
      { id: "t2", label: "T2", markers: [{ name: "m3", mz: 800 }, { name: "m4", mz: 900 }, { name: "m5", mz: 1000 }] },
      { id: "t3", label: "T3", markers: [{ name: "m6", mz: 1100 }] },
    ],
    markerNames: ["m1", "m2", "m3", "m4", "m5", "m6"],
  };

  const mzMin = 500;
  const mzMax = 1500;
  const toleranceDa = 0.3;
  const decoys = buildDecoyTaxa(db, { nDecoys: 20, seed: 1337, mzMin, mzMax, toleranceDa });

  assert(decoys.length === 20, "Expected decoy taxa length");

  const realMzSorted = db.taxa.flatMap(t => t.markers.map(m => m.mz)).sort((a, b) => a - b);
  for (const d of decoys) {
    for (const m of d.markers) {
      assert(m.mz >= mzMin && m.mz <= mzMax, "Decoy marker out of range");
      assert(!isNear(realMzSorted, m.mz, toleranceDa * 2), "Decoy marker too close to real marker");
    }
  }
}
