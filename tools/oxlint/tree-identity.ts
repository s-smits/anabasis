/**
 * One name this repository owns (a bundle path, an evidence file, a schema tag) spelled as a
 * double-quoted literal in more than one file, with no constant every copy imports.
 *
 * The scan has to decide what counts as a name. A literal is one when it has no whitespace, holds
 * a `/` or a `.`, is not an interpolation fragment, an assignment or a slug, is no other program's
 * name (`literal-owner.ts`), and is at least 15 characters or a file name with a stem and an
 * extension. On 20 September `battery.json` stood in seven files and `opening.json` in six, so a
 * short file name counts too, at three files rather than two, because two files agreeing on
 * `index.ts` share a word rather than a layout.
 *
 * What is not a second copy: an import line, a comment, a quote inside another string or a
 * template's text (an example in a message is prose), the path a loader spells beside its
 * `import("…")` type, and a literal the compiler already checks. The last is a type, a member's
 * declared type (`schema: "tag/v2";`), a TypeBox literal, and a constant table that `satisfies` a
 * non-string type or is read with `typeof`: mistyping one copy then fails the build. `join(dir,
 * "a", "b.ts")` is read as `a/b.ts`; on 20 September that blindness hid 22 of 90 sites.
 *
 * Rewritten on 27 October: one tokenizer over each line in place of a regex and a state machine
 * run on the text before every match.
 */
import manifest from "../../package.json" with { type: "json" };
import { ownedElsewhere } from "./ana/shared/literal-owner.ts";
import type { TreeFinding } from "./tree-findings.ts";

const LENGTH_FLOOR = 15;
const FILE_FLOOR = 2;
const SHORT_FILE_FLOOR = 3;
const FILE_NAME = /^[A-Za-z][\w-]*(?:[/.][\w-]+)*\.[\w-]+$/u;
const NOT_A_NAME = ["${", "=", ":"];

const SKIPPED_LINE = /^\s*import\s|^\s*export\s+[*{]|\bfrom\s*"|^\s*(?:\/\/|\/?\*)|\bpathToFileURL\(/u;
const INLINE_IMPORT = /\bimport\(\s*"((?:[^"\\\n]|\\.)*)"/gu;
const JOIN_CALL = /\bjoin\(([^()]*)\)/gu;
const ADJACENT_SEGMENTS = /"(?:[^"\\\n]|\\.)*"(?:\s*,\s*"(?:[^"\\\n]|\\.)*")+/gu;
const QUOTED = /"((?:[^"\\\n]|\\.)*)"/gu;

const TYPE_DECLARATION = /^\s*(?:export\s+)?(?:declare\s+)?type\s|^\s*\|\s*"/u;
const TYPE_MEMBER = /(?:^\s*|[{|,(]\s*)(?:readonly\s+)?[A-Za-z_$][\w$]*\??:\s*$/u;
const OPENS_LITERAL = /^(\s*)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*[[{]\s*$/u;
const OWNING_CONST = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*"((?:[^"\\\n]|\\.)*)"/u;

/** The root manifest's aliases as prefix pairs: `#skills/` names what `.claude/skills/` names. */
const ALIASES = Object.entries(manifest.imports).map(([key, target]) => [
  key.slice(0, -1),
  target.slice(2, -1),
]);

interface Spelling {
  value: string;
  path: string;
  line: number;
  /** The constant this line declares for the value, and whether it is exported. */
  owner: string | null;
  exported: boolean;
  /** Whether the compiler checks this spelling, which makes every copy checked. */
  typed: boolean;
}

/** The double-quoted literals a line holds as code, with their column. A quote inside another
 *  string or inside a template's text is prose; one inside `${…}` is code again. */
function codeLiterals(line: string): { value: string; at: number }[] {
  const found: { value: string; at: number }[] = [];
  const open: string[] = [];
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at];
    if (open.at(-1) === "`") {
      if (char === "\\") at += 1;
      else if (char === "`") open.pop();
      else if (char === "$" && line[at + 1] === "{") {
        open.push("{");
        at += 1;
      }
    } else if (char === '"' || char === "'") {
      let close = at + 1;
      while (close < line.length && line[close] !== char) close += line[close] === "\\" ? 2 : 1;
      if (char === '"' && close < line.length) found.push({ value: line.slice(at + 1, close), at });
      at = close;
    } else if (char === "`" || char === "{") open.push(char);
    else if (char === "}" && open.at(-1) === "{") open.pop();
  }
  return found;
}

/** The lines of a constant table the compiler takes a type from: closed by `satisfies` a type that
 *  is not `string`, or `as const` and read with `typeof`. The block closes at its opening indent. */
function typedTableLines(lines: readonly string[], text: string): Set<number> {
  const typed = new Set<number>();
  let opened: { at: number; indent: string; name: string } | null = null;
  for (const [index, line] of lines.entries()) {
    const opening: RegExpExecArray | null = opened === null ? OPENS_LITERAL.exec(line) : null;
    if (opening !== null) opened = { at: index, indent: opening[1] ?? "", name: opening[2] ?? "" };
    const tail = opened !== null && /^[\]}]/u.test(line.slice(opened.indent.length)) ? line : null;
    if (opened === null || tail === null || !line.startsWith(opened.indent)) continue;
    const derived =
      (tail.includes("satisfies") && !/\bstring\b/u.test(tail)) ||
      (tail.includes("as const") && text.includes(`typeof ${opened.name}`));
    if (derived) for (let n = opened.at; n <= index; n += 1) typed.add(n);
    opened = null;
  }
  return typed;
}

function isIdentity(value: string): boolean {
  return (
    !/\s/u.test(value) &&
    (value.length >= LENGTH_FLOOR || FILE_NAME.test(value)) &&
    (value.includes("/") || value.includes(".")) &&
    !NOT_A_NAME.some((mark) => value.includes(mark)) &&
    !ownedElsewhere(value)
  );
}

/** Every identity one file spells, with the constant naming it where its line declares one. */
function spellingsOf(path: string, text: string): Spelling[] {
  const lines = text.split("\n");
  const typedLines = typedTableLines(lines, text);
  const specifiers = [...text.matchAll(INLINE_IMPORT)].flatMap(([, one = ""]) => [
    one,
    ...ALIASES.flatMap(([key = "", tree = ""]) =>
      one.startsWith(key) ? [tree + one.slice(key.length)] : [],
    ),
  ]);
  const loaded = (value: string): boolean =>
    specifiers.some((one) => one === value || one.endsWith(`/${value}`));
  return lines.flatMap((line, index): Spelling[] => {
    if (SKIPPED_LINE.test(line)) return [];
    const at = { path, line: index + 1, owner: null, exported: false, typed: false };
    const joined = [...line.matchAll(JOIN_CALL)].flatMap(([, args = ""]) =>
      [...args.matchAll(ADJACENT_SEGMENTS)].map(([run]) =>
        [...run.matchAll(QUOTED)].map(([, one]) => one).join("/"),
      ),
    );
    const naming = OWNING_CONST.exec(line);
    return [
      ...joined.filter((value) => isIdentity(value) && !loaded(value)).map((value) => ({ ...at, value })),
      ...codeLiterals(line)
        .filter(({ value }) => isIdentity(value) && !loaded(value))
        .map(({ value, at: column }) => ({
          ...at,
          value,
          owner: naming?.[2] === value ? (naming[1] ?? null) : null,
          exported: /^\s*export\b/u.test(line),
          typed:
            typedLines.has(index) ||
            TYPE_DECLARATION.test(line) ||
            line.slice(0, column).endsWith("Type.Literal(") ||
            (TYPE_MEMBER.test(line.slice(0, column)) && line[column + value.length + 2] === ";"),
        })),
    ];
  });
}

/** What the row asks for. An owner of a longer path ending in the name counts: the repair is to
 *  derive the name from it, not to give it a second owner (judged on 1 October). */
function ownerClause(owner: Spelling | undefined, value: string): string {
  if (owner === undefined) return "and no file names it";
  const where = `\`${owner.owner}\` in ${owner.path}`;
  const names = owner.value === value ? "names it" : `names it as \`${owner.value}\``;
  return owner.exported ? `and ${where} already ${names}` : `and ${where} ${names} but does not export it`;
}

/** A name spelled in several files, anchored at a spelling that is not its declaration. */
export function identitiesWithoutOwner(files: ReadonlyMap<string, string>): TreeFinding[] {
  const spellings = Map.groupBy(
    [...files].flatMap(([path, text]) => spellingsOf(path, text)),
    (one) => one.value,
  );
  const owners = [...spellings.values()].flat().filter((one) => one.owner !== null);
  return [...spellings].flatMap(([value, found]): TreeFinding[] => {
    const count = new Set(found.map((one) => one.path)).size;
    const anchor = found.find((one) => one.owner === null) ?? found[0];
    const floor = value.length < LENGTH_FLOOR ? SHORT_FILE_FLOOR : FILE_FLOOR;
    if (count < floor || anchor === undefined || found.some((one) => one.typed)) return [];
    const owner =
      found.find((one) => one.owner !== null) ?? owners.find((one) => one.value.endsWith(`/${value}`));
    const detail = `\`${value}\` is spelled in ${count} files ${ownerClause(owner, value)}`;
    return [{ kind: "identity-without-owner", path: anchor.path, line: anchor.line, detail }];
  });
}
