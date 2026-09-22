/** Record tool conformance for both initial authoring and task-difficulty climbs. */
import { CONFORMANCE_PROBE_POLICY, type ConformanceEvidence } from "../claim/conformance-evidence.ts";
import type { GeneratedToolWorkerBinding } from "../solve/generated-tool-worker.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { ContractFinding } from "../truth/brief.ts";
import type { BuildTask } from "../truth/tasks.ts";
import type { ToolsSpec } from "../truth/tools-spec.ts";
import { typecheckGeneratedModule } from "../truth/generated-module-typecheck.ts";
import { probeConformanceWithEvidence } from "../truth/probes.ts";

/** The probes to run; each is explicitly `| undefined` so a caller can pass a subset directly. */
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
