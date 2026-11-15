// The comparison cbioportal.org's Plots tab sorts a contingency table's categories with when their
// data type has no order of its own (TablePlot.tsx, PLT-TB-3): javascript-natural-sort 0.7.1 by Jim
// Palmer (MIT licence), ported line for line, case-sensitive as the portal calls it. Hex codes and
// dates compare by value; otherwise each label is split into runs of digits and of the rest, numbers
// compare as numbers ("2" before "10") and a number before text. (RE is case-insensitive, so its
// exponent's `e` matches `E` as the original's [eE] does.)

const RE = /(^([+-]?(?:0|[1-9]\d*)(?:\.\d*)?(?:e[+-]?\d+)?)?$|^0x[0-9a-f]+$|\d+)/gi;
const SRE = /(^ *| *$)/g;
const DRE = /(^([\w ]+,?[\w ]+)?[\w ]+,?[\w ]+\d+:\d+(:\d+)?[\w ]?|^\d{1,4}[/-]\d{1,4}[/-]\d{1,4}|^\w+, \w+ \d+, \d{4})/;
const HRE = /^0x[0-9a-f]+$/i;
const ORE = /^0/;

const chunks = (s: string) => s.replace(RE, "\0$1\0").replace(/\0$/, "").replace(/^\0/, "").split("\0");
/** a chunk as the library reads it: a number unless it starts with 0, else the chunk itself, else 0 */
const read = (c: string | undefined): number | string => (!(c || "").match(ORE) && parseFloat(c || "")) || c || 0;

export function naturalSort(a: string, b: string): number {
  const x = a.replace(SRE, "") || "", y = b.replace(SRE, "") || "";
  const xN = chunks(x), yN = chunks(y);
  const xD = parseInt(String(x.match(HRE)), 16) || (xN.length !== 1 && x.match(DRE) && Date.parse(x));
  const yD = parseInt(String(y.match(HRE)), 16) || (xD && y.match(DRE) && Date.parse(y)) || null;
  if (yD) {
    if ((xD as number) < yD) return -1;
    if ((xD as number) > yD) return 1;
  }
  for (let i = 0, n = Math.max(xN.length, yN.length); i < n; i++) {
    let p = read(xN[i]), q = read(yN[i]);
    if (Number.isNaN(Number(p)) !== Number.isNaN(Number(q))) return Number.isNaN(Number(p)) ? 1 : -1;
    if (typeof p !== typeof q) { p = String(p); q = String(q); }
    if (p < q) return -1;
    if (p > q) return 1;
  }
  return 0;
}
