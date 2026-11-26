import { rmSync } from "../../src/meta/filesystem.ts";

/**
 * Builds the static bundle into `dist/`. Campaign logs hold hidden values, so the bundle embeds no
 * log data or environment; the page reads everything from its API server.
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
