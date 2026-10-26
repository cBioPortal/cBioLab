// JSON in a URL parameter — the analysis document in ?doc=, a page's changes, a filter list — kept
// as short as it can be while still standing alone: a link carries the whole value, so it opens the
// same thing for anyone, signed in or not, with nothing stored on a server.
//
// Written as `<format>.<base64url>`. Format 1 is the JSON's UTF-8 bytes, raw deflate (RFC 1951,
// no dictionary), so any language's zlib reads it: Python's `zlib.decompress(data, -15)`. A value
// with no "." (never in base64url) is the plain form, the UTF-8 JSON itself in base64url — what
// links were before, and what a script or a person may still write by hand — and reads as well.
//
// Isomorphic and synchronous: the lab writes its URL on every edit, the server writes links into
// the pages it renders.
import { deflateSync, inflateSync, strToU8, strFromU8 } from "fflate";

// Plain base64 both sides, url-safe by hand: the browser's bundled Buffer shim is not Node's and
// does not know the "base64url" encoding, so asking it for one throws at run time.
export function toBase64Url(bytes: Uint8Array): string {
  let b64: string;
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    b64 = btoa(s);
  } else b64 = Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** any JSON value as a URL parameter */
export function encodeUrlJson(x: unknown): string {
  return "1." + toBase64Url(deflateSync(strToU8(JSON.stringify(x)), { level: 9 }));
}

/** a value written by encodeUrlJson, or in the original plain base64url form; throws when it does not decode */
export function decodeUrlJson<T = unknown>(s: string): T {
  const dot = s.indexOf(".");
  if (dot < 0) return JSON.parse(new TextDecoder().decode(fromBase64Url(s)));
  if (s.slice(0, dot) !== "1") throw new Error("this link was written in a newer format (" + s.slice(0, dot) + ") than this page reads");
  return JSON.parse(strFromU8(inflateSync(fromBase64Url(s.slice(dot + 1)))));
}

/** decodeUrlJson, or null when there is no value or it does not decode */
export function readUrlJson<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return decodeUrlJson<T>(s); } catch { return null; }
}
