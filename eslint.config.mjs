// Lint for bugs, not style: type-aware TypeScript rules, the hooks rules, Next's rules and the
// SonarJS rules that point at wrong code. Rules that only enforce a typing discipline at JSON
// boundaries (no-unsafe-*, no-explicit-any) or a taste (nesting, complexity, readonly props) are
// off; turning one on is a separate change that fixes what it finds.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import sonarjs from "eslint-plugin-sonarjs";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import globals from "globals";
import path from "node:path";
import fs from "node:fs";

// View kinds stay independent. Each kind's code is its folder, lib/views/<kind>/ (and its card,
// app/lab/kinds/<kind>.tsx): a kind's files import one another, the shared view modules below and
// anything outside lib/views, never another kind's files and never the registries that list every
// kind; a shared view module imports no kind at all. So a change to one view cannot break another,
// and what two kinds need goes into a shared module.
const SHARED_VIEW_MODULES = ["lib/views/run.ts", "lib/views/shared.ts", "lib/views/rows.ts", "lib/views/covariates.ts",
  "lib/views/kind-def.ts", "lib/views/kind-doc.ts", "lib/views/text.ts", "app/lab/kinds/kind-ui.ts", "app/lab/kinds/parts.tsx"];
const VIEW_REGISTRIES = ["lib/views/index.ts", "lib/views/kinds.ts", "lib/views/docs.ts", "app/lab/kinds/index.ts"];
const kindBoundary = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const rel = (f) => path.relative(context.cwd, f).split(path.sep).join("/");
    const resolve = (f) => [f, f + ".ts", f + ".tsx"].find((x) => /\.tsx?$/.test(x)) && (/\.tsx?$/.test(f) ? f : f + ".ts");
    /** the kind a file belongs to, or null for shared code */
    const kindOf = (f) => SHARED_VIEW_MODULES.includes(f) ? null : (/^lib\/views\/([^/]+)\//.exec(f) || /^app\/lab\/kinds\/([^/.]+)(\/|\.tsx?$)/.exec(f) || [])[1] ?? null;
    const from = rel(context.filename);
    if (VIEW_REGISTRIES.includes(from)) return {};
    const fromKind = kindOf(from);
    const sharedView = SHARED_VIEW_MODULES.includes(from) || /^lib\/figures\//.test(from);
    if (!fromKind && !sharedView) return {};
    const check = (node) => {
      const spec = node.source?.value;
      if (typeof spec !== "string" || !spec.startsWith(".")) return;
      const to = resolve(rel(path.resolve(path.dirname(context.filename), spec)));
      const toKind = kindOf(to);
      const why = VIEW_REGISTRIES.includes(to) ? "the registry that lists every kind"
        : toKind && toKind !== fromKind ? (fromKind ? "another view kind's code" : "one view kind's code, from a module every kind shares") : null;
      if (why) context.report({ node: node.source, message: from + " imports " + to + ", " + why + ". Move what both need into a shared " +
        "module (" + SHARED_VIEW_MODULES.join(", ") + ", lib/figures/) so a change to one view cannot break another." });
    };
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check, ImportExpression: check };
  },
};

// One place for number formats. A number written for a reader goes through lib/chart/format.ts:
// cBioLab's own formats are fmt*, the ones that must read as cbioportal.org writes them are portal*,
// so a percentage or a p-value reads the same in every view. Calling toFixed, toPrecision,
// toExponential or toLocaleString with options anywhere else is an error. The files that still do
// are listed in lint/number-format-baseline.json with how many calls each may keep; a file may lose
// calls, never gain them, and its allowance comes down as they go, until the list is empty.
const NUMBER_FORMAT_BASELINE = JSON.parse(fs.readFileSync(new URL("./lint/number-format-baseline.json", import.meta.url), "utf8"));
const FORMAT_METHODS = new Set(["toFixed", "toPrecision", "toExponential"]);
const numberFormat = {
  meta: { type: "suggestion", schema: [] },
  create(context) {
    const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");
    const allowed = NUMBER_FORMAT_BASELINE[file] ?? 0;
    const found = [];
    const hint = "Number formats live in lib/chart/format.ts: use fmtNum, fmtPct, fmtShare, fmtP, fmtMonths, or a portal* " +
      "one to match cbioportal.org; add a new one there, with a test.";
    return {
      CallExpression(node) {
        const c = node.callee;
        if (c.type !== "MemberExpression" || c.computed || c.property.type !== "Identifier") return;
        const m = c.property.name;
        if (FORMAT_METHODS.has(m) || (m === "toLocaleString" && node.arguments.length > 1)) found.push({ node, m });
      },
      "Program:exit"(program) {
        if (found.length > allowed) {
          for (const { node, m } of found) context.report({ node, message: m + " formats a number outside lib/chart/format.ts" +
            (allowed ? " (this file may keep " + allowed + " while it waits to be moved, and has " + found.length + ")" : "") + ". " + hint });
        } else if (found.length < allowed) {
          context.report({ node: program, loc: { line: 1, column: 0 }, message: "this file now formats " + found.length + " number(s) by hand, " +
            "under its allowance of " + allowed + ": set it to " + found.length + " in lint/number-format-baseline.json" +
            (found.length ? "" : " (remove the entry)") + ", so it cannot creep back." });
        }
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [".next/**", ".next-gate/**", ".next-local/**", "node_modules/**", "python/**", "docs/**", "next-env.d.ts"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true },
      globals: { ...globals.node, ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { local: { rules: { "kind-boundary": kindBoundary, "number-format": numberFormat } } },
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      // node:test's test()/describe() return promises the runner already tracks
      "@typescript-eslint/no-floating-promises": ["error", {
        allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it", "suite"] }],
      }],
      // an async onClick/onSubmit is fine in React; the check stays on everywhere else
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      // a switch over a union without a default handles every member (a default routes the rest on purpose)
      "@typescript-eslint/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: true }],
      "no-useless-escape": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],

      // SonarJS: style and taste
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/no-nested-template-literals": "off",
      "sonarjs/no-nested-assignment": "off",
      "sonarjs/no-nested-functions": "off",
      "sonarjs/prefer-read-only-props": "off",
      "sonarjs/function-return-type": "off",
      "sonarjs/prefer-regexp-exec": "off",
      "sonarjs/concise-regex": "off",
      "sonarjs/regex-complexity": "off",
      "sonarjs/no-inverted-boolean-check": "off",
      "sonarjs/no-redundant-optional": "off",
      "sonarjs/use-type-alias": "off",
      "sonarjs/redundant-type-aliases": "off",
      "sonarjs/no-undefined-argument": "off",
      "sonarjs/void-use": "off",
      "sonarjs/table-header": "off",
      "sonarjs/misplaced-loop-counter": "off",
      // duplication is measured as a report of its own, not one function pair at a time
      "sonarjs/no-identical-functions": "off",
      // SonarJS: duplicates of a core or typescript-eslint rule
      "sonarjs/unused-import": "off",
      "sonarjs/no-unused-vars": "off",
      "sonarjs/no-regex-spaces": "off",
      "sonarjs/deprecation": "off",
      "sonarjs/no-dead-store": "off",
      "sonarjs/no-redundant-assignments": "off",
      // SonarJS: wrong for this code — one-line blocks, symmetric maths, sorts of strings, dialog
      // backdrop clicks (event.target === ref), node:test assertions, local scripts' paths and hosts
      "sonarjs/no-unenclosed-multiline-block": "off",
      "sonarjs/arguments-order": "off",
      "sonarjs/argument-type": "off",
      "sonarjs/no-alphabetical-sort": "off",
      "sonarjs/no-misleading-array-reverse": "off",
      "sonarjs/different-types-comparison": "off",
      "sonarjs/assertions-in-tests": "off",
      "sonarjs/no-trivial-assertions": "off",
      "sonarjs/no-os-command-from-path": "off",
      "sonarjs/publicly-writable-directories": "off",
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/pseudo-random": "off",
      // regexes run on our own data, not on untrusted input
      "sonarjs/super-linear-regex": "off",
      // AWS CDK rules: no infrastructure code here
      ...Object.fromEntries(Object.keys(sonarjs.rules).filter((r) => r.startsWith("aws-")).map((r) => [`sonarjs/${r}`, "off"])),
    },
  },
  {
    files: ["lib/views/**/*.ts", "lib/figures/*.ts", "app/lab/kinds/**/*.tsx"],
    rules: { "local/kind-boundary": "error" },
  },
  {
    files: ["lib/**/*.ts", "app/**/*.{ts,tsx}", "mcp/**/*.ts"],
    ignores: ["lib/chart/format.ts"],
    rules: { "local/number-format": "error" },
  },
  {
    files: ["**/*.{cjs,mjs,js}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      // the e2e checks start each result with what it means if the step never got that far
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/set-state-in-render": "error",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    ...nextPlugin.configs["core-web-vitals"],
  },
  {
    files: ["app/**/*.tsx"],
    ...jsxA11y.configs.recommended,
  },
  {
    files: ["app/**/*.tsx"],
    rules: {
      // our wrappers around an <input> or a labelable Radix trigger
      "jsx-a11y-x/label-has-associated-control": ["error", { controlComponents: ["DraftInput", "Input", "Checkbox", "OptionSelect", "Choice"] }],
      // autofocus only ever lands on the first field of a dialog or inline editor the user just opened
      "jsx-a11y-x/no-autofocus": "off",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      // images here are data: URLs drawn by the engine, which next/image cannot optimise
      "@next/next/no-img-element": "off",
      // a Pages Router rule; app/layout.tsx is the App Router's root layout
      "@next/next/no-page-custom-font": "off",
      // the agent tools navigate with a full page load on purpose
      "@next/next/no-location-assign-relative-destination": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
);
