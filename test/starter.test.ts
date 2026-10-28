// The Starter Pack: the Starter Built Harness, pi's coding tools with the board programs as its one
// computation and the starter instructions as its guide, and the account of a harness's files a
// Builder is handed. The account gives each part one purpose, and its two worked harnesses open and
// run as they are printed: one whose computation is a program the solver runs from its shell, and
// one without the shell, whose computation is a tool.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { SeatTool } from "../src/agent/session.ts";
import { harnessTools, openHarness } from "../src/harness/open.ts";
import { installedPrograms } from "../src/harness/programs.ts";
import { EXAMPLE, HARNESS_ACCOUNT, WITHOUT_SHELL, writeStarter } from "../src/harness/starter.ts";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { CODING_TOOLS, codingTools, selectedCodingTools } from "../src/tools/coding.ts";
import { type CommandWall, makeSeatDirs, solveDirs } from "../src/tools/command.ts";
import { walledEnv } from "../src/tools/env.ts";
import { solveIsolationPolicy } from "../src/wall/base.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { writeHarness } from "./helpers/write-harness.ts";

const TASK = {
  taskId: "t-1",
  family: "rota",
  publicInput: {
    staff: [
      { id: "ann", maxHours: 12 },
      { id: "bo", maxHours: 8 },
    ],
    shifts: [
      { id: "early", hours: 8 },
      { id: "late", hours: 6 },
    ],
  },
};
const WITHIN = {
  assignments: [
    { staff: "ann", shift: "early" },
    { staff: "bo", shift: "late" },
  ],
};
const OVER = { assignments: [...WITHIN.assignments, { staff: "ann", shift: "late" }] };

const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-starter-test-")));
const dir = join(root, "starter");
const bare = join(root, "without-shell");
let starter: Awaited<ReturnType<typeof openHarness>>;
let shellless: Awaited<ReturnType<typeof openHarness>>;
beforeAll(async () => {
  writeStarter(dir);
  writeHarness(bare, WITHOUT_SHELL);
  starter = await openHarness(dir);
  shellless = await openHarness(bare);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the Starter and its worked harnesses", () => {
  it("has pi's coding tools selected, the board programs as its computation, and the starter instructions as its guide", async () => {
    expect(starter.presets).toEqual([...CODING_TOOLS]);
    expect(selectedCodingTools(starter.presets)).toEqual(["read", "bash", "edit", "write"]);
    expect(starter.kinds.size).toBe(0);
    // Its one computation is the five board programs the solver runs from its shell, not a tool.
    expect(installedPrograms(starter.toolTree)).toEqual([
      "cairn-fact",
      "cairn-hint",
      "cairn-init",
      "cairn-intent",
      "cairn-show",
    ]);
    // Its guide keeps the outline the account asks of every guide, and the account prints it whole
    // as the starter instructions, so a Builder reads what it starts from.
    const headings = (guide: string | null) => guide?.split("\n").filter((line) => line.startsWith("#"));
    expect(headings(starter.guide)).toEqual(headings(EXAMPLE.guide));
    expect(HARNESS_ACCOUNT).toContain(`\`\`\`markdown\n${starter.guide?.trimEnd()}\n\`\`\``);
    // Its files are the whole of it, so it is one harness wherever it is written.
    const again = join(dir, "again");
    writeStarter(again);
    expect((await openHarness(again)).digest).toBe(starter.digest);
    // Its tools file is a comment: the Starter is the harness it was without it.
    const file = readFileSync(join(dir, "agent", "tools.ts"), "utf8");
    const uncommented = join(root, "uncommented");
    writeHarness(uncommented, {
      spec: { presets: [...CODING_TOOLS], tools: [] },
      tools: file.replaceAll(/^\/\/.*\n/gm, ""),
      guide: readFileSync(join(dir, "agent", "BUILT_AGENTS.md"), "utf8"),
      programs: Object.fromEntries(
        installedPrograms(starter.toolTree).map((name) => [
          name,
          readFileSync(join(dir, ".toolchain", "bin", name), "utf8"),
        ]),
      ),
    });
    expect((await openHarness(uncommented)).digest).toBe(starter.digest);
  });

  it.skipIf(!osIsolationSupport().ok)(
    "runs the board programs the Starter installs, and the graph they keep, under the command wall",
    async () => {
      const starterDir = join(root, "board");
      const dirs = solveDirs(`board-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      try {
        writeStarter(starterDir);
        makeSeatDirs(dirs);
        const base = solveIsolationPolicy({ repoRoot: starterDir });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = {
          base,
          dirs,
          toolTree: join(starterDir, ".toolchain"),
          limits: { shellDefaultSeconds: 60, shellMaxSeconds: 60 },
        };
        const [shell] = codingTools(wall, ["bash"]);
        if (shell === undefined) throw new Error("the coding tools serve bash");
        const run = async (command: string) => {
          const chunks: string[] = [];
          const api: Pick<
            ToolExecutionApi,
            "callId" | "env" | "output" | "outputWindow" | "retainedOutput" | "diagnostic"
          > = {
            callId: "call",
            env: walledEnv(wall),
            output: (chunk) => {
              chunks.push(Buffer.from(chunk).toString("utf8"));
            },
            outputWindow: undefined,
            retainedOutput: () => ({ text: chunks.join(""), truncated: false }),
            diagnostic: () => undefined,
          };
          // SAFETY: bash uses this API subset, with no document or task methods.
          const result = await shell.execute({ command }, api as ToolExecutionApi, BACKGROUND_CONTEXT);
          return { ...result, out: chunks.join("") };
        };
        // The board's programs run by name from the solver's home, and keep the graph append-only.
        expect((await run("cairn-init target flag")).out).toContain("the board holds origin and goal");
        expect((await run("cairn-intent origin -- scan")).out).toContain("i001: scan");
        expect((await run("cairn-fact port-80-open --intent i001")).out).toContain("f001: port-80-open");
        // A Fact with no Intent is found by checking the goal, and needs no edge.
        expect((await run("cairn-fact found-flag")).out).toContain("f002: found-flag");
        expect((await run("cairn-hint prefer-web")).out).toContain("h001: prefer-web");
        // An Intent must name a Fact on the board: an unknown one fails and writes nothing.
        expect((await run("cairn-intent f999 -- nope")).isError).toBe(true);
        // cairn-show prints the whole graph, which is what the solver observes before deciding.
        const shown = (await run("cairn-show")).out;
        for (const line of [
          "origin: target",
          "goal: flag",
          "  f002: found-flag",
          "  i001 [origin] -> f001: scan",
          "  h001: prefer-web",
        ]) {
          expect(shown).toContain(line);
        }
      } finally {
        rmSync(dirs.root, { recursive: true, force: true });
        rmSync(dirs.host, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("prints a harness without the shell, whose computation is a tool, and it opens as printed", async () => {
    expect(selectedCodingTools(shellless.presets)).toEqual(["read", "edit", "write"]);
    expect([...shellless.kinds]).toEqual([["count_hours", "advisor"]]);
    for (const file of ["agent/tools-spec.json", "agent/tools.ts"]) {
      expect(HARNESS_ACCOUNT).toContain(readFileSync(join(bare, file), "utf8").trimEnd());
    }
  });

  it.skipIf(!osIsolationSupport().ok)(
    "prints a program the solver's shell runs by name, and a tool that runs, under the command wall",
    async () => {
      const example = join(root, "example");
      const dirs = solveDirs(`starter-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      try {
        writeHarness(example, EXAMPLE);
        makeSeatDirs(dirs);
        mkdirSync(join(dirs.home, "public"), { recursive: true });
        for (const [file, value] of [
          ["public/task.json", TASK],
          ["rota.json", WITHIN],
          ["over.json", OVER],
        ] as const) {
          writeFileSync(join(dirs.home, file), JSON.stringify(value));
        }
        const base = solveIsolationPolicy({ repoRoot: example });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = {
          base,
          dirs,
          toolTree: join(example, ".toolchain"),
          limits: { shellDefaultSeconds: 60, shellMaxSeconds: 60 },
        };
        const said = (result: Awaited<ReturnType<SeatTool["execute"]>>) =>
          [
            (result.output ?? []).map((part) => (part.type === "text" ? part.text : "")).join(""),
            ...(result.diagnostics ?? []).map(({ message }) => message),
          ].join("\n\n");
        // The program by its name, from the solver's working directory, on the solver's own file.
        const [shell] = codingTools(wall, ["bash"]);
        if (shell === undefined) throw new Error("the coding tools serve bash");
        const run = async (command: string) => {
          const chunks: string[] = [];
          const api: Pick<
            ToolExecutionApi,
            "callId" | "env" | "output" | "outputWindow" | "retainedOutput" | "diagnostic"
          > = {
            callId: "call",
            env: walledEnv(wall),
            output: (chunk) => {
              chunks.push(Buffer.from(chunk).toString("utf8"));
            },
            outputWindow: undefined,
            retainedOutput: () => ({ text: chunks.join(""), truncated: false }),
            diagnostic: () => undefined,
          };
          // SAFETY: bash uses this API subset, with no document or task methods.
          const result = await shell.execute({ command }, api as ToolExecutionApi, BACKGROUND_CONTEXT);
          return { ...result, output: result.output ?? [{ type: "text" as const, text: chunks.join("") }] };
        };
        expect(said(await run("check-rota rota.json"))).toContain(
          "ann: 8 of 12 hours, ok\nbo: 6 of 8 hours, ok\n",
        );
        // What it printed and its exit both reach the solver, as the shell reports any command.
        const over = await run("check-rota over.json");
        expect(said(over)).toContain("ann: 14 of 12 hours, over by 2\nbo: 6 of 8 hours, ok");
        expect(over.isError).toBe(true);
        expect(said(over)).toEndWith("Command exited with code 1");
        expect(said(await run("check-rota absent.json"))).toEndWith("Command exited with code 2");
        // The harness without the shell: its tool lists and computes behind the same wall.
        const tools = await harnessTools(shellless, TASK, { ...wall, toolTree: null });
        expect(tools.map(({ name }) => name)).toEqual(["count_hours"]);
        // SAFETY: a harness tool uses no durable API methods, only the context's abort signal.
        const counted = await tools[0]?.execute(OVER, undefined as never, BACKGROUND_CONTEXT);
        expect(counted === undefined ? "" : said(counted)).toBe('{"ann":14,"bo":6}');
      } finally {
        rmSync(dirs.root, { recursive: true, force: true });
        rmSync(dirs.host, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
