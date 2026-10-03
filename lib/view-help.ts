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
  attrition: {
    title: "What is this?",
    text: "Shows how each group of patients was narrowed down, one criterion at a time: how many patients the study started with, how many were left after each rule in the group's definition, and how many each rule removed. It lets a reader see who was left out before trusting any result drawn from the patients who remain."
  },
  genome: {
    title: "What is this?",
    text: "Walks along every chromosome and shows, at each stretch, what share of the group's tumours have extra copies of that stretch of DNA (drawn upward, in red) or have lost copies of it (drawn downward, in blue). Stretches gained or lost in many tumours often hold genes that help the cancer grow, or genes that would have held it back."
  },
  pathways: {
    title: "What is this?",
    text: "Groups genes into ten well-known signalling pathways — chains of genes that together tell a cell when to grow, divide or die — and shows what share of each group of patients has a harmful change in at least one gene of each pathway. Two cancers can reach the same broken pathway through different genes, and this view makes that visible."
  },
  diffexpr: {
    title: "What is this?",
    text: "Compares how active every gene is between two groups of patients. Each dot is a gene: further left or right means a bigger difference in activity between the groups, higher up means the difference is less likely to be chance. The panel beside it asks whether whole families of related genes, such as those that drive cell division, lean towards one group."
  },
  paired: {
    title: "What is this?",
    text: "For patients who had two kinds of tumour sample tested — usually the original tumour and a later spread of it elsewhere in the body — shows, gene by gene, how often a change was found in both samples, only in the original, or only in the spread. Changes found only in the spread can point to how the cancer adapted, for example to a treatment. The two kinds can also be samples taken before and after a treatment. Without a list of genes, it checks every gene and shows the ones most often found on one side only."
  },
  clonality: {
    title: "What is this?",
    text: "A tumour is a population of cells, and a genetic change can be in all of them (present from early on) or only in some (arriving later). For each gene, this shows how often its changes are in all the tumour's cells, and how often the cell has also lost its backup copy of that gene. Beside it: how often tumours have doubled their entire set of chromosomes."
  },
  incidence: {
    title: "What is this?",
    text: "Shows what share of patients have experienced a particular event — such as the cancer spreading to the brain — by each point in time. It counts patients who died before the event as never having it, rather than pretending they might still, which is why its numbers can be noticeably lower, and more honest, than a simple survival-style curve would suggest."
  },
  enrichment: {
    title: "What is this?",
    text: "Checks every gene at once for whether it is changed more often in one group of patients than another — mutated, gained, deleted or rearranged, whichever you choose. The genes at the top of the list, and furthest out on the chart, differ most clearly between the groups; the share in each group is beside every gene, so a difference that is clear but small is visible as small."
  },
  assays: {
    title: "What is this?",
    text: "Compares two or more groups on every measurement in one kind of extra lab data the study recorded — such as which mutational signatures (like sun damage or smoking) shaped each tumour, or which chromosome arms were gained or lost. The measurements at the top differ most clearly between the groups; each one shows its average, or its mix of results, in every group, so a difference that is clear but small reads as small."
  },
  overlap: {
    title: "What is this?",
    text: "Shows how the groups of patients you defined overlap: for every combination of groups, how many patients belong to exactly those groups and none of the others. Each column is one combination — the dots below it say which groups — and its bar is how many patients fall there, so you can see at a glance whether two groups are mostly the same people or nearly separate."
  },
  cancertypes: {
    title: "What is this?",
    text: "For a list of genes, shows what share of samples in each cancer type carry a change in at least one of them — mutated, gained in many copies, deleted, or rearranged — with each bar split by which kind of change it was. It answers which cancers these genes matter most in, the way cBioPortal's Cancer Types Summary does."
  },
  labs: {
    title: "What is this?",
    text: "Follows a blood test — such as PSA in prostate cancer — from the moment a treatment started, as the change from each patient's own starting level. The line shows the typical patient, the shaded band the middle half of patients, and the bars on the right each patient's best result: how far their level fell, or rose, after treatment began."
  },
  plot: {
    title: "What is this?",
    text: "Plots two measurements against each other for the same patients or samples — for example, a gene's activity level against a patient's age — so you can see whether they tend to rise and fall together, split into distinct clusters, or show no relationship at all."
  }
};
