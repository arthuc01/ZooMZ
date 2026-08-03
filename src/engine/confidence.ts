/**
 * Statistical confidence scoring for ZooMS peptide mass fingerprint identifications.
 *
 * ## Framework
 *
 * ZooMZ uses a per-spectrum permutation test adapted from the target-decoy approach
 * that is standard in shotgun proteomics (Elias & Gygi 2007, Nat Methods 4:207-214).
 *
 * For each spectrum, N decoy taxa are generated with randomly mass-shifted markers
 * (see decoys.ts). The spectrum is scored against both the real reference database
 * and all decoy taxa using Pearson binary correlation (see speciescanScoring.ts).
 *
 * Key statistics derived in analyzeSpectrum (analyze.ts):
 *
 *   s*     = bestRealScore    — Pearson correlation of the top-ranked real taxon
 *   s̃      = bestDecoyScore   — highest score achieved by any decoy taxon
 *   G_d    = s* − s̃           — decoy gap: absolute separation from the noise floor
 *   r      = s* / s̃           — score ratio (informative when s̃ ≥ 0.01)
 *   G_t    = s* − s_second    — target gap: separation from the second-best real taxon
 *   q      = qSample          — per-spectrum permutation p-value (see below)
 *   n      = matchedMarkers   — number of reference markers matched by picked peaks
 *
 * ### qSample: permutation p-value
 *
 *   q = (#{decoys scoring ≥ s*} + 1) / (N + 1)
 *
 * This is a one-sided empirical p-value: the probability, under the null hypothesis
 * that the spectrum contains no genuine collagen peptide signal, that a randomly
 * constructed decoy taxon would score at least as well as the real database. The
 * +1 Laplace correction in numerator and denominator is standard practice to avoid
 * q = 0 (which would occur when all decoys score below s*).
 *
 * IMPORTANT DISTINCTION: qSample is a PER-SPECTRUM p-value, not a dataset-level FDR.
 * For batch analyses with n spectra, multiply-testing correction (e.g. Benjamini-Hochberg)
 * should be applied to the full vector of qSample values. The BH-adjusted q-values then
 * control the expected proportion of false discoveries in the accepted set, which is the
 * classical FDR. This is deferred to the analysis layer; qSample is the raw material.
 *
 * ### Null model assumption
 *
 * Under the null hypothesis, the spectrum's peak pattern carries no taxon-specific
 * collagen signal. Decoys approximate this null by using marker sets with the same
 * count distribution as real taxa but random m/z positions, ensuring they cannot
 * systematically match genuine collagen peptides. Peaks from non-marker background
 * collagen fragments and instrument noise are shared between real and decoy scoring,
 * which is appropriate: those peaks do not contribute to real taxon discrimination.
 *
 * ### Confidence tier assignment
 *
 * Four tiers are assigned using a strict AND gate across four independent criteria:
 *
 *   Criterion A: statistical significance    (q ≤ threshold)
 *   Criterion B: absolute/relative separation from decoys (G_d or r ≥ threshold)
 *   Criterion C: absolute score floor        (s* ≥ threshold)
 *   Criterion D: marker evidence             (n ≥ threshold)
 *
 *   ┌─────────┬──────────┬──────────────────────────┬───────────┬────────┐
 *   │  Tier   │ q (A)    │ G_d or r (B)             │ s* (C)    │ n (D)  │
 *   ├─────────┼──────────┼──────────────────────────┼───────────┼────────┤
 *   │ High    │ ≤ 0.01   │ G_d ≥ 0.15  OR  r ≥ 2.5 │ ≥ 0.10   │ ≥ 3   │
 *   │ Medium  │ ≤ 0.05   │ G_d ≥ 0.08  OR  r ≥ 1.8 │ ≥ 0.05   │ ≥ 2   │
 *   │ Low     │ ≤ 0.05   │ G_d ≥ 0.03  OR  r ≥ 1.3 │ ≥ 0.02   │ ≥ 1   │
 *   │ Rejected│ otherwise                                                │
 *   └─────────┴──────────┴──────────────────────────┴───────────┴────────┘
 *
 * Note: r is only used when bestDecoyScore ≥ DECOY_MIN (= 0.01); when all decoys
 * score near zero, only G_d is used (the ratio is unbounded and uninformative).
 *
 * After tier assignment two post-hoc adjustments are applied:
 *
 *   Ambiguity downgrade: if G_t < 0.005 and the top two real taxa have different
 *   labels, the identification is ambiguous (two taxa equally good). Tier is
 *   downgraded one step.
 *
 *   Sparse marker downgrade: if n < 2 and tier ≥ Medium, downgrade one step.
 *   (Low already requires n ≥ 1, so this only affects Medium/High.)
 *
 * ### Threshold rationale
 *
 *   q thresholds 0.01/0.05: standard significance thresholds mirroring proteomics practice.
 *   G_d thresholds 0.15/0.08/0.03: chosen to reflect meaningful absolute separation in the
 *     Pearson binary correlation space (scores typically 0–0.5 for ZooMS).
 *   r thresholds 2.5/1.8/1.3: fold-change above the decoy noise floor.
 *   Score floors 0.10/0.05/0.02: correspond approximately to 3-4 / 2 / 1 markers cleanly
 *     matched in a typical ZooMS spectrum at default grid resolution (0.1 Da step).
 *   n thresholds 3/2/1: minimal marker evidence required at each tier.
 *
 * WARNING: These thresholds are informed defaults, NOT empirically calibrated values.
 * Calibration against a ground-truth dataset (spectra with independently confirmed
 * taxonomic IDs) is required before using confidence scores in a publication.
 * See FDR_MATH_NOTES.md for calibration guidance.
 */

export type ConfidenceLevel = "High" | "Medium" | "Low" | "Rejected" | "Unknown";

export type ConfidenceInput = {
  /** Pearson correlation of the top-ranked real taxon (s*). */
  bestScore: number | null;
  bestLabel?: string | null;
  /** Pearson correlation of the second-ranked real taxon. */
  secondScore?: number | null;
  secondLabel?: string | null;
  /** Highest score achieved by any decoy taxon (s̃). */
  bestDecoyScore: number | null;
  /** Per-spectrum permutation p-value: (#{decoys ≥ s*} + 1) / (N + 1). */
  qSample: number | null;
  /** Number of reference markers matched by picked peaks for the top taxon. */
  matchedMarkers?: number | null;
};

export type ConfidenceResult = {
  confidenceLevel: ConfidenceLevel;
  /** s* / s̃ — only meaningful when bestDecoyScore ≥ DECOY_MIN. */
  ratio: number | null;
  /** s* − s̃ — absolute separation from the decoy noise floor. */
  decoyGap: number | null;
  /** s* − s_second — separation from the second-best real taxon. */
  targetGap: number | null;
  notes: string;
};

// ── Threshold constants ──────────────────────────────────────────────────────
// q-value gates (permutation p-value thresholds)
const Q_HIGH = 0.01;
const Q_LOW  = 0.05;   // used for Medium and Low tiers

// Decoy gap (G_d = s* − s̃) thresholds
const GAP_HIGH = 0.15;
const GAP_MED  = 0.08;
const GAP_LOW  = 0.03;

// Score ratio (r = s* / s̃) thresholds — only applied when s̃ ≥ DECOY_MIN
const RATIO_HIGH = 2.5;
const RATIO_MED  = 1.8;
const RATIO_LOW  = 1.3;

// Minimum bestDecoyScore for the ratio to be considered informative.
// Below this, all decoys scored near zero and ratio becomes unbounded/meaningless.
const DECOY_MIN = 0.01;

// Minimum absolute bestScore (s*) required at each tier.
// These prevent high-tier calls for very weak identifications regardless of separation.
const SCORE_HIGH = 0.10;
const SCORE_MED  = 0.05;
const SCORE_LOW  = 0.02;

// Minimum matched markers required at each tier.
const N_HIGH = 3;
const N_MED  = 2;
const N_LOW  = 1;

// Target gap below which two co-equal taxa are considered ambiguous.
const TARGET_GAP_AMBIGUOUS = 0.005;
// ────────────────────────────────────────────────────────────────────────────

function downgrade(level: ConfidenceLevel): ConfidenceLevel {
  if (level === "High")   return "Medium";
  if (level === "Medium") return "Low";
  // "Low" → stays "Low"; "Rejected"/"Unknown" unchanged.
  return level;
}

/**
 * Compute a confidence tier for a single ZooMS identification.
 *
 * All four criteria (q, separation, score floor, marker count) must be satisfied
 * simultaneously for a tier to be assigned. This is an AND gate — not a point system.
 *
 * The function is pure and has no side effects.
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const notes: string[] = [];

  // Safely coerce inputs — treat non-finite values as null (missing).
  const s      = Number.isFinite(input.bestScore    ?? NaN) ? (input.bestScore    as number) : null;
  const sDecoy = Number.isFinite(input.bestDecoyScore ?? NaN) ? (input.bestDecoyScore as number) : null;
  const sSecond = Number.isFinite(input.secondScore  ?? NaN) ? (input.secondScore  as number) : null;
  const q       = Number.isFinite(input.qSample      ?? NaN) ? (input.qSample      as number) : null;
  const n       = input.matchedMarkers ?? null;
  const topLabel    = (input.bestLabel   ?? "").trim();
  const secondLabel = (input.secondLabel ?? "").trim();

  // Derived metrics (null when inputs are missing).
  const ratio     = (s != null && sDecoy != null && sDecoy >= DECOY_MIN) ? s / sDecoy : null;
  const decoyGap  = (s != null && sDecoy != null)  ? s - sDecoy  : null;
  const targetGap = (s != null && sSecond != null) ? s - sSecond : null;

  // ── Guard: no decoy data ──────────────────────────────────────────────────
  if (s == null || sDecoy == null || q == null) {
    notes.push("Decoy scoring unavailable — enable FDR in settings.");
    return { confidenceLevel: "Unknown", ratio, decoyGap, targetGap, notes: notes.join(" | ") };
  }

  // ── Primary gate: FDR rejection ───────────────────────────────────────────
  // qSample > Q_LOW means too many decoys scored at least as well as the real hit.
  // The identification is statistically indistinguishable from random noise.
  if (q > Q_LOW) {
    notes.push(`qSample ${q.toFixed(3)} > ${Q_LOW} — fails permutation test (too many decoys compete).`);
    return { confidenceLevel: "Rejected", ratio, decoyGap, targetGap, notes: notes.join(" | ") };
  }

  // ── Compute separation criterion (B): gap OR ratio ────────────────────────
  // When bestDecoyScore ≥ DECOY_MIN both gap and ratio are informative; either passing
  // is sufficient. When bestDecoyScore < DECOY_MIN (decoys near zero), only gap is used.
  const separationHigh = decoyGap != null && (
    decoyGap >= GAP_HIGH || (ratio != null && ratio >= RATIO_HIGH)
  );
  const separationMed = decoyGap != null && (
    decoyGap >= GAP_MED  || (ratio != null && ratio >= RATIO_MED)
  );
  const separationLow = decoyGap != null && (
    decoyGap >= GAP_LOW  || (ratio != null && ratio >= RATIO_LOW)
  );

  // ── Tier assignment: strict AND across all four criteria ──────────────────
  let tier: ConfidenceLevel = "Rejected";

  if (
    q <= Q_HIGH &&
    separationHigh &&
    s >= SCORE_HIGH &&
    (n == null || n >= N_HIGH)
  ) {
    tier = "High";
  } else if (
    q <= Q_LOW &&
    separationMed &&
    s >= SCORE_MED &&
    (n == null || n >= N_MED)
  ) {
    tier = "Medium";
  } else if (
    q <= Q_LOW &&
    separationLow &&
    s >= SCORE_LOW &&
    (n == null || n >= N_LOW)
  ) {
    tier = "Low";
  }

  if (tier === "Rejected") {
    // Provide a diagnostic note explaining the bottleneck.
    if (!separationLow)
      notes.push(`Insufficient decoy separation (G_d=${decoyGap?.toFixed(3) ?? "n/a"}, ratio=${ratio?.toFixed(2) ?? "n/a"}).`);
    else if (s < SCORE_LOW)
      notes.push(`Score too low (s=${s.toFixed(3)} < ${SCORE_LOW}).`);
    else if (n != null && n < N_LOW)
      notes.push(`Too few markers matched (n=${n} < ${N_LOW}).`);
    else
      notes.push("Identification rejected.");
    return { confidenceLevel: "Rejected", ratio, decoyGap, targetGap, notes: notes.join(" | ") };
  }

  // ── Post-hoc adjustments ──────────────────────────────────────────────────

  // 1. Ambiguity downgrade: top two taxa have the same score to within TARGET_GAP_AMBIGUOUS.
  //    Applied unconditionally — ambiguity is always penalised.
  if (targetGap != null && targetGap < TARGET_GAP_AMBIGUOUS && topLabel !== secondLabel) {
    tier = downgrade(tier);
    notes.push(`Ambiguous: top two taxa differ by only ${targetGap.toFixed(4)} (threshold ${TARGET_GAP_AMBIGUOUS}).`);
  }

  // 2. Sparse marker downgrade: fewer than N_MED markers for a Medium/High call.
  if (n != null && n < N_MED && tier !== "Low" && tier !== "Rejected") {
    tier = downgrade(tier);
    notes.push(`Sparse marker evidence (n=${n}): downgraded.`);
  }

  if (!notes.length) notes.push("OK");
  return { confidenceLevel: tier, ratio, decoyGap, targetGap, notes: notes.join(" | ") };
}
