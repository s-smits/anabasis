/**
 * One name this repository owns, spelled as a literal in more than one file.
 *
 * Split out of `tree-findings.ts` when that file reached its 600-line budget with six scans in it.
 * This is the largest of them and the only one that has to decide what counts as a name at all,
 * so it carries its own dials.
 */
import { ownedElsewhere } from "./ana/shared/literal-owner.ts";
import type { TreeFinding } from "./tree-findings.ts";

/** Characters below which an identity is a word — `id.ts`, `a/b` — rather than a name. */
const IDENTITY_LENGTH_FLOOR = 15;

/** Files spelling one identity at which the tree plainly has no single owner for it. */
const IDENTITY_FILE_FLOOR = 2;

/**
 * A file name with a stem and an extension, which is a name at any length.
 *
 * The length floor hid the shape the record carries most. Both commits that opened this scan's
 * group named files under fifteen characters: `RECEIPT` for four `*.json` receipts, `OPENING`,
 * `TERMINAL` and `BATTERY` on 2026-09-20, and on the same day's tree `battery.json` stood in seven
 * files, `opening.json` in six, `tasks.json` in four, each with an unexported constant or none.
 * A short name is read as one when it has a stem and an extension, at a floor of three files,
 * because two files agreeing on `index.ts` or `entry.ts` share a word rather than a layout. A bare
 * `.json`, a dot-directory `.codex` and `127.0.0.1` all fail the stem.
 */
const FILE_NAME = /^[A-Za-z][\w-]*(?:[/.][\w-]+)*\.[\w-]+$/u;

/** Files spelling one short name at which it is a layout rather than a coincidence. */
const SHORT_NAME_FILE_FLOOR = 3;

/** Spellings that are not a name: an interpolation fragment, an assignment, a namespaced slug. */
const NOT_A_NAME = ["${", "=", ":"];

/** A double-quoted literal's contents, within one line. */
const QUOTED = /"((?:[^"\\\n]|\\.)*)"/gu;

/**
 * A line the module system owns, where the specifier is not this file's spelling.
 *
 * `export` alone would have been wrong: `export const TASKS_FILE = "…"` is the declaration this
 * scan looks for, so only a re-export — `export * from`, `export { … } from` — is the module
 * system's, and any line carrying `from "…"` is one whichever keyword opened it.
 */
const IMPORT_LINE = /^\s*import\s|^\s*export\s+[*{]|\bfrom\s*"/u;

/**
 * A specifier inside an inline `import("…")`, wherever on the line it sits.
 *
 * `.claude/skills/launch-run/scripts/probe.ts` loads each module out of the *target* checkout, so
 * every call spells the path twice: `target<typeof import("../../../../src/run/source-identity.ts")>`
 * takes the repo-relative `"src/run/source-identity.ts"` as its argument. The type half is the
 * module system's own spelling and the compiler resolves it; the runtime half is the same name one
 * directory prefix shorter. A loader naming a module in another tree has no third spelling
 * available, because TypeScript cannot take an `import()` type from a runtime string, so the pair
 * is the helper working as intended. Five of 37 rows were this one file.
 */
const INLINE_IMPORT = /\bimport\(\s*"((?:[^"\\\n]|\\.)*)"/gu;

/**
 * A line turning a path into a file URL, which is the loader above without an `import()` to spell.
 *
 * `Bun.pathToFileURL(join(worktree, "src/meta/json-runtime.ts")).href` in `stage-run.mts` names a
 * module of the checkout being staged, for a child Bun process to import there, so the child's
 * script has no type position to carry a specifier. The path is the module system's name for that
 * file, and a rename fails the loader with the path in the message, which a constant would not
 * improve. On 2026-09-22 it was the one row of this shape, beside the `MODULE` constant of
 * `require-captured-json-runtime.ts`, which names the same path as the file its rule governs in
 * this tree. A path joined onto another root without the call is still read.
 */
const FILE_URL_LOADER = /\bpathToFileURL\(/u;

/** A comment line: an example in prose is a reading of the name, not a second copy of it. */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/u;

/**
 * A path assembled from separate segments inside one `join(…)` call.
 *
 * `join(slugDir, "agent", "tools-spec.json")` spells the same name as `"agent/tools-spec.json"`
 * and the scan read straight past it: two literals, neither of them an identity on its own. That
 * blindness hid 22 of the 90 sites the first sweep of this group had to fix. Only a `join` call
 * counts, because `["agent", "correctness-model"]` is a list of two directories and pasting them
 * together would invent a third name that no tree has.
 */
const JOIN_CALL = /\bjoin\(([^()]*)\)/gu;

/** Two or more quoted segments in a row, which `join` will separate with one slash. */
const ADJACENT_SEGMENTS = /"((?:[^"\\\n]|\\.)*)"(?:\s*,\s*"((?:[^"\\\n]|\\.)*)")+/gu;

/**
 * The text before a literal that is the declared type of a member, not a value assigned to one.
 *
 * `schema: "control-receipt/v2";` inside an interface makes that string the field's type, so every
 * writer assigning it and every reader comparing against it is checked: a typo in any copy is a
 * build failure, which is the same reason `no-repeated-string-literal` leaves a bare tag alone. The
 * closing `;` is what separates it from `schema: "control-receipt/v2",` in an object literal, where
 * nothing checks the characters. 13 of 54 rows were this, all of them versioned schema tags.
 */
const TYPE_MEMBER = /(?:^\s*|[{|,(]\s*)(?:readonly\s+)?[A-Za-z_$][\w$]*\??:\s*$/u;

/** TypeBox's literal, which compiles a runtime validator from the same one type. */
const TYPE_BOX = "Type.Literal(";

/**
 * A line that declares a type, where a literal is a type rather than a value assigned to one.
 *
 * `type VerifierSandboxLevel = … | "darwin-seatbelt/v1" | …` makes that union the compiler's, and
 * `DARWIN_SEATBELT_ID = "darwin-seatbelt/v1" as const` is then checked against it wherever the two
 * meet. The member form above reads `schema: "tag/v2";` and read straight past this, which is the
 * same fact written as a union. A wrapped union's arms are their own lines, so an arm opening with
 * `|` counts too.
 */
const TYPE_DECLARATION = /^\s*(?:export\s+)?(?:declare\s+)?type\s|^\s*\|\s*"/u;

/** A constant opening an array or object literal, with the indent its own closing line carries. */
const OPENS_LITERAL = /^(\s*)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*[[{]\s*$/u;

/** The line closing one, where `as const` or `satisfies` may make its entries the compiler's. */
const CLOSES_LITERAL = /^[\]}](.*)$/u;

/** A constant declared as one string: `const TASKS_FILE = "correctness-model/tasks.json"`. */
const OWNING_CONST = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*"((?:[^"\\\n]|\\.)*)"/u;

/**
 * A declaration other files can reach, which is what separates the two repairs.
 *
 * `FROZEN_MANIFEST_PATH` in `src/critic/manifest.ts` and `EVIDENCE_FILE` in `claim-stages.ts` are
 * both private, so the files spelling those names again had nothing to import even though the row
 * said a constant already named it. 7 of the 17 owned rows measured on 2026-09-20 were this.
 */
const EXPORTED = /^\s*export\b/u;

interface IdentitySpelling {
  value: string;
  path: string;
  line: number;
  /** The constant this line declares for the value, when the line is that declaration. */
  owner: string | null;
  /** Whether that declaration is exported, which is what decides the repair is an import. */
  exported: boolean;
  /** Whether this spelling is the value's declared type, which makes every other copy checked. */
  typed: boolean;
}

/**
 * The lines of a literal the compiler takes a type from.
 *
 * `const ISOLATION_FIXTURES = […] as const` beside `type IsolationFixture = (typeof ISOLATION_FIXTURES)[number]`
 * makes the union the compiler's, and `{…} satisfies Record<IsolationFixture, …>` makes every key checked
 * against it. That the check reaches another file was measured rather than assumed: mistyping
 * `host-seatbelt-read-deny/v1` in `src/verify/solve-sandbox.ts`, which declares its own constant four
 * files away from the array, fails the build in four places.
 *
 * `as const` alone is not enough, and reading it that way silenced three true findings. The eight
 * paths in `EXECUTABLE_ROOTS` in `src/run/source-identity.ts` are `as const` too, and nothing takes a
 * type from that array, so `thresholds.frozen.yaml` in the other four files is checked by nobody. The
 * block is closed at its opening indent rather than by counting brackets, because a bracket inside a
 * string drifts the count and one drift swallows the rest of the file.
 */
function typedLiteralLines(lines: readonly string[], text: string): ReadonlySet<number> {
  const typed = new Set<number>();
  let opened: { at: number; indent: string; name: string } | null = null;
  for (const [index, line] of lines.entries()) {
    const opening: RegExpExecArray | null = opened === null ? OPENS_LITERAL.exec(line) : null;
    if (opening !== null) opened = { at: index, indent: opening[1] ?? "", name: opening[2] ?? "" };
    if (opened === null || !line.startsWith(opened.indent)) continue;
    const closing = CLOSES_LITERAL.exec(line.slice(opened.indent.length));
    if (closing === null) continue;
    const tail = closing[1] ?? "";
    // `satisfies Partial<Record<FeedbackOwner, readonly string[]>>` checks the keys and leaves
    // every value a `string`, and reading it as typed silenced `correctness-model/brief.json` in
    // the nineteen other files of the group this scan opened on. A type that says `string` checks
    // no spelling.
    const derived =
      (tail.includes("satisfies") && !/\bstring\b/u.test(tail)) ||
      (tail.includes("as const") && text.includes(`typeof ${opened.name}`));
    if (derived) for (let n = opened.at; n <= index; n += 1) typed.add(n);
    opened = null;
  }
  return typed;
}

/** Whether a literal is a name this repository owns, rather than a word or another program's. */
function identityLiteral(value: string): boolean {
  if (/\s/u.test(value)) return false;
  if (value.length < IDENTITY_LENGTH_FLOOR && !FILE_NAME.test(value)) return false;
  if (!value.includes("/") && !value.includes(".")) return false;
  if (NOT_A_NAME.some((mark) => value.includes(mark))) return false;
  return !ownedElsewhere(value);
}

/** The names one line assembles with `join`, each as the single path its segments spell. */
function joinedSegments(line: string): string[] {
  const names: string[] = [];
  for (const call of line.matchAll(JOIN_CALL)) {
    for (const run of (call[1] ?? "").matchAll(ADJACENT_SEGMENTS)) {
      names.push([...run[0].matchAll(QUOTED)].map((one) => one[1] ?? "").join("/"));
    }
  }
  return names;
}

/** Every identity-shaped literal in one file, with the constant naming it where a line declares one. */
function identitySpellings(path: string, text: string): IdentitySpelling[] {
  const found: IdentitySpelling[] = [];
  const lines = text.split("\n");
  const typedLines = typedLiteralLines(lines, text);
  const specifiers = [...text.matchAll(INLINE_IMPORT)].map((one) => one[1] ?? "");
  // `#src/x.ts` names `src/x.ts`: the root manifest maps every `#tree/*` onto `./tree/*`.
  const moduleSpelling = (value: string): boolean =>
    specifiers.some((one) => one === value || one === `#${value}` || one.endsWith(`/${value}`));
  for (const [index, line] of lines.entries()) {
    if (IMPORT_LINE.test(line) || COMMENT_LINE.test(line) || FILE_URL_LOADER.test(line)) continue;
    const naming = OWNING_CONST.exec(line);
    for (const match of joinedSegments(line)) {
      if (identityLiteral(match) && !moduleSpelling(match)) {
        found.push({ value: match, path, line: index + 1, owner: null, exported: false, typed: false });
      }
    }
    for (const match of line.matchAll(QUOTED)) {
      const value = match[1] ?? "";
      if (!identityLiteral(value) || moduleSpelling(value)) continue;
      const before = line.slice(0, match.index ?? 0);
      found.push({
        value,
        path,
        line: index + 1,
        owner: naming?.[2] === value ? (naming[1] ?? null) : null,
        exported: EXPORTED.test(line),
        typed:
          typedLines.has(index) ||
          TYPE_DECLARATION.test(line) ||
          before.endsWith(TYPE_BOX) ||
          (TYPE_MEMBER.test(before) && line.slice((match.index ?? 0) + match[0].length).startsWith(";")),
      });
    }
  }
  return found;
}

/** What the row asks for, which is a different question in each of the three cases. */
function ownerClause(owner: IdentitySpelling | undefined): string {
  if (owner === undefined) return "and no file names it";
  const where = `\`${owner.owner}\` in ${owner.path}`;
  return owner.exported ? `and ${where} already names it` : `and ${where} names it but does not export it`;
}

/** A name spelled in several files, which is where the repeat this tree actually carries lives. */
export function identitiesWithoutOwner(declaring: ReadonlyMap<string, string>): TreeFinding[] {
  const spellings = new Map<string, IdentitySpelling[]>();
  for (const [path, text] of declaring) {
    for (const found of identitySpellings(path, text)) {
      spellings.set(found.value, [...(spellings.get(found.value) ?? []), found]);
    }
  }
  const findings: TreeFinding[] = [];
  for (const [value, found] of spellings) {
    const files = new Set(found.map((one) => one.path));
    // The declaration is the one line that is not the work, so a row anchored there sends the
    // reader off to find the other file. Anchor at a spelling that does not own the name.
    const anchor = found.find((one) => one.owner === null) ?? found[0];
    const floor = value.length < IDENTITY_LENGTH_FLOOR ? SHORT_NAME_FILE_FLOOR : IDENTITY_FILE_FLOOR;
    if (files.size < floor || anchor === undefined) continue;
    if (found.some((one) => one.typed)) continue;
    findings.push({
      kind: "identity-without-owner",
      path: anchor.path,
      line: anchor.line,
      detail: `\`${value}\` is spelled in ${files.size} files ${ownerClause(found.find((one) => one.owner !== null))}`,
    });
  }
  return findings;
}
