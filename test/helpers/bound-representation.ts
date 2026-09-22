import { writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { CONFORMANCE_PROBE_POLICY } from "../../src/claim/conformance-evidence.ts";
import { batteryHash } from "../../src/claim/fingerprint.ts";

/** Bind a fixture tree's public representation: the COMPILED public artifact schema hash is the
 *  identity a candidate carries into adoption. Call AFTER correctness-model/tasks.json is
 *  written — the conformance row also binds the battery bytes — and make sure agent/ exists. */
export function writeBoundRepresentation(
  dir: string,
  schemaHash = "sha256:test-schema",
  specBytes = JSON.stringify({ tools: ["bind_slot"] }),
): void {
  writeFileSync(join(dir, "agent", "tools-spec.json"), specBytes);
  writeFileSync(
    join(dir, "conformance.json"),
    JSON.stringify({
      schema: "tool-conformance/v4",
      toolsSpecHash: new Bun.CryptoHasher("sha256").update(specBytes).digest("hex"),
      taskSetHash: batteryHash(join(dir, "correctness-model")),
      probePolicy: CONFORMANCE_PROBE_POLICY,
      publicArtifactSchemaHash: schemaHash,
      verifierEnvironmentHash: null,
      worker: {
        schema: "generated-tool-worker/v3",
        generatedSourceDigest: "source",
        workerPolicyIdentity: "policy",
        registrationDigest: "registration",
        toolSchemaDigest: "tool-schema",
        artifactWriterNames: ["bind_slot"],
      },
    }),
  );
}
