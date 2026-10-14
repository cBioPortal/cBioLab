// The plot view: a density field for a scatter, boxes for a numeric axis grouped by a categorical
// one, a shaded contingency for two categoricals.
import type { ViewResult, PlotData } from "../types.ts";
import { isAbsent, jitterFor } from "../plot-draw.ts";
import { HIGHLIGHT_BASE } from "../plot-highlight.ts";
import { esc, SERIES, palette, num, fmt, pFmt, frame, caption, type SvgOpts } from "../svg-kit.ts";

/**
 * A plot, from the aggregated contract: a density field for a scatter, boxes for a numeric
 * axis grouped by a categorical one, a shaded contingency for two categoricals.
 *
 * Nothing here has ever seen a point. The cells, the quartiles and the coefficients arrive
 * already computed, which is why the same picture draws for a hundred cases or four hundred
 * thousand.
 */
export function plotSvg(v: ViewResult, o: SvgOpts): string {
  const d = v.plot as PlotData | undefined;
  if (!d) return "";
  const p = palette(o.theme), W = o.width || 960;
  const L = 60, R = 14, T = 16, PLOT = 300;
  const plotW = W - L - R;
  const out: string[] = [];
  const axisText = (t: string, x: number, y: number, anchor = "middle", size = 11) =>
    `<text x="${num(x)}" y="${num(y)}" font-size="${size}" fill="${p.muted}" text-anchor="${anchor}">${esc(t)}</text>`;
  // With highlights the plotted cohort is the background: grey, so each highlight's colour reads
  const hs = d.highlights || [];
  const base = hs.length ? HIGHLIGHT_BASE : SERIES[0];
  const drawnHs = hs.filter((h) => h.shown !== "none");
  /** one row of highlight chips from x0 at y, wrapping inside `right`; returns the row's last y */
  const highlightKey = (x0: number, y: number, right: number): number => {
    if (!drawnHs.length) return y;
    out.push(`<text x="${x0}" y="${num(y)}" font-size="9" fill="${p.muted}">highlighted</text>`);
    let kx = x0 + 58;
    for (const h of drawnHs) {
      const label = h.name + " (" + fmt(h.n) + ")";
      const w = 16 + label.length * 5.4;
      if (kx + w > right) { kx = x0 + 58; y += 14; }
      out.push(`<circle cx="${num(kx + 4)}" cy="${num(y - 3)}" r="3.8" fill="${h.color}" stroke="${p.bg}" stroke-width="0.8"/>` +
        `<text x="${num(kx + 11)}" y="${num(y)}" font-size="9" fill="${p.ink}">${esc(label)}</text>`);
      kx += w;
    }
    return y;
  };

  if (d.shape === "scatter" && d.bins && d.extent && d.grid) {
    const { x0, x1, y0, y1 } = d.extent, [gx, gy] = d.grid;
    const maxN = Math.max(1, ...d.bins.map((b) => b.n));
    const cw = plotW / gx, ch = PLOT / gy;
    // a log ramp, because a linear one hides everything but the mode — said on the figure
    const shade = (n: number) => Math.min(1, 0.18 + 0.82 * Math.log1p(n) / Math.log1p(maxN));
    const cell = (b: { bx: number; by: number }, fill: string, opacity: number) =>
      `<rect x="${num(L + b.bx * cw)}" y="${num(T + PLOT - (b.by + 1) * ch)}" width="${num(Math.max(cw, 0.8))}" ` +
      `height="${num(Math.max(ch, 0.8))}" fill="${fill}" fill-opacity="${num(opacity)}"/>`;
    // under highlights the plotted cohort is a floor-raised grey, so its faintest cells still read
    for (const b of d.bins) out.push(cell(b, base, hs.length ? 0.3 + 0.7 * shade(b.n) : shade(b.n)));
    const sx = (xv: number) => L + plotW * (xv - x0) / Math.max(1e-9, x1 - x0);
    const sy = (yv: number) => T + PLOT - PLOT * (yv - y0) / Math.max(1e-9, y1 - y0);
    // a highlight too large to draw as points is cells on the same grid, shaded by its own densest cell
    for (const h of hs) if (h.shown === "density" && h.bins) {
      const hMax = Math.max(1, ...h.bins.map((b) => b.n));
      for (const b of h.bins) out.push(cell(b, h.color, 0.3 + 0.7 * Math.log1p(b.n) / Math.log1p(hMax)));
    }
    const nPts = hs.reduce((a, h) => a + (h.shown === "points" ? h.points!.length : 0), 0);
    const rPt = Math.max(1.6, Math.min(3.6, 70 / Math.sqrt(Math.max(1, nPts))));
    for (const h of hs) if (h.shown === "points") for (const pt of h.points!) if ("x" in pt)
      out.push(`<circle cx="${num(sx(pt.x))}" cy="${num(sy(pt.y))}" r="${num(rPt)}" fill="${h.color}" fill-opacity="0.9" ` +
        `stroke="${p.bg}" stroke-width="0.6"/>`);
    // the fitted line, over every case rather than over what is visible
    const st = d.stats;
    if (st && st.slope != null && st.intercept != null && x1 > x0) {
      const yAt = (xv: number) => st.intercept! + st.slope! * xv;
      const ya = Math.max(y0, Math.min(y1, yAt(x0))), yb = Math.max(y0, Math.min(y1, yAt(x1)));
      out.push(`<line x1="${num(sx(x0))}" y1="${num(sy(ya))}" x2="${num(sx(x1))}" y2="${num(sy(yb))}" ` +
        `stroke="${hs.length ? p.ink : SERIES[4]}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    }
    out.push(`<rect x="${L}" y="${T}" width="${num(plotW)}" height="${PLOT}" fill="none" stroke="${p.line}"/>`);
    out.push(axisText(num(x0), L, T + PLOT + 14, "start"), axisText(num(x1), L + plotW, T + PLOT + 14, "end"));
    out.push(axisText(num(y0), L - 6, T + PLOT, "end"), axisText(num(y1), L - 6, T + 10, "end"));
    if (st) {
      const line = (st.pearson != null ? "Pearson " + num(st.pearson) + " (" + pFmt(st.pPearson ?? 1) + ")" : "") +
        (st.spearman != null ? "   Spearman " + num(st.spearman) + " (" + pFmt(st.pSpearman ?? 1) + ")" : "");
      out.push(`<text x="${W - R}" y="${T + 12}" font-size="11" fill="${p.ink}" text-anchor="end">${esc(line)}</text>`);
    }
    out.push(axisText(d.x.label, L + plotW / 2, T + PLOT + 30), 
      `<text x="14" y="${T + PLOT / 2}" font-size="11" fill="${p.muted}" text-anchor="middle" ` +
      `transform="rotate(-90 14 ${T + PLOT / 2})">${esc(d.y.label)}</text>`);
    const keyBottom = drawnHs.length ? highlightKey(L, T + PLOT + 48, W - R) + 8 : T + PLOT + 40;
    const cap = caption((v.note || "") + (v.note ? "  " : "") + "Darker is more " +
      (v.plot!.n > 1 ? "cases" : "case") + "; the shade is logarithmic.", W, keyBottom, p.muted);
    return frame(W, keyBottom + cap.height + 10, out.join("") + cap.svg, p.bg);
  }

  if (d.shape === "box" && d.groups && d.groups.length) {
    // Every group is drawn. Past what fits at the requested width the figure widens (and the
    // app's container scrolls) rather than dropping the smaller groups, whose cases would
    // otherwise be missing from a figure that still claims the full count.
    const gs = d.groups;
    const MIN_BW = 26;
    const Wb = Math.max(W, L + R + gs.length * MIN_BW), plotWb = Wb - L - R;
    const lo = Math.min(...gs.map((g) => g.loWhisker)), hi = Math.max(...gs.map((g) => g.hiWhisker));
    const span = Math.max(1e-9, hi - lo);
    const bw = plotWb / gs.length;
    const sy = (val: number) => T + PLOT - PLOT * (val - lo) / span;
    // the values behind the boxes: every point when the reader may see cases and there are few
    // enough of them, otherwise the density of the same values
    const byGroup = new Map<string, { id: string; v: number; c?: string; r?: string }[]>();
    for (const pt of d.points || [])
      (byGroup.get(pt.g) ?? byGroup.set(pt.g, []).get(pt.g)!).push({ id: pt.id, v: pt.v, c: pt.c, r: pt.r });
    // each violin is scaled to its OWN densest bin: one group holding 178,489 of the values
    // would otherwise flatten every other group to an invisible sliver. How many cases a group
    // has is already printed under its name, so the width is free to describe its shape.
    // a bin may hold several colour classes; the totals are what the width is scaled by
    const vio = new Map<string, Map<number, Map<string, number>>>();
    const vioMax = new Map<string, number>();
    for (const b of d.violin || []) {
      if (!vio.has(b.g)) vio.set(b.g, new Map());
      const cells = vio.get(b.g)!;
      if (!cells.has(b.b)) cells.set(b.b, new Map());
      const byClass = cells.get(b.b)!;
      byClass.set(b.c ?? "", (byClass.get(b.c ?? "") || 0) + b.n);
      const total = [...byClass.values()].reduce((a, n) => a + n, 0);
      if (total > (vioMax.get(b.g) || 0)) vioMax.set(b.g, total);
    }
    const colorKey = (d.legend || []).filter((k) => !k.ring);
    const ringKey = (d.legend || []).filter((k) => k.ring);
    const byLabel = new Map((d.legend || []).map((k) => [k.label, k.color]));
    // The key names the commonest COLOR_CAP categories. Everything past it — and a case with no
    // value — is one grey "other" with a key entry of its own, rather than a colour nobody can
    // look up (points) or a gap in the violin where its share should be.
    const OTHER = "#9aa5ad";
    const fillKeyed = new Set(colorKey.map((k) => k.label)), ringKeyed = new Set(ringKey.map((k) => k.label));
    const fillOthers = new Set<string>(), ringOthers = new Set<string>();
    let fillNoValue = false;
    for (const b of d.violin || []) if (b.c != null && !fillKeyed.has(b.c)) { if (b.c === "") fillNoValue = true; else fillOthers.add(b.c); }
    for (const pt of d.points || []) {
      if (pt.c != null && !fillKeyed.has(pt.c)) { if (pt.c === "") fillNoValue = true; else fillOthers.add(pt.c); }
      if (pt.r != null && !isAbsent(pt.r) && !ringKeyed.has(pt.r)) ringOthers.add(pt.r);
    }
    const fillOf = (label: string) => fillKeyed.has(label) ? byLabel.get(label)! : OTHER;
    const ringOf = (label: string) => ringKeyed.has(label) ? byLabel.get(label)! : OTHER;
    const otherLabel = (n: number, noValue: boolean) =>
      "other (" + [n ? n + " more categor" + (n === 1 ? "y" : "ies") : "", noValue ? "no value" : ""].filter(Boolean).join(", ") + ")";
    const vBins = d.violinBins || 40;
    let offScale = 0;

    gs.forEach((g, i) => {
      const cx = L + bw * (i + 0.5), half = Math.min(24, bw * 0.32);
      if (d.overlay === "violin" && vio.has(g.g)) {
        // a half-width density either side of the box, each violin scaled to its own densest bin.
        // With a colour, one bin's width is shared out between its classes, so the split is
        // visible without pretending the classes were measured separately.
        const cells = vio.get(g.g)!;
        // a bin stands for a range of VALUES, and the axis is drawn between the whiskers, so the
        // two are mapped through the extent the bins were cut over rather than assumed equal
        const [vx0, vx1] = d.violinExtent || [lo, hi];
        const bw = (vx1 - vx0) / vBins;
        for (const [b, byClass] of cells) {
          const vLo = vx0 + b * bw, vHi = vLo + bw;
          if (vHi < lo || vLo > hi) continue;
          const total = [...byClass.values()].reduce((a, n) => a + n, 0);
          const w = half * 1.6 * Math.sqrt(total / (vioMax.get(g.g) || 1));
          const yTop = sy(Math.min(hi, vHi));
          const step = Math.max(1.2, sy(Math.max(lo, vLo)) - yTop);
          if (!colorKey.length) {
            out.push(`<rect x="${num(cx - w)}" y="${num(yTop)}" width="${num(w * 2)}" height="${num(step)}" ` +
              `fill="${base}" fill-opacity="0.28"/>`);
            continue;
          }
          let x = cx - w;
          const segs = colorKey.map((k) => ({ n: byClass.get(k.label) || 0, color: k.color }));
          segs.push({ n: [...byClass.entries()].reduce((a, [c, n]) => fillKeyed.has(c) ? a : a + n, 0), color: OTHER });
          for (const sg of segs) {
            if (!sg.n) continue;
            const seg = 2 * w * (sg.n / total);
            out.push(`<rect x="${num(x)}" y="${num(yTop)}" width="${num(seg)}" height="${num(step)}" ` +
              `fill="${sg.color}" fill-opacity="0.75"/>`);
            x += seg;
          }
        }
      }
      if (d.overlay === "points" && byGroup.has(g.g)) {
        // two encodings on one dot need a dot big enough to carry them; a crowded plot gets
        // smaller ones so the cloud is still a cloud
        const nPts = d.points!.length;
        const rBase = Math.max(1.3, Math.min(4.5, 90 / Math.sqrt(Math.max(1, nPts))));
        for (const pt of byGroup.get(g.g)!) {
          const fill = pt.c != null && colorKey.length ? fillOf(pt.c) : base;
          const ring = pt.r != null && !isAbsent(pt.r) ? ringOf(pt.r) : null;
          out.push(`<circle cx="${num(cx + jitterFor(pt.id) * half * 0.9)}" cy="${num(sy(pt.v))}" ` +
            `r="${num(ring ? rBase * 1.25 : rBase)}" fill="${fill}" fill-opacity="0.85"` +
            (ring ? ` stroke="${ring}" stroke-width="${num(Math.max(0.6, rBase * 0.28))}"` : "") + `/>`);
        }
      }
      out.push(`<line x1="${num(cx)}" y1="${num(sy(g.loWhisker))}" x2="${num(cx)}" y2="${num(sy(g.hiWhisker))}" stroke="${p.muted}"/>`);
      out.push(`<rect x="${num(cx - half)}" y="${num(sy(g.q3))}" width="${num(half * 2)}" height="${num(Math.max(1, sy(g.q1) - sy(g.q3)))}" ` +
        `fill="${base}" fill-opacity="${d.overlay === "none" ? 0.25 : 0.1}" stroke="${base}"/>`);
      out.push(`<line x1="${num(cx - half)}" y1="${num(sy(g.median))}" x2="${num(cx + half)}" y2="${num(sy(g.median))}" stroke="${base}" stroke-width="2"/>`);
      // highlights over the box: a narrow box of their own (side by side when several), then
      // their points at the same fixed jitter the plotted cohort's points use, so a highlighted
      // case sits exactly on its own dot
      const boxed = hs.filter((h) => h.shown === "boxes");
      boxed.forEach((h, j) => {
        const hg = h.groups!.find((x) => x.g === g.g);
        if (!hg) return;
        const hw = Math.max(1.5, half * 0.42), hx = cx + (j - (boxed.length - 1) / 2) * hw * 1.25;
        const inAxis = (val: number) => Math.max(lo, Math.min(hi, val));
        out.push(`<line x1="${num(hx)}" y1="${num(sy(inAxis(hg.loWhisker)))}" x2="${num(hx)}" y2="${num(sy(inAxis(hg.hiWhisker)))}" stroke="${h.color}"/>` +
          `<rect x="${num(hx - hw / 2)}" y="${num(sy(hg.q3))}" width="${num(hw)}" height="${num(Math.max(1, sy(hg.q1) - sy(hg.q3)))}" ` +
          `fill="${h.color}" fill-opacity="0.85"/>` +
          `<line x1="${num(hx - hw / 2 - 1)}" y1="${num(sy(hg.median))}" x2="${num(hx + hw / 2 + 1)}" y2="${num(sy(hg.median))}" stroke="${p.ink}" stroke-width="1.5"/>`);
      });
      // a highlighted value past the whiskers is pinned to the frame's edge as a triangle pointing
      // off the axis, and counted in the caption, rather than drawn outside the figure
      for (const h of hs) if (h.shown === "points") {
        const rH = Math.max(1.8, Math.min(4.2, 80 / Math.sqrt(Math.max(1, h.points!.length))));
        for (const pt of h.points!) if ("g" in pt && pt.g === g.g) {
          const px = cx + jitterFor(pt.id) * half * 0.9;
          if (pt.v > hi || pt.v < lo) {
            offScale++;
            const up = pt.v > hi, ty = up ? T + 1 : T + PLOT - 1, k = rH * 1.3;
            out.push(`<path d="M${num(px - k)} ${num(up ? ty + k * 1.6 : ty - k * 1.6)} L${num(px + k)} ${num(up ? ty + k * 1.6 : ty - k * 1.6)} ` +
              `L${num(px)} ${num(ty)} Z" fill="${h.color}" stroke="${p.bg}" stroke-width="0.5"/>`);
            continue;
          }
          out.push(`<circle cx="${num(px)}" cy="${num(sy(pt.v))}" r="${num(rH)}" ` +
            `fill="${h.color}" fill-opacity="0.9" stroke="${p.bg}" stroke-width="0.6"/>`);
        }
      }
      const label = g.g.length > 14 ? g.g.slice(0, 13) + "…" : g.g;
      out.push(`<text x="${num(cx)}" y="${T + PLOT + 26}" font-size="9" fill="${p.muted}" text-anchor="end" ` +
        `transform="rotate(-40 ${num(cx)} ${T + PLOT + 26})">${esc(label)}</text>`);
      out.push(`<text x="${num(cx)}" y="${T + PLOT + 12}" font-size="8" fill="${p.muted}" text-anchor="middle">${fmt(g.n)}</text>`);
    });
    for (const t of [lo, (lo + hi) / 2, hi]) out.push(axisText(num(t), L - 6, sy(t) + 3, "end", 10));
    out.push(`<rect x="${L}" y="${T}" width="${num(plotWb)}" height="${PLOT}" fill="none" stroke="${p.line}"/>`);
    // Whichever of x/y the document names as the numeric one, the box is always drawn grouped
    // by the categorical axis with the numeric axis vertical — so the two attribute names are
    // the only way to tell a reader which is which; without them a swapped x/y is invisible.
    const numLabel = d.x.kind === "num" ? d.x.label : d.y.label, catLabel = d.x.kind === "num" ? d.y.label : d.x.label;
    out.push(axisText(catLabel, L + plotWb / 2, T + PLOT + 46),
      `<text x="14" y="${T + PLOT / 2}" font-size="11" fill="${p.muted}" text-anchor="middle" ` +
      `transform="rotate(-90 14 ${T + PLOT / 2})">${esc(numLabel)}</text>`);
    let keyY = T + PLOT + 74;
    if (colorKey.length || ringKey.length) {
      let kx = L;
      const chip = (k: { label: string; color: string; ring?: boolean }) => {
        const w = 12 + k.label.length * 5.4;
        if (kx + w > Wb - R) { kx = L; keyY += 14; }
        const g = k.ring
          ? `<circle cx="${num(kx + 4)}" cy="${num(keyY - 3)}" r="3.4" fill="none" stroke="${k.color}" stroke-width="1.6"/>`
          : `<circle cx="${num(kx + 4)}" cy="${num(keyY - 3)}" r="3.4" fill="${k.color}"/>`;
        out.push(g + `<text x="${num(kx + 11)}" y="${num(keyY)}" font-size="9" fill="${p.muted}">${esc(k.label)}</text>`);
        kx += w;
      };
      if (colorKey.length) { out.push(`<text x="${L}" y="${num(keyY - 14)}" font-size="9" fill="${p.muted}">${esc(d.colorLabel || "colour")}</text>`); colorKey.forEach(chip);
        if (fillOthers.size || fillNoValue) chip({ label: otherLabel(fillOthers.size, fillNoValue), color: OTHER }); }
      // a ring means "this case also has that", so absence gets no ring and no key entry
      if (ringKey.some((k) => !isAbsent(k.label))) {
        kx = L; keyY += 16;
        out.push(`<text x="${L}" y="${num(keyY - 14)}" font-size="9" fill="${p.muted}">${esc(d.ringLabel || "ring")}</text>`);
        ringKey.filter((k) => !isAbsent(k.label)).forEach(chip);
        if (ringOthers.size) chip({ label: otherLabel(ringOthers.size, false), color: OTHER, ring: true });
      }
      keyY += 8;
    }
    if (drawnHs.length) { keyY = highlightKey(L, keyY, Wb - R) + 18; }
    // the engine's note leads, as it does under the scatter — it is where the view says what it
    // drew over (and what it had to leave out), so a box plot without it hid exactly that
    const cap = caption((v.note ? v.note + "  " : "") + "Box: quartiles with Tukey whiskers, computed over every case in the group. The count is above each name." +
      (d.overlay === "points" ? " Every value is drawn over its box; the jitter is fixed per case."
        : d.overlay === "violin" ? " The shaded width is the share of that group's values sitting at that height, scaled per group."
        : "") +
      (offScale ? " " + fmt(offScale) + " highlighted value" + (offScale === 1 ? " lies" : "s lie") +
        " beyond the whiskers and " + (offScale === 1 ? "is" : "are") + " drawn as a triangle at the frame's edge." : ""),
      Wb, Math.max(T + PLOT + 84, keyY), p.muted);
    const bottom = Math.max(T + PLOT + 84, keyY);
    return frame(Wb, bottom + cap.height + 10, out.join("") + cap.svg, p.bg, Wb > W);
  }

  if (d.shape === "table" && d.cells && d.cells.length) {
    // Every category on both axes — the engine refuses a pair past CATEGORY_CAP, so what arrives
    // is already the whole table, and a table missing rows or columns is a wrong one.
    // Ordered by marginal total so the big categories still read first.
    const marg = (key: "cx" | "cy") => {
      const t = new Map<string, number>();
      for (const c of d.cells!) t.set(c[key], (t.get(c[key]) || 0) + c.n);
      return [...t.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
    };
    const xs = marg("cx"), ys = marg("cy");
    const at = new Map(d.cells.map((c) => [c.cx + "\u0000" + c.cy, c.n]));
    const maxN = Math.max(1, ...d.cells.map((c) => c.n));
    const LX = 130, MIN_CW = 30, MIN_CH = 16;
    const Wt = Math.max(W, LX + R + xs.length * MIN_CW);
    const cw = (Wt - LX - R) / xs.length, chh = Math.max(MIN_CH, Math.min(30, PLOT / Math.max(1, ys.length)));
    ys.forEach((yv, r) => {
      out.push(`<text x="${LX - 6}" y="${num(T + chh * r + chh * 0.66)}" font-size="10" fill="${p.muted}" text-anchor="end">${esc(yv.length > 20 ? yv.slice(0, 19) + "…" : yv)}</text>`);
      xs.forEach((xv, c) => {
        const n = at.get(xv + "\u0000" + yv) || 0;
        out.push(`<rect x="${num(LX + cw * c)}" y="${num(T + chh * r)}" width="${num(cw - 1)}" height="${num(chh - 1)}" ` +
          `fill="${SERIES[0]}" fill-opacity="${num(n ? 0.12 + 0.78 * Math.log1p(n) / Math.log1p(maxN) : 0.03)}"/>`);
        if (n) out.push(`<text x="${num(LX + cw * (c + 0.5))}" y="${num(T + chh * r + chh * 0.66)}" font-size="9" ` +
          `fill="${p.ink}" text-anchor="middle">${fmt(n)}</text>`);
      });
    });
    xs.forEach((xv, c) => out.push(`<text x="${num(LX + cw * (c + 0.5))}" y="${num(T + chh * ys.length + 12)}" font-size="9" ` +
      `fill="${p.muted}" text-anchor="end" transform="rotate(-40 ${num(LX + cw * (c + 0.5))} ${num(T + chh * ys.length + 12)})">${esc(xv.length > 16 ? xv.slice(0, 15) + "…" : xv)}</text>`));
    const h = T + chh * ys.length + 86;
    const cap = caption((v.note ? v.note + "  " : "") + d.x.label + " across, " + d.y.label + " down. " + fmt(d.n) + " cases counted in the database.", Wt, h, p.muted);
    return frame(Wt, h + cap.height + 10, out.join("") + cap.svg, p.bg, Wt > W);
  }
  return "";
}

