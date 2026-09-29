// A real generated-tool worker with a tool that never answers, run against a short request wall.
//
// The termination module decides what a request timeout means; this file proves the worker's own
// timer is the thing that says it. F2 reads `deadline` to tell the host's clock from a writer that
// broke its protocol, so a timer that forgot the mark sends a loaded host's slow reply to the
// Builder as a representation defect, which is what firmware-9 recorded on 2026-09-24.

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { WorkerClient, bundleGeneratedWorker } from "../src/solve/generated-tool-worker-process.ts";
import { GENERATED_TOOL_PROTOCOL } from "../src/solve/generated-tool-worker-protocol.ts";
import { compilePublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const TOOLS = `
import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";

export function createDomainHarness() {
  return {
    tools: [
      defineDraftTool({
        name: "write_answer", label: "Write answer", description: "prepare the exact public answer",
        parameters: Type.Object({ massKg: Type.Number() }),
        executionMode: "sequential",
        run: (params, draft) => {
          draft.setArtifact(params);
          return { text: "prepared" };
        },
      }),
      defineDraftTool({
        name: "look_up", label: "Look up", description: "a reader that never answers",
        parameters: Type.Object({}),
        executionMode: "sequential",
        run: () => new Promise(() => {}),
      }),
    ],
  };
}
`;

afterAll(cleanupScratch);

describe("a request the worker never answers", () => {
  it("ends the worker as a protocol non-result the host's own clock marked", async () => {
    // Inside the checkout, because the worker bundle resolves the generated tool's own
    // "@ana/agent-bundle" import from the directory that file sits in.
    const slugDir = scratchDir(".ana-scratch-request-", import.meta.dir);
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "agent", "tools.ts"), TOOLS);
    const bundle = await bundleGeneratedWorker(slugDir);
    const client = new WorkerClient(
      bundle,
      {
        type: "start",
        protocol: GENERATED_TOOL_PROTOCOL,
        task: { taskId: "t1", family: "wide", publicInput: {} },
        presets: [],
        domainToolAuthorities: [
          { name: "write_answer", authority: "artifact-writer" },
          { name: "look_up", authority: "reader" },
        ],
        publishedMargins: [],
        publicArtifactSchema: compilePublicArtifactSchema([{ name: "massKg" }], [{ massKg: 1 }]),
        workerInstanceId: crypto.randomUUID(),
        bundleDigest: bundle.digest,
        deniedReadPath: join(slugDir, "agent", "tools.ts"),
        deniedWritePath: join(bundle.dir, "forbidden-write"),
        traceTaskAccess: false,
      },
      undefined,
      1_500,
    );
    await client.ready;
    // The nearest answer the same writer gives: a request it does answer settles normally.
    await expect(client.execute("c0", "write_answer", { massKg: 1 })).resolves.toBeDefined();
    await expect(client.execute("c1", "look_up", {})).rejects.toThrow("request timed out");
    expect(await client.close()).toMatchObject({ status: "non-result", kind: "protocol", deadline: true });
  }, 120_000);
});
