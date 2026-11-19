// Planted bugs: a mutation's oncoprint glyph class, as the portal's getOncoprintMutationType
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-mut-class-nonstart-other",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-assemble.ts",
    effect: "A Translation_Start_Site mutation is drawn as Other, where the portal draws it as Truncating.",
    find: "    default: return BITS.TRUNCATING;",
    replace: "    case \"nonstart\": return BITS.OTHER_MUT;\n    default: return BITS.TRUNCATING;" },
  { id: "onc-mut-class-no-promoter",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-assemble.ts",
    effect: "A TERT promoter mutation (5'Flank, Promoter) is drawn as Truncating, where the portal has a Promoter class.",
    find: "    case \"promoter\": return BITS.PROMOTER;\n",
    replace: "" },
  { id: "onc-mut-class-type-only",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-assemble.ts",
    effect: "A promoter mutation, known by its protein change, is drawn as Other since only the type is read.",
    find: "if (mut) bit = mutClassBit(r.mt, r.mv);",
    replace: "if (mut) bit = mutClassBit(r.mt);" },
];
