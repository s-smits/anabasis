// The answer side of a solve: the answer is a file in the solver's working directory, and submit
// sends it. The host reads the file by one walled command, here a plain shell in the wall's place,
// holds it to the contract's answer format, and refuses with the reason a file that is missing, is
// not JSON, does not follow the format or is too large.
import { afterAll, describe, expect, it } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Contract } from "../src/kernel/contract.ts";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { type Desk, openDesk, publicResource, submitTool } from "../src/solve/answer.ts";
import type { WallExec } from "../src/solve/coding-tools.ts";

const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    additionalProperties: false,
    properties: { span: { type: "number" }, note: { type: "string" } },
    required: ["span"],
  },
  conventions: "",
  rules: [],
  scope: "Beams.",
};

const homes: string[] = [];
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** A home, the commands run against it, and its submit. */
function solving(desk: Desk = openDesk()) {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-answer-")));
  homes.push(home);
  const commands: string[] = [];
  const exec: WallExec = async (command) => {
    commands.push(command);
    const child = Bun.spawn(["/bin/sh", "-c", command], { cwd: tmpdir(), stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).arrayBuffer(),
    ]);
    return { exitCode: await child.exited, output: Buffer.concat([Buffer.from(out), Buffer.from(err)]) };
  };
  const tool = submitTool(desk, CONTRACT, home, exec);
  const submit = async () => {
    // SAFETY: submit takes no arguments and reads neither its call id nor a context.
    const result: AgentToolResult<unknown> = await tool.execute(
      "call",
      {},
      undefined,
      undefined,
      undefined as never,
    );
    const [first] = result.content;
    return { text: first?.type === "text" ? first.text : "", terminate: result.terminate === true };
  };
  const answer = (content: string) => writeFileSync(join(home, "answer.json"), content);
  return { home, desk, commands, tool, submit, answer };
}

describe("submit", () => {
  it("sends answer.json from the working directory, and the answer once sent stays the answer", async () => {
    const { desk, tool, submit, answer } = solving();
    expect(tool.name).toBe("submit");
    expect(tool.promptSnippet).toBe("Send answer.json as your answer, which ends the task");
    expect(tool.description).toBe(
      "Send answer.json from your working directory as your answer. It holds the answer as JSON, in the format public/answer-format.json gives. A file that does not is refused with the reason, and you may submit again. An accepted submit ends the task and returns no verdict.",
    );
    answer('{ "span": 4,\n  "note": "first" }\n');
    expect(desk.submitted).toBeUndefined();
    expect(await submit()).toEqual({ text: "Submitted.", terminate: true });
    expect(desk.submitted).toEqual({ span: 4, note: "first" });
    // What the file holds afterwards changes nothing.
    answer('{"span": 5}');
    expect(await submit()).toEqual({ text: "Submitted.", terminate: true });
    expect(desk.submitted).toEqual({ span: 4, note: "first" });
  });

  it("refuses with the reason, as often as it is asked, and then takes a file that follows", async () => {
    const { desk, submit, answer } = solving();
    const refused = (text: string) => ({ text, terminate: false });
    expect(await submit()).toEqual(
      refused(
        "Submit blocked: there is no answer.json in your working directory. Write your answer there as JSON, in the format public/answer-format.json gives, then submit again.",
      ),
    );
    answer('{"span": 4,');
    expect((await submit()).text).toStartWith("Submit blocked: answer.json is not JSON: ");
    answer('{"span": "wide"}');
    expect((await submit()).text).toStartWith(
      "Submit blocked: answer.json does not follow the answer format: ",
    );
    // A value the format takes only once coerced is not the answer a check would read.
    answer('{"span": "4"}');
    expect(await submit()).toEqual(
      refused(
        "Submit blocked: answer.json does not follow the answer format: the answer follows the format only once coerced",
      ),
    );
    answer('{"span": 4, "depth": 1}');
    expect((await submit()).text).toStartWith(
      "Submit blocked: answer.json does not follow the answer format: ",
    );
    answer(JSON.stringify({ span: 1, note: "x".repeat(1024 * 1024) }));
    expect(await submit()).toEqual(
      refused("Submit blocked: answer.json is larger than the 1048576 bytes an answer may hold"),
    );
    // No refusal is counted: the seventh submit is taken like a first.
    expect(desk.submitted).toBeUndefined();
    answer('{"span": 4}');
    expect(await submit()).toEqual({ text: "Submitted.", terminate: true });
    expect(desk.submitted).toEqual({ span: 4 });
  });

  it("reads the file's bytes as a command's output and names no part of them in the command", async () => {
    const { home, commands, submit, answer } = solving();
    answer('{"span": 4, "note": "$(touch ran); `id`"}');
    await submit();
    expect(commands).toEqual([
      `[ -f '${home}/answer.json' ] || exit 44; head -c 1048577 '${home}/answer.json'`,
    ]);
  });

  it("refuses a directory in the answer's place", async () => {
    const { home, submit } = solving();
    Bun.spawnSync(["mkdir", join(home, "answer.json")]);
    expect((await submit()).text).toStartWith("Submit blocked: there is no answer.json");
  });
});

describe("a public resource", () => {
  it("is bound to its name and content", () => {
    const resource = publicResource("artifact-schema", [{ name: "span", unit: "m" }]);
    expect(resource.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(publicResource("artifact-schema", [{ name: "span", unit: "mm" }]).digest).not.toBe(
      resource.digest,
    );
    expect(publicResource("schema", resource.content).digest).not.toBe(resource.digest);
  });
});
