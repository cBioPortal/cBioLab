// The mutexpr view's figure: per stratum, one row per group — a box from the quartiles, whiskers at
// the 5th and 95th percentiles, the median as a bar and the mean as a dot — on one value scale shared
// by every stratum, with each group's size and its difference from "Not mutated" beside it.
import {
  esc, palette, frame, caption, linear, axisBottom, bottomAxisHeight, label, textWidth, legend,
  fmtInt, fmtNum, fmtQ, FS, SW, OTHER, r1, type SvgOpts
} from "../../svg-kit.ts";
import { MUT } from "../../figures/common.ts";
import { titleLine, sentence } from "../../figures/bars.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { MutexprGroup } from "./types.ts";

const ROW = 22, HEAD = 22, GAP = 10, PAD = 8, GUT = 14, MIN_PLOT = 180;
/** "All mutated" is drawn darker than the groups it sums */
const ALL = "#1f6b3a";

const fill = (g: MutexprGroup) => g.role === "allMutated" ? ALL : g.role === "notMutated" || g.role === "notProfiled" ? OTHER : MUT;
const sizeText = (g: MutexprGroup, k: number) => g.n == null ? "< " + k : fmtInt(g.n);
const diffText = (g: MutexprGroup) => g.diff == null || g.q == null ? "" : (g.diff > 0 ? "+" : "") + fmtNum(g.diff, 2) + " · " + fmtQ(g.q);

export function mutexprSvg(v: DrawnResultOf<"mutexpr">, o: SvgOpts): string {
  const m = v.mutexpr, p = palette(o.theme);
  const panels = m.strata;
  const all = panels.flatMap((s) => s.groups);
  const k = m.minCount;
  let W = Math.max(380, o.width || 720);
  const labW0 = Math.max(0, ...all.map((g) => textWidth(g.label, FS.body)), ...panels.map((s) => panels.length > 1 ? textWidth(s.label, FS.body, 600) * 0.5 : 0));
  const nW = Math.max(textWidth("n", FS.small), ...all.map((g) => textWidth(sizeText(g, k), FS.small)));
  const dHead = "Δ mean vs not mutated";
  const dW = Math.max(textWidth(dHead, FS.small), ...all.map((g) => textWidth(diffText(g), FS.small)));
  const labW = () => Math.min(labW0, Math.max(90, W * 0.3));
  const need = 2 * PAD + labW() + GUT + MIN_PLOT + GUT + nW + GUT + dW;
  const grown = need > W;
  if (grown) W = Math.ceil(need);
  const L = PAD + labW() + GUT, R = W - PAD - dW - GUT - nW - GUT;
  const xN = R + GUT + nW, xD = W - PAD;

  const drawn = all.filter((g) => g.n != null);
  const lo = Math.min(...drawn.map((g) => g.p5 ?? Infinity), ...drawn.map((g) => g.mean ?? Infinity));
  const hi = Math.max(...drawn.map((g) => g.p95 ?? -Infinity), ...drawn.map((g) => g.mean ?? -Infinity));
  const xs = linear(Number.isFinite(lo) ? lo : m.range[0], Number.isFinite(hi) ? hi : m.range[1], L, R);
  const [d0, d1] = xs.domain;
  const X = (x: number) => xs(Math.max(d0, Math.min(d1, x)));

  const out: string[] = [];
  const title = m.expressionGene + " expression by " + m.gene + " " + (m.resolution === "codon" ? "codon" : "protein change");
  const t = titleLine(title, W, p);
  out.push(t.svg);
  let y = t.y;
  const lg = legend([{ label: "mutated group", color: MUT }, { label: "all mutated", color: ALL }, { label: "not mutated / not profiled", color: OTHER }], PAD, y, W - 2 * PAD, p, { size: FS.small });
  out.push(lg.svg);
  y += lg.height + 6;
  out.push(label(xN, y + FS.small, "n", { size: FS.small, fill: p.muted, anchor: "end" }));
  out.push(label(xD, y + FS.small, dHead, { size: FS.small, fill: p.muted, anchor: "end" }));
  y += FS.small + 6;
  const top = y;
  const body: string[] = [];
  panels.forEach((s, si) => {
    if (si) y += GAP;
    if (panels.length > 1 || s.label !== "All samples") {
      body.push(label(PAD, y + 15, s.label + " · " + fmtInt(s.n) + " samples", { size: FS.body, fill: p.ink, weight: 600, maxW: W - 2 * PAD }));
      y += HEAD;
    }
    const ref = s.groups.find((g) => g.role === "notMutated" && g.n != null);
    const rows0 = y;
    s.groups.forEach((g, i) => {
      const cy = y + ROW / 2, ty = cy + FS.body * 0.35;
      if (i % 2 === 0) body.push(`<rect x="${PAD / 2}" y="${y}" width="${W - PAD}" height="${ROW}" fill="${p.line}" opacity="0.3"/>`);
      const muted = g.n == null || g.role === "notProfiled";
      body.push(label(PAD + (g.role === "variant" ? 8 : 0), ty, g.label, { size: FS.body, fill: muted ? p.muted : p.ink, weight: g.role === "allMutated" ? 600 : 400, maxW: labW() - (g.role === "variant" ? 8 : 0) }));
      if (g.n != null && g.q1 != null && g.q3 != null && g.median != null) {
        const c = fill(g), h = 12;
        const tip = g.label + (panels.length > 1 ? " — " + s.label : "") + "\nn = " + fmtInt(g.n) + "\nmean " + fmtNum(g.mean!, 3) + (g.sd != null ? " (SD " + fmtNum(g.sd, 3) + ")" : "") +
          "\nmedian " + fmtNum(g.median, 3) + ", IQR " + fmtNum(g.q1, 3) + "–" + fmtNum(g.q3, 3) + "\n5th–95th percentile " + fmtNum(g.p5!, 3) + "–" + fmtNum(g.p95!, 3) +
          (g.diff != null ? "\nvs not mutated: " + (g.diff > 0 ? "+" : "") + fmtNum(g.diff, 3) + ", Welch t " + fmtNum(g.t!, 3) + ", p " + fmtNum(g.p!, 2) + ", " + fmtQ(g.q!) : "") +
          (g.pooled ? "\npools " + (g.pooled.small ? fmtInt(g.pooled.small) + " with fewer than " + k + " samples" : "") + (g.pooled.small && g.pooled.beyondCap ? " and " : "") + (g.pooled.beyondCap ? fmtInt(g.pooled.beyondCap) + " beyond the largest drawn" : "") : "");
        body.push(`<g><title>${esc(tip)}</title>` +
          `<line x1="${r1(X(g.p5!))}" y1="${cy}" x2="${r1(X(g.p95!))}" y2="${cy}" stroke="${c}" stroke-width="${SW.line}"/>` +
          `<line x1="${r1(X(g.p5!))}" y1="${cy - 4}" x2="${r1(X(g.p5!))}" y2="${cy + 4}" stroke="${c}" stroke-width="${SW.line}"/>` +
          `<line x1="${r1(X(g.p95!))}" y1="${cy - 4}" x2="${r1(X(g.p95!))}" y2="${cy + 4}" stroke="${c}" stroke-width="${SW.line}"/>` +
          `<rect x="${r1(X(g.q1))}" y="${r1(cy - h / 2)}" width="${r1(Math.max(1.5, X(g.q3) - X(g.q1)))}" height="${h}" fill="${c}" fill-opacity="${g.role === "notProfiled" ? 0.25 : 0.45}" stroke="${c}" stroke-width="${SW.line}"${g.role === "notProfiled" ? ` stroke-dasharray="3 2"` : ""}/>` +
          `<line x1="${r1(X(g.median))}" y1="${r1(cy - h / 2)}" x2="${r1(X(g.median))}" y2="${r1(cy + h / 2)}" stroke="${p.ink}" stroke-width="${SW.series}"/>` +
          `<circle cx="${r1(X(g.mean!))}" cy="${cy}" r="2.5" fill="${p.bg}" stroke="${p.ink}" stroke-width="${SW.line}"/></g>`);
      } else if (g.n == null) {
        body.push(label((L + R) / 2, ty, "withheld: fewer than " + k + " samples", { size: FS.small, fill: p.muted, anchor: "middle" }));
      }
      body.push(label(xN, cy + FS.small * 0.35, sizeText(g, k), { size: FS.small, fill: muted ? p.muted : p.ink, anchor: "end" }));
      const dt = diffText(g);
      if (dt) body.push(label(xD, cy + FS.small * 0.35, dt, { size: FS.small, fill: g.q! < 0.05 ? p.ink : p.muted, anchor: "end", weight: g.q! < 0.05 ? 600 : 400 }));
      y += ROW;
    });
    // the "Not mutated" median through the stratum's rows, the line every group is read against
    if (ref && ref.median != null) body.push(`<line x1="${r1(X(ref.median))}" y1="${rows0}" x2="${r1(X(ref.median))}" y2="${y}" stroke="${p.muted}" stroke-width="${SW.line}" stroke-dasharray="3 3"/>`);
    if (s.untested) { body.push(label(PAD, y + 13, s.untested, { size: FS.small, fill: p.muted, maxW: W - 2 * PAD })); y += 18; }
  });
  for (const tk of xs.ticks) out.push(`<line x1="${r1(xs(tk))}" y1="${top}" x2="${r1(xs(tk))}" y2="${y}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
  out.push(...body);
  out.push(axisBottom(xs, y, p, { title: m.valueLabel, minX: L - GUT, maxX: R + GUT }));
  y += bottomAxisHeight(m.valueLabel) + 8;
  const note = sentence(v.note || "") + (v.note ? " " : "") + "Box: quartiles; whiskers: 5th–95th percentile; bar: median; dot: mean; dashed line: the “Not mutated” median. " +
    "Δ is each group's mean minus “Not mutated”'s in its stratum, with Welch's q. Groups and strata with fewer than " + k + " samples are withheld." +
    (m.withheldStrata ? " " + fmtInt(m.withheldStrata) + " strat" + (m.withheldStrata === 1 ? "um is" : "a are") + " withheld whole." : "");
  const cap = caption(note, W, y, p.muted);
  return frame(W, y + cap.height + 8, out.join("") + cap.svg, p.bg, grown, title);
}
