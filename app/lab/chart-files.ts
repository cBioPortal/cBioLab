// A Study View chart's Download ▸ SVG and PDF (docs/legacy-spec/parity/download-cases.md, FG): the
// figure as a standalone file, named after the chart, and the menu entries that save it.
import { chartFileName, saveText } from "../../lib/study-view-download.ts";
import { esc, FS } from "../../lib/svg-kit.ts";
import { densityGradientStops, type CorrelationLine, type DensityLegend } from "../../lib/study-view-density.ts";
import { fmtInt } from "../../lib/chart/format.ts";
import { svgToPdf } from "../_oncoprint/pdf.ts";
import type { ChartAction } from "./partitions.tsx";

/** the page's colour variables as the light theme's literals, so a saved figure reads the same anywhere */
const LITERALS: [RegExp, string][] = [
  [/var\(--ink(?:,[^)]*)?\)/g, "#16232b"], [/var\(--muted(?:,[^)]*)?\)/g, "#5b6b76"],
  [/var\(--line(?:,[^)]*)?\)/g, "#dde4e8"], [/var\(--bg(?:,[^)]*)?\)/g, "#ffffff"],
];

/**
 * An SVG as a file: the root given its size in numbers (a page figure is drawn at "100%"), the
 * page's colour variables written as colours, and the namespace set.
 */
export function standaloneSvg(svg: string): string {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  let out = svg;
  if (vb) {
    const [w, h] = [Math.ceil(Number(vb[1])), Math.ceil(Number(vb[2]))];
    out = out.replace(/<svg\b([^>]*)>/, (_, attrs: string) => "<svg" + attrs
      .replace(/\s(width|height|style)="[^"]*"/g, "") + ` width="${w}" height="${h}">`);
  }
  if (!/<svg[^>]*\sxmlns=/.test(out)) out = out.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  for (const [re, lit] of LITERALS) out = out.replace(re, lit);
  return out;
}

/**
 * The density chart as one SVG: the plot as drawn (its drag box left out) and, beside it, the
 * colour legend and the correlation lines the page draws in HTML.
 */
export function densityFigureSvg(plot: SVGSVGElement, legend: DensityLegend | null, lines: CorrelationLine[] | null): string {
  const copy = plot.cloneNode(true) as SVGSVGElement;
  copy.querySelectorAll(".xc-brush").forEach((n) => n.remove());
  copy.querySelectorAll("[data-tip]").forEach((n) => n.removeAttribute("data-tip"));
  copy.querySelectorAll(".xc-frame").forEach((n) => { n.setAttribute("fill", "none"); n.setAttribute("stroke", "#dde4e8"); });
  const w = Number(plot.getAttribute("width")), h = Number(plot.getAttribute("height"));
  const LW = 92, x = w + 8;
  let side = "";
  let y = 14;
  if (legend) {
    const barH = legend.mid == null ? 38 : 68;
    side += `<text x="${x}" y="${y}" font-size="${FS.small}" fill="#5b6b76"># samples</text>`;
    side += `<defs><linearGradient id="xc-dens-ramp" x1="0" y1="1" x2="0" y2="0">` +
      densityGradientStops().map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join("") + `</linearGradient></defs>`;
    const top = y + 6;
    side += `<rect x="${x}" y="${top}" width="10" height="${barH}" fill="url(#xc-dens-ramp)"/>`;
    const label = (v: number, ly: number) => `<text x="${x + 14}" y="${ly}" font-size="${FS.small}" fill="#16232b">${fmtInt(v)}</text>`;
    side += label(legend.max, top + 8) + (legend.mid != null ? label(legend.mid, top + barH / 2 + 4) : "") + label(legend.min, top + barH);
    y = top + barH + 18;
  }
  for (const l of lines || []) {
    side += `<text x="${x}" y="${y}" font-size="${FS.small}" fill="#5b6b76">${esc(l.name)}</text>` +
      `<text x="${x}" y="${y + 13}" font-size="${FS.small}" fill="#16232b">${esc(l.r)}</text>` +
      `<text x="${x}" y="${y + 26}" font-size="${FS.small}" fill="#16232b">${esc(l.p)}</text>`;
    y += 44;
  }
  const W = w + LW, H = Math.max(h, y);
  copy.setAttribute("viewBox", `0 0 ${W} ${H}`);
  copy.setAttribute("width", String(W));
  copy.setAttribute("height", String(H));
  copy.setAttribute("font-family", "'IBM Plex Sans', Arial, sans-serif");
  copy.removeAttribute("class");
  copy.insertAdjacentHTML("afterbegin", `<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  copy.insertAdjacentHTML("beforeend", side);
  return standaloneSvg(new XMLSerializer().serializeToString(copy));
}

/**
 * The figure with its text set in the PDF's embedded font: svg2pdf takes a font from the element
 * that names it, not from the root, so the root's children are wrapped in a group that names it.
 * The PDF embeds only the regular weight, so bold text is drawn regular rather than in Times Bold.
 */
export function pdfFonts(svg: string): string {
  return svg
    .replace(/\sfont-weight="(?:bold|bolder|[6-9]00)"/g, "")
    .replace(/(<svg\b[^>]*>)([\s\S]*)(<\/svg>\s*)$/, (_, open: string, body: string, close: string) =>
      open + '<g font-family="IBM Plex Sans">' + body + "</g>" + close);
}

/** saves a PDF of the figure, a page its own size */
async function savePdf(file: string, svg: string): Promise<void> {
  const blob = await svgToPdf(pdfFonts(svg));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A chart's SVG and PDF entries. `figure` draws the file's SVG when the entry is chosen (null when
 * the chart has nothing drawn); a PDF that can't be made is reported through `onError`.
 */
export function figureActions(chartName: string, figure: () => string | null, onError: (message: string) => void): ChartAction[] {
  const none = "the chart has nothing drawn to save";
  return [
    { label: "SVG", title: "the figure as " + chartFileName(chartName, "svg"),
      onClick: () => { const s = figure(); if (s) saveText(chartFileName(chartName, "svg"), s); else onError(none); } },
    { label: "PDF", title: "the figure as " + chartFileName(chartName, "pdf"),
      onClick: () => {
        const s = figure();
        if (!s) { onError(none); return; }
        savePdf(chartFileName(chartName, "pdf"), s).catch((e) => onError("Could not make the PDF: " + String((e as Error)?.message || e)));
      } },
  ];
}
