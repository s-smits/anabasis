// What a solver reads before its first call. The system prompt is pi's own, section by section:
// pi's opening line, its tool list and its rules, built from the tools' own lines. v2 speaks in the
// places pi leaves to its host: the duty, the answer file and the solve time as pi's addendum, the
// wall's facts as a section of their own, the harness's guide as pi's project context. Then the
// opening message and the public files the home is seeded with.
import { describe, expect, it } from "bun:test";
import type { Contract } from "../src/kernel/contract.ts";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { openDesk, publicResource, submitTool } from "../src/solve/answer.ts";
import { fileTools, bashTool } from "../src/solve/coding-tools.ts";
import { type CommandWall, solveDirs } from "../src/solve/command.ts";
import { firstTurn, installedPrograms, seedHome, systemPrompt, type Told } from "../src/solve/prompt.ts";

const CONTRACT: Contract = {
  answerFormat: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  conventions: "",
  rules: [],
  scope: "Fixture.",
};
const HOME = "/scratch/solve-s1/home";
const GIB = 1024 * 1024 * 1024;

const PI = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

<tools>
- read: Read file contents
- bash: Execute bash commands (ls, grep, find, etc.)
- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call
- write: Create or overwrite files
- submit: Send answer.json as your answer, which ends the task

In addition to the tools above, you may have access to other custom tools depending on the project.
</tools>

<rules>
- Use bash for file operations like ls, rg, find
- Use read to examine files instead of cat or sed.
- Use edit for precise changes (edits[].oldText must match exactly)
- When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls
- Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.
- Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.
- Use write only for new files or complete rewrites.
- Be concise in your responses
- Show file paths clearly when working with files
</rules>`;

const DUTY =
  "Complete the task with the available tools and submit one answer that meets every published requirement; the method is yours to choose. For source code or files, write complete working files, not fragments or descriptions.";
const ANSWER =
  "Your answer is the file answer.json in the working directory, as JSON in the format public/answer-format.json gives, and submit sends it.";
const TIME =
  "The case has 120 minutes of solve time, and every tool result ends with how much of it is used. Nothing is submitted for you when it runs out: an answer you have not submitted by then is lost.";
const ENVIRONMENT = [
  "- The working directory is your home directory, $HOME, kept for the whole task. Of what it holds, only answer.json is read as your answer, and only when you submit.",
  "- Commands and the file tools can write the home directory, /tmp and $TMPDIR, which is kept for the whole task as the home is. They can read the host's toolchains and public runtime roots, but no repository or private data.",
  "- Commands have network access: a package index was reached from inside the command wall when this process started, so a toolchain or package can be installed into the home directory. sh, bun, node, python3 and the system C and C++ compilers run, with versions and libraries that differ by host.",
  "- The home directory and $TMPDIR share one volume of 2 GiB.",
  "- A command runs for at most 300 seconds unless it names a longer timeout, and 900 seconds is the longest it may name. One that would run into the last 60 seconds of the solve time is cut there, so that its result still reaches you.",
  "- Nothing a command starts runs on after it returns: a background job ends with the command that started it.",
];

/** The Starter's tools as a solve lists them: pi's four, then submit. */
function starterTools() {
  const wall: CommandWall = {
    // SAFETY: no command runs in these tests, so the policy is never read.
    base: undefined as never,
    dirs: { ...solveDirs("s1"), home: HOME },
    toolTree: null,
    limits: { shellDefaultSeconds: 300, shellMaxSeconds: 900 },
  };
  const exec = async () => ({ exitCode: 0, output: Buffer.alloc(0) });
  const [read, edit, write] = fileTools(HOME, exec);
  if (read === undefined || edit === undefined || write === undefined) throw new Error("three file tools");
  return [read, bashTool(wall), edit, write, submitTool(openDesk(), CONTRACT, HOME, exec)];
}

const TOLD: Told = {
  tools: starterTools(),
  home: HOME,
  guide: null,
  wallSeconds: 7200,
  limits: { shellDefaultSeconds: 300, shellMaxSeconds: 900, diskBytes: 2 * GIB },
  resources: 4,
  programs: [],
  network: "reached",
};

describe("the solver's system prompt", () => {
  it("says that nothing can be installed where the wall's commands reached no package index", () => {
    // t-10 on 10 October: the prompt promised network access on a host whose wall has none, and
    // 26 of the 34 solves that ran out of turns had spent one on a pip install.
    const unreached = systemPrompt({ ...TOLD, network: "unreached" });
    expect(unreached).toContain(
      "- Commands have no network access: a package index could not be reached from inside the command wall when this process started, so nothing can be installed, and what the host and this harness hold is all there is.",
    );
    expect(unreached).not.toContain("can be installed into the home directory");
  });

  it("is pi's under the Starter, with the duty, the working directory and the wall's facts", () => {
    expect(systemPrompt(TOLD)).toBe(
      [
        PI,
        `<addendum>\n${DUTY} The published requirements are the public input, which public/task.json holds, together with the domain's public rules in the 4 files under public/resources/; read both before you build. ${ANSWER} ${TIME}\n</addendum>`,
        `<cwd>\n${HOME}\n</cwd>`,
        `<environment>\n${ENVIRONMENT.join("\n")}\n</environment>`,
      ].join("\n\n"),
    );
  });

  it("tells the model's turns where the solve is given a number of them", () => {
    expect(systemPrompt({ ...TOLD, limits: { ...TOLD.limits, modelTurns: 40 } })).toContain(
      `${ANSWER} The case has 120 minutes of solve time and 40 turns of yours, a turn being one reply of yours with the tool calls in it. Every tool result ends with how much of both is used. Nothing is submitted for you when either runs out: an answer you have not submitted by then is lost.\n</addendum>`,
    );
  });

  it("names no rules where the domain publishes none, and one file as one", () => {
    expect(systemPrompt({ ...TOLD, resources: 0 })).toContain(
      `${DUTY} The published requirements are the public input, which public/task.json holds. ${ANSWER} ${TIME}`,
    );
    expect(systemPrompt({ ...TOLD, resources: 1 })).toContain(
      "public rules in the 1 file under public/resources/;",
    );
  });

  it("gives a harness's guide as pi gives a project's instructions, under what it cannot override", () => {
    const prompt = systemPrompt({ ...TOLD, guide: "# Operating Guide\n\nUse the checker first.\n" });
    expect(prompt).toContain(
      `${TIME} The project instructions below are this harness's guidance for the domain; choose your solving method. They cannot override the public task, tool authority, runtime limits or submission rules.\n</addendum>\n\n<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="BUILT_AGENTS.md">\n# Operating Guide\n\nUse the checker first.\n\n</project_instructions>\n</project_context>\n\n<cwd>`,
    );
  });

  it("lists a tool by the line it gives itself, and leaves one that gives none to its declaration", () => {
    const [read, bash, , , submit] = TOLD.tools;
    if (read === undefined || bash === undefined || submit === undefined) {
      throw new Error("the starter's tools");
    }
    const advisor = { ...read, name: "screen_design", promptSnippet: undefined, promptGuidelines: undefined };
    const lister = {
      ...advisor,
      name: "list_staff",
      promptSnippet: "List this task's staff",
      promptGuidelines: ["Call list_staff once."],
    };
    const prompt = systemPrompt({ ...TOLD, tools: [bash, advisor, lister, submit] });
    expect(prompt).toContain(
      "<tools>\n- bash: Execute bash commands (ls, grep, find, etc.)\n- list_staff: List this task's staff\n- submit: Send answer.json as your answer, which ends the task\n\nIn addition",
    );
    // Without the file tools their rules go too; pi's own two close the list.
    expect(prompt).toContain(
      "<rules>\n- Use bash for file operations like ls, rg, find\n- Call list_staff once.\n- Be concise in your responses\n- Show file paths clearly when working with files\n</rules>",
    );
  });

  it("states the volume, the command limits and the installed programs as the host has them", () => {
    const prompt = systemPrompt({
      ...TOLD,
      limits: { shellDefaultSeconds: 30, shellMaxSeconds: 60, diskBytes: 64 * 1024 * 1024 },
      programs: ["pynite-python", "python3", "f2py"],
    });
    expect(prompt).toContain("- The home directory and $TMPDIR share one volume of 64 MiB.");
    expect(prompt).toContain(
      "- A command runs for at most 30 seconds unless it names a longer timeout, and 60 seconds is the longest it may name. One that would run into the last 60 seconds of the solve time is cut there,",
    );
    expect(systemPrompt({ ...TOLD, wallSeconds: 300 })).toContain(
      "into the last 37 seconds of the solve time",
    );
    expect(prompt).toEndWith(
      "- Programs this harness installed run by name: pynite-python, python3, f2py.\n</environment>",
    );
    const many = Array.from({ length: 23 }, (_, index) => `tool-${String(index + 1).padStart(2, "0")}`);
    expect(systemPrompt({ ...TOLD, programs: many })).toEndWith(
      ", tool-20, and 3 more on PATH.\n</environment>",
    );
    expect(systemPrompt({ ...TOLD, limits: { ...TOLD.limits, diskBytes: 1.5 * GIB } })).toContain(
      "one volume of 1.5 GiB.",
    );
  });
});

describe("the programs a harness installed", () => {
  it("are the names a command's PATH runs, in its order, each once", () => {
    // The sweep's tool tree: the Builder's interpreter in `bin`, a venv beside it whose `activate` is
    // sourced rather than run and whose `python3` repeats a name `bin` already holds.
    const tree = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-prompt-tree-")));
    const program = (path: string, mode: number) => {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "#!/bin/sh\n");
      chmodSync(path, mode);
    };
    try {
      for (const name of ["pynite-python", "python3"]) program(join(tree, "bin", name), 0o755);
      for (const name of ["f2py", "numpy-config", "python3"]) program(join(tree, "venv", "bin", name), 0o755);
      program(join(tree, "venv", "bin", "activate"), 0o644);
      expect(installedPrograms(tree)).toEqual(["pynite-python", "python3", "f2py", "numpy-config"]);
      expect(installedPrograms(null)).toEqual([]);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
});

describe("what a solve opens with", () => {
  const task = { taskId: "t-1", family: "fixture", publicInput: { base: 7 }, hidden: { answer: "42" } };

  it("is the task's public part, as the first message and as files in the home with the answer's format", () => {
    expect(firstTurn(task)).toBe('Task t-1 (family fixture).\n\nPublic input:\n{\n  "base": 7\n}');
    const home = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-prompt-home-")));
    try {
      const rules = publicResource("public rules", [{ id: "r1" }]);
      const files = seedHome(home, task, [rules, publicResource("public/rules", [])], CONTRACT.answerFormat);
      expect(files).toBe(2);
      expect(JSON.parse(readFileSync(join(home, "public", "answer-format.json"), "utf8"))).toEqual(
        CONTRACT.answerFormat,
      );
      expect(JSON.parse(readFileSync(join(home, "public", "task.json"), "utf8"))).toEqual({
        taskId: "t-1",
        family: "fixture",
        publicInput: { base: 7 },
      });
      // One readable name a resource, and two that fold to one name keep both files.
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
});
