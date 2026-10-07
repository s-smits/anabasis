/**
 * The Built Harness shell: one Pi bash command under the controller's command wall.
 *
 * Pi owns the command (timeout, abort, process-tree kill, output truncation); this module owns only
 * the rules it runs under and, for the `files` preset, how the in-memory draft becomes a directory
 * and back. The wall is applied in Pi's spawn hook, as Pi's own sandbox extension does. The shell
 * is a controller tool rather than a worker tool, so generated code keeps its stricter boundary.
 *
 * Each command gets three writable trees (`solve-command-isolation.ts` owns the rules): a work tree
 * holding the draft, the session home where installs survive between commands (never read back),
 * and a TMPDIR made for this command alone. Reads are open except the repository, protected home
 * roots, other commands' trees and run data; outbound network is open (operator decision), so a
 * solver can fetch a toolchain it was not given; and `/tmp` stays writable because build scripts
 * spell it outright.
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
import { runtimeProcess } from "../meta/process.ts";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  type BashOperations,
  type BashToolDetails,
  createBashTool,
  createLocalBashOperations,
} from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import { refuseDestructiveCommand } from "../builder/command-guard.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import {
  BUILT_COMMAND_SCRATCH_ROOT,
  commandIsolationPolicy,
  stageCommandIsolation,
  toolTreeSearchDirs,
} from "../verify/solve-command-isolation.ts";
import type { SolveIsolationPolicy } from "../verify/solve-sandbox.ts";
import { canonicalForms } from "../verify/wall-policy.ts";
import { DEFAULT_HARNESS_SETTINGS, type HarnessSettings } from "../correctness-bundle/harness-config.ts";
import { BUILT_SHELL_RULES } from "./dcg-rules.ts";
import { ARTIFACT_JSON_MAX_BYTES } from "./draft-store.ts";
import { FILE_MAP_MAX_ENTRIES, pathProblem } from "./file-map.ts";
import { BUILT_FILE_MAX_CHARS } from "./generated-tool-worker-protocol.ts";
import { asError } from "../meta/runtime-values.ts";

export const BUILT_BASH_TOOL = "bash";
/** Installed program names the description lists before it elides the rest. */
const LISTED_PROGRAMS = 20;

/** Where a cut command's whole output is kept: the session home, which the next command of this
 *  session can read and every other session's command cannot, and which is removed with the
 *  session. Pi's own default is the host temporary directory, open to every later solve's reads,
 *  so this is the `tempDir` the copied tool is handed. */
const SHELL_OUTPUT_DIR = ".shell-output";

/** The worker side of the draft exchange, with the answer root the draft fills. */
export interface BuiltFilePort {
  /** A command sees the draft in a folder of this name, so a path the shell uses is the answer's
   *  own path. Without it a solver compiles `firmware/firmware.ino` at the top of the shell and
   *  passes while the checker finds the same file at `firmware/firmware/firmware.ino` — solver and
   *  verifier reading two different roots for one answer. */
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
   *  what is already on disk rather than leaving the solver to discover it. */
  publicResourceFiles?: number;
  /** The adopted bundle's `.toolchain`, first on PATH; null when it has none. */
  toolTree?: string | null;
  /** Programs under the tool tree a command may not run: a check's deciding instruments, when the
   *  operator launched the run with them withheld. Empty leaves the shell exactly as before. */
  withheld?: readonly string[];
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
  "correct. Work a command leaves running in the background is killed when the command returns, so run " +
  "a long search in the foreground, under the command's timeout. sh, bun, node, python3 and the system C and C++ compilers " +
  "run, with versions and libraries that differ by host: check one before building on it, and install " +
  "what is missing into your home directory.";
/** The shell is the host's own `/bin/sh`, and a macOS host's `sed` is BSD: its errors in recorded
 *  cases were often hidden by a later command's exit status. */
const BSD_TOOLS = " On this host the system utilities, sed among them, are BSD, not GNU.";
const SCRATCH_FOLDER =
  " The command runs in a fresh private folder that is removed when it ends; nothing there becomes " +
  "your answer, which you still record with the harness's own tools.";

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

/** Pi's bash has no default timeout and its own schema says so, but this shell does: the walls come
 *  from the harness's `agent/config.yaml` as `solver.shell_timeout_seconds` and
 *  `solver.shell_timeout_max_seconds`. The schema the solver reads therefore states those two
 *  numbers in place of Pi's sentence, because the sentence it would otherwise read is true of Pi
 *  and false here. */
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
 * "Command timed out after 120 seconds" names the number the solver chose and never the number it
 * had, so a solver that passes a short `timeout` keeps being cut while the harness grants several
 * times that by default and more again on request. The cheapest move available to it — asking for
 * time it already owns — is the one it cannot see. The schema states both numbers at registration,
 * and that demonstrably is not where they decide anything.
 *
 * Whether this wall cut the command is decided by the process launch this shell hands Pi (`cut`
 * below), not read back out of Pi's message: Pi's local launch throws `timeout:<seconds>` when its
 * timer killed the command and `aborted` for a cancellation, which is the session wall rather than
 * this one, and a non-zero exit throws nothing. That holds without an argument about when the
 * runner kills what, which an elapsed-time test would have needed. Empty means this wall did not cut
 * the command.
 *
 * Then three states, because there are three: time left to ask for, an ask above the maximum, and
 * the maximum already in hand. The config file is named in none of them, since the solver cannot
 * change it mid-battery — raising those numbers is the Builder's lever, and `solverBudgetNotice`
 * states it there.
 */
function shellBudgetClause(
  cut: boolean,
  asked: number,
  seconds: number,
  { shellDefaultSeconds, shellMaxSeconds }: Pick<HarnessSettings, "shellDefaultSeconds" | "shellMaxSeconds">,
): string {
  if (!cut) return "";
  const cheaper = "the move left is cheaper work rather than longer";
  if (seconds < shellMaxSeconds) {
    return `\n\nThis harness allows ${shellMaxSeconds} s for one command, and ${shellDefaultSeconds} s when you pass none, so there is more time to ask for.`;
  }
  if (asked > shellMaxSeconds) {
    return `\n\nYour ${asked} s is above the ${shellMaxSeconds} s this harness allows one command, so it ran as ${seconds} s — the most there is, and ${cheaper}.`;
  }
  return `\n\nThat is the whole ${shellMaxSeconds} s this harness allows one command, so ${cheaper}.`;
}
/** What the command printed, or why it failed. Pi's cut notice names the stored file and stops
 *  there, and the solver's read tool cannot open it, because that tool reaches the draft alone. So
 *  the notice also names the tool that can. */
function shellReport(text: string, store: string): string {
  const at = text.lastIndexOf(`Full output: ${store}/`);
  const end = at < 0 ? -1 : text.indexOf("]", at);
  return end < 0 ? text : `${text.slice(0, end)} — read it with this shell.${text.slice(end)}`;
}
/** Whether the command could run this entry by name. A venv's `bin` is about a third files that
 *  cannot: `activate` and its .bat, .csh, .fish, .nu, .ps1 and _this.py siblings, `deactivate.bat`
 *  and `pydoc.bat` are all mode 644 and meant to be sourced rather than executed. A broken link
 *  runs nothing either. Naming one of those to the solver is naming a program it cannot call. */
function canRun(path: string): boolean {
  try {
    const entry = statSync(path);
    return entry.isFile() && (entry.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * The programs the harness installed, given by the names that run them. A location would not help,
 * because the tool tree is in neither the command's folder nor its home: a solver left to look runs
 * `ls .toolchain` or `ls ~/.toolchain`, finds nothing, and re-implements in the host's python3 what
 * the first PATH entry held all along. The list covers every program directory the tool tree has,
 * as the PATH does.
 *
 * The bound cuts alphabetically, so whatever fills the first slots decides what the solver hears
 * about. A uv-made venv puts nine unrunnable entries in front of the tree's own programs, and
 * against a bound of twenty that leaves the domain's own checkers unnamed behind `pydoc.bat`. Both
 * repairs here are facts rather than judgements about which name matters: an entry no mode lets the
 * command run is not a program it can run by name, and a cut tail is still reachable through the
 * PATH the command already carries. Ranking the survivors by what they look like would be the loop
 * choosing domain content, which is the Builder's to choose.
 */
function installedPrograms(toolTree: string | null, withheld: readonly string[]): string {
  const closed = new Set(withheld.flatMap((path) => canonicalForms(path)));
  // The same directories the command's PATH holds, in its order, so the first entry of a name here
  // is the one a bare name would actually run.
  const dirs = toolTree === null ? [] : toolTreeSearchDirs(toolTree);
  const names = [
    ...new Set(
      dirs.flatMap((dir) =>
        readdirSync(dir)
          .sort(compareCodeUnits)
          .filter((name) => canRun(join(dir, name)))
          .filter((name) => !canonicalForms(join(dir, name)).some((form) => closed.has(form))),
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
 * entry is left behind rather than the batch refused, because refusing the batch discards a source
 * edit together with whatever oversized thing arrived beside it. An own path the draft cannot carry
 * keeps its previous text, since dropping it would read as a deletion the command never asked for,
 * while an own path absent from disk is a deletion the command did mean. Sizes are measured
 * JSON-escaped, because that is how the apply frame carries them.
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

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
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

/** Pi's own local launch under `/bin/sh`, recording whether its timer cut the command. */
function launch() {
  const local = createLocalBashOperations({ shellPath: "/bin/sh" });
  let cut = false;
  const operations = {
    exec: (command, cwd, options) =>
      local.exec(command, cwd, options).catch((error: unknown) => {
        cut = asError(error).message.startsWith("timeout:");
        throw error;
      }),
  } satisfies BashOperations;
  return { operations, cut: () => cut };
}

export function createBuiltBashTool({
  policy,
  port,
  home,
  publicResourceFiles = 0,
  toolTree = null,
  withheld = [],
  guardEnv = Bun.env,
  safeguardContext,
  timeouts = DEFAULT_HARNESS_SETTINGS,
}: BuiltBashOptions): AgentTool {
  // Only the description is read from this instance; each command gets its own tool below.
  const base = createBashTool(home);
  // What the session home already holds, stated once because the shell is the only tool that can
  // read it and the folder sits inside the home WALLS has already introduced.
  const publicFolder = ` Your home directory already holds this task as public/task.json${publicResourceFiles === 0 ? "" : ` and this domain's public rules under public/resources/ (${publicResourceFiles} file${publicResourceFiles === 1 ? "" : "s"})`}.`;
  return {
    label: base.label,
    name: BUILT_BASH_TOOL,
    parameters: shellParameters(timeouts),
    description: `${base.description}${port === null ? SCRATCH_FOLDER : draftFolder(port.root)}${WALLS}${runtimeProcess.platform === "darwin" ? BSD_TOOLS : ""}${publicFolder}${installedPrograms(toolTree, withheld)} ${BUILT_SHELL_RULES.join(" ")}`,
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
      // The Builder's own guard is asked here too (operator decision), so one set of rules answers
      // both sides; the description states them, so a refusal surprises nobody.
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
        const isolation = commandIsolationPolicy(policy, { work, home, temp, toolTree, withheld });
        const store = join(home, SHELL_OUTPUT_DIR);
        mkdirSync(store, { recursive: true, mode: 0o700 });
        const { operations, cut } = launch();
        const shell = createBashTool(work, {
          operations,
          // Only the isolation's variables, so no provider credential and no Pi session variable
          // reaches the command.
          exposeSessionEnvironment: false,
          spawnHook: (spawn) => ({
            command: stageCommandIsolation(isolation, join(outer, "isolation.sb"), spawn.command),
            cwd: work,
            env: isolation.environment,
          }),
          tempDir: store,
        });
        const asked = Math.max(1, Math.floor(timeout ?? timeouts.shellDefaultSeconds));
        // A passed timeout may only raise the default, never lower it. A solver that passes a short
        // timeout beside a much longer inner one cuts its own search budget short and then fails
        // for want of it; the clause above says so and gets the same short value again, so the
        // floor is enforced here rather than left to advice.
        const seconds = Math.min(Math.max(asked, timeouts.shellDefaultSeconds), timeouts.shellMaxSeconds);
        // Pi returns a non-zero exit as an error result and throws on a cut or a cancellation; both
        // become one failed outcome, so the files the command wrote before failing are still
        // collected before the call fails.
        const outcome = await shell.execute(callId, { command, timeout: seconds }, signal, onUpdate).then(
          (result: AgentToolResult<BashToolDetails | undefined>) => ({
            failed: result.isError === true,
            text: resultText(result),
            details: result.details,
          }),
          (error: unknown) => ({ failed: true, text: asError(error).message, details: null }),
        );
        const reported =
          shellReport(outcome.text, store) + shellBudgetClause(cut(), asked, seconds, timeouts);
        if (port === null) {
          if (outcome.failed) throw new Error(reported);
          return { content: [{ type: "text", text: reported }], details: outcome.details ?? null };
        }
        const tree = readTree(answer, before);
        await port.applyFiles(tree.files);
        const text = `${reported}\n\n${fileLine(tree)}`;
        if (outcome.failed) throw new Error(text);
        return {
          content: [{ type: "text", text }],
          details: { ...outcome.details, fileCount: Object.keys(tree.files).length },
        };
      } finally {
        rmSync(outer, { recursive: true, force: true });
      }
    },
  };
}
