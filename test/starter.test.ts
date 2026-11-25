// The Starter Pack: the Starter Built Harness, which has no program of its own and the starter
// instructions as its guide, and the account of a harness's files a Builder is handed. The account
// gives each part one purpose, and its worked harness opens and runs as it is printed: its
// computation is a program the solver runs from its shell.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { SeatTool } from "../src/agent/session.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import { openHarness } from "../src/harness/open.ts";
import { EXAMPLE, HARNESS_ACCOUNT, HOST_ONLY, portableGuide, writeStarter } from "../src/harness/starter.ts";
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
let starter: Awaited<ReturnType<typeof openHarness>>;
beforeAll(async () => {
  writeStarter(dir);
  starter = await openHarness(dir);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the Starter and its worked harness", () => {
  it("has pi's coding tools selected, the starter instructions as its guide, and no program", async () => {
    expect(starter.presets).toEqual([...CODING_TOOLS]);
    expect(selectedCodingTools(starter.presets)).toEqual(["read", "bash", "edit", "write"]);
    expect(starter.toolTree).toBeNull();
    // The account prints the guide whole as the starter instructions, so a Builder reads what it starts
    // from.
    const headings = (guide: string | null) => guide?.split("\n").filter((line) => line.startsWith("#"));
    expect(headings(starter.guide)).toEqual(headings(EXAMPLE.guide));
    expect(HARNESS_ACCOUNT).toContain(`\`\`\`markdown\n${starter.guide?.trimEnd()}\n\`\`\``);
    // Its two files are the whole of it, so it is one harness wherever it is written.
    const again = join(dir, "again");
    writeStarter(again);
    expect((await openHarness(again)).digest).toBe(starter.digest);
    // It is the harness it was while a harness held a tool module, so the baseline of every campaign on
    // record keeps its name.
    expect(starter.digest).toBe("26cefa2d376237cb521a8a312989495ed972ebc1fba098bc906a8a13ff14fc7f");
    expect(existsSync(join(dir, "agent", "tools.ts"))).toBe(false);
    // The worked example models the portable boundary: no campaign-specific path above HOST_ONLY.
    expect(portableGuide(EXAMPLE.guide)).not.toContain("public/task.json");
    expect(EXAMPLE.guide).toContain("public/task.json");
    // portableGuide strips HOST_ONLY at line start, mid-file, or EOF, without cutting prefix headings.
    expect(portableGuide(`${HOST_ONLY}\nhidden\n`)).toBe("");
    expect(portableGuide(`# Guide\n\nKeep\n\n${HOST_ONLY}`)).toBe("# Guide\n\nKeep\n");
    expect(portableGuide(`# Guide\n\n${HOST_ONLY} notes\nKeep\n`)).toBe(
      `# Guide\n\n${HOST_ONLY} notes\nKeep\n`,
    );
    // Tolerates CRLF, trailing spaces, heading level variants, and title-case variants.
    expect(portableGuide("# Guide\r\n\r\nKeep\r\n\r\n## Validity and score  \r\nhidden\r\n")).toBe(
      "# Guide\r\n\r\nKeep\r\n",
    );
    expect(portableGuide("# Guide\n\nKeep\n\n### Validity and Score\nhidden\n")).toBe("# Guide\n\nKeep\n");
  });

  it.skipIf(!osIsolationSupport().ok)(
    "prints a program the solver's shell runs by name, under the command wall",
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
          ["limits.json", TASK.publicInput],
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
        const within = "ann: 8 of 12 hours, ok\nbo: 6 of 8 hours, ok\n";
        expect(said(await run("check-rota rota.json public/task.json"))).toContain(within);
        // The same limits as a plain file of the values alone, as work outside a campaign holds them.
        expect(said(await run("check-rota rota.json limits.json"))).toContain(within);
        // It opens no file it was not named: without the limits it does not run.
        expect(said(await run("check-rota rota.json"))).toEndWith("Command exited with code 2");
        const over = await run("check-rota over.json public/task.json");
        expect(said(over)).toContain("ann: 14 of 12 hours, over by 2\nbo: 6 of 8 hours, ok");
        expect(over.isError).toBe(true);
        expect(said(over)).toEndWith("Command exited with code 1");
        expect(said(await run("check-rota absent.json limits.json"))).toEndWith("Command exited with code 2");
      } finally {
        rmSync(dirs.root, { recursive: true, force: true });
        rmSync(dirs.host, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
