// The solver's role, durable tool descriptions, rules, duty, environment and guide, then the public
// opening and files. The assertions hold the facts and the wall, rather than a vendor prompt copy.
import { describe, expect, it } from "bun:test";
import type { Contract } from "../src/kernel/contract.ts";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { openDesk, publicResource, submitTool } from "../src/tools/answer.ts";
import { codingTools } from "../src/tools/coding.ts";
import { type CommandWall, heldSeconds, solveDirs } from "../src/tools/command.ts";
import { firstTurn, seedHome, systemPrompt, type Told } from "../src/solver/prompt.ts";

const CONTRACT: Contract = {
  answerFormat: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  conventions: "",
  rules: [],
  scope: "Fixture.",
};
const HOME = "/scratch/solve-s1/home";

const DUTY =
  "Complete the task with the available tools and submit one answer that meets every published requirement; the method is yours to choose. For source code or files, write complete working files, not fragments or descriptions.";
const ANSWER =
  "Your answer is the file answer.json in the working directory, as JSON in the format public/answer-format.json gives, and submit sends it.";
const TIME =
  "The case has 120 minutes of solve time, and every tool result ends with how much of it is used. Nothing is submitted for you when it runs out: an answer you have not submitted by then is lost.";
const ENVIRONMENT = [
  "- The working directory is your home directory, $HOME, kept for the whole task. Of what it holds, only answer.json is read as your answer, and only when you submit.",
  "- Commands and the file tools can write the home directory and $TMPDIR, which is kept for the whole task as the home is; a path under /tmp is not: a write there is refused, or lands in a folder that does not outlive the command. They can read the host's toolchains and public runtime roots, but no repository or private data.",
  "- Commands have network access: a package index was reached from inside the command wall when this process started, so a toolchain or package can be installed into the home directory. sh, bun, node, python3 and the system C and C++ compilers run, with versions and libraries that differ by host.",
  "- A command runs for at most 300 seconds unless it names a longer timeout, and 900 seconds is the longest it may name. One that would run into the last 60 seconds of the solve time is cut there, so that its result still reaches you; one started within those last 60 seconds keeps its own limit, and the end of the solve stops it.",
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
  return [
    ...codingTools(wall, ["read", "bash", "edit", "write"]),
    submitTool(openDesk(), CONTRACT, HOME, exec),
  ];
}

const TOLD: Told = {
  tools: starterTools(),
  home: HOME,
  guide: null,
  wallSeconds: 7200,
  limits: { shellDefaultSeconds: 300, shellMaxSeconds: 900 },
  resources: 4,
  programs: [],
  network: "reached",
};

/** The command rule's numeric facts, independent of the prose around them. */
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
  it("says that nothing can be installed where the wall's commands reached no package index", () => {
    // t-10 on 10 October: the prompt promised network access on a host whose wall has none, and
    // 26 of the 34 solves that ran out of turns had spent one on a pip install.
    const unreached = systemPrompt({ ...TOLD, network: "unreached" });
    expect(unreached).toContain(
      "- Commands have no network access: a package index could not be reached from inside the command wall when this process started, so nothing can be installed, and what the host and this harness hold is all there is.",
    );
    expect(unreached).not.toContain("can be installed into the home directory");
  });

  it("states the role, tools, duty, working directory and wall facts under the Starter", () => {
    const prompt = systemPrompt(TOLD);
    expect(prompt).toContain("coding assistant operating inside pi");
    expect(prompt).toContain(DUTY);
    expect(prompt).toContain(ANSWER);
    expect(prompt).toContain(TIME);
    expect(prompt).toContain("public/task.json");
    expect(prompt).toContain("4 files under public/resources/");
    expect(prompt).toContain(`<cwd>\n${HOME}\n</cwd>`);
    for (const fact of ENVIRONMENT) expect(prompt).toContain(fact);
    for (const { name, description } of TOLD.tools) expect(prompt).toContain(`- ${name}: ${description}`);
    expect(prompt).toContain("edits[].oldText must match exactly");
    expect(prompt).toContain("matched against the original file");
    expect(prompt).toContain("Do not emit overlapping or nested edits");
    expect(prompt).toContain("Use write only for new files or complete rewrites");
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

  it("lists every tool by its own description in one line and selects the rules with the tools", () => {
    const [read, bash, , , submit] = TOLD.tools;
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
    expect(commandLimits(prompt)).toEqual([30, 60, 60, 60]);
    expect(commandLimits(systemPrompt({ ...TOLD, wallSeconds: 300 }))).toEqual([300, 900, 37, 37]);
    expect(prompt).toEndWith(
      "- Programs this harness installed run by name: pynite-python, python3, f2py.\n</environment>",
    );
    const many = Array.from({ length: 23 }, (_, index) => `tool-${String(index + 1).padStart(2, "0")}`);
    expect(systemPrompt({ ...TOLD, programs: many })).toEndWith(
      ", tool-20, and 3 more on PATH.\n</environment>",
    );
  });

  it("states the command limit the runner applies before, at and inside the reserve", () => {
    // Until 20 October the prompt left out a command started inside the reserve, which keeps its
    // own limit: four whole-run investigations read the sentence as a promise the runner breaks.
    const [ordinary = NaN, , reserve = NaN] = commandLimits(systemPrompt({ ...TOLD, wallSeconds: 480 }));
    const held = (used: number) =>
      heldSeconds(
        undefined,
        { limits: TOLD.limits, clock: { started: 1_000_000 - used * 1000, seconds: 480 } },
        1_000_000,
      ).seconds;
    expect(held(400)).toBe(480 - reserve - 400);
    expect(held(480 - reserve)).toBe(ordinary);
    expect(held(470)).toBe(ordinary);
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
