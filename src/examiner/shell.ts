/**
 * The Examiner's shell: `bash`, `read` and `write` in a walled home of its own, for the session
 * that writes tasks and for the one that drafts an exam.
 *
 * The home is a capped root as a Builder's is, under the solver's command wall (`walledBase`,
 * `src/solve/command.ts`): the repository, its other worktrees and a stored pack are closed to it,
 * and the wall is probed before its first command. Nothing in the home enters the exam: a session
 * puts a task or a draft through its own tool, and the host reads that alone.
 *
 * The task-writing session has had one since 10 October, when its notes said that a task's
 * feasibility rested on hand estimates. Until 11 October the session that drafts an exam had none:
 * it named a source for each rule from memory, could look nothing up, and could not run its own
 * check program on its own controls before it put a draft (`docs/plan.md`, row F57). One mount and
 * one sentence serve both, so that the two seats' walls cannot drift apart.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { wrapToolDefinitions } from "../../vendor/pi-coding-agent/core/tools/tool-definition-wrapper.ts";
import { rmSync } from "../meta/filesystem.ts";
import { basename, dirname } from "../meta/path.ts";
import {
  type CommandWall,
  networkReach,
  type SolveDirs,
  solveDirs,
  type Walled,
  walledBase,
} from "../solve/command.ts";
import { codingTools } from "../solve/coding-tools.ts";
import { mountDiskCap } from "../verify/disk-cap.ts";

/** An Examiner seat as its wall needs it: what the wall denies and caps, and the session it is. */
interface Seat extends Walled {
  readonly log: string;
  readonly id: string;
}

/** Where an Examiner session's shell runs: a capped root of its own, as a Builder's. A drafting
 *  session's id (`d-N`) and a task-writing one's (`x-N`) never meet. */
export const examinerDirs = (log: string, id: string): SolveDirs =>
  solveDirs(`exam-${basename(dirname(log))}-${id}`);

/**
 * The shell's three tools where the session has one, and none where it has not. `bash` carries
 * what the session is told of its wall, after pi's own description: the network as the wall's probe
 * found it (`networkReach`), and `enters`, how something of the session does enter the exam.
 */
export async function examinerShell(shell: CommandWall | undefined, enters: string): Promise<AgentTool[]> {
  if (shell === undefined) return [];
  const network = await networkReach(shell);
  const walls = ` The command runs in your home directory, which is yours for the session and empty at its start. It can write there and $TMPDIR, which is kept for the whole session; a path under /tmp is not: a write there is refused, or lands in a folder that does not outlive the command. It can read the host's own toolchains and public runtime roots, but no repository or private data. ${network === "reached" ? "It has network access: a package index was reached from inside the wall when this process started." : "It has no network access: a package index could not be reached from inside the wall when this process started, so nothing can be installed."} A command has a default time limit and may name a longer timeout. Nothing a command starts runs on after it returns. Nothing in your home enters the exam: ${enters}.`;
  // SAFETY: pi's wrapper types its tools' parameters `any`; each is one of pi's definitions.
  return (wrapToolDefinitions(codingTools(shell, ["bash", "read", "write"])) as AgentTool[]).map((each) =>
    each.name === "bash" ? { ...each, description: `${each.description}${walls}` } : each,
  );
}

/** `run` with an Examiner's shell under the solver's command wall and disk cap: mount, run, tear
 *  down. */
export async function inExaminerWall<T>(seat: Seat, run: (shell: CommandWall) => Promise<T>): Promise<T> {
  const dirs = examinerDirs(seat.log, seat.id);
  const release = await mountDiskCap({ root: dirs.root, bytes: seat.diskBytes });
  try {
    return await run({
      base: await walledBase(dirs, seat, "an Examiner"),
      dirs,
      toolTree: null,
      limits: { shellDefaultSeconds: 120, shellMaxSeconds: 600 },
    });
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}
