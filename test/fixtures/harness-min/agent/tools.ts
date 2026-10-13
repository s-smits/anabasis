// A v1-shaped harness for test/harness-tools.test.ts: it imports the agent bundle, pi-ai's `Type`
// and a local helper, as a Built Harness's tools.ts does.
import { type DomainHarnessFactory, defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";
import { readFileSync } from "node:fs";
import { scaled } from "./helper.ts";

export const createDomainHarness: DomainHarnessFactory = (task) => {
  // SAFETY: the test hands every call this fixture's own task, whose base is a number.
  const input = task.publicInput as { base: number };
  return {
    tools: [
      defineDraftTool({
        name: "scale_base",
        label: "Scale base",
        description: "Returns the task's base multiplied by a factor.",
        parameters: Type.Object({ factor: Type.Number() }),
        run: (params: { factor: number }) => ({
          text: `${task.taskId} (${task.family}): ${String(scaled(input.base, params.factor))}`,
          details: { value: scaled(input.base, params.factor) },
        }),
      }),
      defineDraftTool({
        name: "read_path",
        label: "Read path",
        description: "Returns a file's text.",
        parameters: Type.Object({ path: Type.String() }),
        run: (params: { path: string }) => {
          try {
            return { text: readFileSync(params.path, "utf8") };
          } catch (error) {
            // SAFETY: readFileSync throws a Node system error, which carries its errno name as `code`.
            const { code } = error as { code?: string };
            throw new Error(`cannot read ${params.path}: ${String(code)}`, {
              cause: error,
            });
          }
        },
      }),
      defineDraftTool({
        name: "record_answer",
        label: "Record answer",
        description: "Records the answer.",
        executionMode: "sequential",
        parameters: Type.Object({ answer: Type.String() }),
        run: () => ({ text: "recorded", terminate: false }),
      }),
    ],
  };
};
