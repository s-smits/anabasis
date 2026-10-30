#!/usr/bin/env bun
/**
 * Read recent agent sessions in this repository, grouped by the AGENTS.md each one loaded.
 *
 *   bun .claude/skills/agentsmd-backtest/scripts/sessions.ts [--hours <n>] [--root <dir>]...
 *     [--marker <text>] [--prompts <session id prefix>]
 *
 * Use it after AGENTS.md, a skill or the moments hook changes. It answers whether sessions under
 * the current text break rules more often than sessions under the earlier text did.
 *
 * Claude Code transcripts under each `--root` (default `~/.claude`) and Codex rollouts under
 * `~/.codex/sessions` that were written in the last `--hours` (default 72) are read. A Claude Code
 * transcript does not hold the AGENTS.md text it loaded, so its version is the AGENTS.md at its
 * worktree's HEAD when it started, taken from that worktree's reflog. A Codex rollout holds the
 * text, which is read directly. A version is `current` when it contains `--marker`, by default the
 * first prose line of AGENTS.md at this tree's HEAD, and `earlier` otherwise. A session that crosses
 * a `bun run follow` keeps its start's version.
 *
 * Each session prints its shell calls, edits, rule hits and the areas it entered. Areas come from
 * the moments hook's own table (`momentsOf`, `tools/runtime/moments.ts`). Each area is marked `read`
 * where its owning skill was read before the session's first call into it, and `unread` otherwise.
 * The totals put each hit per 100 shell calls on both sides. A hit is a lead that a person reads in
 * the transcript before triage, since a pattern also matches a heredoc or a read-only command.
 * `--prompts` prints one session's operator prompts with the end of the reply before each.
 *
 * Written on 30 October, after the AGENTS.md rewrite of PR #530 landed, to backtest its first day.
 * Over 24 hours 14 sessions ran under it and 43 under the earlier text. Running checks here without
 * the operator's word was the most frequent hit on both sides (2.33 and 2.48 per 100 shell calls),
 * and came from a session memory note rather than from either AGENTS.md.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { gitMaybe, mainTree } from "#src/meta/git.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { isRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { momentsOf } from "#tools/runtime/moments.ts";

const USAGE = `usage: sessions.ts [--hours <n>] [--root <dir>]... [--marker <text>] [--prompts <id>]

Recent Claude Code and Codex sessions by the AGENTS.md they loaded: rule hits per 100 shell calls,
and whether each area's owning skill was read before the first call into it.`;
const REPO = join(import.meta.dir, "..", "..", "..", "..");
const MAIN = `${mainTree(REPO)}/`;

/** Shell patterns that break a rule of AGENTS.md or the operator's machine file. */
const SHELL: readonly (readonly [string, RegExp])[] = [
  ["git-stash", /\bgit stash (push|pop|apply|drop|save)?\b(?! ?list)/u],
  ["bare-bun-test", /(^|[;&|]\s*)bun test\b/u],
  ["node-npm-npx", /(^|[;&|(]\s*)(node|npm|npx)\s/u],
  ["force-push-no-lease", /git push\b[^;&|]*(--force(?!-with-lease)|\s-f\b)/u],
  ["push-no-verify", /git push\b[^;&|]*--no-verify/u],
  ["pr-not-draft", /gh pr create\b(?![^;&|]*--draft)/u],
  ["pr-no-label", /gh pr create\b(?![^;&|]*--label)/u],
  ["em-dash-published", /(gh pr (create|edit|comment)|git commit)[^]*\u2014/u],
  ["typed-bun-path", /\.bun\/releases\/[\d.]+\/bin\/bun (run |test|check)/u],
  ["check-run-here", /RUN_REMOTE=0 bun (run )?(gate|test|typecheck|lint|secrets)\b/u],
  ["env-file-read", /\b(cat|less|head|tail|bat)\s[^|;&]*\.env\b(?!\.runs|\.example)/u],
  ["rm-not-trash", /(^|[;&|]\s*)rm\s+-[a-z]*[rf]/u],
];
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const PROTECTED = /\/(\.ana|vendor|data\/runs|node_modules)\//u;
const TRACKED = /^(src|tools|test|packages|docs|studies|\.claude\/skills)\/|^AGENTS\.md$/u;
const SKILL_READ = /\.claude\/skills\/([\w-]+)\/(SKILL\.md|references\/)/u;

interface Prompt {
  readonly at: string;
  readonly said: string;
  readonly after: string;
}

interface Session {
  readonly id: string;
  readonly kind: "claude" | "codex";
  cwd: string;
  start: number;
  agents: string;
  shell: number;
  edits: number;
  mainEdits: number;
  readonly hits: Map<string, number>;
  readonly skills: Set<string>;
  readonly areas: Map<string, "read" | "unread">;
  readonly prompts: Prompt[];
}

const fresh = (id: string, kind: Session["kind"]): Session => ({
  id,
  kind,
  cwd: "",
  start: 0,
  agents: "",
  shell: 0,
  edits: 0,
  mainEdits: 0,
  hits: new Map(),
  skills: new Set(),
  areas: new Map(),
  prompts: [],
});

const bump = (session: Session, hit: string) => session.hits.set(hit, (session.hits.get(hit) ?? 0) + 1);

/** Count one tool call against `session`: its rule hits, its edits, the areas it enters. */
function called(session: Session, name: string, input: Record<string, JsonValue>): void {
  const command = isString(input["command"]) ? input["command"] : isString(input["cmd"]) ? input["cmd"] : "";
  const path = [input["file_path"], input["notebook_path"]].find(isString) ?? "";
  if (name === "Skill" && isString(input["skill"])) session.skills.add(input["skill"]);
  const read = SKILL_READ.exec(name === "Read" ? path : command)?.[1];
  if (read !== undefined && (name === "Read" || /\b(cat|sed|head|less)\b/u.test(command))) {
    session.skills.add(read);
  }
  for (const route of momentsOf(input, new Set(session.areas.keys()))) {
    if (route.skill !== null) {
      session.areas.set(route.id, session.skills.has(route.skill) ? "read" : "unread");
    }
  }
  if (command !== "") {
    session.shell++;
    for (const [hit, pattern] of SHELL) if (pattern.test(command)) bump(session, hit);
  }
  if (!EDITS.has(name)) return;
  session.edits++;
  if (path.startsWith(MAIN) && TRACKED.test(path.slice(MAIN.length))) session.mainEdits++;
  if (PROTECTED.test(path)) bump(session, "protected-edit");
  const text = [input["new_string"], input["content"]].find(isString) ?? "";
  if (/\.(md|ts)$/u.test(path) && text.includes("\u2014")) bump(session, "em-dash-in-file");
}

const textOf = (content: JsonValue | undefined): string =>
  isString(content)
    ? content
    : Array.isArray(content)
      ? content.flatMap((part) => (isRecord(part) && isString(part["text"]) ? [part["text"]] : [])).join(" ")
      : "";

/** An operator's own words, as distinct from a resumed summary, a notice or a tool's output. */
const stamp = (value: JsonValue | undefined): string => (isString(value) ? value : "");

const ownWords = (text: string) =>
  text.trim() !== "" && !text.startsWith("This session is being continued") && !/^\s*</u.test(text);

/** One Claude Code transcript line: its cwd, tool calls and operator prompts. */
function claudeLine(session: Session, event: Record<string, JsonValue>, last: { text: string }): void {
  if (session.cwd === "" && isString(event["cwd"]) && isString(event["timestamp"])) {
    session.cwd = event["cwd"];
    session.start = Date.parse(event["timestamp"]);
  }
  const message = isRecord(event["message"]) ? event["message"] : {};
  const content = message["content"];
  const parts = event["type"] === "assistant" && Array.isArray(content) ? content : [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part["type"] === "text" && isString(part["text"]) && part["text"].trim() !== "") {
      last.text = part["text"];
    }
    if (part["type"] === "tool_use" && isString(part["name"]) && isRecord(part["input"])) {
      called(session, part["name"], part["input"]);
    }
  }
  const said = textOf(content);
  if (
    event["type"] === "user" &&
    event["isMeta"] !== true &&
    ownWords(said) &&
    !said.includes("tool_use_id")
  ) {
    session.prompts.push({ at: stamp(event["timestamp"]), said, after: last.text });
  }
}

/** One Codex rollout line: its cwd, the instructions it loaded, its shell calls and prompts. */
function codexLine(session: Session, event: Record<string, JsonValue>, marker: string): void {
  const payload = isRecord(event["payload"]) ? event["payload"] : {};
  if (event["type"] === "session_meta" && isString(payload["cwd"])) {
    session.cwd = payload["cwd"];
    session.start = Date.parse(stamp(payload["timestamp"]) || stamp(event["timestamp"]));
  }
  const text = textOf(payload["content"]);
  if (payload["type"] === "message" && text.includes("AGENTS.md") && session.agents === "") {
    session.agents = text.includes(marker) ? "current" : text.includes("# AGENTS.md") ? "earlier" : "";
  }
  if (
    payload["type"] === "message" &&
    payload["role"] === "user" &&
    ownWords(text) &&
    !text.includes("AGENTS.md")
  ) {
    session.prompts.push({ at: stamp(event["timestamp"]), said: text, after: "" });
  }
  // Codex runs its tools from one `exec` cell of code, whose text holds each command and patch.
  const cell = payload["type"] === "custom_tool_call" ? stamp(payload["input"]) : "";
  if (cell !== "") called(session, cell.includes("*** Begin Patch") ? "Edit" : "exec", { command: cell });
}

/** Each `.jsonl` under `dir`, recursively, written since `since`. */
function jsonlUnder(dir: string, since: number, depth = 3): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return depth > 0 && entry.name !== "subagents" ? jsonlUnder(path, since, depth - 1) : [];
    }
    return entry.name.endsWith(".jsonl") && statSync(path).mtimeMs >= since ? [path] : [];
  });
}

/** The AGENTS.md version a worktree held at `at`, by its reflog: `current`, `earlier` or `?`. */
function versionAt(cwd: string, at: number, marker: string): string {
  if (!existsSync(cwd)) return "?";
  const moves = (gitMaybe(cwd, "reflog", "--date=unix", "--format=%gd %H", "HEAD") ?? "").split("\n");
  const parsed = moves.flatMap((line) => {
    const found = /\{(\d+)\} (\w+)/u.exec(line);
    return found === null ? [] : [{ at: Number(found[1]) * 1000, sha: found[2] ?? "" }];
  });
  const sha = (parsed.find((move) => move.at <= at) ?? parsed.at(-1))?.sha;
  const text = sha === undefined ? null : gitMaybe(cwd, "show", `${sha}:AGENTS.md`);
  return text === null ? "?" : text.includes(marker) ? "current" : "earlier";
}

/** Every session since `since` whose worktree lies in this repository, one per id. */
function sessionsSince(roots: readonly string[], since: number, marker: string): Session[] {
  const largest = new Map<string, string>();
  const prefix = MAIN.slice(0, -1).replaceAll(/[/.]/gu, "-");
  for (const path of roots.flatMap((root) => jsonlUnder(join(root, "projects"), since, 1))) {
    const id = path.split("/").at(-1)?.replace(".jsonl", "") ?? path;
    const project = path.split("/").at(-2) ?? "";
    const held = largest.get(id);
    if (project.startsWith(prefix) && (held === undefined || statSync(held).size < statSync(path).size)) {
      largest.set(id, path);
    }
  }
  const codex = jsonlUnder(join(homedir(), ".codex", "sessions"), since).map(
    (path) => ["codex", path] as const,
  );
  return [...[...largest.values()].map((path) => ["claude", path] as const), ...codex].flatMap(
    ([kind, path]) => {
      const session = fresh(path.split("/").at(-1)?.replace(".jsonl", "").slice(-36) ?? path, kind);
      const last = { text: "" };
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (line === "") continue;
        const event = capturedJsonParse(line);
        if (!isRecord(event)) continue;
        if (kind === "claude") claudeLine(session, event, last);
        else codexLine(session, event, marker);
      }
      if (!session.cwd.startsWith(MAIN.slice(0, -1))) return [];
      if (kind === "claude") session.agents = versionAt(session.cwd, session.start, marker);
      return [session];
    },
  );
}

/** One line a session, then each version's totals with every hit per 100 shell calls. */
function sessionLines(sessions: readonly Session[]): string[] {
  const rows = [...sessions].sort((a, b) => `${a.agents}${a.start}`.localeCompare(`${b.agents}${b.start}`));
  const idle = rows.filter((s) => s.shell === 0 && s.prompts.length === 0).length;
  const lines = rows
    .filter((s) => s.shell > 0 || s.prompts.length > 0)
    .map((s) => {
      const hits = [...s.hits].map(([hit, n]) => `${hit} ${String(n)}`).join(", ");
      const areas = [...s.areas].map(([area, read]) => `${area} ${read}`).join(", ");
      const when = new Date(s.start).toISOString().slice(5, 16);
      return `${s.agents} ${s.kind} ${when} ${s.id.slice(0, 8)} ${s.cwd.split("/").at(-1) ?? ""}: ${String(s.shell)} shell, ${String(s.edits)} edits (${String(s.mainEdits)} in the main checkout); hits: ${hits || "none"}; skills read: ${[...s.skills].join(", ") || "none"}; areas: ${areas || "none"}`;
    });
  for (const version of ["current", "earlier"]) {
    const side = rows.filter((s) => s.agents === version);
    const shell = side.reduce((sum, s) => sum + s.shell, 0);
    const hits = new Map<string, number>();
    for (const s of side) for (const [hit, n] of s.hits) hits.set(hit, (hits.get(hit) ?? 0) + n);
    const rate = (n: number) => (shell === 0 ? "-" : ((100 * n) / shell).toFixed(2));
    const areas = side.flatMap((s) => [...s.areas.values()]);
    lines.push(
      `${version}: ${String(side.length)} sessions, ${String(shell)} shell calls, main-checkout edits in ${String(side.filter((s) => s.mainEdits > 0).length)}; areas entered ${String(areas.length)}, owning skill read first in ${String(areas.filter((a) => a === "read").length)}; per 100 shell calls: ${[...hits].map(([hit, n]) => `${hit} ${rate(n)}`).join(", ") || "none"}`,
    );
  }
  lines.push(`${String(idle)} sessions with no shell call and no prompt are counted above and not listed`);
  return lines;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "sessions",
      usage: USAGE,
      options: { hours: "int", root: "list", marker: "text", prompts: "text" },
    },
    (args: CommandArgs) => {
      const roots = args.list("root").length > 0 ? args.list("root") : [join(homedir(), ".claude")];
      // By default the first prose line of AGENTS.md at this tree's HEAD marks the current version.
      const marker =
        args.value("marker") ??
        (gitMaybe(REPO, "show", "HEAD:AGENTS.md") ?? "").split("\n").find((line) => /^[A-Z]\w/u.test(line)) ??
        "";
      const sessions = sessionsSince(roots, Date.now() - (args.int("hours") ?? 72) * 3_600_000, marker);
      const named = args.value("prompts");
      if (named === null) {
        console.log(sessionLines(sessions).join("\n"));
        return;
      }
      const flat = (text: string, keep: number) => text.slice(keep).replaceAll(/\s+/gu, " ");
      for (const { at, said, after } of sessions
        .filter((s) => s.id.startsWith(named))
        .flatMap((s) => s.prompts)) {
        console.log(
          `${at.slice(11, 16)} after: ...${flat(after, -200)}\n  operator: ${flat(said.slice(0, 500), 0)}`,
        );
      }
    },
  );
}
