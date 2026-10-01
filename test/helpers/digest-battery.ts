import { RUN_MANIFEST_NAME } from "../../src/claim/evidence-log.ts";
import { hashBundle } from "../../src/claim/bundle-hash.ts";
import { batteryHash, BATTERY_FILES, fingerprintSlug } from "../../src/claim/fingerprint.ts";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { sha256 } from "../../src/meta/digest.ts";
import { dirname, join } from "../../src/meta/path.ts";
import { publishProductVersion } from "../../src/run/product-versions.ts";

/** Write `files` into the accepted snapshot and publish it as the controller publishes a retained
 *  product version; returns the version's directory. */
export function publishProduct(
  source: Omit<Parameters<typeof publishProductVersion>[0], "fingerprint">,
  files: Record<string, string> = {},
): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(source.acceptedSnapshot, path)), { recursive: true });
    writeFileSync(join(source.acceptedSnapshot, path), text);
  }
  const fingerprint = fingerprintSlug(source.acceptedSnapshot, { slug: source.slug });
  if (!fingerprint.ok) throw new Error(JSON.stringify(fingerprint.findings));
  return publishProductVersion({ ...source, fingerprint });
}

/** Record the fixture's actual product bytes; a trace alone does not bind its corpus. `cases` gives
 *  a run's battery case rows, which the digest reads only through the manifest-verified record. */
export function recordDigestBattery(
  root: string,
  runIds: string[],
  cases: Record<string, unknown[]> = {},
): void {
  const bundleSnapshot = {
    agentHash: hashBundle(join(root, "agent")).hash,
    correctnessModelHash: hashBundle(join(root, "correctness-model"), { excludeTop: [...BATTERY_FILES] })
      .hash,
    taskSetHash: batteryHash(join(root, "correctness-model")),
  };
  for (const runId of runIds) {
    const runDir = join(root, "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "battery.json"),
      JSON.stringify({ runId, bundleSnapshot, cases: cases[runId] ?? [] }),
    );
    // Preserve trace bytes: the fixture has already captured their pointer hashes.
    const files = Object.fromEntries(
      readdirSync(runDir, { recursive: true, encoding: "utf8" })
        .filter((name) => name !== RUN_MANIFEST_NAME && statSync(join(runDir, name)).isFile())
        .map((name) => [name, sha256(readFileSync(join(runDir, name)))]),
    );
    writeFileSync(
      join(runDir, RUN_MANIFEST_NAME),
      JSON.stringify({ schemaVersion: "evidence-stage/v1", files }),
    );
  }
}

/** One battery case row as the battery record keeps it: an accepted submit that passed or failed,
 *  solved from `startedAt`, with the solver's errors. */
export function solveRow(task: { taskId: string }, startedAt: string, pass: boolean, errors: string[] = []) {
  return {
    taskId: task.taskId,
    acceptedSubmit: true,
    truthOk: pass,
    pass,
    runtimeNonResult: null,
    solver: { errors, startedAt },
  };
}
