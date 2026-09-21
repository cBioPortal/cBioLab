import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseToken, suggestToken, type QuickFilterContext } from "../lib/quickfilter.ts";

const ctx: QuickFilterContext = {
  genes: ["TP53", "KRAS", "STK11"],
  attributes: ["SEX", "CURRENT_AGE_DEID", "CANCER_TYPE"],
  eventTypes: ["Treatment", "Diagnosis", "Progression", "Lab_Test"],
  eventKeys: { Treatment: ["SUBTYPE"], Lab_Test: ["TEST", "RESULT"] },
  eventValues: {
    Treatment: { SUBTYPE: ["Immunotherapy", "Chemotherapy"] },
    Lab_Test: { TEST: ["PSA", "CEA"] }
  },
  attributeValues: { SEX: ["Female", "Male"], CANCER_TYPE: ["Non-Small Cell Lung Cancer", "Breast Cancer"] }
};

describe("parseToken: OQL", () => {
  test("bare gene", () => assert.deepEqual(parseToken("TP53", ctx), { kind: "oql", q: "TP53" }));
  test("gene: spec", () => assert.deepEqual(parseToken("TP53: MUT", ctx), { kind: "oql", q: "TP53: MUT" }));
  test("gene: DRIVER", () => assert.deepEqual(parseToken("STK11: DRIVER", ctx), { kind: "oql", q: "STK11: DRIVER" }));
  test("negated with !", () => assert.deepEqual(parseToken("!TP53: MUT", ctx), { not: { kind: "oql", q: "TP53: MUT" } }));
  test("negated with NOT", () => assert.deepEqual(parseToken("NOT TP53: MUT", ctx), { not: { kind: "oql", q: "TP53: MUT" } }));
});

describe("parseToken: clinical", () => {
  test("string equality", () => assert.deepEqual(parseToken("SEX = Female", ctx), { kind: "clinical", attribute: "SEX", op: "=", value: "Female" }));
  test("numeric comparison", () => assert.deepEqual(parseToken("CURRENT_AGE_DEID > 65", ctx), { kind: "clinical", attribute: "CURRENT_AGE_DEID", op: ">", value: 65 }));
  test("quoted multi-word value", () => assert.deepEqual(parseToken('CANCER_TYPE = "Non-Small Cell Lung Cancer"', ctx),
    { kind: "clinical", attribute: "CANCER_TYPE", op: "=", value: "Non-Small Cell Lung Cancer" }));
  test("unknown attribute falls through to a helpful error, not a wrong guess", () => {
    assert.throws(() => parseToken("NOT_A_REAL_ATTR = 1", ctx), /couldn't read/);
  });
});

describe("parseToken: event presence", () => {
  test("bare event type", () => assert.deepEqual(parseToken("Treatment", ctx),
    { kind: "event", a: { eventType: "Treatment" }, rel: { type: "NONE" } }));
  test("occurrence prefix", () => assert.deepEqual(parseToken("first Diagnosis", ctx),
    { kind: "event", a: { eventType: "Diagnosis", occurrence: "FIRST" }, rel: { type: "NONE" } }));
  test("attrs filter (known key -> string equality)", () => assert.deepEqual(parseToken("Treatment: SUBTYPE=Immunotherapy", ctx),
    { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immunotherapy" }] }, rel: { type: "NONE" } }));
  test("numeric filter (comparison operator)", () => assert.deepEqual(parseToken("Lab_Test: RESULT>100", ctx),
    { kind: "event", a: { eventType: "Lab_Test", numeric: { key: "RESULT", op: ">", value: 100 } }, rel: { type: "NONE" } }));
  test("attrs + numeric together", () => assert.deepEqual(parseToken("Lab_Test: TEST=PSA RESULT>100", ctx),
    { kind: "event", a: { eventType: "Lab_Test", attrs: [{ key: "TEST", value: "PSA" }], numeric: { key: "RESULT", op: ">", value: 100 } }, rel: { type: "NONE" } }));
  test("naive suffix sets priorGuard", () => {
    const r = parseToken("first Treatment naive", ctx) as any;
    assert.equal(r.priorGuard, true);
    assert.equal(r.a.occurrence, "FIRST");
  });
  test("second numeric filter is rejected, not silently overwritten", () => {
    assert.throws(() => parseToken("Lab_Test: RESULT>100 RESULT<200", ctx), /only one numeric filter/);
  });
  test("an unrecognized event type still gets treated as a possible (unlisted) gene, same as OQL's own permissiveness", () => {
    // the gene shortlist is a shortcut, not a whitelist (matches the rest of
    // this app) — lib/oql.ts itself never validates gene existence either,
    // so a short alphanumeric word falls through to OQL rather than erroring
    assert.deepEqual(parseToken("NotARealEventType", ctx), { kind: "oql", q: "NotARealEventType" });
  });
  test("genuinely unreadable input (spaces, no colon, no operator, no relation) is a clear error", () => {
    assert.throws(() => parseToken("Not A Real Anything Here", ctx), /couldn't read/);
  });
  test("an empty/not-yet-loaded event-type catalog never accepts arbitrary text as an event", () => {
    // this must fail loudly rather than silently treat "anything typed" as a
    // real event type just because the catalog hasn't loaded yet
    assert.throws(() => parseToken("Made Up Event Type", {}), /couldn't read/);
    assert.throws(() => parseToken("Made Up Event Type", { eventTypes: [] }), /couldn't read/);
  });
});

describe("parseToken: event relations", () => {
  test("BEFORE with a max-day window", () => assert.deepEqual(parseToken("Diagnosis before Treatment <=90d", ctx), {
    kind: "event",
    a: { eventType: "Diagnosis" }, b: { eventType: "Treatment" },
    rel: { type: "BEFORE", maxDays: 90 }
  }));
  test("BEFORE with a min-max range", () => assert.deepEqual(parseToken("Diagnosis before Treatment 30-90d", ctx), {
    kind: "event",
    a: { eventType: "Diagnosis" }, b: { eventType: "Treatment" },
    rel: { type: "BEFORE", maxDays: 90, minDays: 30 }
  }));
  test("BEFORE with no window is a clear error, not a silent default", () => {
    assert.throws(() => parseToken("Diagnosis before Treatment", ctx), /needs a day window/);
  });
  test("DURING needs no window, and flips typed order to match the compiler's a=container/b=contained convention", () => assert.deepEqual(parseToken("Treatment during Diagnosis", ctx), {
    kind: "event",
    // "Treatment during Diagnosis" means Treatment (contained) falls within
    // Diagnosis's (container) span — the compiler's `a` is always the
    // container, so `a` must be the event named SECOND here, not first.
    a: { eventType: "Diagnosis" }, b: { eventType: "Treatment" },
    rel: { type: "DURING" }
  }));
  test("NOT_FOLLOWED_BY defaults observed:true (never a silent absence)", () => assert.deepEqual(
    parseToken("Treatment not_followed_by Progression <=180d", ctx), {
      kind: "event",
      a: { eventType: "Treatment" }, b: { eventType: "Progression" },
      rel: { type: "NOT_FOLLOWED_BY", withinDays: 180, observed: true }
    }));
  test("occurrence and filters both compose on each side of a relation", () => assert.deepEqual(
    parseToken("first Diagnosis before Treatment: SUBTYPE=Immunotherapy <=90d", ctx), {
      kind: "event",
      a: { eventType: "Diagnosis", occurrence: "FIRST" },
      b: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immunotherapy" }] },
      rel: { type: "BEFORE", maxDays: 90 }
    }));
  test("negated relation", () => assert.deepEqual(parseToken("!Treatment during Diagnosis", ctx), {
    not: { kind: "event", a: { eventType: "Diagnosis" }, b: { eventType: "Treatment" }, rel: { type: "DURING" } }
  }));
});

describe("suggestToken", () => {
  test("bare partial word suggests matching events, attributes and genes together", () => {
    const s = suggestToken("T", ctx);
    const labels = s.map((x) => x.label);
    assert.ok(labels.includes("Treatment"));
    assert.ok(labels.includes("TP53"));
  });
  test("after a known event type + colon, suggest its attribute keys", () => {
    const s = suggestToken("Treatment: SUB", ctx);
    assert.deepEqual(s.map((x) => x.label), ["SUBTYPE"]);
    assert.equal(s[0].apply, "Treatment: SUBTYPE=");
  });
  test("after KEY=, suggest known values for that key", () => {
    const s = suggestToken("Treatment: SUBTYPE=Immuno", ctx);
    assert.deepEqual(s.map((x) => x.label), ["Immunotherapy"]);
    assert.equal(s[0].apply, "Treatment: SUBTYPE=Immunotherapy");
  });
  test("once a relation keyword is typed, no more structural suggestions (free text)", () => {
    assert.deepEqual(suggestToken("Diagnosis before Tre", ctx), []);
  });
  test("empty draft suggests nothing", () => assert.deepEqual(suggestToken("", ctx), []));

  test("a complete gene (no colon yet) suggests OQL qualifiers and a second gene", () => {
    const s = suggestToken("TP53", ctx);
    const labels = s.map((x) => x.label);
    assert.ok(labels.includes("MUT"));
    assert.ok(labels.includes("DRIVER"));
    assert.equal(s.find((x) => x.label === "MUT")!.apply, "TP53: MUT");
    const chain = s.find((x) => x.label === "TP53;");
    assert.ok(chain);
    assert.equal(chain!.apply, "TP53; ");
  });
  test("after GENE:, suggest OQL modifiers", () => {
    const s = suggestToken("TP53: MU", ctx);
    assert.ok(s.map((x) => x.label).includes("MUT"));
    assert.equal(s.find((x) => x.label === "MUT")!.apply, "TP53: MUT");
  });
  test("MUT= continues into protein-change classes in suggestions too", () => {
    const s = suggestToken("TP53: MUT=TRU", ctx);
    assert.deepEqual(s.map((x) => x.label), ["TRUNC"]);
    assert.equal(s[0].apply, "TP53: MUT=TRUNC");
  });
  test("a second gene after ';' suggests modifiers for THAT gene, not the first", () => {
    const s = suggestToken("TP53: MUT; KRAS: MU", ctx);
    assert.ok(s.map((x) => x.label).includes("MUT"));
    assert.equal(s.find((x) => x.label === "MUT")!.apply, "TP53: MUT; KRAS: MUT");
  });
  test("typing the second gene's NAME (no colon yet) still gets gene suggestions, not silence", () => {
    // this is the state right after picking "TP53;" from the chain-suggestion
    // and starting to type the next gene — must not fall through to nothing
    // just because there's no colon anywhere in the CURRENT entry yet
    const s = suggestToken("TP53; KRA", ctx);
    assert.deepEqual(s.map((x) => x.label), ["KRAS"]);
    assert.equal(s[0].apply, "TP53; KRAS");
  });
  test("a second gene typed in full (no colon yet) offers its own OQL qualifiers", () => {
    const s = suggestToken("TP53; KRAS", ctx);
    assert.ok(s.map((x) => x.label).includes("MUT"));
    assert.equal(s.find((x) => x.label === "MUT")!.apply, "TP53; KRAS: MUT");
  });
  test("a complete attribute name (no operator yet) suggests real values", () => {
    const s = suggestToken("SEX", ctx);
    assert.deepEqual(s.map((x) => x.label), ["Female", "Male"]);
    assert.equal(s[0].apply, "SEX = Female");
  });
  test("a complete NUMERIC attribute (no known values) suggests operators instead", () => {
    const s = suggestToken("CURRENT_AGE_DEID", ctx);
    const labels = s.map((x) => x.label);
    assert.ok(labels.includes("CURRENT_AGE_DEID >"));
    assert.equal(s.find((x) => x.label === "CURRENT_AGE_DEID >")!.apply, "CURRENT_AGE_DEID > ");
  });
  test("after ATTR =, filters values by what's typed so far", () => {
    const s = suggestToken("CANCER_TYPE = Non", ctx);
    assert.deepEqual(s.map((x) => x.label), ["Non-Small Cell Lung Cancer"]);
    assert.equal(s[0].apply, "CANCER_TYPE = Non-Small Cell Lung Cancer");
  });
  test("negation prefix survives into applied suggestions", () => {
    const s1 = suggestToken("!TP53", ctx);
    assert.equal(s1.find((x) => x.label === "MUT")!.apply, "!TP53: MUT");
    const s2 = suggestToken("NOT SEX", ctx);
    assert.equal(s2[0].apply, "NOT SEX = Female");
  });
});
