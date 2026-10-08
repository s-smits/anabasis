/**
 * The solver's `bash` tool: pi's bash on the command wall (`wallOperations`), as the solves of sweep
 * veryhard-hb-4c67fc saw v1's `shell` preset. Sed from harness-builder-v4 7af7315
 * src/solve/built-bash.ts (the `port === null` path) and src/solve/dcg-rules.ts:53-60.
 *
 * One departure: v2 has no destructive-command guard, so the four rule sentences that described its
 * refusals are left out. In the sweep it refused 83 calls; here those commands run.
 */
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { createBashTool } from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import { readdirSync, statSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { asError } from "../meta/runtime-values.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { toolTreeSearchDirs } from "../verify/solve-command-isolation.ts";
import { type CommandWall, shellSeconds, wallOperations } from "./command.ts";

/** pi's own (vendor/pi-coding-agent/core/tools/bash.ts, `createShellToolDefinition`), read from the
 *  tool rather than copied, so it moves with the vendored pi. */
const BASE_DESCRIPTION = createBashTool("/").description;

type ShellLimits = CommandWall["limits"];

/** Installed program names the description lists before it elides the rest (built-bash.ts:98). */
const LISTED_PROGRAMS = 20;

// built-bash.ts:136-140, verbatim.
const SCRATCH_FOLDER =
  " The command runs in a fresh private folder that is removed when it ends; nothing there becomes " +
  "your answer, which you still record with the harness's own tools. A driver you keep in your home " +
  "directory and re-run, reading its inputs from a file you edit between commands, buys more " +
  "candidates than retyping the work each time.";
// built-bash.ts:124-131, verbatim. Each clause still holds on the v2 wall (`commandIsolationPolicy`):
// network is open, `$HOME` persists and is never read back, `TMPDIR` is per command, `/tmp` is
// writable, the repository and protected home roots stay closed, and PATH is `toolchainPathDirs`.
const WALLS =
  " It has network access, so a toolchain or package can be downloaded into your home directory, " +
  "a separate folder that survives between commands and is never read back; $TMPDIR is fresh for " +
  "each command. It can write those places and /tmp, and read the host's own toolchains and public " +
  "runtime roots, but no repository or private data. It does not check whether your answer is " +
  "correct. sh, bun, node, python3 and the system C and C++ compilers " +
  "run, with versions and libraries that differ by host: check one before building on it, and install " +
  "what is missing into your home directory.";
/** dcg-rules.ts:53-60 less its four guard sentences ("Refused: rm -r outside…", "Delete a tree
 *  with rm -rf…", "Write with > to $HOME/<name>…", "A refused command runs nothing…"): with no
 *  guard here they would tell the solver about refusals that never happen. */
const SHELL_RULES = [
  "Keep scripts and results in $HOME; do not scan the filesystem.",
  "A command has a default time limit; pass timeout for a long build, never for a search.",
];

/** What the harness would have allowed, appended to a command its own wall cut: time left to ask
 *  for, an ask above the maximum, or the maximum already in hand (built-bash.ts:82-96, verbatim). */
function timeoutClause(
  asked: number,
  seconds: number,
  { shellDefaultSeconds, shellMaxSeconds }: ShellLimits,
): string {
  const cheaper = "the move left is cheaper work rather than longer";
  if (seconds < shellMaxSeconds) {
    return `\n\nThis harness allows ${shellMaxSeconds} s for one command, and ${shellDefaultSeconds} s when you pass none, so there is more time to ask for.`;
  }
  if (asked > shellMaxSeconds) {
    return `\n\nYour ${asked} s is above the ${shellMaxSeconds} s this harness allows one command, so it ran as ${seconds} s — the most there is, and ${cheaper}.`;
  }
  return `\n\nThat is the whole ${shellMaxSeconds} s this harness allows one command, so ${cheaper}.`;
}

/** Whether the command could run this entry by name: a venv's sourced `activate` siblings are mode
 *  644, and a broken link runs nothing (built-bash.ts:152-159). */
function canRun(path: string): boolean {
  try {
    const entry = statSync(path);
    return entry.isFile() && (entry.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** The programs the harness installed, by the names that run them, from the directories the
 *  command's PATH holds, in its order (built-bash.ts:176-186). Without the list, every case of truss
 *  run 298967 wrote its own solver in the host's python3 beside the Builder's interpreter. */
function installedPrograms(toolTree: string | null): string {
  const dirs = toolTree === null ? [] : toolTreeSearchDirs(toolTree);
  const names = [
    ...new Set(
      dirs.flatMap((dir) =>
        readdirSync(dir)
          .sort(compareCodeUnits)
          .filter((name) => canRun(join(dir, name))),
      ),
    ),
  ];
  if (names.length === 0) return "";
  const rest = names.length - LISTED_PROGRAMS;
  const shown =
    names.slice(0, LISTED_PROGRAMS).join(", ") +
    (rest > 0 ? `, and ${String(rest)} more this command's PATH holds` : "");
  return ` Programs this harness installed run by name: ${shown}. Use them instead of fetching or re-implementing what they compute.`;
}

/** The tool's description: pi's base, then what the sweep's solves were told about the wall. The
 *  sentence on the session home is built-bash.ts:145-147's `publicFolder`, verbatim; the runner
 *  seeds what it names. */
export function shellDescription(toolTree: string | null, publicResourceFiles: number): string {
  const resources =
    publicResourceFiles === 0
      ? ""
      : ` and this domain's public rules under public/resources/ (${publicResourceFiles} file${publicResourceFiles === 1 ? "" : "s"})`;
  const publicFolder = ` Your home directory already holds this task as public/task.json${resources}.`;
  return `${BASE_DESCRIPTION}${SCRATCH_FOLDER}${WALLS}${publicFolder}${installedPrograms(toolTree)} ${SHELL_RULES.join(" ")}`;
}

/**
 * The solver's shell. The result is pi's own; only a cut by this tool's wall gains a clause, and
 * "this wall cut it" is read from the backend's `timeout:` error, not from the output text a
 * command could print. The solve's abort reaches pi as `aborted` and gains nothing.
 */
export function shellTool(wall: CommandWall, publicResourceFiles: number): AgentTool {
  const { limits } = wall;
  const operations = wallOperations(wall);
  return {
    name: "bash",
    label: "bash",
    description: shellDescription(wall.toolTree, publicResourceFiles),
    // built-bash.ts:54-61, verbatim: pi's schema says it has no default timeout, which is not so here.
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({
          description: `Timeout in seconds: ${limits.shellDefaultSeconds} when omitted, at most ${limits.shellMaxSeconds}; a value outside that range runs at the nearest end of it`,
        }),
      ),
    }),
    executionMode: "sequential",
    execute: async (callId, params, signal, onUpdate): Promise<AgentToolResult<unknown>> => {
      const { command, timeout } =
        /* SAFETY: the registered schema requires `command` and makes `timeout` optional, and pi validates arguments against it before this runs. */ params as {
          command: string;
          timeout?: number;
        };
      const { asked, seconds } = shellSeconds(timeout, limits);
      let cut = false;
      // The cwd is the wall's to choose (`wallOperations` drops it), and session variables are off
      // because the wall's environment replaces pi's.
      const shell = createBashTool(wall.dirs.home, {
        exposeSessionEnvironment: false,
        // A cut command's full output, which the notice names, stays inside this wall's home: the OS
        // temp directory is every wall's, and another solve's could be read there.
        tempDir: join(wall.dirs.home, ".shell-output"),
        operations: {
          exec: (line, cwd, options) =>
            operations.exec(line, cwd, options).catch((error: unknown) => {
              cut = asError(error).message.startsWith("timeout:");
              throw error;
            }),
        },
      });
      try {
        return await shell.execute(callId, { command, timeout: seconds }, signal, onUpdate);
      } catch (error) {
        if (!cut) throw error;
        throw new Error(asError(error).message + timeoutClause(asked, seconds, limits), { cause: error });
      }
    },
  };
}
