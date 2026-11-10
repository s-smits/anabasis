/**
 * The hook the `wri-lane` agent type (`.claude/agents/wri-lane.md`) runs before each of its tool
 * calls: it refuses a write anywhere but the lane's own report, the synthesis or the across note, a
 * shell command that would spend, start a seat, move a campaign or run inside one, and a read of an
 * env file. Everything else passes.
 *
 * The hard rules of a whole-run investigation ("never write under the campaign's folder", "start no
 * solve, session, round or check run", `AGENTS.md` section 10 item 5) were text in every lane prompt
 * until 4 November 2026, and a lane session kept them by reading them. The operator asked for a Claude
 * agent type of its own for the lanes, so the rules a tool call can break are now refused in code,
 * and the prompt keeps only those a call cannot show (quote nothing behind the walls). A refusal
 * names its reason, so a lane that needed the call says so in its report.
 *
 * On 7 November 2026 a lane ran kept harness programs with Python from Bash inside a stopped
 * campaign's folder, which left `__pycache__` in three of its `states/` trees, and an audit of
 * `refusalOf` found interpreters, `perl -i`, `tar -C`, redirects into the investigation's gate files,
 * two writing steps of the primary and every `.env.*` but two let through. So a command now runs
 * nowhere inside a campaign, an interpreter names no campaign path, Python runs with its bytecode
 * off, a shell write under `.ana/wri/` reaches only what the Write tool may, and every `.env*` file
 * but a committed `*.example` is closed. It stays a list of protected roots, never a reader of what
 * a program does.
 *
 * On 10 November an escaped quote inside double quotes, the words after a substitution's `)`, a `sed`
 * or `awk` program that only matched a campaign's path and `command -v python3` were refused as reads
 * of a campaign. Replayed over the 11,853 Bash commands of lane sessions from 3 to 10 November, run
 * from the checkout, the guard as it stood refused 2,079 and now refuses 2,014: 71 read-only commands
 * pass that did not (47 read as a kept program, 22 as an interpreter naming a campaign, 2 as Python),
 * and 6 Python commands without `-B`, which a misread quote had hidden, are refused that were not.
 */
import { realpathSync } from "../../src/meta/filesystem.ts";
import { capturedJsonParse } from "../../src/meta/json-runtime.ts";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import { homedir, tmpdir } from "../../src/meta/os.ts";
import { basename, resolve } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";

/** The fields of a tool call's input the guard reads, each unparsed until it is read. */
interface Input {
  readonly file_path?: unknown;
  readonly notebook_path?: unknown;
  readonly path?: unknown;
  readonly glob?: unknown;
  readonly command?: unknown;
}

/** Where a line stands as one of its commands runs, and the names it set before it. */
interface Scope {
  readonly cwd: string;
  readonly known: ReadonlyMap<string, string>;
}

/**
 * A lane writes its report, the synthesis session its note and the across session (WRI2P2's
 * `across` step) `cross-domain.md`, each inside an investigation.
 */
const WRITABLE = /\/\.ana\/wri\/[^/]+\/(?:lanes\/\d{2}[a-z]?-report\.md|synthesis\.md|cross-domain\.md)$/u;

/** The investigations and cycles, whose every other file is the primary's or a gate's. */
const INVESTIGATIONS = /\/\.ana\/wri(?:\/|$)/u;

/** Scratch a lane keeps for itself, which the hard rules put in a temporary directory of its own. */
const SCRATCH = [tmpdir(), realpathSync(tmpdir()), "/tmp", "/private/tmp"];

/** A Claude Code job's own temporary folder, where 37 lane writes of 4 November kept their scratch. */
const JOB_SCRATCH = /\/\.claude[^/]*\/jobs\/[^/]+\/tmp\//u;

/** Scripts whose run spends, starts a seat or a solve, or writes a campaign's log. */
const CAMPAIGN = new Set([
  "harness-builder.ts",
  "live-seat.ts",
  "live-solve.ts",
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

/**
 * `tools/c/rejections.ts` appends `verdict` events to a campaign's log and writes label packets, so it
 * is matched by its folder: a name alone would also refuse the read-only `tools/wri/rejections.ts`.
 */
const LOGS_VERDICTS = "/tools/c/rejections.ts";

/** The verbs of the run CLI that change a run's life, and the investigation's steps the primary owns. */
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

/** Git verbs that change a tree, a branch or a remote; `stash` and `worktree` only past `list`. */
const GIT =
  /^(?:commit|push|pull|checkout|switch|reset|rebase|merge|cherry-pick|revert|am|apply|add|rm|mv|restore|clean|stash|worktree)$/u;

/** A path under a campaign: its log, its kept harnesses, its exam, or an archived run. */
const CAMPAIGN_PATH =
  /(?:^|\/)(?:\.ana\/d2|data\/runs)(?:\/|$)|\/states\/|\/exams\/|\/\.ana\/wri\/[^/]+\/snapshot\//u;

/** The same paths inside a program's text, where a quote, a space, `=` or `(` may stand before one. */
const NAMES_CAMPAIGN =
  /(?:^|[\s"'=(/])(?:\.ana\/d2|data\/runs)(?:[/\s"')]|$)|\/states\/|\/exams\/|\/\.ana\/wri\/[^/]+\/snapshot\//u;

/** A word that names an env file, alone, as a path, a glob or a flag's value, but no `*.example`. */
const ENV_FILE = /(?:^|[/=<])\.env(?![^/]*\.example$)[^/]*$/u;

/** Words that run the command after them: a wrapper, with its flags and a count or a duration. */
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

/** Programs that run code a word gives them, or a file of it, and may write wherever that code says. */
const INTERPRETER =
  /^(?:python[\d.]*|pypy[\d.]*|pytest|perl[\d.]*|ruby|node|deno|php|Rscript|julia|lua|osascript)$/u;

/** Python and its test runner, which leave `__pycache__` beside every module they import. */
const PYTHON = /^(?:python[\d.]*|pypy[\d.]*|pytest)$/u;

/** A file a program runs: a script, which a kept harness keeps in `.toolchain/`. */
const SCRIPT = /\.(?:[cm]?[jt]sx?|py|pl|rb|sh|bash|zsh|php|lua|r)$/iu;

/** The flags that move a command into a directory: `git -C`, `tar -C`, `make -C`, `bun --cwd`. */
const DIR_FLAGS = new Set(["-C", "--cwd", "--directory", "--chdir", "--work-tree", "--git-dir"]);

/** The flags whose value is inline code, for `bun`, `sed`, `perl` and `ruby`. */
const CODE_FLAGS = new Set(["-e", "--eval", "-p", "--print", "-E"]);

/** The characters a backslash escapes inside double quotes; before any other it stands for itself. */
const ESCAPED = new Set(['"', "\\", "$", "`", "\n"]);

/** A `sed` command that writes or runs what follows it: `w`, `W`, `e`, or an `s` command's `w` flag. */
const SED_ACTS = /(?:^|[^A-Za-z0-9])[gpiIMm0-9]*[wWe](?:\s+|$)([^;\n}]*)/gu;

/** What passes instead of a refused call, from the allowed cases of `test/wri-lane-guard.test.ts`: a lane
 *  retried one refused call five times over on 8 November. */
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
  [
    "a command that logs verdicts",
    "read each rejection with `bun tools/wri/rejections.ts <log>`, which writes nothing",
  ],
  ["a write under a campaign", "write scratch under a temporary directory of the lane's own"],
  ["a write to the primary's files", "write scratch under a temporary directory of the lane's own"],
  ["a write outside the lane's report", "write scratch under a temporary directory of the lane's own"],
]);

/**
 * The simple commands a shell line runs, each as its words, with every heredoc's body dropped and
 * quotes removed: until 4 November 2026 the guard matched patterns against the whole text, and in a
 * replay of 72 lane sessions it refused 246 of 7,710 calls, nearly all a report's heredoc naming a
 * command, a `grep` of a script's source, a copy out of a campaign or `git merge-base`.
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
    // `<<<` is a here-string, which ends on its own line.
    body = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1/u.exec(row)?.[2] ?? null;
  }
  const text = kept.join("\n");
  const commands: string[][] = [[]];
  // What a substitution runs is read as commands of its own, after the line's, and stands in its
  // word as `$()`: until 10 November its `)` began a command, so a path after it was read as a program.
  const inner: string[][] = [];
  let word: string | null = null;
  const flush = () => {
    if (word !== null) commands.at(-1)?.push(word);
    word = null;
  };
  /** Reads a double-quoted part from `from` and returns where its closing quote stands. */
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
      // An escaped quote stays inside the word: until 10 November it closed it, and a `jq` filter's
      // `\"` turned the log path after it into a command, which 9 lane refusals of 3 to 9 November read.
      at = quoted(at + 1);
    } else if (char === "\\") {
      word = (word ?? "") + next;
      at += 1;
    } else if ((char === "$" || char === "<" || char === ">") && next === "(") {
      at = substitute(at + 2);
    } else if (char === ">") {
      flush();
      // `>&2` and `2>&1` move a stream and name no file.
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

/** Where the parenthesis opened just before `from` closes, past quotes and nested pairs. */
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

/** Where a double-quoted word opened just before `from` closes. */
function quoteEnd(text: string, from: number): number {
  for (let at = from; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === "\\") at += 1;
    else if (char === '"') return at;
    else if (char === "$" && text.charAt(at + 1) === "(") at = closing(text, at + 2);
  }
  return text.length;
}

/** A word as the path it names from where the line stands, with `~` as the home folder. */
function pathOf(word: string, cwd: string): string {
  return resolve(cwd, word.startsWith("~") ? `${homedir()}${word.slice(1)}` : word);
}

/** Why a write to this path is refused: a campaign's folder, or a file of the investigation's own. */
function writeRefusal(path: string): string | null {
  if (CAMPAIGN_PATH.test(path)) return "a write under a campaign";
  return INVESTIGATIONS.test(path) && !WRITABLE.test(path) ? "a write to the primary's files" : null;
}

/** The files an in-place edit rewrites: every plain word but its program, unless a flag names that. */
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

/** The directories a command moves into before it runs: by a flag, or each one `find -execdir` visits. */
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
 * Why a program is refused for what it runs: one kept in a campaign, an interpreter given a
 * campaign's path or code naming one, or Python with its bytecode on.
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
  // An interpreter's every word is read, but a file on standard input is named to the shell alone.
  // `bun`, `sed` and `awk` take campaign files as data, so only their program's text is read.
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
 * Whether a `sed` or `awk` program writes to or runs a campaign's path, rather than only matching it:
 * sed's writing commands, and awk's `>`, `|` or `system(`. Until 10 November any campaign path in
 * the program was refused, and 5 lane refusals of 3 to 9 November were a `sed` that cut a campaign's
 * folder out of a listing.
 */
function actsOn(tool: string, program: string): boolean {
  if (tool !== "sed") return /[>|]|system\s*\(/u.test(program);
  return [...program.matchAll(SED_ACTS)].some(([, target = ""]) => NAMES_CAMPAIGN.test(` ${target}`));
}

/** Why one simple command's writes are refused, from the paths the shell and the tool's flags name. */
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

/** What a `tar` writes: the archive it creates, or the directory it extracts into. */
function tarWrites(rest: readonly string[], cwd: string): string[] {
  // The mode is a cluster of letters, bare as the first word or after a dash, or a long flag.
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

/** Why one simple command is refused, given where the line stands and what it set. */
function commandRefusal(words: readonly string[], scope: Scope): string | null {
  const args = words.filter((word, index) => word !== ">" && words[index - 1] !== ">");
  const head = args.findIndex(
    (word) => !/^\w+=/u.test(word) && !WRAPPERS.has(basename(word)) && !/^-|^\d+[smhd]?$/u.test(word),
  );
  // Assignments alone run no program, nor does `command -v` (or `-V`), which names where one is; a
  // redirect beside either still writes.
  const names = args
    .slice(0, head)
    .some((word, at) => word === "command" && /^-[vV]$/u.test(args[at + 1] ?? ""));
  if (head === -1 || names) return writesRefusal(words, "", [], scope.cwd);
  const [name = "", ...rest] = args.slice(head);
  const plain = rest.filter((word) => !word.startsWith("-"));
  const tool = basename(name);
  const inside = (dir: string) => CAMPAIGN_PATH.test(`${pathOf(dir, scope.cwd)}/`);
  // A `cd` may always leave; what runs after it is read from where it went.
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
    // A flag's value, as `--cwd <dir>`, may stand before the script, so every plain word is read.
    if (plain.some((word) => CAMPAIGN.has(basename(word)))) return "a campaign command";
    if (plain.some((word) => pathOf(word, scope.cwd).endsWith(LOGS_VERDICTS))) {
      return "a command that logs verdicts";
    }
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

/** Why a shell line is refused: an env file named anywhere it runs, or the first refused command. */
function refusalOfLine(line: string, start: string): string | null {
  const known = new Map<string, string>();
  let cwd = start;
  for (const raw of commandsOf(line)) {
    // `$NAME` takes a value set earlier on the line, or the hook's own environment.
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

/** Why the call is refused, or null where it may run, from the session's working directory. */
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
