// Serverless environments (Vercel functions) ship no system fonts, so librsvg
// (inside sharp) renders SVG <text> as missing-glyph boxes. Point fontconfig at
// a font bundled with the deploy. Must run before sharp's first SVG render in
// the process — fontconfig reads FONTCONFIG_PATH lazily at first use.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let done = false;

export function ensureFonts() {
  if (done) return;
  done = true;
  const fontDir = join(process.cwd(), "assets", "fonts");
  if (!existsSync(join(fontDir, "IBMPlexSans-Regular.ttf"))) return; // dev box: system fonts exist
  const confDir = "/tmp/fontconfig";
  const cacheDir = "/tmp/fontconfig-cache";
  mkdirSync(confDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(confDir, "fonts.conf"),
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n` +
    `  <dir>${fontDir}</dir>\n  <cachedir>${cacheDir}</cachedir>\n</fontconfig>\n`);
  process.env.FONTCONFIG_PATH = confDir;
  process.env.FONTCONFIG_FILE = join(confDir, "fonts.conf");
}
