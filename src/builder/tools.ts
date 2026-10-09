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
 * opens any harness. `openHarness` builds a harness's tools from its own files alone: it refuses a
 * named file that links out of the harness and an import that lands outside it, so nothing here asks
 * that question a second time.
 *
 * The installed programs are the session's own. `harness/.toolchain` starts as a copy of the
 * parent's tool tree, which the wall puts first on PATH, and the Builder installs into it as it
 * likes. A frozen harness links to a copy of that tree kept beside the states, made again only when
 * the tree has changed since. A harness is frozen, and its solves run, away from the home it was
 * built in, which is gone once the session ends; so a snapshot in which a link or a script names
 * that home is refused, with how to write it instead. A compiled program is not read for it: a path
 * built into one is as often a build's record as the place it runs from.
 *
 * `practice` is where the two reviewers meet the Builder. A fail goes to the Referee first; a fail
 * it rules a check defect does not count and its task leaves the session, and an earned fail goes on
 * to the Diagnoser. What comes back names the ending, the task's record and the Diagnoser's
 * reading, and never a check, a verdict's detail or the Referee's reasons. A practice solve that
 * could not be run at all, the verifier failing to decide for one, ends the session: its error can
 * name a check, so it is kept for the host and the Builder is told only that the session ends.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { createBashTool } from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import { type LogEvent, read } from "../kernel/log.ts";
import type { Ending } from "../kernel/solve.ts";
import { ended, passed, ranUnder, verdictsOf } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isString } from "../meta/json-shape.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { pooled } from "../meta/pool.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { plural } from "../meta/text.ts";
import type { Diagnosis } from "../review/diagnoser.ts";
import { callList, callsOf, callText, closingOf, solveOf } from "../review/trace.ts";
import { text, tool } from "../solve/answer.ts";
import { type CommandWall, runWalled } from "../solve/command.ts";
import { type Harness, harnessTools, openHarness, pathsUnder, toolTreeStamp } from "../solve/harness.ts";
import { refuseOtherPresets } from "../solve/run.ts";
import { SHELL_RULES, shellTool } from "../solve/shell.ts";
import { shellQuote } from "../verify/solve-command-isolation.ts";
import { SHELL_WALLS } from "./prompt.ts";
import type { BuildRequest, PracticeTask } from "./session.ts";

/** `harness/` frozen: a copy kept under its digest, what a solve would open it as, and the tools
 *  it listed for a practice task, null where no wall was there to list them under. */
export interface Snapshot {
  readonly dir: string;
  readonly harness: Harness;
  readonly listed: readonly string[] | null;
}

/** What a session's tools share. */
export interface Bench {
  readonly request: BuildRequest;
  /** The Builder's home, which holds `harness/` and `practice/`. */
  readonly home: string;
  /** The digest of the harness the session started from. */
  readonly parent: string;
  /** The last copy kept of `harness/.toolchain`, and the stamp the tree had when it was copied. */
  tree: { readonly stamp: string; readonly dir: string } | null;
  /** The last state of `harness/` this session kept, which is one a solve could open: what its last
   *  practice ran with. Null until a state is kept. */
  opened: Snapshot | null;
  /** Practice solves spent. */
  spent: number;
  /** Task versions whose fail the Referee ruled a check defect in this session. */
  readonly disputed: Set<string>;
  /** Task versions whose own check could not run on a practice answer. */
  readonly faulty: Set<string>;
  /** Reviewer failures, kept for the host: their text may name a check, so the Builder is not shown it. */
  readonly faults: string[];
  /** Lists a harness's tools for a practice task as a solve would, under the command wall; null
   *  until the walled tools are made, and for a session with no wall or no practice task. */
  lists: ((harness: Harness) => Promise<string[]>) | null;
  /** Aborted when a practice solve could not be run, which ends the session. */
  readonly halt: AbortController;
  /** What that practice solve threw; the session throws it again once its record is written. */
  fatal: Error | null;
  /** `finish`'s note; null until it is called. */
  note: string | null;
}

/** What a submitted answer or a closing text shows of itself in a trace's head. */
const HEAD_CHARS = 4_000;
/** What the walled write exits with when its target is a directory; `mkdir` and `cp` exit 1. */
const IS_DIRECTORY = 3;
/** The harness's tool tree, as a path in the Builder's home. */
export const HOME_TOOL_TREE = "harness/.toolchain";

/** An ending as the Builder is shown it: the outcome and its kind. A non-result's reason can name a
 *  check, so only a broken harness's reason, which is the harness's own, is shown. */
export function endingText(ending: Ending): string {
  if (ending.outcome === "pass") return "pass";
  if (ending.outcome === "non-result") return `no result (${ending.kind})`;
  return ending.kind === "broken-harness"
    ? `fail (broken harness: ${ending.reason})`
    : `fail (${ending.kind})`;
}

/** A task version's counted test-side solves under one harness, by the log's condition records,
 *  in the order they ended. */
export function record(events: readonly LogEvent[], version: string, harness: string) {
  const mine = ranUnder(events).filter(
    ({ under }) => under.task === version && under.harness === harness && under.side === "test",
  );
  const counted = ended(mine).flatMap((solve) => {
    const pass = passed(solve);
    return pass === null ? [] : [{ solve: solve.id, pass }];
  });
  return { solves: counted.map(({ solve }) => solve), passed: counted.filter(({ pass }) => pass).length };
}

/** The parent's tool tree, where it really is; null when the parent has none. */
export function parentToolTree(parent: string): string | null {
  const tree = join(parent, ".toolchain");
  return existsSync(tree) ? realpathSync(tree) : null;
}

/** Refuses the links and scripts in a copy of `harness/<under>` that name the session's home, where
 *  the copy is not: a launcher an install wrote with its own absolute path, a console script's
 *  interpreter, a link into the tree. Each would break where the harness is run. */
function refuseNamingHome(dir: string, home: string, under: string): void {
  const forms = [...new Set([home, realpathSync(home)])];
  const named = pathsUnder(dir).filter((path) => {
    const full = join(dir, path);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) return forms.some((form) => readlinkSync(full).includes(form));
    if (!stat.isFile() || (stat.mode & 0o111) === 0) return false;
    const bytes = readFileSync(full);
    return bytes.subarray(0, 2).toString() === "#!" && forms.some((form) => bytes.includes(form));
  });
  if (named.length > 0) {
    throw new Error(
      `${named.map((path) => join(under, path)).join(", ")} name your home, and a harness runs from elsewhere: a launcher finds its files from its own path, as "$(dirname "$0")" does, and a link names its target relatively`,
    );
  }
}

/** A copy of `harness/.toolchain` beside the states, for a frozen harness to link to; the last one
 *  kept while the tree's stamp holds. A truss tree is 316 MB, which a copy at every freeze spent
 *  again on each check and practice. Null when the harness has no tree. */
function keptTree(bench: Bench): string | null {
  const own = join(bench.home, HOME_TOOL_TREE);
  if (!existsSync(own)) return null;
  const real = realpathSync(own);
  const stamp = toolTreeStamp(real);
  if (bench.tree?.stamp === stamp) return bench.tree.dir;
  const dir = realpathSync(mkdtempSync(join(bench.request.states, "tree-")));
  try {
    cpSync(real, dir, { recursive: true, verbatimSymlinks: true });
    refuseNamingHome(dir, bench.home, HOME_TOOL_TREE);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  bench.tree = { stamp, dir };
  return dir;
}

/**
 * `harness/` as it stands, copied beside the kept states, opened as a solve would open it and, under
 * a wall, asked for its tools as a solve would ask. Throws, with the harness's own error, when a
 * solve could not: a harness whose tools do not list fails every task before its first turn, and
 * one frozen so would be screened and scored at a full round's cost to say only that. Links are
 * copied as they are: a stored state carries links that resolve to nothing, and following one would
 * copy what it points at. The copy is the caller's to keep or to remove.
 *
 * Every question is asked of the copy, which no command of the Builder's can reach, and none of
 * `harness/` itself, which a process a command left behind could still be changing.
 */
async function frozen(bench: Bench): Promise<Snapshot> {
  const { states } = bench.request;
  mkdirSync(states, { recursive: true });
  const dir = realpathSync(mkdtempSync(join(states, "freezing-")));
  try {
    const own = resolve(bench.home, HOME_TOOL_TREE);
    cpSync(join(bench.home, "harness"), dir, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => resolve(source) !== own,
    });
    if (!lstatSync(dir).isDirectory()) throw new Error("harness/ is not a directory");
    refuseNamingHome(dir, bench.home, "harness");
    const tree = keptTree(bench);
    if (tree !== null) symlinkSync(tree, join(dir, ".toolchain"));
    const harness = await openHarness(dir);
    refuseOtherPresets(harness);
    return { dir, harness, listed: (await bench.lists?.(harness)) ?? null };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    // The copy's own path is the host's, and says where the states and the log beside them are.
    const why = errorMessage(error).replaceAll(dir, "harness");
    throw new Error(`the harness does not open: ${why}`, { cause: error });
  }
}

/**
 * Freeze `harness/` and keep the copy under its digest in the caller's `states`, so every harness a
 * practice solve ran with can be opened again.
 *
 * The copy is not kept in the session's own scratch. The command wall closes the parent of every
 * solve's scratch after it reopens a harness's tool tree, so a state kept there is one no practice
 * solve could run a program from.
 */
export async function snapshot(bench: Bench): Promise<Snapshot> {
  const { dir, harness, listed } = await frozen(bench);
  const kept = join(dirname(dir), harness.digest);
  try {
    renameSync(dir, kept);
  } catch (error) {
    // A state already kept under this digest, by this session or one beside it, is the same harness.
    rmSync(dir, { recursive: true, force: true });
    if (!existsSync(kept)) throw error;
  }
  bench.opened = {
    dir: kept,
    harness: { ...harness, toolTree: harness.toolTree === null ? null : join(kept, ".toolchain") },
    listed,
  };
  return bench.opened;
}

function diagnosisText(diagnosis: Diagnosis): string {
  if ("abstain" in diagnosis) return `The Diagnoser abstained: ${diagnosis.abstain}`;
  return [
    `Diagnosis (owner ${diagnosis.owner}, confidence ${diagnosis.confidence}): ${diagnosis.cause}`,
    `It would be refuted by: ${diagnosis.falsifier}`,
    `First divergence, quoted from the trace: ${diagnosis.firstDivergence}`,
  ].join("\n");
}

/** One practice solve and what the reviewers read of its fail. Throws only what the solve itself
 *  threw: a reviewer that fails is noted for the host and the solve stands. */
async function practise(bench: Bench, task: PracticeTask, kept: Snapshot, kill: AbortSignal) {
  const { request } = bench;
  const { solve, ending } = await request.practise(task, kept.dir, kept.harness.digest, kill);
  const lines: string[] = [];
  if (ending.outcome === "non-result" && ending.kind === "check") {
    bench.faulty.add(task.version);
    lines.push("The task's own check could not run on this answer: the task leaves this session's practice.");
  }
  if (ending.outcome === "fail" && ending.kind !== "broken-harness" && request.referee !== undefined) {
    try {
      const finding = await request.referee(solve, task, kill);
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
        lines.push(diagnosisText(await request.diagnose(solve, task, kill)));
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
    execute: async (_id, args, signal) => {
      const unknown = args.tasks.find((id) => !offered.has(id));
      if (unknown !== undefined) {
        throw new Error(
          `${unknown} is not one of this session's practice tasks: ${[...offered.keys()].join(", ")}`,
        );
      }
      const chosen = args.tasks.flatMap((id) => offered.get(id) ?? []);
      const states = taskStates(read(request.log));
      const closed = chosen.find(
        ({ version }) =>
          states.get(version) !== "released" || bench.disputed.has(version) || bench.faulty.has(version),
      );
      if (closed !== undefined) throw new Error(`${closed.task.taskId} is no longer a practice task`);
      const left = request.limits.practiceSolves - bench.spent;
      if (chosen.length > left) {
        throw new Error(
          `only ${plural(left, "practice solve")} left, and this asks for ${String(chosen.length)}`,
        );
      }
      // The session's wall, its kill and its halt all reach a solve through the loop's signal, so a
      // practice in flight ends with the session and not a solve's whole wall after it.
      const kill = signal ?? bench.halt.signal;
      const kept = await snapshot(bench);
      if (kill.aborted) throw new Error("The session has ended.");
      bench.spent += chosen.length;
      const solved = await pooled(chosen, request.limits.concurrency, async (task) => {
        if (bench.fatal !== null) return [];
        try {
          return [await practise(bench, task, kept, kill)];
        } catch (error) {
          bench.fatal ??= asError(error);
          bench.halt.abort();
          return [];
        }
      });
      if (bench.fatal !== null) {
        throw new Error(
          "A practice solve could not be run, which is the host's fault and not the harness's. The session ends here.",
        );
      }
      const events = read(request.log);
      const said = solved.flat().map(({ task, solve, ending, lines }) => {
        const [now, before] = [kept.harness.digest, bench.parent].map((harness) =>
          record(events, task.version, harness),
        );
        return [
          `${task.task.taskId}: ${endingText(ending)}. Solve ${solve}.`,
          `Record under this harness: passed ${String(now?.passed ?? 0)} of ${String(now?.solves.length ?? 0)}. Under the harness you started from: ${String(before?.passed ?? 0)} of ${String(before?.solves.length ?? 0)}.`,
          ...lines,
        ].join("\n");
      });
      return text(`${said.join("\n\n")}\n\n${plural(left - chosen.length, "practice solve")} left.`);
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
      const ran = ranUnder(events).find(({ id }) => id === args.solve);
      if (ran?.under.side !== "test" || !versions.has(ran.under.task)) {
        throw new Error(`${args.solve} is not a solve of one of this session's practice tasks`);
      }
      const own = solveOf(events, args.solve);
      const calls = callsOf(own);
      if (args.call !== undefined) return text(callText(calls, args.call, args.from ?? 0));
      const { ending } = ran;
      const answer = verdictsOf(events).get(args.solve)?.answer;
      const closing = closingOf(own);
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
      const steps = args.path.split("/");
      if (steps.some((step) => step === "" || step === "." || step === "..")) {
        throw new Error("path names a file under harness/, with no empty, . or .. step");
      }
      const target = `"$HOME/harness/"${shellQuote(args.path)}`;
      const output: Buffer[] = [];
      // `cp` into a directory would leave a file named `content` inside it and report success.
      const command = `[ ! -d ${target} ] || exit ${String(IS_DIRECTORY)}; mkdir -p "$(dirname ${target})" && cp content ${target}`;
      const { exitCode } = await runWalled(wall, command, {
        onData: (data) => output.push(data),
        signal,
        stage: ({ work }) => writeFileSync(join(work, "content"), args.content),
      });
      if (exitCode === IS_DIRECTORY) throw new Error(`not written: harness/${args.path} is a directory`);
      if (exitCode !== 0) {
        throw new Error(`not written: ${Buffer.concat(output).toString("utf8").slice(0, 2_000)}`);
      }
      return text(`Wrote harness/${args.path}, ${String(Buffer.byteLength(args.content))} bytes.`);
    },
  });
}

/** Open the harness and list its tools as a solve would, with no model call: a harness that does
 *  not open fails every task, and this finds that before a practice solve is spent on it. */
function checkTool(bench: Bench): AgentTool {
  return tool({
    name: "check_harness",
    label: "Check the harness",
    description:
      "Open harness/ as a solve would and list its tools for one practice task. Reports the tools and the guide's length, or the error a solve would stop on. Spends no practice solve.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      const { dir, harness, listed } = await frozen(bench);
      // A check keeps nothing: only a state a solve ran with, or the session's last, is kept.
      rmSync(dir, { recursive: true, force: true });
      const tools = listed ?? [...harness.kinds.keys()];
      return text(
        `The harness opens. Tools: ${tools.join(", ") || "none"}. Guide: ${String(harness.guide?.length ?? 0)} characters.`,
      );
    },
  });
}

/** The three tools that run on the command wall, which also gives a freeze its listing: every
 *  harness frozen from here on is asked for its tools under this wall. */
export function walledTools(bench: Bench, wall: CommandWall): AgentTool[] {
  const sample = bench.request.tasks[0];
  if (sample !== undefined) {
    bench.lists = async (harness) =>
      (await harnessTools(harness, sample.task, wall)).map(({ tool: listed }) => listed.name);
  }
  return [
    { ...shellTool(wall, 0), description: `${createBashTool("/").description}${SHELL_WALLS} ${SHELL_RULES}` },
    writeTool(wall),
    checkTool(bench),
  ];
}
