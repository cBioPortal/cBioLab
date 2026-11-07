// Signatures figure: one patient's mutational signatures — each signature's contribution in each
// profiled sample as horizontal bars (a bar per sample, in sample order), and, where the study has
// the counts profile, one sample's mutational spectrum as a bar per channel grouped by class (the
// portal's Mutational Signatures tab). Browser-safe; laid out with lib/chart through lib/svg-kit.ts.
import type { DrawnResultOf } from "../../types.ts";
import { palette, frame, caption, label, textWidth, legend, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight, bandLabels,
  seriesStyle, textOn, fmtInt, esc, FS, SW, r1, type SvgOpts } from "../../svg-kit.ts";
import { SIGNIFICANT_P, pctText, spectrumUnit, versionLabel } from "./data.ts";
import type { SignaturesResult } from "./types.ts";

type Pal = ReturnType<typeof palette>;
const PAD = 8, GUT = 12;
/** signatures one figure draws at most; the table lists every one */
export const FIGURE_SIGNATURES = 40;
const BAR = 10, BAR_GAP = 2;

const sig = (v: { p: number | null }) => v.p != null && v.p < SIGNIFICANT_P;

/** The contribution bars: a row per signature with a contribution above zero in some profiled sample. */
function contributions(s: SignaturesResult, W: number, y0: number, p: Pal): { svg: string; y: number; left: number } {
  const out: string[] = [];
  const nS = s.profiled.length;
  const rows = s.signatures.filter((r) => r.values.some((v) => (v.value ?? 0) > 0));
  const drawn = rows.slice(0, FIGURE_SIGNATURES);
  let y = y0;
  out.push(label(PAD, y + FS.title, "Signature contributions", { size: FS.title, weight: 600, fill: p.ink }));
  y += FS.title + 8;
  if (nS > 1) {
    const sampleOf = (id: string) => s.patient!.samples.find((x) => x.id === id);
    const lg = legend(s.profiled.map((id, i) => ({ label: (sampleOf(id)?.label ?? "") + " · " + id, color: seriesStyle(i).color, opacity: seriesStyle(i).tint })), PAD, y, W - 2 * PAD, p, { size: FS.small });
    out.push(lg.svg); y += lg.height + 4;
  }
  if (!drawn.length) {
    out.push(label(PAD, y + FS.body, "No signature contributes above zero in any profiled sample.", { size: FS.body, fill: p.muted }));
    return { svg: out.join(""), y: y + FS.body + 8, left: 0 };
  }
  const labW = Math.min(Math.max(...drawn.map((r) => textWidth(r.name, FS.body))), Math.max(90, W * 0.3));
  const valW = textWidth("100% *", FS.small);
  const L = PAD + labW + GUT, R = W - PAD - valW;
  const max = Math.max(...drawn.flatMap((r) => r.values.map((v) => 100 * (v.value ?? 0))), 1);
  const xs = linear(0, max, L, R);
  const rowH = nS * (BAR + BAR_GAP) + 6;
  const top = y, bottom = top + drawn.length * rowH;
  for (const t of xs.ticks) out.push(`<line x1="${r1(xs(t))}" y1="${top}" x2="${r1(xs(t))}" y2="${bottom}" stroke="${p.line}" stroke-width="${SW.hair}"/>`);
  drawn.forEach((r, i) => {
    const ry = top + i * rowH;
    if (i % 2 === 0) out.push(`<rect x="${PAD / 2}" y="${ry}" width="${W - PAD}" height="${rowH}" fill="${p.line}" opacity="0.3"/>`);
    out.push(label(PAD, ry + rowH / 2 + FS.body * 0.35, r.name, { size: FS.body, fill: p.ink, maxW: labW, weight: r.values.some(sig) ? 600 : 400 }));
    r.values.forEach((v, j) => {
      const by = ry + 3 + j * (BAR + BAR_GAP);
      const st = nS > 1 ? seriesStyle(j) : seriesStyle(0);
      const w = v.value == null ? 0 : Math.max(v.value > 0 ? 1 : 0, xs(100 * v.value) - L);
      const tip = r.name + " in " + s.profiled[j] + ": " + (v.value == null ? "NA" : (100 * v.value).toFixed(1) + "%") + (v.p != null ? ", p = " + v.p.toPrecision(2) + (sig(v) ? " (significant)" : "") : "");
      if (w > 0) out.push(`<rect x="${r1(L)}" y="${r1(by)}" width="${r1(w)}" height="${BAR}" fill="${st.color}" fill-opacity="${st.tint}"><title>${esc(tip)}</title></rect>`);
      out.push(label(L + w + 3, by + BAR - 1.5, pctText(v.value) + (sig(v) ? " *" : ""), { size: FS.small, fill: v.value == null ? p.muted : p.ink }));
    });
  });
  out.push(axisBottom(xs, bottom, p, { title: "Contribution, % of the sample's mutations", minX: L - GUT, maxX: R + GUT, fmt: (t) => xs.fmt(t) + "%" }));
  y = bottom + bottomAxisHeight("x") + 4;
  return { svg: out.join(""), y, left: rows.length - drawn.length };
}

/** One sample's spectrum: a bar per channel, coloured and labelled by class. */
function spectrumChart(s: SignaturesResult, W: number, y0: number, p: Pal): { svg: string; y: number } {
  const sp = s.spectrum!, pct = s.scale === "percent";
  const out: string[] = [];
  let y = y0;
  out.push(label(PAD, y + FS.title, sp.sample + "'s mutational spectrum — " + fmtInt(sp.total) + " " + spectrumUnit(s.version || ""), { size: FS.title, weight: 600, fill: p.ink, maxW: W - 2 * PAD }));
  y += FS.title + 10;
  const val = (c: { count: number }) => pct ? (sp.total ? 100 * c.count / sp.total : 0) : c.count;
  // a count axis keeps whole-number ticks: at least 0 to 5
  const max = Math.max(...sp.channels.map(val), pct ? 1 : 5);
  const H = 180, stripH = FS.small + 6;
  const groups: { name: string; from: number; to: number }[] = [];
  sp.channels.forEach((c, i) => { const g = groups[groups.length - 1]; if (g && g.name === c.group) g.to = i; else groups.push({ name: c.group, from: i, to: i }); });
  const plotTop = y + stripH + 4;
  const ys = linear(0, max, plotTop + H, plotTop);
  const yTitle = pct ? "% of " + spectrumUnit(s.version || "") : "Mutations";
  const L = PAD + leftAxisWidth(ys, yTitle, (t) => ys.fmt(t)), R = W - PAD;
  const band = (R - L) / Math.max(1, sp.channels.length);
  const colorOf = new Map(groups.map((g, i) => [g.name, seriesStyle(i)]));
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: R }));
  groups.forEach((g) => {
    const st = colorOf.get(g.name)!;
    const x0 = L + g.from * band, x1 = L + (g.to + 1) * band;
    out.push(`<rect x="${r1(x0 + 0.5)}" y="${r1(y)}" width="${r1(Math.max(1, x1 - x0 - 1))}" height="${stripH}" fill="${st.color}" fill-opacity="${st.tint}"/>`);
    if (textWidth(g.name, FS.small) < x1 - x0 - 4) out.push(label((x0 + x1) / 2, y + stripH - 4, g.name, { size: FS.small, fill: st.tint < 1 ? p.ink : textOn(st.color), anchor: "middle", weight: 600 }));
  });
  sp.channels.forEach((c, i) => {
    const st = colorOf.get(c.group)!, v = val(c);
    const x = L + i * band + band * 0.1, w = Math.max(0.5, band * 0.8);
    const tip = c.label + ": " + fmtInt(c.count) + " of " + fmtInt(sp.total) + " (" + (sp.total ? (100 * c.count / sp.total).toFixed(1) : "0") + "%)";
    out.push(`<rect x="${r1(x)}" y="${r1(ys(v))}" width="${r1(w)}" height="${r1(Math.max(0, ys(0) - ys(v)))}" fill="${st.color}" fill-opacity="${st.tint}"><title>${esc(tip)}</title></rect>`);
  });
  out.push(`<line x1="${L}" y1="${r1(ys(0))}" x2="${R}" y2="${r1(ys(0))}" stroke="${p.muted}" stroke-width="${SW.line}"/>`);
  const bl = bandLabels(sp.channels.map((c) => c.label), sp.channels.map((_, i) => L + (i + 0.5) * band), band, ys(0) + 2, p, { maxH: 60, minX: 0 });
  out.push(bl.svg);
  return { svg: out.join(""), y: ys(0) + 2 + bl.height + 6 };
}

export function signaturesSvg(v: DrawnResultOf<"signatures">, o: SvgOpts & { caption?: boolean } = {}): string | null {
  const s = v.signatures;
  if (!s.patient || !s.version) return null;
  const p = palette(o.theme);
  const W = Math.max(420, o.width || 900);
  const out: string[] = [];
  const title = s.patient.id + " — " + versionLabel(s.version);
  out.push(label(PAD, 16, title, { size: FS.title, weight: 600, fill: p.ink, maxW: W - 2 * PAD }));
  let y = 28;
  const c = contributions(s, W, y, p);
  out.push(c.svg); y = c.y + 8;
  if (s.spectrum) { const sc = spectrumChart(s, W, y, p); out.push(sc.svg); y = sc.y + 4; }
  const anySig = s.signatures.some((r) => r.values.some(sig));
  const note = (c.left ? c.left + " more signatures with a contribution above zero are listed in the table but not drawn (the figure draws " + FIGURE_SIGNATURES + "). " : "") +
    (s.profiles?.pvalue ? (anySig ? "* and bold: significant, p < " + SIGNIFICANT_P + " in " + s.profiles.pvalue + ". " : "No value is significant (p < " + SIGNIFICANT_P + "). ")
      : "The study records no p-values for these signatures, so none is marked significant. ") +
    (s.notProfiled.length ? "Not profiled for mutational signatures: " + s.notProfiled.join(", ") + ". " : "") +
    (s.spectrum ? "Spectrum " + (s.scale === "percent" ? "as each channel's share of the sample's " + spectrumUnit(s.version) : "as counts") + "; the counts may include silent and non-coding mutations." : s.noSpectrum ? s.noSpectrum + "." : "");
  if (o.caption !== false) { const cap = caption(note, W, y, p.muted); out.push(cap.svg); y += cap.height; }
  return frame(W, y + 6, out.join(""), p.bg, false, title);
}
