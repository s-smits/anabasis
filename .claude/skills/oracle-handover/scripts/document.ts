#!/usr/bin/env bun
/**
 * Builds an Oracle task as one markdown file, for a reader that takes no zip or reads one badly:
 * `bun --env-file=.env.runs document.ts <parts> --commit <sha> --out <md>` (`--aliases` prints the
 * host aliases alone). `<parts>` holds one part a line, `#` a comment, and ` :: <why>` after a part
 * prints under it: `head <md>`, `src <path>[:A-B | #name | #1,2]`, `diff <from>..<to> [paths]`, `pr
 * <N>` (its summary and its diff outside `test/`), `log <run> <selector>... [--whole]` (`slice.ts`), `file <local path>` and `findings <WRI folder>
 * [id...]` (its `reports.md` findings table, and the log parts each `Seen in:` selector names). Source comes from
 * a published commit (`publishedAt`), never the working tree, so the Oracle does not report
 * contradictions the stack's top has resolved. Home folders become `~/` and each machine
 * `ANA_HOSTS` names an alias (`host-a`, ...); a credential refuses it, and so does a `.env.runs`
 * naming hosts this command did not load. Its size is printed, never capped, in o200k tokens at
 * 3.17 bytes each. The repository's `AGENTS.md` is always the first appendix, whole, so the Oracle
 * reads the invariants and terms before any part.
 */
import * as ts from "typescript5";
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { existsSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitOutput, gitText } from "#src/meta/git.ts";
import { basename, dirname, extname, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { publishedAt } from "#tools/runs/code.ts";
import { envRunsFile, hostsOf, ownName } from "#tools/runs/host-config.ts";
import { ghOrThrow } from "#tools/runtime/pulls.ts";
import { AGENTS_MD } from "#tools/loc/source-policy.ts";
import { scanText } from "#tools/secrets/rules.ts";
import { REPORTS } from "#tools/wri/index.ts";
import { FINDINGS_HEAD } from "#tools/wri/investigation.ts";
import { rowsOf } from "#tools/wri/ledger.ts";
import { DEFAULT_MAX_CHARS, fenced, parseSelector, sliceRun } from "./slice.ts";

interface Part {
  readonly title: string;
  readonly link: string;
  readonly body: string;
}
interface At {
  readonly repo: string;
  readonly sha: string;
  readonly web: string;
  readonly base: string;
}

const LANGUAGE = new Map([
  [".ts", "ts"],
  [".md", "markdown"],
  [".json", "json"],
  [".py", "python"],
]);
const PR_TEMPLATE = [
  "{{.title}}\n\n`{{.headRefName}}` @ {{.headRefOid}} on `{{.baseRefName}}`, {{.state}}.\n\n{{.body}}\n",
  "| file | added | deleted |\n| --- | --- | --- |\n{{range .files}}| `{{.path}}` | +{{.additions}} | -{{.deletions}} |\n{{end}}",
].join("\n");
export const tokensOf = (text: string): number => Math.round(new TextEncoder().encode(text).length / 3.17);

/** The 1-based lines of top-level declaration `name`, from the head comment of its first statement
 *  to the end of its last, so that overloads and merged interfaces come whole. */
export function declarationLines(text: string, name: string): [number, number] {
  const file = ts.createSourceFile("part.ts", text, ts.ScriptTarget.ESNext, true);
  const named = (node: ts.Statement) =>
    ts.isVariableStatement(node)
      ? node.declarationList.declarations.some(
          (each) => ts.isIdentifier(each.name) && each.name.text === name,
        )
      : (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isModuleDeclaration(node)) &&
        node.name?.getText(file) === name;
  const nodes = file.statements.filter(named);
  const first = nodes[0];
  const last = nodes.at(-1);
  if (first === undefined || last === undefined) {
    throw new CommandFailure(`no top-level declaration named ${name}`);
  }
  // The comments just above the statement are its own; a file's head comment sits above a blank line.
  let from = first.getStart(file);
  for (const comment of (ts.getLeadingCommentRanges(text, first.getFullStart()) ?? []).toReversed()) {
    if (/\n\s*\n/u.test(text.slice(comment.end, from))) break;
    from = comment.pos;
  }
  const line = (at: number) => file.getLineAndCharacterOfPosition(at).line + 1;
  return [line(from), line(last.getEnd())];
}

export function sectionLines(lines: readonly string[], keys: readonly string[]): [number, number][] {
  // A `#` line inside a fenced block is code, not a heading.
  let fence = false;
  const headings = lines.map((line) => {
    if (/^\s*(?:```|~~~)/u.test(line)) fence = !fence;
    return fence ? null : /^(#+) (.*)$/u.exec(line);
  });
  const end = lines.at(-1) === "" ? lines.length - 1 : lines.length;
  return keys.map((key) => {
    const at = headings.findIndex((heading) =>
      [`${key} `, `${key}. `].some((each) => `${heading?.[2] ?? ""} `.startsWith(each)),
    );
    if (at === -1) throw new CommandFailure(`no heading begins ${key}`);
    const depth = headings[at]?.[1]?.length ?? 1;
    const next = headings.findIndex(
      (heading, index) => index > at && (heading?.[1]?.length ?? Infinity) <= depth,
    );
    return [at + 1, next === -1 ? end : next];
  });
}

export const webOf = (repo: string): string =>
  `https://github.com/${gitText(repo, "remote", "get-url", "origin").replaceAll(/^.*github\.com[:/]|\.git$/gu, "")}`;

/** Pull request `number` as GitHub shows it now: its title on the first line, then its head, base
 *  and state, its body and its files. */
export const pullTold = (repo: string, number: string): string =>
  ghOrThrow(repo, [
    "pr",
    "view",
    number,
    "--json",
    "title,headRefName,headRefOid,baseRefName,state,body,files",
    "--template",
    PR_TEMPLATE,
  ]);

function srcPart(at: At, spec: string): Part {
  const [, path = spec, from, to = from, name] = /^([^:#]+)(?::(\d+)(?:-(\d+))?|#(.+))?$/u.exec(spec) ?? [];
  if (Number(from) > Number(to)) throw new CommandFailure(`${spec}: a range runs from its lower line`);
  const text = gitOutput(at.repo, "show", `${at.sha}:${path}`);
  const lang = LANGUAGE.get(extname(path)) ?? "";
  const blob = `${at.web}/blob/${at.sha}/${path}`;
  if (from === undefined && name === undefined) return { title: path, link: blob, body: fenced(text, lang) };
  const lines = text.split("\n");
  const named = (key: string) =>
    lang === "markdown" ? sectionLines(lines, key.split(",")) : [declarationLines(text, key)];
  const ranges: [number, number][] = name === undefined ? [[Number(from), Number(to)]] : named(name);
  return {
    title: spec,
    link: ranges.map(([a, b]) => `${blob}#L${String(a)}-L${String(b)}`).join(" "),
    body: ranges.map(([a, b]) => fenced(lines.slice(a - 1, b).join("\n"), lang)).join("\n\n"),
  };
}

export const untested = (diff: string): string =>
  diff
    .split(/^(?=diff --git )/mu)
    .filter((file) => !file.startsWith("diff --git a/test/"))
    .join("");

const isSelector = (word: string): boolean => {
  if (!/[{[:]/u.test(word)) return false;
  try {
    parseSelector(word);
    return true;
  } catch {
    return false;
  }
};

export const seenParts = (seen: string): [string, string[]][] =>
  seen.split(";").flatMap((entry) => {
    const [run = "", ...words] = entry
      .trim()
      .split(/[\s,]+(?![^{[]*[}\]])/u)
      .map((word) => word.replaceAll(/^[(`]+|[).,`]+$/gu, ""));
    const selectors = words.filter(isSelector);
    return selectors.length === 0 || isSelector(run) ? [] : [[run, selectors]];
  });

async function findingsPart(at: At, [folder = "", ...ids]: string[]): Promise<Part> {
  const all = rowsOf(readFileSync(resolve(at.base, folder, REPORTS), "utf8"), "id");
  const unknown = ids.filter((id) => !all.some(([row]) => row === id));
  if (all.length === 0 || unknown.length > 0) {
    throw new CommandFailure(`${folder}: no finding ${unknown.join(", ") || "in its findings table"}`);
  }
  const rows = all.filter(([id = ""]) => ids.length === 0 || ids.includes(id));
  const shown = { whole: false, maxChars: DEFAULT_MAX_CHARS };
  const slices = await Promise.all(
    rows.flatMap(({ 0: id = "", 5: seen = "" }) =>
      seenParts(seen).map(
        async ([run, selectors]) => `### ${id}\n\n${await sliceRun(run, selectors, shown)}`,
      ),
    ),
  );
  return {
    title: `findings of ${basename(folder)}`,
    link: "",
    body: [[FINDINGS_HEAD, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n"), ...slices].join(
      "\n\n",
    ),
  };
}

const PARTS = {
  src: (at, words) => srcPart(at, words.join(" ")),
  diff: (at, [range = "", ...paths]) => {
    if (!range.includes("..")) throw new CommandFailure(`diff ${range}: name two commits, <from>..<to>`);
    return {
      title: `diff ${range}`,
      link: `${at.web}/compare/${range.includes("...") ? range : range.replace("..", "...")}`,
      body: fenced(gitOutput(at.repo, "diff", range, "--", ...paths), "diff"),
    };
  },
  pr: (at, [number = ""]) => ({
    title: `PR #${number}`,
    link: `${at.web}/pull/${number}/files`,
    body: `${pullTold(at.repo, number)}\n\n${fenced(untested(ghOrThrow(at.repo, ["pr", "diff", number])), "diff")}`,
  }),
  log: async (_, words) => {
    const [run = "", ...selectors] = words.filter((word) => word !== "--whole");
    return {
      title: `${run}: ${selectors.join(" ")}`,
      link: "",
      body: await sliceRun(run, selectors, { whole: words.includes("--whole"), maxChars: DEFAULT_MAX_CHARS }),
    };
  },
  findings: findingsPart,
  file: (at, [path = ""]) => ({
    title: basename(path),
    link: "",
    body: readFileSync(resolve(at.base, path), "utf8").trim(),
  }),
} as const satisfies Record<string, (at: At, words: string[]) => Part | Promise<Part>>;
const isVerb = (verb: string): verb is keyof typeof PARTS => Object.hasOwn(PARTS, verb);

/** Home folders become `~`, also where a path is written with dashes (a session's folder); login
 *  numbers are dropped; each machine's names, in any case, become one alias. A tree and a session's
 *  scratchpad go whole. */
export function sanitised(text: string, machines: readonly (readonly string[])[]) {
  const aliases = new Map(
    machines.flatMap((names, index) =>
      names
        .filter((name) => name.length >= 3)
        .map((name) => [name, `host-${String.fromCodePoint(97 + index)}`] as const),
    ),
  );
  let out = text
    .replaceAll(/\/private\/tmp\/claude-\d+\/[^\s`"')]*?\/scratchpad\//gu, "<scratch>/")
    .replaceAll(
      /(?<![\w.-])(?:\/(?:Users|home)\/[^/\s"'`),;:]+|~)(?:\/[^/\s"'`),;:]+)*?\/anabasis[-\w.]*/gu,
      "<tree>",
    )
    .replaceAll(/(?<![\w.-])\/(?:Users|home)\/[^/\s"'`),;:]+/gu, "~")
    .replaceAll(/-(?:Users|home)-[^-/\s]+-/gu, "-~-")
    .replaceAll(/(\.claude-account|CLAUDE_CODE_OAUTH_TOKEN)\d+/gu, "$1")
    .replaceAll(/\b(?:logins? \d+(?:(?:, ?| and | or )\d+)*|claude[1-9])\b/giu, "a login")
    .replaceAll(/(\|\s*logins?\s*\|\s*)\d+\b/giu, "$1a login");
  for (const [name, alias] of [...aliases].toSorted(([a], [b]) => b.length - a.length)) {
    out = out.replaceAll(new RegExp(name.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`), "giu"), alias);
  }
  return { text: out, aliases };
}

async function documentOf(partsFile: string, repo: string, commit: string) {
  const at: At = { repo, sha: publishedAt(repo, commit), web: webOf(repo), base: dirname(partsFile) };
  const head: string[] = [];
  const rules = srcPart(at, AGENTS_MD);
  const parts: Part[] = [
    { ...rules, body: `Read this first: the repository's invariants, terms and rules.\n\n${rules.body}` },
  ];
  for (const line of readFileSync(partsFile, "utf8")
    .split("\n")
    .map((each) => each.trim())) {
    if (line === "" || line.startsWith("#")) continue;
    const cut = line.indexOf(" :: ");
    const [spec, why] = cut === -1 ? [line, undefined] : [line.slice(0, cut), line.slice(cut + 4)];
    // A parts line is not shell: a quoted word loses its quotes and nothing more.
    const [verb = "", ...words] = spec.split(/\s+/u).map((word) => word.replace(/^(['"])(.*)\1$/u, "$2"));
    if (verb === "src" && words[0]?.startsWith(AGENTS_MD) === true) {
      throw new CommandFailure(`${spec}: ${AGENTS_MD} is always the first part, whole`);
    }
    if (verb === "head") head.push(readFileSync(resolve(at.base, words.join(" ")), "utf8").trim());
    else if (isVerb(verb)) {
      const part = await PARTS[verb](at, words);
      parts.push({ ...part, body: why === undefined ? part.body : `${why.trim()}\n\n${part.body}` });
    } else throw new CommandFailure(`${verb}: a part is head, ${Object.keys(PARTS).join(", ")}`);
  }
  if (head.length !== 1) {
    throw new CommandFailure(`${partsFile} names ${String(head.length)} head lines: the task is one`);
  }
  const rows = parts.map(
    (part, index) =>
      `| ${String(index + 1)} | ${part.title} | ${part.link === "" ? "inline only" : part.link.split(" ")[0]} | ${tokensOf(part.body).toLocaleString("en-GB")} |`,
  );
  const text = [
    ...head,
    `## The appended material\n\nEvery source part was read at commit \`${at.sha}\` (${at.web}/tree/${at.sha}) and links to the lines it holds; a part without a link is not on GitHub.`,
    ["| part | what | on GitHub | about tokens |", "| --- | --- | --- | --- |", ...rows].join("\n"),
    ...parts.map(
      (part, index) =>
        `## Appendix ${String(index + 1)}. ${part.title}\n\n${part.link === "" ? "" : `On GitHub: ${part.link}\n\n`}${part.body}`,
    ),
  ].join("\n\n");
  return { ...sanitised(`${text}\n`, machinesOf()), parts: parts.length };
}

function machinesOf(): string[][] {
  const file = envRunsFile(runtimeProcess.cwd());
  const unloaded = runtimeProcess.env.ANA_HOSTS === undefined && existsSync(file);
  if (unloaded && /^ANA_HOSTS=/mu.test(readFileSync(file, "utf8"))) {
    throw new CommandFailure(
      `${file} names ANA_HOSTS, and this command did not load it: run with --env-file=<that file>, so that every host name is aliased`,
    );
  }
  return [[ownName()], ...hostsOf().map((host) => [host.name, host.ssh.replace(/^.*@/u, "")])];
}

if (import.meta.main) {
  await runCommand(
    {
      name: "document",
      usage: "document.ts <parts file> --commit <sha> --out <REVIEW.md> | --aliases",
      options: { commit: "text", out: "abs", aliases: "flag" },
      positionals: [0, 1],
    },
    async (args: CommandArgs) => {
      if (args.flag("aliases")) {
        for (const [name, alias] of sanitised("", machinesOf()).aliases) console.log(`${alias} is ${name}`);
        return;
      }
      const [partsFile] = args.positionals;
      if (partsFile === undefined) throw new CommandFailure("name a parts file, or pass --aliases");
      const made = await documentOf(
        resolve(partsFile),
        gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel"),
        args.required("commit"),
      );
      const hits = scanText("REVIEW.md", made.text).map((hit) => `  line ${String(hit.line)}: ${hit.what}`);
      if (hits.length > 0) {
        throw new CommandFailure(`a credential-shaped line, so nothing was written:\n${hits.join("\n")}`);
      }
      writeFileSync(args.required("out"), made.text);
      const tokens = tokensOf(made.text).toLocaleString("en-GB");
      console.log(`${args.required("out")}: about ${tokens} o200k tokens in ${String(made.parts)} parts`);
      for (const [name, alias] of made.aliases) console.log(`  ${alias} is ${name}`);
    },
  );
}
