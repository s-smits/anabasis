// The external-verifier grounding (C3) fixtures: an installed tool, its reject control and
// the evaluator sources that call runtime.tools.run, shared by the two C3 test files.

import { chmodSync, mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";

import { createVerifierLifetime } from "../../src/verify/verifier-lifetime.ts";
import { createVerifierHost } from "../../src/verify/host.ts";
import type { VerifierHostHandle } from "../../src/verify/verifier-port.ts";
import {
  ACCEPTS,
  BRIEF,
  EVALUATOR_SOURCE,
  REJECTS,
  TASKS,
  TOOLS_SOURCE,
  scratch,
} from "./verification-runner-fixtures.ts";

// The strict verifier, verification THROUGH the runner-owned tool port: the correctness model
// asks the host to run one INSTALLED tool over the submitted artifact's own bytes, and reads the
// exit code. The pin is the grounding chain: host execution → battery.execution →
// VerificationReport.execution — the run facts that close the claim's external-grounding
// clauses. Only the host can write them.
//
// File operands must match string leaves or JSON from the declared artifact and public-task
// projections. An evaluator cannot add an undeclared header of its own to change the compile
// environment (the 2026-09 shim-header runs).
export const TOOL_ID = "matching-tool";
/** Exit 3 on the one contract the corpus' external reject names, 0 otherwise. `cat` and the
 *  shell `case` are all it needs, so the tool spawns under the OS wall with no other binary. */
export const TOOL_SCRIPT =
  '#!/bin/sh\nbody=$(cat "$1")\ncase "$body" in\n  *tool-reject*) exit 3 ;;\nesac\nexit 0\n';
/** Never answers. Its process group is killed at the time limit, producing a `timeout`. */
export const HANGING_TOOL_SCRIPT = "#!/bin/sh\nwhile :; do :; done\n";

/** Answers every artifact but t3's, which contains \"gamma\": one measured case times out while
 *  the controls and the other cases complete. */
export const GAMMA_HANGS_TOOL_SCRIPT =
  '#!/bin/sh\nbody=$(cat "$1")\ncase "$body" in\n  *gamma*) while :; do :; done ;;\n  *tool-reject*) exit 3 ;;\nesac\nexit 0\n';

/** The one reject whose single blocking failure is the external check ghost-ref: t1's own
 *  matching private binding for this control, so both authored checks hold. Only a corpus
 *  carrying it can prove the tool lane rejects anything. */
export const TOOL_REJECT = {
  id: "r-tool",
  taskId: "t1",
  artifact: { assignments: [{ part: "alpha", slot: "tool-reject" }] },
  mutationClass: "tool-rejected-contract",
  expectedCheckId: "ghost-ref",
  hidden: [{ checkId: "expected-binding", expectation: { pairs: [["alpha", "tool-reject"]] } }],
};
/** ghost-ref applies to both families, so the two-part cell needs its own tool reject. */
export const TOOL_REJECTS = [TOOL_REJECT, { ...TOOL_REJECT, id: "r-tool-two-part", taskId: "t2" }];
// The check names toolId; the host stamps its checkId. It writes the canonical artifact's own bytes
// into the cell — no artifact to pass (P0: the host runs the tool over the runner-bound
// subject) — and reads the tool's exit code on its check.
export const TOOL_RUN_BLOCK = `    const run = await runtime.tools.run({
      toolId: "matching-tool",
      args: ["artifact.json"],
      files: { "artifact.json": JSON.stringify(artifact) },
    });
    return run.exitCode === 0;`;
export const EXTERNAL_BRIEF = {
  ...BRIEF,
  truthChecks: [
    ...BRIEF.truthChecks,
    {
      id: "ghost-ref",
      assertion: "the installed tool accepts the submitted assignment contract",
      execution: {
        families: "all",
        artifactPaths: ["$.assignments"],
        publicInputPaths: [],
        hidden: "none",
        evidence: { kind: "external", requiredToolIds: [TOOL_ID] },
      },
    },
  ],
};

/** The battery every grounded case in the second half of C3 measures. */
export const markedTasks = TASKS.tasks;
/** Install one executable in the candidate workspace's own `.toolchain` tree, where
 *  resolveToolInventory looks first. Toolchain bytes sit outside the fingerprint, so this may
 *  be written before or after fingerprintOf. */
export function installTool(slugDir: string, script: string, id = TOOL_ID): string {
  const bin = join(slugDir, ".toolchain", "bin");
  mkdirSync(bin, { recursive: true });
  const path = join(bin, id);
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

/** A host whose one declared tool cannot be read. sha256OfFile refuses before any spawn, so
 *  every run is the environment-owned `verifierUnavailable` — deterministic on every platform. */
export function unreadableToolHost(): VerifierHostHandle {
  return createVerifierHost({
    lifetime: createVerifierLifetime({ root: join(scratch(), "lifetime") }),
    inventory: {
      [TOOL_ID]: {
        id: TOOL_ID,
        path: join(scratch(), "vanished-tool"),
        digest: "0".repeat(64),
        source: "host",
        kind: "binary",
        interpreter: null,
      },
    },
    requireOsSandbox: false,
  });
}

export const VERIFIER_EVALUATOR_SOURCE =
  EVALUATOR_SOURCE.replace("export const checks =", "const matchingChecks =") +
  `
import type { CheckRuntime } from "@ana/correctness-model-bundle";
export const checks = {
  ...matchingChecks,
  "ghost-ref": async (request: Request, runtime?: CheckRuntime): Promise<boolean> => {
    const { artifact } = request;
    if (runtime) {
${TOOL_RUN_BLOCK}
    }
    return true;
  },
};
`;
/** The same verifier with a 400 ms tool limit to exercise the timeout path. */
export const SHORT_WALL_EVALUATOR_SOURCE = VERIFIER_EVALUATOR_SOURCE.replace(
  '      args: ["artifact.json"],',
  '      args: ["artifact.json"],\n      timeoutMs: 400,',
);
/** The slug every tool-grounded case in this block measures. */
export function externalSlug(
  evaluatorSource: string,
  controls: { accept: unknown[]; reject: unknown[] } = {
    accept: ACCEPTS,
    reject: [...REJECTS, ...TOOL_REJECTS],
  },
): string {
  const slugDir = scratch();
  mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
  mkdirSync(join(slugDir, "agent"), { recursive: true });
  writeFileSync(join(slugDir, "correctness-model/brief.json"), JSON.stringify(EXTERNAL_BRIEF));
  writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), evaluatorSource);
  writeFileSync(join(slugDir, "agent/tools.ts"), TOOLS_SOURCE);
  writeFileSync(join(slugDir, "correctness-model/controls.json"), JSON.stringify(controls));
  return slugDir;
}
