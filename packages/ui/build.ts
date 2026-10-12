import { rmSync } from "../../src/meta/filesystem.ts";

/**
 * The page alone. v1 baked one workspace reading into `dist/` so that it opened without a server;
 * a log holds hidden values, so the static build carries none, and the page reads everything from
 * the server it is opened against (the brief of 11 October, section 8). No environment variable is
 * inlined either.
 */
rmSync("./dist", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: true,
  sourcemap: "linked",
  env: "disable",
});

if (!result.success) {
  for (const log of result.logs) console.error(log.message);
  throw new Error(`the page's build failed with ${String(result.logs.length)} message(s)`);
}
console.log(`built ${String(result.outputs.length)} file(s) into dist/`);
