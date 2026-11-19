// copyText (app/_table/copy-text.ts): the Copy button's clipboard write (MUT-TB-2 / MUT-TB-8). A secure
// page writes through the async Clipboard API; anywhere else a hidden readonly textarea and
// execCommand("copy") stand in, and the textarea never outlives the call.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { copyText } from "../app/_table/copy-text.ts";

type FakeTextarea = { tagName: string; value: string; attrs: Record<string, string>; style: Record<string, string>; readOnly?: boolean;
  selected: boolean; removed: boolean; setAttribute(k: string, v: string): void; select(): void; setSelectionRange(a: number, b: number): void;
  focus(): void; remove(): void };

const g = globalThis as Record<string, unknown>;
const saved = ["window", "navigator", "document"].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);

afterEach(() => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  }
});

const stub = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });

/** a document whose only element is the textarea copyText may create; `attached` is what body holds now */
function fakeDocument(execResult: boolean) {
  const made: FakeTextarea[] = [];
  const attached: FakeTextarea[] = [];
  const execCalls: string[] = [];
  const detach = (el: FakeTextarea) => {
    const i = attached.indexOf(el);
    if (i >= 0) attached.splice(i, 1);
    el.removed = true;
  };
  const doc = {
    createElement(tag: string) {
      const el: FakeTextarea = { tagName: tag.toUpperCase(), value: "", attrs: {}, style: {}, selected: false, removed: false,
        setAttribute(k, v) { this.attrs[k] = v; }, select() { this.selected = true; }, setSelectionRange() { this.selected = true; },
        focus() {}, remove() { detach(this); } };
      made.push(el);
      return el;
    },
    body: {
      appendChild(el: FakeTextarea) { attached.push(el); return el; },
      append(...els: FakeTextarea[]) { attached.push(...els); },
      removeChild(el: FakeTextarea) { detach(el); return el; },
    },
    execCommand(cmd: string) {
      execCalls.push(cmd);
      // the text must be in the page and selected at the moment of the copy
      const live = attached.find((el) => el.tagName === "TEXTAREA");
      assert.ok(live && live.selected, "execCommand ran with a selected textarea in the page");
      return execResult;
    },
  };
  return { doc, made, attached, execCalls };
}

describe("copyText", () => {
  test("C1: a secure context writes through navigator.clipboard.writeText, exactly the text, no textarea", async () => {
    const writes: string[] = [];
    const f = fakeDocument(true);
    stub("window", { isSecureContext: true });
    stub("navigator", { clipboard: { writeText: async (t: string) => { writes.push(t); } } });
    stub("document", f.doc);
    const text = "Gene\tProtein Change\r\nKRAS\tG12D\r\n";
    await copyText(text);
    assert.deepEqual(writes, [text]);
    assert.equal(f.made.length, 0);
    assert.deepEqual(f.execCalls, []);
  });

  test("C2: a non-secure context copies from a readonly textarea it selects and then removes", async () => {
    const writes: string[] = [];
    const f = fakeDocument(true);
    stub("window", { isSecureContext: false });
    stub("navigator", { clipboard: { writeText: async (t: string) => { writes.push(t); } } });
    stub("document", f.doc);
    await copyText("a\tb\r\n1\t2\r\n");
    assert.deepEqual(writes, []);
    const areas = f.made.filter((el) => el.tagName === "TEXTAREA");
    assert.equal(areas.length, 1);
    const ta = areas[0];
    assert.equal(ta.value, "a\tb\r\n1\t2\r\n");
    assert.ok(ta.readOnly === true || "readonly" in ta.attrs, "the textarea is readonly");
    assert.ok(ta.selected);
    assert.deepEqual(f.execCalls, ["copy"]);
    assert.ok(ta.removed && f.attached.length === 0, "the textarea is gone afterwards");
  });

  test("C3: execCommand returning false rejects, and the textarea is still removed", async () => {
    const f = fakeDocument(false);
    stub("window", { isSecureContext: false });
    stub("navigator", {});
    stub("document", f.doc);
    await assert.rejects(copyText("x"));
    assert.deepEqual(f.execCalls, ["copy"]);
    assert.equal(f.made.length, 1);
    assert.ok(f.made[0].removed && f.attached.length === 0, "the textarea is gone after the failure");
  });
});
