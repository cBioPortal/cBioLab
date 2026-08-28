// Server-side SVG renderer for the oncoprint render contract.
// Second renderer over the same contract as the browser canvas — zero data logic.
const BITS = { MISSENSE: 1, TRUNCATING: 2, INFRAME: 4, SPLICE: 8, OTHER_MUT: 16, SV: 32, AMP: 64, HOMDEL: 128, DRIVER: 256 };
const CAT_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#999999"];
const P = {
  paper: "#ffffff", unaltered: "#e8ecee", np: "#f4f6f7", npStripe: "#dfe4e7",
  amp: "#e41a1c", homdel: "#2166ac", sv: "#8e24aa",
  missense: "#2e7d32", truncating: "#111111", inframe: "#b8860b", splice: "#ff8c00", otherMut: "#9467bd",
  derived: "#0f86a1", text: "#1f2933", muted: "#5b6b76"
};
const ROW_H = 20, ROW_GAP = 3, GUTTER = 168, GROUP_GAP = 10, HEADER_H = 22, LEGEND_H = 58;
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function contractToSvg(contract, width = 1200) {
  const nTracks = contract.tracks.length;
  const catTracks = contract.tracks.filter(t =>
    (t.kind === "clinical" && ((t.categories && t.categories.length) || t.numeric)) || t.kind === "heatmap");
  const height = HEADER_H + nTracks * (ROW_H + ROW_GAP) + LEGEND_H + catTracks.length * 16;
  const plotW = width - GUTTER - (contract.groups.length - 1) * GROUP_GAP - 8;
  const n = contract.columns.length;
  const colW = plotW / n;
  const groupX = [];
  let gx = GUTTER;
  for (const g of contract.groups) { groupX.push(gx); gx += g.count * colW + GROUP_GAP; }

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="IBM Plex Sans,Helvetica,Arial,sans-serif" font-size="11">`);
  parts.push(`<rect width="${width}" height="${height}" fill="${P.paper}"/>`);
  parts.push(`<defs><pattern id="np" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="4" height="4" fill="${P.np}"/><rect width="2" height="4" fill="${P.npStripe}"/></pattern></defs>`);

  contract.groups.forEach((g, gi) => {
    parts.push(`<text x="${groupX[gi]}" y="13" fill="${P.muted}">${esc(g.name)} (${g.count.toLocaleString("en-US")})</text>`);
  });

  const bucketOf = (cells, from, count, pxW, numeric) => {
    const out = [];
    if (colW >= 1) {
      for (let i = 0; i < count; i++) out.push({ x0: i * colW, w: colW, code: cells[from + i] });
      return out;
    }
    const buckets = Math.max(1, Math.floor(pxW));
    for (let b = 0; b < buckets; b++) {
      const i0 = Math.floor(b * count / buckets), i1 = Math.max(i0 + 1, Math.floor((b + 1) * count / buckets));
      let code = -1, sawAny = false, sum = 0, nNum = 0;
      for (let i = i0; i < i1; i++) {
        const c = cells[from + i];
        if (c === -1) continue;
        sawAny = true;
        // numeric heat cells aggregate by mean (OR/max of scaled values distorts)
        if (numeric) { sum += c; nNum++; }
        else code = (code === -1 ? 0 : code) | (c > 0 ? c : 0);
      }
      if (numeric && nNum) code = Math.round(sum / nNum);
      out.push({ x0: b * pxW / buckets, w: pxW / buckets, code: sawAny ? code : -1 });
    }
    return out;
  };

  // sequential blue heat for numeric clinical tracks: 0..255 -> light..dark
  const heat = (v) => {
    const t = Math.max(0, Math.min(1, v / 255));
    const mix = (a, b) => Math.round(a + (b - a) * t);
    return `rgb(${mix(222, 8)},${mix(235, 72)},${mix(247, 135)})`; // #deebf7 -> #084887
  };
  // diverging blue->white->red for heatmap tracks with a center (z-scores etc.)
  const diverging = (v, c) => {
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    if (v <= c) { const t = c ? v / c : 1; return `rgb(${lerp(33, 255, t)},${lerp(102, 255, t)},${lerp(172, 255, t)})`; }   // #2166ac -> white
    const t = (v - c) / (255 - c || 1); return `rgb(${lerp(255, 178, t)},${lerp(255, 24, t)},${lerp(255, 43, t)})`;        // white -> #b2182b
  };
  const numColor = (t) => (v) => t.center != null ? diverging(v, t.center) : heat(v);
  const fmtNum = (x) => Math.abs(x) >= 100 ? Math.round(x).toLocaleString("en-US") : Math.round(x * 10) / 10;

  const r2 = x => Math.round(x * 100) / 100;
  contract.tracks.forEach((t, ti) => {
    const y = HEADER_H + ti * (ROW_H + ROW_GAP);
    parts.push(`<text x="4" y="${y + 14}" fill="${P.text}">${esc(t.label.length > 17 ? t.label.slice(0, 16) + "…" : t.label)}</text>`);
    if (t.freqPct != null) parts.push(`<text x="${GUTTER - 8}" y="${y + 14}" fill="${P.muted}" text-anchor="end">${t.driverPct != null ? t.driverPct + "% / " + t.freqPct + "%" : t.freqPct + "%"}</text>`);
    contract.groups.forEach((g, gi) => {
      const x0 = groupX[gi], pxW = g.count * colW;
      for (const b of bucketOf(t.cells, g.start, g.count, pxW, !!t.numeric)) {
        const x = r2(x0 + b.x0), w = r2(Math.max(b.w, 0.5));
        if (t.kind === "gene") {
          if (b.code === -1) {
            parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="url(#np)"/>`);
          } else {
            const vus = b.code > 0 && !(b.code & BITS.DRIVER);
            const op = vus ? ` fill-opacity="0.35"` : "";
            parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="${P.unaltered}"/>`);
            if ((b.code & BITS.AMP) || (b.code & BITS.HOMDEL))
              parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="${b.code & BITS.AMP ? P.amp : P.homdel}"${op}/>`);
            if (b.code & BITS.SV) parts.push(`<rect x="${x}" y="${r2(y + ROW_H * 0.15)}" width="${w}" height="${r2(ROW_H * 0.7)}" fill="${P.sv}"${op}/>`);
            const mut = b.code & BITS.MISSENSE ? P.missense : b.code & BITS.TRUNCATING ? P.truncating
              : b.code & BITS.INFRAME ? P.inframe : b.code & BITS.SPLICE ? P.splice : b.code & BITS.OTHER_MUT ? P.otherMut : null;
            if (mut) parts.push(`<rect x="${x}" y="${r2(y + ROW_H * 0.3)}" width="${w}" height="${r2(ROW_H * 0.4)}" fill="${mut}"${op}/>`);
          }
        } else if (t.kind === "derivedEvent") {
          parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="${b.code > 0 ? P.derived : P.unaltered}"/>`);
        } else if (t.numeric) {
          parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="${b.code === -1 ? P.np : numColor(t)(b.code)}"/>`);
        } else {
          parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="${b.code === -1 ? P.np : CAT_COLORS[b.code % CAT_COLORS.length]}"/>`);
        }
      }
    });
  });

  // legend
  const ly = HEADER_H + nTracks * (ROW_H + ROW_GAP) + 14;
  let lx = GUTTER;
  const legend = [["Amp", P.amp], ["DeepDel", P.homdel], ["SV", P.sv], ["Missense", P.missense],
    ["Truncating", P.truncating], ["In-frame", P.inframe], ["Splice", P.splice], ["Derived", P.derived]];
  for (const [label, color] of legend) {
    parts.push(`<rect x="${lx}" y="${ly - 9}" width="10" height="10" fill="${color}"/>`);
    parts.push(`<text x="${lx + 14}" y="${ly}" fill="${P.muted}">${label}</text>`);
    lx += 14 + label.length * 6.2 + 16;
  }
  parts.push(`<rect x="${lx}" y="${ly - 9}" width="10" height="10" fill="url(#np)"/>`);
  parts.push(`<text x="${lx + 14}" y="${ly}" fill="${P.muted}">Not profiled</text>`);
  parts.push(`<text x="${GUTTER}" y="${ly + 16}" fill="${P.muted}">solid = putative driver, faded = VUS; gene %: driver / any — annotation: ${esc(contract.conventions ? contract.conventions.annotation || "none" : "none")}</text>`);
  // category key per clinical track (colors reference the same CAT_COLORS cycle as the cells)
  let cy = ly + 16;
  for (const t of catTracks) {
    cy += 16;
    parts.push(`<text x="4" y="${cy}" fill="${P.text}">${esc(t.label.length > 17 ? t.label.slice(0, 16) + "…" : t.label)}</text>`);
    let cx = GUTTER;
    if (t.numeric) {
      const cf = numColor(t);
      for (let i = 0; i < 24; i++)
        parts.push(`<rect x="${cx + i * 4}" y="${cy - 9}" width="4" height="10" fill="${cf(255 * i / 23)}"/>`);
      parts.push(`<text x="${cx + 24 * 4 + 8}" y="${cy}" fill="${P.muted}">${fmtNum(t.min)} → ${fmtNum(t.max)}${t.center != null ? " (0 at white)" : ""}${t.kind === "heatmap" ? " · " + esc(t.profileType) + ", mean across a patient's samples" : ""}</text>`);
      continue;
    }
    t.categories.slice(0, 8).forEach((c, i) => {
      const name = String(c).length > 20 ? String(c).slice(0, 19) + "…" : String(c);
      parts.push(`<rect x="${cx}" y="${cy - 9}" width="10" height="10" fill="${CAT_COLORS[i % CAT_COLORS.length]}"/>`);
      parts.push(`<text x="${cx + 14}" y="${cy}" fill="${P.muted}">${esc(name)}</text>`);
      cx += 14 + name.length * 6.2 + 16;
    });
    if (t.categories.length > 8) parts.push(`<text x="${cx}" y="${cy}" fill="${P.muted}">+${t.categories.length - 8} more</text>`);
  }
  parts.push("</svg>");
  return parts.join("");
}
