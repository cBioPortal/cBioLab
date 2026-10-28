// THE way a stored value is read as a number in SQL. Clinical values, assay and expression values
// are text in the warehouse, and some studies record a missing number as "nan", "NaN" or "inf":
// toFloat64OrNull reads those as NaN or ±Infinity, not NULL, so they would pass every IS NOT NULL
// test and then either fail a query (a NaN cannot be cast to a histogram bin) or quietly become a
// minimum, a median or a survival time. Here they are missing, like any other value that is not a
// number. Browser-safe: it only builds SQL text.

/** `expr` as a finite Float64, or NULL when it is not a number (including NaN and ±Infinity) */
export const finiteSql = (expr: string): string =>
  "if(isFinite(ifNull(toFloat64OrNull(" + expr + "), nan)), toFloat64OrNull(" + expr + "), NULL)";

/**
 * A clinical value as a number for a comparison open on one side, as cBioPortal's study-view filter
 * reads it (castStringValueToFloat): a value recorded as a bound — a de-identified age ">90", a lab
 * limit "<0.5" — counts on the side the comparison is open to, ">90" as just above 90 and ">=90" as
 * 90, and is NULL otherwise. `open` is ">" for a comparison with no upper end (`> x`, `>= x`), "<"
 * for one with no lower end; with neither, a closed range or an equality, only a plain number counts.
 */
export function boundedNumberSql(expr: string, open: ">" | "<" | null): string {
  if (!open) return finiteSql(expr);
  return "multiIf(startsWith(" + expr + ", '" + open + "='), " + finiteSql("substring(" + expr + ", 3)") +
    ", startsWith(" + expr + ", '" + open + "'), " + finiteSql("substring(" + expr + ", 2)") + (open === ">" ? " + " : " - ") + "1e-10" +
    ", " + finiteSql(expr) + ")";
}
