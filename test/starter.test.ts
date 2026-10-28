// The Starter Pack: the Starter Built Harness, which has no program or tool of its own and the
// starter instructions as its guide, and the account of a harness's files a Builder is handed. The
// account gives each part one purpose, and its two worked harnesses open and run as they are
// printed: one whose computation is a program the solver runs from its shell, and one without the
// shell, whose computation is a tool.
import { expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { SeatTool } from "../src/agent/session.ts";
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
import { harnessTools, openHarness } from "../src/harness/open.ts";
import { EXAMPLE, HARNESS_ACCOUNT, WITHOUT_SHELL, writeStarter } from "../src/harness/starter.ts";
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

function scratch(): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), "ana-starter-test-")));
}

/** A solver's home as far as the worked program reads it: the task, and two rotas. */
function seed(home: string): void {
  mkdirSync(join(home, "public"), { recursive: true });
  writeFileSync(join(home, "public", "task.json"), JSON.stringify(TASK));
  writeFileSync(join(home, "rota.json"), JSON.stringify(WITHIN));
  writeFileSync(join(home, "over.json"), JSON.stringify(OVER));
}

it("has pi's coding tools selected, the starter instructions as its guide, and no tool or program", async () => {
  const dir = scratch();
  try {
    writeStarter(dir);
    const starter = await openHarness(dir);
    expect(starter.presets).toEqual([...CODING_TOOLS]);
    expect(selectedCodingTools(starter.presets)).toEqual(["read", "bash", "edit", "write"]);
    expect(starter.kinds.size).toBe(0);
    expect(starter.toolTree).toBeNull();
    // Its guide keeps the outline the account asks of every guide, and the account prints it whole
    // as the starter instructions, so a Builder reads what it starts from.
    const headings = (guide: string | null) => guide?.split("\n").filter((line) => line.startsWith("#"));
    expect(headings(starter.guide)).toEqual(headings(EXAMPLE.guide));
    expect(HARNESS_ACCOUNT).toContain(`\`\`\`markdown\n${starter.guide?.trimEnd()}\n\`\`\``);
    // Its three files are the whole of it, so it is one harness wherever it is written.
    const again = join(dir, "again");
    writeStarter(again);
    expect((await openHarness(again)).digest).toBe(starter.digest);
    // Its tools file is a comment: the Starter is the harness it was without it.
    const file = readFileSync(join(dir, "agent", "tools.ts"), "utf8");
    const bare = join(dir, "bare");
    writeHarness(bare, {
      spec: { presets: [...CODING_TOOLS], tools: [] },
      tools: file.replaceAll(/^\/\/.*\n/gm, ""),
      guide: readFileSync(join(dir, "agent", "BUILT_AGENTS.md"), "utf8"),
    });
    expect((await openHarness(bare)).digest).toBe(starter.digest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("prints a harness without the shell, whose computation is a tool, and it opens as printed", async () => {
  const dir = scratch();
  try {
    writeHarness(dir, WITHOUT_SHELL);
    const bare = await openHarness(dir);
    expect(selectedCodingTools(bare.presets)).toEqual(["read", "edit", "write"]);
    expect([...bare.kinds]).toEqual([["count_hours", "advisor"]]);
    for (const file of ["agent/tools-spec.json", "agent/tools.ts"]) {
      expect(HARNESS_ACCOUNT).toContain(readFileSync(join(dir, file), "utf8").trimEnd());
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.skipIf(!osIsolationSupport().ok)(
  "prints a program the solver's shell runs by name, and a tool that runs, under the command wall",
  async () => {
    const dir = scratch();
    const bare = join(dir, "bare");
    const dirs = solveDirs(`starter-${String(runtimeProcess.pid)}-${String(Date.now())}`);
    try {
      writeHarness(dir, EXAMPLE);
      writeHarness(bare, WITHOUT_SHELL);
      makeSeatDirs(dirs);
      seed(dirs.home);
      const base = solveIsolationPolicy({ repoRoot: dir });
      if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
      const wall: CommandWall = {
        base,
        dirs,
        toolTree: join(dir, ".toolchain"),
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
      const tools = await harnessTools(await openHarness(bare), TASK, { ...wall, toolTree: null });
      expect(tools.map(({ name }) => name)).toEqual(["count_hours"]);
      // SAFETY: a harness tool uses no durable API methods, only the context's abort signal.
      const counted = await tools[0]?.execute(OVER, undefined as never, BACKGROUND_CONTEXT);
      expect(counted === undefined ? "" : said(counted)).toBe('{"ann":14,"bo":6}');
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
      rmSync(dirs.host, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
