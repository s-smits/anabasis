/**
 * The Examiner's shell: `bash`, `read` and `write` in a walled home of its own, the same for a
 * session of any mode (`examine`, `session.ts`).
 *
 * The home is a capped root as a Builder's is, under the solver's command wall (`walledBase`,
 * `src/solve/command.ts`): the repository, its other worktrees and a stored pack are closed to it,
 * and the wall is probed before its first command. Nothing in the home enters the exam: a session
 * puts a task, a draft or a repair through its own tool, and the host reads that alone.
 *
 * A task-writing session has one because, without it, its notes said that a task's feasibility
 * rested on hand estimates. A drafting session has one so that it can look up the source it names
 * for each rule, and run its own check program on its own controls before it puts a draft
 * (`docs/plan.md`, row F57). One mount and one sentence serve every mode, so that their walls
 * cannot drift apart, and the wall says when the seat began to be set up: a session's time is
 * counted from then, so the mount and the wall's probe are inside its limit in every mode.
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
 * the path and not out of reach. Its tasks still enter through the gate alone (`propose_tasks`, or
 * `try_task` where the reference harness solves a draft task), and its answers are ruled on by
 * `try_answer` alone.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { wrapToolDefinitions } from "../../vendor/pi-coding-agent/core/tools/tool-definition-wrapper.ts";
import { type Engine, pinnedEngines, type VerifierTree } from "../kernel/verify.ts";
import { chmodSync, rmSync } from "../meta/filesystem.ts";
import { basename, dirname, join } from "../meta/path.ts";
import {
  type CommandWall,
  networkReach,
  type SolveDirs,
  solveDirs,
  type Walled,
  walledBase,
} from "../solve/command.ts";
import { codingTools } from "../solve/coding-tools.ts";
import { installedPrograms } from "../solve/prompt.ts";
import { mountDiskCap } from "../verify/disk-cap.ts";
import { shellQuote } from "../verify/solve-command-isolation.ts";

/** Where an Examiner session's shell is mounted: what the wall denies and caps, and what only a
 *  session with a campaign's exam before it is given. Without a wall a session has no shell. */
export interface Wall extends Walled {
  /** The campaign's check program and the verifier's tool tree it runs under: the engines the
   *  program names are installed in the shell (`pinnedEngines`, `src/kernel/verify.ts`). A drafting
   *  session is given none, whatever is named here: nothing is drafted yet that names one. */
  readonly engines?: VerifierTree | undefined;
  /** Where the campaign keeps a task-writing session's home between sessions: the folder the last
   *  session's home was copied to whole, and the next one's is seeded from. Absent, nothing is
   *  carried, as a test may want. */
  readonly keep?: string | undefined;
}

/** A mounted wall as its session is handed it: the shell, the engines installed in it, and when
 *  the seat began to be set up (`performance.now()`), which the session's time is counted from. */
export interface Walls {
  readonly shell: CommandWall;
  readonly pinned: readonly Engine[];
  readonly began: number;
}

/** Where an Examiner session's shell runs: a capped root of its own, as a Builder's. A drafting
 *  session's id (`d-N`) and a task-writing one's (`x-N`) never meet. */
export const examinerDirs = (log: string, id: string): SolveDirs =>
  solveDirs(`exam-${basename(dirname(log))}-${id}`);

/**
 * The shell's three tools where the session has one, and none where it has not. `bash` carries
 * what the session is told of its wall, after pi's own description: the network as the wall's probe
 * found it (`networkReach`), the engines it runs by name where it has them (`inExaminerWall`),
 * `enters`, how something of the session does enter the exam, `home`, what the home holds at the
 * session's start, and `checked`, the tool through which the host runs the checks for it.
 */
export async function examinerShell(
  shell: CommandWall | undefined,
  enters: string,
  home = "empty at its start",
  checked = "try_answer alone runs the checks on an answer",
): Promise<AgentTool[]> {
  if (shell === undefined) return [];
  const network = await networkReach(shell);
  const engines = installedPrograms(shell.toolTree);
  const walls = ` The command runs in your home directory, which is yours for the session and ${home}. It can write there and $TMPDIR, which is kept for the whole session; a path under /tmp is not: a write there is refused, or lands in a folder that does not outlive the command. It can read the host's own toolchains and public runtime roots, but no repository or private data. ${network === "reached" ? "It has network access: a package index was reached from inside the wall when this process started." : "It has no network access: a package index could not be reached from inside the wall when this process started, so nothing can be installed."}${engines.length === 0 ? "" : ` The engines the exam's checks run are installed, and run by name: ${engines.join(", ")}. They compute; ${checked}.`} A command has a default time limit and may name a longer timeout. Nothing a command starts runs on after it returns. Nothing in your home enters the exam: ${enters}.`;
  // SAFETY: pi's wrapper types its tools' parameters `any`; each is one of pi's definitions.
  return (wrapToolDefinitions(codingTools(shell, ["bash", "read", "write"])) as AgentTool[]).map((each) =>
    each.name === "bash" ? { ...each, description: `${each.description}${walls}` } : each,
  );
}

/** `run` with an Examiner's shell under the solver's command wall and disk cap, and the engines
 *  installed in it: mount, install the engines the wall names, run, tear down.
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
  const { engines } = wall;
  const pinned = engines === undefined ? [] : pinnedEngines(engines);
  const reopened = engines === undefined || pinned.length === 0 ? [] : [engines.tools];
  const tree = join(dirs.kept, "engines");
  const release = await mountDiskCap({ root: dirs.root, bytes: wall.diskBytes });
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
    return await run({ shell, pinned, began });
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}
