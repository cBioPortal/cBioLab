// The shape of a planted bug and of a guard, shared by every area file in this folder.
// scripts/check-mutants.ts loads each area file, checks the ids are unique and every guard is
// defined once, and plants the bugs. Changing this file plants every bug on a pull request.

export interface Mutant {
  id: string;
  layer: "statistics" | "cohorts" | "counts";
  /** what the bug would do to a result, in words a reader of the result understands */
  effect: string;
  file: string;
  find: string;
  replace: string;
  /** "unit", "cohort-logic", "portal-parity", or a guard some area file defines */
  guard: string;
  /** set when this bug actually shipped once */
  history?: string;
}

/** a guard's name and the command that runs it, from the repository root */
export type GuardCommands = Record<string, string[]>;
