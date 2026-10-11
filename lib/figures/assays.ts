// Assays figure: one generic-assay profile's entities compared between cohorts.
import { esc, SERIES, palette, num, fmt, frame, caption, type SvgOpts } from "../svg-kit.ts";
import type { ViewResult } from "../types.ts";
import { AMP, DEL } from "./common.ts";
import { volcano } from "./enrichment.ts";

/** A categorical assay's value colours: copy-number words take the oncoprint's, the rest the series. */
function valueColor(v: string, i: number, p: ReturnType<typeof palette>): string {
  if (/^(gain|amp)/i.test(v)) return AMP;
  if (/^(loss|del|homdel)/i.test(v)) return DEL;
  if (/^(unchanged|neutral|normal|wt|no)$/i.test(v)) return p.line;
  return SERIES[i % SERIES.length];
}

export function assaysSvg(v: ViewResult, o: SvgOpts): string {
  const p = palette(o.theme), r = v.assays!;
  const W = o.width || 960, cat = r.datatype === "categorical";
  const two = r.groups.length === 2 && !!r.grid;
  const out: string[] = [];
  out.push(`<text x="10" y="14" font-size="10.5" fill="${p.muted}">${fmt(r.tested)} ${esc(r.profileName)} entities tested (${esc(r.test)}) · ${fmt(r.significant)} at q &lt; 0.05</text>`);
  let bottom = 30;
  if (two) {
    const v2 = volcano(p, r.grid!, r.rows.map((row) => ({ key: row.entity, label: row.name, x: row.diff ?? 0, p: row.p,
      color: row.q < 0.05 ? (row.higherIn === r.groups[0] ? SERIES[0] : SERIES[1]) : p.muted })), r.labels,
      "difference in mean (" + r.groups[0] + " − " + r.groups[1] + ")");
    out.push(v2.svg);
    bottom = v2.bottom;
  }
  const TX = two ? 470 : 10, TW = W - TX - 10;
  const shown = r.rows.slice(0, cat ? 24 : 18);
  const NAME = Math.min(190, Math.max(90, 6.2 * Math.max(...shown.map((g) => g.name.length)))), Q = 52;
  const BAR = (TW - NAME - Q) / r.groups.length;
  let ty = 40;
  if (cat && r.values) {
    // legend of the values, in order of frequency
    let lx = TX;
    r.values.forEach((val, i) => {
      out.push(`<rect x="${num(lx)}" y="${ty - 8}" width="9" height="9" fill="${valueColor(val, i, p)}"/>` +
        `<text x="${num(lx + 12)}" y="${ty}" font-size="9.5" fill="${p.ink}">${esc(val)}</text>`);
      lx += 22 + 6 * val.length;
    });
    ty += 14;
  }
  out.push(`<text x="${TX}" y="${ty}" font-size="10" fill="${p.muted}">${cat ? "entity" : "entity · mean"}</text>` +
    r.groups.map((n, i) => `<text x="${num(TX + NAME + i * BAR)}" y="${ty}" font-size="10" fill="${SERIES[i % SERIES.length]}">${esc(n.length > 18 ? n.slice(0, 17) + "…" : n)}</text>`).join("") +
    `<text x="${num(TX + NAME + r.groups.length * BAR + 6)}" y="${ty}" font-size="10" fill="${p.muted}">q</text>`);
  const top = ty + 10;
  const means = shown.flatMap((g) => g.cells.map((c) => c.mean ?? 0));
  const nonNeg = means.every((m) => m >= 0), maxMean = Math.max(1e-12, ...means.map(Math.abs));
  shown.forEach((g, i) => {
    const y = top + i * 17;
    out.push(`<text x="${TX}" y="${y + 9}" font-size="10.5" font-weight="600" fill="${p.ink}">${esc(g.name.length > 30 ? g.name.slice(0, 29) + "…" : g.name)}</text>`);
    g.cells.forEach((c, ci) => {
      const bx = TX + NAME + ci * BAR;
      if (cat) {
        // the cohort's mix of values as one 100% bar
        let x = bx;
        const w = BAR - 8;
        (r.values || []).forEach((val, vi) => {
          const n = c.values?.[val] || 0;
          if (!n || !c.n) return;
          const ww = w * n / c.n;
          out.push(`<rect x="${num(x)}" y="${y + 1}" width="${num(ww)}" height="10" fill="${valueColor(val, vi, p)}"><title>${esc(c.cohort + ": " + val + " " + n + "/" + c.n)}</title></rect>`);
          x += ww;
        });
      } else {
        const m = c.mean, w = nonNeg && m != null ? (BAR - 50) * m / maxMean : 0;
        if (nonNeg) out.push(`<rect x="${num(bx)}" y="${y + 1}" width="${num(Math.max(0.5, w))}" height="10" fill="${SERIES[ci % SERIES.length]}" opacity="0.85"/>`);
        out.push(`<text x="${num(bx + w + 3)}" y="${y + 9}" font-size="9" fill="${p.muted}">${m == null ? "—" : esc(m.toPrecision(3))}</text>`);
      }
    });
    out.push(`<text x="${num(TX + NAME + r.groups.length * BAR + 6)}" y="${y + 9}" font-size="9.5" fill="${g.q < 0.05 ? p.ink : p.muted}">${esc(g.q === 0 ? "<1e-300" : g.q < 1e-4 ? g.q.toExponential(0) : g.q.toFixed(3))}</text>`);
  });
  bottom = Math.max(bottom, top + shown.length * 17 + 6);
  if (r.tested > shown.length)
    out.push(`<text x="${TX}" y="${bottom + 4}" font-size="9" fill="${p.muted}">+${fmt(r.tested - shown.length)} more entities tested (the full table is in the result and the MCP text)</text>`);
  bottom += 14;
  const cap = caption(v.caveat || "", W, bottom, p.muted, Math.floor(W / 7.2));
  return frame(W, bottom + cap.height + 10, out.join("") + cap.svg, p.bg);
}

