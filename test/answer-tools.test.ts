// The answer side of a solve: the answer is a file in the solver's working directory, and submit
// sends it. The host reads the file by one walled command, here a plain shell in the wall's place,
// holds it to the contract's answer format, and refuses with the reason a file that is missing, is
// not JSON, does not follow the format or is too large.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { Contract } from "../src/kernel/contract.ts";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { type Desk, openDesk, submitTool } from "../src/tools/answer.ts";
import type { WallExec } from "../src/tools/coding.ts";

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
  const submit = async (params: { malformed?: string } = {}) => {
    // SAFETY: submit uses no API services; its bounded file read is the injected WallExec.
    const api = { callId: "call" } as ToolExecutionApi;
    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);
    const first = result.output?.[0];
    return {
      text: first?.type === "text" ? first.text : "",
      terminate: result.control?.terminate === true,
      details: result.details,
    };
  };
  const answer = (content: string) => writeFileSync(join(home, "answer.json"), content);
  return { desk, commands, submit, answer };
}

describe("submit", () => {
  it("keeps the accepted answer's digest in durable details and ends the round", async () => {
    const { answer, desk, submit } = solving();
    answer('{"span":4}');
    expect(await submit()).toMatchObject({
      details: { answerDigest: hashJsonValue({ span: 4 }) },
      terminate: true,
    });
    expect(desk.submitted).toEqual({ span: 4 });
    answer('{"span":8}');
    expect((await submit()).terminate).toBe(true);
    expect(desk.submitted).toEqual({ span: 4 });
  });

  it("refuses invalid files without ending the task, then accepts a valid retry", async () => {
    const { desk, submit, answer } = solving();
    for (const [content, reason] of [
      [null, /no answer\.json/u],
      ['{"span": 4,', /not JSON/u],
      ['{"span": "wide"}', /answer format/u],
      ['{"span": "4"}', /coerced/u],
      ['{"span": 4, "depth": 1}', /answer format/u],
      [JSON.stringify({ span: 1, note: "x".repeat(1024 * 1024) }), /larger.*1048576/u],
    ] as const) {
      if (content !== null) answer(content);
      const result = await submit();
      expect(result.terminate).toBe(false);
      expect(result.text).toMatch(reason);
      expect(desk.submitted).toBeUndefined();
    }
    answer('{"span": 4}');
    expect((await submit()).terminate).toBe(true);
    expect(desk.submitted).toEqual({ span: 4 });
  });

  it("reads the file's bytes as a command's output and names no part of them in the command", async () => {
    const { desk, commands, submit, answer } = solving();
    answer('{"span": 4, "note": "$(touch ran); `id`"}');
    // The answer is taken whole, and no command the host ran spelled any part of it.
    expect((await submit()).terminate).toBe(true);
    expect(desk.submitted).toEqual({ span: 4, note: "$(touch ran); `id`" });
    expect(commands).not.toHaveLength(0);
    expect(commands.filter((command) => command.includes("touch") || command.includes("`id`"))).toEqual([]);
  });

  it("ends the task flagged where the solver says it is malformed, and reads no file", async () => {
    const { desk, commands, submit, answer } = solving();
    answer('{"span": 4}');
    // A reason of nothing is no flag: the file is read as an answer.
    const blank = solving();
    const refused = await blank.submit({ malformed: "  " });
    expect(refused.terminate).toBe(false);
    expect(refused.text).toMatch(/no answer\.json/u);
    expect(blank.desk.flagged).toBeUndefined();
    expect((await submit({ malformed: " The span is given twice, as 4 m and 5 m. " })).terminate).toBe(true);
    expect(desk).toEqual({ submitted: undefined, flagged: "The span is given twice, as 4 m and 5 m." });
    expect(commands).toEqual([]);
    // Once flagged, a submit sends nothing: the task has ended.
    expect((await submit()).terminate).toBe(true);
    expect(desk.submitted).toBeUndefined();
  });
});
