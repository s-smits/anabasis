/**
 * The Claude Code harness tree as Harness² edits it (`harness2/core/tree.py` with the
 * `CLAUDE_CODE_SURFACE` of `harness2/substrate/claude_code.py`, both Apache-2.0, Google LLC, at
 * 1cfe254 with the fork's Claude Code commits): which paths a proposal may write, how a tree is
 * read from and written to disk, the repair that names an untriggered skill in `CLAUDE.md`, the
 * validation whose messages a rejected proposal reads back, and the install that turns a tree into
 * the layout `claude -p` discovers in a rollout's workspace. Only the Claude Code surface is here,
 * so `SurfaceSpec`'s fields are constants.
 *
 * Local changes: a script's compile check runs in one `python3` child for the whole tree instead
 * of in Harness²'s own interpreter, so it judges by that Python's grammar; a hooks file that is not
 * JSON is reported with JavaScript's parse message instead of Python's; `diversity` and the census
 * `validate` returns are left out, since at k=1 neither decides anything.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isRecord, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { runSync, decodeOutput } from "#src/meta/subprocess.ts";
import { pyDumps, pyLen, pyLstrip, pyRepr, pySlice, pyStr, pyStrip, walkFiles } from "./py.ts";

/** A harness: relative path to text, in the order it was read. */
export type Tree = Map<string, string>;

const ALWAYS_ON = "CLAUDE.md";
const ALWAYS_ON_MAX = 8000;
const HOOKS = ".claude/hooks.json";
const NAME = String.raw`[a-z0-9][a-z0-9_\-]*`;
/** Python's `\w` in a str pattern is Unicode-aware. */
const WORD = String.raw`[\p{L}\p{N}_]`;
const SKILL = new RegExp(`^\\.claude/skills/(${NAME})/SKILL\\.md$`, "u");
const SKILL_SCRIPT = new RegExp(`^\\.claude/skills/${NAME}/scripts/[A-Za-z0-9_.\\-]+$`, "u");
const SUBAGENT = new RegExp(`^sub_agents/(${NAME})/AGENT\\.md$`, "u");
const SCRIPT = /^scripts\/[a-z0-9_][a-z0-9_]*\.py$/u;
const SCRIPT_REF = new RegExp(
  `(?:python3?\\s+)((?:\\.claude/skills/(?:${WORD}|-)+/)?scripts/(?:${WORD}|[.\\-])+\\.py)`,
  "gu",
);
/** Scripts the agent may call without shipping them: JobBench's own readers (`RESERVED_SCRIPTS`). */
const RESERVED = new Set(["read_doc.py", "pack.py", "unpack.py"]);
const HOOK_EVENTS = [
  "Notification",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PreToolUse",
  "SessionEnd",
  "SessionStart",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "UserPromptSubmit",
];
const HOOK_TYPES = ["agent", "command", "prompt"];
/** The README stubs `write_tree` seeds and `read_tree` skips, verbatim from `claude_code.py`. */
const STUBS: readonly (readonly [string, string])[] = [
  [
    "scripts/README.md",
    "<!-- c7: deterministic helpers, run as `python3 scripts/<name>.py`. Add one by emitting scripts/<name>.py. -->\n",
  ],
  [
    "sub_agents/README.md",
    "<!-- c5: Claude Code subagents, invoked with the Task tool in their OWN context. Add one as sub_agents/<name>/AGENT.md with frontmatter `description:`; the runner installs it as .claude/agents/<name>.md. -->\n",
  ],
  [
    ".claude/README.md",
    '<!-- c8: Claude Code lifecycle hooks -- the only lever that acts INSIDE the tool loop, so the model cannot skip it. Add ONE file, .claude/hooks.json: {"hooks": {"PostToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "..."}]}]}}. A PostToolUse command that prints {"decision":"block","reason":"..."} feeds the reason back to the model. -->\n',
  ],
  [
    ".claude/skills/README.md",
    "<!-- c6: reusable workflows loaded on demand via the Skill tool. Add one as .claude/skills/<name>/SKILL.md with YAML frontmatter: `description:` is REQUIRED; `name:` is optional and must match the directory. Only name+description are advertised to the agent; the body is read on demand. -->\n",
  ],
];
const STUB_PATHS = new Set(STUBS.map(([rel]) => rel));
/** What `install_tree` generates itself and so never copies: settings and the agents directory. */
const GENERATED = [".claude/settings.json", ".claude/settings.local.json", ".claude/agents"];
const SKIP = ["__pycache__"];
/** `_py_compiles` for every script at once: `{rel: source}` in, `[error]` out. */
const COMPILE = `import json, sys
errs = []
for rel, src in json.load(sys.stdin).items():
    try:
        compile(src, rel, "exec")
    except (SyntaxError, ValueError) as exc:
        detail = (f"{type(exc).__name__}: {exc.msg} (line {exc.lineno})" if isinstance(exc, SyntaxError) else f"{type(exc).__name__}: {exc}")
        errs.append(f"{rel} does not compile: {detail[:160]}")
print(json.dumps(errs))`;

/** `normalize_rel`, or null where Python raises. */
function normalized(rel: string): string | null {
  let out = pyStrip(rel).replaceAll("\\", "/");
  if (out.startsWith("/") || out.split("/").includes("..")) return null;
  while (out.startsWith("./")) out = out.slice(2);
  return out.replaceAll(/^\/+|\/+$/gu, "");
}

/** `is_allowed`: whether a path is on the editable surface. */
export function isAllowed(rel: string): boolean {
  const out = normalized(rel);
  if (out === null) return false;
  return (
    out === ALWAYS_ON ||
    out === HOOKS ||
    [SKILL, SKILL_SCRIPT, SUBAGENT, SCRIPT].some((rule) => rule.test(out))
  );
}

/** `read_tree`: every file on the surface, stubs left out, and `rejected` collecting the rest. */
export function readTree(dir: string, rejected?: string[]): Tree {
  const tree: Tree = new Map();
  for (const rel of walkFiles(dir, SKIP)) {
    if (STUB_PATHS.has(rel)) continue;
    if (isAllowed(rel)) tree.set(rel, readFileSync(join(dir, rel), "utf8"));
    else rejected?.push(rel);
  }
  return tree;
}

/** `write_tree`: replace the surface files under `dest` with the tree, keeping every other file. */
export function writeTree(tree: Tree, dest: string, stubs: "stubs" | "bare" = "stubs"): string {
  mkdirSync(dest, { recursive: true });
  for (const rel of walkFiles(dest).toReversed()) {
    if (isAllowed(rel) || STUB_PATHS.has(rel)) rmSync(join(dest, rel));
  }
  if (!tree.has(ALWAYS_ON) && !existsSync(join(dest, ALWAYS_ON))) writeFileSync(join(dest, ALWAYS_ON), "");
  for (const [rel, body] of tree) {
    const path = join(dest, normalized(rel) ?? rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  for (const [rel, body] of stubs === "stubs" ? STUBS : []) {
    const path = join(dest, rel);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, body);
  }
  return dest;
}

/** `always_on_text`: one always-on file on this surface. */
export function alwaysOn(tree: Tree): string {
  return tree.get(ALWAYS_ON) ?? "";
}

function skillNames(tree: Tree): string[] {
  return [...new Set([...tree.keys()].flatMap((rel) => SKILL.exec(rel)?.[1] ?? []))].toSorted();
}

/** The `^key:\s*…$` line of a frontmatter's first 600 characters, as `re.search(..., re.M)` finds it. */
function frontmatter(body: string | undefined, rule: RegExp): RegExpExecArray | null {
  return rule.exec(pySlice(body ?? "", 0, 600));
}

/** `autotrigger`: give every skill a trigger line in `CLAUDE.md` unless that would pass the cap. */
export function autotrigger(tree: Tree): string[] {
  const fixed: string[] = [];
  for (const name of skillNames(tree)) {
    if (alwaysOn(tree).includes(name)) continue;
    const found = frontmatter(tree.get(`.claude/skills/${name}/SKILL.md`), /^description:\s*(.+)$/mu)?.[1];
    const desc = found === undefined ? `the ${name} workflow applies` : pyStrip(found).replace(/\.+$/u, "");
    const line = `- When ${desc}, use the \`${name}\` skill.\n`;
    const current = alwaysOn(tree);
    if (pyLen(current) + pyLen(line) + 2 > ALWAYS_ON_MAX) continue;
    tree.set(ALWAYS_ON, pyStrip(current) === "" ? line : `${current.trimEnd()}\n${line}`);
    fixed.push(name);
  }
  return fixed;
}

/** Whether a tree differs from its base in any file, which is `kept_base`'s negation. */
export function changedFrom(base: Tree, tree: Tree): boolean {
  return base.size !== tree.size || [...tree].some(([rel, body]) => base.get(rel) !== body);
}

function hookErrors(source: string): string[] {
  let doc: JsonValue;
  try {
    doc = capturedJsonParse(source);
  } catch (error) {
    return [`${HOOKS} is not valid JSON: ${String(error)}`];
  }
  const hooks = isRecord(doc) ? doc.hooks : undefined;
  if (!isRecord(hooks) || Object.keys(hooks).length === 0) {
    return [`${HOOKS} needs a top-level {"hooks": {"<Event>": [...]}} object`];
  }
  const errs: string[] = [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (!HOOK_EVENTS.includes(event)) {
      errs.push(
        `${HOOKS}: unknown event ${pyRepr(event)}; the framework dispatches ${HOOK_EVENTS.join(", ")} (PascalCase)`,
      );
    } else if (Array.isArray(entries)) errs.push(...entryErrors(event, entries));
    else errs.push(`${HOOKS}: ${event} must map to a LIST of matcher entries`);
  }
  return errs;
}

function entryErrors(event: string, entries: readonly JsonValue[]): string[] {
  const errs: string[] = [];
  for (const [index, entry] of entries.entries()) {
    const at = `${HOOKS}: ${event}[${index}]`;
    const hooks = isRecord(entry) ? entry.hooks : undefined;
    if (!Array.isArray(hooks)) {
      errs.push(`${at} needs a \`hooks\` list`);
      continue;
    }
    for (const hook of hooks) {
      const kind = isRecord(hook) ? hook.type : undefined;
      const field = (key: string): string => (isRecord(hook) && key in hook ? pyStrip(pyStr(hook[key])) : "");
      if (!isString(kind) || !HOOK_TYPES.includes(kind)) {
        errs.push(`${at} hook type must be one of ${HOOK_TYPES.join(", ")}, got ${pyRepr(kind ?? null)}`);
      } else if (kind === "command" && field("command") === "") errs.push(`${at} has an empty \`command\``);
      else if (kind !== "command" && field("prompt") === "") {
        errs.push(`${at} ${kind} hook has an empty \`prompt\``);
      }
    }
  }
  return errs;
}

function compileErrors(tree: Tree): string[] {
  const scripts = Object.fromEntries(
    [...tree].filter(([rel]) => SCRIPT.test(rel) || (SKILL_SCRIPT.test(rel) && rel.endsWith(".py"))),
  );
  if (Object.keys(scripts).length === 0) return [];
  const run = runSync(["python3", "-I", "-c", COMPILE], {
    input: capturedJsonStringify(scripts),
    timeout: 60_000,
  });
  if (run.exitCode !== 0) {
    return [`the scripts could not be compiled: ${decodeOutput(run.stderr).slice(-300)}`];
  }
  const parsed = capturedJsonParse(decodeOutput(run.stdout));
  return Array.isArray(parsed) ? parsed.map((line) => pyStr(line)) : [];
}

function skillErrors(tree: Tree, body: string): string[] {
  const errs: string[] = [];
  for (const name of skillNames(tree)) {
    const file = `.claude/skills/${name}/SKILL.md`;
    const head = tree.get(file);
    if (frontmatter(head, /^description:\s*\S/mu) === null) {
      errs.push(
        `${file} needs a \`description:\` in its frontmatter, or the skill is dropped SILENTLY at load`,
      );
    }
    const named = frontmatter(head, /^name:\s*(\S+)\s*$/mu)?.[1];
    if (named !== undefined && named !== name) {
      errs.push(
        `${file} frontmatter \`name: ${named}\` OVERRIDES the directory name at load, so every trigger line naming \`${name}\` stops matching; drop the \`name:\` line or make it \`name: ${name}\``,
      );
    }
    if (!body.includes(name)) {
      errs.push(
        `skill '${name}' is never named in the always-on text, so the agent will not know to invoke it — an untriggered skill is dead weight. Fix it by adding a trigger line naming \`${name}\` to CLAUDE.md, e.g. "When <the situation this skill handles>, use the \`${name}\` skill."`,
      );
    }
  }
  return errs;
}

/** `validate`: throw every problem joined by ` | `, in Python's order. */
export function validate(tree: Tree): void {
  const body = alwaysOn(tree);
  const errs: string[] = [];
  if (pyLen(body) > ALWAYS_ON_MAX) {
    errs.push(
      `always-on content is ${pyLen(body)} chars, over the ${ALWAYS_ON_MAX} cap; CLAUDE.md is loaded whole into the context of EVERY session, and every token competes with the agent's own output budget`,
    );
  }
  if (pyStrip(body) === "") {
    errs.push(
      `${ALWAYS_ON} is empty — it is the only always-on file on this framework, so an empty one is a harness that does not exist`,
    );
  }
  errs.push(...skillErrors(tree, body));
  for (const name of [
    ...new Set([...tree.keys()].flatMap((rel) => SUBAGENT.exec(rel)?.[1] ?? [])),
  ].toSorted()) {
    if (frontmatter(tree.get(`sub_agents/${name}/AGENT.md`), /^description:\s*\S/mu) === null) {
      errs.push(`sub_agents/${name}/AGENT.md needs a \`description:\``);
    }
  }
  errs.push(...compileErrors(tree));
  const hooks = tree.get(HOOKS);
  if (hooks !== undefined) errs.push(...hookErrors(hooks));
  const shipped = new Set([...tree.keys()].filter((rel) => SCRIPT.test(rel) || SKILL_SCRIPT.test(rel)));
  for (const [rel, source] of tree) {
    if (!SKILL.test(rel) && rel !== ALWAYS_ON) continue;
    for (const [, ref = ""] of source.matchAll(SCRIPT_REF)) {
      if (!RESERVED.has(ref.split("/").at(-1) ?? "") && !shipped.has(ref)) {
        errs.push(`${rel} invokes \`${ref}\` but that file is not in the harness`);
      }
    }
  }
  if (errs.length > 0) throw new Error(errs.join(" | "));
}

/** `_agent_file`: a `sub_agents/<name>/AGENT.md` as a Claude Code agent whose `name:` is its directory. */
function agentFile(name: string, text: string): string {
  const lead = pyLstrip(text);
  const split = lead.startsWith("---") ? lead.slice(3).indexOf("\n---") : -1;
  if (split === -1) return `---\nname: ${name}\ndescription: delegated subagent\n---\n\n${text}`;
  let head = lead
    .slice(3, 3 + split)
    .replaceAll(/^name:\s*.*$/gmu, "")
    .replaceAll(/^\n+|\n+$/gu, "");
  if (!/^description:\s*\S/mu.test(head)) head += "\ndescription: delegated subagent";
  return `---\nname: ${name}\n${head}\n---${lead.slice(3 + split + 4)}`;
}

/** `install_tree`: the tree in the layout `claude -p` discovers at a workspace root. */
export function installTree(treeDir: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  if (existsSync(join(treeDir, ALWAYS_ON))) copyFileSync(join(treeDir, ALWAYS_ON), join(dest, ALWAYS_ON));
  const claudeDir = join(dest, ".claude");
  for (const top of [".claude", "scripts"]) {
    for (const inner of walkFiles(join(treeDir, top), SKIP)) {
      const rel = `${top}/${inner}`;
      if (rel === HOOKS || GENERATED.some((path) => rel === path || rel.startsWith(`${path}/`))) continue;
      mkdirSync(dirname(join(dest, rel)), { recursive: true });
      copyFileSync(join(treeDir, rel), join(dest, rel));
    }
  }
  for (const rel of walkFiles(join(treeDir, "sub_agents"))) {
    const [name = "", file] = rel.split("/");
    if (file !== "AGENT.md" || rel.split("/").length !== 2) continue;
    mkdirSync(join(claudeDir, "agents"), { recursive: true });
    writeFileSync(
      join(claudeDir, "agents", `${name}.md`),
      agentFile(name, readFileSync(join(treeDir, "sub_agents", rel), "utf8")),
    );
  }
  const settings: JsonObject = {};
  if (existsSync(join(treeDir, HOOKS))) {
    const doc = capturedJsonParse(readFileSync(join(treeDir, HOOKS), "utf8"));
    if (isRecord(doc) && isRecord(doc.hooks)) settings.hooks = doc.hooks;
  }
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, "settings.json"), `${pyDumps(settings, { indent: 2 })}\n`);
}
