// The answer side of a solve: what the record tool prepares, what save and restore keep, what
// submit refuses and sends, and what read_public_resources returns, in v1's words.
import { describe, expect, it } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { answerSchema, type Contract } from "../src/kernel/contract.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { deskTools, openDesk, publicResource, publicResourcesTool, recordTool } from "../src/solve/answer.ts";

const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    additionalProperties: false,
    properties: { span: { type: "number" } },
    required: ["span"],
  },
  tools: [],
  install: "",
  conventions: "",
  rules: [],
  scope: "Beams.",
};

const WRITER: AgentTool = {
  name: "record_beam",
  label: "Record beam",
  description: "Writes the beam.",
  parameters: { type: "object", properties: {} },
  execute: async () => {
    throw new Error("a harness writer's own code never runs");
  },
};

async function call(tool: AgentTool | undefined, params: JsonValue = {}) {
  if (tool === undefined) throw new Error("no such tool");
  const result = await tool.execute("call", params);
  const [first] = result.content;
  return { text: first?.type === "text" ? first.text : "", terminate: result.terminate === true };
}

describe("the answer tools", () => {
  it("prepare, keep and send one answer with v1's texts", async () => {
    const desk = openDesk();
    const record = recordTool(WRITER, CONTRACT, desk);
    const tools = new Map(deskTools(desk).map((tool) => [tool.name, tool]));
    expect([...tools.keys()]).toEqual([
      "save_candidate",
      "restore_candidate",
      "inspect_draft",
      "preview_artifact",
      "submit",
    ]);
    expect(record.parameters).toBe(answerSchema(CONTRACT));
    expect(record.description).toBe("Writes the beam.");

    expect((await call(tools.get("preview_artifact"))).text).toBe(
      "No answer has been prepared. Call an artifact-writer.",
    );
    expect(await call(tools.get("submit"))).toEqual({
      text: "Submit blocked: Call an artifact-writer to prepare the exact public answer, then submit again.",
      terminate: false,
    });

    expect((await call(record, { span: 4 })).text).toBe("Prepared the exact public answer.");
    expect((await call(tools.get("save_candidate"), { name: "four" })).text).toBe(
      'Saved "four". Held: four.',
    );
    await call(record, { span: 5 });
    expect((await call(tools.get("preview_artifact"))).text).toBe('{"span":5}');
    expect((await call(tools.get("restore_candidate"), { name: "five" })).text).toBe(
      'No candidate named "five". Held: four.',
    );
    await call(tools.get("restore_candidate"), { name: "four" });
    expect((await call(tools.get("inspect_draft"))).text).toBe(
      '{"preparedAnswer":"current","savedCandidates":["four"]}',
    );

    expect(await call(tools.get("submit"))).toEqual({ text: "Submitted.", terminate: true });
    expect(desk.submitted).toEqual({ span: 4 });
  });

  it("refuse a submit past the budget, naming the last refusal", async () => {
    const desk = openDesk();
    const submit = deskTools(desk).find((tool) => tool.name === "submit");
    for (let attempt = 0; attempt < 3; attempt++) await call(submit);
    expect((await call(submit)).text).toBe(
      "Submit blocked: the submit attempt budget (3) is exhausted — no further attempts are accepted (the last attempt was rejected as draft-unmaterialized)",
    );
  });

  it("hold at most six candidates", async () => {
    const save = deskTools(openDesk()).find((tool) => tool.name === "save_candidate");
    for (const name of ["a", "b", "c", "d", "e", "f"]) await call(save, { name });
    expect((await call(save, { name: "g" })).text).toBe(
      "Not saved: 6 candidates are already held (a, b, c, d, e, f). Save over one of those names instead.",
    );
    expect((await call(save, { name: "a" })).text).toBe('Saved "a". Held: a, b, c, d, e, f.');
  });

  it("window a long answer, naming where the next read starts", async () => {
    const desk = openDesk();
    desk.prepared = { text: "x".repeat(13_000) };
    const preview = deskTools(desk).find((tool) => tool.name === "preview_artifact");
    const first = await call(preview);
    expect(first.text.endsWith("\n… (1011 chars left; call again with from: 12000)")).toBe(true);
    expect((await call(preview, { from: 12_000 })).text.startsWith("… (12000 chars before this)\n")).toBe(
      true,
    );
  });

  it("return the public resources pretty-printed, each bound to its digest", async () => {
    const resource = publicResource("artifact-schema", [{ name: "span", shape: "number" }]);
    expect(resource.digest).toMatch(/^[0-9a-f]{64}$/);
    const { text } = await call(publicResourcesTool([resource]));
    expect(text).toBe(JSON.stringify({ resources: [resource] }, null, 2));
  });
});
