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
  const height = HEADER_H + nTracks * (ROW_H + ROW_GAP) + LEGEND_H;
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

  const bucketOf = (cells, from, count, pxW) => {
    const out = [];
    if (colW >= 1) {
      for (let i = 0; i < count; i++) out.push({ x0: i * colW, w: colW, code: cells[from + i] });
      return out;
    }
    const buckets = Math.max(1, Math.floor(pxW));
    for (let b = 0; b < buckets; b++) {
      const i0 = Math.floor(b * count / buckets), i1 = Math.max(i0 + 1, Math.floor((b + 1) * count / buckets));
      let code = -1, sawAny = false;
      for (let i = i0; i < i1; i++) {
        const c = cells[from + i];
        if (c === -1) continue;
        sawAny = true;
        code = (code === -1 ? 0 : code) | (c > 0 ? c : 0);
      }
      out.push({ x0: b * pxW / buckets, w: pxW / buckets, code: sawAny ? code : -1 });
    }
    return out;
  };

  const r2 = x => Math.round(x * 100) / 100;
  contract.tracks.forEach((t, ti) => {
    const y = HEADER_H + ti * (ROW_H + ROW_GAP);
    parts.push(`<text x="4" y="${y + 14}" fill="${P.text}">${esc(t.label.length > 17 ? t.label.slice(0, 16) + "…" : t.label)}</text>`);
    if (t.freqPct != null) parts.push(`<text x="${GUTTER - 8}" y="${y + 14}" fill="${P.muted}" text-anchor="end">${t.driverPct != null ? t.driverPct + "% / " + t.freqPct + "%" : t.freqPct + "%"}</text>`);
    contract.groups.forEach((g, gi) => {
      const x0 = groupX[gi], pxW = g.count * colW;
      for (const b of bucketOf(t.cells, g.start, g.count, pxW)) {
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
  parts.push("</svg>");
  return parts.join("");
}
