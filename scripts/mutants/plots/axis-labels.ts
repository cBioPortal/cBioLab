// Planted bugs: #289, the portal's category names on a plot's axes (PLT-DT-3…5, DT-9, DT-11). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "cox-covariate-portal-labels", layer: "counts", guard: "plot-stats", file: "lib/federation.ts",
    effect: "A cox covariate's mutated-vs-not levels are renamed \"No mutation\", so a document naming its reference \"Not mutated\" no longer finds it.",
    find: "const ctx = { study: this.study, db, unit: \"patient\" as const, cohortSql: this.cohortSql(def), ...(await this.axisCtx()), labels: \"model\" as const };\n    const sels = covariates.map((c, i) => ({ label: \"c\" + i, sel: axisSelect(c, ctx, kinds[i]) }));\n    // a patient",
    replace: "const ctx = { study: this.study, db, unit: \"patient\" as const, cohortSql: this.cohortSql(def), ...(await this.axisCtx()) };\n    const sels = covariates.map((c, i) => ({ label: \"c\" + i, sel: axisSelect(c, ctx, kinds[i]) }));\n    // a patient" },
  { id: "plot-labels-not-portal", layer: "counts", guard: "plot-stats", file: "lib/plot.ts",
    effect: "A plot's mutation, SV and copy-number categories read \"Not mutated\", \"Structural variant\", \"Deep deletion\", where the portal writes \"No mutation\", \"With Structural Variants\", \"Deep Deletion\".",
    find: "const L = AXIS_LABELS[ctx.labels ?? \"portal\"];",
    replace: "const L = AXIS_LABELS.model;" },
];
