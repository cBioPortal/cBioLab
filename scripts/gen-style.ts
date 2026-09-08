// Writes python/cohortlab/style.json from lib/oncoprint-style.ts. The unit test
// test/oncoprint-style.test.ts fails when the two drift; run this after editing the style.
import { writeFileSync } from "node:fs";
import { STYLE } from "../lib/oncoprint-style.ts";
export const STYLE_JSON = JSON.stringify(STYLE, null, 2) + "\n";
if (process.argv[1] && /gen-style/.test(process.argv[1])) {
  writeFileSync("python/cohortlab/style.json", STYLE_JSON);
  process.stdout.write("wrote python/cohortlab/style.json (" + STYLE_JSON.length + " bytes)\n");
}
