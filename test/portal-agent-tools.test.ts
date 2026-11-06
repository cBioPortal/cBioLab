// The portal pages' assistant tools (app/portal/agent-tools.ts): which tab a name points at, and
// the answers a tool gives before the page is laid out. The tools that run the engine are checked
// in the browser.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { portalTools, resolveTab, type PortalBridge } from "../app/portal/agent-tools.ts";
import type { PageLayout } from "../app/portal/page-doc.ts";

const layout: PageLayout = {
  doc: { study: "s", cohorts: {}, views: [] }, titles: ["A", "B", "C"], names: [], left: ["Pathways: no data"],
  tabs: [
    { title: "Summary", views: [0, 1] },
    { title: "Clinical Data", sub: [{ title: "Patient", views: [2] }, { title: "Samples", views: [1] }] },
    { title: "Trials", views: [], pending: "matching trials" }
  ]
};

describe("a portal page's assistant tools", () => {
  test("a tab is found by its title, any case; the open tab when none is named", () => {
    assert.deepEqual(resolveTab(layout, "summary", ""), { key: "Summary", views: [0, 1] });
    assert.deepEqual(resolveTab(layout, undefined, "Summary"), { key: "Summary", views: [0, 1] });
    assert.equal(resolveTab(layout, undefined, "").key, "Summary");
  });
  test("a tab with sub-tabs opens its named sub-tab, or its first", () => {
    assert.deepEqual(resolveTab(layout, "Clinical Data › Samples", ""), { key: "Clinical Data › Samples", views: [1] });
    assert.deepEqual(resolveTab(layout, "Clinical Data", ""), { key: "Clinical Data › Patient", views: [2] });
  });
  test("a tab not built yet says what it will show", () => {
    assert.equal(resolveTab(layout, "Trials", "").pending, "matching trials");
  });
  test("an unknown tab or sub-tab is refused, listing what there is", () => {
    assert.throws(() => resolveTab(layout, "Nope", ""), /the tabs are: Summary, Clinical Data, Trials/);
    assert.throws(() => resolveTab(layout, "Clinical Data › Nope", ""), /sub-tabs are: Patient, Samples/);
  });
  test("before the page is laid out, tools say so instead of failing", async () => {
    const bridge: PortalBridge = { page: "patient", subject: { study: "s" }, doc: null, layout: null, open: "", openTab: () => {} };
    const tools = portalTools(() => bridge);
    const page = (await tools.find((t) => t.name === "portal_get_page")!.run({})) as { ready: boolean };
    assert.equal(page.ready, false);
    assert.match(String(await tools.find((t) => t.name === "portal_get_tab_results")!.run({})), /still laying itself out/);
  });
  test("opening a tab goes through the page, by the tab's own title", async () => {
    const opened: string[] = [];
    const bridge: PortalBridge = { page: "patient", subject: {}, doc: layout.doc, layout, open: "", openTab: (k) => opened.push(k) };
    await portalTools(() => bridge).find((t) => t.name === "portal_open_tab")!.run({ tab: "clinical data › samples" });
    assert.deepEqual(opened, ["Clinical Data › Samples"]);
  });
});
