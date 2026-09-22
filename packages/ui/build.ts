import { rmSync } from "../../src/meta/filesystem.ts";
import workspaceEvidence from "./workspace-plugin.ts";

/** The static page: `dist/` carries the evidence it was built from and opens without a server. */
rmSync("./dist", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: true,
  sourcemap: "linked",
  plugins: [workspaceEvidence],
});

if (!result.success) {
  for (const log of result.logs) console.error(log.message);
  throw new Error(`observatory build failed with ${result.logs.length} message(s)`);
}
console.log(`built ${result.outputs.length} file(s) into dist/`);
