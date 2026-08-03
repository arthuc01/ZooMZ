import React, { useState, useMemo } from "react";
import type { AnalysisResult, SpeciescanDb } from "../engine/types";
import type { TaxonomyAssignment, TaxonomyTree, TreeSpecies } from "../engine/taxonomy";
import { buildTaxonomyTree } from "../engine/taxonomy";

// ── Colour helpers ─────────────────────────────────────────────────────────────

function scoreColor(corr: number, isIndi: boolean, isAlt: boolean): string {
  if (isIndi) return "#16a34a";
  if (isAlt)  return "#d97706";
  if (corr > 0.5) return "#2563eb";
  return "#9ca3af";
}

function rankBadgeStyle(rank: string): React.CSSProperties {
  const colors: Record<string, string> = {
    species: "#16a34a", genus: "#2563eb", family: "#7c3aed",
    order: "#b45309", unresolved: "#6b7280",
  };
  return {
    background: colors[rank] ?? "#6b7280",
    color: "#fff", borderRadius: 4, padding: "1px 7px",
    fontSize: "0.75rem", fontWeight: 600,
  };
}

// ── Species leaf ───────────────────────────────────────────────────────────────

function SpeciesNode({ sp, selectedId, onSelect }: {
  sp: TreeSpecies; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const isSelected = sp.taxonId === selectedId;
  const col = scoreColor(sp.correlation, sp.isIndistinguishable, sp.isAlternative);
  const barW = `${Math.max(2, Math.min(100, sp.correlation * 100))}%`;

  return (
    <div
      onClick={() => onSelect(sp.taxonId)}
      title={`Click to inspect marker matches for ${sp.label}`}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "2px 5px", marginLeft: 14, marginTop: 2,
        borderRadius: 4, cursor: "pointer",
        background: isSelected ? "#f0f9ff" : "transparent",
        border: isSelected ? "1px solid #7dd3fc" : "1px solid transparent",
      }}
    >
      <span style={{ color: "#d1d5db", fontSize: "0.68rem", userSelect: "none" }}>└</span>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0,
        boxShadow: sp.isIndistinguishable ? "0 0 0 2px #15803d" : sp.isAlternative ? "0 0 0 2px #b45309" : "none",
      }} />
      <span style={{
        fontStyle: "italic", fontSize: "0.80rem", color: col,
        fontWeight: sp.isIndistinguishable ? 700 : 400,
        flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {sp.label}
      </span>
      <div style={{ width: 54, height: 5, background: "#e5e7eb", borderRadius: 3, flexShrink: 0 }}>
        <div style={{ width: barW, height: "100%", background: col, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: "0.73rem", color: "#6b7280", minWidth: 34, textAlign: "right" }}>
        {sp.correlation.toFixed(3)}
      </span>
      {sp.totalMarkers > 0 && (
        <span style={{ fontSize: "0.68rem", color: "#9ca3af", minWidth: 26, textAlign: "right" }}>
          {sp.matchedMarkers}/{sp.totalMarkers}
        </span>
      )}
    </div>
  );
}

function Toggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <span onClick={onClick} style={{
      cursor: "pointer", userSelect: "none", fontSize: "0.68rem",
      color: "#9ca3af", width: 13, display: "inline-block", textAlign: "center",
    }}>
      {open ? "▾" : "▸"}
    </span>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

type Props = {
  result: AnalysisResult | null;
  db: SpeciescanDb | null;
  selectedTaxonId: string | null;
  onSelectTaxon: (id: string) => void;
};

export default function TaxonomyPanel({ result, db, selectedTaxonId, onSelectTaxon }: Props) {
  const [collapsedOrders,   setCollapsedOrders]   = useState<Set<string>>(new Set());
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(new Set());

  type MemoResult = { tree: TaxonomyTree; assignment: TaxonomyAssignment | null };
  const { tree, assignment } = useMemo<MemoResult>(() => {
    if (!result || !db) return { tree: [], assignment: null };
    const t = buildTaxonomyTree(result.rankedTaxa, db, result.taxonMatchesTop, result.assignment, 30);
    return { tree: t, assignment: result.assignment };
  }, [result, db]);

  const toggleOrder  = (o: string) => setCollapsedOrders(s  => { const n = new Set(s); n.has(o) ? n.delete(o) : n.add(o);  return n; });
  const toggleFamily = (f: string) => setCollapsedFamilies(s => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });

  if (!result) {
    return (
      <div className="card">
        <div style={{ fontWeight: 700 }}>Taxonomy assignment</div>
        <div className="small">Run analysis to see the species tree.</div>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Assignment header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Taxonomy assignment</div>
        {assignment && (
          <span style={rankBadgeStyle(assignment.rank)}>
            {assignment.rank.charAt(0).toUpperCase() + assignment.rank.slice(1)}
          </span>
        )}
      </div>

      {assignment ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{
            fontSize: "1.0rem", fontWeight: 700,
            fontStyle: assignment.rank !== "unresolved" ? "italic" : "normal",
            color: "#111827",
          }}>
            {assignment.label}
          </div>
          {assignment.nIndistinguishable > 1 && (
            <div className="small" style={{ marginTop: 2, color: "#6b7280" }}>
              {assignment.nIndistinguishable} indistinguishable species (identical marker fingerprint)
            </div>
          )}
          {assignment.alternatives.length > 0 && (
            <div className="small" style={{ marginTop: 4, color: "#d97706" }}>
              Near-optimal: {assignment.alternatives.map(a => a.label).join(", ")}
            </div>
          )}
          <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span className="small" style={{ color: "#16a34a" }}>● assignment group</span>
            <span className="small" style={{ color: "#d97706" }}>● near-optimal</span>
            <span className="small" style={{ color: "#2563eb" }}>● distinguishable</span>
          </div>
        </div>
      ) : (
        <div className="small" style={{ marginBottom: 10 }}>No significant match.</div>
      )}

      {/* Clickable tree */}
      {tree.length > 0 ? (
        <div style={{ maxHeight: 400, overflowY: "auto", overflowX: "hidden" }}>
          {tree.map(ord => {
            const ordOpen = !collapsedOrders.has(ord.order);
            return (
              <div key={ord.order} style={{ marginBottom: 3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <Toggle open={ordOpen} onClick={() => toggleOrder(ord.order)} />
                  <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "#374151" }}>{ord.order}</span>
                </div>
                {ordOpen && ord.families.map(fam => {
                  const famKey = `${ord.order}::${fam.family}`;
                  const famOpen = !collapsedFamilies.has(famKey);
                  return (
                    <div key={fam.family} style={{ marginLeft: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
                        <Toggle open={famOpen} onClick={() => toggleFamily(famKey)} />
                        <span style={{ fontSize: "0.73rem", color: "#6b7280" }}>{fam.family}</span>
                      </div>
                      {famOpen && fam.genera.map(gen => (
                        <div key={gen.genus} style={{ marginLeft: 10 }}>
                          <div style={{ fontSize: "0.71rem", color: "#9ca3af", paddingLeft: 4, fontStyle: "italic" }}>
                            {gen.genus}
                          </div>
                          {gen.species.map(sp => (
                            <SpeciesNode
                              key={sp.taxonId}
                              sp={sp}
                              selectedId={selectedTaxonId}
                              onSelect={onSelectTaxon}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="small">No taxa with positive correlation.</div>
      )}

      <div className="small" style={{ marginTop: 6, color: "#9ca3af" }}>
        Top 30 taxa shown. Click a species to inspect its marker diagnostics.
      </div>
    </div>
  );
}
