// A module loader that lets a node test import the app's React components: app/ files (.tsx, and
// .ts that Next compiles rather than node) go through esbuild, extension-less and "@/" imports
// resolve as Next resolves them, and stylesheets load as nothing. Registered by
// test/support/render-views.ts; lib/ keeps node's own type stripping.
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { transform } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const app = join(root, "app") + "/";
const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

function withExtension(path) {
  if (existsSync(path) && statSync(path).isFile()) return path;
  return EXTENSIONS.map((e) => path + e).find((p) => existsSync(p) && statSync(p).isFile());
}

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".css")) return { url: "data:text/javascript,", shortCircuit: true };
  const local = specifier.startsWith("@/") ? join(root, specifier.slice(2))
    : specifier.startsWith(".") && context.parentURL?.startsWith("file:") ? join(dirname(fileURLToPath(context.parentURL)), specifier) : null;
  const file = local && withExtension(local);
  if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith("file:")) {
    const path = fileURLToPath(url);
    if (path.startsWith(app) && /\.tsx?$/.test(path)) {
      const { code } = await transform(await readFile(path, "utf8"), {
        loader: path.endsWith(".tsx") ? "tsx" : "ts", format: "esm", jsx: "automatic", sourcefile: path, target: "node22",
      });
      return { format: "module", source: code, shortCircuit: true };
    }
  }
  return next(url, context);
}
