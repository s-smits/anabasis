#!/usr/bin/env bun
import ts from "typescript5";
import { type CommandArgs, CommandFailure, runCommand, SKILL_REPO } from "#skills/main/cli.ts";
import { existsSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitText } from "#src/meta/git.ts";
import { join } from "#src/meta/path.ts";
import {
  COMMENT_RATCHET_FILE,
  formatCommentRatchet,
  isExemptComment,
  isRuleSourcePath,
  readCommentRatchet,
} from "#tools/oxlint/comment-ratchet.ts";
import { lines } from "#tools/runtime/gate.ts";

const USAGE = `usage: ratchet.ts [--list <prefix>] [--write] [--init]

Counts non-exempt comments and sheddable whole comment lines across tracked non-vendor TS/JS files.
  --list <prefix>  Print every non-exempt comment under <prefix> for categorisation.
  --write          Tighten tools/oxlint/comment-ratchet.tsv (refuses ceiling increases).
  --init           Write tools/oxlint/comment-ratchet.tsv from current counts (initial setup).`;

const SOURCE_FILE = /\.[cm]?[jt]sx?$/u;
const IGNORED_ROOTS = ["vendor/", "campaigns/", "domains/", "tmp/"] as const;

interface CommentSpan {
  readonly pos: number;
  readonly end: number;
  readonly kind: ts.SyntaxKind;
  readonly insideEmptyCatch: boolean;
}

interface FileAudit {
  readonly path: string;
  readonly totalLines: number;
  readonly nonExempt: readonly { readonly line: number; readonly endLine: number; readonly text: string }[];
  readonly exemptCount: number;
  readonly shedLines: number;
}

function collectComments(path: string, text: string): CommentSpan[] {
  const scriptKind = path.endsWith(".tsx") || path.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind);
  const emptyCatches: { readonly start: number; readonly end: number }[] = [];
  const seen = new Set<string>();
  const raw: { readonly pos: number; readonly end: number; readonly kind: ts.SyntaxKind }[] = [];

  const recordRanges = (ranges: readonly ts.CommentRange[] | undefined) => {
    if (ranges === undefined) return;
    for (const range of ranges) {
      const key = `${String(range.pos)}:${String(range.end)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      raw.push({ pos: range.pos, end: range.end, kind: range.kind });
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      emptyCatches.push({ start: node.block.getStart(sourceFile), end: node.block.getEnd() });
    }
    recordRanges(ts.getLeadingCommentRanges(text, node.pos));
    recordRanges(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };

  visit(sourceFile);
  return raw
    .toSorted((left, right) => left.pos - right.pos)
    .map((span) => ({
      ...span,
      insideEmptyCatch: emptyCatches.some((range) => span.pos >= range.start && span.end <= range.end),
    }));
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.codePointAt(index) === 10) line += 1;
  }
  return line;
}

function auditFile(path: string): FileAudit {
  const text = readFileSync(join(SKILL_REPO, path), "utf8");
  const fileRole = isRuleSourcePath(path) ? "rule" : "other";
  const nonExempt: { readonly line: number; readonly endLine: number; readonly text: string }[] = [];
  const wholeLines = new Set<number>();
  let exemptCount = 0;

  for (const span of collectComments(path, text)) {
    const raw = text.slice(span.pos, span.end);
    const isShebang = raw.startsWith("#!");
    const value = isShebang
      ? raw.slice(2)
      : span.kind === ts.SyntaxKind.SingleLineCommentTrivia
        ? raw.slice(2)
        : raw.slice(2, -2);
    const placement = isShebang ? "shebang" : span.insideEmptyCatch ? "empty-catch" : "normal";
    if (isExemptComment({ value, placement, fileRole })) {
      exemptCount += 1;
      continue;
    }
    const line = lineNumberAt(text, span.pos);
    const endLine = lineNumberAt(text, span.end);
    nonExempt.push({ line, endLine, text: raw.replaceAll(/\s*\n\s*\*?\s*/gu, " ").trim() });

    const lineStart = text.lastIndexOf("\n", span.pos - 1) + 1;
    const before = text.slice(lineStart, span.pos).trim();
    const nextNewline = text.indexOf("\n", span.end);
    const after = text.slice(span.end, nextNewline === -1 ? text.length : nextNewline).trim();
    for (let current = line; current <= endLine; current += 1) {
      if (current === line && before !== "") continue;
      if (current === endLine && after !== "") continue;
      wholeLines.add(current);
    }
  }

  return { path, totalLines: text.split("\n").length, nonExempt, exemptCount, shedLines: wholeLines.size };
}

function printSummary(audits: readonly FileAudit[]): void {
  const roots = new Map<
    string,
    { files: number; totalLines: number; nonExempt: number; exempt: number; shedLines: number }
  >();
  for (const audit of audits) {
    const root = audit.path.includes("/") ? (audit.path.split("/")[0] ?? "(root)") : "(root)";
    const bucket = roots.get(root) ?? { files: 0, totalLines: 0, nonExempt: 0, exempt: 0, shedLines: 0 };
    bucket.files += 1;
    bucket.totalLines += audit.totalLines;
    bucket.nonExempt += audit.nonExempt.length;
    bucket.exempt += audit.exemptCount;
    bucket.shedLines += audit.shedLines;
    roots.set(root, bucket);
  }
  console.log("root\tfiles\ttotalLines\tnonExempt\texempt\tshedLines");
  let totals = { files: 0, totalLines: 0, nonExempt: 0, exempt: 0, shedLines: 0 };
  for (const [root, bucket] of [...roots.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.log(
      `${root}\t${String(bucket.files)}\t${String(bucket.totalLines)}\t${String(bucket.nonExempt)}\t${String(bucket.exempt)}\t${String(bucket.shedLines)}`,
    );
    totals = {
      files: totals.files + bucket.files,
      totalLines: totals.totalLines + bucket.totalLines,
      nonExempt: totals.nonExempt + bucket.nonExempt,
      exempt: totals.exempt + bucket.exempt,
      shedLines: totals.shedLines + bucket.shedLines,
    };
  }
  console.log(
    `TOTAL\t${String(totals.files)}\t${String(totals.totalLines)}\t${String(totals.nonExempt)}\t${String(totals.exempt)}\t${String(totals.shedLines)}`,
  );
}

function writeRatchet(audits: readonly FileAudit[], mode: "init" | "tighten"): void {
  const ratchetPath = join(SKILL_REPO, COMMENT_RATCHET_FILE);
  const previous = existsSync(ratchetPath)
    ? readCommentRatchet(readFileSync(ratchetPath, "utf8")).entries
    : new Map<string, number>();
  const next = new Map<string, number>();
  const raised: string[] = [];
  for (const audit of audits) {
    const actual = audit.nonExempt.length;
    if (actual > 0) next.set(audit.path, actual);
    if (mode === "tighten") {
      const ceiling = previous.get(audit.path) ?? 0;
      if (actual > ceiling) {
        raised.push(`${audit.path}: ${String(actual)} > ${String(ceiling)}`);
      }
    }
  }
  if (raised.length > 0) {
    throw new CommandFailure(`ratchet refuses ceiling increases:\n${raised.join("\n")}`);
  }
  writeFileSync(ratchetPath, formatCommentRatchet(next));
  console.log(`wrote ${COMMENT_RATCHET_FILE}: ${String(next.size)} ratcheted files`);
}

if (import.meta.main) {
  await runCommand(
    {
      name: "ratchet",
      usage: USAGE,
      options: { list: "text", write: "flag", init: "flag" },
    },
    (args: CommandArgs) => {
      const prefix = args.value("list");
      const files = lines(gitText(SKILL_REPO, "ls-files"))
        .filter((path) => SOURCE_FILE.test(path) && !IGNORED_ROOTS.some((root) => path.startsWith(root)))
        .filter((path) => existsSync(join(SKILL_REPO, path)))
        .toSorted();
      const selected = prefix === null ? files : files.filter((path) => path.startsWith(prefix));
      const audits = selected.map(auditFile);

      if (prefix !== null) {
        for (const audit of audits) {
          for (const item of audit.nonExempt) {
            console.log(`${audit.path}:${String(item.line)}-${String(item.endLine)}\t${item.text}`);
          }
        }
        return;
      }
      if (args.flag("write") || args.flag("init")) {
        writeRatchet(audits, args.flag("init") ? "init" : "tighten");
        return;
      }
      printSummary(audits);
    },
  );
}
