import { rmSync } from "../../src/meta/filesystem.ts";

/**
 * Builds the static front-end bundle into `dist/`. Because campaign logs contain hidden evaluation
 * values, the static bundle embeds no log data and no environment variables; the page instead
 * fetches all state from the API server it connects to.
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
