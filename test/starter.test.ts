// The Starter Pack: the Starter Built Harness, which is the empty harness, and the account of a
// harness's files a Builder is handed. The account gives each part one purpose, and its two worked
// harnesses open and run as they are printed: one whose computation is a program the solver runs
// from its shell, and one without the shell, whose computation is a tool.
import { describe, expect, it } from "bun:test";
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
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { bashTool, CODING_TOOLS, selectedCodingTools } from "../src/solve/coding-tools.ts";
import { type CommandWall, solveDirs } from "../src/solve/command.ts";
import { harnessTools, openHarness } from "../src/solve/harness.ts";
import { installedPrograms } from "../src/solve/prompt.ts";
import { EXAMPLE, HARNESS_ACCOUNT, WITHOUT_SHELL, writeHarness, writeStarter } from "../src/solve/starter.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";

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

describe("the Starter Built Harness", () => {
  it("is the empty harness: pi's coding tools selected, and no guide, tool or program of its own", async () => {
    const dir = scratch();
    try {
      writeStarter(dir);
      const starter = await openHarness(dir);
      expect(starter.presets).toEqual([...CODING_TOOLS]);
      expect(selectedCodingTools(starter.presets)).toEqual(["read", "bash", "edit", "write"]);
      expect(starter.kinds.size).toBe(0);
      expect(starter.guide).toBeNull();
      expect(starter.toolTree).toBeNull();
      // Its two files are the whole of it, so it is one harness wherever it is written.
      const again = join(dir, "again");
      writeStarter(again);
      expect((await openHarness(again)).digest).toBe(starter.digest);
      // Its tools file says when a harness has tools of its own, and that is a comment: the Starter
      // is the harness it was without it.
      const file = readFileSync(join(dir, "agent", "tools.ts"), "utf8");
      expect(file).toStartWith("// Tools of the harness's own, for a harness that leaves the shell out");
      const bare = join(dir, "bare");
      writeHarness(bare, {
        spec: { presets: [...CODING_TOOLS], tools: [] },
        tools: file.replaceAll(/^\/\/.*\n/gm, ""),
      });
      expect((await openHarness(bare)).digest).toBe(starter.digest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the account of a harness a Builder is handed", () => {
  it("gives each part one purpose, and prints a worked harness that opens as printed", async () => {
    const dir = scratch();
    try {
      writeHarness(dir, EXAMPLE);
      const example = await openHarness(dir);
      // The worked harness is the Starter with a program and a guide: its computation is the
      // program, and it has no tool of its own.
      expect(example.presets).toEqual([...CODING_TOOLS]);
      expect(example.kinds.size).toBe(0);
      expect(installedPrograms(example.toolTree)).toEqual(["check-rota"]);
      expect(example.guide).toContain("## Programs\n- check-rota <rota.json>:");
      // The account prints its files byte for byte.
      for (const file of ["agent/tools-spec.json", "agent/BUILT_AGENTS.md", ".toolchain/bin/check-rota"]) {
        expect(HARNESS_ACCOUNT).toContain(readFileSync(join(dir, file), "utf8").trimEnd());
      }
      // One row a part, and the rule that follows from them.
      for (const row of [
        "| agent/tools-spec.json | Which of pi's coding tools the solver has. |",
        "| .toolchain/ | Every computation the harness adds, as programs the solver runs by name. |",
        "| agent/BUILT_AGENTS.md | Words: what each program is for and how its result is read. |",
        "| agent/tools.ts | Tools of the harness's own, for a harness that leaves the shell out. Empty otherwise. |",
      ]) {
        expect(HARNESS_ACCOUNT).toContain(row);
      }
      expect(HARNESS_ACCOUNT).toContain("Put a computation in one place.");
      for (const part of ["answer.json", "public/answer-format.json", ...CODING_TOOLS]) {
        expect(HARNESS_ACCOUNT).toContain(part);
      }
      // The answer is no tool's, and the host lends a tool no helper: the account names neither.
      expect(HARNESS_ACCOUNT).not.toContain("artifact-writer");
      expect(HARNESS_ACCOUNT).not.toContain("runProgram");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints a program that keeps the convention it states", async () => {
    const dir = scratch();
    try {
      writeHarness(dir, EXAMPLE);
      seed(dir);
      const program = join(dir, ".toolchain", "bin", "check-rota");
      const ran = async (...args: string[]) => {
        const child = Bun.spawn([capturedExecPath, program, ...args], {
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        return { exit: await child.exited, out, err };
      };
      // 0: it ran and every limit holds. The task is public/task.json unless another file is named.
      expect(await ran("rota.json")).toEqual({
        exit: 0,
        out: "ann: 8 of 12 hours, ok\nbo: 6 of 8 hours, ok\n",
        err: "",
      });
      expect((await ran("rota.json", "public/task.json")).exit).toBe(0);
      // 1: it ran and one does not hold, said on standard output.
      expect(await ran("over.json")).toEqual({
        exit: 1,
        out: "ann: 14 of 12 hours, over by 2\nbo: 6 of 8 hours, ok\n",
        err: "",
      });
      // 2: it could not run, said on standard error.
      expect(await ran("absent.json")).toMatchObject({ exit: 2, out: "" });
      expect((await ran("absent.json")).err).toStartWith("check-rota: cannot read absent.json: ");
      expect(await ran()).toMatchObject({ exit: 2, out: "", err: expect.stringContaining("usage: ") });
      expect(await ran("--help")).toMatchObject({
        exit: 0,
        out: expect.stringContaining("usage: "),
        err: "",
      });
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

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "prints a program the solver's shell runs by name, and a tool that runs, under the command wall",
    async () => {
      const dir = scratch();
      const bare = join(dir, "bare");
      const dirs = solveDirs(`starter-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      try {
        writeHarness(dir, EXAMPLE);
        writeHarness(bare, WITHOUT_SHELL);
        for (const each of [dirs.home, dirs.runs, dirs.host]) mkdirSync(each, { recursive: true });
        seed(dirs.home);
        const base = solveIsolationPolicy({
          repoRoot: dir,
          cap: { root: dirs.root, bytes: 16 * 1024 * 1024 },
        });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = {
          base,
          dirs,
          toolTree: join(dir, ".toolchain"),
          limits: { shellDefaultSeconds: 60, shellMaxSeconds: 60 },
          cpu: { seconds: 0, unmeasured: 0 },
        };
        const said = (result: { content: { type: string; text?: string }[] }) =>
          result.content.map((part) => part.text ?? "").join("");
        // The program by its name, from the solver's working directory, on the solver's own file.
        const shell = bashTool(wall);
        const run = (command: string) =>
          // SAFETY: the shell's declared arguments are a command and an optional timeout.
          shell.execute("call", { command }, undefined, undefined, undefined as never);
        expect(said(await run("check-rota rota.json"))).toContain(
          "ann: 8 of 12 hours, ok\nbo: 6 of 8 hours, ok\n",
        );
        // What it printed and its exit both reach the solver, as the shell reports any command.
        expect(said(await run("check-rota over.json"))).toBe(
          "ann: 14 of 12 hours, over by 2\nbo: 6 of 8 hours, ok\n\n\nCommand exited with code 1",
        );
        expect(said(await run("check-rota absent.json"))).toEndWith("Command exited with code 2");
        // The harness without the shell: its tool lists and computes behind the same wall.
        const tools = await harnessTools(await openHarness(bare), TASK, { ...wall, toolTree: null });
        expect(tools.map(({ name }) => name)).toEqual(["count_hours"]);
        const counted = await tools[0]?.execute("c1", OVER);
        expect(counted === undefined ? "" : said(counted)).toBe('{"ann":14,"bo":6}');
      } finally {
        rmSync(dirs.root, { recursive: true, force: true });
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
