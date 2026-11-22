/**
 * Pre-tool hook for the `wri-lane` agent type (`.claude/agents/wri-lane.md`).
 *
 * Blocks writes outside the lane's own report, `synthesis.md`, `cross-domain.md`, or scratch
 * directories; blocks shell commands that incur model spend, launch a seat, mutate a campaign or
 * execute inside a campaign directory; and blocks reads of `.env` files. All other calls pass.
 *
 * Enforcing the hard rules of a whole-run investigation in code ("never write under the campaign's
 * folder", "start no solve, session, round or check run", `AGENTS.md` section 10 item 5) keeps the
 * lane prompt focused on rules that cannot be checked syntactically (such as the no-quote wall).
 * Every refusal states its reason and an allowed alternative so the lane can either use the
 * read-only path or record what the blocked call would have settled.
 *
 * Executing kept harness programs with Python inside a campaign folder leaves `__pycache__`
 * directories under `states/`, and direct interpreter invocations, `perl -i`, `tar -C`, shell
 * redirects into gate files, and `.env.*` reads can bypass narrower filters. Accordingly, no
 * command may run inside a campaign directory, no interpreter may take a campaign path as an
 * argument, Python must run with bytecode disabled (`-B` or `PYTHONDONTWRITEBYTECODE=1`), shell
 * writes under `.ana/wri/` are restricted to the same targets as the `Write` tool, and every
 * `.env*` file except a committed `*.example` is blocked.
 *
 * The shell lexer handles escaped quotes inside double quotes, tokens following `$()` command
 * substitutions, `sed` or `awk` programs that merely match a campaign path without writing or
 * executing it, and `command -v python3` lookups, validated by replay across recorded lane
 * sessions.
 */
import { realpathSync } from "../../src/meta/filesystem.ts";
import { capturedJsonParse } from "../../src/meta/json-runtime.ts";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import { homedir, tmpdir } from "../../src/meta/os.ts";
import { basename, resolve } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";

/** Tool-input fields inspected by the guard before narrowing. */
interface Input {
  readonly file_path?: unknown;
  readonly notebook_path?: unknown;
  readonly path?: unknown;
  readonly glob?: unknown;
  readonly command?: unknown;
}

/** Evaluation state for a command in a shell line: working directory and prior variable bindings. */
interface Scope {
  readonly cwd: string;
  readonly known: ReadonlyMap<string, string>;
}

/** Allowed output paths inside `.ana/wri/<investigation>/`: lane reports, synthesis, and cross-domain notes. */
const WRITABLE = /\/\.ana\/wri\/[^/]+\/(?:lanes\/\d{2}[a-z]?-report\.md|synthesis\.md|cross-domain\.md)$/u;

/** Investigation and cycle directories under `.ana/wri/`, whose other files belong to the primary session or gates. */
const INVESTIGATIONS = /\/\.ana\/wri(?:\/|$)/u;

/** System temporary directories where a lane may write scratch files. */
const SCRATCH = [tmpdir(), realpathSync(tmpdir()), "/tmp", "/private/tmp"];

/** Per-job temporary directory allocated by Claude Code for a lane session. */
const JOB_SCRATCH = /\/\.claude[^/]*\/jobs\/[^/]+\/tmp\//u;

/** Entry-point scripts that incur spend, launch a seat or solve, or mutate a campaign log. */
const CAMPAIGN = new Set([
  "harness-builder.ts",
  "live-seat.ts",
  "word.ts",
  "promote.ts",
  "settle.ts",
  "accept.ts",
  "round.ts",
  "session.ts",
  "examine.ts",
  "draft.ts",
  "import.ts",
  "prepare.ts",
  "checkpoint.ts",
  "republish.ts",
]);

/** Run CLI verbs that mutate a run's lifecycle, and investigation steps owned by the primary session. */
const LIFE = new Set([
  "launch",
  "fresh",
  "continue",
  "keep",
  "move",
  "stop",
  "pause",
  "retire",
  "copy",
  "rehearse",
  "seed",
  "fetch",
  "on",
]);
const PRIMARY = new Set(["start", "lanes", "collect", "synthesis", "derive", "packets", "index"]);

/** Git subcommands that mutate the working tree, branches, or remotes (`stash` and `worktree` except `list`/`show`). */
const GIT =
  /^(?:commit|push|pull|checkout|switch|reset|rebase|merge|cherry-pick|revert|am|apply|add|rm|mv|restore|clean|stash|worktree)$/u;

/** Protected campaign paths: live logs, kept harnesses, staged exams, archived runs, and WRI snapshots. */
const CAMPAIGN_PATH =
  /(?:^|\/)(?:\.ana\/d2|data\/runs)(?:\/|$)|\/states\/|\/exams\/|\/\.ana\/wri\/[^/]+\/snapshot\//u;

/** Campaign path pattern inside inline code strings, preceded by whitespace, quotes, `=`, `(`, or `/`. */
const NAMES_CAMPAIGN =
  /(?:^|[\s"'=(/])(?:\.ana\/d2|data\/runs)(?:[/\s"')]|$)|\/states\/|\/exams\/|\/\.ana\/wri\/[^/]+\/snapshot\//u;

/** Token matching a `.env*` file (bare, path, glob, or flag value), excluding `*.example`. */
const ENV_FILE = /(?:^|[/=<])\.env(?![^/]*\.example$)[^/]*$/u;

/** Command-prefix wrappers whose trailing arguments specify the actual executed command. */
const WRAPPERS = new Set([
  "nohup",
  "time",
  "env",
  "exec",
  "command",
  "timeout",
  "caffeinate",
  "nice",
  "xargs",
  "sudo",
]);

/** Language runtimes that execute code from a file or inline argument and can write arbitrarily. */
const INTERPRETER =
  /^(?:python[\d.]*|pypy[\d.]*|pytest|perl[\d.]*|ruby|node|deno|php|Rscript|julia|lua|osascript)$/u;

/** Python executables and test runners, which write `__pycache__` beside imported modules unless `-B` is set. */
const PYTHON = /^(?:python[\d.]*|pypy[\d.]*|pytest)$/u;

/** File extensions treated as executable scripts (such as programs under a kept harness's `.toolchain/`). */
const SCRIPT = /\.(?:[cm]?[jt]sx?|py|pl|rb|sh|bash|zsh|php|lua|r)$/iu;

/** Flags that change a command's working directory (`git -C`, `tar -C`, `make -C`, `bun --cwd`). */
const DIR_FLAGS = new Set(["-C", "--cwd", "--directory", "--chdir", "--work-tree", "--git-dir"]);

/** Flags whose argument is inline code (`bun`, `sed`, `perl`, and `ruby`). */
const CODE_FLAGS = new Set(["-e", "--eval", "-p", "--print", "-E"]);

/** Characters escaped by a preceding backslash inside double quotes. */
const ESCAPED = new Set(['"', "\\", "$", "`", "\n"]);

/** `sed` commands that write files or execute subshells (`w`, `W`, `e`, or `s///w`). */
const SED_ACTS = /(?:^|[^A-Za-z0-9])[gpiIMm0-9]*[wWe](?:\s+|$)([^;\n}]*)/gu;

/** Actionable read-only alternatives suggested when a call is blocked, preventing retry loops. */
const INSTEAD = new Map([
  [
    "a command run inside a campaign",
    "name its files by absolute path from outside it, which any reader may",
  ],
  [
    "an interpreter naming a campaign",
    "pass a campaign's file on standard input (`python3 -B x.py < <file>`), or read it with `jq`, `grep` or `sed -n`",
  ],
  [
    "a program kept in a campaign",
    "read its source by path with `cat`, `grep` or `sed -n`; it runs only in a solve",
  ],
  ["a write under a campaign", "write scratch under a temporary directory of the lane's own"],
  ["a write to the primary's files", "write scratch under a temporary directory of the lane's own"],
  ["a write outside the lane's report", "write scratch under a temporary directory of the lane's own"],
]);

/**
 * Splits a shell line into simple commands (each as an array of unquoted tokens), stripping heredoc
 * bodies so patterns are not matched against report prose, `grep` arguments, or read-only copies.
 */
function commandsOf(line: string): string[][] {
  const kept: string[] = [];
  let body: string | null = null;
  for (const row of line.split("\n")) {
    if (body !== null) {
      if (row.trim() === body) body = null;
      continue;
    }
    kept.push(row);
    // `<<<` is a single-line here-string rather than a multi-line heredoc.
    body = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1/u.exec(row)?.[2] ?? null;
  }
  const text = kept.join("\n");
  const commands: string[][] = [[]];
  // Extract command substitutions as separate simple commands and replace them inline with `$()`
  // so trailing tokens after `)` remain part of the enclosing argument.
  const inner: string[][] = [];
  let word: string | null = null;
  const flush = () => {
    if (word !== null) commands.at(-1)?.push(word);
    word = null;
  };
  /** Scans a double-quoted segment starting at `from` and returns the index of its closing quote. */
  const quoted = (from: number) => {
    let at = from;
    word ??= "";
    for (; at < text.length && text.charAt(at) !== '"'; at += 1) {
      const inside = text.charAt(at);
      if (inside === "$" && text.charAt(at + 1) === "(") at = substitute(at + 2);
      else if (inside === "\\" && ESCAPED.has(text.charAt(at + 1))) {
        word += text.charAt(at + 1);
        at += 1;
      } else word += inside;
    }
    return at;
  };
  const substitute = (from: number) => {
    const close = closing(text, from);
    inner.push(...commandsOf(text.slice(from, close)));
    word = `${word ?? ""}$()`;
    return close;
  };
  for (let at = 0; at < text.length; at += 1) {
    const char = text.charAt(at);
    const next = text.charAt(at + 1);
    if (char === "'") {
      const close = text.indexOf(char, at + 1);
      word = (word ?? "") + text.slice(at + 1, close === -1 ? undefined : close);
      at = close === -1 ? text.length : close;
    } else if (char === '"') {
      // Keep escaped quotes inside the current token so `\"` in a `jq` filter does not split the line.
      at = quoted(at + 1);
    } else if (char === "\\") {
      word = (word ?? "") + next;
      at += 1;
    } else if ((char === "$" || char === "<" || char === ">") && next === "(") {
      at = substitute(at + 2);
    } else if (char === ">") {
      flush();
      // Descriptor duplications (`>&2`, `2>&1`) redirect streams without opening a file path.
      if (text.charAt(at + 1) === ">") at += 1;
      if (text.charAt(at + 1) === "&") at += 2;
      else commands.at(-1)?.push(">");
    } else if (/[\s;&|()`]/u.test(char)) {
      flush();
      if (char !== " " && char !== "\t") commands.push([]);
    } else {
      word = (word ?? "") + char;
    }
  }
  flush();
  return [...commands, ...inner].filter((words) => words.length > 0);
}

/** Finds the matching `)` for an opening parenthesis just before `from`, skipping quotes and nested pairs. */
function closing(text: string, from: number): number {
  let depth = 1;
  for (let at = from; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === "\\") at += 1;
    else if (char === "'") {
      const close = text.indexOf("'", at + 1);
      at = close === -1 ? text.length : close;
    } else if (char === '"') at = quoteEnd(text, at + 1);
    else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return text.length;
}

/** Finds the closing `"` for a double-quoted segment opened just before `from`. */
function quoteEnd(text: string, from: number): number {
  for (let at = from; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === "\\") at += 1;
    else if (char === '"') return at;
    else if (char === "$" && text.charAt(at + 1) === "(") at = closing(text, at + 2);
  }
  return text.length;
}

/** Resolves `word` against `cwd`, expanding a leading `~` to the user's home directory. */
function pathOf(word: string, cwd: string): string {
  return resolve(cwd, word.startsWith("~") ? `${homedir()}${word.slice(1)}` : word);
}

/** Returns the refusal reason if writing to `path` is forbidden (campaign path or non-report WRI file). */
function writeRefusal(path: string): string | null {
  if (CAMPAIGN_PATH.test(path)) return "a write under a campaign";
  return INVESTIGATIONS.test(path) && !WRITABLE.test(path) ? "a write to the primary's files" : null;
}

/** Extracts target file arguments from an in-place edit command (`sed -i`, `perl -i`, `awk -i inplace`). */
function inPlaceFiles(rest: readonly string[], programFlags: readonly string[]): string[] {
  const named = rest.some((word) => programFlags.includes(word));
  const files = rest.filter(
    (word, index) =>
      word !== "" &&
      word !== "inplace" &&
      !word.startsWith("-") &&
      !programFlags.includes(rest[index - 1] ?? ""),
  );
  return named ? files : files.slice(1);
}

/** Collects working directories entered via flags (`-C`, `--cwd`, etc.) or `find -execdir`. */
function dirsOf(tool: string, words: readonly string[], plain: readonly string[]): string[] {
  const dirs = words.flatMap((word, index) => {
    if (DIR_FLAGS.has(words[index - 1] ?? "")) return [word];
    const long = /^--(?:cwd|directory|chdir|work-tree|git-dir)=(.*)$/u.exec(word)?.[1];
    if (long !== undefined) return [long];
    return word.startsWith("-C/") ? [word.slice(2)] : [];
  });
  if (tool === "find" && words.includes("-execdir")) dirs.push(...plain);
  return dirs;
}

/**
 * Checks whether executing `tool` violates execution rules: running a program inside a campaign,
 * passing a campaign path or inline reference to an interpreter, or invoking Python with bytecode enabled.
 */
function runRefusal(
  tool: string,
  name: string,
  prefix: readonly string[],
  rest: readonly string[],
  scope: Scope,
): string | null {
  const kept = (word: string) => CAMPAIGN_PATH.test(pathOf(word, scope.cwd));
  if (name.includes("/") && kept(name)) return "a program kept in a campaign";
  const interpreter = INTERPRETER.test(tool);
  const plain = rest.filter((word) => !word.startsWith("-"));
  const sources = tool === "source" || tool === ".";
  const runsFiles = interpreter || sources || ["bun", "bash", "sh", "zsh"].includes(tool);
  if (runsFiles && plain.some((word) => (sources || SCRIPT.test(word)) && kept(word))) {
    return "a program kept in a campaign";
  }
  // Inspect all non-stdin arguments for general interpreters; for `bun`, `sed`, and `awk` (which
  // safely read campaign files as data), inspect only the inline program text.
  const named = interpreter
    ? rest.filter((word, index) => !word.startsWith("<") && rest[index - 1] !== "<")
    : rest.filter(
        (word, index) =>
          CODE_FLAGS.has(rest[index - 1] ?? "") ||
          word.startsWith("--eval=") ||
          (tool !== "bun" && /[\s{}()"';]/u.test(word)),
      );
  const reads = interpreter || ["bun", "sed", "awk", "gawk"].includes(tool);
  const acts = (word: string) => interpreter || tool === "bun" || actsOn(tool, word);
  if (
    reads &&
    named.some((word) => (NAMES_CAMPAIGN.test(word) && acts(word)) || (interpreter && kept(word)))
  ) {
    return "an interpreter naming a campaign";
  }
  if (!PYTHON.test(tool)) return null;
  const first = rest.findIndex((word) => !word.startsWith("-"));
  const flags = first === -1 ? rest : rest.slice(0, first);
  const off =
    prefix.some((word) => /^PYTHONDONTWRITEBYTECODE=./u.test(word)) ||
    (scope.known.get("PYTHONDONTWRITEBYTECODE") ?? "") !== "" ||
    flags.some((word) => /^-[A-Za-z]*B/u.test(word));
  return off ? null : "Python with its bytecode on (pass -B or set PYTHONDONTWRITEBYTECODE=1 on the line)";
}

/**
 * Checks whether a `sed` or `awk` program writes to or executes a campaign path (`w`, `W`, `e` in
 * `sed`; `>`, `|`, or `system(` in `awk`), allowing read-only pattern matches to pass.
 */
function actsOn(tool: string, program: string): boolean {
  if (tool !== "sed") return /[>|]|system\s*\(/u.test(program);
  return [...program.matchAll(SED_ACTS)].some(([, target = ""]) => NAMES_CAMPAIGN.test(` ${target}`));
}

/** Checks whether any output path written by a simple command targets a protected directory. */
function writesRefusal(
  words: readonly string[],
  tool: string,
  rest: readonly string[],
  cwd: string,
): string | null {
  const writes = words.flatMap((word, index) => (words[index - 1] === ">" ? [word] : []));
  const plain = rest.filter((word) => !word.startsWith("-"));
  if (tool === "tee" || tool === "sponge") writes.push(...plain);
  if (tool === "find" && rest.includes("-delete")) writes.push(...plain);
  writes.push(...words.flatMap((word) => (word.startsWith("of=") ? [word.slice(3)] : [])));
  if (["cp", "mv", "ln", "rsync", "install"].includes(tool)) writes.push(...plain.slice(-1));
  if (["rm", "trash", "rmdir", "touch", "mkdir", "truncate"].includes(tool)) writes.push(...plain);
  // `sed -i ''` leaves an empty script word, which `inPlaceFiles` drops.
  if (tool === "sed" && rest.some((word) => word.startsWith("-i"))) {
    writes.push(...inPlaceFiles(rest, ["-e", "-f"]));
  }
  if (/^(?:perl[\d.]*|ruby)$/u.test(tool) && rest.some((word) => /^-(?![MmIx])\w*i/u.test(word))) {
    writes.push(...inPlaceFiles(rest, ["-e", "-E"]));
  }
  const inplace = rest.some(
    (word, index) => word === "-iinplace" || (word === "inplace" && rest[index - 1] === "-i"),
  );
  if ((tool === "awk" || tool === "gawk") && inplace) writes.push(...inPlaceFiles(rest, ["-f"]));
  if (tool === "tar") writes.push(...tarWrites(rest, cwd));
  return writes.map((word) => writeRefusal(pathOf(word, cwd))).find((why) => why !== null) ?? null;
}

/** Returns the target paths written by a `tar` creation, update, or extraction command. */
function tarWrites(rest: readonly string[], cwd: string): string[] {
  // Match short option clusters (with or without a leading dash) and long option flags.
  const letters = rest
    .filter((word, index) => /^-[A-Za-z]+$/u.test(word) || (index === 0 && /^[A-Za-z]+$/u.test(word)))
    .join("");
  const long = rest.filter((word) => word.startsWith("--"));
  if (letters.includes("x") || long.some((word) => /^--(?:extract|get)$/u.test(word))) {
    const into = rest.includes("-C") ? (rest[rest.indexOf("-C") + 1] ?? cwd) : cwd;
    return [`${pathOf(into, cwd)}/*`];
  }
  if (!/[cru]/u.test(letters) && !long.some((word) => /^--(?:create|append|update)$/u.test(word))) return [];
  return rest.flatMap((word, index) => {
    if (word.startsWith("--file=")) return [word.slice(7)];
    const cluster = /^-?[A-Za-z]*f$/u.test(word) && (index === 0 || word.startsWith("-"));
    return cluster ? [rest[index + 1] ?? ""] : [];
  });
}

/** Checks a single simple command against all execution, lifecycle, git, and write guards. */
function commandRefusal(words: readonly string[], scope: Scope): string | null {
  const args = words.filter((word, index) => word !== ">" && words[index - 1] !== ">");
  const head = args.findIndex(
    (word) => !/^\w+=/u.test(word) && !WRAPPERS.has(basename(word)) && !/^-|^\d+[smhd]?$/u.test(word),
  );
  // Variable assignments and `command -v`/`-V` lookups execute no target binary, though redirects still write.
  const names = args
    .slice(0, head)
    .some((word, at) => word === "command" && /^-[vV]$/u.test(args[at + 1] ?? ""));
  if (head === -1 || names) return writesRefusal(words, "", [], scope.cwd);
  const [name = "", ...rest] = args.slice(head);
  const plain = rest.filter((word) => !word.startsWith("-"));
  const tool = basename(name);
  const inside = (dir: string) => CAMPAIGN_PATH.test(`${pathOf(dir, scope.cwd)}/`);
  // Permit `cd` and `pushd` out of any directory; subsequent commands are checked against the new `cwd`.
  const moves = tool === "cd" || tool === "pushd";
  if (!moves && (inside(scope.cwd) || dirsOf(tool, words, plain).some(inside))) {
    return "a command run inside a campaign";
  }
  if (["bash", "sh", "zsh"].includes(tool) && rest.includes("-c")) {
    return refusalOfLine(rest.at(rest.indexOf("-c") + 1) ?? "", scope.cwd);
  }
  if (tool === "claude" || tool === "codex") return "a paid session";
  if (tool === "find" && rest.some((word) => word === "-exec" || word === "-execdir")) {
    const at = rest.findIndex((word) => word === "-exec" || word === "-execdir");
    const why = commandRefusal(rest.slice(at + 1), scope);
    if (why !== null) return why;
  }
  if (tool === "bun") {
    // Check all positional arguments because flag values (such as `--cwd <dir>`) may precede the script name.
    if (plain.some((word) => CAMPAIGN.has(basename(word)))) return "a campaign command";
    if (plain.some((word) => word.includes("compare-systems") || basename(word) === "gpt-sessions.ts")) {
      return "a paid session";
    }
    const runs = plain.findIndex((word) => word === "runs" || word.endsWith("runs/cli.ts"));
    if (runs !== -1 && plain.slice(runs + 1).some((word) => LIFE.has(word))) return "a run's life";
    const wri = plain.findIndex((word) => basename(word) === "wri.ts");
    if (wri !== -1 && PRIMARY.has(plain[wri + 1] ?? "")) return "the primary's step";
    const loop = plain.findIndex((word) => basename(word) === "wri2p2.ts");
    if (loop !== -1 && plain[loop + 1] === "open") return "the primary's step";
  }
  if (tool === "git") {
    const verb = rest.find(
      (word, index) => !word.startsWith("-") && !["-C", "-c"].includes(rest[index - 1] ?? ""),
    );
    if (
      verb !== undefined &&
      GIT.test(verb) &&
      !["list", "show"].includes(rest[rest.indexOf(verb) + 1] ?? "")
    ) {
      return "a change to the tree";
    }
  }
  const ran = runRefusal(tool, name, args.slice(0, head), rest, scope);
  if (ran !== null) return ran;
  return writesRefusal(words, tool, rest, scope.cwd);
}

/** Evaluates a full shell command line, returning the first refusal reason or `null` if permitted. */
function refusalOfLine(line: string, start: string): string | null {
  const known = new Map<string, string>();
  let cwd = start;
  for (const raw of commandsOf(line)) {
    // Expand `$NAME` and `${NAME}` from earlier bindings on the line or the hook's environment.
    const words = raw.map((word) =>
      word.replaceAll(
        /\$\{?(\w+)\}?/gu,
        (whole, key: string) => known.get(key) ?? runtimeProcess.env[key] ?? whole,
      ),
    );
    if (words.some((word) => ENV_FILE.test(word))) return "an env file";
    for (const word of words) {
      const [, key, value] = /^(\w+)=(.*)$/u.exec(word) ?? [];
      const assigns = words.length === 1 || (words.length === 2 && words[0] === "export");
      if (key !== undefined && value !== undefined && assigns) known.set(key, value);
    }
    const why = commandRefusal(words, { cwd, known });
    if (why !== null) return why;
    if (words[0] === "cd" || words[0] === "pushd") cwd = pathOf(words[1] ?? "~", cwd);
  }
  return null;
}

/** Returns the refusal reason for a tool call in `cwd`, or `null` when the call is permitted. */
export function refusalOf(tool: string, input: Input, cwd = runtimeProcess.cwd()): string | null {
  const path = [input.file_path, input.notebook_path].find(isString);
  if (tool === "Read" || tool === "Grep" || tool === "Glob") {
    const named = [path, input.path, input.glob].filter(isString);
    return named.some((each) => ENV_FILE.test(basename(each))) ? "an env file" : null;
  }
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const at = path === undefined ? "" : resolve(cwd, path);
    return WRITABLE.test(at) || SCRATCH.some((root) => at.startsWith(`${root}/`)) || JOB_SCRATCH.test(at)
      ? null
      : "a write outside the lane's report";
  }
  return tool === "Bash" && isString(input.command) ? refusalOfLine(input.command, cwd) : null;
}

// Exit 2 with the reason on stderr is the refusal a subagent's own hook is documented to give.
if (import.meta.main) {
  const call: unknown = capturedJsonParse(await Bun.stdin.text());
  const input = isRecord(call) && isRecord(call.tool_input) ? call.tool_input : {};
  const cwd = isRecord(call) && isString(call.cwd) ? call.cwd : runtimeProcess.cwd();
  const why = isRecord(call) && isString(call.tool_name) ? refusalOf(call.tool_name, input, cwd) : null;
  if (why !== null) {
    const instead = INSTEAD.get(why);
    console.error(
      `wri-lane refuses ${why}: a lane reads, and writes its own report only (whole-run-investigation, "Hard rules").${instead === undefined ? "" : ` What passes: ${instead}.`} Say in the report what this call would have settled.`,
    );
    runtimeProcess.exitCode = 2;
  }
}
