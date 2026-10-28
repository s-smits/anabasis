// Every seat's own tool shares the result cap. Inject the environment's temporary-file transport
// to prove complete, separate spills inside one seat without a model, an OS wall or live hosts.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { FileError } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { Type } from "typebox";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { ending, text, tool } from "../src/tools/answer.ts";
import { present } from "./helpers/matchers.ts";

const homes: string[] = [];
const LONG = "first part\n" + `${"x".repeat(79)}\n`.repeat(1024) + "last part";
const IMAGE = { type: "image", data: "eA==", mimeType: "image/png" } as const;

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** The seat's file transport, with a hostile link in place of its freshly created file. */
class SeatEnv extends NodeExecutionEnv {
  readonly files: string[] = [];
  readonly target: string | undefined;

  constructor(home: string, target?: string) {
    super({ cwd: home });
    this.target = target;
  }

  override async createTempFile(options?: { prefix?: string; suffix?: string }) {
    const file = join(
      mkdtempSync(join(this.cwd, "spill-")),
      `${options?.prefix ?? ""}result${options?.suffix ?? ""}`,
    );
    if (this.target === undefined) writeFileSync(file, "");
    else symlinkSync(this.target, file);
    this.files.push(file);
    return { ok: true, value: file } as const;
  }
}

function seatHome() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ana-tool-result-")));
  homes.push(dir);
  return dir;
}

function api(callId: string, env?: NodeExecutionEnv): ToolExecutionApi {
  // SAFETY: these tools only read env, callId and retainedOutput. All file operations are real.
  return { callId, env, retainedOutput: () => ({ text: LONG, truncated: false }) } as ToolExecutionApi;
}

function shown(result: ToolExecutionResult): string {
  const part = result.output?.[0];
  if (part?.type !== "text") throw new Error("missing text result");
  return part.text;
}

describe("a seat tool's automatic result cap", () => {
  it("shows an 80 KB result's head and notice, keeps its whole file in the seat, and separates calls", async () => {
    const dir = seatHome();
    const env = new SeatEnv(dir);
    const large = tool({
      name: "large_result",
      description: "A result larger than the model keeps.",
      parameters: Type.Object({}),
      execute: async () => ending({ details: { kept: "details" }, isError: true }),
    });
    const results = [];
    for (const callId of ["one", "two"]) {
      const result = await large.execute({}, api(callId, env), BACKGROUND_CONTEXT);
      results.push(result);
      const file = present(env.files.at(-1));
      const value = shown(result);
      expect(dirname(dirname(file))).toBe(dir);
      expect(file).toEndWith(".log");
      expect(readFileSync(file, "utf8")).toBe(LONG);
      expect(value).toStartWith("first part\n");
      expect(value).not.toContain("last part");
      expect(value).toContain(String(Buffer.byteLength(LONG)));
      expect(value).toContain(file);
      expect(Buffer.byteLength(value)).toBeGreaterThan(48 * 1024);
      expect(Buffer.byteLength(value)).toBeLessThanOrEqual(50 * 1024);
      expect(value.split("\n").length).toBeLessThanOrEqual(2000);
      expect(result.details).toEqual({ kept: "details" });
      expect(result.control).toEqual({ terminate: true });
      expect(result.isError).toBe(true);
    }
    expect(env.files).toHaveLength(2);
    expect(env.files[0]).not.toBe(env.files[1]);
    expect(shown(present(results[0]))).not.toBe(shown(present(results[1])));
  });

  it("removes a link before writing and preserves the link's target", async () => {
    const dir = seatHome();
    const target = join(dir, "host-record");
    writeFileSync(target, "the host's\n");
    const env = new SeatEnv(dir, target);
    const value = JSON.stringify({ values: Array.from({ length: 9000 }, (_, at) => at) }, null, 2);
    const large = tool({
      name: "../read_example",
      description: "JSON larger than the model keeps.",
      parameters: Type.Object({}),
      execute: async () => text(value),
    });
    await large.execute({}, api("../../call", env), BACKGROUND_CONTEXT);
    const file = present(env.files[0]);
    expect(dirname(dirname(file))).toBe(dir);
    expect(file).toEndWith(".log");
    expect(file).not.toContain("../");
    expect(lstatSync(file).isSymbolicLink()).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(value);
    expect(readFileSync(target, "utf8")).toBe("the host's\n");
  });

  it("keeps 30,000 characters of JSON whole and preserves non-text output", async () => {
    const value = `  ${JSON.stringify({ input: "x".repeat(30_000) })}\n`;
    const env = new SeatEnv(seatHome());
    const small = tool({
      name: "small_result",
      description: "JSON within pi's limit.",
      parameters: Type.Object({}),
      execute: async () => ({ output: [{ type: "text", text: value }, IMAGE] }),
    });
    const result = await small.execute({}, api("short", env), BACKGROUND_CONTEXT);
    expect(result.output).toEqual([{ type: "text", text: value }, IMAGE]);
    expect(env.files).toHaveLength(0);
  });

  it("caps bytes, lines and whitespace even when the environment cannot keep a file", async () => {
    const refusing = new (class extends NodeExecutionEnv {
      override async createTempFile(): ReturnType<NodeExecutionEnv["createTempFile"]> {
        return { ok: false, error: new FileError("permission_denied", "no room") };
      }
    })({ cwd: seatHome() });
    for (const env of [refusing, undefined]) {
      for (const value of ["é🙂".repeat(20_000), "line\n".repeat(3_000), " ".repeat(80 * 1024)]) {
        const large = tool({
          name: "refused_folder",
          description: "A seat whose temporary folder refuses a file.",
          parameters: Type.Object({}),
          execute: async () => text(value),
        });
        const result = shown(await large.execute({}, api("refused", env), BACKGROUND_CONTEXT));
        expect(Buffer.byteLength(result)).toBeLessThanOrEqual(50 * 1024);
        expect(result).toContain(String(Buffer.byteLength(value)));
        expect(result).not.toContain("The full file is at");
      }
    }
  });

  it("caps all text items together and routes the full text to each calling seat's environment", async () => {
    const envs = [new SeatEnv(seatHome()), new SeatEnv(seatHome())];
    const first = "x".repeat(40 * 1024);
    const second = "y".repeat(40 * 1024);
    const large = tool({
      name: "many_items",
      description: "A result with several text items and an image.",
      parameters: Type.Object({}),
      execute: async () => ({
        output: [{ type: "text", text: first }, IMAGE, { type: "text", text: second }],
      }),
    });
    for (const env of envs) {
      const result = await large.execute({}, api("same-call", env), BACKGROUND_CONTEXT);
      expect(Buffer.byteLength(shown(result))).toBeLessThanOrEqual(50 * 1024);
      expect(result.output?.[1]).toEqual(IMAGE);
      expect(result.output).toHaveLength(2);
      const file = present(env.files[0]);
      expect(dirname(dirname(file))).toBe(env.cwd);
      expect(readFileSync(file, "utf8")).toBe(first + second);
    }
    expect(present(envs[0]).files[0]).not.toBe(present(envs[1]).files[0]);
  });
});
