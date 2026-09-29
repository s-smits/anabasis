/** Record tool conformance for both initial authoring and task-difficulty climbs. */
import { CONFORMANCE_PROBE_POLICY, type ConformanceEvidence } from "../claim/conformance-evidence.ts";
import type { GeneratedToolWorkerBinding } from "../solve/generated-tool-worker.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { ContractFinding } from "../correctness-bundle/brief.ts";
import type { BuildTask } from "../correctness-bundle/tasks.ts";
import type { ToolsSpec } from "../correctness-bundle/tools-spec.ts";
import { typecheckGeneratedModule } from "../correctness-bundle/generated-module-typecheck.ts";
import { probeConformanceWithEvidence } from "../correctness-bundle/probes.ts";

/** Both probes are explicitly `| undefined` rather than optional-only, so a caller that wants one
 *  of them executed can hand over exactly that — `{ load: probes.load }` — instead of assembling
 *  the object through a conditional spread at every call site. */
export interface AgentToolsProbes {
  load?: (() => Promise<ContractFinding[]>) | undefined;
  conformance?:
    | ((
        spec: ToolsSpec,
        probeTasks: readonly BuildTask[],
        schema: PublicArtifactSchema,
      ) => Promise<
        | ContractFinding[]
        | {
            findings: ContractFinding[];
            worker: GeneratedToolWorkerBinding | null;
            probePolicy: typeof CONFORMANCE_PROBE_POLICY;
          }
      >)
    | undefined;
}

/** Production probes for one candidate directory: generated-module typecheck, then conformance on
 *  every task. Tests may supply fewer callbacks; an omitted probe proves nothing passed. */
export function makeAgentToolsProbes(slugDir: string): AgentToolsProbes {
  return {
    load: () => Promise.resolve(typecheckGeneratedModule(slugDir, "agent")),
    conformance: (spec, probeTasks, schema) =>
      probeConformanceWithEvidence(slugDir, spec, probeTasks, schema),
  };
}

/** Write evidence only after every validated task ran through an authenticated worker probe. */
export async function attestToolConformance(
  probes: AgentToolsProbes,
  input: {
    toolsSpec: ToolsSpec;
    toolsSpecHash: string;
    probeTasks: readonly BuildTask[];
    taskSetHash: string;
    publicArtifactSchema: PublicArtifactSchema;
    verifierEnvironmentHash: string | null;
  },
): Promise<{ evidence: ConformanceEvidence | null; findings: ContractFinding[] }> {
  if (probes.conformance === undefined) return { evidence: null, findings: [] };
  if (input.probeTasks.length === 0) throw new Error("conformance requires at least one task");
  const result = await probes.conformance(input.toolsSpec, input.probeTasks, input.publicArtifactSchema);
  const findings = Array.isArray(result) ? result : result.findings;
  if (findings.length > 0) return { evidence: null, findings };
  if (Array.isArray(result) || result.worker === null || result.probePolicy !== CONFORMANCE_PROBE_POLICY) {
    throw new Error("a clean conformance probe must return authenticated worker evidence");
  }
  return {
    evidence: {
      schema: "tool-conformance/v4",
      toolsSpecHash: input.toolsSpecHash,
      taskSetHash: input.taskSetHash,
      probePolicy: CONFORMANCE_PROBE_POLICY,
      publicArtifactSchemaHash: input.publicArtifactSchema.sha256,
      verifierEnvironmentHash: input.verifierEnvironmentHash,
      worker: result.worker,
    },
    findings: [],
  };
}
