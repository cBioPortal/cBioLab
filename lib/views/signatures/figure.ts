// Signatures figure: one patient's mutational signatures — where the study has the counts profile,
// one sample's mutational spectrum drawn as the portal's Mutational Signatures tab draws it (class
// bands, a bar per channel in its class's colour, coloured channel labels, and a chosen signature's
// COSMIC reference profile mirrored underneath); then each signature's contribution in each profiled
// sample as horizontal bars (a bar per sample, in sample order). Browser-safe; laid out with lib/chart through lib/svg-kit.ts.
import type { DrawnResultOf } from "../../types.ts";
import { palette, frame, caption, label, textWidth, legend, linear, axisLeft, axisBottom, leftAxisWidth, bottomAxisHeight,
  seriesStyle, textOn, fmtInt, esc, FS, SW, r1, type Scale, type SvgOpts } from "../../svg-kit.ts";
import { SIGNIFICANT_P, YMAX_MAX, channelColor, channelTick, countAxisMax, countLabel, indelBox, pctText, percentAxisMax, referenceAxisMax, referenceTick,
  spectrumAxisTitle, spectrumTick, spectrumUnit, versionLabel } from "./data.ts";
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

/** a scale with a tick at the end of its domain too, as the portal rounds its axes so the "≥" label always has one */
function withTop(s: Scale): Scale {
  const end = s.domain[1];
  if (s.ticks.includes(end)) return s;
  // a regular tick too close to the end would print over its label
  const keep = s.ticks.filter((t) => end - t >= 0.1 * (end - s.domain[0]));
  s.ticks.splice(0, s.ticks.length, ...keep, end);
  return s;
}

/**
 * One sample's spectrum as the portal draws it: a coloured band per class above the bars, a bar per
 * channel in its class's colour on a fixed axis (0–100% or the counts, cut at the Y-axis Max), the
 * channels' labels under it with the mutated base coloured, and — once a signature is chosen — that
 * signature's COSMIC reference profile drawn downward beneath, on its own percent axis.
 */
function spectrumChart(s: SignaturesResult, W: number, y0: number, p: Pal, head: boolean): { svg: string; y: number } {
  const sp = s.spectrum!, pct = s.scale === "percent", ver = s.version || "";
  const out: string[] = [];
  let y = y0;
  if (head) {
    out.push(label(PAD, y + FS.title, "Sample: " + sp.sample + " | " + countLabel(ver) + " count: " + sp.total, { size: FS.title, weight: 600, fill: p.ink, maxW: W - 2 * PAD }));
    y += FS.title + 10;
  }
  const val = (c: { count: number }) => pct ? (sp.total ? 100 * c.count / sp.total : 0) : c.count;
  const max = pct ? percentAxisMax(s.ymax) : countAxisMax(Math.max(0, ...sp.channels.map((c) => c.count)), s.ymax);
  const H = 220;
  const yTitle = spectrumAxisTitle(ver, s.scale);
  const fmtTop = (t: number) => spectrumTick(t, max, s.scale);
  const ref = s.reference, refMax = referenceAxisMax(s.scale, s.ymax);
  const refTitle = ref ? ["COSMIC Reference", ref.signature + " (%)"] : [];
  const fmtRef = (t: number) => referenceTick(t, refMax);
  const probeTop = linear(0, max, H, 0, { nice: false }), probeRef = linear(0, refMax, 0, H, { nice: false });
  const L = PAD + Math.max(leftAxisWidth(probeTop, yTitle, fmtTop), ref ? leftAxisWidth(probeRef, "x", fmtRef) + FS.body + 2 : 0), R = W - PAD;
  const n = Math.max(1, sp.channels.length), band = (R - L) / n;
  const cx = (i: number) => L + (i + 0.5) * band;
  const barW = Math.max(1, band * 0.45);
  const colors = sp.channels.map((c) => channelColor(c.label));
  // the class bands: a box per class (per class and sub-class for ID), the class's name above
  const runs = (key: (i: number) => string) => {
    const r: { key: string; from: number; to: number }[] = [];
    sp.channels.forEach((_, i) => { const k = key(i), g = r[r.length - 1]; if (g && g.key === k) g.to = i; else r.push({ key: k, from: i, to: i }); });
    return r;
  };
  const groups = runs((i) => sp.channels[i].group);
  const boxes = runs((i) => sp.channels[i].group + "|" + (indelBox(sp.channels[i].label)?.box ?? ""));
  const isId = sp.channels.some((c) => indelBox(c.label));
  const stripH = FS.body + 8;
  const boxSvg = (yy: number, withText: boolean) => boxes.map((b) => {
    const x0 = L + b.from * band + 0.5, x1 = L + (b.to + 1) * band - 0.5, sub = indelBox(sp.channels[b.from].label)?.box;
    return `<rect x="${r1(x0)}" y="${r1(yy)}" width="${r1(Math.max(1, x1 - x0))}" height="${stripH}" fill="${colors[b.from]}"/>` +
      (withText && sub && textWidth(sub, FS.small) < x1 - x0 ? label((x0 + x1) / 2, yy + stripH / 2 + FS.small * 0.35, sub, { size: FS.small, weight: 700, fill: textOn(colors[b.from]), anchor: "middle" }) : "");
  }).join("");
  groups.forEach((g) => {
    const x0 = L + g.from * band, x1 = L + (g.to + 1) * band;
    out.push(label((x0 + x1) / 2, y + FS.body, g.key, { size: FS.body, weight: 700, fill: p.ink, anchor: "middle", maxW: x1 - x0 }));
  });
  y += FS.body + 4;
  out.push(boxSvg(y, true));
  y += stripH + 10;
  // the sample's bars
  const ys = withTop(linear(0, max, y + H, y, { nice: false }));
  out.push(axisLeft(ys, L, p, { title: yTitle, gridTo: R, fmt: fmtTop, line: true }));
  sp.channels.forEach((c, i) => {
    const v = Math.min(val(c), max);
    const tip = c.label + ": " + fmtInt(c.count) + " of " + fmtInt(sp.total) + " " + spectrumUnit(ver) + " (" + (sp.total ? (100 * c.count / sp.total).toFixed(1) : "0") + "%)" + (val(c) > max ? ", past the axis" : "");
    out.push(`<rect x="${r1(cx(i) - barW / 2)}" y="${r1(ys(v))}" width="${r1(barW)}" height="${r1(Math.max(0, ys(0) - ys(v)))}" fill="${colors[i]}"><title>${esc(tip)}</title></rect>`);
  });
  y = ys(0) + 4;
  // the channels' labels: SBS's mutated base in its class's colour, read upward; ID's counts level
  const ticks = sp.channels.map((c) => channelTick(c.label));
  if (isId) {
    ticks.forEach((t, i) => out.push(label(cx(i), y + FS.small, t.text, { size: FS.small, fill: p.ink, anchor: "middle" })));
    y += FS.small + 6;
    out.push(boxSvg(y, false));
    y += stripH + 2;
    groups.forEach((g) => {
      const x0 = L + g.from * band, x1 = L + (g.to + 1) * band;
      out.push(label((x0 + x1) / 2, y + FS.body, indelBox(sp.channels[g.from].label)!.title, { size: FS.body, weight: 700, fill: p.ink, anchor: "middle", maxW: x1 - x0 }));
    });
    y += FS.body + 14;
  } else {
    const tickH = Math.max(...ticks.map((t) => textWidth(t.text, FS.small))) + 2;
    const by = y + tickH;
    ticks.forEach((t, i) => {
      const x = r1(cx(i));
      const body = t.colored == null ? esc(t.text)
        : esc(t.text.slice(0, t.colored)) + `<tspan fill="${colors[i]}">${esc(t.text.charAt(t.colored))}</tspan>` + esc(t.text.slice(t.colored + 1));
      out.push(`<text x="${x}" y="${r1(by)}" font-size="${FS.small}" fill="${p.ink}" dominant-baseline="middle" transform="rotate(-90 ${x} ${r1(by)})">${body}</text>`);
    });
    y = by + 6;
  }
  if (ref) {
    const rs = withTop(linear(0, refMax, y, y + H, { nice: false }));
    out.push(axisLeft(rs, L, p, { gridTo: R, fmt: fmtRef, line: true }));
    const tx = L - leftAxisWidth(rs, "x", fmtRef) + FS.body * 0.8 - FS.body - 2, ty = y + H / 2;
    refTitle.forEach((t, k) => out.push(label(tx + k * (FS.body + 2), ty, t, { size: FS.body, fill: p.ink, anchor: "middle", rotate: -90, maxW: H })));
    ref.values.forEach((v, i) => {
      const c = sp.channels[i], h = Math.max(0, rs(Math.min(v, refMax)) - rs(0));
      const tip = ref.key + " · " + c.label + ": " + v.toFixed(2) + "% of the signature's mutations (" + ref.source + ")";
      out.push(`<rect x="${r1(cx(i) - barW / 2)}" y="${r1(rs(0))}" width="${r1(barW)}" height="${r1(h)}" fill="${colors[i]}"><title>${esc(tip)}</title></rect>`);
    });
    y += H + 6;
  }
  return { svg: out.join(""), y };
}

/**
 * The figure: the spectrum (with the reference profile under it once a signature is chosen) and then
 * each signature's contribution. `spectrumHead: false` leaves out the spectrum's "Sample: … count: …"
 * line, for a page that writes it above the figure.
 */
export function signaturesSvg(v: DrawnResultOf<"signatures">, o: SvgOpts & { caption?: boolean; spectrumHead?: boolean } = {}): string | null {
  const s = v.signatures;
  if (!s.patient || !s.version) return null;
  const p = palette(o.theme);
  const W = Math.max(420, o.width || 900);
  const out: string[] = [];
  const title = s.patient.id + " — " + versionLabel(s.version);
  out.push(label(PAD, 16, title, { size: FS.title, weight: 600, fill: p.ink, maxW: W - 2 * PAD }));
  let y = 28;
  if (s.spectrum) { const sc = spectrumChart(s, W, y, p, o.spectrumHead !== false); out.push(sc.svg); y = sc.y + 12; }
  const c = contributions(s, W, y, p);
  out.push(c.svg); y = c.y + 8;
  const anySig = s.signatures.some((r) => r.values.some(sig));
  const note = (c.left ? c.left + " more signatures with a contribution above zero are listed in the table but not drawn (the figure draws " + FIGURE_SIGNATURES + "). " : "") +
    (s.profiles?.pvalue ? (anySig ? "* and bold: significant, p < " + SIGNIFICANT_P + " in " + s.profiles.pvalue + ". " : "No value is significant (p < " + SIGNIFICANT_P + "). ")
      : "The study records no p-values for these signatures, so none is marked significant. ") +
    (s.notProfiled.length ? "Not profiled for mutational signatures: " + s.notProfiled.join(", ") + ". " : "") +
    (s.spectrum ? "Spectrum " + (s.scale === "percent" ? "as each channel's share of the sample's " + spectrumUnit(s.version) : "as counts") + "; the counts may include silent and non-coding mutations." +
      (s.ymax < YMAX_MAX ? " Y-axis Max " + s.ymax + ": a bar past the axis stops at it (≥ on the axis)." : "") +
      (s.reference ? " Below: " + s.reference.key + "'s reference profile, " + s.reference.source + ", each channel's percent of the signature's mutations." : "")
      : s.noSpectrum ? s.noSpectrum + "." : "");
  if (o.caption !== false) { const cap = caption(note, W, y, p.muted); out.push(cap.svg); y += cap.height; }
  return frame(W, y + 6, out.join(""), p.bg, false, title);
}
