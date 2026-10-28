// Every view kind that reads a survival endpoint names the patients it leaves out for want of a
// status or a time: its runner is wrapped by reportsLeftOut in lib/views/index.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";

/** the builders through which a view reads a survival endpoint */
const READS_ENDPOINT = /survivalMonthsSql|osCte\(|survivalCounts\(|coxRows\(|riskmodelRowsSql|incidenceCountsSql|txEndpointCountsSql|anchoredSurvival/;

test("every view kind that reads a survival endpoint reports the patients it leaves out", () => {
  const index = readFileSync("lib/views/index.ts", "utf8");
  const reading = readdirSync("lib/views").filter((k) => ["run.ts", "sql.ts"].some((f) =>
    existsSync("lib/views/" + k + "/" + f) && READS_ENDPOINT.test(readFileSync("lib/views/" + k + "/" + f, "utf8"))));
  assert.ok(reading.includes("survival") && reading.includes("cox"), "the detection finds the survival views: " + reading.join(", "));
  const unwrapped = reading.filter((k) => !new RegExp("^  " + k + ": reportsLeftOut\\(", "m").test(index));
  assert.deepEqual(unwrapped, []);
});
