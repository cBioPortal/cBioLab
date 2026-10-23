// THE way a stored value is read as a number in SQL. Clinical values, assay and expression values
// are text in the warehouse, and some studies record a missing number as "nan", "NaN" or "inf":
// toFloat64OrNull reads those as NaN or ±Infinity, not NULL, so they would pass every IS NOT NULL
// test and then either fail a query (a NaN cannot be cast to a histogram bin) or quietly become a
// minimum, a median or a survival time. Here they are missing, like any other value that is not a
// number. Browser-safe: it only builds SQL text.

/** `expr` as a finite Float64, or NULL when it is not a number (including NaN and ±Infinity) */
export const finiteSql = (expr: string): string =>
  "if(isFinite(ifNull(toFloat64OrNull(" + expr + "), nan)), toFloat64OrNull(" + expr + "), NULL)";
