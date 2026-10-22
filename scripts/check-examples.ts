// docs:check and check:methods off one run of the gallery examples, as scripts/gate.sh runs them:
// each needs every example's result, and running all of them is minutes against the warehouse.
// Needs DB credentials (`node --env-file=.env.local`) and `uv` on the PATH.
import { runExamples } from "./examples-run.ts";
import { checkDocs } from "./check-dsl-doc.ts";
import { checkMethods } from "./check-method-scripts.ts";

const runs = await runExamples();
const failed = checkDocs(runs) + await checkMethods(runs);
process.exit(failed ? 1 : 0);
