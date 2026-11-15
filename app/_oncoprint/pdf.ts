// The oncoprint as a PDF, as the portal makes one (svgToPdfDownload: jsPDF and svg2pdf.js over the
// figure's SVG): the server SVG the "SVG" export saves, drawn as vectors on a page its own size,
// its text kept as text in IBM Plex Sans, embedded so any character the SVG holds prints.
// Loaded only when a PDF is asked for: the two libraries and the font are ~1 MB.

const FONT_URL = new URL("../../assets/fonts/IBMPlexSans-Regular.ttf", import.meta.url);
const FONT_FAMILY = "IBM Plex Sans";

/** an SVG length in points: "8.5in" → 612, a bare number is CSS pixels (0.75 pt) */
export function svgLengthPt(v: string | null): number {
  const m = /^\s*([0-9.]+)\s*(in|pt|px)?\s*$/.exec(v || "");
  if (!m) return NaN;
  const x = Number(m[1]);
  return m[2] === "in" ? x * 72 : m[2] === "pt" ? x : x * 0.75;
}

function base64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** the SVG text as a one-page PDF, the page the SVG's own width and height */
export async function svgToPdf(svgText: string): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }, font] = await Promise.all([
    import("jspdf"), import("svg2pdf.js"),
    fetch(FONT_URL).then((r) => { if (!r.ok) throw new Error("the PDF font could not be loaded (" + r.status + ")"); return r.arrayBuffer(); })
  ]);
  const svg = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
  if (svg.nodeName !== "svg") throw new Error("the figure's SVG could not be read");
  const w = svgLengthPt(svg.getAttribute("width")), h = svgLengthPt(svg.getAttribute("height"));
  if (!(w > 0 && h > 0)) throw new Error("the figure's SVG has no size");
  const pdf = new jsPDF({ orientation: w > h ? "landscape" : "portrait", unit: "pt", format: [w, h], compress: true });
  pdf.addFileToVFS("IBMPlexSans-Regular.ttf", base64(font));
  pdf.addFont("IBMPlexSans-Regular.ttf", FONT_FAMILY, "normal");
  // svg2pdf reads computed styles, so the SVG is laid out off screen while it is drawn
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
  host.appendChild(document.importNode(svg, true));
  document.body.appendChild(host);
  try {
    await svg2pdf(host.firstElementChild as Element, pdf, { x: 0, y: 0, width: w, height: h });
  } finally {
    host.remove();
  }
  return pdf.output("blob");
}
