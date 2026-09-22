/**
 * A member of a closed set that no production file produces.
 *
 * A literal union — `type Stage = "kickoff" | "brief" | …`, or `reason: "no-feedback" | …` on a
 * property — is the compiler's list of every value a field may hold. A member no other file
 * spells is a value nothing assigns, returns or matches: the consumer's branch for it is dead,
 * and any prose promising it describes a mechanism the source does not have. The row names the
 * member and its set and says whether a test spells it, because a value only a test produces is
 * the other half of the same defect, a case the test suite proves and the product never reaches.
 * A production template counts as a producer of every member its static text allows:
 * `\`stage-${n}\`` produces `stage-3`. A member produced only in JSON is still reported.
 *
 * Measured 2026-09-21 over the simplify record, comment lines not counted as spellings: 16 union
 * and 9 property members flagged at the parents of 239 simplify commits, 19 of the 25 gone or
 * produced by the record head (0.76; 18 removed, 1 given a producer), six of the sixteen the
 * members of two difficulty vocabularies that left together. A simplify commit itself removed 3
 * of 20 per visit and 3 of the 8 sites in a file it touched, all three members of one `kind`
 * vocabulary in src/truth/brief.ts that one commit took at once; the base removal rate of a
 * produced member in a touched file is 0.05 for a union and 0.08 for a property. The scan is
 * admitted on the eventual rate and on what it found standing at 25fb05f74: three
 * `SessionBuildStage` members no file produces, a lineage reason AGENTS.md rule 7 still names and
 * `src/run/admission.ts` never writes, and one member each of `EvaluatorIndependence` and
 * `Altitude`, named in its module's header and produced nowhere. `as const` arrays are left out:
 * 109 sites at 0.52 eventual and 3 of 139 per visit, and what they hold is another program's
 * vocabulary — bubblewrap paths, JSON-schema keys, package.json fields — which this tree lists
 * rather than produces.
 */
import type { TreeFinding } from "./tree-findings.ts";

/** A test, wherever it sits; a spelling there is counted, and reported apart from production. */
const TEST_PATH = /(?:^|\/)test\/|\.test\./u;

/** A comment line names a value; it does not produce one. */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*|#)/u;

/** `type Name = …`, the rest of the line being the body or empty when the union starts below. */
const TYPE_ALIAS = /^(?:export )?type ([A-Za-z_]\w*)\s*=\s*(.*)$/u;

/** `name?: …` inside a declared shape, read the same way. */
const PROPERTY = /^\s+(?:readonly )?([A-Za-z_]\w*)\??:\s*(.*)$/u;

const LITERAL = /^["']([^"'\\]+)["']$/u;

/** One run of the characters a member is made of; a spelling is a run equal to the member. */
const WORD = /[\w./-]+/gu;
const SIMPLE = /^[\w./-]+$/u;

interface SetMember {
  path: string;
  line: number;
  set: string;
  member: string;
  /** 0-based lines the declaration spans, so its own spellings are not read as producers. */
  first: number;
  last: number;
}

/** The union body starting at `index`: on the line, or the `| …` lines below it. */
function unionBody(lines: readonly string[], index: number, inline: string) {
  if (inline !== "") return { body: inline, last: index };
  let body = "";
  let last = index;
  for (let at = index + 1; at < lines.length; at += 1) {
    const line = lines[at] ?? "";
    if (!/^\s*\|/u.test(line)) break;
    body += ` ${line}`;
    last = at;
    if (/[;,]\s*$/u.test(line)) break;
  }
  return { body, last };
}

/** Every member of every all-literal union one file declares, with the line spelling it. */
function closedSets(path: string, text: string): SetMember[] {
  const lines = text.split("\n");
  const found: SetMember[] = [];
  for (const [index, line] of lines.entries()) {
    const head = TYPE_ALIAS.exec(line) ?? PROPERTY.exec(line);
    if (head === null) continue;
    const { body, last } = unionBody(lines, index, head[2] ?? "");
    const parts = body
      .replace(/\/\/[^\n]*/gu, "")
      .replace(/[;,]\s*$/u, "")
      .split("|")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const members = parts.map((part) => LITERAL.exec(part)?.[1]);
    if (members.length < 2 || members.some((member) => member === undefined)) continue;
    for (const member of members) {
      if (member === undefined) continue;
      const at = lines.findIndex(
        (one, where) =>
          where >= index && where <= last && (one.includes(`"${member}"`) || one.includes(`'${member}'`)),
      );
      found.push({
        path,
        line: (at === -1 ? index : at) + 1,
        set: head[1] ?? "",
        member,
        first: index,
        last,
      });
    }
  }
  return found;
}

/** Whether one file spells the member on a code line outside the given lines. */
function spells(
  lines: readonly string[],
  words: ReadonlySet<string>,
  member: string,
  skipFrom: number,
  skipTo: number,
): boolean {
  if (skipFrom < 0 && SIMPLE.test(member)) return words.has(member);
  const needle = new RegExp(`(?<![\\w./-])${RegExp.escape(member)}(?![\\w./-])`, "u");
  return lines.some((line, at) => (at < skipFrom || at > skipTo) && needle.test(line));
}

/**
 * The shapes a template literal can produce, as one pattern each: `\`stage-${n}\`` is `^stage-.*$`.
 * A template whose static text is under three characters — `\`${a}-${b}\`` — is left out: it
 * would produce every member with a hyphen.
 */
function templatePatterns(readers: ReadonlyMap<string, readonly string[]>): RegExp[] {
  const patterns: RegExp[] = [];
  for (const [reader, lines] of readers) {
    if (TEST_PATH.test(reader)) continue;
    for (const body of lines.join("\n").matchAll(/`([^`]*\$\{[^`]*)`/gu)) {
      const parts = (body[1] ?? "").split(/\$\{[^}]*\}/u);
      if (parts.join("").length < 3) continue;
      patterns.push(new RegExp(`^${parts.map((part) => RegExp.escape(part)).join(".*")}$`, "u"));
    }
  }
  return patterns;
}

/** How many production and test files spell one member; the declaring file's own lines count as production. */
function producers(
  one: SetMember,
  readers: ReadonlyMap<string, readonly string[]>,
  words: ReadonlyMap<string, ReadonlySet<string>>,
) {
  let production = 0;
  let tests = 0;
  for (const [reader, lines] of readers) {
    const own = reader === one.path;
    if (!spells(lines, words.get(reader) ?? new Set(), one.member, own ? one.first : -1, one.last)) continue;
    if (!own && TEST_PATH.test(reader)) tests += 1;
    else production += 1;
  }
  return { production, tests };
}

/**
 * One row per literal-union member that no production file spells outside its declaration.
 *
 * Readers are the code files of the corpus. `.json` is left out because the census's own record,
 * `simplify.json`, would spell every member this scan reports and clear it on the next run.
 */
export function unproducedSetMembers(
  declaring: ReadonlyMap<string, string>,
  corpusFiles: ReadonlyMap<string, string>,
): TreeFinding[] {
  const readers = new Map<string, string[]>();
  for (const [path, text] of corpusFiles) {
    if (path.endsWith(".json")) continue;
    readers.set(
      path,
      text.split("\n").map((line) => (COMMENT_LINE.test(line) ? "" : line)),
    );
  }
  const words = new Map(
    [...readers].map(([path, lines]) => [path, new Set(lines.join("\n").match(WORD) ?? [])]),
  );
  const templates = templatePatterns(readers);
  const rows: TreeFinding[] = [];
  for (const [path, text] of declaring) {
    if (TEST_PATH.test(path)) continue;
    for (const one of closedSets(path, text)) {
      const { production, tests } = producers(one, readers, words);
      if (production > 0 || templates.some((pattern) => pattern.test(one.member))) continue;
      const proof =
        tests === 0
          ? "no test spells it either"
          : tests === 1
            ? "one test file spells it"
            : `${tests} test files spell it`;
      rows.push({
        kind: "unproduced-set-member",
        path,
        line: one.line,
        detail: `\`${one.member}\`, a member of \`${one.set}\`, is produced by no production file; ${proof}`,
      });
    }
  }
  return rows;
}
