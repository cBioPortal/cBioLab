// The signatures view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { tableText } from "../text.ts";
import { signaturesSvg } from "./figure.ts";
import { SIGNIFICANT_P, pctText, versionLabel } from "./data.ts";

/** spectrum channels listed in the results text, the largest first; the figure draws every one */
const TEXT_CHANNELS = 12;

export const signaturesKind: ViewKindDef<"signatures"> = {
  kind: "signatures",
  figure: (v, o) => signaturesSvg(v, o),
  title: (v) => "Mutational signatures" + (v.signatures?.patient ? " — " + v.signatures.patient.id : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const s = v.signatures, pt = s.patient;
    const head = `Mutational signatures — patients to choose from (with signature values): ${s.total < s.all ? `${s.total.toLocaleString()} of ${s.all.toLocaleString()} kept by the query` : s.total.toLocaleString()}; ` + tableText(s);
    if (!pt || !s.version) { out.push(head + caveatOf(v) + noteOf(v)); return; }
    const sp = s.spectrum;
    const nonzero = s.signatures.filter((r) => r.values.some((x) => (x.value ?? 0) > 0));
    out.push(head + `\n${pt.id} (${pt.study}); ${versionLabel(s.version)} from ${s.profiles?.contribution}; types with values: ${s.versions.join(", ")}` +
      `\nContribution by sample (${s.profiled.join(", ")}${s.profiles?.pvalue ? "; * p < " + SIGNIFICANT_P : ""}):\n` +
      nonzero.map((r) => `  ${r.name}: ` + r.values.map((x) => pctText(x.value) + (x.p != null && x.p < SIGNIFICANT_P ? " *" : "")).join(" | ")).join("\n") +
      (nonzero.length < s.signatures.length ? `\n  … ${s.signatures.length - nonzero.length} more signatures at 0 (or NA) in every sample` : "") +
      (s.notProfiled.length ? `\nNot profiled for mutational signatures: ${s.notProfiled.join(", ")}` : "") +
      (sp ? `\n${sp.sample}'s spectrum: ${sp.total.toLocaleString()} mutations in ${sp.channels.length} channels; largest: ` +
        sp.channels.filter((c) => c.count > 0).sort((a, b) => b.count - a.count).slice(0, TEXT_CHANNELS).map((c) => `${c.label} ${c.count} (${sp.total ? (100 * c.count / sp.total).toFixed(1) : "0"}%)`).join(", ") : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Shows which mutational processes left their mark on one patient's tumour, as cBioPortal's Mutational Signatures tab does. Each process — ageing, UV light, tobacco smoke, a broken DNA-repair pathway — tends to cause its own pattern of mutations, a signature; the bars give the share of each sample's mutations the study attributed to each signature (bold with a star where the study's own test calls it significant). Where the study counted the mutations by type, the second chart is one sample's mutational spectrum: how many of its mutations fall in each kind of change and sequence context. Pick the signature type, the sample, percent or counts and the Y-axis Max above the chart; the table lists every signature, and clicking one draws its COSMIC reference profile — the pattern that process leaves in general — upside down under the sample's spectrum, so the two can be compared channel by channel. Step to the previous or next patient with the arrows (or the ← and → keys), or open the patient list.",
  },
  need: "patients",
  e2ePending: "new kind: the contribution bars, spectrum and table layout may still change after review",
};
