/**
 * The Built Harness shell: one Pi bash command under the controller's command wall.
 *
 * Pi owns the command (timeout, abort, process-tree kill, output truncation); this module owns only
 * the rules it runs under and, for the `files` preset, how the in-memory draft becomes a directory
 * and back. The wall is applied in Pi's `prepare` hook, as Pi's own sandbox extension does. The shell
 * is a controller tool rather than a worker tool, so generated code keeps its stricter boundary.
 *
 * Each command gets three writable trees (`solve-command-isolation.ts` owns the rules): a work tree
 * holding the draft, the session home where installs survive between commands (never read back),
 * and a TMPDIR made for this command alone. Reads are open except the repository, protected home
 * roots, other commands' trees and run data; outbound network is open (operator decisions
 * 2026-08-15 and 2026-09-06); `/tmp` stays writable because build scripts spell it (2026-09-15).
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { dirname, join } from "../meta/path.ts";
import { type AgentTool, type AgentToolResult, createBashTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { refuseDestructiveCommand } from "../builder/command-guard.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { isRecord } from "../meta/json-shape.ts";
import {
  BUILT_COMMAND_SCRATCH_ROOT,
  commandIsolationPolicy,
  stageCommandIsolation,
  toolTreeSearchDirs,
} from "../verify/solve-command-isolation.ts";
import type { SolveIsolationPolicy } from "../verify/solve-sandbox.ts";
import { DEFAULT_HARNESS_SETTINGS, type HarnessSettings } from "../truth/harness-config.ts";
import { BUILT_SHELL_RULES } from "./dcg-rules.ts";
import { ARTIFACT_JSON_MAX_BYTES } from "./draft-store.ts";
import { FILE_MAP_MAX_ENTRIES, pathProblem } from "./file-map.ts";
import { BUILT_FILE_MAX_CHARS } from "./generated-tool-worker-protocol.ts";
import { executePiTool } from "./pi-tool-call.ts";
import { asError } from "../meta/runtime-values.ts";

export const BUILT_BASH_TOOL = "bash";
/** Installed program names the description lists before it elides the rest. */
const LISTED_PROGRAMS = 20;

/** The worker side of the draft exchange, with the answer root the draft fills. */
export interface BuiltFilePort {
  /** A command sees the draft in a folder of this name, so a shell path is the answer's own path:
   *  esp32 run 08c0f2 compiled `firmware/firmware.ino` at the top of the shell and passed, while
   *  the checker found it at `firmware/firmware/firmware.ino`. */
  readonly root: string;
  files(): Promise<Record<string, string>>;
  applyFiles(files: Record<string, string>): Promise<void>;
}

interface BuiltBashOptions {
  /** Null still registers the tool, so the certified contract holds; a command is then refused. */
  policy: SolveIsolationPolicy | null;
  /** The `files` preset's draft exchange; null under `shell`, which has no draft files. */
  port: BuiltFilePort | null;
  home: string;
  /** How many public resource files the session home was seeded with, so the description can name
   *  what is already on disk. */
  publicResourceFiles?: number;
  /** The adopted bundle's `.toolchain`, first on PATH; null when it has none. */
  toolTree?: string | null;
  /** Where the destructive-command guard is looked up: the controller's environment. */
  guardEnv?: OptionalEnvValues;
  safeguardContext?: SafeguardContext;
  /** The harness's shell walls; the config defaults when absent. */
  timeouts?: Pick<HarnessSettings, "shellDefaultSeconds" | "shellMaxSeconds">;
}

const WALLS =
  " It has network access, so a toolchain or package can be downloaded into your home directory, " +
  "a separate folder that survives between commands and is never read back; $TMPDIR is fresh for " +
  "each command. It can write those places and /tmp, and read the host's own toolchains and public " +
  "runtime roots, but no repository or private data. It does not check whether your answer is " +
  "correct. sh, bun, node, python3 and the system C and C++ compilers " +
  "run, with versions and libraries that differ by host: check one before building on it, and install " +
  "what is missing into your home directory.";
const SCRATCH_FOLDER =
  " The command runs in a fresh private folder that is removed when it ends; nothing there becomes " +
  "your answer, which you still record with the harness's own tools. A driver you keep in your home " +
  "directory and re-run, reading its inputs from a file you edit between commands, buys more " +
  "candidates than retyping the work each time.";

interface ReadTree {
  files: Record<string, string>;
  /** Entries not carried: build output, symlinks, oversized or surplus files. Counted, not listed. */
  leftOut: number;
  /** The agent's own paths whose new bytes cannot be carried, so their previous text was kept. */
  reverted: string[];
}

function draftFolder(root: string): string {
  return (
    ` The command runs in a private folder whose \`${root}/\` folder is your answer's \`${root}\` root, ` +
    `laid out as the checker receives it. Text files you leave in \`${root}/\` become your draft files, up to ` +
    `${FILE_MAP_MAX_ENTRIES} of them; your existing files are always kept, and the reply says how many ` +
    "extra ones did not fit. Everything else in the private folder is removed when the command ends."
  );
}

/** Pi's bash has no default timeout and its schema says so. The walls come from the harness's
 *  agent/config.yaml (`solver.shell_timeout_seconds`, `solver.shell_timeout_max_seconds`), so the
 *  schema the solver reads states them in place of Pi's sentence. */
function shellParameters(timeouts: Pick<HarnessSettings, "shellDefaultSeconds" | "shellMaxSeconds">) {
  return Type.Object({
    command: Type.String({ description: "Bash command to execute" }),
    timeout: Type.Optional(
      Type.Number({
        description: `Timeout in seconds: ${timeouts.shellDefaultSeconds} when omitted, at most ${timeouts.shellMaxSeconds}; a value outside that range runs at the nearest end of it`,
      }),
    ),
  });
}
/**
 * What the harness would have allowed, appended to a command its own wall cut.
 *
 * The solver of c1d2a7 passed `timeout: 120` on 42 of the 74 calls whose arguments its traces
 * record, and was cut 21 times across 18 solves — while the same bundle's config granted 300 s by
 * default and 900 s on request. "Command timed out after 120 seconds" names the number the solver
 * chose and never the number it had, so the cheapest answer available to it, asking for the time it
 * already owned, was the one it could not see. The schema states both numbers at registration,
 * which demonstrably was not where they decided anything.
 *
 * Whether this wall cut the command is the same question as what to say about it, so it has one
 * owner. Pi's own `code` answers it: it attaches `{ cause: result.error }` on a cut, throws a bare
 * Error on a non-zero exit, and separates "timeout" from "aborted", which is the session wall
 * rather than this one. Reading that code holds without an argument about when the runner kills
 * what, which an elapsed-time test would have needed. Empty means this wall did not cut it.
 *
 * Then three states, because there are three: time left to ask for, an ask above the maximum, and
 * the maximum already in hand. The config file is named in none of them — the solver cannot change
 * it mid-battery, and raising those numbers is the Builder's lever, which `solverBudgetNotice` states.
 */
function shellBudgetClause(
  failure: Error | null,
  asked: number,
  seconds: number,
  { shellDefaultSeconds, shellMaxSeconds }: Pick<HarnessSettings, "shellDefaultSeconds" | "shellMaxSeconds">,
): string {
  const cause = failure?.cause;
  if (!isRecord(cause) || cause.code !== "timeout") return "";
  const cheaper = "the move left is cheaper work rather than longer";
  if (seconds < shellMaxSeconds) {
    return `\n\nThis harness allows ${shellMaxSeconds} s for one command, and ${shellDefaultSeconds} s when you pass none, so there is more time to ask for.`;
  }
  if (asked > shellMaxSeconds) {
    return `\n\nYour ${asked} s is above the ${shellMaxSeconds} s this harness allows one command, so it ran as ${seconds} s — the most there is, and ${cheaper}.`;
  }
  return `\n\nThat is the whole ${shellMaxSeconds} s this harness allows one command, so ${cheaper}.`;
}
/** Whether the command could run this entry by name. A venv's `bin` is about a third files that
 *  cannot: `activate` and its .bat, .csh, .fish, .nu, .ps1 and _this.py siblings, `deactivate.bat`
 *  and `pydoc.bat` are all mode 644 and sourced, never executed. A broken link runs nothing. */
function canRun(path: string): boolean {
  try {
    const entry = statSync(path);
    return entry.isFile() && (entry.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * The programs the harness installed, by the names that run them. A location would not help: the
 * tree is in neither the command's folder nor its home. Every case of truss run 298967 (2026-09-15)
 * ran `ls .toolchain` or `ls ~/.toolchain`, found nothing and wrote its own nonlinear solver in the
 * host's python3, while the first PATH entry held the Builder's OpenSeesPy interpreter. Since
 * 2026-09-16 the list covers every program directory the tool tree has, as the PATH does.
 *
 * The bound cuts alphabetically, so what fills the first slots decides what the solver hears about.
 * A uv-made venv for a structural domain puts nine unrunnable entries in front of the tree's own
 * programs, and with the twenty bound that leaves the Builder's `truss-check` and `sectionprops`
 * unnamed behind `pydoc.bat`. Both repairs here are facts rather than judgements about which name
 * matters: an entry no mode lets the command run is not a program it can run by name, and a cut
 * tail is reachable through the PATH the command already carries. Ranking the survivors by what
 * they look like would be the loop choosing domain content, which is the Builder's.
 */
function installedPrograms(toolTree: string | null): string {
  // The same directories the command's PATH holds, in its order; the first of a name is the one that runs.
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

/** Null for anything a text draft cannot carry. The stat bound comes first: UTF-8 spends at most
 *  four bytes a character, and a linked binary must not be read into memory to be refused. */
function readText(path: string): string | null {
  try {
    if (statSync(path).size > BUILT_FILE_MAX_CHARS * 4) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  } catch {
    return null;
  }
}

/**
 * What the command left in the work tree, the agent's own paths first. Past the answer's bounds an
 * entry is left behind rather than the batch refused: refusing discarded a source edit together
 * with a toolchain install on 2026-08-19. An own path the draft cannot carry keeps its previous text,
 * since dropping it would delete the file; an own path absent from disk is a deletion the command
 * meant. Sizes are JSON-escaped, as the apply frame carries them.
 */
function readTree(root: string, before: Record<string, string>): ReadTree {
  const own: [string, string][] = [];
  const extra: [string, string][] = [];
  const reverted: string[] = [];
  let leftOut = 0;
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      compareCodeUnits(a.name, b.name),
    )) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), path);
        continue;
      }
      const previous = before[path];
      const text = entry.isFile() && pathProblem(path) === null ? readText(join(dir, entry.name)) : null;
      if (text === null || text.length > BUILT_FILE_MAX_CHARS) {
        if (previous === undefined) leftOut += 1;
        else {
          own.push([path, previous]);
          reverted.push(path);
        }
      } else if (previous !== undefined) own.push([path, text]);
      // A runaway build stops being buffered here; the agent's own files keep going.
      else if (extra.length < FILE_MAP_MAX_ENTRIES) extra.push([path, text]);
      else leftOut += 1;
    }
  };
  walk(root, "");
  const sizeOf = (text: string) => new TextEncoder().encode(capturedJsonStringify(text)).byteLength;
  let total = own.reduce((sum, [, text]) => sum + sizeOf(text), 0);
  // Own files grown together past the frame keep their previous, carried text.
  for (const entry of own) {
    const previous = before[entry[0]] ?? entry[1];
    if (total <= ARTIFACT_JSON_MAX_BYTES || sizeOf(previous) >= sizeOf(entry[1])) continue;
    total += sizeOf(previous) - sizeOf(entry[1]);
    entry[1] = previous;
    reverted.push(entry[0]);
  }
  const files: Record<string, string> = Object.fromEntries(own);
  for (const [path, text] of extra) {
    if (Object.keys(files).length >= FILE_MAP_MAX_ENTRIES || total + sizeOf(text) > ARTIFACT_JSON_MAX_BYTES) {
      leftOut += 1;
    } else {
      files[path] = text;
      total += sizeOf(text);
    }
  }
  return { files, leftOut, reverted };
}

function fileLine({ files, leftOut, reverted }: ReadTree): string {
  const left =
    leftOut === 0
      ? ""
      : ` ${leftOut} other entr${leftOut === 1 ? "y" : "ies"} could not be carried and were left out; your own files were kept first.`;
  const kept =
    reverted.length === 0
      ? ""
      : ` The draft cannot carry what the command left at ${reverted.join(", ")}, so the previous content was kept — rewrite as text under the file bound if the change was wanted.`;
  return `Draft files now: ${Object.keys(files).length}.${left}${kept}`;
}

export function createBuiltBashTool({
  policy,
  port,
  home,
  publicResourceFiles = 0,
  toolTree = null,
  guardEnv = Bun.env,
  safeguardContext,
  timeouts = DEFAULT_HARNESS_SETTINGS,
}: BuiltBashOptions): AgentTool {
  const base = createBashTool();
  // What the session home already holds. Stated once, because the shell is the only tool that can
  // read it; the folder is inside the home the WALLS sentence has already introduced.
  const publicFolder = ` Your home directory already holds this task as public/task.json${publicResourceFiles === 0 ? "" : ` and this domain's public rules under public/resources/ (${publicResourceFiles} file${publicResourceFiles === 1 ? "" : "s"})`}.`;
  return {
    ...base,
    name: BUILT_BASH_TOOL,
    parameters: shellParameters(timeouts),
    description: `${base.description}${port === null ? SCRATCH_FOLDER : draftFolder(port.root)}${WALLS}${publicFolder}${installedPrograms(toolTree)} ${BUILT_SHELL_RULES.join(" ")}`,
    executionMode: "sequential",
    execute: async (callId, params, signal, onUpdate): Promise<AgentToolResult<unknown>> => {
      const { command, timeout } =
        /* SAFETY: the registered schema requires `command` and makes `timeout` optional, and the worker validates arguments against it before this runs. */ params as {
          command: string;
          timeout?: number;
        };
      if (policy === null) {
        throw new Error("the shell cannot run a command: this session has no isolation to run it under");
      }
      // The Builder's guard, asked here too (operator decision 2026-09-06): the prompt states its rules.
      const refusal = refuseDestructiveCommand(command, guardEnv, safeguardContext, BUILT_SHELL_RULES);
      if (refusal !== null) throw new Error(refusal);
      // One 0700 parent for every command's trees, so the wall can close them all and reopen this one;
      // the profile file sits outside the writable trees, so a command cannot rewrite its own rules.
      mkdirSync(BUILT_COMMAND_SCRATCH_ROOT, { recursive: true, mode: 0o700 });
      const outer = realpathSync.native(mkdtempSync(join(BUILT_COMMAND_SCRATCH_ROOT, "run-")));
      const work = join(outer, "work");
      const temp = join(outer, "tmp");
      mkdirSync(work);
      mkdirSync(temp);
      try {
        const before = port === null ? {} : await port.files();
        const answer = join(work, port?.root ?? ".");
        mkdirSync(answer, { recursive: true });
        for (const [path, content] of Object.entries(before)) {
          mkdirSync(dirname(join(answer, path)), { recursive: true });
          writeFileSync(join(answer, path), content, "utf8");
        }
        const isolation = commandIsolationPolicy(policy, { work, home, temp, toolTree });
        const env = isolation.environment;
        const shell = createBashTool({
          prepare: (execution) => {
            execution.command = stageCommandIsolation(
              isolation,
              join(outer, "isolation.sb"),
              execution.command,
            );
            execution.cwd = work;
            execution.env = env;
            // Pi passes only these variables, so no provider credential reaches the command.
            execution.inheritEnv = false;
          },
        });
        const asked = Math.max(1, Math.floor(timeout ?? timeouts.shellDefaultSeconds));
        // A passed timeout may only raise the wall. Run de8b40's battery lost 13 commands to
        // `timeout: 120` beside an inner `timeout 880`, on a harness allowing 900, and both failing
        // families were diagnosed as search budget spent on commands the solver had cut short
        // itself. The clause below had already told it so in the result, and it asked for 120 again.
        const seconds = Math.min(Math.max(asked, timeouts.shellDefaultSeconds), timeouts.shellMaxSeconds);
        const execution = { env: new NodeExecutionEnv({ cwd: work, shellPath: "/bin/sh", shellEnv: env }) };
        // A non-zero exit throws; the files it wrote are still collected before it is re-raised.
        const outcome = await executePiTool(
          shell,
          callId,
          { command, timeout: seconds },
          {
            signal,
            onUpdate,
            environment: execution,
          },
        ).then(
          (result) => ({ result, failure: null }),
          (error: unknown) => ({ result: null, failure: asError(error) }),
        );
        const budget = shellBudgetClause(outcome.failure, asked, seconds, timeouts);
        const reported =
          (outcome.failure?.message ??
            (outcome.result?.content ?? [])
              .map((part) => (part.type === "text" ? part.text : ""))
              .join("")
              .trim()) + budget;
        if (port === null) {
          // The shell preset rethrew the runner's error untouched, which is how the budget clause
          // first missed the preset that most solves are given. Rewrapped only when there is a
          // clause, so every other failure keeps the error it arrived as.
          if (outcome.failure !== null) {
            throw budget === "" ? outcome.failure : new Error(reported, { cause: outcome.failure.cause });
          }
          return { content: [{ type: "text", text: reported }], details: outcome.result.details ?? null };
        }
        const tree = readTree(answer, before);
        await port.applyFiles(tree.files);
        const text = `${reported}\n\n${fileLine(tree)}`;
        if (outcome.failure !== null) throw new Error(text, { cause: outcome.failure.cause });
        return {
          content: [{ type: "text", text }],
          details: { ...outcome.result.details, fileCount: Object.keys(tree.files).length },
        };
      } finally {
        rmSync(outer, { recursive: true, force: true });
      }
    },
  };
}
