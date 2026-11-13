// The cumulative-incidence view's results text (lib/views/incidence/kind.ts). Its numbers are
// held to a reference by test/incidence-golden.test.ts, and its columns by test/incidence-columns.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kindText } from "./support/kind-text.ts";
import { incidenceKind } from "../lib/views/incidence/kind.ts";

test("no Gray's test when there is one cohort", () => {
  const [t] = kindText(incidenceKind, { incidence: { eventLabel: "brain metastasis", anchoredTo: null, gray: null,
    curves: [{ cohort: "A", n: 50, events: 5, competing: 3, censored: 42, excluded: { prior: 1, unobserved: 0, noAnchor: 2, noFollowup: 0 } }],
    horizons: [{ months: 12, cells: [{ cohort: "A", f1: 0.1, lo: 0.05, hi: 0.2, naive: 0.12 }] }] } });
  assert.ok(t.endsWith("at 12 months: A 10.0% (95% CI 5.0%–20.0%; 1-KM would say 12.0%)"), t);
});
