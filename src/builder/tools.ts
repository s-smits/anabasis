/**
 * The Builder's tools. Three run on the command wall a solve's commands run on (`bash`,
 * `write_file`, `check_harness`), and three are the host's (`practice`, `read_trace`, `finish`).
 *
 * The wall is the solver's, so the repository, the operator's home and every other solve's scratch
 * are closed to the Builder by the operating system and not by a path check in this process. v1
 * said of its own Builder that a guard in the process it constrains is a convention and not a wall
 * (`src/builder/candidate-isolation.ts` at 7af7315), which is why `write_file` copies through a
 * walled command and no tool here reads a path for the Builder in the host's name.
 *
 * One read is the host's own: a snapshot of `harness/` is opened and bundled by the host, as a solve
 * opens any harness. A link under `agent/` to a file outside the harness would be bundled into the
 * solver's tools, and a tool could then print a check program into a trace the Builder reads. So a
 * snapshot whose `agent/` links out of it is refused. `.toolchain` is left alone: it is read only by
 * walled commands, and an interpreter's links legitimately leave the tree.
 *
 * `practice` is where the two reviewers meet the Builder. A fail goes to the Referee first; a fail
 * it rules a check defect does not count and its task leaves the session, and an earned fail goes on
 * to the Diagnoser. What comes back names the ending, the task's record and the Diagnoser's
 * reading, and never a check, a verdict's detail or the Referee's reasons.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { createBashTool } from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import { conditionsOf } from "../kernel/condition.ts";
import { type LogEvent, read } from "../kernel/log.ts";
import type { Ending } from "../kernel/solve.ts";
import { taskStates } from "../kernel/task.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isString } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import type { Diagnosis } from "../review/diagnoser.ts";
import { callList, callsOf, callText, solveOf, stringOf } from "../review/trace.ts";
import { text, tool } from "../solve/answer.ts";
import { type CommandWall, runWalled } from "../solve/command.ts";
import { type Harness, harnessTools, openHarness, pathsUnder } from "../solve/harness.ts";
import { shellTool } from "../solve/shell.ts";
import { shellQuote } from "../verify/solve-command-isolation.ts";
import { SHELL_WALLS } from "./prompt.ts";
import type { BuildRequest, PracticeTask } from "./session.ts";

/** `harness/` frozen: a copy kept under its digest, and what a solve would open it as. */
export interface Snapshot {
  readonly dir: string;
  readonly harness: Harness;
}

/** What a session's tools share. */
export interface Bench {
  readonly request: BuildRequest;
  /** The Builder's home, which holds `harness/` and `practice/`. */
  readonly home: string;
  /** The digest of the harness the session started from. */
  readonly parent: string;
  /** Practice solves spent. */
  spent: number;
  /** Task versions whose fail the Referee ruled a check defect in this session. */
  readonly disputed: Set<string>;
  /** Reviewer failures, kept for the host: their text may name a check, so the Builder is not shown it. */
  readonly faults: string[];
  /** `finish`'s note; null until it is called. */
  note: string | null;
}

/** What a submitted answer or a closing text shows of itself in a trace's head. */
const HEAD_CHARS = 4_000;

/** An ending as the Builder is shown it: the outcome and its kind. A non-result's reason can name a
 *  check, so only a broken harness's reason, which is the harness's own, is shown. */
export function endingText(ending: Ending): string {
  if (ending.outcome === "pass") return "pass";
  if (ending.outcome === "non-result") return `no result (${ending.kind})`;
  return ending.kind === "broken-harness"
    ? `fail (broken harness: ${ending.reason})`
    : `fail (${ending.kind})`;
}

/** A task version's counted test-side solves under one harness, by the log's condition records. */
export function record(events: readonly LogEvent[], version: string, harness: string) {
  const conditions = conditionsOf(events);
  const ran = new Set(
    events.flatMap(({ kind, data }) => {
      const condition = conditions.get(stringOf(data.condition));
      return kind === "solve.started" &&
        condition?.task === version &&
        condition.harness === harness &&
        condition.side === "test"
        ? [stringOf(data.solve)]
        : [];
    }),
  );
  const counted = events.flatMap(({ kind, data }) => {
    const outcome = asRecord(data.ending)?.outcome;
    return kind === "solve.finished" &&
      ran.has(stringOf(data.solve)) &&
      (outcome === "pass" || outcome === "fail")
      ? [{ solve: stringOf(data.solve), passed: outcome === "pass" }]
      : [];
  });
  return { solves: counted.map(({ solve }) => solve), passed: counted.filter(({ passed }) => passed).length };
}

/** Whether `path` is a link that resolves outside `root`; a link to nothing reaches nothing. */
function leaves(root: string, path: string): boolean {
  if (!lstatSync(path).isSymbolicLink()) return false;
  try {
    return !containsPath(realpathSync(path), root);
  } catch {
    return false;
  }
}

/**
 * Freeze `harness/` as it stands and keep the copy under its digest in the caller's `states`, so
 * every harness a practice solve ran with can be opened again. Throws, with the harness's own error,
 * when a solve could not open it. Links are copied as they are: a stored state carries links that
 * resolve to nothing, and following one would copy what it points at.
 *
 * The copy is not kept in the session's own scratch. The command wall closes the parent of every
 * solve's scratch after it reopens a harness's tool tree, so a tree kept there is one no practice
 * solve could run a program from.
 */
export async function snapshot(bench: Bench): Promise<Snapshot> {
  const { states } = bench.request;
  mkdirSync(states, { recursive: true });
  const dir = realpathSync(mkdtempSync(join(states, "freezing-")));
  try {
    cpSync(join(bench.home, "harness"), dir, { recursive: true, verbatimSymlinks: true });
    const stray = pathsUnder(join(dir, "agent")).find((path) => leaves(dir, join(dir, "agent", path)));
    if (stray !== undefined) {
      throw new Error(
        `agent/${stray} links outside the harness, and a solve's tools are built only from files inside it`,
      );
    }
    const harness = await openHarness(dir);
    const kept = join(realpathSync(states), harness.digest);
    if (existsSync(kept)) rmSync(dir, { recursive: true, force: true });
    else renameSync(dir, kept);
    return {
      dir: kept,
      harness: { ...harness, toolTree: harness.toolTree === null ? null : join(kept, ".toolchain") },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`the harness does not open: ${errorMessage(error)}`, { cause: error });
  }
}

/** `run` over `items`, `width` at a time, wave after wave, results in the items' order. */
async function inWaves<Item, Result>(
  items: readonly Item[],
  width: number,
  run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (let from = 0; from < items.length; from += Math.max(1, width)) {
    results.push(...(await Promise.all(items.slice(from, from + Math.max(1, width)).map(run))));
  }
  return results;
}

function diagnosisText(diagnosis: Diagnosis): string {
  if ("abstain" in diagnosis) return `The Diagnoser abstained: ${diagnosis.abstain}`;
  return [
    `Diagnosis (owner ${diagnosis.owner}, confidence ${diagnosis.confidence}): ${diagnosis.cause}`,
    `It would be refuted by: ${diagnosis.falsifier}`,
    `First divergence, quoted from the trace: ${diagnosis.firstDivergence}`,
  ].join("\n");
}

/** One practice solve and what the reviewers read of its fail. */
async function practise(bench: Bench, task: PracticeTask, frozen: Snapshot) {
  const { request } = bench;
  const { solve, ending } = await request.practise(task, frozen.dir, frozen.harness.digest);
  const lines: string[] = [];
  if (ending.outcome === "fail" && ending.kind !== "broken-harness" && request.referee !== undefined) {
    try {
      const finding = await request.referee(solve, task);
      if (finding.ruling === "check-defect") {
        bench.disputed.add(task.version);
        lines.push(
          "The Referee ruled this fail a check defect: it does not count, and the task leaves this session's practice.",
        );
      } else if (finding.ruling === "unclear") {
        lines.push(
          "The Referee could not settle whether this fail counts, so it is counted and not diagnosed.",
        );
      } else if (request.diagnose !== undefined) {
        lines.push(diagnosisText(await request.diagnose(solve, task)));
      }
    } catch (error) {
      bench.faults.push(`${solve}: ${errorMessage(error)}`);
      lines.push("The reviewers did not finish reading this fail.");
    }
  }
  return { task, solve, ending, lines };
}

export function practiceTool(bench: Bench): AgentTool {
  const { request } = bench;
  const offered = new Map(request.tasks.map((task) => [task.task.taskId, task]));
  return tool({
    name: "practice",
    label: "Practise",
    description:
      "Solve practice tasks with the harness as it stands in harness/, by the solver it is measured with, under the host's limits. Each named task is solved once; name a task twice to solve it twice. For each solve it returns the ending, the task's record under this harness and under the one you started from, the solve's id for read_trace and, for a fail, what the reviewers read. It never says which check refused an answer. A harness that does not open spends no solve.",
    parameters: Type.Object({
      tasks: Type.Array(Type.String(), {
        minItems: 1,
        description: "Practice task ids, as the opening message lists them.",
      }),
    }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      const unknown = args.tasks.find((id) => !offered.has(id));
      if (unknown !== undefined) {
        throw new Error(
          `${unknown} is not one of this session's practice tasks: ${[...offered.keys()].join(", ")}`,
        );
      }
      const chosen = args.tasks.flatMap((id) => offered.get(id) ?? []);
      const states = taskStates(read(request.log));
      const closed = chosen.find(
        ({ version }) => states.get(version) !== "released" || bench.disputed.has(version),
      );
      if (closed !== undefined) throw new Error(`${closed.task.taskId} is no longer a practice task`);
      const left = request.limits.practiceSolves - bench.spent;
      if (chosen.length > left) {
        throw new Error(
          `${String(left)} practice solve(s) are left, and this asks for ${String(chosen.length)}`,
        );
      }
      const frozen = await snapshot(bench);
      bench.spent += chosen.length;
      const solved = await inWaves(chosen, request.limits.concurrency, (task) =>
        practise(bench, task, frozen),
      );
      const events = read(request.log);
      const said = solved.map(({ task, solve, ending, lines }) => {
        const [now, before] = [frozen.harness.digest, bench.parent].map((harness) =>
          record(events, task.version, harness),
        );
        return [
          `${task.task.taskId}: ${endingText(ending)}. Solve ${solve}.`,
          `Record under this harness: passed ${String(now?.passed ?? 0)} of ${String(now?.solves.length ?? 0)}. Under the harness you started from: ${String(before?.passed ?? 0)} of ${String(before?.solves.length ?? 0)}.`,
          ...lines,
        ].join("\n");
      });
      return text(`${said.join("\n\n")}\n\n${String(left - chosen.length)} practice solve(s) left.`);
    },
  });
}

/** The paged trace of a practice solve. Which task version a solve ran is read from its logged
 *  condition, so a solve of any other task is refused whatever id is asked for. */
export function traceTool(bench: Bench): AgentTool {
  const versions = new Set(bench.request.tasks.map(({ version }) => version));
  return tool({
    name: "read_trace",
    label: "Read a trace",
    description:
      "Read a solve of one of your practice tasks: the ones the opening message lists and the ones practice returns. With no call, return its ending, the answer it submitted, its closing text and every tool call by number. With a call number, return that call whole: its arguments and up to 4000 characters of its result starting at `from`.",
    parameters: Type.Object({
      solve: Type.String({ description: "A solve's id." }),
      call: Type.Optional(Type.Number({ minimum: 1, description: "A call's number, from the list." })),
      from: Type.Optional(
        Type.Number({
          minimum: 0,
          description: "The first character of the result to return; 0 by default.",
        }),
      ),
    }),
    executionMode: "parallel",
    execute: async (_id, args) => {
      const events = read(bench.request.log);
      const own = solveOf(events, args.solve);
      const started = own.find((event) => event.kind === "solve.started");
      const condition = conditionsOf(events).get(stringOf(started?.data.condition));
      if (condition?.side !== "test" || !versions.has(condition.task)) {
        throw new Error(`${args.solve} is not a solve of one of this session's practice tasks`);
      }
      const calls = callsOf(own);
      if (args.call !== undefined) return text(callText(calls, args.call, args.from ?? 0));
      const ending = asRecord(own.findLast((event) => event.kind === "solve.finished")?.data.ending);
      const answer = own.findLast((event) => event.kind === "verdict")?.data.answer;
      const closing = own
        .flatMap((event) => (event.kind === "solve.turn" ? [stringOf(event.data.text)] : []))
        .findLast((said) => said !== "");
      return text(
        [
          `ending: ${isString(ending?.outcome) ? `${ending.outcome}${isString(ending.kind) ? ` (${ending.kind})` : ""}` : "not recorded"}`,
          answer === undefined
            ? "no answer was submitted"
            : `submitted answer: ${capturedJsonStringify(answer).slice(0, HEAD_CHARS)}`,
          `closing text: ${closing?.slice(0, HEAD_CHARS) ?? "(none recorded)"}`,
          callList(calls),
        ].join("\n"),
      );
    },
  });
}

export function finishTool(bench: Bench): AgentTool {
  return tool({
    name: "finish",
    label: "Finish",
    description:
      "End the session. What harness/ holds now is frozen and measured. Say in one or two sentences what you changed and what you expect it to move.",
    parameters: Type.Object({ note: Type.String({ minLength: 1, maxLength: 700 }) }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      bench.note = args.note.trim();
      return { ...text("Finished."), terminate: true };
    },
  });
}

/** One file under `harness/`, whole. The host stages the bytes into the command's own folder and a
 *  walled `cp` puts them in place, so where they may land is the wall's to decide. */
function writeTool(wall: CommandWall): AgentTool {
  return tool({
    name: "write_file",
    label: "Write a file",
    description:
      "Write one file under harness/ in your home directory, whole, creating its folders. For a guide or a tools module this is surer than quoting the text through bash.",
    parameters: Type.Object({
      path: Type.String({ description: "A path under harness/, such as agent/BUILT_AGENTS.md." }),
      content: Type.String(),
    }),
    executionMode: "sequential",
    execute: async (_id, args, signal) => {
      if (args.path.startsWith("/") || args.path.split("/").includes("..")) {
        throw new Error("path is relative to harness/ and has no .. step");
      }
      const target = `"$HOME/harness/"${shellQuote(args.path)}`;
      const output: Buffer[] = [];
      const { exitCode } = await runWalled(wall, `mkdir -p "$(dirname ${target})" && cp content ${target}`, {
        onData: (data) => output.push(data),
        signal,
        stage: ({ work }) => writeFileSync(join(work, "content"), args.content),
      });
      if (exitCode !== 0) {
        throw new Error(`not written: ${Buffer.concat(output).toString("utf8").slice(0, 2_000)}`);
      }
      return text(`Wrote harness/${args.path}, ${String(Buffer.byteLength(args.content))} bytes.`);
    },
  });
}

/** Open the harness and list its tools as a solve would, with no model call: a harness that does
 *  not open fails every task, and this finds that before a practice solve is spent on it. */
function checkTool(bench: Bench, wall: CommandWall): AgentTool {
  return tool({
    name: "check_harness",
    label: "Check the harness",
    description:
      "Open harness/ as a solve would and list its tools for one practice task. Reports the tools and the guide's length, or the error a solve would stop on. Spends no practice solve.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      const { harness } = await snapshot(bench);
      const sample = bench.request.tasks[0];
      const tools =
        sample === undefined
          ? [...harness.kinds.keys()]
          : (await harnessTools(harness, sample.task, { ...wall, toolTree: harness.toolTree })).map(
              ({ tool: listed }) => listed.name,
            );
      return text(
        `The harness opens. Tools: ${tools.join(", ") || "none"}. Guide: ${String(harness.guide?.length ?? 0)} characters.`,
      );
    },
  });
}

/** The three tools that run on the command wall. */
export function walledTools(bench: Bench, wall: CommandWall): AgentTool[] {
  return [
    { ...shellTool(wall, 0), description: `${createBashTool("/").description}${SHELL_WALLS}` },
    writeTool(wall),
    checkTool(bench, wall),
  ];
}
