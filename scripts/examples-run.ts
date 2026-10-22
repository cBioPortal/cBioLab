// Every gallery example run once, for the checks that read their results: docs:check (they run and
// give their pinned counts) and check:methods (their method scripts reproduce them).
// `npm run check:examples` (scripts/check-examples.ts) runs both off one pass, which is what
// scripts/gate.sh does.
//
// Examples run PARALLEL at a time in this one process, so lib/ch.ts's CLICKHOUSE_MAX_INFLIGHT still
// bounds what reaches the warehouse at once. Results come back in EXAMPLES order whatever order they
// finish in, so the reports read the same as a serial run's.
import { pathToFileURL } from "url";
import { EXAMPLES, type DslExample } from "../lib/dsl-reference.ts";
import { runAnalysis } from "../lib/analysis.ts";
import { withRequestCustomData } from "../lib/custom-data-server.ts";
import type { AnalysisResult } from "../lib/types.ts";

const PARALLEL = 4;

export interface ExampleRun { ex: DslExample; result?: AnalysisResult; error?: string }

export async function runExamples(examples: DslExample[] = EXAMPLES): Promise<ExampleRun[]> {
  const runs: ExampleRun[] = new Array(examples.length);
  let next = 0;
  async function worker() {
    while (next < examples.length) {
      const i = next++, ex = examples[i];
      // an example's uploads travel with it, exactly as the page sends them
      try { runs[i] = { ex, result: await withRequestCustomData(ex.customData, () => runAnalysis(ex.doc)) }; }
      catch (e) { runs[i] = { ex, error: String((e as Error)?.message || e) }; }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return runs;
}

/** Whether the module at `url` is the script node was started with, rather than an import. */
export const isMain = (url: string) => !!process.argv[1] && url === pathToFileURL(process.argv[1]).href;
