// The solver's role, durable tool descriptions, rules, duty, environment and guide, then the public
// opening and files. The assertions hold the facts and the wall, rather than a vendor prompt copy.
import { describe, expect, it } from "bun:test";
import type { Contract } from "../src/kernel/contract.ts";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { openDesk, publicResource, submitTool } from "../src/tools/answer.ts";
import { codingTools } from "../src/tools/coding.ts";
import { type CommandSandbox, type NetworkReach, solveDirs } from "../src/tools/command.ts";
import { firstTurn, seedHome, systemPrompt, type Told } from "../src/solver/prompt.ts";

const CONTRACT: Contract = {
  answerFormat: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  conventions: "",
  rules: [],
  scope: "Fixture.",
};
const HOME = "/scratch/solve-s1/home";

const wall: CommandSandbox = {
  // SAFETY: no command runs in these tests, so the policy is never read.
  base: undefined as never,
  dirs: { ...solveDirs("s1"), home: HOME },
  toolTree: null,
  limits: { shellDefaultSeconds: 300, shellMaxSeconds: 900 },
};
const exec = async () => ({ exitCode: 0, output: Buffer.alloc(0) });
const TOLD: Told = {
  tools: [
    ...codingTools(wall, ["read", "bash", "edit", "write"]),
    submitTool(openDesk(), CONTRACT, HOME, exec),
  ],
  home: HOME,
  guide: null,
  wallSeconds: 7200,
  limits: { shellDefaultSeconds: 300, shellMaxSeconds: 900 },
  resources: 4,
  files: 0,
  programs: [],
  network: "uv",
};

function commandLimits(prompt: string): number[] {
  return (
    prompt
      .split("\n")
      .find((line) => line.startsWith("- A command "))
      ?.match(/\d+/g)
      ?.map(Number) ?? []
  );
}

describe("the solver's system prompt", () => {
  it("names uv for Python packages where the wall found it, pip where it did not, and neither offline", () => {
    const told = (network: NetworkReach) => systemPrompt({ ...TOLD, network });
    for (const verb of ["uv add", "uv remove", "uv tree"]) expect(told("uv")).toContain(verb);
    expect(told("pip")).toContain("use pip for Python packages");
    expect(told("pip")).not.toContain("uv add");
    expect(told("unreached")).not.toMatch(/\buv\b|\bpip\b/u);
  });

  it("states the role, tools, duty, working directory and wall facts under the Starter", () => {
    const prompt = systemPrompt(TOLD);
    expect(prompt).toContain("coding assistant operating inside pi");
    for (const fact of ["answer.json", "public/answer-format.json", "public/task.json", "120 minutes"]) {
      expect(prompt).toContain(fact);
    }
    expect(prompt).toMatch(/4 files.*public\/resources\//u);
    expect(prompt).toContain(`<cwd>\n${HOME}\n</cwd>`);
    expect(prompt).toContain("$TMPDIR");
    expect(prompt).toContain("Commands have network access");
    expect(commandLimits(prompt)).toEqual([300, 900, 60]);
    for (const { name, description } of TOLD.tools) expect(prompt).toContain(`- ${name}: ${description}`);
    expect(prompt).toContain("matched against the original file, not after earlier edits are applied");
    expect(prompt).toContain("as small as possible while still being unique");
    // The edit rules leave to pi's edit description what it states: unique, non-overlapping matches,
    // nearby changes merged, and no unchanged padding.
    const edit = TOLD.tools.find(({ name }) => name === "edit")?.description ?? "";
    for (const fact of [
      "unique, non-overlapping region",
      "merge them into one edit",
      "large unchanged regions",
    ]) {
      expect(edit).toContain(fact);
    }
    expect(prompt).toContain("Use write only for new files or complete rewrites");
  });

  it("lists every tool by its own description in one line and selects the rules with the tools", () => {
    const { 0: read, 1: bash, 4: submit } = TOLD.tools;
    if (read === undefined || bash === undefined || submit === undefined) {
      throw new Error("the starter's tools");
    }
    const advisor = { ...read, name: "screen_design", description: "Screen a design." };
    const lister = {
      ...advisor,
      name: "list_staff",
      description: "List this task's staff.\nInclude their hours.",
    };
    const prompt = systemPrompt({ ...TOLD, tools: [bash, advisor, lister, submit] });
    expect(prompt).toContain(`- bash: ${bash.description}`);
    expect(prompt).toContain("- screen_design: Screen a design.");
    expect(prompt).toContain("- list_staff: List this task's staff. Include their hours.");
    expect(prompt).toContain(`- submit: ${submit.description}`);
    expect(prompt).toContain("Use bash for file operations");
    expect(prompt).toContain("Be concise");
    expect(prompt).toContain("Show file paths");
    expect(prompt).not.toContain("Use read");
    expect(prompt).not.toContain("edits[].oldText");
    expect(prompt).not.toContain("Use write");
    expect(systemPrompt({ ...TOLD, tools: [] })).not.toContain("Use bash");
  });

  it("states the command limits and the installed programs as the host has them", () => {
    const prompt = systemPrompt({
      ...TOLD,
      limits: { shellDefaultSeconds: 30, shellMaxSeconds: 60 },
      programs: ["pynite-python", "python3", "f2py"],
    });
    expect(commandLimits(prompt)).toEqual([30, 60, 60]);
    for (const [wallSeconds, reserve] of [
      [300, 37],
      [480, 60],
      [7200, 60],
    ] as const) {
      expect(commandLimits(systemPrompt({ ...TOLD, wallSeconds }))).toEqual([300, 900, reserve]);
    }
    for (const program of ["pynite-python", "python3", "f2py"]) expect(prompt).toContain(program);
    const many = Array.from({ length: 23 }, (_, index) => `tool-${String(index + 1).padStart(2, "0")}`);
    const listed = systemPrompt({ ...TOLD, programs: many });
    expect(listed).toContain("tool-20");
    expect(listed).toContain("3 more");
    expect(listed).not.toContain("tool-21");
  });
});

describe("what a solve opens with", () => {
  const task = { taskId: "t-1", family: "fixture", publicInput: { base: 7 }, hidden: { answer: "42" } };

  it("is the task's public part, as the first message and as files in the home with the answer's format", () => {
    expect(firstTurn(task)).toBe('Task t-1 (family fixture).\n\nPublic input:\n{\n  "base": 7\n}');
    const changed = { ...task, hidden: { answer: "different" } };
    expect(firstTurn(changed)).toBe(firstTurn(task));
    const home = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-prompt-home-")));
    try {
      const rules = publicResource("public rules", [{ id: "r1" }]);
      const files = seedHome(home, task, [rules, publicResource("public/rules", [])], CONTRACT.answerFormat);
      expect(files).toEqual({ resources: 2, files: 0 });
      expect(JSON.parse(readFileSync(join(home, "public", "answer-format.json"), "utf8"))).toEqual(
        CONTRACT.answerFormat,
      );
      expect(JSON.parse(readFileSync(join(home, "public", "task.json"), "utf8"))).toEqual({
        taskId: "t-1",
        family: "fixture",
        publicInput: { base: 7 },
      });
      expect(
        JSON.parse(readFileSync(join(home, "public", "resources", "public-rules.json"), "utf8")),
      ).toEqual(rules);
      expect(readFileSync(join(home, "public", "resources", "public-rules-2.json"), "utf8")).toContain(
        '"public/rules"',
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("writes each file the public input lists as that file, and nothing a row's path would put elsewhere", () => {
    const listed = {
      taskId: "t-2",
      family: "fixture",
      publicInput: {
        note: "the rows are data a practitioner is handed",
        files: [
          { path: "data/sales.csv", text: "region,units\nnorth,3\n" },
          { path: "notes/memo.md", text: "# Memo\n" },
          { path: "book.xlsx", base64: "UEsDBA==" },
          { path: "pack.zip", entries: [{ path: "a.txt", text: "ok" }] },
          { path: "bad.bin", base64: "not valid base64!" },
          { path: "data", text: "a file where a folder already stands" },
          { path: "notes/memo.md/under", text: "a folder where a file already stands" },
          { path: "data/sales.csv", text: "a second row of one path" },
          { path: "nul\0.txt", text: "a name no file may have" },
          { path: `${"n".repeat(300)}.txt`, text: "a name past the length a file may have" },
          { path: "../outside.txt", text: "leaves the folder" },
          { path: "/etc/absolute.txt", text: "names a root" },
          { path: "data/../../climbs.txt", text: "leaves it by a detour" },
          { path: "no-content.txt" },
          { text: "no path" },
          "not a row",
        ],
      },
    };
    const home = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-prompt-files-")));
    try {
      expect(seedHome(home, listed, [], CONTRACT.answerFormat)).toEqual({ resources: 0, files: 4 });
      const root = join(home, "public", "files");
      expect(readFileSync(join(root, "data", "sales.csv"), "utf8")).toBe("region,units\nnorth,3\n");
      expect(readFileSync(join(root, "notes", "memo.md"), "utf8")).toBe("# Memo\n");
      expect(readFileSync(join(root, "book.xlsx"))).toEqual(Buffer.from("UEsDBA==", "base64"));
      expect(readFileSync(join(root, "pack.zip")).subarray(0, 4)).toEqual(
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      );
      for (const stray of [
        join(home, "public", "outside.txt"),
        join(home, "climbs.txt"),
        join(home, "public", "climbs.txt"),
        join(root, "no-content.txt"),
        join(root, "bad.bin"),
        join(root, "etc", "absolute.txt"),
      ]) {
        expect(existsSync(stray)).toBe(false);
      }
      // The JSON keeps every row as written: the files are a second form of it, not a cut.
      expect(JSON.parse(readFileSync(join(home, "public", "task.json"), "utf8"))).toEqual(listed);
      // The first message names each written file instead of repeating it; any row not written
      // as a file, the second row of one path included, stays as written.
      const opening: unknown = JSON.parse(firstTurn(listed).split("Public input:\n")[1] ?? "");
      const rows = listed.publicInput.files;
      expect(opening).toEqual({
        ...listed.publicInput,
        files: [
          { path: "data/sales.csv", file: "public/files/data/sales.csv", bytes: 21 },
          { path: "notes/memo.md", file: "public/files/notes/memo.md", bytes: 7 },
          { path: "book.xlsx", file: "public/files/book.xlsx", bytes: 4 },
          {
            path: "pack.zip",
            file: "public/files/pack.zip",
            bytes: readFileSync(join(root, "pack.zip")).length,
          },
          ...rows.slice(4),
        ],
      });
      expect(firstTurn(listed)).not.toContain("region,units");
      expect(firstTurn(listed)).not.toContain("UEsDBA==");
      // A public input whose `files` is no list has none, and its home no folder for them.
      const other = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-prompt-files-")));
      try {
        const none = { ...listed, publicInput: { files: { "a.csv": "x" } } };
        expect(seedHome(other, none, [], CONTRACT.answerFormat)).toEqual({ resources: 0, files: 0 });
        expect(existsSync(join(other, "public", "files"))).toBe(false);
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("tells the solver where those files are only where a task has them", () => {
    expect(systemPrompt(TOLD)).not.toContain("public/files/");
    expect(systemPrompt({ ...TOLD, files: 2 })).toMatch(/public\/files\/ too, 2 files,/u);
    expect(systemPrompt({ ...TOLD, files: 1 })).toMatch(/public\/files\/ too, 1 file,/u);
  });
});
