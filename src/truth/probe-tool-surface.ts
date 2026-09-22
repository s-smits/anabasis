/**
 * Compare declared domain tools with the interfaces returned during conformance.
 *
 * A declared tool has two descriptions: the one `agent/tools-spec.json` declares and the one
 * `agent/tools.ts` serves to the agent. Conformance previously compared only the tool names,
 * so run 52 (2026-09-03) produced a `record_answer` whose description said it wrote a pin
 * plan only and that file tools were absent, while the spec declared the complete answer; the
 * drift passed conformance for six iterations. The spec is also the text the tools-spec validator
 * screens for a verifier-identity claim or a mode flag, so a served description that differs is
 * model-visible text that the spec validator never checked.
 */
import { canonicalJsonCopy as trustedJson } from "../meta/stable-json.ts";
import type { BuiltStarter, GeneratedToolWorkerEvidence } from "../solve/built-starter.ts";
import { generatedToolInterface } from "../solve/generated-tool-worker-protocol.ts";
import { WRITER_BINDING_SENTENCE } from "../solve/published-margin.ts";
import { type ContractFinding, controllerValidatedFinding, controllerValidatedFindings } from "./brief.ts";
import type { ToolsSpec } from "./tools-spec.ts";
import { GENERATED_TOOLS_FILE } from "../meta/bundle-layout.ts";

/** Enough of a description to recognise which text is meant, without carrying a 4,000-character
 *  tool description into a finding the author already holds both files for. */
function descriptionExcerpt(text: string): string {
  return text.length <= 120 ? text : `${text.slice(0, 117)}...`;
}

/**
 * The spec owns what each tool does, accepts and returns, so the finding is written against
 * `agent/tools.ts` — its path routes the repair to the fingerprint owner, which may bring the
 * served text into line without reopening the declared contract.
 */
export function toolDescriptionParityFindings(
  spec: ToolsSpec,
  tools: BuiltStarter["tools"],
): ContractFinding[] {
  const served = new Map(tools.map((tool) => [tool.name, tool.description]));
  return controllerValidatedFindings(
    spec.tools.flatMap((declared) => {
      const description = served.get(declared.name);
      // An unregistered name is the contract mismatch reported once by its own owner.
      if (description === undefined) return [];
      // The host appends its own sentence to an artifact-writer it has bound, because it replaced
      // that tool's parameters and execution and the spec was written against neither. That text
      // is the host's, not the Builder's, so it is not drift; everything before it must still be
      // exactly what the spec declares.
      const appended = ` ${WRITER_BINDING_SENTENCE}`;
      const authored = description.endsWith(appended) ? description.slice(0, -appended.length) : description;
      if (authored === declared.description) return [];
      return [
        {
          code: "tools-description-drift",
          path: `agent/tools.ts#${declared.name}`,
          detail: `tool "${declared.name}" serves the description "${descriptionExcerpt(authored)}" but agent/tools-spec.json declares "${descriptionExcerpt(declared.description)}"; the agent reads the served text, so it must state what the contract declares`,
        },
      ];
    }),
  );
}

/** The served surface of each declared domain tool, keyed by name: the same projection the worker
 *  binding digests, kept per tool so a drift finding can say which tool moved. */
export function servedToolSurfaces(spec: ToolsSpec, tools: BuiltStarter["tools"]): Map<string, string> {
  const declared = new Set(spec.tools.map(({ name }) => name));
  return new Map(
    tools
      .filter(({ name }) => declared.has(name))
      .map((tool) => [tool.name, trustedJson(generatedToolInterface(tool)).bytes]),
  );
}

/** Which declared tools moved between two tasks. Empty when every tool interface matched and the
 *  registration or worker identity moved instead, which the family alone already names. */
function movedToolsNote(baseline: Map<string, string> | null, observed: Map<string, string>): string {
  if (baseline === null) return "";
  const names = [...new Set([...baseline.keys(), ...observed.keys()])]
    .filter((name) => baseline.get(name) !== observed.get(name))
    .sort();
  return names.length === 0 ? "" : ` (moved: ${names.map((name) => `"${name}"`).join(", ")})`;
}

/** The finding for a task whose generated tools expose a different worker contract than the first
 *  opened task did, naming the tools that moved when the per-tool interfaces can say which. */
export function workerBindingDriftFindings(
  family: string,
  baseline: Map<string, string> | null,
  observed: Map<string, string>,
): ContractFinding[] {
  return controllerValidatedFindings([
    {
      code: "task-worker-binding-drift",
      path: GENERATED_TOOLS_FILE,
      detail: `generated tools expose a different worker contract for family "${family}"${movedToolsNote(baseline, observed)}; every validated task must produce the same registration and tool schema`,
    },
  ]);
}

/** One refusal per probed worker that did not settle. A close-handshake timeout after all probes
 *  settled concerns host cleanup: run 6bf0e9 (2026-09-07) refused agent bytes for that timeout
 *  and accepted the same bytes on the next submit, repeated over five rounds in the run. The
 *  Built slot treats the same termination as benign after a submit (pi-built.ts). */
export function terminationFindings(
  closed: ReadonlyArray<{ termination: GeneratedToolWorkerEvidence["termination"] } | undefined>,
): ContractFinding[] {
  return closed.flatMap((worker) => {
    if (worker?.termination.status !== "non-result" || worker.termination.closeHandshakeTimeout === true) {
      return [];
    }
    return controllerValidatedFinding({
      code: "generated-toolset-termination",
      path: GENERATED_TOOLS_FILE,
      detail: `generated-tool worker did not settle normally: ${worker.termination.message}`,
    });
  });
}
