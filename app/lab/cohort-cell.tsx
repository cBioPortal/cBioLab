"use client";
// The Patient tables' Cohort cell, shared by the Summary tables and Genomic Evolution's (lib/views/alterations/cohort-cell.ts draws its numbers).
import { cohortBar, cohortTooltip } from "../../lib/views/alterations/cohort-cell.ts";
import type { CohortCount } from "../../lib/views/alterations/types.ts";

/**
 * The Cohort cell as the portal's patient tables draw it (FrequencyBar): a grey bar with the gene's
 * share over it — a mutation's keyword share darker within it, a copy-number call red or blue — the
 * percent beside it, and the counts on hover; "Data not available." where there is no count to draw.
 */
export function CohortCell({ row, gene, cna, shown }: { row: { detail?: Record<string, unknown> }; gene: string; cna?: string; shown: boolean }) {
  const c = row.detail?.cohort as CohortCount | undefined;
  if (!c || !shown) return <span className="alt-cohort-na" data-tip="Data not available.">&nbsp;</span>;
  const b = cohortBar(c, cna);
  const tip = cohortTooltip(gene, c, cna);
  return (
    <svg width={b.width} height={b.height} data-tip={tip} role="img" aria-label={tip}>
      <rect y={b.top} width={b.barWidth} height={b.barHeight} fill={b.background} />
      {b.bars.map((r, i) => <rect key={i} y={b.top} width={r.width} height={b.barHeight} fill={r.color} />)}
      <text x={b.textX} y={b.textY} fontSize={b.fontSize} fill="currentColor">{b.text}</text>
    </svg>
  );
}
