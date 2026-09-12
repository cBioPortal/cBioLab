// Where a drawn oncoprint can be opened again outside the browser. The two lab pages take the
// same spec the figure was drawn from — `?spec=<base64url>`, the convention /provenance and
// /oncoprint-lab already use — so the link IS the figure and no data has to be exported.
//
// A spec is normally a few hundred bytes: a study, a gene list, a cohort definition. Two shapes
// are not: a cohort written as an explicit id list (a drag selection can hold tens of thousands)
// and the pasted-data path, whose spec carries the tables themselves. Those are cut to fit the
// URL and the cut is stated, in the link and on the page, rather than being silently applied.
//
// Isomorphic: the figure encodes in the browser, the lab pages decode on the server.

/** encoded characters; Node's HTTP parser caps the whole request line at 16 KB */
export const SPEC_URL_MAX = 8000;

// Plain base64 both sides, url-safe by hand: the browser's bundled Buffer shim is not Node's and
// does not know the "base64url" encoding, so asking it for one throws at run time.
const toUrl = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromUrl = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/");

export function encodeSpec(spec: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(spec));
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return toUrl(btoa(s));
  }
  return toUrl(Buffer.from(bytes).toString("base64"));
}

export function decodeSpec(encoded: string): unknown {
  const b64 = fromUrl(encoded);
  const binary = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** what the cut removed, in the reader's terms; absent means the link carries the whole spec */
export interface SpecCut { note: string }

const CUTS = [4000, 1000, 200, 50];
const num = (n: number) => n.toLocaleString("en-US");

/** rows of a tab-separated table, keeping the header */
function cutTable(text: string, keep: number): [string, number, number] {
  const lines = text.split("\n");
  const rows = lines.length - 1;
  if (rows <= keep) return [text, rows, rows];
  return [lines.slice(0, keep + 1).join("\n"), keep, rows];
}

/** Cut the long parts of a spec down to `keep` entries, recording every cut made. */
function cutSpec(spec: unknown, keep: number, notes: string[], path = ""): unknown {
  if (Array.isArray(spec)) {
    if (spec.length > keep && spec.every((v) => typeof v === "string")) {
      notes.push(`${path || "list"}: the first ${num(keep)} of ${num(spec.length)} ids`);
      return spec.slice(0, keep);
    }
    return spec.map((v, i) => cutSpec(v, keep, notes, path ? path + "[" + i + "]" : String(i)));
  }
  if (spec && typeof spec === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(spec as Record<string, unknown>)) {
      const p = path ? path + "." + k : k;
      if (typeof v === "string" && (k === "events" || k === "clinical" || k === "coverage") && v.includes("\t")) {
        const [text, kept, rows] = cutTable(v, keep);
        if (kept < rows) notes.push(`${k}: the first ${num(kept)} of ${num(rows)} rows`);
        out[k] = text;
      } else out[k] = cutSpec(v, keep, notes, p);
    }
    return out;
  }
  return spec;
}

export interface LabLinks {
  cli: string;
  python: string;
  /** stated on the button and again on the lab page when the link could not carry everything */
  cut?: string;
}

/**
 * Links that open this figure in the two lab pages, cutting the spec only as far as the URL
 * forces. Returns null when even the smallest cut does not fit — the caller says so rather
 * than offering a link to a figure that is not this one.
 */
export function labLinks(spec: unknown, max = SPEC_URL_MAX): LabLinks | null {
  let encoded = encodeSpec(spec);
  let cut: string | undefined;
  for (const keep of CUTS) {
    if (encoded.length <= max) break;
    const notes: string[] = [];
    const smaller = cutSpec(spec, keep, notes);
    if (!notes.length) return null;             // nothing left to cut, and it still does not fit
    encoded = encodeSpec(smaller);
    cut = "this link carries a cut of the figure — " + notes.join("; ");
  }
  if (encoded.length > max) return null;
  const q = "?spec=" + encoded + (cut ? "&cut=" + encodeURIComponent(cut) : "");
  return { cli: "/oncoprint-lab/cli" + q, python: "/oncoprint-lab/python" + q, cut };
}

/** a spec built from pasted tables rather than from the warehouse */
export function isLocalSpec(spec: unknown): boolean {
  return !!spec && typeof spec === "object" && typeof (spec as { events?: unknown }).events === "string";
}
