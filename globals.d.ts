// Side-effect CSS imports (next-env.d.ts is auto-generated and must not be edited).
declare module "*.css";
// igv's ESM build: its package "browser" field names the UMD build, which has no default export under the bundler
declare module "igv/dist/igv.esm.js" { export { default } from "igv"; }
