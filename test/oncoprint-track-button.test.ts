// Each track's ⋮ button (ONC-LY-2), from the legacy source (cbioportal-frontend @ cd8c6df):
//   TOV = packages/oncoprintjs/src/js/oncoprinttrackoptionsview.ts renderTrackOptions 355-400: a
//         menu-dots button on every track, at the track's top, in a column between the label and
//         the track info; clicking it toggles the track's menu (showTrackMenu / hideTrackMenu 128-145);
//   OS  = src/globalStyles/oncoprintStyles.scss 1-20: the buttons hidden (opacity 0) until the
//         oncoprint is hovered.
// Cases:
//   B1  the button sits left of the row's %, or of the gutter's edge when the row has none
//   B2  on screen the OQL line stops before the button; an export (no buttons) keeps the room
//   B3  the buttons are hidden until the figure is hovered, shown while focused or open
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draw, GEOM, menuButtonX, type VisibleGroup } from "../app/_oncoprint/canvas.ts";
import { packContract, unpackContract } from "../lib/oncoprint-binary.ts";

const w = (s: string) => s.length * 6;

describe("B1: where the button sits", () => {
  test("no %: against the gutter's edge", () => {
    assert.equal(menuButtonX({}, "", w), GEOM.gutter - 8 - GEOM.menuW);
  });
  test("a %: left of it, with the same 6 px the label keeps", () => {
    assert.equal(menuButtonX({ freqPct: 37 }, "37% / 37%", w), GEOM.gutter - 8 - (9 * 6 + 6) - GEOM.menuW);
  });
});

function sublabels(menuButtons: boolean): string[] {
  const c = {
    study: "s", unit: "patient", groups: [{ name: "all", start: 0, count: 1 }], columns: ["P1"], stats: {},
    conventions: { cna: "", notProfiled: "", frequencyDenominator: "", annotation: "", lineGap: 0, sort: [] },
    tracks: [{ kind: "gene", label: "KRAS", cells: [0], freqPct: 0, altered: 0, profiled: 1, sublabel: ": AMP HOMDEL MUT FUSION" }]
  };
  const buf = packContract(c as any);
  const data = unpackContract(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const texts: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === "getTransform") return () => ({ a: 1 });
      if (k === "measureText") return (s: string) => ({ width: w(s) });
      if (k === "fillText") return (s: string) => texts.push(s);
      if (k in state) return state[k];
      return () => {};
    },
    set(_t, k, v) { state[k] = v; return true; }
  }) as unknown as CanvasRenderingContext2D;
  const groups: VisibleGroup[] = [{ name: "all", start: 0, count: 1, patients: 1 }];
  draw(ctx, data, Uint32Array.from([0]), groups, { zoom: 10, scrollX: 0, whitespace: false }, 900, undefined, { menuButtons });
  return texts.filter((s) => s.startsWith(": "));
}

describe("B2: the OQL line makes room on screen", () => {
  test("an export keeps the whole cut line; on screen it stops before the button", () => {
    assert.deepEqual(sublabels(false), [": AMP HOMDEL MU..."]);
    const [onScreen] = sublabels(true);
    assert.ok(onScreen.endsWith("...") && onScreen.length < ": AMP HOMDEL MU...".length, onScreen);
    assert.ok(4 + w("KRAS") + w(onScreen) <= menuButtonX({ freqPct: 0 }, "0%", w), "ends before the button");
  });
});

describe("B3: hidden until hovered", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  test("opacity 0 at rest; 1 under a hovered figure, focused, or open", () => {
    assert.match(css, /\.onco-trackbtn \{[^}]*opacity: 0;/);
    assert.match(css, /\.onco-plot:hover \.onco-trackbtn, \.onco-trackbtn:focus-visible, \.onco-trackbtn\.is-open \{ opacity: 1; \}/);
  });
});
