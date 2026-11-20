/**
 * The Examiner's shell: `bash`, `read` and `write` in a walled home of its own, the same for a
 * session of any mode (`examine`, `session.ts`).
 *
 * The home is in a root of its own as a Builder's is, under the solver's command wall (`walledBase`,
 * `src/tools/command.ts`): the repository, its other worktrees and a stored pack are closed to it,
 * and the wall is tested before its first command. Nothing in the home enters the exam: a session
 * puts a task or a draft through its own tool, and the host reads that alone.
 *
 * A task-writing session has one because, without it, its notes estimated by hand
 * whether a task had a valid answer. A drafting session has one so that it can look up the source it names
 * for each rule, and run its own check program on its own controls before it puts a draft
 * (`7f0add79:docs/plan.md`, row F57). One wall and one sentence serve every mode, so that their walls
 * cannot drift apart, and the wall says when the seat began to be set up: a session's time is
 * counted from then, so the claim of its root and the wall test are inside its limit in every mode.
 *
 * A session with a campaign's exam before it also has the field's engines: the programs the
 * campaign's check program names (`requiredToolsOf`), each as the verifier's tool tree resolves it,
 * run by name, and no other program of that tree (`pinnedEngines`, `src/kernel/verify.ts`, which
 * names each by its digest). The operator ruled on 12 October that the Examiner may have them, as
 * the exam's side and never the agent under test, from a pinned list; the tree a campaign's checks
 * run under is that list, its content in every solve's setting (`verifierTools`). With the host's
 * toolchains alone, buffer's two sessions of 11 October each spent their first minutes fetching
 * and compiling an engine, and the overhaul plan counts esp32's six sessions writing 40 tasks with
 * no instrument to tell a hard task from a large one. A stored pack's tool tree can hold more than
 * its checks run, since a v1 Builder installed its own tools beside them, so a program no check
 * names stays off the path: the Examiner computes with the instruments, and is never given a
 * solver. The tree itself is open to read, since an engine runs from it, so such a program is off
 * the path and not out of reach. Its tasks still enter through the gate alone (`propose_tasks`),
 * and its answers are ruled on by `try_answer` alone.
 */
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { TSchema } from "typebox";
import type { SeatTool } from "../agent/session.ts";
import { type Engine, pinnedEngines, type VerifierTree } from "../kernel/verify.ts";
import { read } from "../kernel/log.ts";
import {
  chmodSync,
  cpSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "../meta/filesystem.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { basename, dirname, join, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import {
  type CommandWall,
  networkReach,
  type SolveDirs,
  solveDirs,
  type Walled,
  walledBase,
} from "../tools/command.ts";
import { codingTools } from "../tools/coding.ts";
import { installedPrograms } from "../harness/programs.ts";
import { claimRoot } from "../wall/seat-root.ts";
import { shellQuote } from "../wall/isolation.ts";

/** The most bytes a file named by `from_file` may hold: twenty times a large task instance of 50 KB. */
const FILE_BYTES = 1_000_000;

/** What a tool that takes JSON values tells a session with a home of `from_file` (`fromHome`). */
export const FROM_FILE =
  'Any JSON value this tool takes, such as a public input, hidden values, an answer or a format, may instead be given as { "from_file": "<path>" }: a JSON file in your home, by its path relative to the home, which the host reads and takes as if the value had been written here.';

/** Where an Examiner session's shell runs: what the wall denies, and what only a
 *  session with a campaign's exam before it is given. Without a wall a session has no shell. */
export interface Wall extends Walled {
  /** The campaign's check program and the verifier's tool tree it runs under: the engines the
   *  program names are installed in the shell (`pinnedEngines`, `src/kernel/verify.ts`). A drafting
   *  session is given none, whatever is named here: nothing is drafted yet that names one. */
  readonly engines?: VerifierTree | undefined;
  /** Where the campaign keeps an Examiner session's home between sessions, a drafting one's too:
   *  the folder the last session's home was copied to whole, and the next one's is seeded from.
   *  Absent, nothing is carried, as a test may want. */
  readonly keep?: string | undefined;
}

/** A wall as its session is handed it: the shell, the engines installed in it, and when
 *  the seat began to be set up (`performance.now()`), which the session's time is counted from. */
export interface Walls {
  readonly shell: CommandWall;
  readonly pinned: readonly Engine[];
  readonly began: number;
  /** Makes the campaign's copy of the home whole now, at an ask's rest, so a host killed while the
   *  conversation rests loses no ask's files. */
  readonly keep: () => void;
}

/** Where an Examiner session's shell runs: a root of its own, as a Builder's. A drafting
 *  session's id (`d-N`) and a task-writing one's (`x-N`) never meet. */
export const examinerDirs = (log: string, id: string): SolveDirs =>
  solveDirs(`exam-${basename(dirname(log))}-${id}`);

/**
 * The shell's three tools where the session has one, and none where it has not. `bash` carries
 * what the session is told of its wall, after pi's own description: the network as the wall test
 * found it (`networkReach`), the engines it runs by name where it has them (`inExaminerWall`), and
 * `enters`, how something of the session does enter the exam.
 */
export async function examinerShell(shell: CommandWall | undefined, enters: string): Promise<SeatTool[]> {
  if (shell === undefined) return [];
  const network = await networkReach(shell);
  const engines = installedPrograms(shell.toolTree);
  const walls = ` The command runs in your home directory, which holds what earlier Examiner sessions of this campaign left there and is kept for the next. It can write there and $TMPDIR, which is kept for the whole session; a path under /tmp is not: a write there is refused, or lands in a folder that does not outlive the command. It can read the host's own toolchains and public runtime roots, but no repository or private data. ${network === "reached" ? "It has network access: a package index was reached from inside the wall when this process started." : "It has no network access: a package index could not be reached from inside the wall when this process started, so nothing can be installed."}${engines.length === 0 ? "" : ` The engines the exam's checks run are installed, and run by name: ${engines.join(", ")}. They compute; try_answer alone runs the checks on an answer.`} Nothing a command starts runs on after it returns. Nothing in your home enters the exam: ${enters}.`;
  return codingTools(shell, ["bash", "read", "write"]).map((each) =>
    each.name === "bash" ? { ...each, description: `${each.description}${walls}` } : each,
  );
}

/** `run` with an Examiner's shell under the solver's command wall, and the engines installed in
 *  it: claim its root, install the engines the wall names, seed the home, run, keep the home, tear
 *  down.
 *
 *  Each engine runs from the verifier's tree where it lies, which a pack or the repository closes:
 *  the wall opens that tree again for reading, and the shell's tool tree, first on its PATH, holds
 *  one program a name that runs the pinned one by its path, in the host's folder no command can
 *  write. A link would not serve: an engine may find its own files beside where it was started
 *  from, as buffer's `phreeqc` finds its binary, so it is started from where it lies. */
export async function inExaminerWall<T>(
  { log, id }: { readonly log: string; readonly id: string },
  wall: Wall,
  run: (walls: Walls) => Promise<T>,
): Promise<T> {
  const began = performance.now();
  const dirs = examinerDirs(log, id);
  const { engines, keep } = wall;
  const pinned = engines === undefined ? [] : pinnedEngines(engines);
  const reopened = engines === undefined || pinned.length === 0 ? [] : [engines.tools];
  const tree = join(dirs.kept, "engines");
  const release = claimRoot(dirs.root);
  try {
    const base = await walledBase(dirs, { ...wall, readAllowRoots: reopened }, "an Examiner");
    for (const { name, path } of pinned) {
      const runs = join(tree, "bin", name);
      await Bun.write(runs, `#!/bin/sh\nexec ${shellQuote(path)} "$@"\n`);
      // Bun 1.4 writes text at 0644 whatever `mode` its write is given.
      chmodSync(runs, 0o755);
    }
    const shell = {
      base,
      dirs,
      toolTree: pinned.length === 0 ? null : tree,
      limits: { shellDefaultSeconds: 120, shellMaxSeconds: 600 },
    };
    const { home } = dirs;
    const carry = { recursive: true, verbatimSymlinks: true } as const;
    if (keep !== undefined && existsSync(keep)) cpSync(keep, home, carry);
    const kept = () => {
      if (keep === undefined) return;
      rmSync(keep, { recursive: true, force: true });
      cpSync(home, keep, carry);
    };
    const result = await run({ shell, pinned, began, keep: kept });
    // The campaign's copy of a session's home, made whole when the session ends and replacing the
    // one before: it is the exam side's, under the campaign's folder beside the log, which every
    // wall closes. Each link is carried as it stands, as the Builder's carry does: until 28 October
    // a relative one was read through the session's root, removed with it, so every kept venv's
    // `python` dangled in the next home. Not a session that crashed with a command running, whose
    // home is as no command left it, as its last event says. Until 12 October every crashed
    // session's home replaced the kept one, and on buffer the next session opened in the working
    // files of one whose turn the provider failed; from then until 14 October none did, and a
    // crashed Examiner's work was lost to the provider. A drafting session ends in `draft.finished`,
    // which this read missed until 5 November, so a draft that crashed mid-command was carried on.
    // The conversation's last ask, whose id is its own (`examining`, `session.ts`).
    const ended = read(log).findLast(
      ({ kind }) => kind === "exam.finished" || kind === "draft.finished",
    )?.data;
    if (!(ended?.ended === "crashed" && Number(ended.running) > 0)) kept();
    return result;
  } finally {
    await release();
  }
}

/**
 * `definition` with every `{ from_file: <path> }` in a call's arguments replaced by the JSON the
 * file holds, read from the session's home and nowhere else, so a large value need not be printed
 * into context and pasted back, where a printout cut short or a slip in the copy changes it; the gate
 * sees the same bytes as for the value written inline, and the log the call as written. A file's own
 * content is not expanded for `from_file` again. The files are read before pi checks the arguments
 * against the tool's schema (`prepareArguments`), so a file may stand for any value, a whole list or
 * object included: until 20 November the check came first and refused a file in place of one (6 of
 * the 33 calls that gave a file in a pair of runs that day). A refusal names its faults and not the
 * arguments the files filled.
 */
export function fromHome<Parameters extends TSchema>(
  home: string | undefined,
  definition: ToolRegistration<Parameters>,
): ToolRegistration<Parameters> {
  const expand = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(expand);
    if (!isRecord(value)) return value;
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0]?.[0] === "from_file" && isString(entries[0][1])) {
      return homeFile(home, entries[0][1]);
    }
    return Object.fromEntries(entries.map(([key, inner]) => [key, expand(inner)]));
  };
  return {
    ...definition,
    prepareArguments: (spelled) => {
      // SAFETY: a call's arguments are the JSON object the provider parsed, and a file holds JSON.
      const args = expand(spelled as JsonValue) as JsonObject;
      try {
        validateToolArguments(definition, {
          type: "toolCall",
          id: "",
          name: definition.name,
          arguments: args,
        });
      } catch (error) {
        const [faults = ""] = errorMessage(error).split("\n\nReceived arguments:");
        throw new Error(faults, { cause: error });
      }
      // SAFETY: just checked against the tool's schema, which pi checks and coerces it by again.
      return args as ReturnType<NonNullable<ToolRegistration<Parameters>["prepareArguments"]>>;
    },
  };
}

/** The JSON a file in `home` holds, by its path under it, or a refusal. */
function homeFile(home: string | undefined, path: string): JsonValue {
  if (home === undefined) {
    throw new Error(`from_file names ${path}, and this session has no home: give the value inline`);
  }
  const root = realpathSync(home);
  const file = resolve(root, path);
  if (!containsPath(file, root)) {
    throw new Error(
      `from_file names ${path}, which lies outside your home: name a file under it, by its path relative to it`,
    );
  }
  if (!existsSync(file)) {
    throw new Error(`from_file names ${path}, and your home holds no such file`);
  }
  const real = realpathSync(file);
  if (!containsPath(real, root)) {
    throw new Error(`from_file names ${path}, which links outside your home: name a file under it`);
  }
  const stat = statSync(real);
  if (!stat.isFile()) {
    throw new Error(`from_file names ${path}, which is not a regular file`);
  }
  if (stat.size > FILE_BYTES) {
    throw new Error(
      `from_file names ${path} (${String(stat.size)} bytes), over the ${String(FILE_BYTES)}-byte limit`,
    );
  }
  try {
    return parseJsonAs<JsonValue>(readFileSync(real, "utf8"));
  } catch (error) {
    throw new Error(`from_file names ${path}, which is not valid JSON: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}
