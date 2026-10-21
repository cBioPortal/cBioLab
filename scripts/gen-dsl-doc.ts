// Regenerate docs/dsl.md from lib/dsl-reference.ts (the single source of truth).
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { renderDslMarkdown } from "../lib/dsl-reference.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(join(root, "docs", "dsl.md"), renderDslMarkdown());
console.log("wrote docs/dsl.md");
