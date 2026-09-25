// The simplify findings that need the whole tree in view at once. An oxlint plugin sees one file
// at a time, so none of these can be a rule: "this export has exactly one reader", "this export's
// only reader is its test", "these six lines are in two files", "nothing ever reads this field",
// "this file imports eleven names from one module". Each was the shape of a recorded `/simplify`
// removal, and each is invisible from inside the file that carries it.
//
// Every scan here is textual and fails open: a name mentioned in a comment or a string counts as
// read. What survives is a name no file spells at all, or spells in exactly one place. That makes
// the output a census a person reads rather than a gate, which is what it is used as —
// `tools/oxlint/simplify-census.ts` prints it beside the oxlint catchers.

import { existsSync, readFileSync } from "../../src/meta/filesystem.ts";
import {
  AUTHORED_ROOTS,
  copiedFileLimits,
  corpus,
  NEW_FILE_CEILING,
  READ_AS_SOURCE,
  READER_ROOTS,
} from "../loc/source-policy.ts";
import { compatibilityPaths } from "./tree-compat-path.ts";
import { copiedBlocks } from "./tree-copied-block.ts";
import { identitiesWithoutOwner } from "./tree-identity.ts";
import { unproducedSetMembers } from "./tree-closed-set.ts";
import { unreadModules } from "./tree-module.ts";
import { supersededSchemaTags } from "./tree-schema-tag.ts";
import {
  NOT_SLOP_LEDGER,
  type Place,
  readLedger,
  siteExcerpt,
  siteId,
  TREE_RULE_PREFIX,
} from "./not-slop-ledger.ts";

/** Roots whose contents are candidates: authored source this repository owns, skill scripts included. */
const DECLARING_ROOTS = [...AUTHORED_ROOTS, ".claude"] as const;

/** Where a module may be named without being imported: a `package.json` script, a workflow, a
 *  hook, a SKILL.md line telling the operator what to run. Only the module scan reads these. */
const PROSE_ROOTS = [...READER_ROOTS, "docs", ".github", ".codex", ".config", ".harness"];
const PROSE_SUFFIXES = [".md", ".cjs", ".zsh", ".sh", ".yml", ".yaml", ".toml", ".html"];
const ROOT_FILES = [
  "package.json",
  "bunfig.toml",
  "biome.json",
  ".oxlintrc.json",
  "tsconfig.json",
  "AGENTS.md",
  "README.md",
  ".githooks/pre-commit",
  ".githooks/pre-push",
];

/** A declaration carrying `export` and a name of its own, as `source-policy.ts` reads them. */
const EXPORTED =
  /^export (?:declare )?(?:async )?(interface|type|function|const|let|class|enum|abstract class) ([A-Za-z_$][\w$]*)/gm;

/** The head of a declared object shape: `interface Row {`, `type Row = {`, exported or not. */
const DECLARATION_HEAD = /^(?:export )?(?:declare )?(?:interface|type) [A-Za-z_$][\w$]* ?(?:=)? ?\{\s*$/u;

/** A field inside one of those shapes: `verifiedPasses: number` or `owner?: Owner | null`. */
const DECLARED_FIELD = /^\s+(?:readonly )?([A-Za-z_$][\w$]*)\??:/u;

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

/** The names a reader imports from each same-directory module: `import { a, b as c } from "./x.ts"`. */
const SIBLING_IMPORT = /import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+\.tsx?)"/gu;

/** Names one file may import from `src/meta/filesystem.ts` before the count is the finding. */
const FILESYSTEM_BUDGET = 6;

/** A field name shorter than this is a word — `path`, `kind`, `text` — and says nothing alone. */
const FIELD_LENGTH_FLOOR = 7;

/** A rule registration inside a plugin's `rules` block: `"<name>": <rule>,`. */
const REGISTERED_RULE = /^\s*"([a-z][a-z0-9-]*)":\s*[A-Za-z]/gmu;
type TreeFindingKind =
  | "single-reader-export"
  | "test-only-export"
  | "copied-block"
  | "unread-field"
  | "rule-without-fixture"
  | "identity-without-owner"
  | "superseded-schema-tag"
  | "compatibility-path"
  | "unproduced-set-member"
  | "orphan-module"
  | "test-only-module"
  | "filesystem-import-budget";
export interface TreeFinding {
  /** Which scan found it, used as the census heading. */
  kind: TreeFindingKind;
  path: string;
  /** 1-based line of the declaration, or 0 when the finding is about the file as a whole. */
  line: number;
  detail: string;
  /** Every place the site spans, first line to last, when it is more than the one line above. */
  places?: readonly { path: string; line: number; end: number }[];
}

/** A finding with the id and excerpt the not-slop ledger names it by. */
export interface TreeSite extends TreeFinding {
  id: string;
  excerpt: string;
}

/**
 * Kinds that are a standing register rather than a list to empty.
 *
 * The filesystem budget is a rule about the delta — a file keeps its count and a change adds at
 * most one — so its rows are the current counts, and no reading of them is a repair. Counted as
 * findings they put a permanent floor under a total whose whole point is that it can reach zero.
 */
export const TREE_REGISTER_KINDS: readonly TreeFindingKind[] = ["filesystem-import-budget"];

/** Why each shape is a finding, printed once above its sites. */
export const TREE_FINDING_ARGUMENTS: Readonly<Record<TreeFindingKind, string>> = {
  "single-reader-export":
    "A file whose one exported declaration is a function or class of 10 to 60 lines, read by exactly one other file in the same directory that has room to hold it. Answering yes deletes a file. This is the largest shape in the recorded corpus that no per-file rule can see: 86 of the 138 net-negative /simplify commits moved a module-scope helper into its single caller, and the helpers that went were that size. The question is whether the code is in the right module, not whether it should exist. Five things are not counted, each for the same reason — the move would remove nothing. A type, an interface or a plain constant belongs beside the value it describes, and moving one into its reader inverts the dependency. Under ten lines, the export is the module's own fact held for one consumer, and the move copies that fact into a second owner. Over sixty, it is a module in its own right. A reader already near the file ceiling has no spelling that absorbs it. And a file whose export its reader lists in one array literal beside the exports of two or more same-directory peers sharing its name up to the first hyphen is one of a family, such as the six `tree-*.ts` scans `tree-findings.ts` spreads into one list: folding one in removes a file and leaves a shape nobody can find by name. Importing such peers for separate uses does not make a family.",
  "test-only-export":
    "An exported function or class whose only reader is a test, and which its own module never calls either. Nothing in the product runs it: the test is the whole of its life, so it passes and proves nothing about a path the product takes. Delete the code and the test together, or find the caller that was meant to exist. What is not counted is the ordinary case, and it is 89 of the 92 sites this scan reported before 2026-09-20: a function its module does call, exported so a test can name the unit. `isolationArgv` builds a sandbox argv and `HarnessConfigError` is thrown two lines below its declaration; asking either to be reached only through the module's entry point asks for a Linux namespace and a worse test. A type or a constant a test imports is how a fixture is typed, so neither is counted.",
  "copied-block":
    'Two or more consecutive statements, 64 or more tokens and three or more lines at every place, written out at two or more places in one package, none of them a test, fixture, example, template or vendored file. The comparison is over the parsed syntax: a name the enclosing function binds for itself and every literal count as one token whatever they spell, while an imported or module-level name keeps its spelling, so two blocks calling different functions never match. Formatting, comments, types and import lists do not reach the comparison. Each copy is reported once at its full extent, at its first place, naming the others. Judged blind on 2026-09-21 by the question "should this get one owner?", with the judge calibrated to understate a yes: of every site the frozen rule reports at 25 revisions of main since 15 July, 51 of 71 (0.72), and 14 of the 22 no judge had seen before (0.64). Other TypeScript projects keep more copies on purpose, and there it reads about 0.3. What was answered no: a frozen legacy validator beside its successor, two short adjacent branches of one function, two guards printing different messages, two branches differing only in how they narrow a type. A copy is the question worth asking, not proof: where an owner already exists, the detail\'s other places show it.',
  "unread-field":
    "A field declared in an interface or type literal whose name appears exactly once in the whole tree — its own declaration. Nothing reads it, writes it, destructures it or names it in a string, so it is state the code carries, serialises and keeps in step for no reader.",
  "rule-without-fixture":
    "A rule one of the two plugins registers that no file under test/ names. A rule is source, and its only proof is a fixture that makes it report. The metadata contract in oxlint-rule-contract.test.ts reads every rule's declaration and none of their behaviour, so a rule that has stopped reporting — an AST field renamed under it, a node type an oxlint upgrade no longer hands it — passes that test, reports nothing, and the gate goes quiet in exactly the way a clean tree does. That is the same silence this whole file exists to catch, one level up: a scan with a mistyped root and a rule with no fixture both read as good news. Measured 2026-09-20: 41 of 49 registered rules are named somewhere under test/, and the 8 that are not are all in the vendored plugin, whose pinned-upstream premise this repository has never written down anywhere a reader can check.",
  "identity-without-owner":
    'One name this repository owns — a bundle path, an evidence file, a schema tag — spelled as a literal in two or more files, with no constant naming it. The per-file rule ana/no-repeated-string-literal cannot see this: it counts spellings within one file and its floor is four, so a name spelled twice in each of twelve files is invisible to it twelve times over. Nothing checks these copies against each other; the compiler owns a union member and a typo in one is a build failure, but correctness-model/evaluator.ts is characters, and a wrong one reaches a reader as a missing file rather than as a mistyped name. The detail says whether a constant already names it, because the two cases have different repairs: import the owner, or decide where the owner goes. A literal under fifteen characters, one carrying whitespace, one with neither a slash nor a dot, and one beginning with a prefix another program or registry owns are all skipped, as are import lines and comment lines, where the spelling is the module system\'s or an example in prose. Two readings were added after the first group was fixed by hand. A name assembled inside a `join(\u2026)` call from quoted segments in a row is read as the one path those segments spell, because `join(dir, "agent", "tools.ts")` and `"agent/tools.ts"` are the same name and only the second was visible \u2014 that blindness hid 22 of the 89 sites the bundle-layout group turned out to have. And a literal in a type position is skipped, because `schema: "control-receipt/v2";` declared as a member\'s type makes every other copy of it checked by the compiler, so a typo in any of them is a build failure: the same reason a bare union tag is skipped, and 13 of 54 rows, all versioned schema tags. A type declaration and an `as const` block a type is derived from are that same fact twice more: `type VerifierSandboxLevel = \u2026 | "darwin-seatbelt/v1"` and `const ISOLATION_FIXTURES = [\u2026] as const` beside `(typeof ISOLATION_FIXTURES)[number]` both hand every other copy to the compiler. That the check crosses files was measured rather than assumed: mistyping one of those fixtures in a file that declares its own constant four files away fails the build in four places. `as const` alone is not enough, and reading it that way silenced three true rows \u2014 nothing takes a type from `EXECUTABLE_ROOTS` in src/run/source-identity.ts, so `thresholds.frozen.yaml` in the other four files is checked by nobody. A path an inline `import("\u2026")` in the same file already spells is skipped one level up from that: a loader reaching into another checkout writes the specifier for the compiler and the repo-relative tail for the runtime, and TypeScript cannot take an `import()` type from a runtime string, so the pair has no third spelling to collapse into. That was 5 of 37 rows, all in one file. A line handing a path to `pathToFileURL` is that loader without an `import()` to spell, and is skipped too: a dynamic `import()` of a path joined onto the repository root names a module where no type position exists. Two readings were narrowed on 2026-09-21 against the record of the two commits that opened this group. A short name with a stem and an extension — `battery.json`, `opening.json`, `agent/tools.ts` — is a name at any length, at a floor of three files rather than two, which found fourteen standing rows the fifteen-character floor had hidden. And `satisfies` makes a block the compiler\'s only when the type it names says nothing about `string`: `satisfies Partial<Record<FeedbackOwner, readonly string[]>>` checks the keys, and reading it as typed had silenced `correctness-model/brief.json` in nineteen other files.',
  "superseded-schema-tag":
    "A versioned tag — `case-trace/v1`, `campaign-opening/v1` — spelled outside a comment in a file after some file in the tree spells a higher version of the same name; one row per file and name at the first old spelling, naming where the latest lives, tests left out. Measured 2026-09-21 over the simplify record: 51 sites at the parents of 239 simplify commits, 37 gone by the record head (0.73, or 0.51 with the file still there), 13 removed by a simplify commit itself, and 13 of the 27 sites whose file a simplify commit ever touched went with that commit (0.48). Per visit it is 11 of 60 (0.18), because a readable set is touched many times and survives each one, which puts it beside the other scans rather than above them. What goes is the reader of a record nobody writes any more: the `v1 || v2` acceptance, the migration branch, the array of every schema the archive ever held. What stays is deliberate — a type union that still admits the old row, a readable set naming every version recorded — and no spelling separates the two: exempting a site whose own line also spells the latest drops the simplify-removed sites from 13 to 6, because `v1 || v2` collapsing to `v2` is exactly the move. The row also catches a reader the writer left behind, which is a defect rather than a simplification: at 25fb05f74, `rebuild-advice/v1` in current-readers.mjs against the `v2` written since f5dfb86a1, and `outcome-snapshot-status/v1` in select-best-runs.mjs against the `v2` trace-review.mjs writes.",
  "compatibility-path":
    "A production file spelling legacy inside a longer name — a function, a constant, a kebab-case state — outside a comment; one row per file at the first spelling, every name listed. The tree keeps no backwards compatibility (operator decision 2026-09-21), and a name like that is the author saying the code reads or accepts what an older version left behind. Measured 2026-09-21 over the simplify record: 61 names in 30 files, 54 gone by the record head (0.89) and every name gone from 25 of the 30 files (0.83, Wilson lower bound 0.66); on the second half of the record 28 of 32 (0.88), against 0.30 for other rare names of the same files. The bare word in a message is prose and is not counted.",
  "unproduced-set-member":
    'A member of a literal union — a `type Stage = "kickoff" | …` alias or a `reason: "no-feedback" | …` property — that no production file spells on a code line outside the declaration; the row says whether a test spells it. The union is the compiler\'s list of every value a field may hold, so a member nothing produces is a branch the consumer keeps for a value that never arrives, or prose promising a mechanism the source does not have. Measured 2026-09-21 over the simplify record: 16 union and 9 property members flagged at the parents of 239 simplify commits, 19 of the 25 gone or produced by the record head (0.76), six of them the members of two difficulty vocabularies that left together. A simplify commit itself removed 3 of 20 per visit, all three members of one vocabulary it took at once, against a base rate of 0.05 to 0.08; the scan stands on the eventual rate and on what it found at 25fb05f74: three `SessionBuildStage` members no file produces, a lineage reason AGENTS.md rule 7 still names that src/run/admission.ts never writes, and one member each of `EvaluatorIndependence` and `Altitude`, named in its module\'s header and produced nowhere. `as const` arrays are left out at 109 sites and 0.52: what they hold is another program\'s vocabulary, bubblewrap paths, JSON-schema keys and package.json fields, which this tree lists rather than produces.',
  "orphan-module":
    'A code file under a source root that no file imports, spawns or names: not an import specifier, not a `new URL("./x-child.ts", import.meta.url)`, not a package.json script, not a hook, workflow or SKILL.md line. Nothing runs it, so it is a mechanism the tree has already stopped using and kept the bytes of. Over 117 sampled revisions of main the tree held five of these in all, and every one was deleted or given a reader by 2026-09-20, against 0.28 for a module with two or more readers. No simplify commit ever met one, so this is the eventual rate, not a per-visit one. A test is not a candidate, and a comment line naming a file does not count as reading it.',
  "test-only-module":
    "A production module whose only readers are tests: nothing the product runs imports or names it, and the test that does is the whole of its life. Either the caller it was written for never arrived, or it left and took the last production import with it. Over 117 sampled revisions of main the tree held eight, and six were deleted or given a caller by 2026-09-20; the two standing at the record head ee766c7e2 were src/meta/assert.ts, a test helper living under src/ that four skill tests import, and src/solve/public-artifact-schema-degeneracy.ts, which two tests imported and no solve path called; this branch deleted the second and its `require-meta-runtime-import` rule names the first, so the scan writes no row at its head. A helper a skill's tests share is counted as a test, so `test-support.mjs` is not a row.",
  "filesystem-import-budget":
    "Names imported from src/meta/filesystem.ts, against the operator's budget of 2026-09-15: a file keeps its count, a change adds at most one, and needing more means a redesign. measure.py checks the delta on a diff; this lists the standing counts, so a file already carrying a large one is visible before a change is proposed against it.",
};

/**
 * The declaration keywords for code a caller could absorb. A `const` joins them when it holds an
 * arrow function.
 *
 * The corpus is about helpers: 86 of the 138 net-negative commits moved a module-scope function
 * of 10 to 60 lines into the one file that called it. A type or an interface is not that. It
 * belongs beside the value it describes, and the import runs producer to consumer, which is the
 * direction that is already right — moving `StalenessEvidence` out of `claim-evidence.ts` and
 * into its one reader would invert the dependency to remove nothing. A plain constant is the
 * same case: `WORKER_BINDING_MISMATCH` is the worker protocol's own fact, and its single reader
 * is a consumer of that protocol, not its owner. Measured 2026-09-20: of 484 single-reader
 * exports 246 were types, interfaces and plain constants, leaving 238 that can move, and of 154
 * test-only exports, 62.
 */
const MOVABLE_DECLARATIONS = new Set(["function", "class", "abstract class"]);

/** A line that ends the declaration above it: its own closing brace, or the next thing declared. */
const DECLARATION_END =
  /^(?:[})]|export |function |const |let |class |interface |type |enum |declare |\/\*\*|\/\/)/u;

/** Roots a move could land in. A skill script under `.claude` reads repository source and cannot
 *  receive it, so an export whose one reader lives there has nowhere to go. */
const MOVE_TARGETS = ["src/", "tools/", "packages/"];

/** Where one exported name is declared, and whether it is code that could move to a caller. */
interface Declaration {
  path: string;
  line: number;
  movable: boolean;
  /** Lines the declaration occupies, head and closing brace included. */
  lines: number;
}

/** Which files spell each identifier at all, for the reader-count scans. */
function readers(files: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [path, text] of files) {
    for (const name of new Set(text.match(IDENTIFIER) ?? [])) {
      const paths = found.get(name) ?? new Set<string>();
      paths.add(path);
      found.set(name, paths);
    }
  }
  return found;
}

/**
 * Line counts either side of the window the recorded corpus actually moved.
 *
 * The argument above this scan has always named the window and the code has never applied it:
 * "the helpers that went were 10 to 60 lines". Below ten, the export is the module's own fact
 * held in a few lines for one consumer, and moving it copies that fact into a second owner —
 * `controllerLedgerPath` derives the ledger's path from the campaign root in three lines, and
 * its one reader is a consumer of the ledger, not its owner. That is the same argument that
 * already keeps a plain constant out. Above sixty, the export is a module in its own right and
 * the move is a rename of where a file lives. Measured 2026-09-20: 244 sites, 124 inside the
 * window, with 49 below four lines, 65 between five and nine, and 6 over sixty.
 */
const HELPER_LINES = { least: 10, most: 60 } as const;

/**
 * How many lines a declaration occupies, counted textually: from its head to the first line at
 * column zero that either closes it or starts the next thing. A one-line arrow constant is one
 * line, because the line after it already begins something else.
 */
function declarationLines(lines: readonly string[], head: number): number {
  let end = head + 1;
  while (end < lines.length && !DECLARATION_END.test(lines[end] ?? "")) end += 1;
  return end - head + (/^[})]/u.test(lines[end] ?? "") ? 1 : 0);
}

/** The file each exported name is declared in; `null` when two files declare it. */
function declared(files: ReadonlyMap<string, string>): Map<string, Declaration | null> {
  const home = new Map<string, Declaration | null>();
  for (const [path, text] of files) {
    const lines = text.split("\n");
    for (const match of text.matchAll(EXPORTED)) {
      const name = match[2] ?? "";
      const before = text.slice(0, match.index);
      const head = text.slice(match.index, text.indexOf("\n", match.index));
      const keyword = match[1] ?? "";
      const movable = MOVABLE_DECLARATIONS.has(keyword) || (keyword === "const" && head.includes("=>"));
      const at = before.split("\n").length - 1;
      home.set(
        name,
        home.has(name) ? null : { path, line: at + 1, movable, lines: declarationLines(lines, at) },
      );
    }
  }
  return home;
}

/**
 * Whether a production export can move into the one file that reads it. Five questions, because
 * the move has to be legal as well as smaller: the export is the size the corpus moved, the
 * reader has room, the home file holds nothing else, the two sit in one directory, and the
 * reader imports the module rather than launching it.
 *
 * Room is the reader's own ceiling in `tools/loc/source-policy.ts`, because reporting a move the
 * gate then refuses asks for a change nobody can make: a file in `copiedFileLimits` is frozen at
 * the size it had, and `src/truth/probes.ts` sits on 436 of 436, so nothing can move into it at
 * all. `ana/no-single-caller-helper` makes the same arithmetic for the same reason, after six
 * sites in one pass turned out to be exactly that. Five of 66 here.
 *
 * Both the size and the room are measured on the whole home file, not on the exported declaration,
 * because the file is what moves: it holds one export, so its private helpers, imports and comments
 * arrive with it. Measuring the declaration instead is what the scan did until 2026-09-20 and it
 * misread two of the three rows it then carried. `tools/oxlint/tree-identity.ts` is a 24-line
 * export inside 211 lines of its own scan, and `packages/ui/src/views/climb.tsx` a 55-line chart
 * beside the private tooltip it renders; both read as helpers and both are the thing the argument
 * above calls a module in its own right. What is left is the case the shape describes: one small
 * file, a reader in the same directory, and a merge that deletes a file.
 */
/**
 * The array literal holding the text at `at`: from the nearest `[` left open before it through
 * the `]` that closes it, or empty when `at` sits in no list. Brackets are counted as text, so a
 * `[` inside a string or a regular expression can misplace the list; a misplaced list only loses
 * the family admission, and the export is then reported as any other.
 */
function enclosingList(text: string, at: number): string {
  let open = at - 1;
  for (let depth = 0; open >= 0; open -= 1) {
    if (text[open] === "]") depth += 1;
    if (text[open] === "[" && depth-- === 0) break;
  }
  if (open < 0) return "";
  let close = open + 1;
  for (let depth = 0; close < text.length; close += 1) {
    if (text[close] === "[") depth += 1;
    if (text[close] === "]" && depth-- === 0) break;
  }
  return text.slice(open, close + 1);
}

/**
 * How many other same-directory modules sharing `path`'s name up to its first hyphen have a name
 * the reader imports from them listed in one array literal beside `name`. That is how a reader
 * holds a family: `treeFindingsOver` spreads `...compatibilityPaths(corpusFiles)` between
 * `...identitiesWithoutOwner(declaring)` and `...unproducedSetMembers(…)`, one element per scan.
 * Importing peers is not enough. Until 2026-09-22 the count was of imports alone, which also
 * admitted a helper whose reader happened to import two same-prefix modules for unrelated uses.
 */
function listedWithPeers(path: string, name: string, readerText: string): number {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const prefix = file.slice(0, file.indexOf("-") + 1);
  if (prefix === "") return 0;
  // A specifier's last word is the local name: `a`, `a as b` and `type A` bind `a`, `b` and `A`.
  const peers = readerText
    .matchAll(SIBLING_IMPORT)
    .filter((match) => match[2] !== file && (match[2] ?? "").startsWith(prefix))
    .map((match) => (match[1] ?? "").split(",").map((spec) => spec.trim().split(/\s+/u).at(-1) ?? ""))
    .toArray();
  const lists = readerText
    .matchAll(IDENTIFIER)
    .filter((match) => match[0] === name)
    .map((match) => new Set(enclosingList(readerText, match.index).match(IDENTIFIER) ?? []))
    .toArray();
  return Math.max(
    0,
    ...lists.map((list) => peers.filter((names) => names.some((peer) => list.has(peer))).length),
  );
}

function movesIntoReader(
  name: string,
  where: Declaration,
  reader: string,
  homeText: string,
  readerText: string,
): boolean {
  const moving = homeText.split("\n").filter((line) => line.trim() !== "").length;
  if (moving < HELPER_LINES.least || moving > HELPER_LINES.most) return false;
  if (!MOVE_TARGETS.some((root) => reader.startsWith(root))) return false;
  // A file holding several exports is a layer, and one of its names having a single reader says
  // nothing about where that name belongs: `run-triage/evidence.ts` holds eleven exports for
  // `cli.ts`, which is a library and its command. When the file holds one declaration the move
  // deletes the file, and a deleted file is a reduction a reader can see. It is also what this
  // repository's removals actually do: of the 228 net-negative source commits since 2026-09-08,
  // 71 deleted a source file — well under the 86 of 138 the argument above counts as helper
  // moves, so most of those moves were inside one file, which is `ana/no-single-caller-helper`
  // and already in the gate. Measured 2026-09-20: 10 of 42.
  if ((homeText.match(EXPORTED) ?? []).length !== 1) return false;
  const occupied = readerText.split("\n").filter((line) => line.trim() !== "").length;
  if (occupied + moving > (copiedFileLimits[reader] ?? NEW_FILE_CEILING)) return false;
  // Different directories are different areas of this tree, and the move carries the module
  // across whatever that boundary holds. Here it holds the Builder's file wall:
  // `published-rules.ts` is a `src/truth` contract read from `src/author`, and `src/truth` is
  // closed to a Builder session while `src/author` is open, so the move would publish a
  // correctness check to the sessions it judges. Inside one directory the move is a merge.
  if (where.path.slice(0, where.path.lastIndexOf("/")) !== reader.slice(0, reader.lastIndexOf("/"))) {
    return false;
  }
  // A file its reader resolves as a path is a process image, not a helper:
  // `evaluator-process-bundle.ts` bundles `"./reference-solve-child.ts"` into its own executable,
  // and an entry point cannot move into the launcher. The quoted `./` prefix is what separates a
  // resolved path from a doc comment naming a sibling module, which this tree does everywhere —
  // of fourteen files a looser match caught on 2026-09-20, eleven were prose. A module specifier
  // carries the same spelling, so the import line is not a launch.
  const named = `"./${where.path.slice(where.path.lastIndexOf("/") + 1)}"`;
  if (readerText.split("\n").some((line) => line.includes(named) && !line.includes(" from "))) return false;
  // A file one of a family of peers is not a helper either. `tree-findings.ts` lists six
  // `tree-*.ts` scans side by side, one shape each, and whether the 49-line `tree-compat-path.ts`
  // or the 76-line `tree-schema-tag.ts` folds into it is a line count, not a design: folding the
  // smaller leaves five peers and one shape nobody can find by its file name. The family is two
  // or more same-prefix peers the reader lists in one array literal with this export.
  return listedWithPeers(where.path, name, readerText) < 2;
}

/**
 * An exported name exactly one other file reads, split by whether that reader is a test.
 *
 * `ana/no-single-caller-helper` reads the same shape inside one file; `unusedExports` in
 * `tools/loc/source-policy.ts` reads the zero-reader end of it. This is the middle. A name
 * declared in two files is skipped, because a mention cannot be attributed to one of them, and
 * the single reader is named in the finding so the move has a destination.
 */
function singleReaderExports(
  declaring: ReadonlyMap<string, string>,
  corpusFiles: ReadonlyMap<string, string>,
): TreeFinding[] {
  const home = declared(declaring);
  const found = readers(corpusFiles);
  const rows: TreeFinding[] = [];

  for (const [name, where] of home) {
    if (where === null) continue;
    const outside = [...(found.get(name) ?? [])].filter((path) => path !== where.path);
    const [reader] = outside;
    if (outside.length !== 1 || reader === undefined) continue;
    if (!where.movable) continue;
    const test = reader.startsWith("test/") || reader.includes(".test.");
    const homeText = declaring.get(where.path) ?? "";
    if (!test && !movesIntoReader(name, where, reader, homeText, corpusFiles.get(reader) ?? "")) continue;
    // Spelled more than once in its own file means its own module uses it, and neither finding
    // survives that. For a test reader the export is how the test names a unit the module
    // already runs. For a production reader there is nothing to move: the home keeps the
    // original and the single reader would get a copy, or the import would invert. Measured
    // 2026-09-20: 89 of the 92 test-only sites, and 16 of the 60 single-reader sites —
    // `toFileRef` yields from its own directory walk, `fileArtifactRoot` is read by the
    // constructor two functions below it, and `ReferenceSolveProcessFailure` is thrown twice in
    // the module that declares it.
    const own = (homeText.match(IDENTIFIER) ?? []).filter((spelling) => spelling === name).length;
    if (own > 1) continue;
    rows.push({
      kind: test ? "test-only-export" : "single-reader-export",
      path: where.path,
      line: where.line,
      detail: test
        ? `\`${name}\` is exported only for ${reader}`
        : `\`${name}\` is read by one file, ${reader}`,
    });
  }
  return rows;
}

/**
 * Field names declared inside an `interface X {` or `type X = {` block, with their lines.
 *
 * The block is read by indentation rather than by braces: it opens on a line ending in `{` and
 * closes at the first line whose first character is `}`. That is how every declaration in this
 * tree is formatted, and reading it this way keeps an object literal's properties out — which
 * matters, because `{ verified: 1, … }` and a multi-line parameter list both look like fields
 * to a pattern that does not know where it is.
 */
function declaredFields(text: string): { name: string; line: number }[] {
  const fields: { name: string; line: number }[] = [];
  let inside = false;
  for (const [index, line] of text.split("\n").entries()) {
    if (!inside) {
      inside = DECLARATION_HEAD.test(line);
      continue;
    }
    if (line.startsWith("}")) {
      inside = false;
      continue;
    }
    const match = DECLARED_FIELD.exec(line);
    if (match?.[1] !== undefined) fields.push({ name: match[1], line: index + 1 });
  }
  return fields;
}

/** A declared field whose name appears exactly once in the whole tree: its own declaration. */
function unreadFields(
  declaring: ReadonlyMap<string, string>,
  counts: ReadonlyMap<string, number>,
): TreeFinding[] {
  const found: TreeFinding[] = [];
  for (const [path, text] of declaring) {
    for (const field of declaredFields(text)) {
      if (field.name.length < FIELD_LENGTH_FLOOR || (counts.get(field.name) ?? 0) !== 1) continue;
      found.push({
        kind: "unread-field",
        path,
        line: field.line,
        detail: `\`${field.name}\` is declared and never spelled again`,
      });
    }
  }
  return found;
}

/** A registered rule no test fixture names, read from the registry that decides the rule runs. */
function rulesWithoutFixture(corpusFiles: ReadonlyMap<string, string>): TreeFinding[] {
  let fixtures = "";
  for (const [path, text] of corpusFiles) if (path.startsWith("test/")) fixtures += text;
  const found: TreeFinding[] = [];
  for (const [path, text] of corpusFiles) {
    if (!path.startsWith("tools/oxlint/") || !path.endsWith("/index.ts")) continue;
    for (const match of text.matchAll(REGISTERED_RULE)) {
      const name = match[1] ?? "";
      if (fixtures.includes(name)) continue;
      found.push({
        kind: "rule-without-fixture",
        path,
        line: text.slice(0, match.index ?? 0).split("\n").length,
        detail: `\`${name}\` is registered and no file under test/ names it`,
      });
    }
  }
  return found;
}

/** How many names each file imports from `src/meta/filesystem.ts`, above the budget. */
function filesystemBudget(files: ReadonlyMap<string, string>): TreeFinding[] {
  const found: TreeFinding[] = [];
  for (const [path, text] of files) {
    const match = /import\s*\{([^}]*)\}\s*from\s*"[^"]*meta\/filesystem\.ts"/u.exec(text);
    if (match === null) continue;
    const names = (match[1] ?? "").split(",").filter((name) => name.trim() !== "");
    if (names.length <= FILESYSTEM_BUDGET) continue;
    found.push({
      kind: "filesystem-import-budget",
      path,
      line: text.slice(0, match.index).split("\n").length,
      detail: `${names.length} names imported, over the budget of ${FILESYSTEM_BUDGET}`,
    });
  }
  return found;
}

/**
 * Every whole-tree shape over two corpora that have already been read.
 *
 * The scans are separated from the reading because that is the only way to exercise them: each
 * one is a statement about a whole tree, and a fixture tree of six files can hold every shape
 * at a known line, where the repository holds 707 of them at lines that move.
 */
export function treeFindingsOver(
  declaring: ReadonlyMap<string, string>,
  corpusFiles: ReadonlyMap<string, string>,
  prose: ReadonlyMap<string, string> = new Map(),
): TreeFinding[] {
  // How many times each identifier is spelled across the whole tree.
  const counts = new Map<string, number>();
  for (const text of corpusFiles.values()) {
    for (const name of text.match(IDENTIFIER) ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [
    ...singleReaderExports(declaring, corpusFiles),
    ...copiedBlocks(corpusFiles, DECLARING_ROOTS),
    ...unreadFields(declaring, counts),
    ...rulesWithoutFixture(corpusFiles),
    ...identitiesWithoutOwner(declaring),
    ...supersededSchemaTags(corpusFiles),
    ...compatibilityPaths(corpusFiles),
    ...unproducedSetMembers(declaring, corpusFiles),
    ...unreadModules(new Map([...corpusFiles, ...prose])),
    ...filesystemBudget(declaring),
  ].sort((left, right) =>
    left.path === right.path ? left.line - right.line : left.path.localeCompare(right.path),
  );
}

/**
 * The text of every place a finding spans, each read from its own file.
 *
 * A finding about a file as a whole has no lines, and its text is empty: the answer is about the
 * file, and its detail — how many tests read it — moves without the file changing.
 */
export function sitePlaces(finding: TreeFinding, files: ReadonlyMap<string, string>): Place[] {
  if (finding.line === 0) return [{ path: finding.path, text: "" }];
  const places = finding.places ?? [{ path: finding.path, line: finding.line, end: finding.line }];
  return places.map((place) => ({
    path: place.path,
    text: (files.get(place.path) ?? "")
      .split("\n")
      .slice(place.line - 1, place.end)
      .join("\n"),
  }));
}

/** Every whole-tree site in this repository, answered or not: the two corpora, read once, and the
 *  scans over them. `bun run not-slop` reads this to find an id and to judge a row stale. */
export function treeSites(): TreeSite[] {
  const prose = corpus(PROSE_ROOTS, PROSE_SUFFIXES);
  for (const path of ROOT_FILES) if (existsSync(path)) prose.set(path, readFileSync(path, "utf8"));
  const corpusFiles = corpus(READER_ROOTS, READ_AS_SOURCE);
  const declaring = corpus(DECLARING_ROOTS, [".ts", ".tsx", ".mts"]);
  const files = new Map([...declaring, ...corpusFiles]);
  return treeFindingsOver(declaring, corpusFiles, prose).map((finding) => {
    const places = sitePlaces(finding, files);
    const rule = `${TREE_RULE_PREFIX}${finding.kind}`;
    return { ...finding, id: siteId(rule, places), excerpt: siteExcerpt(places) };
  });
}

/** The sites no row of the not-slop ledger answers: what `bun run simplify` and the pre-commit
 *  report print. */
export function treeFindings(): TreeSite[] {
  const text = existsSync(NOT_SLOP_LEDGER) ? readFileSync(NOT_SLOP_LEDGER, "utf8") : "";
  const answered = new Set(readLedger(text).answers.map((answer) => answer.id));
  return treeSites().filter((site) => !answered.has(site.id));
}
