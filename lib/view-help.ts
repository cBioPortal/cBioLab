// Plain-language explanations of each view kind, for a reader who isn't a scientist — what the
// figure IS and what question it answers, not how it's computed. A different job and a different
// audience from lib/dsl-reference.ts (which documents the DSL's syntax and statistics precisely,
// for someone writing or reading an analysis document, scientist or not). Shown from a "?" button
// in each view's own header (ViewHead in app/lab/page.tsx), so it travels with every view kind
// wherever ViewHead is used — chat, MCP, and the app all share that one component.
export interface ViewHelp { title: string; text: string }

export const VIEW_HELP: Record<string, ViewHelp> = {
  compare: {
    title: "What is this?",
    text: "Compares how often specific genes are altered — mutated, gained, or lost — between two or more groups of patients. If a gene is altered much more often in one group than another, that's a clue it might be connected to whatever makes the groups different, like a cancer subtype or how patients respond to treatment."
  },
  survival: {
    title: "What is this?",
    text: "Shows what share of patients in each group were still alive (or still free of disease progression) at each point in time, drawn as a curve that steps downward every time a patient's outcome is recorded. Comparing the curves for two or more groups answers: did one group tend to do better than the other, and if so, is the difference too large to be chance?"
  },
  cox: {
    title: "What is this?",
    text: "A more advanced version of the survival comparison above, which can weigh several factors at once — for example, a patient's age, a specific gene, and how far the disease had spread — to estimate how much each one changes risk on its own, holding the others equal. Each result is a \"hazard ratio\": above 1 means that factor is linked to worse outcomes, below 1 means it's linked to better ones."
  },
  logistic: {
    title: "What is this?",
    text: "Estimates how strongly different factors are linked to a yes-or-no outcome — for example, whether a patient responded to a treatment — while accounting for several factors together. Each result is an \"odds ratio\": above 1 means that factor makes the outcome more likely, below 1 means less likely."
  },
  oncoprint: {
    title: "What is this?",
    text: "A grid with one column per patient and one row per gene, color-coded to show what kind of genetic change (if any) each patient has in each gene. It's a fast way to see patterns across many patients and genes at once — for example, whether certain alterations tend to show up in the same patients, or never together."
  },
  hotspots: {
    title: "What is this?",
    text: "Shows exactly where along a gene's protein its mutations land, drawn as a lollipop chart — a taller stem means more patients had a mutation at that exact spot. Mutations clustering tightly at one or two spots, rather than scattering evenly, usually points to a location that matters for how the protein works."
  },
  coexpression: {
    title: "What is this?",
    text: "Checks whether two genes tend to be more or less active together across patients — measured by how much each gene is \"read out\" into the working molecules a cell actually uses. Genes that rise and fall together are often working in the same biological pathway, or controlled by the same switch."
  },
  clinical: {
    title: "What is this?",
    text: "Compares things recorded about the patients themselves — age, sex, a lab result, and similar details — rather than their genetics, between two or more groups. It answers whether the groups differ in ways beyond whatever genetic difference defined them, which matters for judging whether a genetic finding is really the explanation."
  },
  cooccurrence: {
    title: "What is this?",
    text: "Checks whether alterations in two genes tend to show up in the same patients more often than you'd expect by chance (\"co-occurring\"), or rarely appear together (\"mutually exclusive\"). Genes that are mutually exclusive often play overlapping roles — if one is already altered, changing the other adds little, so cells rarely need both."
  },
  course: {
    title: "What is this?",
    text: "Shows what share of patients were in each stage of their care — on treatment, in follow-up, and so on — at each point in time after diagnosis or another starting event. It's a picture of the typical patient's journey through care, not any one individual's."
  },
  sequence: {
    title: "What is this?",
    text: "Shows the order in which patients moved from one treatment to the next, drawn as flows between them. It answers a simple but useful question: after this treatment, what did doctors try next, and how often?"
  },
  plot: {
    title: "What is this?",
    text: "Plots two measurements against each other for the same patients or samples — for example, a gene's activity level against a patient's age — so you can see whether they tend to rise and fall together, split into distinct clusters, or show no relationship at all."
  }
};
