// Pathways figure: each oncogenic signalling pathway's genes, altered fraction per cohort.
import { esc, SERIES, palette, num, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { CN_GAIN, CN_LOSS, qFmt } from "./common.ts";

export function pathwaysSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), res = v.pathways!;
  const rows = res.rows, k = rows[0]?.cells.length || 1;
  const NAME_W = 150, BAR_X = 160, BAR_W = 190, TILE_X = BAR_X + BAR_W + 70, TILE_W = 86, TILE_GAP = 6;
  const maxTiles = Math.max(1, ...rows.map((r) => r.top.length));
  const W0 = o.width || 960;
  const W = Math.max(W0, TILE_X + maxTiles * (TILE_W + TILE_GAP) + 130);
  const rowH = Math.max(46, 12 + k * 14);
  const out: string[] = [];
  const T = 26;
  out.push(`<text x="10" y="16" font-size="10" fill="${p.muted}">pathway</text>` +
    `<text x="${BAR_X}" y="16" font-size="10" fill="${p.muted}">patients with ≥1 member ${res.measure === "driver" ? "driver" : "altered"}</text>` +
    `<text x="${TILE_X}" y="16" font-size="10" fill="${p.muted}">most-altered members (% per cohort${k === 2 ? ", ★ q &lt; 0.05" : ""})</text>`);
  let maxPct = 0;
  for (const r of rows) for (const c of r.cells) maxPct = Math.max(maxPct, c.pct ?? 0);
  const scale = maxPct > 0 ? Math.min(100, Math.ceil(maxPct / 10) * 10) : 100;
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    if (i % 2 === 0) out.push(`<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="${p.line}" opacity="0.35"/>`);
    out.push(`<text x="10" y="${y + 17}" font-size="12" font-weight="600" fill="${p.ink}">${esc(r.name)}</text>`);
    out.push(`<text x="10" y="${y + 31}" font-size="9.5" fill="${p.muted}">${r.profiledGenes} of ${r.genes} genes profiled${r.source === "document" ? " · your set" : ""}</text>`);
    r.cells.forEach((c, ci) => {
      const by = y + 7 + ci * 14, w = c.pct == null ? 0 : BAR_W * c.pct / scale;
      out.push(`<rect x="${BAR_X}" y="${by}" width="${BAR_W}" height="10" rx="2" fill="${p.bg}" stroke="${p.line}"/>`);
      if (w > 0) out.push(`<rect x="${BAR_X}" y="${by}" width="${num(w)}" height="10" rx="2" fill="${SERIES[ci % SERIES.length]}"/>`);
      out.push(`<text x="${BAR_X + BAR_W + 6}" y="${by + 9}" font-size="10" fill="${p.ink}">${c.pct == null ? "not profiled" : c.pct.toFixed(1) + "%"}</text>`);
    });
    if (r.q != null) out.push(`<text x="${BAR_X + BAR_W + 6}" y="${y + rowH - 4}" font-size="9" fill="${p.muted}">${esc(qFmt(r.q))}</text>`);
    r.top.forEach((t, ti) => {
      const tx = TILE_X + ti * (TILE_W + TILE_GAP), ty = y + 4, th = rowH - 8;
      const peak = Math.max(...t.cells.map((c) => c.pct ?? 0));
      out.push(`<rect x="${tx}" y="${ty}" width="${TILE_W}" height="${th}" rx="4" fill="${p.bg}" stroke="${p.line}"/>`);
      out.push(`<rect x="${tx}" y="${ty}" width="4" height="${th}" rx="2" fill="${t.role === "OG" ? CN_GAIN : t.role === "TSG" ? CN_LOSS : p.line}" opacity="${Math.min(1, 0.25 + peak / 40)}"/>`);
      out.push(`<text x="${tx + 9}" y="${ty + 13}" font-size="10.5" font-weight="600" fill="${p.ink}">${esc(t.gene)}${t.q != null && t.q < 0.05 ? " ★" : ""}</text>`);
      t.cells.forEach((c, ci) => {
        out.push(`<text x="${tx + 9 + ci * (k > 2 ? 19 : 36)}" y="${ty + 27}" font-size="${k > 2 ? 8.5 : 10}" fill="${SERIES[ci % SERIES.length]}">` +
          `${c.pct == null ? "–" : (k > 2 ? Math.round(c.pct) : c.pct.toFixed(1)) + "%"}</text>`);
      });
    });
    const tail = TILE_X + r.top.length * (TILE_W + TILE_GAP);
    const bits = [r.otherAltered ? "+" + r.otherAltered + " more altered" : "", r.notProfiled.length ? r.notProfiled.length + " never profiled" : ""].filter(Boolean);
    bits.forEach((b, bi) => out.push(`<text x="${tail}" y="${y + 17 + bi * 13}" font-size="9.5" fill="${p.muted}">${esc(b)}</text>`));
  });
  let y = T + rows.length * rowH + 16;
  rows[0]?.cells.forEach((c, ci) => {
    const x = 10 + ci * 190;
    out.push(`<rect x="${x}" y="${y - 9}" width="9" height="9" rx="2" fill="${SERIES[ci % SERIES.length]}"/>` +
      `<text x="${x + 13}" y="${y}" font-size="10.5" fill="${p.ink}">${esc(c.cohort)}</text>`);
  });
  const lx = 10 + k * 190;
  out.push(`<rect x="${lx}" y="${y - 9}" width="4" height="9" fill="${CN_GAIN}"/><text x="${lx + 8}" y="${y}" font-size="10" fill="${p.muted}">oncogene</text>` +
    `<rect x="${lx + 70}" y="${y - 9}" width="4" height="9" fill="${CN_LOSS}"/><text x="${lx + 78}" y="${y}" font-size="10" fill="${p.muted}">tumour suppressor (paper's role)</text>`);
  y += 6;
  const cap = caption(v.caveat || "", W, y, p.muted, Math.floor(W / 7.2));
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg, W > W0);
}

