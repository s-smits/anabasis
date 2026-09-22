/**
 * One Built Harness from the command line: export a standalone copy, solve one task or check one
 * artifact (USAGE). The bundle is a directory with `agent/` and `correctness-model/`, or a project
 * id, which names the version its run selected. An export copies this file and runs it as
 * `bun run solve` and `bun run check` from its own root.
 */
import { existsSync } from "../../src/meta/filesystem.ts";
import { join, resolve } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { asError } from "../../src/meta/runtime-values.ts";
import { checkBundleArtifact, runBundleTask } from "../../src/run/bundle-entry.ts";
import { exportBundle } from "../../src/run/bundle-export.ts";
import { selectedProductDir } from "../../src/run/product-versions.ts";

const USAGE = [
  "usage:",
  "  harness export <bundle-dir | project id> <out-dir>",
  "  harness run <bundle-dir | project id> <task id | task.json> [out-dir]",
  "  harness check <bundle-dir | project id> <task id | task.json> <artifact.json> [out-dir]",
].join("\n");

const REPO_ROOT = resolve(import.meta.dir, "..", "..");

async function main(argv: readonly string[]): Promise<number> {
  const [command, named, first, second, third] = argv;
  const bundle =
    named === undefined
      ? undefined
      : resolve(existsSync(named) ? named : selectedProductDir(REPO_ROOT, named));
  if (command === "export" && bundle !== undefined && first !== undefined) {
    console.log(JSON.stringify(exportBundle(REPO_ROOT, bundle, first), null, 2));
    return 0;
  }
  if (command === "run" && bundle !== undefined && first !== undefined) {
    const outDir = second ?? join(bundle, "runs-local", new Date().toISOString().replace(/[:.]/g, "-"));
    const result = await runBundleTask(bundle, first, { outDir });
    console.log(JSON.stringify(result, null, 2));
    return result.accepted ? 0 : 1;
  }
  if (command === "check" && bundle !== undefined && first !== undefined && second !== undefined) {
    const verdict = await checkBundleArtifact(bundle, first, second, third ?? join(bundle, "checks-local"));
    console.log(JSON.stringify(verdict, null, 2));
    return verdict.pass === true ? 0 : 1;
  }
  console.error(USAGE);
  return 2;
}

// A refusal (no bundle, a non-empty target, an unknown task) is one line for the operator, not a stack.
runtimeProcess.exitCode = await main(Bun.argv.slice(2)).catch((error: unknown) => {
  console.error(asError(error).message);
  return 2;
});
