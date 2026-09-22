/**
 * Everything both oxlint fixers do outside their own rule: read the report, hold the file they
 * edit, land the edits, and print what happened.
 *
 * The file is read once — its parse tree, its text, and the table that turns oxlint's byte offsets
 * into the UTF-16 offsets TypeScript works in.
 *
 * Both fixers take a `--format=json` report and have to land on exactly the node a diagnostic
 * names, which needs two things neither rule supplies. Oxlint counts UTF-8 bytes and TypeScript
 * counts UTF-16 units, so a span is unusable until a per-file table converts it; and several nodes
 * can start at one offset, so the node is found by matching start *and* end rather than by
 * position alone. `strict-boolean-fix.ts` and `unnecessary-condition-fix.ts` each carried a private
 * copy of both, identical but for a loop variable name, so a mis-encoded astral character or a
 * changed span shape would have had to be found twice.
 *
 * It sits beside them rather than inside either because neither rule is its subject: this is a
 * property of the report format and of the compiler, and any later fixer reading the same JSON
 * needs exactly it. The run summary is here for the same reason and one more: the two fixers'
 * output is read side by side, and a tally that drifts in one of them is a difference the reader
 * has to decide is meaningless.
 */
import { readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { join } from "../../src/meta/path.ts";
import * as ts from "typescript5";

const UTF8 = "utf8";
/** The code points at which a UTF-8 encoding takes one more byte than the code point below it. */
const UTF8_WIDER_AT = [0x80, 0x800, 0x10000];

export interface Held {
  readonly source: ts.SourceFile;
  readonly text: string;
  /** Oxlint counts UTF-8 bytes and TypeScript counts UTF-16 units; one table converts between them. */
  readonly charAt: readonly number[];
}

/** One label's place in a file, as oxlint reports it: a UTF-8 byte offset and length. */
export interface Span {
  readonly offset: number;
  readonly length: number;
  readonly line: number;
}

/** One reported site, before anything has been decided about it. */
export interface Diagnostic {
  readonly message: string;
  readonly code?: string;
  readonly filename: string;
  readonly labels: readonly { readonly span: Span }[];
}

/** A whole `--format=json` run. */
export interface Report {
  readonly diagnostics: readonly Diagnostic[];
}

/** One diagnostic a fixer has accepted, in the character offsets its transforms work in. */
export interface Site {
  readonly path: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly message: string;
}

/** One edit a fixer landed, in the shape its journal records and `--revert` reads back. */
export interface Edit {
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly was: string;
  readonly kind: string;
  readonly line: number;
}

/** One fixer's run, as its summary reads it. */
interface FixRun {
  /** The oxlint report the run read. Its journal and its hand-work list are written beside it. */
  readonly reportPath: string;
  readonly held: ReadonlyMap<string, Held>;
  readonly sites: readonly Site[];
  /** Sites refused before an edit was attempted, counted by the ground for the refusal. */
  readonly refused: ReadonlyMap<string, number>;
  /** Sites no edit was found for. The edits `applyEdits` dropped are hand work too, hence `edits`. */
  readonly manual: readonly Site[];
  readonly edits: readonly Edit[];
  readonly landed: readonly Edit[];
  /** What this fixer calls what it did: `fixed`, `rewrote`. */
  readonly verb: string;
  /** What this fixer adds to the hand-work line, or the empty string. */
  readonly note: string;
}

/** One file parsed once, with the byte-to-character table every span in it is read through. */
export function hold(path: string): Held {
  const text = readFileSync(path, UTF8);
  const charAt: number[] = [];
  let char = 0;
  while (char < text.length) {
    const code = text.codePointAt(char) ?? 0;
    const width = UTF8_WIDER_AT.filter((bound) => code >= bound).length + 1;
    for (let one = 0; one < width; one += 1) charAt.push(char);
    char += code > 0xffff ? 2 : 1;
  }
  charAt.push(text.length);
  return { source: ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true), text, charAt };
}

/** The one node whose range is exactly the diagnostic's span. */
export function nodeFor(source: ts.SourceFile, start: number, end: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart(source) > start || node.getEnd() < end) return;
    if (node.getStart(source) === start && node.getEnd() === end) found = node;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/** Where a fixer records what it landed: beside its report, so a reverting run and `fix-loop.ts`
 * both find it from the report path alone. */
export function journalPath(reportPath: string): string {
  return `${reportPath}.journal.json`;
}

/**
 * Put a journal's edits back. A non-empty `wanted` selects `path:line` pairs and leaves every other
 * edit applied, which is what makes reading a fixer's output affordable — land the lot, then hand
 * back the ones a reader rejects.
 *
 * An edit's recorded offset is a position in the file as the fixer *found* it, and the file on disk
 * is the file as the fixer *left* it, so within a file the two agree only at the first edit. Each
 * later one sits further along by however much every edit below it changed the length. The walk is
 * therefore lowest offset first, carrying that running distance: an edit put back restores the
 * original length and leaves the distance where it was, and an edit left in place carries its own
 * landed delta forward. Going highest-first with the recorded offsets, which this did until
 * 2026-09-20, is right only when every edit below deletes and inserts the same number of
 * characters.
 *
 * An edit whose landed text is no longer at that position is left alone: something later owns that
 * line and reverting would write the old text over it. A **deletion cannot be checked this way** —
 * its landed text is the empty string, which is present everywhere — so a deletion is put back on
 * the strength of the arithmetic above and nothing else. That is what silently corrupted
 * `tree-identity.ts` when two ` ?? 0` deletions in one file were reverted: the second went in five
 * characters late, inside the identifier beside it, and the guard could not see it.
 *
 * Which is why the journal is rewritten with the edits still applied. The walk reads the journal
 * as a list of edits the file on disk is carrying, and after a selective revert that is no longer
 * what it holds: a second run would add the undone edit's length change to the running distance
 * for a change that is not there any more, and put every later edit in that file back at the
 * wrong offset — checked for a replacement, unchecked for a deletion. A recorded `start` is a
 * position in the original file and stays one whatever else is dropped, so removing the undone
 * rows is the whole repair. Two selective reverts in a row are then the same as one naming both.
 */
export function revertJournal(journal: string, root: string, wanted: ReadonlySet<string>): void {
  const recorded = parseJsonAs<Edit[]>(readFileSync(journal, UTF8));
  const byPath = new Map<string, Edit[]>();
  for (const edit of recorded) byPath.set(edit.path, [...(byPath.get(edit.path) ?? []), edit]);
  const undone = new Set<Edit>();
  for (const [path, own] of byPath) {
    const found = readFileSync(join(root, path), UTF8);
    let text = found;
    let ahead = 0;
    for (const edit of [...own].sort((a, b) => a.start - b.start)) {
      const at = edit.start + ahead;
      const selected = wanted.size === 0 || wanted.has(`${edit.path}:${String(edit.line)}`);
      if (!selected || text.slice(at, at + edit.text.length) !== edit.text) {
        ahead += edit.text.length - edit.was.length;
        continue;
      }
      text = text.slice(0, at) + edit.was + text.slice(at + edit.text.length);
      undone.add(edit);
    }
    if (text !== found) writeFileSync(join(root, path), text);
  }
  const left = recorded.filter((edit) => !undone.has(edit));
  if (left.length !== recorded.length) writeFileSync(journal, JSON.stringify(left, null, 1));
  console.log(`reverted ${String(undone.size)} edits`);
}

/** Oxlint prints a banner before the object, so the report starts at its first brace. */
export function readReport(reportPath: string): Report {
  const raw = readFileSync(reportPath, UTF8);
  return parseJsonAs<Report>(raw.slice(raw.indexOf("{")));
}

/**
 * Where one diagnostic lands, in characters, with its file parsed once and kept in `files` so every
 * later span in the same file is converted against the same table.
 *
 * The leading-whitespace skip is the part worth naming. Oxlint reports a multi-line expression from
 * the first character of its first line, indentation included, and a transform that replaced that
 * range would eat the indentation with it. Moving the start forward past blanks leaves the line's
 * shape alone and still covers every character the diagnostic is about.
 */
export function siteOf(files: Map<string, Held>, root: string, one: Diagnostic, span: Span): Site {
  let file = files.get(one.filename);
  if (file === undefined) {
    file = hold(join(root, one.filename));
    files.set(one.filename, file);
  }
  let start = file.charAt[span.offset] ?? -1;
  const end = file.charAt[span.offset + span.length] ?? -1;
  while (start >= 0 && start < end && (file.text[start] ?? "").trim() === "") start += 1;
  return { path: one.filename, line: span.line, start, end, message: one.message };
}

/**
 * Land a round's edits and return the ones that went in, highest offset first within each file so
 * the edits below keep the positions they were recorded at.
 *
 * Two things are refused rather than forced. An edit reaching past the last one applied overlaps
 * it, and two edits cannot both land where they overlap, so it is left for the next round — which
 * is why a fixer converges by being run again rather than by resolving overlaps itself. And a path
 * with no held parse is skipped: there is no text to edit, and writing what a fixer believes the
 * file to be over a file it never read is how an empty file gets written.
 */
export function applyEdits(files: ReadonlyMap<string, Held>, root: string, edits: readonly Edit[]): Edit[] {
  const byFile = new Map<string, Edit[]>();
  for (const edit of edits) byFile.set(edit.path, [...(byFile.get(edit.path) ?? []), edit]);
  const landed: Edit[] = [];
  for (const [path, own] of byFile) {
    const file = files.get(path);
    if (file === undefined) continue;
    let text = file.text;
    let guard = Number.POSITIVE_INFINITY;
    for (const edit of [...own].sort((a, b) => b.start - a.start)) {
      if (edit.end > guard) continue;
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      guard = edit.start;
      landed.push(edit);
    }
    writeFileSync(join(root, path), text);
  }
  return landed;
}

/** One tally, most first. */
function printTally(rows: ReadonlyMap<string, number>, verb: string): void {
  for (const [key, count] of [...rows].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verb} ${String(count)} ${key}`);
  }
}

/** Write the run's journal, print what it did, and leave the hand work in a file beside the report. */
export function reportRun(run: FixRun): void {
  // The journal replaces any from an earlier run over the same report.
  writeFileSync(journalPath(run.reportPath), JSON.stringify(run.landed, null, 1));
  const refusedTotal = [...run.refused.values()].reduce((sum, one) => sum + one, 0);
  console.log(`${String(run.sites.length + refusedTotal)} sites`);
  const counted = new Map<string, number>();
  for (const edit of run.landed) counted.set(edit.kind, (counted.get(edit.kind) ?? 0) + 1);
  printTally(counted, run.verb);
  printTally(run.refused, "refused");
  console.log(
    `  left ${String(run.manual.length + (run.edits.length - run.landed.length))} for hand work${run.note}`,
  );
  // `Unnecessary conditional, value is always truthy` about `held` and the same sentence about
  // `parsed` are one thing to decide and two strings, so a tally keyed on the message alone reports
  // a hundred singletons. With the operands blanked it reports the four or five shapes left.
  const remaining = new Map<string, number>();
  for (const one of run.manual) {
    const key = one.message.replace(/`[^`]*`/gu, "X");
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  for (const [wording, count] of [...remaining].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count)} ${wording}`);
  }
  const worklist = run.manual.map((one) => {
    const row = (run.held.get(one.path)?.text.split("\n")[one.line - 1] ?? "").trim();
    return `${one.path}:${String(one.line)}  ${one.message}\n    ${row}`;
  });
  writeFileSync(`${run.reportPath}.manual.txt`, `${worklist.join("\n")}\n`);
}
