// Exclusivity figure: a gene × gene triangle, each pair coloured by the direction DISCOVER finds and
// shaded by its q, then the most significant pairs set against the plain Fisher test.
import {
  esc, palette, frame, caption, legend, label, textWidth, fmtInt, fmtNum, pDigits, textOn, FS, SW, SERIES, type SvgOpts
} from "../svg-kit.ts";
import type { DrawnResultOf, ExclusivityPair } from "../types.ts";

const PAD = 8, GUT = 12, ROW = 18, TABLE_MAX = 12;

const direction = (x: ExclusivityPair): "exclusive" | "co-occurring" => x.qExclusive <= x.qCooccur ? "exclusive" : "co-occurring";
const qOf = (x: ExclusivityPair) => Math.min(x.qExclusive, x.qCooccur);

export function exclusivitySvg(v: DrawnResultOf<"exclusivity">, o: SvgOpts): string {
  const p = palette(o.theme), r = v.exclusivity;
  const EXCL = SERIES[0], COOC = SERIES[1];
  let W = Math.max(420, o.width || 960);
  const n = r.genes.length;
  const labW = Math.max(...r.genes.map((g) => textWidth(g, FS.body, 600))) + GUT;
  const cell = Math.max(18, Math.min(46, Math.floor((Math.min(W, 760) - 2 * PAD - labW) / Math.max(1, n - 1))));
  const byPair = new Map(r.pairs.map((x) => [x.a + "|" + x.b, x]));
  const pairOf = (a: string, b: string) => byPair.get(a + "|" + b) || byPair.get(b + "|" + a);

  // the table's columns, measured, so a narrow figure grows rather than overprints
  const rows = r.pairs.slice(0, TABLE_MAX);
  const cols: { head: string; text: (x: ExclusivityPair) => string; w: number; start?: boolean }[] = [
    { head: "pair", text: (x) => x.a + " / " + x.b, w: 0, start: true },
    { head: "both", text: (x) => fmtInt(x.both), w: 0 },
    { head: "expected", text: (x) => fmtNum(x.expected), w: 0 },
    { head: "profiled", text: (x) => fmtInt(x.profiled), w: 0 },
    { head: "DISCOVER q", text: (x) => pDigits(qOf(x)) + " " + direction(x), w: 0, start: true },
    { head: "Fisher q", text: (x) => pDigits(x.fisherQ) + ((x.log2Odds ?? 0) < 0 ? " exclusive" : (x.log2Odds ?? 0) > 0 ? " co-occurring" : ""), w: 0, start: true }
  ];
  cols.forEach((c, k) => { c.w = Math.max(textWidth(c.head, FS.small), ...rows.map((x) => textWidth(c.text(x), FS.small, k === 4 ? 600 : 400))); });
  const tableW = 2 * PAD + cols.reduce((s, c) => s + c.w + GUT, 0);
  const triW = 2 * PAD + labW + (n - 1) * cell;
  const grown = Math.max(tableW, triW) > W;
  if (grown) W = Math.ceil(Math.max(tableW, triW));

  const out: string[] = [];
  let y = 4;
  const lg = legend([{ label: "mutually exclusive", color: EXCL }, { label: "co-occurring", color: COOC }], PAD, y, W - 2 * PAD, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height + 2;
  out.push(label(PAD, y + FS.small, "darker = smaller DISCOVER q; outlined = q < 0.05; the number is the q", { size: FS.small, fill: p.muted, maxW: W - 2 * PAD }));
  y += FS.small + 8;

  // lower triangle: row i (genes 1…n−1) against column j < i
  const x0 = PAD + labW, top = y;
  for (let i = 1; i < n; i++) {
    const cy = top + (i - 1) * cell;
    out.push(label(x0 - GUT / 2, cy + cell / 2 + FS.body * 0.35, r.genes[i], { size: FS.body, weight: 600, fill: p.ink, anchor: "end" }));
    for (let j = 0; j < i; j++) {
      const cx = x0 + j * cell, x = pairOf(r.genes[i], r.genes[j]);
      if (!x) {
        out.push(`<rect x="${cx + 1}" y="${cy + 1}" width="${cell - 2}" height="${cell - 2}" fill="none" stroke="${p.line}" stroke-width="${SW.hair}"><title>${esc(r.genes[i] + " / " + r.genes[j] + " — never profiled together")}</title></rect>`);
        continue;
      }
      const q = qOf(x), col = direction(x) === "exclusive" ? EXCL : COOC;
      const shade = Math.max(0.08, Math.min(1, -Math.log10(Math.max(q, 1e-300)) / 6));
      const tip = x.a + " / " + x.b + " — " + fmtInt(x.both) + " altered in both of " + fmtInt(x.profiled) + " profiled, " + fmtNum(x.expected) +
        " expected from each tumour's burden; DISCOVER exclusivity q " + pDigits(x.qExclusive) + ", co-occurrence q " + pDigits(x.qCooccur) + "; Fisher q " + pDigits(x.fisherQ);
      out.push(`<rect x="${cx + 1}" y="${cy + 1}" width="${cell - 2}" height="${cell - 2}" fill="${col}" fill-opacity="${shade.toFixed(2)}"` +
        (q < 0.05 ? ` stroke="${p.ink}" stroke-width="${SW.line}"` : "") + `><title>${esc(tip)}</title></rect>`);
      const t = pDigits(q);
      if (textWidth(t, FS.small) + 4 <= cell - 2) out.push(label(cx + cell / 2, cy + cell / 2 + FS.small * 0.35, t, { size: FS.small, fill: shade > 0.5 ? textOn(col) : p.ink, anchor: "middle" }));
    }
  }
  // column labels under the triangle, turned when the cells are narrower than the names
  const ly = top + (n - 1) * cell + 4;
  const widest = Math.max(...r.genes.slice(0, n - 1).map((g) => textWidth(g, FS.body, 600)));
  const turn = widest + 4 > cell;
  for (let j = 0; j < n - 1; j++) {
    const cx = x0 + j * cell + cell / 2;
    out.push(turn
      ? `<text x="${cx}" y="${ly}" font-size="${FS.body}" font-weight="600" fill="${p.ink}" text-anchor="end" transform="rotate(-90 ${cx} ${ly})" dy="0.35em">${esc(r.genes[j])}</text>`
      : label(cx, ly + FS.body, r.genes[j], { size: FS.body, weight: 600, fill: p.ink, anchor: "middle" }));
  }
  y = ly + (turn ? widest : FS.body) + 14;

  // the most significant pairs, DISCOVER beside Fisher
  out.push(label(PAD, y + FS.body, "Most significant pairs (" + fmtInt(Math.min(TABLE_MAX, r.pairs.length)) + " of " + fmtInt(r.pairs.length) + ")", { size: FS.body, weight: 600, fill: p.ink }));
  y += FS.body + 6;
  let cx = PAD;
  const xs: number[] = [];
  for (const c of cols) { xs.push(c.start ? cx : cx + c.w); cx += c.w + GUT; }
  cols.forEach((c, k) => out.push(label(xs[k], y + FS.small, c.head, { size: FS.small, fill: p.muted, anchor: c.start ? "start" : "end" })));
  y += FS.small + 4;
  rows.forEach((x, i) => {
    if (i % 2 === 0) out.push(`<rect x="${PAD / 2}" y="${y}" width="${tableW - PAD}" height="${ROW}" fill="${p.line}" opacity="0.3"/>`);
    const sig = qOf(x) < 0.05;
    cols.forEach((c, k) => out.push(label(xs[k], y + ROW / 2 + FS.small * 0.35, c.text(x), { size: FS.small, fill: sig || k === 0 ? p.ink : p.muted, anchor: c.start ? "start" : "end", weight: k === 4 && sig ? 600 : 400 })));
    y += ROW;
  });
  y += 8;
  const cap = caption(v.caveat || "", W, y, p.muted);
  return frame(W, y + cap.height + 10, out.join("") + cap.svg, p.bg, grown, "Mutual exclusivity (DISCOVER) — " + r.cohort);
}
