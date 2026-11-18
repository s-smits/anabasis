// The answer side of a solve: the answer is a file in the solver's working directory, and submit
// sends it. The host reads the file by one walled command, here a plain shell in the wall's place,
// holds it to the contract's answer format, and refuses with the reason a file that is missing, is
// not JSON, does not follow the format or is too large.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { Contract } from "../src/kernel/contract.ts";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedFiles, keepAnswerFiles, manifestOf, readAnswerFiles } from "../src/kernel/answer-files.ts";
import { append, read } from "../src/kernel/log.ts";
import { verdictsOf } from "../src/kernel/solves.ts";
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
function solving(desk: Desk = openDesk(), pathFirst?: string) {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-answer-")));
  homes.push(home);
  const commands: string[] = [];
  const exec: WallExec = async (command, options) => {
    commands.push(command);
    const staged = mkdtempSync(join(home, "stage-"));
    options?.stage?.(staged);
    const env = { ...Bun.env, PATH: [pathFirst, Bun.env.PATH].filter(Boolean).join(":") };
    const child = Bun.spawn(["/bin/sh", "-c", command], { cwd: staged, env, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).arrayBuffer(),
    ]);
    return { exitCode: await child.exited, output: Buffer.concat([Buffer.from(out), Buffer.from(err)]) };
  };
  const log = join(home, "log.jsonl");
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
  return { home, log, desk, commands, submit, answer };
}

describe("submit", () => {
  it("captures nested text and binary bytes once and logs only their manifest", async () => {
    const s = solving();
    s.answer('{"span":4}');
    mkdirSync(join(s.home, "deliverables", "reports"), { recursive: true });
    writeFileSync(join(s.home, "deliverables", "reports", "a.txt"), "résultat\n");
    writeFileSync(join(s.home, "deliverables", "copy.txt"), "résultat\n");
    writeFileSync(join(s.home, "deliverables", "book.bin"), Buffer.from([0xff, 0, 0xfe]));
    expect((await s.submit()).terminate).toBe(true);
    expect(s.commands).toHaveLength(1);
    // A live solve's checks read the captured files, so they carry their text as a replay's do.
    expect(s.desk.files?.find((file) => file.path === "reports/a.txt")?.text).toBe("résultat\n");
    const kept = keepAnswerFiles(s.log, s.desk.files ?? []);
    const files = readAnswerFiles(s.log, kept);
    expect(files.find((file) => file.path === "reports/a.txt")?.text).toBe("résultat\n");
    expect(files.find((file) => file.path === "book.bin")).toEqual({ path: "book.bin", base64: "/wD+" });
    expect(readdirSync(join(s.home, "states", "deliverables"))).toHaveLength(2);
    append(s.log, "verdict", {
      solve: "s",
      answer: s.desk.submitted ?? null,
      files: kept.map((file) => ({ ...file })),
    });
    expect(readFileSync(s.log, "utf8")).not.toContain("base64");
    expect(readFileSync(s.log, "utf8")).not.toContain("résultat");
    const manifest = verdictsOf(read(s.log)).get("s")?.files ?? [];
    writeFileSync(join(s.home, "deliverables", "reports", "a.txt"), "changed after submit");
    expect(readAnswerFiles(s.log, manifest)).toEqual(files);
    const first = manifest[0];
    if (first === undefined) throw new Error("missing manifest");
    writeFileSync(join(s.home, "states", "deliverables", first.sha256), "corrupt");
    expect(() => readAnswerFiles(s.log, manifest)).toThrow("does not match its manifest");
  });

  it.each(["root", "file", "directory"])(
    "refuses a %s symlink out of the deliverables folder, then permits a retry",
    async (kind) => {
      const s = solving();
      s.answer('{"span":4}');
      const folder = join(s.home, "deliverables");
      if (kind === "root") symlinkSync(s.home, folder);
      else {
        mkdirSync(folder);
        symlinkSync(kind === "file" ? join(s.home, "answer.json") : s.home, join(folder, "escape"));
      }
      const result = await s.submit();
      expect(result.terminate).toBe(false);
      expect(result.text).toMatch(/symlink|symbolic|directory/u);
      expect(s.desk.submitted).toBeUndefined();
      rmSync(folder, { recursive: true, force: true });
      expect((await s.submit()).terminate).toBe(true);
    },
  );

  it("submits through the host's Python where a harness's python3 first on the path fails", async () => {
    const tree = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-tree-")));
    homes.push(tree);
    writeFileSync(join(tree, "python3"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const s = solving(openDesk(), tree);
    s.answer('{"span": 3}');
    expect((await s.submit()).text).toBe("Submitted.");
    expect(s.desk.submitted).toEqual({ span: 3 });
  });
  it("reads an answer.json that links to the answer, as head -c read it", async () => {
    const s = solving();
    mkdirSync(join(s.home, "out"));
    writeFileSync(join(s.home, "out", "answer.json"), '{"span": 5}');
    symlinkSync(join(s.home, "out", "answer.json"), join(s.home, "answer.json"));
    expect((await s.submit()).text).toBe("Submitted.");
    expect(s.desk.submitted).toEqual({ span: 5 });
  });
  it("refuses paths leaving the folder even in a malformed capture or manifest", () => {
    for (const path of [
      "../answer.json",
      "/answer.json",
      "a/../../outside",
      "a//b",
      String.raw`a\b`,
      ".",
      "a/./b",
    ]) {
      expect(() => capturedFiles([{ path, base64: "eA==" }])).toThrow();
      expect(() => manifestOf([{ path, bytes: 1, sha256: "a".repeat(64) }])).toThrow();
    }
  });

  it.each(["file", "total"])("refuses bytes over the %s bound", async (kind) => {
    const s = solving();
    s.answer('{"span":4}');
    const folder = join(s.home, "deliverables");
    mkdirSync(folder);
    if (kind === "file") writeFileSync(join(folder, "large.bin"), Buffer.alloc(16 * 1024 * 1024 + 1));
    else {
      writeFileSync(join(folder, "first.bin"), Buffer.alloc(8 * 1024 * 1024));
      writeFileSync(join(folder, "second.bin"), Buffer.alloc(8 * 1024 * 1024 + 1));
    }
    const result = await s.submit();
    expect(result.terminate).toBe(false);
    expect(result.text).toContain("larger");
    expect(s.desk.submitted).toBeUndefined();
  });

  it("accepts exactly 64 files and refuses a 65th even when every file is empty", async () => {
    const s = solving();
    s.answer('{"span":4}');
    mkdirSync(join(s.home, "deliverables"));
    for (let index = 0; index < 65; index++) writeFileSync(join(s.home, "deliverables", String(index)), "");
    expect((await s.submit()).text).toContain("64 files");
    expect(s.desk.submitted).toBeUndefined();
    rmSync(join(s.home, "deliverables", "64"));
    expect((await s.submit()).terminate).toBe(true);
    expect(s.desk.files).toHaveLength(64);
  });

  it("reads an old verdict without a manifest as the original JSON answer", () => {
    const s = solving();
    append(s.log, "verdict", { solve: "old", answer: { span: 4 }, kind: "pass" });
    const verdict = verdictsOf(read(s.log)).get("old");
    expect(verdict?.answer).toEqual({ span: 4 });
    expect(verdict?.files).toBeUndefined();
    expect(readAnswerFiles(s.log, verdict?.files ?? [])).toEqual([]);
  });

  it("keeps the accepted answer's digest in durable details and ends the round", async () => {
    const { answer, desk, submit } = solving();
    answer('{"span":4}');
    expect(await submit()).toMatchObject({
      details: { answerDigest: hashJsonValue({ span: 4 }) },
      terminate: true,
    });
    expect(desk.submitted).toEqual({ span: 4 });
    expect(desk.files).toBeUndefined();
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
      ['{"span": "4"}', /answer format/u],
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
