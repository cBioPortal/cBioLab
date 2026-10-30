// The legacy importer's mutation keyword ("TP53 R175 missense", "ATRX truncating"), which groups
// mutations at the same residue: a port of cbioportal-core's MutationKeywordUtils, rule for rule.
// Java `matches` is a whole-string match (anchored here); `find` searches anywhere.

const whole = (re: string) => new RegExp("^(?:" + re + ")$");
const full = (re: string, s: string) => whole(re).exec(s);

/** The keyword stored on a mutation event: the upper-case gene symbol and the guessed keyword, or null. */
export function mutationKeyword(hugo: string, proteinChange: string, mutationType: string): string | null {
  const k = guessOncotatorKeyword(proteinChange, mutationType);
  return k === null ? null : hugo.toUpperCase() + " " + k;
}

export function guessOncotatorKeyword(aa: string, type: string): string | null {
  if (type === "Nonsense_Mutation" || type === "Splice_Site" || type.startsWith("Frame_Shift_") ||
    type === "Nonstop_Mutation" || type === "Translation_Start_Site") return "truncating";
  if (type === "Missense_Mutation") {
    if (whole("M1[A-LN-Z][A-Z]*").test(aa)) return "truncating";
    let m = full("([A-Z][0-9]+)[A-Z]", aa);
    if (m) return m[1] + " missense";
    m = full("([0-9]+)_([0-9]+)[A-Z]+>[A-Z]+", aa);
    if (m) return m[1] + "-" + m[2] + " missense";
  }
  if (type === "In_Frame_Ins") {
    if (whole("[0-9]+_[0-9]+[A-Z]*((ins)|(>)).*\\*.*").test(aa)) return "truncating";
    if (whole("1_1M>?[A-LN-Z][A-Z]*").test(aa) || whole("1_2ins[A-LN-Z][A-Z]*").test(aa)) return "truncating";
    const m = /([0-9]+)_([0-9]+)[A-Z]*((ins)|(>))[A-Z]+/.exec(aa);
    if (m) return m[1] + " insertion";
  }
  if (type === "In_Frame_Del") {
    if (whole("M[A-Z]*1del").test(aa) || whole("1_[0-9]+M[A-Z]*>[A-LN-Z][A-Z]*").test(aa)) return "truncating";
    if (whole("[A-Z]*\\*[0-9]+del").test(aa) || whole("[0-9]+_[0-9]+[A-Z]*\\*>[A-Z]+").test(aa)) return "truncating";
    if (whole("[0-9]+_[0-9]+[A-Z]*>.*\\*.*").test(aa)) return "truncating";
    let m = full("([A-Z]+)([0-9]+)del", aa);
    if (m) return m[2] + "-" + (Number(m[2]) + m[1].length - 1) + " deletion";
    m = /([0-9]+)_([0-9]+)[A-Z]*>[A-Z]+/.exec(aa);
    if (m) return m[1] + "-" + m[2] + " deletion";
  }
  if (type === "Silent") {
    const m = /([0-9]+)/.exec(aa);
    // no space before "silent": the legacy importer stores it this way
    if (m) return m[1] + "silent";
  }
  if (type === "Exon skipping" || type === "vIII deletion") return aa;
  if (type === "NA") return guessCosmicKeyword(aa);
  return null;
}

const COSMIC_TRUNCATING = [
  "\\(?[A-Z\\*]?[0-9]+[A-Z\\*]?\\)?fs\\*?>?\\??[0-9]*", "\\?fs", "[A-Z][0-9]+>?\\*", "M1>?[A-LN-Z]", "M1delM",
  "M1_M1ins[A-LN-Z][A-Z]*", "([A-Z][0-9]+_)?\\*[0-9]+>?[A-Z]", "([A-Z][0-9]+_)\\*[0-9]+del([A-Z]+\\*)?", "\\*[0-9]+del\\*",
  "[A-Z][0-9]+(_[A-Z][0-9]+)?((ins)|(>)).*\\*.*", "[A-Z][0-9]+_[A-Z][0-9]+>.*\\*.*", "M1_[A-Z][0-9]+>[A-LN-Z][A-Z]*"
].map(whole);

export function guessCosmicKeyword(aa: string): string | null {
  if (COSMIC_TRUNCATING.some((re) => re.test(aa))) return "truncating";
  let m = full("(([A-Z\\*])[0-9]+)>?((\\2)|(=)|(%3D))", aa);
  if (m) return m[1] + " silent";
  m = full("([A-Z]([0-9]+))>?([A-Z]+)", aa);
  if (m) return m[3].length > 1 ? m[2] + " insertion" : m[1] + " missense";
  for (const re of ["[A-Z]?([0-9]+)_[A-Z\\*]?[0-9]+ins(([A-Z]+)|([0-9]+))", "\\*([0-9]+)[A-Z]?ext\\*(([0-9]+)|(\\?))",
    "[A-Z*]([0-9]+)(_[A-Z*][0-9]+)?dup", "[A-Z]?([0-9]+)>[A-Z][A-Z]+", "\\*([0-9]+)_\\*[0-9]+ins[A-Z]+\\*?"]) {
    m = full(re, aa);
    if (m) return m[1] + " insertion";
  }
  m = full("[A-Z]([0-9]+)del[A-Z]?", aa);
  if (m) return m[1] + "-" + m[1] + " deletion";
  m = full("[A-Z]([0-9]+)_[A-Z]([0-9]+)del(([A-Z]+)|([0-9]+))?", aa);
  if (m) return m[1] + "-" + m[2] + " deletion";
  m = full("[A-Z]([0-9]+)_[A-Z*]([0-9]+)((>)|(delins))([A-Z*]+)", aa);
  if (m) {
    const n1 = Number(m[2]) - Number(m[1]) + 1, n2 = m[6].length;
    if (n1 === n2) return m[1] + "-" + m[2] + " missense";
    if (n1 > n2) return m[1] + "-" + m[2] + " deletion";
    return m[1] + " insertion";
  }
  m = full("[A-Z*]([0-9]+)delins[A-Z*]+[0-9]*", aa);
  if (m) return m[1] + " insertion";
  m = full("([A-Z*]+)([0-9]+)delext\\*([0-9]+)", aa);
  if (m) {
    const n1 = m[1].length, n2 = Number(m[3]), n3 = Number(m[2]);
    if (n1 === n2) return m[2] + "-" + (n3 + n2 - 1) + " missense";
    if (n1 < n2) return m[2] + " insertion";
  }
  return null;
}
