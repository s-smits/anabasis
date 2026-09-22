/**
 * Drive one installed tool through the verifier wall the way a truth check reaches it: resolve the
 * id against a `.toolchain` tree and the host path, then run it inside a cell and require an
 * answer out the other side.
 *
 * The two cells answer "can it be installed" and "can it compute". This answers the third
 * question, "can the product run it", and that is where the 2026-08-20 defects lived: the wall
 * refused what the resolver had accepted. Since 2026-09-03 there is no declared engine registry to
 * parse, so the probe covers what remains — resolution, byte identity, and the wall.
 *
 * Every layer below is a production export of the tree this script runs in. Nothing here is a copy.
 *
 *   bun run-tool.mts '<spec-json>'
 *
 * The spec: { toolId, args?, toolTree?, stdin?, timeoutMs? }. `stdin` is echoed into the subject
 * artifact first, because the cell accepts only bytes the artifact already carries.
 */
import { runSync } from "#src/meta/subprocess.ts";
import { resolveToolInventory } from "#src/verify/tool-inventory.ts";
import { createVerifierHost } from "#src/verify/host.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { mkdtempSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { tmpdir } from "#src/meta/os.ts";
import { closeVerifierLifetime, createVerifierLifetime } from "#src/verify/verifier-lifetime.ts";

interface ProbeSpec {
  toolId: string;
  args?: string[];
  toolTree?: string | null;
  stdin?: string;
  timeoutMs?: number;
}

// SAFETY: the spec is this script's own argv contract, serialised one process earlier by the
// probe that launched it. A spec that does not match fails at the first field read below, which
// is where a changed contract is readable.
const spec = JSON.parse(Bun.argv[2] ?? "") as ProbeSpec;
const args = spec.args ?? [];

// Layer one. Resolution is derived, not declared: the id is a plain command name and the host
// decides which file it names. A miss here is the finding — the tool is not installed where the
// product looks — and it is reported rather than thrown.
const { inventory, missing, invalid } = resolveToolInventory({
  toolIds: [spec.toolId],
  toolTree: spec.toolTree ?? null,
});
const entry = inventory[spec.toolId];

// An id the resolver did not find is the finding by itself: naming it to the host is an authoring
// defect that throws, so the probe reports the miss instead of provoking it.
if (entry === undefined) {
  console.log(JSON.stringify({ missing, invalid, resolved: false }));
  runtimeProcess.exit(0);
  throw new Error("process exit returned unexpectedly");
}

// Layer two. The wall runs it. The subject carries the stdin bytes so the cell's artifact-derived
// rule is satisfied by the same value the tool reads.
const lifetimeRoot = mkdtempSync(join(tmpdir(), "ana-install-probe-"));
const lifetime = createVerifierLifetime({ root: lifetimeRoot });
const host = createVerifierHost({ inventory, toolTree: spec.toolTree ?? null, lifetime });
const scope = host.openSubject({
  checks: null,
  runId: null,
  phase: "discrimination",
  subjectId: "install-probe",
  attempt: 1,
  artifact: spec.stdin === undefined ? {} : { input: spec.stdin },
  publicTask: null,
});
let run;
let failed = true;
try {
  try {
    run = await scope.port.run({
      toolId: spec.toolId,
      checkId: "install-probe",
      args,
      ...keyIfDefined("stdin", spec.stdin),
      ...keyIfDefined("timeoutMs", spec.timeoutMs),
    });
  } finally {
    await scope.close();
  }
  failed = false;
} finally {
  await closeVerifierLifetime(lifetime, failed ? "failed" : "clean");
}

// Sanity check on the tool itself, unconfined: a session that fails here has a host gap, not a wall
// finding, and the same distinction the cell sessions already draw applies to this one.
const unconfined = runSync([entry.path, ...args]);

console.log(
  JSON.stringify({
    missing,
    invalid,
    resolved: true,
    lifetimeRoot,
    toolSource: entry.source,
    toolDigest: entry.digest,
    executed: run.executed,
    outcome: run.evidence.outcome,
    nonResultReason: run.nonResult?.kind ?? null,
    exitCode: run.exitCode,
    stdoutFirstLine: run.stdout.trim().split("\n")[0] ?? "",
    unconfinedExit: unconfined.exitCode,
  }),
);
