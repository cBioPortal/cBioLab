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
