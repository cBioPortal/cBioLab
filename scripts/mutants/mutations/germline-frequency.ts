// Planted bugs: the Mutations tab's Germline Mutation Frequency (MUT-HD-3, MUT-STM-1). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  "germline-frequency": ["node", "--env-file=.env.local", "scripts/check-germline-frequency.ts"],
};

export const mutants: Mutant[] = [
  { id: "germline-count-case-sensitive", layer: "counts", guard: "germline-frequency", file: "lib/federation.ts",
    effect: "A mutation whose status is spelled 'germline' or 'GERMLINE' does not count in the Germline Mutation Frequency, where the portal matches /germline/i.",
    find: "positionCaseInsensitive(ifNull(status, ''), 'germline') > 0 AND \" + germlineConsentedCond", replace: "position(ifNull(status, ''), 'Germline') > 0 AND \" + germlineConsentedCond" },
  { id: "germline-rate-ignores-consent-list", layer: "counts", guard: "germline-frequency", file: "lib/federation.ts",
    effect: "The Germline Mutation Frequency divides by every sample even where the study lists its germline-consented samples, where the portal divides by those.",
    find: "germlineCohortSamples: Number(gc.data[0]?.lists) > 0 ?", replace: "germlineCohortSamples: Number(gc.data[0]?.lists) < 0 ?" },
];
