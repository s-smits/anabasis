/**
 * The hook the `wri-lane` agent type (`.claude/agents/wri-lane.md`) runs before each of its tool
 * calls: it refuses a write anywhere but the lane's own report or the synthesis, a shell command that
 * would spend, start a seat or move a campaign, and a read of an env file. Everything else passes.
 *
 * The hard rules of a whole-run investigation ("never write under the campaign's folder", "start no
 * solve, session, round or check run", `AGENTS.md` section 10 item 5) were text in every lane prompt
 * until 4 November 2026, and a lane session kept them by reading them. The operator asked for a Claude
 * agent type of its own for the lanes, so the rules a tool call can break are now refused in code,
 * and the prompt keeps only those a call cannot show (quote nothing behind the walls). A refusal
 * names its reason, so a lane that needed the call says so in its report.
 */
import { realpathSync } from "../../src/meta/filesystem.ts";
import { capturedJsonParse } from "../../src/meta/json-runtime.ts";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { basename, resolve } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";

/** The fields of a tool call's input the guard reads, each unparsed until it is read. */
interface Input {
  readonly file_path?: unknown;
  readonly notebook_path?: unknown;
  readonly command?: unknown;
}

/** A lane writes its report, and the synthesis session its note, both inside an investigation. */
const WRITABLE = /\/\.ana\/wri\/[^/]+\/(?:lanes\/\d{2}-report\.md|synthesis\.md)$/u;

/** Scratch a lane keeps for itself, which the hard rules put in a temporary directory of its own. */
const SCRATCH = [tmpdir(), realpathSync(tmpdir()), "/tmp", "/private/tmp"];

/** A Claude Code job's own temporary folder, where 37 lane writes of 4 November kept their scratch. */
const JOB_SCRATCH = /\/\.claude[^/]*\/jobs\/[^/]+\/tmp\//u;

/** Scripts whose run spends, starts a seat or a solve, or writes a campaign's log. */
const CAMPAIGN = new Set([
  "harness-builder.ts",
  "live-seat.ts",
  "word.ts",
  "promote.ts",
  "settle.ts",
  "accept.ts",
]);

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
  "on",
]);
const PRIMARY = new Set(["start", "lanes", "collect", "synthesis", "derive"]);

/** Git verbs that change a tree, a branch or a remote; `stash` and `worktree` only past `list`. */
const GIT =
  /^(?:commit|push|checkout|switch|reset|rebase|merge|cherry-pick|revert|am|apply|add|rm|mv|restore|clean|stash|worktree)$/u;

/** A path under a campaign: its log, its kept harnesses, its exam, or an archived run. */
const CAMPAIGN_PATH = /(?:^|\/)(?:\.ana\/d2|data\/runs)(?:\/|$)|\/states\/|\/exams\//u;

/** A word that names an env file, alone, as a path or as a flag's value. */
const ENV_FILE = /(?:^|[/=])\.env(?:\.runs)?$/u;

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
    body = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/u.exec(row)?.[2] ?? null;
  }
  const text = kept.join("\n");
  const commands: string[][] = [[]];
  let word: string | null = null;
  const flush = () => {
    if (word !== null) commands.at(-1)?.push(word);
    word = null;
  };
  for (let at = 0; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === "'" || char === '"') {
      const close = text.indexOf(char, at + 1);
      word = (word ?? "") + text.slice(at + 1, close === -1 ? undefined : close);
      at = close === -1 ? text.length : close;
    } else if (char === "\\") {
      word = (word ?? "") + text.charAt(at + 1);
      at += 1;
    } else if (char === ">") {
      flush();
      // `>&2` and `2>&1` move a stream and name no file.
      if (text.charAt(at + 1) === ">") at += 1;
      if (text.charAt(at + 1) === "&") at += 2;
      else commands.at(-1)?.push(">");
    } else if (/[\s;&|()`]/u.test(char) || (char === "$" && text.charAt(at + 1) === "(")) {
      flush();
      if (char !== " " && char !== "\t") commands.push([]);
    } else {
      word = (word ?? "") + char;
    }
  }
  flush();
  return commands.filter((words) => words.length > 0);
}

/** Why one simple command is refused, given the directory the line has moved to. */
function commandRefusal(words: readonly string[], cwd: string): string | null {
  const writes = words.flatMap((word, index) => (words[index - 1] === ">" ? [word] : []));
  const args = words.filter((word, index) => word !== ">" && words[index - 1] !== ">");
  const head = args.findIndex(
    (word) => !/^\w+=/u.test(word) && !["nohup", "time", "env", "exec", "command"].includes(word),
  );
  const [name = "", ...rest] = args.slice(head);
  const plain = rest.filter((word) => !word.startsWith("-"));
  const tool = basename(name);
  if (["bash", "sh", "zsh"].includes(tool) && rest.includes("-c")) {
    return refusalOfLine(rest.at(rest.indexOf("-c") + 1) ?? "");
  }
  if (tool === "claude" || tool === "codex") return "a paid session";
  if (tool === "bun") {
    const [script = "", verb = ""] = plain[0] === "run" ? plain.slice(1) : plain;
    if (CAMPAIGN.has(basename(script))) return "a campaign command";
    if (script.includes("compare-systems") || basename(script) === "gpt-sessions.ts") return "a paid session";
    if ((script === "runs" || script.endsWith("runs/cli.ts")) && LIFE.has(verb)) return "a run's life";
    if (basename(script) === "wri.ts" && PRIMARY.has(verb)) return "the primary's step";
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
  if (tool === "tee") writes.push(...plain);
  if (["cp", "mv", "ln", "rsync", "install"].includes(tool)) writes.push(...plain.slice(-1));
  if (["rm", "trash", "rmdir", "touch", "mkdir", "truncate"].includes(tool)) writes.push(...plain);
  if (tool === "sed" && rest.some((word) => word.startsWith("-i"))) {
    // The script is the first plain word unless `-e` or `-f` names it; `-i ''` leaves an empty one.
    const named = rest.includes("-e") || rest.includes("-f");
    const files = rest.filter(
      (word, index) => word !== "" && !word.startsWith("-") && !["-e", "-f"].includes(rest[index - 1] ?? ""),
    );
    writes.push(...(named ? files : files.slice(1)));
  }
  return writes.some((path) => CAMPAIGN_PATH.test(path.startsWith("/") ? path : `${cwd}/${path}`))
    ? "a write under a campaign"
    : null;
}

/** Why a shell line is refused: an env file named anywhere it runs, or the first refused command. */
function refusalOfLine(line: string): string | null {
  const known = new Map<string, string>();
  let cwd = "";
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
      if (key !== undefined && value !== undefined && words.length === 1) known.set(key, value);
    }
    if (words[0] === "cd") cwd = words[1]?.startsWith("/") === true ? words[1] : `${cwd}/${words[1] ?? ""}`;
    const why = commandRefusal(words, cwd);
    if (why !== null) return why;
  }
  return null;
}

/** Why the call is refused, or null where it may run. */
export function refusalOf(tool: string, input: Input): string | null {
  const path = [input.file_path, input.notebook_path].find(isString);
  if (tool === "Read") {
    return path !== undefined && /^\.env(?:\.runs)?$/u.test(basename(path)) ? "an env file" : null;
  }
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const at = path === undefined ? "" : resolve(path);
    return WRITABLE.test(at) || SCRATCH.some((root) => at.startsWith(`${root}/`)) || JOB_SCRATCH.test(at)
      ? null
      : "a write outside the lane's report";
  }
  return tool === "Bash" && isString(input.command) ? refusalOfLine(input.command) : null;
}

// Exit 2 with the reason on stderr is the refusal a subagent's own hook is documented to give.
if (import.meta.main) {
  const call: unknown = capturedJsonParse(await Bun.stdin.text());
  const input = isRecord(call) && isRecord(call.tool_input) ? call.tool_input : {};
  const why = isRecord(call) && isString(call.tool_name) ? refusalOf(call.tool_name, input) : null;
  if (why !== null) {
    console.error(
      `wri-lane refuses ${why}: a lane reads, and writes its own report only (whole-run-investigation, "Hard rules"). Say in the report what this call would have settled.`,
    );
    runtimeProcess.exitCode = 2;
  }
}
