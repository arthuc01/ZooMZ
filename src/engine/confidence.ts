export type ConfidenceLevel = "High" | "Medium" | "Low" | "Rejected" | "Unknown";

export type ConfidenceInput = {
  bestScore: number | null;
  bestLabel?: string | null;
  secondScore?: number | null;
  secondLabel?: string | null;
  bestDecoyScore: number | null;
  qSample: number | null;
  matchedMarkers?: number | null;
};

export type ConfidenceResult = {
  confidenceLevel: ConfidenceLevel;
  ratio: number | null;
  decoyGap: number | null;
  targetGap: number | null;
  notes: string;
};

const DECOY_MIN = 0.01;
const SCORE_FLOOR_HIGH = 0.03;
const SCORE_FLOOR_MED = 0.02;
const GAP_HIGH = 0.15;
const GAP_MED = 0.10;
const GAP_LOW = 0.05;

function downgrade(level: ConfidenceLevel): ConfidenceLevel {
  if (level === "High") return "Medium";
  if (level === "Medium") return "Low";
  return level;
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const notes: string[] = [];
  const bestScore = Number.isFinite(input.bestScore ?? NaN) ? (input.bestScore as number) : null;
  const secondScore = Number.isFinite(input.secondScore ?? NaN) ? (input.secondScore as number) : null;
  const bestDecoyScore = Number.isFinite(input.bestDecoyScore ?? NaN) ? (input.bestDecoyScore as number) : null;
  const qSample = Number.isFinite(input.qSample ?? NaN) ? (input.qSample as number) : null;
  const bestLabel = (input.bestLabel ?? "").trim();
  const secondLabel = (input.secondLabel ?? "").trim();

  const ratio = bestDecoyScore != null && bestDecoyScore > 0 && bestScore != null
    ? bestScore / bestDecoyScore
    : null;
  const decoyGap = bestScore != null && bestDecoyScore != null ? bestScore - bestDecoyScore : null;
  const targetGap = bestScore != null && secondScore != null ? bestScore - secondScore : null;

  if (bestScore == null || bestDecoyScore == null || qSample == null) {
    notes.push("Decoys unavailable for confidence scoring.");
    return { confidenceLevel: "Unknown", ratio, decoyGap, targetGap, notes: notes.join("; ") };
  }

  if (qSample > 0.05) {
    notes.push("qSample > 0.05 (FDR reject).");
    return { confidenceLevel: "Rejected", ratio, decoyGap, targetGap, notes: notes.join("; ") };
  }

  const hasStrongDecoySupport = decoyGap != null && qSample <= 0.01 && decoyGap >= GAP_HIGH;
  let tier: ConfidenceLevel = "Rejected";

  if (bestDecoyScore >= DECOY_MIN && ratio != null) {
    if (ratio >= 2.5 && bestScore >= SCORE_FLOOR_HIGH) tier = "High";
    else if (ratio >= 1.8 && bestScore >= SCORE_FLOOR_MED) tier = "Medium";
    else if (ratio >= 1.3) tier = "Low";
  } else if (decoyGap != null) {
    if (decoyGap >= GAP_HIGH) tier = "High";
    else if (decoyGap >= GAP_MED) tier = "Medium";
    else if (decoyGap >= GAP_LOW) tier = "Low";
  }

  if (hasStrongDecoySupport && tier !== "Rejected") {
    tier = "High";
  }

  if (tier === "Rejected") {
    notes.push("Insufficient separation from decoys.");
    return { confidenceLevel: "Rejected", ratio, decoyGap, targetGap, notes: notes.join("; ") };
  }

  if (!hasStrongDecoySupport && targetGap != null && targetGap < 0.01 && bestLabel !== secondLabel) {
    tier = downgrade(tier);
    notes.push("Top hit close to second-best (ambiguous).");
  }

  if (input.matchedMarkers != null && input.matchedMarkers < 3) {
    tier = downgrade(tier);
    notes.push("Limited marker support (<3).");
  }

  return { confidenceLevel: tier, ratio, decoyGap, targetGap, notes: notes.join("; ") };
}
