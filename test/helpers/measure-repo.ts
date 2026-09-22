/**
 * The adopted-product tree a measurement test measures, and the manifest it measures it under.
 *
 * Four `harness-measure*` files built the same `domains/bridge-truss` fixture: the matching slug,
 * the bare task array the build loop records, and — where the case needs it — conformance evidence
 * hash-joined to those exact tool-specification and task bytes. One owner instead of four.
 *
 * The scratch root sits inside the checkout on purpose, so a generated bundle under it resolves its
 * `@ana/*` imports through the root `node_modules`; `test/helpers/scratch.ts` owns its removal.
 */
import { mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { batteryHash } from "../../src/claim/fingerprint.ts";
import { CONFORMANCE_PROBE_POLICY } from "../../src/claim/conformance-evidence.ts";
import type { AskManifest } from "../../src/run/ask-manifest.ts";
import {
  type HarnessMeasureOptions,
  measureHarness,
  measurementDriverId,
} from "../../src/run/harness-measure.ts";
import { MATCHING_TASKS, MATCHING_TOOLS_SPEC, writeMatchingSlug } from "./matching-fixture.ts";
import { scratchDir } from "./scratch.ts";

/** The driver is slug-generic, so the tests supply their own manifest instead of importing one. */
export const MANIFEST: AskManifest = { slug: "bridge-truss", domain: "bridge-truss", expectedTasks: 25 };

export const DRIVER_ID = measurementDriverId(MANIFEST.slug);

export const measure = (options: HarnessMeasureOptions) => measureHarness(MANIFEST, options);

/** A scratch root inside the checkout, registered for removal. A file pairs it with one
 *  `afterAll(cleanupScratch)`. */
export const measureScratch = (): string => scratchDir(".ana-scratch-measure-", import.meta.dir);

/** A temporary adopted-product fixture under domains/bridge-truss, with the task array format the
 *  build loop records. Options add the tool specification and conformance evidence bound to the
 *  exact specification and task bytes that measurement will read. */
export function scaffoldRepo(root: string, opts: { toolsSpec: boolean; conformance?: boolean }): string {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "thresholds.frozen.yaml"), "schema: test-thresholds\n");
  const slugDir = join(root, "domains", "bridge-truss");
  writeMatchingSlug(slugDir);
  writeFileSync(join(slugDir, "correctness-model", "tasks.json"), JSON.stringify(MATCHING_TASKS));
  const specBytes = JSON.stringify(MATCHING_TOOLS_SPEC);
  if (opts.toolsSpec) {
    writeFileSync(join(slugDir, "agent", "tools-spec.json"), specBytes);
  }
  if (opts.conformance === true) {
    writeFileSync(
      join(slugDir, "conformance.json"),
      JSON.stringify({
        schema: "tool-conformance/v4",
        toolsSpecHash: new Bun.CryptoHasher("sha256").update(specBytes).digest("hex"),
        taskSetHash: batteryHash(join(slugDir, "correctness-model")),
        probePolicy: CONFORMANCE_PROBE_POLICY,
        publicArtifactSchemaHash: "sha256:test-schema",
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
  return root;
}
