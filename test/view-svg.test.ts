// The figure renderers are the one place a user-supplied string reaches markup
// that the app injects with dangerouslySetInnerHTML. They are also the surface
// a chat client renders. Both make escaping non-negotiable.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { viewToSvg, viewTitle, esc } from "../lib/view-svg.ts";
import type { ViewResult } from "../lib/types.ts";

const survival = (cohort: string): ViewResult => ({
  kind: "survival", cohorts: [cohort],
  curves: [{ cohort, points: [{ t: 0, s: 1 }, { t: 5, s: 0.5 }], median: 5, n: 10, events: 5 }],
  caveat: "a caveat that must travel with the figure"
});

describe("figure renderers escape everything a user can name", () => {
  test("a cohort name cannot inject markup", () => {
    const svg = viewToSvg(survival('<script>alert(1)</script>'))!;
    assert.ok(svg.includes("&lt;script&gt;"), "the tag must be escaped");
    assert.equal(svg.includes("<script>"), false, "raw script tag reached the SVG");
  });
  test("quotes and ampersands survive as entities", () => {
    assert.equal(esc('a & "b" <c>'), "a &amp; &quot;b&quot; &lt;c&gt;");
  });
});

describe("a figure always carries its caveat", () => {
  test("the caveat text is rendered into the SVG, not left to the caller", () => {
    const svg = viewToSvg(survival("A"))!;
    assert.ok(svg.includes("caveat that must travel"),
      "an image separated from its method is worse than the number it replaced");
  });
});

describe("renderers refuse rather than draw an empty frame", () => {
  test("an errored view yields no figure", () => {
    assert.equal(viewToSvg({ kind: "survival", error: "nothing to plot" }), null);
  });
  test("a view with an empty payload yields no figure", () => {
    assert.equal(viewToSvg({ kind: "survival", curves: [] }), null);
    assert.equal(viewToSvg({ kind: "cooccurrence", pairs: [] }), null);
    assert.equal(viewToSvg({ kind: "hotspots", hotspots: [] }), null);
  });
  test("an unknown kind yields no figure", () => {
    assert.equal(viewToSvg({ kind: "not-a-view" }), null);
  });
});

describe("figures scale uniformly", () => {
  // preserveAspectRatio="none" shears circles and slants text; it forced the
  // lollipop out of SVG once already and must not come back.
  test("no renderer disables aspect-ratio preservation", () => {
    const svg = viewToSvg(survival("A"))! + (viewToSvg({
      kind: "hotspots", cohorts: ["A"],
      hotspots: [{ gene: "KRAS", mutated: 10, distinctVariants: 2,
        variants: [{ variant: "G12D", type: "Missense_Mutation", pos: 12, n: 6, pct: 60 }] }]
    }) || "");
    assert.equal(/preserveAspectRatio\s*=\s*"none"/.test(svg), false);
  });
  test("titles name the view and its cohorts", () => {
    assert.equal(viewTitle(survival("TP53 mut")), "OS survival — TP53 mut");
  });
});

describe("hotspots figures disclose the same caps the app UI does", () => {
  test("a gene at the variant cap says so, matching the app's own wording", () => {
    const v = { kind: "hotspots", cohorts: ["A"],
      hotspots: [{ gene: "TP53", mutated: 4080, distinctVariants: 867,
        withheld: 100,
        variants: Array.from({ length: 100 }, (_, i) => ({ variant: "V" + i, type: "Missense_Mutation", pos: i + 1, n: 5, pct: 1 })) }] };
    const svg = viewToSvg(v as any)!;
    assert.ok(svg.includes("100 shown of 200 distinct changes"),
      "must disclose the withheld count the same way the app UI does, not silently show a capped list");
  });
  test("a gene under the cap says nothing extra", () => {
    const v = { kind: "hotspots", cohorts: ["A"],
      hotspots: [{ gene: "KRAS", mutated: 10, distinctVariants: 2,
        variants: [{ variant: "G12D", type: "Missense_Mutation", pos: 12, n: 6, pct: 60 }] }] };
    const svg = viewToSvg(v as any)!;
    assert.equal(svg.includes("distinct changes"), false);
  });
});

describe("clinical course figures show the denominator, not just the curve", () => {
  const mk = (over: Record<string, unknown> = {}) => ({
    kind: "course", cohorts: ["A", "B"],
    courseAxis: { binMonths: 3, from: -12, to: 24 },
    caveat: "Aligned on first Treatment.",
    course: [
      { cohort: "A", eventType: "Treatment", variants: ["Treatment", "TREATMENT"], isInterval: true,
        points: [-12, 0, 12, 24].map((t) => ({ t, atRisk: 1000, n: 500, pct: 50 })) },
      { cohort: "B", eventType: "Treatment", variants: ["Treatment"], isInterval: true,
        points: [-12, 0, 12, 24].map((t) => ({ t, atRisk: 800, n: 200, pct: 25 })) }
    ], ...over
  });

  test("the at-risk row is printed — a curve over 40 must not look like one over 24,000", () => {
    const svg = viewToSvg(mk() as any)!;
    assert.match(svg, /patients still observable/);
    assert.ok(svg.includes("1,000") && svg.includes("800"), "risk counts belong in the figure");
  });

  test("an interval event reads as a state, a point event as an occurrence", () => {
    assert.match(viewToSvg(mk() as any)!, /% in this state/);
    const point = mk({ course: [{ cohort: "A", eventType: "Surgery", variants: ["Surgery"], isInterval: false,
      points: [{ t: 0, atRisk: 10, n: 3, pct: 30 }] }] });
    assert.match(viewToSvg(point as any)!, /% with an event/);
  });

  test("the line stops where too few remain observable, and says so", () => {
    const thin = mk({ course: [{ cohort: "A", eventType: "Treatment", variants: ["Treatment"], isInterval: true,
      points: [{ t: 0, atRisk: 900, n: 450, pct: 50 }, { t: 12, atRisk: 3, n: 3, pct: 100 }] }] });
    const svg = viewToSvg(thin as any)!;
    assert.match(svg, /fewer than 10 patients remain observable/,
      "truncation must be disclosed, not left to be inferred from a line that just ends");
  });

  test("cohort names are escaped — they reach <text> and are user input", () => {
    const evil = mk({ cohorts: ["<script>x</script>"],
      course: [{ cohort: "<script>x</script>", eventType: "Treatment", variants: ["Treatment"], isInterval: true,
        points: [{ t: 0, atRisk: 50, n: 25, pct: 50 }] }] });
    const svg = viewToSvg(evil as any)!;
    assert.equal(svg.includes("<script>"), false);
    assert.match(svg, /&lt;script&gt;/);
  });

  test("a course with no series renders nothing rather than an empty frame", () => {
    assert.equal(viewToSvg({ kind: "course", course: [] } as any), null);
    assert.equal(viewToSvg({ kind: "course", error: "no temporal information" } as any), null);
  });

  test("the title names the event types", () => {
    assert.equal(viewTitle(mk() as any), "Clinical course — Treatment — A vs B");
  });
});

describe("sequence Sankey keeps everyone accounted for", () => {
  const mk = () => ({
    kind: "sequence", cohorts: ["A"], caveat: "Lines of therapy.",
    sequence: {
      labelKey: "SUBTYPE", lineGap: 90, steps: 2, foldedLabels: 3, truncated: false,
      panels: [{
        cohort: "A", started: 140, censored: 70,
        nodes: [
          { column: 1, label: "Chemo", n: 100, kind: "regimen" },
          { column: 1, label: "Hormone", n: 40, kind: "regimen" },
          { column: 2, label: "Chemo", n: 30, kind: "regimen" },
          { column: 2, label: "", n: 40, kind: "stopped" },
          { column: 2, label: "", n: 70, kind: "censored" }
        ],
        flows: [
          { column: 1, from: "Chemo", to: "", n: 50, kind: "censored" },
          { column: 1, from: "Chemo", to: "", n: 30, kind: "stopped" },
          { column: 1, from: "Chemo", to: "Chemo", n: 20, kind: "regimen" },
          { column: 1, from: "Hormone", to: "", n: 20, kind: "censored" },
          { column: 1, from: "Hormone", to: "", n: 10, kind: "stopped" },
          { column: 1, from: "Hormone", to: "Chemo", n: 10, kind: "regimen" }
        ]
      }]
    }
  });

  test("both terminals are drawn, and named differently", () => {
    // The whole point of the split: censoring must not read as a clinical stop.
    const svg = viewToSvg(mk() as any)!;
    assert.match(svg, /no further line/);
    assert.match(svg, /record ends here/);
    assert.ok(svg.includes("40") && svg.includes("70"), "each terminal carries its own count");
  });

  test("the legend explains the difference rather than leaving two greys", () => {
    const svg = viewToSvg(mk() as any)!;
    assert.match(svg, /watched, none started/);
    assert.match(svg, /nothing can be concluded/);
  });

  test("every flow with a known source and target is drawn", () => {
    const svg = viewToSvg(mk() as any)!;
    assert.equal((svg.match(/fill-opacity="0\.(32|45)"/g) || []).length, 6);
  });

  test("one scale across columns, so attrition is visible as thinning", () => {
    const svg = viewToSvg(mk() as any)!;
    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="13" height="([\d.]+)"/g)]
      .map((m) => ({ x: +m[1], h: +m[3] }));
    const minX = Math.min(...rects.map((z) => z.x));
    const chemo1 = Math.max(...rects.filter((r) => r.x === minX).map((r) => r.h));
    const smallest = Math.min(...rects.filter((r) => r.x !== minX).map((r) => r.h));
    assert.ok(chemo1 > smallest * 2,
      "100 patients must draw taller than 30 — normalising per column would hide the drop-off");
  });

  test("two cohorts share one scale, so their sizes stay comparable", () => {
    const v = mk() as any;
    const small = JSON.parse(JSON.stringify(v.sequence.panels[0]));
    small.cohort = "B";
    small.nodes.forEach((n: any) => { n.n = Math.round(n.n / 4); });
    small.flows.forEach((f: any) => { f.n = Math.round(f.n / 4); });
    v.sequence.panels.push(small);
    const svg = viewToSvg(v)!;
    const heights = [...svg.matchAll(/<rect x="8" y="[\d.]+" width="13" height="([\d.]+)"/g)].map((m) => +m[1]);
    const tallest = Math.max(...heights), shortest = Math.min(...heights);
    assert.ok(tallest > shortest * 2,
      "a cohort a quarter the size must draw a quarter the height, not be renormalised to match");
    assert.match(svg, /B<\/tspan>|B</, "each panel is named");
  });

  test("labels are escaped — regimen names come from study data", () => {
    const v = mk() as any;
    v.sequence.panels[0].nodes[0].label = "<img src=x>";
    v.sequence.panels[0].flows.forEach((f: any) => { if (f.from === "Chemo") f.from = "<img src=x>"; });
    const svg = viewToSvg(v)!;
    assert.equal(svg.includes("<img"), false);
    assert.match(svg, /&lt;img/);
  });

  test("no flows renders nothing rather than an empty frame", () => {
    assert.equal(viewToSvg({ kind: "sequence", sequence: { panels: [] } } as any), null);
    assert.equal(viewToSvg({ kind: "sequence", error: "no therapy lines found" } as any), null);
  });

  test("the title names the labelling key", () => {
    assert.equal(viewTitle(mk() as any), "Treatment sequence by SUBTYPE — A");
  });
});
