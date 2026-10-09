// The Starter Pack: the Starter Built Harness, which is the empty harness, and the account of a
// harness's files a Builder is handed, whose worked example opens and runs as it is printed.
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { CODING_TOOLS, selectedCodingTools } from "../src/solve/coding-tools.ts";
import { type CommandWall, solveDirs } from "../src/solve/command.ts";
import { harnessTools, openHarness } from "../src/solve/harness.ts";
import { EXAMPLE, HARNESS_ACCOUNT, writeHarness, writeStarter } from "../src/solve/starter.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";

const TASK = {
  taskId: "t-1",
  family: "rota",
  publicInput: {
    staff: [{ id: "ann" }, { id: "bo" }],
    shifts: [
      { id: "early", hours: 8 },
      { id: "late", hours: 6 },
    ],
  },
};

function scratch(): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), "ana-starter-test-")));
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
      expect(readFileSync(join(dir, "agent", "tools.ts"), "utf8")).toContain("tools: [],");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the account of a harness a Builder is handed", () => {
  it("prints a worked harness that opens as printed, and names what the host reads", async () => {
    const dir = scratch();
    try {
      writeHarness(dir, EXAMPLE);
      const example = await openHarness(dir);
      expect([...example.kinds]).toEqual([
        ["list_staff", "reader"],
        ["count_hours", "advisor"],
      ]);
      // The account prints the same two files, byte for byte.
      expect(HARNESS_ACCOUNT).toContain(
        readFileSync(join(dir, "agent", "tools-spec.json"), "utf8").trimEnd(),
      );
      expect(HARNESS_ACCOUNT).toContain(readFileSync(join(dir, "agent", "tools.ts"), "utf8").trimEnd());
      for (const part of [
        "agent/tools-spec.json",
        "agent/tools.ts",
        "agent/BUILT_AGENTS.md",
        ".toolchain/",
        "answer.json",
        "public/answer-format.json",
        ...CODING_TOOLS,
      ]) {
        expect(HARNESS_ACCOUNT).toContain(part);
      }
      // The answer is no tool's: the account names no kind that takes it.
      expect(HARNESS_ACCOUNT).not.toContain("artifact-writer");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(runtimeProcess.platform !== "darwin")(
    "prints tools that list and run under the command wall",
    async () => {
      const dir = scratch();
      const dirs = solveDirs(`starter-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      try {
        writeHarness(dir, EXAMPLE);
        for (const each of [dirs.home, dirs.runs, dirs.host]) mkdirSync(each, { recursive: true });
        const base = solveIsolationPolicy({
          repoRoot: dir,
          cap: { root: dirs.root, bytes: 16 * 1024 * 1024 },
        });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const wall: CommandWall = {
          base,
          dirs,
          toolTree: null,
          limits: { shellDefaultSeconds: 60, shellMaxSeconds: 60 },
          cpu: { seconds: 0, unmeasured: 0 },
        };
        const tools = await harnessTools(await openHarness(dir), TASK, wall);
        expect(tools.map(({ name }) => name)).toEqual(["list_staff", "count_hours"]);
        const [list, count] = tools;
        const said = async (result: ReturnType<NonNullable<typeof list>["execute"]>) => {
          const [first] = (await result).content;
          return first?.type === "text" ? first.text : "";
        };
        expect(await said(list?.execute("c1", {}) ?? Promise.reject(new Error("no reader")))).toBe(
          JSON.stringify(TASK.publicInput),
        );
        const assignments = [
          { staff: "ann", shift: "early" },
          { staff: "ann", shift: "late" },
          { staff: "bo", shift: "late" },
        ];
        expect(
          await said(count?.execute("c2", { assignments }) ?? Promise.reject(new Error("no advisor"))),
        ).toBe('{"ann":14,"bo":6}');
      } finally {
        rmSync(dirs.root, { recursive: true, force: true });
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
