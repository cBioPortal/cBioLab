// What a view kind contributes to the DSL reference (lib/dsl-reference.ts): its row of the Views
// table in docs/dsl.md, its entry in the agent grammar, and the gallery examples that show it off.
// Each kind's lives in lib/views/<kind>/doc.ts and is listed in lib/views/docs.ts.
import type { TemplateDoc } from "../types.ts";
import type { CustomDataset } from "../custom-data-names.ts";

export interface DslExample {
  title: string; note: string;
  /**
   * Authored form: a value may be a "$name" reference, which the engine resolves
   * before anything downstream sees the document.
   */
  doc: TemplateDoc;
  /** one line on WHY this example exists — rendered by the app's Examples tab */
  demonstrates?: string;
  /** view kinds / themes exercised, for grouping in the app */
  tags?: string[];
  /**
   * Uploads the example runs on, as a reader would add them in Explore → Custom data. The
   * Examples tab imports them into the browser before running, and docs:check sends them
   * with the run, exactly as the page does.
   */
  customData?: CustomDataset[];
  /**
   * The name of the view snapshot case this example is (test/support/view-snapshots.ts): its
   * recorded answers and pinned output are test/snapshots/answers/<name>.json.gz and
   * test/snapshots/<name>.*. Each view kind's smallest example is its kind's case.
   */
  snapshot?: string;
}

export interface KindDoc {
  /** a phrase on what it draws, for MCP run_analysis's description: "<kind> (<summary>)" */
  summary?: string;
  /** its row of the Views table, after the kind's own cell: "`fields` | semantics" (markdown) */
  reference: string;
  /** its entry in the agent grammar's "views" list: the view object, then any "//" notes */
  grammar: string;
  /** prose the agent grammar prints after the views list */
  grammarNotes?: string;
  /** the examples written for this kind; they follow the guide's in the gallery and docs/dsl.md */
  examples?: DslExample[];
}
