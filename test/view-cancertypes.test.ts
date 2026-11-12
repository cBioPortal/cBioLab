// The cancertypes view's runner (lib/views/cancertypes/run.ts), driven with a hand-made participant:
// the order of the groups (by share when frequencies are drawn, by count when counts are) and the
// results text's unit.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCancertypes } from "../lib/views/cancertypes/run.ts";
import { cancertypesKind } from "../lib/views/cancertypes/kind.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import { PRIMARY } from "../lib/ch.ts";

type Row = Record<string, unknown>;
const ALL = "\x01all";
const grp = (grp: string, profiled: number, altered: number): Row =>
  ({ gene: "*", grp, label: grp, profiled, altered, mutation: altered, amp: 0, homdel: 0, sv: 0, multiple: 0 });
// Small: 4 of 10 altered (40%); Large: 30 of 300 (10%); Mid: 20 of 50 (40%)
const ROWS: Row[] = [grp("Small", 10, 4), grp("Large", 300, 30), grp("Mid", 50, 20),
  { gene: "*", grp: ALL, profiled: 360, altered: 54 }];
const TOT: Row[] = [{ grp: "Small", samples: 10, mut: 10, cna: 0, sv: 0 }, { grp: "Large", samples: 300, mut: 300, cna: 0, sv: 0 },
  { grp: "Mid", samples: 50, mut: 50, cna: 0, sv: 0 }, { grp: ALL, samples: 360 }];

function ctx(): ViewRun {
  const cohort: EvaluatedCohort = { studies: ["s1"], perStudy: { s1: { sql: "SELECT 1", count: 360, samples: 360, mode: "patient-level" } },
    count: 360, samples: 360, text: "" } as never;
  const site = {
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    viewAggregate: async (label: string) => label.startsWith("cancertypes:samples:") ? TOT : ROWS,
  };
  return {
    doc: { study: "s1", cohorts: { A: { study: "s1" } }, views: [] } as never,
    cohorts: { A: cohort }, resolvers: { s1: site } as never, vNames: ["A"], vStudies: ["s1"],
    participationFor: (studies: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: studies.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const run = (view: Record<string, unknown>) => runCancertypes({ kind: "cancertypes", genes: ["KRAS"], minSamples: 1, ...view } as never, ctx());
const order = (r: ViewResult) => (r as unknown as { cancertypes: { panels: { groups: { key: string }[] }[] } }).cancertypes.panels[0].groups.map((g) => g.key);
const text = (r: ViewResult) => {
  const out: string[] = [];
  cancertypesKind.text!(r as never, { out, caveatOf: () => "", noteOf: () => "" } as never);
  return out.join("\n");
};

describe("cancertypes: bar order and unit", () => {
  test("frequencies: highest share first, ties by more profiled", async () => {
    assert.deepEqual(order(await run({})), ["Mid", "Small", "Large"]);
  });
  test("absolute counts: highest count first (CTS-SO-2)", async () => {
    assert.deepEqual(order(await run({ show: "count" })), ["Large", "Mid", "Small"]);
  });
  test("the results text names the unit counted", async () => {
    const p = text(await run({}));
    assert.match(p, /patients profiled for at least one gene/);
    assert.match(p, /54 of 360 profiled patients altered/);
    assert.doesNotMatch(p, /samples/);
    assert.match(text(await run({ unit: "sample" })), /54 of 360 profiled samples altered/);
  });
});
