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
  composition: {
    title: "What is this?",
    text: "Shows what each patient's (or sample's) tumour is made of — the share of each cell type, cell state or signature — as one stacked bar per case, sorted by the part you choose, with each group's average beside it. Under the bars, every group is set against the others part by part: the colour says whether a part is higher (red) or lower (blue) there, its size how sure that is. Parts of a whole move together, so one part rising means others fall."
  },
  mutations: {
    title: "What is this?",
    text: "Lists every mutation found in one gene in your groups, one row per mutation: which sample it was in, the exact protein change, whether OncoKB considers it cancer-causing, what kind of change it is, and how much of the tumour carries it. Click a column to sort by it; the download saves every row. It sits under the lollipop chart, which shows the same mutations as positions along the protein."
  },
  table: {
    title: "What is this?",
    text: "Lists every sample (or every patient) in your groups with everything the study recorded about them — cancer type, age, stage, survival and the rest — one row each. Click a column's name to sort by it; the download button saves every row as a file a spreadsheet can open. Studies that only share counts, never individual patients, are named rather than listed."
  },
  timeline: {
    title: "What is this?",
    text: "Shows one patient's medical history on a single line of time, as cBioPortal's patient page does: when samples were taken, operations, each treatment and how long it lasted, diagnoses, and lab results drawn as small charts. Time is counted from the day of diagnosis, and long stretches with nothing recorded are cut short (the dashed line). Step to the previous or next patient with the arrows at the top (or the ← and → keys), pick another cohort in the header, or open the patient list to search, sort and pick one. Studies that only share counts, never individual patients, are named rather than listed."
  },
  alterations: {
    title: "What is this?",
    text: "Lists one patient's genetic changes as cBioPortal's patient page does, in three tables: mutations (the gene, the protein change, whether OncoKB considers it cancer-causing, and how much of the tumour carries it), copy-number changes (genes amplified or deleted outright) and structural variants (fusions and rearrangements). A change found in several of the patient's samples is one row, with a numbered marker for each sample. Cohort % says how common the same kind of change in that gene is across the study. Each table can be searched, filtered, sorted and downloaded on its own. Step to the previous or next patient with the arrows at the top (or the ← and → keys), pick another cohort in the header, or open the patient list to search, sort and pick one."
  },
  correlates: {
    title: "What is this?",
    text: "Takes one gene and checks every other gene for whether its activity rises and falls along with it across these patients. The genes at the top go up when it goes up; those at the bottom go down when it goes up. The chart on the left shows how all genes fall: most barely move with it, and the ones far out on either side are the ones listed. Moving together is a clue, not proof that one gene controls the other."
  },
  overlap: {
    title: "What is this?",
    text: "Shows how the groups of patients you defined overlap: for every combination of groups, how many patients belong to exactly those groups and none of the others. Each column is one combination — the dots below it say which groups — and its bar is how many patients fall there, so you can see at a glance whether two groups are mostly the same people or nearly separate."
  },
  cancertypes: {
    title: "What is this?",
    text: "For a list of genes, shows what share of samples in each cancer type carry a change in at least one of them — mutated, gained in many copies, deleted, or rearranged — with each bar split by which kind of change it was. It answers which cancers these genes matter most in, the way cBioPortal's Cancer Types Summary does."
  },
  riskmodel: {
    title: "What is this?",
    text: "A model that predicts survival from which genes are mutated in each patient, in the style of the OncoCast package. It is trained many times, each time on two thirds of the patients and tested on the other third, so every patient's risk score comes from a model that never saw them. Patients are then split into low, intermediate and high risk, and their survival curves are drawn. The list shows the genes the model relied on most, with a hazard ratio above 1 meaning higher risk. Tick \"validate\" to train on one half of the patients and grade the model on the other half, which it never saw, or name another group of patients under \"validate on\" to grade it there — for example patients from a different study — with the same risk-group boundaries."
  },
  acquired: {
    title: "What is this?",
    text: "For patients who had a tumour sample tested before a treatment started and another one afterwards, shows gene by gene how many had a change only in the later sample (acquired, to the right) or only in the earlier one (lost, to the left). Genes that keep turning up only after treatment can point to how tumours resist it. It cannot say the treatment caused the change: second biopsies are usually taken when the cancer grows again, and a change can simply have been missed the first time."
  },
  ctdna: {
    title: "What is this?",
    text: "Tumours shed DNA into the blood, and a blood test (a \"liquid biopsy\") can read it. For patients who had both a blood sample and a tumour tissue sample tested, this shows gene by gene how often a change was found in both, only in the tissue, or only in the blood — and how often the blood test caught what the tissue showed. Below, it shows how many patients had tumour DNA detected in their blood at all, and whether those patients lived shorter or longer than those without it."
  },
  exclusivity: {
    title: "What is this?",
    text: "Asks, for each pair of genes, whether tumours carry changes in both more or less often than chance — \"mutually exclusive\" genes are rarely changed together, which can mean either change alone is enough to drive the cancer. Its sense of \"chance\" accounts for how many changes each tumour has overall: a tumour with hundreds of changes is expected to share genes with many others, so it does not make two genes look linked just because they both turn up in heavily altered tumours. Beside it is the simpler test that ignores this, to show the difference."
  },
  cutpoint: {
    title: "What is this?",
    text: "Looks for the value of a measurement — such as tumour mutational burden — that best splits patients into a group that did better and a group that did worse. It tries every reasonable dividing line (from the lowest tenth of patients to the highest) and draws how strongly each one separates survival; the dot marks the best. Because trying many lines and keeping the best always finds something, the view also reshuffles the measurement among the patients a thousand times to see how good a 'best line' chance alone produces, and reports how surprising the real best line is once that search is accounted for. A line found this way needs checking in other patients before anyone relies on it."
  },
  predictive: {
    title: "What is this?",
    text: "Asks, gene by gene, whether a mutation changes how patients do on a particular treatment — not just whether it marks a better or worse outlook in general. For each gene it compares patients with and without the mutation twice: among those who received the treatment (upper marker) and among those who did not (lower marker). A gene whose markers sit far apart — say, much worse with the mutation only among the treated — may predict who benefits from that treatment; the right-hand column tests that difference. Treatment here was not assigned at random, and patients had to live long enough to receive it, so a finding is a lead to test properly, not proof."
  },
  txendpoints: {
    title: "What is this?",
    text: "Starts each patient's clock on the day a treatment began — for example their first immunotherapy — and follows them to an outcome that real-world studies use in place of a trial's: when they moved on to their next treatment (time to next treatment), when they stopped this one (time on treatment), or when their cancer was recorded as growing (real-world progression-free survival). Death counts as the outcome too, and patients still followed without it are counted up to their last visit. Each group's curve shows the share not yet there at each month, with the number still followed below. The groups were not randomised to the treatment, so a gap between curves is a clue, not proof that a gene or a group changes how well the treatment works."
  },
  forest: {
    title: "What is this?",
    text: "Asks whether one thing — a gene being mutated, a high tumour mutation burden — goes with shorter or longer survival, separately in each cancer type, and then combines those answers. Each row is one cancer type: its square is the hazard ratio (right of the dashed line at 1 means patients with the change died sooner; left means they lived longer) and its line how sure we can be. The diamonds at the bottom combine the rows into one overall estimate. When the rows disagree a lot (a high I²), the overall estimate is an average of different effects, so read the rows. This shows an association, not a cause."
  },
  adjusted: {
    title: "What is this?",
    text: "Compares how often each commonly mutated gene is mutated in two groups of patients — say, colorectal cancers diagnosed before and after age 50 — after taking into account other things that differ between the groups and also change mutation rates, such as how many mutations a tumour carries overall. Each dot is a gene: right of centre means more often mutated in the first group, left in the second, and higher means more certain. The table shows each gene's raw difference beside the adjusted one, so you can see which differences were explained away. A difference here is a clue, not proof of a cause."
  },
  instability: {
    title: "What is this?",
    text: "Cancer cells often gain or lose whole chromosome arms, and how much of a tumour's genome is out of balance is a measure of how unstable it is. For each group of tumours, this shows how many chromosome arms are typically gained or lost (the \"aneuploidy score\") and what share of the genome is altered, then which arms are gained (red) or lost (blue) most often — patterns that differ by cancer type, such as chromosome 20q gained and 18q lost in colorectal cancer."
  },
  actionability: {
    title: "What is this?",
    text: "For each patient, finds the strongest evidence OncoKB lists for a drug that targets one of their tumour's genetic changes — Level 1 means an FDA-approved drug for that change, down to Level 4 for early biological evidence — and shows what share of patients reach each level, overall or per cancer type. The levels here are the best OncoKB gives the change in ANY cancer, so a change that is only actionable in another cancer still counts: read the bars as an upper bound. The table below compares, for patients sequenced twice, the level found in their primary tumour against their metastasis."
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
