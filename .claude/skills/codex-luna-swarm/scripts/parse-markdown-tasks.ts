#!/usr/bin/env bun

import { sha256 } from "#src/meta/digest.ts";
import fs from "#src/meta/filesystem.ts";
import { type ExitWith, exitWith, parseOrDie } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { hasText } from "#src/meta/text.ts";

type Options = {
  inspect: boolean;
  keepSeparators: boolean;
  input: string;
  output: string | undefined;
  instructionsOutput: string | undefined;
  expectedCount: number | undefined;
  headingLevel: number | undefined;
};
type Heading = {
  level: number;
  title: string;
  line: number;
  offset: number;
  number: number | undefined;
  nameTitle: string;
};
type CandidateGroup = { level: number; count: number; numberedCount: number; sequential: boolean };

const usedNames = new Set<string>();
/** Every refusal here is the input's fault, so it exits 1 as the script always has. */
const die: ExitWith = exitWith("parse-markdown-tasks");
function fail(message: string): never {
  return die(message, 1);
}

function parseArgs(argv: readonly string[]): Options {
  const { single, flags } = parseOrDie(
    fail,
    {
      values: ["input", "output", "instructions-output", "expected-count", "heading-level"],
      flags: ["inspect", "keep-separators"],
    },
    argv,
  );
  const numeric = (name: string): number | undefined =>
    single.has(name) ? Number(single.get(name)) : undefined;
  const input = single.get("input");
  if (!hasText(input)) fail("--input is required");
  const options: Options = {
    inspect: flags.has("inspect"),
    keepSeparators: flags.has("keep-separators"),
    input,
    output: single.get("output"),
    instructionsOutput: single.get("instructions-output"),
    expectedCount: numeric("expected-count"),
    headingLevel: numeric("heading-level"),
  };
  if (!options.inspect && !hasText(options.output)) fail("--output is required unless --inspect is used");
  if (options.expectedCount !== undefined && !Number.isInteger(options.expectedCount)) {
    fail("--expected-count must be an integer");
  }
  if (options.headingLevel !== undefined && ![1, 2, 3, 4, 5, 6].includes(options.headingLevel)) {
    fail("--heading-level must be an integer from 1 to 6");
  }
  return options;
}

function headingsOutsideFences(markdown: string): Heading[] {
  const lines = markdown.split("\n");
  const headings: Heading[] = [];
  let fence: string | undefined;
  let offset = 0;

  for (const [index, line] of lines.entries()) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (!hasText(fence)) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
    } else if (!hasText(fence)) {
      const headingMatch = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
      if (headingMatch) {
        const title = headingMatch[2] ?? "";
        const numbered = /^\s*(\d+)[.)][ \t]+(.+)$/.exec(title);
        headings.push({
          level: (headingMatch[1] ?? "").length,
          title,
          line: index + 1,
          offset,
          number: numbered ? Number(numbered[1]) : undefined,
          nameTitle: numbered ? (numbered[2] ?? title) : title,
        });
      }
    }
    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  }
  return headings;
}

function candidateGroups(headings: readonly Heading[]): CandidateGroup[] {
  const levels = [...new Set(headings.map(({ level }) => level))].sort((a, b) => a - b);
  return levels.map((level) => {
    const atLevel = headings.filter((heading) => heading.level === level);
    const numbered = atLevel.filter((heading) => heading.number !== undefined);
    const sequential =
      numbered.length > 0 && numbered.every((heading, index) => heading.number === index + 1);
    return { level, count: atLevel.length, numberedCount: numbered.length, sequential };
  });
}

function chooseTaskHeadings(headings: readonly Heading[], options: Options): Heading[] {
  const groups = candidateGroups(headings);
  if (options.headingLevel !== undefined) {
    const chosen = headings.filter(({ level }) => level === options.headingLevel);
    if (chosen.length === 0) fail(`No headings found at level ${options.headingLevel}`);
    return chosen;
  }

  const numberedCandidates = groups.filter(
    ({ numberedCount, sequential }) => numberedCount > 0 && sequential,
  );
  const matchingNumbered =
    options.expectedCount === undefined
      ? numberedCandidates
      : numberedCandidates.filter(({ numberedCount }) => numberedCount === options.expectedCount);
  if (matchingNumbered.length === 1) {
    const level = matchingNumbered[0]?.level;
    return headings.filter((heading) => heading.level === level && heading.number !== undefined);
  }
  if (matchingNumbered.length > 1) {
    fail(`Ambiguous numbered task levels: ${matchingNumbered.map(({ level }) => level).join(", ")}`);
  }

  const repeated = groups.filter(({ count }) => count > 1);
  const matchingRepeated =
    options.expectedCount === undefined
      ? repeated
      : repeated.filter(({ count }) => count === options.expectedCount);
  if (matchingRepeated.length !== 1) {
    fail(`Cannot choose one task-heading level; candidates: ${JSON.stringify(groups)}`);
  }
  const level = matchingRepeated[0]?.level;
  return headings.filter((heading) => heading.level === level);
}

function stripInterSectionRule(section: string): string {
  const lines = section.split("\n");
  while (lines.at(-1)?.trim() === "") lines.pop();
  if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(lines.at(-1) ?? "")) {
    lines.pop();
    while (lines.at(-1)?.trim() === "") lines.pop();
  }
  return lines.join("\n").trim();
}

function taskName(title: string, fallback: string, used: Set<string>): string {
  const stem =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback;
  const base = /^[a-z]/.test(stem) ? stem : `task_${stem}`;
  let name = base.slice(0, 48).replace(/_+$/g, "");
  let suffix = 2;
  while (used.has(name)) {
    const ending = `_${suffix++}`;
    name = `${base.slice(0, 48 - ending.length).replace(/_+$/g, "")}${ending}`;
  }
  used.add(name);
  return name;
}

const options = parseArgs(Bun.argv.slice(2));
const sourceBytes = fs.readFileSync(options.input);
const markdown = sourceBytes.toString("utf8").replace(/\r\n/g, "\n");
const headings = headingsOutsideFences(markdown);
const groups = candidateGroups(headings);

if (options.inspect) {
  console.log(
    JSON.stringify(
      {
        input: options.input,
        sourceSha256: sha256(sourceBytes),
        lineCount: markdown.split("\n").length,
        headings,
        candidateGroups: groups,
      },
      null,
      2,
    ),
  );
  runtimeProcess.exit(0);
}

const taskHeadings = chooseTaskHeadings(headings, options);
if (options.expectedCount !== undefined && taskHeadings.length !== options.expectedCount) {
  fail(`Expected ${options.expectedCount} tasks, found ${taskHeadings.length}`);
}

const tasks = taskHeadings.map((heading, index) => {
  const nextOffset = taskHeadings[index + 1]?.offset ?? markdown.length;
  const rawSection = markdown.slice(heading.offset, nextOffset);
  const task = options.keepSeparators ? rawSection.trim() : stripInterSectionRule(rawSection);
  return {
    name: taskName(heading.nameTitle, `task_${index + 1}`, usedNames),
    task,
  };
});

const numbered = taskHeadings.filter(({ number }) => number !== undefined);
if (numbered.length > 0 && !numbered.every((heading, index) => heading.number === index + 1)) {
  fail("Numbered task headings are not sequential from 1");
}

const encoded = `${JSON.stringify(tasks, null, 2)}\n`;
// `parseArgs` refused a run without --output unless it inspected, and an inspection exited above.
fs.writeFileSync(options.output ?? fail("--output is required unless --inspect is used"), encoded);

const preamble = markdown.slice(0, taskHeadings[0]?.offset).trim();
if (hasText(options.instructionsOutput)) {
  fs.writeFileSync(options.instructionsOutput, preamble ? `${preamble}\n` : "");
}

console.log(
  JSON.stringify(
    {
      input: options.input,
      output: options.output,
      sourceSha256: sha256(sourceBytes),
      taskHeadingLevel: taskHeadings[0]?.level,
      taskCount: tasks.length,
      preambleChars: preamble.length,
      tasks: tasks.map((task, index) => ({
        number: taskHeadings[index]?.number,
        name: task.name,
        sha256: sha256(task.task),
        chars: task.task.length,
      })),
    },
    null,
    2,
  ),
);
