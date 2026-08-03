/**
 * taxonomy.ts
 * -----------
 * PAMPA-inspired taxonomy assignment for ZooMZ.
 *
 * Given a ranked list of taxa (sorted by Pearson correlation), this module:
 *   1. Identifies "indistinguishable" taxa — those whose matched marker PATTERN
 *      is identical to the top hit (same markers matched/missed).  Falls back
 *      to a score-proximity threshold when marker patterns are unavailable.
 *   2. Computes the Lowest Common Ancestor (LCA) of the indistinguishable group
 *      using the three-level hierarchy available in RefTaxon: order → family →
 *      genus (inferred from species binomial).
 *   3. Collects "near-optimal alternatives" — taxa that score close to the top
 *      but are distinguishable (i.e., outside the indistinguishable group).
 *   4. Builds a tree structure suitable for the clickable TaxonomyPanel.
 */

import type { MarkerMatchRow, RefTaxon, SpeciescanDb, TaxonScore } from "./types";

// ── Public types ─────────────────────────────────────────────────────────────

export type TaxonomicRank = "species" | "genus" | "family" | "order" | "unresolved";

export type TaxonomyAssignment = {
  rank: TaxonomicRank;
  label: string;              // e.g. "Bos" or "Bovidae"
  nIndistinguishable: number; // size of indistinguishable group
  indistinguishable: string[]; // taxon labels in the indistinguishable group
  alternatives: Array<{ label: string; correlation: number }>; // near-optimal, distinguishable
  topScore: number;
};

export type TreeSpecies = {
  taxonId: string;
  label: string;
  species: string;
  correlation: number;
  isIndistinguishable: boolean; // part of the assignment group
  isAlternative: boolean;       // near-optimal alternative
  matchedMarkers: number;
  totalMarkers: number;
};

export type TreeGenus = { genus: string; species: TreeSpecies[] };
export type TreeFamily = { family: string; genera: TreeGenus[] };
export type TreeOrder = { order: string; families: TreeFamily[] };
export type TaxonomyTree = TreeOrder[];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract genus from a binomial species name ("Bos taurus" → "Bos"). */
export function inferGenus(species: string | undefined): string {
  if (!species) return "Unknown";
  const first = species.trim().split(/\s+/)[0];
  return first || "Unknown";
}

/** Canonical "match pattern" string for comparing two taxa's hit sets. */
function matchPattern(rows: MarkerMatchRow[]): string {
  return rows.map(r => (r.matched ? "1" : "0")).join("");
}

// ── Assignment logic ──────────────────────────────────────────────────────────

/**
 * Compute the PAMPA-style taxonomy assignment for the top-ranked hit.
 *
 * @param rankedTaxa    Full ranked list from scoreTaxa (sorted descending).
 * @param db            Reference database (for order/family/species metadata).
 * @param matchesMap    Per-taxon marker match rows (from taxonMatchesTop).
 * @param opts          tieScoreThreshold: fallback score delta when marker
 *                      pattern comparison is unavailable (default 0.004).
 *                      altScoreThreshold: max score delta for "near-optimal"
 *                      alternatives (default 0.06).
 */
export function computeAssignment(
  rankedTaxa: TaxonScore[],
  db: SpeciescanDb,
  matchesMap: Record<string, MarkerMatchRow[]>,
  opts: { tieScoreThreshold?: number; altScoreThreshold?: number } = {}
): TaxonomyAssignment | null {
  if (!rankedTaxa.length) return null;

  const tieThreshold = opts.tieScoreThreshold ?? 0.004;
  const altThreshold = opts.altScoreThreshold  ?? 0.06;

  const topScore = rankedTaxa[0].correlation;
  if (topScore <= 0) return null;

  const taxonById = new Map<string, RefTaxon>(db.taxa.map(t => [t.id, t]));

  // Reference marker pattern of the top hit (if available)
  const topPattern = matchesMap[rankedTaxa[0].taxonId]
    ? matchPattern(matchesMap[rankedTaxa[0].taxonId])
    : null;

  // Classify every ranked taxon
  const indistinguishable: TaxonScore[] = [];
  const alternatives: TaxonScore[] = [];

  for (const ts of rankedTaxa) {
    const delta = topScore - ts.correlation;
    const pattern = matchesMap[ts.taxonId] ? matchPattern(matchesMap[ts.taxonId]) : null;

    // Indistinguishable: identical marker pattern (preferred) or within tight score delta
    const samePattern = topPattern !== null && pattern !== null && pattern === topPattern;
    const scoreTie   = delta <= tieThreshold;

    if (samePattern || scoreTie) {
      indistinguishable.push(ts);
    } else if (delta <= altThreshold) {
      alternatives.push(ts);
    }
  }

  // LCA of the indistinguishable group
  const group = indistinguishable.map(ts => taxonById.get(ts.taxonId)).filter(Boolean) as RefTaxon[];

  const speciesLabels = group.map(t => t.species || t.label);
  const genera  = group.map(t => inferGenus(t.species || t.label));
  const families = group.map(t => t.family ?? "");
  const orders   = group.map(t => t.order  ?? "");

  const uniqueSpecies = new Set(speciesLabels);
  const uniqueGenera  = new Set(genera.filter(Boolean));
  const uniqueFamilies = new Set(families.filter(Boolean));
  const uniqueOrders   = new Set(orders.filter(Boolean));

  let rank: TaxonomicRank;
  let label: string;

  if (uniqueSpecies.size === 1) {
    rank = "species"; label = [...uniqueSpecies][0];
  } else if (uniqueGenera.size === 1) {
    rank = "genus";   label = [...uniqueGenera][0];
  } else if (uniqueFamilies.size === 1) {
    rank = "family";  label = [...uniqueFamilies][0];
  } else if (uniqueOrders.size === 1) {
    rank = "order";   label = [...uniqueOrders][0];
  } else {
    rank = "unresolved"; label = "Multiple clades";
  }

  return {
    rank,
    label,
    nIndistinguishable: indistinguishable.length,
    indistinguishable: indistinguishable.map(ts => ts.taxonLabel),
    alternatives: alternatives.slice(0, 8).map(ts => ({
      label: ts.taxonLabel,
      correlation: ts.correlation,
    })),
    topScore,
  };
}

// ── Tree builder ──────────────────────────────────────────────────────────────

/**
 * Build a nested Order → Family → Genus → Species tree from the top-N ranked
 * taxa.  Only taxa with positive correlation are included.
 *
 * @param rankedTaxa     Ranked taxa (all of them; tree uses top topN).
 * @param db             Reference DB for metadata.
 * @param matchesMap     Marker match rows, used to count matched markers.
 * @param assignment     The computed assignment (to flag indistinguishable/alt).
 * @param topN           How many taxa to include in the tree (default 30).
 */
export function buildTaxonomyTree(
  rankedTaxa: TaxonScore[],
  db: SpeciescanDb,
  matchesMap: Record<string, MarkerMatchRow[]>,
  assignment: TaxonomyAssignment | null,
  topN = 30
): TaxonomyTree {
  const taxonById = new Map<string, RefTaxon>(db.taxa.map(t => [t.id, t]));

  const indistSet = new Set(assignment?.indistinguishable ?? []);
  const altSet    = new Set((assignment?.alternatives ?? []).map(a => a.label));

  // Collect tree species entries for top-N positive-scoring taxa
  const entries: TreeSpecies[] = [];
  for (const ts of rankedTaxa.slice(0, topN)) {
    if (ts.correlation <= 0) break;
    const ref = taxonById.get(ts.taxonId);
    if (!ref) continue;

    const rows = matchesMap[ts.taxonId] ?? [];
    entries.push({
      taxonId:            ts.taxonId,
      label:              ts.taxonLabel,
      species:            ref.species || ts.taxonLabel,
      correlation:        ts.correlation,
      isIndistinguishable: indistSet.has(ts.taxonLabel),
      isAlternative:      altSet.has(ts.taxonLabel),
      matchedMarkers:     rows.filter(r => r.matched).length,
      totalMarkers:       rows.length,
    });
  }

  // Group into tree
  const orderMap = new Map<string, Map<string, Map<string, TreeSpecies[]>>>();

  for (const sp of entries) {
    const ref    = taxonById.get(sp.taxonId);
    const order  = (ref?.order  || "Unknown order").trim();
    const family = (ref?.family || "Unknown family").trim();
    const genus  = inferGenus(ref?.species || sp.label);

    if (!orderMap.has(order))  orderMap.set(order,  new Map());
    const famMap = orderMap.get(order)!;
    if (!famMap.has(family))   famMap.set(family, new Map());
    const genMap = famMap.get(family)!;
    if (!genMap.has(genus))    genMap.set(genus,  []);
    genMap.get(genus)!.push(sp);
  }

  // Convert to plain arrays, sorted by best correlation desc
  const tree: TaxonomyTree = [];
  for (const [order, famMap] of orderMap) {
    const families: TreeFamily[] = [];
    for (const [family, genMap] of famMap) {
      const genera: TreeGenus[] = [];
      for (const [genus, sps] of genMap) {
        sps.sort((a, b) => b.correlation - a.correlation);
        genera.push({ genus, species: sps });
      }
      genera.sort((a, b) => b.species[0].correlation - a.species[0].correlation);
      families.push({ family, genera });
    }
    families.sort((a, b) => b.genera[0].species[0].correlation - a.genera[0].species[0].correlation);
    tree.push({ order, families });
  }
  tree.sort((a, b) => b.families[0].genera[0].species[0].correlation - a.families[0].genera[0].species[0].correlation);

  return tree;
}
