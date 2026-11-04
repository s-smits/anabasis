#!/usr/bin/env bun
/**
 * Build an Oracle task as one markdown file, for a reader that takes no zip or reads one badly.
 *
 *   bun --env-file=.env.runs .claude/skills/oracle-handover/scripts/document.ts <parts> --commit <sha> --out <md>
 *
 * `<parts>` holds one part a line, `#` a comment, and ` :: <why>` after a part prints under it:
 * `head <md>` (the task, once), `src <path>[:A-B | #name | #1,2]` (a file at the commit: whole,
 * lines, a declaration with its head comment, or markdown sections), `diff <from>..<to> [paths]`,
 * `pr <N>`, `log <run> <selector>... [--whole]` (`slice.ts`) and `file <local path>`.
 *
 * Source comes from a published commit (`publishedAt`), never the working tree: on 3 November a
 * document appended the main checkout's `AGENTS.md`, behind the stack's top, and the Oracle
 * reported a contradiction the top had resolved. Home folders become `~/` and each machine
 * `ANA_HOSTS` names `host-a`, `host-b` (said here, not in the file); a credential refuses it.
 * Its size is printed, never capped (operator, 4 November: "do not optimize for it"), in o200k
 * tokens at 3.17 bytes each, from the 4 November document (452 KB, 142,579 tokens).
 */
import * as ts from "typescript5";
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitOutput, gitText } from "#src/meta/git.ts";
import { basename, dirname, extname, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { publishedAt } from "#tools/runs/code.ts";
import { hostsOf, ownName } from "#tools/runs/host-config.ts";
import { ghOrThrow } from "#tools/runtime/pulls.ts";
import { scanText } from "#tools/secrets/rules.ts";
import { DEFAULT_MAX_CHARS, fenced, sliceRun } from "./slice.ts";

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
const tokensOf = (text: string) => Math.round(new TextEncoder().encode(text).length / 3.17);

/** The 1-based lines of top-level declaration `name` in TypeScript `text`, from the head comment
 *  of its first statement to the end of its last, so that overloads and merged interfaces come whole. */
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

/** The 1-based lines of each markdown section whose heading is `key` or begins `key ` or `key. `. */
export function sectionLines(lines: readonly string[], keys: readonly string[]): [number, number][] {
  // A `#` line inside a fenced block is code, not a heading.
  let fence = false;
  const headings = lines.map((line) => {
    if (/^\s*(?:```|~~~)/u.test(line)) fence = !fence;
    return fence ? null : /^(#+) (.*)$/u.exec(line);
  });
  const end = lines.at(-1) === "" ? lines.length - 1 : lines.length;
  return keys.map((key) => {
    // A space after the heading's text lets `key ` match the whole heading as well as its first words.
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

/** Each verb of a parts line: what it makes of its arguments. */
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
    body: ghOrThrow(at.repo, [
      "pr",
      "view",
      number,
      "--json",
      "title,headRefName,headRefOid,baseRefName,state,body,files",
      "--template",
      PR_TEMPLATE,
    ]),
  }),
  log: async (_, words) => {
    const [run = "", ...selectors] = words.filter((word) => word !== "--whole");
    return {
      title: `${run}: ${selectors.join(" ")}`,
      link: "",
      body: await sliceRun(run, selectors, { whole: words.includes("--whole"), maxChars: DEFAULT_MAX_CHARS }),
    };
  },
  file: (at, [path = ""]) => ({
    title: basename(path),
    link: "",
    body: readFileSync(resolve(at.base, path), "utf8").trim(),
  }),
} as const satisfies Record<string, (at: At, words: string[]) => Part | Promise<Part>>;
const isVerb = (verb: string): verb is keyof typeof PARTS => Object.hasOwn(PARTS, verb);

/** `text` with every home folder as `~`, also where a path is written with dashes (a session's
 *  folder), every login number dropped (machine rules: none in published text), and each
 *  machine's names, `machines[i]`, in any case, as one alias. */
export function sanitised(text: string, machines: readonly (readonly string[])[]) {
  const aliases = new Map(
    machines.flatMap((names, index) =>
      names
        .filter((name) => name.length >= 3)
        .map((name) => [name, `host-${String.fromCodePoint(97 + index)}`] as const),
    ),
  );
  let out = text
    .replaceAll(/(?<![\w.-])\/(?:Users|home)\/[^/\s"'`),;:]+/gu, "~")
    .replaceAll(/-(?:Users|home)-[^-/\s]+-/gu, "-~-")
    .replaceAll(/(\.claude-account|CLAUDE_CODE_OAUTH_TOKEN)\d+/gu, "$1")
    .replaceAll(/\b(?:logins? \d+(?:(?:, ?| and | or )\d+)*|claude[1-9])\b/giu, "a login");
  for (const [name, alias] of [...aliases].toSorted(([a], [b]) => b.length - a.length)) {
    out = out.replaceAll(new RegExp(name.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`), "giu"), alias);
  }
  return { text: out, aliases };
}

/** The document the parts file `partsFile` names, read at commit `commit` of checkout `repo`. */
async function documentOf(partsFile: string, repo: string, commit: string) {
  const origin = gitText(repo, "remote", "get-url", "origin");
  const at: At = {
    repo,
    sha: publishedAt(repo, commit),
    web: `https://github.com/${origin.replaceAll(/^.*github\.com[:/]|\.git$/gu, "")}`,
    base: dirname(partsFile),
  };
  const head: string[] = [];
  const parts: Part[] = [];
  for (const line of readFileSync(partsFile, "utf8")
    .split("\n")
    .map((each) => each.trim())) {
    if (line === "" || line.startsWith("#")) continue;
    const cut = line.indexOf(" :: ");
    const [spec, why] = cut === -1 ? [line, undefined] : [line.slice(0, cut), line.slice(cut + 4)];
    // A parts line is not shell: a quoted word loses its quotes and nothing more.
    const [verb = "", ...words] = spec.split(/\s+/u).map((word) => word.replace(/^(['"])(.*)\1$/u, "$2"));
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

/** This machine's name, then each peer's names, as `ANA_HOSTS` gives them: the aliases' order. */
function machinesOf(): string[][] {
  const peers = hostsOf();
  if (peers.length === 0) {
    throw new CommandFailure(
      "no ANA_HOSTS: run with --env-file=.env.runs, so that every host name is aliased",
    );
  }
  return [[ownName()], ...peers.map((host) => [host.name, host.ssh.replace(/^.*@/u, "")])];
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
      // The aliases alone, so that a head can name the hosts as the document will.
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
