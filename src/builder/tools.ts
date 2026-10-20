/**
 * The Builder's tools. It is a coding agent on a harness's files, so it has what a solver has: pi's
 * own `read`, `bash`, `edit` and `write` on the command wall (`src/solve/coding-tools.ts`), in one
 * working directory, its home. On top of them are the tools that are a Builder's alone. Two ask
 * the host about `harness/` as it stands and run on the same wall: `check_harness` and
 * `preview_harness`. Four are the host's: `practice`, `read_trace`, `read_opening` and `finish`.
 * `reset_harness`, which put `harness/agent` back as the session found it, went on 15 October:
 * no Builder on record had called it, 0 of 1,261 calls.
 *
 * v1's Builder had pi's file tools too, with `harness_inspect`, `harness_trial` and `harness_reset`
 * (`src/builder/tools.ts:75` at 7af7315). A Builder with the shell and one `write_file` alone
 * rewrote a 30 KB tools file through a heredoc to change a line, backed its tools file up by hand
 * before it tried something, and could not see what a solver would be shown. The shell is the
 * whole of its action space beyond these: it searches, lists and installs through it, and no tool
 * is given for what a command already does.
 *
 * The wall is the solver's, so the repository, the operator's home and every other solve's scratch
 * are closed to the Builder by the operating system and not by a path check in this process. v1
 * said of its own Builder that a guard in the process it constrains is a convention and not a wall
 * (`src/builder/candidate-isolation.ts` at 7af7315), which is why every file tool here works
 * through a walled command and none reads or writes a path for the Builder in the host's name.
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
 * `practice` is where the Referee meets the Builder. A rejected answer goes to it, as in a
 * comparison; a check defect's task leaves the session. The triage of 20 October found unclear and
 * unread rejections still shown as failures. What comes back names the ending and the
 * task's record, and never a check, a verdict's detail or the Referee's reasons. A practice solve
 * that could not be run at all, the verifier failing to decide for one, ends the session: its
 * error can name a check, so it is kept for the host and the Builder is told only that the session
 * ends.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { wrapToolDefinitions } from "../../vendor/pi-coding-agent/core/tools/tool-definition-wrapper.ts";
import { type LogEvent, read } from "../kernel/log.ts";
import type { Ending } from "../kernel/solve.ts";
import { limitsIn } from "../kernel/condition.ts";
import type { Contract } from "../kernel/contract.ts";
import { billedAll, billedParts } from "../kernel/reports.ts";
import { ended, passed, practiceRan, rejectionAside, solvesIn, verdictsOf } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "../meta/filesystem.ts";
import { TOOL_TREE_DIR } from "../meta/bundle-layout.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isFunction, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { containsPath } from "../meta/path-containment.ts";
import { basename, dirname, join, resolve } from "../meta/path.ts";
import { pooled } from "../meta/pool.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { plural } from "../meta/text.ts";
import { callList, callsOf, callText, closingOf, solveOf } from "../review/trace.ts";
import { openDesk, text, tool } from "../solve/answer.ts";
import { CODING_TOOLS, codingTools, selectedCodingTools } from "../solve/coding-tools.ts";
import { type CommandWall, type NetworkReach, networkReach } from "../solve/command.ts";
import { type Harness, harnessTools, openHarness, pathsUnder, toolTreeStamp } from "../solve/harness.ts";
import { installedPrograms } from "../solve/programs.ts";
import { systemPrompt } from "../solve/prompt.ts";
import { clockText, solverTools } from "../solve/run.ts";
import { memoryOverCapNotice } from "./memory.ts";
import { openingOf } from "./opening.ts";
import { type Said, shellWalls } from "./prompt.ts";
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
  /** The texts of this session that differ by who makes its campaign's moves (`SAID`). */
  readonly said: Said;
  /** Released tasks and the reference, refreshed by campaign tools while the conversation stays open. */
  tasks: readonly PracticeTask[];
  reference: string;
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
  lists: ((harness: Harness) => Promise<string[] | null>) | null;
  /** Aborted when a practice solve could not be run, which ends the session. */
  readonly halt: AbortController;
  /** Runs a campaign action, whose time is the host's: the session's wall stops while one runs.
   *  Until 13 October it counted them, and a led Builder had 45 of its 240 minutes to build and
   *  ended one second after the comparison it bought reported, which it never read. */
  readonly within: <T>(action: () => Promise<T>) => Promise<T>;
  /** What that practice solve threw; the session throws it again once its record is written. */
  fatal: Error | null;
  /** `finish`'s note; null until it is called. */
  note: string | null;
  /** What `finish` has told the Builder of the harness as it stood, each once (`standing`). */
  readonly told: Set<"broken" | "untried" | "unread">;
}

/** What a Builder that leads its campaign is told at `finish` where no comparison has read harness
 *  `digest` against the reference, or null (`BuildRequest.campaign`). */
type Unmeasured = (digest: string) => Promise<string | null>;

/** What a submitted answer or a closing text shows of itself in a trace's head. */
const HEAD_CHARS = 4_000;
/** What a preview names the solve's home, which only a solve has. */
const SOLVE_HOME = "(the solve's own home directory)";
/** The harness's tool tree, as a path in the Builder's home. */
export const HOME_TOOL_TREE = `harness/${TOOL_TREE_DIR}`;

/** An ending as the Builder is shown it: the outcome and its kind. A non-result's reason can name a
 *  check, so only a broken harness's reason, which is the harness's own, is shown. */
function endingText(ending: Ending): string {
  if (ending.outcome === "pass") return "pass";
  if (ending.outcome === "non-result") return `no result (${ending.kind})`;
  if (ending.outcome === "flagged") return "flagged (the solver judged the task malformed)";
  return ending.kind === "broken-harness"
    ? `fail (broken harness: ${ending.reason})`
    : `fail (${ending.kind})`;
}

/** What the verifier measured of a valid practice answer, where the contract states an objective:
 *  the quantity and its value, which the Builder reads of its own practice and of nothing else. */
function measuredText(events: readonly LogEvent[], solve: string, contract: Contract): string {
  const checker = verdictsOf(events).get(solve)?.checker;
  return contract.objective !== undefined && checker?.kind === "pass" && checker.objective !== undefined
    ? ` Measured ${contract.objective.quantity}: ${String(checker.objective)} (${contract.objective.direction} is better).`
    : "";
}

/** A task version's counted practice solves under one harness, by the log's condition records,
 *  in the order they ended. A solve a comparison made of the task is none (`practiceRan`). */
export function record(events: readonly LogEvent[], version: string, harness: string) {
  const mine = practiceRan(events).filter(({ under }) => under.task === version && under.harness === harness);
  const counted = ended(mine).flatMap((solve) => {
    if (rejectionAside(events, solve)) return [];
    const pass = passed(solve);
    return pass === null ? [] : [{ solve: solve.id, pass }];
  });
  return { solves: counted.map(({ solve }) => solve), passed: counted.filter(({ pass }) => pass).length };
}

/** The parent's tool tree, where it really is; null when the parent has none. */
export function parentToolTree(parent: string): string | null {
  const tree = join(parent, TOOL_TREE_DIR);
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

/** Remove a tree copy no kept state's `.toolchain` names, which is what the last copy becomes once
 *  the tree has changed and nothing was frozen under it. A `check_harness` call keeps nothing and
 *  makes one all the same: on 10 October a first session left a 6.4 MB copy linked by no state,
 *  and one domain's tree is 316 MB, so a check after each tree edit would leave one each. */
function dropUnlinked(states: string, dir: string): void {
  const named = join("..", basename(dir));
  const links = readdirSync(states).map((name) => join(states, name, TOOL_TREE_DIR));
  const linked = (link: string) =>
    lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true && readlinkSync(link) === named;
  if (!links.some(linked)) rmSync(dir, { recursive: true, force: true });
}

/** A copy of `harness/.toolchain` beside the states, for a frozen harness to link to; the last one
 *  kept while the tree's stamp holds. One domain's tree is 316 MB, which a copy at every freeze
 *  would spend again on each check and practice. Null when the harness has no tree.
 *
 *  The tree is the directory itself, inside the home. A link there is refused: the freeze would
 *  copy what the link named, the repository with its logs among what it could name, into the tree
 *  every later solve reads. */
function keptTree(bench: Bench): string | null {
  const own = join(bench.home, HOME_TOOL_TREE);
  const found = lstatSync(own, { throwIfNoEntry: false });
  if (found === undefined) return null;
  const real = found.isSymbolicLink() ? null : realpathSync(own);
  if (real === null || !containsPath(real, realpathSync(bench.home))) {
    throw new Error(
      `${HOME_TOOL_TREE} is a link, or lies outside your home: the programs are installed in the directory itself, which is copied whole when the harness is frozen`,
    );
  }
  const stamp = toolTreeStamp(real);
  if (bench.tree?.stamp === stamp) return bench.tree.dir;
  if (bench.tree !== undefined && bench.tree !== null) dropUnlinked(bench.request.states, bench.tree.dir);
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
 * `source`, a harness directory, copied into a fresh folder among `states` as a state is kept:
 * its files less its own `.toolchain`, links as they are, and its programs named by a link to
 * `tree` beside it, so both go where the campaign's folder goes. The caller opens the copy and
 * keeps it or removes it. Shared with the import of a harness built elsewhere
 * (`tools/d2/import.ts`), which keeps one the same way.
 */
export function stagedState(source: string, states: string, tree: string | null, prefix: string): string {
  mkdirSync(states, { recursive: true });
  const dir = realpathSync(mkdtempSync(join(states, prefix)));
  try {
    const own = resolve(source, TOOL_TREE_DIR);
    cpSync(source, dir, { recursive: true, verbatimSymlinks: true, filter: (each) => resolve(each) !== own });
    if (!lstatSync(dir).isDirectory()) throw new Error("harness/ is not a directory");
    if (tree !== null) symlinkSync(join("..", basename(tree)), join(dir, TOOL_TREE_DIR));
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * `harness/` as it stands, copied beside the kept states, opened as a solve would open it and, under
 * a wall, asked for its tools as a solve would ask. Throws, with the harness's own error, when a
 * solve could not: a harness whose tools do not list fails every task before its first turn, and
 * one frozen so would be scored at a full round's cost to say only that. Links are
 * copied as they are: a stored state carries links that resolve to nothing, and following one would
 * copy what it points at. The copy is the caller's to keep or to remove.
 *
 * Every question is asked of the copy, which no command of the Builder's can reach, and none of
 * `harness/` itself, which a process a command left behind could still be changing.
 */
async function frozen(bench: Bench): Promise<Snapshot> {
  const { states } = bench.request;
  mkdirSync(states, { recursive: true });
  let dir: string | null = null;
  try {
    dir = stagedState(join(bench.home, "harness"), states, keptTree(bench), "freezing-");
    refuseNamingHome(dir, bench.home, "harness");
    const harness = await openHarness(dir);
    // A preset no solve serves fails every solve, and is refused here before one is spent on it.
    selectedCodingTools(harness.presets);
    return { dir, harness, listed: (await bench.lists?.(harness)) ?? null };
  } catch (error) {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    // The copy's own path is the host's, and says where the states and the log beside them are.
    const why = errorMessage(error).replaceAll(dir ?? states, "harness");
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
    harness: { ...harness, toolTree: harness.toolTree === null ? null : join(kept, TOOL_TREE_DIR) },
    listed,
  };
  return bench.opened;
}

/** How much of its limits a finished solve used, as a sentence after its ending: the seconds from
 *  its start to its end, the verifier's among them, of its time limit, the model's own turns, and
 *  the tokens the model read and wrote over them. Empty where the log holds no end for the solve.
 *  A Builder that is not told this cannot tell a harness that passes with a minute to spare from
 *  one that passes at the limit (`7f0add79:docs/plan.md`, Phase 2). The tokens are the one measure of what
 *  a tool or a program costs a solve that the Builder can act on: on 10 October a promoted
 *  harness's solve read 8,600 to 13,200 tokens over two turns in three campaigns, nearly all of it
 *  the prompt read twice. */
function usedText(events: readonly LogEvent[], solve: string): string {
  const { start, end } = solvesIn(events).find(({ id }) => id === solve) ?? {};
  const limits = limitsIn(start?.limits);
  if (!isNumber(end?.seconds) || !isNumber(end.turns) || limits === null) return "";
  const given = limits.modelTurns === undefined ? "" : ` of ${String(limits.modelTurns)}`;
  const tokens = asRecord(end.tokens);
  const count = (value: JsonValue | undefined) => (isNumber(value) ? value : 0);
  const readTokens = ["input", "cacheRead", "cacheWrite"]
    .map((key) => count(tokens?.[key]))
    .reduce((sum, n) => sum + n, 0);
  const counted =
    tokens === null
      ? ""
      : `, and read ${String(readTokens)} tokens and wrote ${String(count(tokens.output))}`;
  return ` It took ${clockText(end.seconds)} of ${clockText(limits.wallSeconds)} and ${plural(end.turns, "model turn")}${given}${counted}.`;
}

/** One practice solve and what the Referee read of its fail. Throws only what the solve itself
 *  threw: a Referee that fails is noted for the host and leaves the rejection set aside. */
async function practise(bench: Bench, task: PracticeTask, kept: Snapshot, kill: AbortSignal) {
  const { request } = bench;
  const { solve, ending } = await request.practise(task, kept.dir, kept.harness.digest, kill);
  const lines: string[] = [];
  if (ending.outcome === "non-result" && ending.kind === "check") {
    bench.faulty.add(task.version);
    lines.push("The task's own check could not run on this answer: the task leaves this session's practice.");
  }
  // Only a rejected answer has anything to recompute: a solve its limits ended, or one that gave no
  // answer, is not valid with no ruling (`src/builder/round.ts`). Until 15 October each went to the
  // Referee and was logged earned, unread: seven of them in three campaigns.
  if (ending.outcome === "fail" && ending.kind === "rejected" && request.referee !== undefined) {
    try {
      const finding = await request.referee(solve, task, kill);
      if (finding.ruling === "check-defect") {
        bench.disputed.add(task.version);
        lines.push("The task leaves this session's practice.");
      }
    } catch (error) {
      bench.faults.push(`${solve}: ${errorMessage(error)}`);
    }
  }
  return { task, solve, ending, lines };
}

/**
 * The practice solves a session may still start. A Builder that leads its campaign has as many as
 * what is left of the campaign's total holds a reserve for, and no count of its own: r3's b-1 ran
 * out of its 24 at turn 161 with $560 left (deep dive, 20 October). A session the host runs keeps
 * its count, and no more than its own part of the log leaves its cap a reserve for (`billedParts`).
 * The Builder is told a count and never a sum.
 */
export function practiceLeft({ request, spent }: Bench, events: readonly LogEvent[]): number {
  const budget = request.campaign === undefined ? null : openingOf(events)?.budget;
  if (budget != null) return Math.max(0, Math.floor((budget.dollars - billedAll(events)) / budget.reserve));
  const counted = request.limits.practiceSolves - spent;
  if (request.cap === undefined) return counted;
  const afforded = Math.floor(
    (request.cap.dollars - billedParts(events, request.id).session) / request.cap.reserve,
  );
  return Math.max(0, Math.min(counted, afforded));
}

/** What a practice line says of the harness a solve ran under, by the tool's `under`. */
const UNDER = {
  harness: "",
  parent: " under the harness you started from",
  reference: " under the reference harness",
} as const;

export function practiceTool(bench: Bench): AgentTool {
  const { request } = bench;
  return tool({
    name: "practice",
    label: "Practise",
    description:
      'Solve practice tasks with the harness as it stands in harness/, by the solver it is measured with, under the host\'s limits. Each named task is solved once; name a task twice to solve it twice. For each solve it returns the ending, the time, the model turns and the tokens it took, the task\'s record under this harness and under the one you started from, the solve\'s id for read_trace and, for a fail, what the Referee read. It never says which check refused an answer. A harness that does not open spends no solve. With `under: "parent"` the tasks are solved under the harness you started from instead, and with `under: "reference"` under the reference harness, the one yours is compared with; each costs the same solves and shows what your change is measured against.',
    parameters: Type.Object({
      tasks: Type.Array(Type.String(), {
        minItems: 1,
        description: "Practice task ids, as the opening message lists them.",
      }),
      under: Type.Optional(
        Type.Union([Type.Literal("harness"), Type.Literal("parent"), Type.Literal("reference")], {
          description:
            "Which harness solves: harness/ as it stands (the default), the one you started from, or the reference harness yours is compared with.",
        }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, args, signal) => {
      const offered = new Map(bench.tasks.map((task) => [task.task.taskId, task]));
      const unknown = args.tasks.find((id) => !offered.has(id));
      if (unknown !== undefined) {
        throw new Error(
          `${unknown} is not one of this session's practice tasks: ${[...offered.keys()].join(", ")}`,
        );
      }
      const chosen = args.tasks.flatMap((id) => offered.get(id) ?? []);
      const asked = read(request.log);
      const states = taskStates(asked);
      const closed = chosen.find(
        ({ version }) =>
          states.get(version) !== "released" || bench.disputed.has(version) || bench.faulty.has(version),
      );
      if (closed !== undefined) throw new Error(`${closed.task.taskId} is no longer a practice task`);
      const left = practiceLeft(bench, asked);
      if (chosen.length > left) {
        throw new Error(
          `only ${plural(left, "practice solve")} left, and this asks for ${String(chosen.length)}`,
        );
      }
      // The session's wall, its kill and its halt all reach a solve through the loop's signal, so a
      // practice in flight ends with the session and not a solve's whole wall after it.
      const kill = signal ?? bench.halt.signal;
      // Under the parent, the solve runs the harness the session started from, as kept outside the
      // home, and harness/ as it stands need not open: without it a Builder reads its change only
      // against the parent's comparison record, which a campaign's first session does not have.
      // Under the reference the solve runs the harness the session's is compared with: the fact
      // "what does the reference do on this task" is the Builder's to buy with its own solve,
      // and the host hands it no table of it (the plan's climb section, C5).
      const other =
        args.under === "parent" ? request.parent : args.under === "reference" ? bench.reference : null;
      const ran: Snapshot =
        other === null
          ? await snapshot(bench)
          : { dir: other, harness: await openHarness(other), listed: null };
      if (kill.aborted) throw new Error("The session has ended.");
      bench.spent += chosen.length;
      const solved = await pooled(chosen, request.limits.concurrency, async (task) => {
        if (bench.fatal !== null) return [];
        try {
          return [await practise(bench, task, ran, kill)];
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
        const shown = rejectionAside(events, { id: solve, ending })
          ? "rejection set aside"
          : endingText(ending);
        const [now, before] = [bench.opened?.harness.digest ?? null, bench.parent].map((harness) =>
          harness === null ? null : record(events, task.version, harness),
        );
        return [
          `${task.task.taskId}${UNDER[args.under ?? "harness"]}: ${shown}. Solve ${solve}.${usedText(events, solve)}${measuredText(events, solve, request.contract)}`,
          `Record under this harness: passed ${String(now?.passed ?? 0)} of ${String(now?.solves.length ?? 0)}. Under the harness you started from: ${String(before?.passed ?? 0)} of ${String(before?.solves.length ?? 0)}.`,
          ...lines,
        ].join("\n");
      });
      const after = practiceLeft(bench, events);
      return text(
        `${said.join("\n\n")}\n\n${
          after > 0
            ? `${plural(after, "practice solve")} left.`
            : "No practice solve is left: what you change from here on is measured without a solve having run it."
        }`,
      );
    },
  });
}

/** The paged trace of a practice solve. Which task version a solve ran is read from its logged
 *  condition, so a solve of any other task is refused whatever id is asked for. */
export function traceTool(bench: Bench): AgentTool {
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
      const versions = new Set(bench.tasks.map(({ version }) => version));
      const events = read(bench.request.log);
      const ran = practiceRan(events).find(({ id }) => id === args.solve);
      if (ran === undefined || !versions.has(ran.under.task)) {
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
          `ending: ${rejectionAside(events, ran) ? "rejection set aside" : isString(ending?.outcome) ? `${ending.outcome}${isString(ending.kind) ? ` (${ending.kind})` : ""}` : "not recorded"}`,
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

/**
 * What a Builder about to finish is told of `harness/` as it stands, once each: that it does not
 * open, or that it has changed since the session's last practice solve while solves are left. Null
 * where there is nothing to say, and where it has been said.
 *
 * Neither is a gate. v1's submit refused a round that then measured nothing, 13 firmware rounds by
 * its own count, and a session here is frozen whatever it holds (`session.ts`). But a Builder that
 * finishes is the one reader who can still act. In two sessions of 9 October the harness that
 * went to the comparison was one no practice solve had run: the six solves were spent on earlier
 * versions, which is why `practice` says when the last one is gone. A session that never
 * practised chose so and is told nothing here. A second `finish` ends the session as it is.
 *
 * A Builder that leads its campaign is also told that no comparison has read the harness it would
 * leave: on 13 October buffer-151-haiku's Builder finished while an Examiner session wrote, and the
 * campaign ended `finished` with no comparison.
 * One that would finish on the harness last promoted is told the move the table names next, since on
 * 14 October buffer-149's Builder finished on the harness just promoted and the climb stopped there.
 */
async function standing(bench: Bench, unmeasured?: Unmeasured): Promise<string | null> {
  const { request, told } = bench;
  const again = "or call finish again to end the session as it is";
  const now = await harnessNow(bench);
  if (!isString(now)) {
    if (told.has("broken")) return null;
    told.add("broken");
    const { unpractised, practised } = bench.said.broken;
    return `${errorMessage(now)}. Left so, ${bench.opened === null ? unpractised : practised}. Mend it and call finish again, ${again}.`;
  }
  const left = practiceLeft(bench, read(request.log));
  const tried = bench.opened === null || now === bench.opened.harness.digest || now === bench.parent;
  const untried = !tried && left > 0 && !told.has("untried");
  const unread = told.has("unread") ? null : ((await unmeasured?.(now)) ?? null);
  if (untried) told.add("untried");
  if (unread !== null) told.add("unread");
  if (untried) {
    return `harness/ has changed since your last practice solve, so no solve has run it as it stands. ${plural(left, "practice solve")} ${left === 1 ? "is" : "are"} left. Practise it, ${again} ${bench.said.untried}.${unread === null ? "" : ` ${unread}`}`;
  }
  return unread === null ? null : `${unread} Call finish again to end the conversation as it is.`;
}

/** The digest of `harness/` as it stands, or why it does not open: frozen once, the copy removed. */
export async function harnessNow(bench: Bench): Promise<string | Error> {
  try {
    const { dir, harness } = await frozen(bench);
    rmSync(dir, { recursive: true, force: true });
    return harness.digest;
  } catch (error) {
    return asError(error);
  }
}

/**
 * The opening message again, as it was sent. A session whose conversation was compacted, or lost
 * with its process, has the public rules, the practice tasks, the failed practice solves and the
 * comparisons in no other place: they are built by the host from the log, and the Builder's own
 * notes are its prose about them. v1 served its round's opening facts the same way.
 */
export function openingTool(opening: string | (() => string), said: Said): AgentTool {
  return tool({
    name: "read_opening",
    label: "Read the opening",
    description: said.opening,
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => text(isFunction(opening) ? opening() : opening),
  });
}

/** A Builder's tool with a line of the host's, given the call's id, as the last of whatever it
 *  returns, a result or an error, where the line is not empty: what the session has used of its
 *  limits (`usedLine`, `prompt.ts`). */
export function endingWith(each: AgentTool, line: (id: string) => string): AgentTool {
  return {
    ...each,
    execute: async (...call) => {
      try {
        const result = await each.execute(...call);
        const said = line(call[0]);
        return said === ""
          ? result
          : { ...result, content: [...result.content, { type: "text", text: said }] };
      } catch (error) {
        const said = line(call[0]);
        throw new Error(said === "" ? errorMessage(error) : `${errorMessage(error)}\n\n${said}`, {
          cause: error,
        });
      }
    },
  };
}

export function finishTool(bench: Bench, unmeasured?: Unmeasured): AgentTool {
  return tool({
    name: "finish",
    label: "Finish",
    description: bench.said.finish,
    parameters: Type.Object({ note: Type.String({ minLength: 1, maxLength: 700 }) }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      // `finish` ends the session at this turn, so a notice on the next turn would reach nobody:
      // the call itself carries it, as v1's submit did (`src/gate/submit-tool.ts` at 3f93d06).
      const notes = memoryOverCapNotice(bench.home);
      if (notes !== null) throw new Error(`Not finished. ${notes} Then call finish again.`);
      const stands = await standing(bench, unmeasured);
      if (stands !== null) throw new Error(`Not finished. ${stands}`);
      bench.note = args.note.trim();
      return { ...text("Finished."), terminate: true };
    },
  });
}

/** What a harness that opens gives a solver, a line for each of its four parts, and a note where
 *  one part makes another unreachable: programs under a solver with no shell. No note says that
 *  tools beside the shell are a program built twice, which would be a steer: the account states
 *  what each costs (`HARNESS.md`). */
function opens(harness: Harness, tools: readonly string[]): string {
  const presets = selectedCodingTools(harness.presets);
  const programs = installedPrograms(harness.toolTree);
  return [
    "The harness opens.",
    `pi's tools: ${presets.join(", ") || "none"}.`,
    `Programs: ${programs.join(", ") || "none"}.`,
    `Guide: ${String(harness.guide?.length ?? 0)} characters.`,
    `Tools of its own: ${tools.join(", ") || "none"}.`,
    ...(programs.length > 0 && !presets.includes("bash")
      ? ["The solver has no shell, so it can run none of the programs itself."]
      : []),
  ].join("\n");
}

/** Open the harness and list what a solver gets from it, with no model call: a harness that does
 *  not open fails every task, and this finds that before a practice solve is spent on it. */
function checkTool(bench: Bench): AgentTool {
  return tool({
    name: "check_harness",
    label: "Check the harness",
    description:
      "Open harness/ as a solve would, for one practice task. Reports pi's tools it selects, its programs by name, the guide's length and its own tools, or the error a solve would stop on. Spends no practice solve.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      const { dir, harness, listed } = await frozen(bench);
      try {
        return text(opens(harness, listed ?? [...harness.kinds.keys()]));
      } finally {
        // A check keeps nothing: only a state a solve ran with, or the session's last, is kept.
        rmSync(dir, { recursive: true, force: true });
      }
    },
  });
}

/**
 * What a solver would read under `harness/` as it stands, for the session's first practice task:
 * its system prompt whole and its tools as they are declared to it. A Builder wrote a guide and a
 * tool list without seeing where either lands; the prompt is pi's, in sections, and the guide is
 * one of them. The solve's own home is not known here, so the prompt names it by a placeholder.
 */
function previewTool(bench: Bench, wall: CommandWall): AgentTool {
  const { request } = bench;
  return tool({
    name: "preview_harness",
    label: "Preview the harness",
    description:
      "Show what a solver would read under harness/ as it stands, for one practice task: its system prompt whole, with your guide where the solver finds it, and each of its tools by name and description. Spends no practice solve.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      const [sample] = bench.tasks;
      if (sample === undefined) return text("This session has no practice task to preview a solve of.");
      const { dir, harness } = await frozen(bench);
      try {
        const tools = await solverTools(
          { task: sample.task, contract: request.contract },
          harness,
          { ...wall, toolTree: harness.toolTree },
          openDesk(),
        );
        const prompt = systemPrompt({
          tools,
          home: SOLVE_HOME,
          guide: harness.guide,
          wallSeconds: request.solve.wallSeconds,
          limits: request.solve,
          resources: request.resources.length,
          programs: installedPrograms(harness.toolTree),
          network: await networkReach({ ...wall, toolTree: harness.toolTree }),
        });
        const declared = tools.map(({ name, description }) => `- ${name}: ${description}`).join("\n");
        return text(
          `The system prompt a solver of ${sample.task.taskId} would read:\n\n${prompt}\n\nIts tools, as they are declared to it:\n${declared}`,
        );
      } finally {
        // A preview keeps nothing, as a check keeps nothing.
        rmSync(dir, { recursive: true, force: true });
      }
    },
  });
}

/** The tools that run on the command wall: pi's four, with what the Builder's shell is told of its
 *  wall, and the two that ask the host about `harness/`. Making them also gives a freeze its
 *  listing: every harness frozen from here on is asked for its tools under this wall. */
export function walledTools(bench: Bench, wall: CommandWall, network: NetworkReach): AgentTool[] {
  bench.lists = async (harness) => {
    const sample = bench.tasks[0];
    return sample === undefined
      ? null
      : (await harnessTools(harness, sample.task, wall)).map(({ name }) => name);
  };
  // SAFETY: pi's wrapper types its tools' parameters `any`; each is one of pi's four definitions.
  const coding = wrapToolDefinitions(codingTools(wall, CODING_TOOLS)) as AgentTool[];
  return [
    ...coding.map((each) =>
      each.name === "bash" ? { ...each, description: `${each.description}${shellWalls(network)}` } : each,
    ),
    checkTool(bench),
    previewTool(bench, wall),
  ];
}
