import { RUN_MANIFEST_NAME } from "../../src/claim/evidence-log.ts";
import { hashBundle } from "../../src/claim/bundle-hash.ts";
import { batteryHash, BATTERY_FILES } from "../../src/claim/fingerprint.ts";
import { readdirSync, readFileSync, statSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { sha256 } from "../../src/meta/digest.ts";
import { join } from "../../src/meta/path.ts";

/** Record the fixture's actual product bytes; a trace alone does not bind its corpus. */
export function recordDigestBattery(root: string, runIds: string[]): void {
  const bundleSnapshot = {
    agentHash: hashBundle(join(root, "agent")).hash,
    correctnessModelHash: hashBundle(join(root, "correctness-model"), { excludeTop: [...BATTERY_FILES] })
      .hash,
    taskSetHash: batteryHash(join(root, "correctness-model")),
  };
  for (const runId of runIds) {
    const runDir = join(root, "runs", runId);
    writeFileSync(join(runDir, "battery.json"), JSON.stringify({ runId, bundleSnapshot, cases: [] }));
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
