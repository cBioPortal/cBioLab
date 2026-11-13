// The co-expression view's results text (lib/views/coexpression/kind.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { kindText } from "./support/kind-text.ts";
import { coexpressionKind } from "../lib/views/coexpression/kind.ts";

test("a pair with no correlation and no per-site meta-analysis", () => {
  const [t] = kindText(coexpressionKind, { coexpression: [{ a: "EGFR", b: "ERBB2", r: null, n: 2, p: 1, q: 1, rMeta: null }] });
  assert.ok(t.endsWith("EGFR/ERBB2: r=— (n=2) p=1 q=1"), t);
});
