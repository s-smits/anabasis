/**
 * The census itself: the scans that need the whole tree at once, and the registration that
 * decides which catchers run where.
 *
 * Two silent failures are worth a test. A catcher can be written, imported and registered in the
 * plugin and then named in no config at all, in which case it reports nothing and nobody notices
 * — the census simply has one shape fewer than it thinks. And a whole-tree scan can go quiet: it
 * finds names by pattern over text it read itself, so a changed format or a mistyped root gives
 * an empty list, which reads exactly like a clean tree.
 */
import { afterAll, describe, expect, it } from "bun:test";
import oxlintrc from "../.oxlintrc.json" with { type: "json" };
import manifest from "../package.json" with { type: "json" };
import simplify from "../tools/oxlint/simplify.json" with { type: "json" };
import { corpus } from "../tools/loc/source-policy.ts";
import { siteId } from "../tools/oxlint/not-slop-ledger.ts";
import {
  sitePlaces,
  TREE_FINDING_ARGUMENTS,
  treeFindings,
  treeFindingsOver,
} from "../tools/oxlint/tree-findings.ts";
import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
import { join, resolve } from "../src/meta/path.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const repoRoot = resolve(import.meta.dirname, "..");

/** One block written twice in one file, under two names: a copy with no second file to point at. */
const TWICE = `export function alpha(rows: string[]): string[] {
  const kept = [];
  for (const row of rows) {
    if (row.length > 0 && !row.startsWith("#")) kept.push(row.trim());
  }
  kept.sort((left, right) => left.localeCompare(right));
  return kept;
}

export function beta(rows: string[]): string[] {
  const kept = [];
  for (const row of rows) {
    if (row.length > 0 && !row.startsWith("#")) kept.push(row.trim());
  }
  kept.sort((left, right) => left.localeCompare(right));
  return kept;
}
`;

/**
 * A six-file tree holding one of every whole-tree shape, at a line the test can name.
 *
 * `declaring` is what the scans look inside; `corpus` is everywhere a name may be read from, so
 * it holds the declaring files too, exactly as the repository's two corpora overlap.
 */
const DECLARING = new Map([
  // One identity spelled in two files with nothing naming it, and one with a constant that does.
  // Both are needed: the owner branch changes what the row asks for, from "decide where the name
  // goes" to "import the one that exists", and only the second half proves the scan can tell.
  // The third line of each is the same name assembled by `join`, which the scan read straight
  // past until it learned to paste adjacent segments: two literals, neither an identity alone.
  // The fourth line is a class the scan must stay quiet about: one file declares the tag as a
  // member's type, which makes every other copy of it checked by the compiler, so the second
  // spelling is not an unowned one. The seventh is the same fact written as a union and the ones
  // after it the same fact again as an `as const` array a type is derived from, both of which the
  // member form read straight past. The fifth and sixth are owned names whose declaration comes
  // first: the row must point at the file with work to do, and say which of the two repairs it
  // is, since a private constant is nothing the other file can import. Lines 13 to 15 are three
  // short names: `census.json` in three files is a layout, `battery.json` in two is a coincidence
  // and `package.json` in three is the toolchain's. Lines 16 to 19 are the two faces of
  // `satisfies`: `readonly Stage[]` hands the array to the compiler, while a record whose values
  // are `string[]` checks its keys and leaves `campaign-brief.json` to nobody. Lines 20 and 21 are a
  // loader and its hostile twin: the path handed to `pathToFileURL` is the module system's, while
  // the same `join` without the call is a name like any other.
  [
    "src/identity-reader.ts",
    `if (row.schema !== "campaign-opening/v9") throw new Error("bad");\nreadFileSync("campaign-opening.json");\nreadFileSync(join(dir, "campaign-opening", "terminal.json"));\nif (row.receipt !== "control-receipt/v7") return;\nexport const RECORD_FILE = "campaign-record.jsonl";\nconst LOCAL_FILE = "campaign-local.jsonl";\ntype Level = "campaign-level/v1" | "other-level/v1";\nconst FIXTURES = [\n  "campaign-fixture/v1",\n] as const;\ntype Fixture = (typeof FIXTURES)[number];\nconst mod = await load<typeof import("../../campaign-loader.ts")>("campaign-loader.ts");\nreadFileSync(join(dir, "census.json"));\nreadFileSync(join(dir, "battery.json"));\nreadFileSync("package.json");\nconst STAGES = [\n  "campaign-stage/v1",\n] satisfies readonly Stage[];\nreadFileSync("campaign-brief.json");\nconst staged = Bun.pathToFileURL(join(worktree, "campaign-staged.ts")).href;\nconst unstaged = join(worktree, "campaign-unstaged.ts");\n`,
  ],
  [
    "src/identity-writer.ts",
    `export const CAMPAIGN_FILE = "campaign-opening.json";\nconst row = { schema: "campaign-opening/v9" };\nwriteFileSync(join(dir, "campaign-opening", "terminal.json"), CAMPAIGN_FILE);\ninterface Receipt {\n  readonly schema: "control-receipt/v7";\n}\nreadFileSync("campaign-record.jsonl");\nreadFileSync("campaign-local.jsonl");\nconst level: Level = "campaign-level/v1";\nconst one: Fixture = "campaign-fixture/v1";\nreadFileSync("campaign-loader.ts");\nwriteFileSync(join(dir, "census.json"), "");\nwriteFileSync(join(dir, "battery.json"), "");\nreadFileSync("package.json");\nconst stage: Stage = "campaign-stage/v1";\nconst OWNER_FILES = {\n  brief: ["campaign-brief.json"],\n} satisfies Partial<Record<Owner, readonly string[]>>;\nconst STAGED_MODULE = "campaign-staged.ts";\nreadFileSync("campaign-unstaged.ts");\n`,
  ],
  [
    "src/owner.ts",
    `export function readOpening(dir: string): string {
  const trimmed = dir.trim();
  if (trimmed.length === 0) return "";
  const parts = trimmed.split("/");
  const last = parts[parts.length - 1] ?? "";
  if (last === "opening.json") return trimmed;
  const joined = parts.join("/");
  const suffixed = joined.endsWith("/") ? joined : joined + "/";
  return suffixed + "opening.json";
}
export function sharedHelper(dir: string): string {
  const trimmed = dir.trim();
  if (trimmed.length === 0) return ".";
  const parts = trimmed.split("/");
  const head = parts[0] ?? "";
  if (head === "campaigns") return trimmed;
  const rest = parts.slice(1).join("/");
  const prefixed = rest.length === 0 ? "campaigns" : "campaigns/" + rest;
  return prefixed;
}
export function testOnlyHelper(dir: string): string {
  const trimmed = dir.trim();
  if (trimmed.length === 0) return "";
  const parts = trimmed.split("/");
  const tail = parts.slice(1);
  if (tail.length === 0) return trimmed;
  const rejoined = tail.join("/");
  const stripped = rejoined.startsWith("./") ? rejoined.slice(2) : rejoined;
  return stripped;
}
export function scriptHelper(dir: string): string {
  const relative = dir.replace(/^\\.\\//u, "");
  if (relative === "") return "/";
  const rooted = relative.startsWith("/") ? relative : "/" + relative;
  const collapsed = rooted.replace("//", "/");
  const segments = collapsed.split("/").filter((segment) => segment !== "..");
  const joined = segments.join("/");
  return joined === "" ? "/" : joined;
}
export function probeHelper(dir: string): string {
  return dir.trim();
}
export function briefHelper(dir: string): string {
  return probeHelper(dir);
}
export interface OpeningRow {
  opened: string;
}
export const OPENING_FILE = "opening.json";
readFileSync("census.json");
readFileSync("package.json");
`,
  ],
  [
    "src/row-fields.ts",
    `interface Row {
  verifiedPasses: number;
  unreadSetting: string;
}
`,
  ],
  [
    "src/importer.ts",
    `import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "../meta/filesystem.ts";

export function touch(path: string): void {
  writeFileSync(path, "");
}
`,
  ],
  [
    "src/copy-a.ts",
    `export function alpha(rows: string[]): string[] {
  const kept = [];
  for (const row of rows) {
    if (row.length > 0 && !row.startsWith("#")) kept.push(row.trim());
  }
  kept.sort((left, right) => left.localeCompare(right));
  return kept;
}
`,
  ],
  // Two files that share nothing but the punctuation a formatter writes. Six closing lines is a
  // six-line match, and the deepest nesting in this repository is oxlint's own rules, where every
  // one of them ends `}); / } / }, / }; / }, / });`.
  [
    "src/closers-a.ts",
    `const alpha = one({
  two: {
    three: [
      {
        four: [
          {
            five: 1,
          },
        ],
      },
    ],
  },
});
`,
  ],
  [
    "src/closers-b.ts",
    `const beta = nine({
  eight: {
    seven: [
      {
        six: [
          {
            five: 2,
          },
        ],
      },
    ],
  },
});
`,
  ],
  // Two files reading the same six names from one owner. That is the owner working, not a
  // duplicate, and wrapped by the formatter it is a six-line match in every such pair.
  [
    "src/specifiers-a.ts",
    `import {
  alphaName,
  betaName,
  gammaName,
  deltaName,
  epsilonName,
  zetaName,
} from "./vocabulary.ts";

const usedHere = alphaName + betaName + gammaName + deltaName + epsilonName + zetaName;
`,
  ],
  [
    "src/specifiers-b.ts",
    `import {
  alphaName,
  betaName,
  gammaName,
  deltaName,
  epsilonName,
  zetaName,
} from "./vocabulary.ts";

const usedThere = zetaName + epsilonName + deltaName + gammaName + betaName + alphaName;
`,
  ],
  // Three peers of one family, each a function of the claimed size read only by `reader.ts`. The
  // reader lists all three in one array, so each has two siblings sharing its `scan-` prefix
  // beside it, and folding one in would leave the family short a member rather than remove a
  // helper.
  [
    "src/scan-a.ts",
    `export function countVowels(text: string): number {
  let total = 0;
  for (const letter of text) {
    if ("aeiou".includes(letter)) {
      total += 1;
    }
  }
  if (total > 100) {
    return 100;
  }
  return total;
}
`,
  ],
  [
    "src/scan-b.ts",
    `export function longestRun(values: readonly number[]): number {
  let best = 0;
  let current = 0;
  let previous = Number.NaN;
  for (const value of values) {
    current = value === previous ? current + 1 : 1;
    previous = value;
    best = Math.max(best, current);
  }
  const floor = values.length === 0 ? 0 : 1;
  return Math.max(best, floor);
}
`,
  ],
  [
    "src/scan-c.ts",
    `export function splitPairs(line: string): Map<string, string> {
  const pairs = new Map<string, string>();
  const fields = line.split(";");
  for (const field of fields) {
    const at = field.indexOf("=");
    if (at <= 0) continue;
    const key = field.slice(0, at).trim();
    const value = field.slice(at + 1).trim();
    pairs.set(key, value);
  }
  return pairs;
}
`,
  ],
  // The one shape `single-reader-export` still claims: a file whose only export is a function of
  // the size the corpus moved, read from one other file in the same directory. `owner.ts` above
  // holds four exports and is therefore a layer, not a helper with a home to move to.
  [
    "src/single-export.ts",
    // Deliberately not a copy of \`readOpening\` above. It was one, differing in a single string
    // literal, and once the copy scan started normalising literals it reported the pair — in a
    // fixture whose contract is one of each shape. The algorithm is now a different one.
    `export function readClosing(dir: string): string {
  const cleaned = dir.replace(/\\s+/gu, "");
  if (cleaned === "") return "";
  if (cleaned.endsWith("closing.json")) return cleaned;
  const segments = cleaned.split("/");
  const depth = segments.length;
  const separator = cleaned.endsWith("/") ? "" : "/";
  const target = depth > 1 ? "closing.json" : "./closing.json";
  return cleaned + separator + target;
}
`,
  ],
  [
    "src/copy-b.ts",
    `export function alpha(rows: string[]): string[] {
  const kept = [];
  for (const row of rows) {
    if (row.length > 0 && !row.startsWith("#")) kept.push(row.trim());
  }
  kept.sort((left, right) => left.localeCompare(right));
  return kept;
}
`,
  ],
  // Two files naming the same closed vocabulary. Standing on 2026-09-20 as `src/critic/policy.ts`
  // against `src/run/terminal.ts`, seven of the nine terminal codes matched, and they match because
  // the set has one meaning: a code added to one file and not the other is the defect, not the
  // agreement. Nothing in the run does anything, so nothing in it can move to an owner.
  [
    "src/vocab-a.ts",
    `export const OPENING_CODES = [
  "completed",
  "stopped",
  "build-failed",
  "candidate-held",
  "budget-limited",
  "environment-blocked",
];
`,
  ],
  [
    "src/vocab-b.ts",
    `export const TERMINAL_CODES = new Set([
  "completed",
  "stopped",
  "build-failed",
  "candidate-held",
  "budget-limited",
  "environment-blocked",
]);
`,
  ],
  // Two probes returning the one verdict shape their declared type gives them. Shorthand
  // properties and a `? …` continuation read as code to a floor that counts anything but a closing
  // bracket, so the pair was reported while the only line doing work was the `return`.
  [
    "src/verdict-a.ts",
    `export function guardProbe(path: string): ProbeVerdict {
  const refused = path.startsWith("/");
  const liftedSucceeded = path.length > 3;
  return {
    refused,
    liftedSucceeded,
    detail: refused
      ? liftedSucceeded
        ? "the guard refused and the lifted control did not"
        : "the guard refused, but so did the lifted control"
      : "the guard did not refuse",
  };
}
`,
  ],
  [
    "src/verdict-b.ts",
    `export function wallProbe(root: string, name: string): ProbeVerdict {
  const refused = name.endsWith(".ts");
  const liftedSucceeded = root !== name;
  return {
    refused,
    liftedSucceeded,
    detail: refused
      ? liftedSucceeded
        ? "the wall refused and the lifted control did not"
        : "the wall refused, but so did the lifted control"
      : "the wall did not refuse",
  };
}
`,
  ],
  // Two closed sets. `kickoff` and `no-feedback` are produced by the writer below, `authoring`
  // by nobody — the comment naming it is prose, not a producer — `reject-controls` by nobody, and
  // `plan-exhausted` by the test under READERS alone, which the row says. `other-level/v1` in
  // src/identity-reader.ts is the same shape on one line, beside a member the writer produces.
  [
    "src/stage-vocabulary.ts",
    `export type BuildStage =\n  | "kickoff"\n  | "authoring"\n  | "reject-controls";\n// The \`authoring\` stage is declared here and produced nowhere.\nexport interface Lineage {\n  reason: "no-feedback" | "plan-exhausted";\n}\nexport type Cell = "cell-1" | "cell-2";\n`,
  ],
  // The writer produces `cell-1` and `cell-2` through a template, and `\`${a}-${b}\`` is a template
  // whose static text is too short to produce anything. Its `resolve` call is the one reader of
  // resolved-child.ts, spelled without a suffix, so neither an import nor a spelled path names it.
  // `legacy-root` names a compatibility path; the comment and the bare word in a message do not.
  [
    "src/stage-writer.ts",
    `export const opened = { stage: "kickoff", reason: "no-feedback" };\nexport const cell = \`cell-\${opened.stage.length}\`;\nexport const pair = \`\${opened.stage}-\${opened.reason}\`;\nexport const child = import.meta.resolve("./resolved-child");\n// legacyStage was the old name of opened.\nexport const refused = "legacy stage rows are refused";\nexport const reopened = { from: "legacy-root", at: opened };\n`,
  ],
  ["src/resolved-child.ts", `export const resolved = 3;\n`],
]);

const READERS = new Map([
  ...DECLARING,
  [
    "src/reader.ts",
    `import { briefHelper, readOpening, sharedHelper, OPENING_FILE, type OpeningRow } from "./owner.ts";
import { readClosing } from "./single-export.ts";
import { countVowels } from "./scan-a.ts";
import { longestRun } from "./scan-b.ts";
import { splitPairs } from "./scan-c.ts";
export const opening: OpeningRow = { opened: readOpening(".") + sharedHelper(".") + briefHelper(".") + OPENING_FILE + readClosing(".") };
export const scanned = [countVowels("."), longestRun([1]), splitPairs(".").size];
export const passes = { verifiedPasses: 1 };
`,
  ],
  [
    "src/other-reader.ts",
    `import { sharedHelper } from "./owner.ts";\nexport const twice = sharedHelper(".");\n`,
  ],
  [
    "test/owner.test.ts",
    `import { probeHelper, testOnlyHelper } from "../src/owner.ts";\nexport const only = testOnlyHelper(".") + probeHelper(".");\n`,
  ],
  ["test/stage.test.ts", `const held = { reason: "plan-exhausted" };\n`],
  // A skill script reads repository source and cannot receive it, so its one reader is nowhere.
  // The skill name is a real one because `skill-links.test.ts` reads every `.claude/skills/<name>/`
  // path this directory spells, fixture or not, and requires the directory to exist.
  [
    ".claude/skills/simplify/run.mts",
    `import { scriptHelper } from "../../../src/owner.ts";\nconsole.log(scriptHelper("."));\n`,
  ],
  // Two registered rules, one of which a fixture makes report and one of which nothing anywhere
  // names. Both halves are needed: a scan that only ever sees uncovered rules would pass with a
  // path prefix typed wrongly, which is the failure it exists to catch one level up.
  [
    "tools/oxlint/ana/index.ts",
    `const plugin = {\n  rules: {\n    "no-covered-shape": coveredShape,\n    "no-untested-shape": untestedShape,\n  },\n};\n`,
  ],
  [
    "test/no-covered-shape.test.ts",
    `import { runRule } from "./harness.ts";\nrunRule("no-covered-shape", "const a = 1;");\n`,
  ],
  // The tree has moved to `campaign-opening/v10`, which makes the two `v9` spellings above the
  // superseded shape. The comment and the backticked prose spell the old tag without reading it,
  // and the fixture under test/ holds an old row on purpose, so none of the three is a row. The
  // skill script spells its old tag in single quotes, which is the other quote code uses.
  [
    "src/schema-writer.ts",
    `const row = { schema: "campaign-opening/v10", receipt: "judge-receipt/v2" };\n// \`campaign-opening/v9\` was the shape before the run condition moved in.\nconst note = \`campaign-opening/v9 rows are read by the archive\`;\n`,
  ],
  [
    "test/schema-migration.test.ts",
    `const old = { schema: "campaign-opening/v9" };\nconst legacyRow = old;\n`,
  ],
  [".claude/skills/simplify/receipts.mjs", `if (row.receipt !== 'judge-receipt/v1') process.exit(1);\n`],
  // Something runs every module above: the entry the manifest names imports the source files for
  // effect, and the prose below names the skill scripts and the plugin. Two are left out on
  // purpose — `src/never-run.ts`, which nothing names, and `src/probe-only.ts`, which one test
  // imports and nothing else — and the comment naming never-run.ts in the entry does not count.
  [
    "src/entry.ts",
    `// never-run.ts is left out on purpose.
import "./closers-a.ts";
import "./closers-b.ts";
import "./copy-a.ts";
import "./copy-b.ts";
import "./identity-reader.ts";
import "./identity-writer.ts";
import "./importer.ts";
import "./other-reader.ts";
import "./reader.ts";
import "./row-fields.ts";
import "./schema-writer.ts";
import "./specifiers-a.ts";
import "./specifiers-b.ts";
import "./stage-vocabulary.ts";
import "./stage-writer.ts";
import "./verdict-a.ts";
import "./verdict-b.ts";
import "./vocab-a.ts";
import "./vocab-b.ts";
`,
  ],
  ["src/never-run.ts", `export const never = 1;\n`],
  ["src/probe-only.ts", `export const probe = 2;\n`],
  ["test/probe-only.test.ts", `import { probe } from "../src/probe-only.ts";\nexport const seen = probe;\n`],
]);

/** Files that name a module without importing it, read by the module scan alone. */
const PROSE = new Map([
  ["package.json", `{ "scripts": { "entry": "bun src/entry.ts" } }\n`],
  [".oxlintrc.json", `{ "jsPlugins": ["./tools/oxlint/ana/index.ts"] }\n`],
  [".claude/skills/simplify/SKILL.md", "Run `receipts.mjs` after `bun .claude/skills/simplify/run.mts`.\n"],
]);

/** Whether a config entry names a rule from this repository's own plugin. */
function isAnaRule(rule: string): boolean {
  return rule.startsWith("ana/");
}

/**
 * The rule names `tools/oxlint/ana/index.ts` registers, read out of the file.
 *
 * Importing the plugin would be the direct way to ask, and it is the wrong one: `tools/oxlint`
 * is outside the typecheck program, because the plugin's own node types declare a `parent` the
 * rules read as optional, and importing the index from a test drags every rule file into
 * `tsc` and fails the gate on types nobody here owns.
 */
function registeredRules(): string[] {
  const source = readFileSync(resolve(repoRoot, "tools/oxlint/ana/index.ts"), "utf8");
  const block = source.slice(source.indexOf("rules: {"), source.indexOf("});"));
  return [...block.matchAll(/^\s{4}"([\w-]+)":/gmu)].map((match) => `ana/${match[1]}`);
}

describe("the simplify catcher registration", () => {
  it("switches every plugin rule on in exactly one config", () => {
    // A rule in neither config reports nothing; a rule in both would gate a census catcher.
    // Comparing the union against the registry catches each of those in the same assertion.
    const registered = registeredRules().sort();
    expect(registered.length).toBeGreaterThan(20);
    const enabled = [...Object.keys(oxlintrc.rules), ...Object.keys(simplify.rules)].filter(isAnaRule).sort();
    expect(enabled).toStrictEqual(registered);
  });

  it("keeps the census advisory, and out of the config the gate loads", () => {
    // Nothing here blocks: several of these catchers are heuristics that cannot pass the
    // admission test a gating rule has to pass, and the answer to a whole group is sometimes
    // "no". `bun run lint` reads `.oxlintrc.json`; `bun run simplify` is the only reader of
    // this file, so a catcher moved into the gate has to be moved on purpose.
    // A tuned rule is written `["warn", options]`, so the severity is the first entry when the
    // setting is a list and the whole setting otherwise.
    const severities = Object.values(simplify.rules).map((setting) =>
      Array.isArray(setting) ? setting[0] : setting,
    );
    expect(severities.filter((severity) => severity !== "warn")).toStrictEqual([]);
    expect(manifest.scripts.lint).not.toContain("simplify");
    expect(manifest.scripts.simplify).toContain("tools/oxlint/simplify-census.ts");
  });
});

describe("the whole-tree simplify scans", () => {
  it("finds one of every shape in a tree written to hold one of each", () => {
    const found = treeFindingsOver(DECLARING, READERS, PROSE).map(
      (finding) => `${finding.kind} ${finding.path}:${finding.line}`,
    );
    expect(found).toStrictEqual([
      "superseded-schema-tag .claude/skills/simplify/receipts.mjs:1",
      "copied-block src/copy-a.ts:2",
      "identity-without-owner src/identity-reader.ts:1",
      "superseded-schema-tag src/identity-reader.ts:1",
      "identity-without-owner src/identity-reader.ts:2",
      "identity-without-owner src/identity-reader.ts:3",
      "unproduced-set-member src/identity-reader.ts:7",
      "identity-without-owner src/identity-reader.ts:13",
      "identity-without-owner src/identity-reader.ts:19",
      "identity-without-owner src/identity-reader.ts:21",
      "superseded-schema-tag src/identity-writer.ts:2",
      "identity-without-owner src/identity-writer.ts:7",
      "identity-without-owner src/identity-writer.ts:8",
      "filesystem-import-budget src/importer.ts:1",
      "orphan-module src/never-run.ts:0",
      "test-only-export src/owner.ts:21",
      "test-only-module src/probe-only.ts:0",
      "unread-field src/row-fields.ts:3",
      "single-reader-export src/single-export.ts:1",
      "unproduced-set-member src/stage-vocabulary.ts:3",
      "unproduced-set-member src/stage-vocabulary.ts:4",
      "unproduced-set-member src/stage-vocabulary.ts:7",
      "compatibility-path src/stage-writer.ts:7",
      "rule-without-fixture tools/oxlint/ana/index.ts:4",
    ]);
  });

  it("names the reader, the repeat and the budget in the detail, since the line alone is not the finding", () => {
    const details = new Map(
      treeFindingsOver(DECLARING, READERS, PROSE).map((finding) => [finding.kind, finding.detail]),
    );
    expect(details.get("orphan-module")).toBe("no file imports, spawns or names it");
    expect(details.get("test-only-module")).toBe("read by one test file and nothing else");
    expect(details.get("single-reader-export")).toBe("`readClosing` is read by one file, src/reader.ts");
    expect(details.get("test-only-export")).toBe("`testOnlyHelper` is exported only for test/owner.test.ts");
    expect(details.get("copied-block")).toBe(
      "4 statements, 85 tokens, lines 2–7 in `alpha`; also src/copy-b.ts:2 in `alpha`",
    );
    expect(details.get("filesystem-import-budget")).toBe("7 names imported, over the budget of 6");
    expect(details.get("compatibility-path")).toBe("names a legacy path: `legacy-root`");
    expect(details.get("rule-without-fixture")).toBe(
      "`no-untested-shape` is registered and no file under test/ names it",
    );
    const superseded = treeFindingsOver(DECLARING, READERS)
      .filter((finding) => finding.kind === "superseded-schema-tag")
      .map((finding) => finding.detail);
    expect(superseded).toStrictEqual([
      "`judge-receipt/v1` still spelled here after `judge-receipt/v2` in src/schema-writer.ts:1",
      "`campaign-opening/v9` still spelled here after `campaign-opening/v10` in src/schema-writer.ts:1",
      "`campaign-opening/v9` still spelled here after `campaign-opening/v10` in src/schema-writer.ts:1",
    ]);
    const unproduced = treeFindingsOver(DECLARING, READERS)
      .filter((finding) => finding.kind === "unproduced-set-member")
      .map((finding) => finding.detail);
    expect(unproduced).toStrictEqual([
      "`other-level/v1`, a member of `Level`, is produced by no production file; no test spells it either",
      "`authoring`, a member of `BuildStage`, is produced by no production file; no test spells it either",
      "`reject-controls`, a member of `BuildStage`, is produced by no production file; no test spells it either",
      "`plan-exhausted`, a member of `reason`, is produced by no production file; one test file spells it",
    ]);
    const identities = treeFindingsOver(DECLARING, READERS)
      .filter((finding) => finding.kind === "identity-without-owner")
      .map((finding) => finding.detail);
    expect(identities).toStrictEqual([
      "`campaign-opening/v9` is spelled in 2 files and no file names it",
      "`campaign-opening.json` is spelled in 2 files and `CAMPAIGN_FILE` in src/identity-writer.ts already names it",
      "`campaign-opening/terminal.json` is spelled in 2 files and no file names it",
      "`census.json` is spelled in 3 files and no file names it",
      "`campaign-brief.json` is spelled in 2 files and no file names it",
      "`campaign-unstaged.ts` is spelled in 2 files and no file names it",
      "`campaign-record.jsonl` is spelled in 2 files and `RECORD_FILE` in src/identity-reader.ts already names it",
      "`campaign-local.jsonl` is spelled in 2 files and `LOCAL_FILE` in src/identity-reader.ts names it but does not export it",
    ]);
  });

  it("says nothing about a name two files read, a shared field or an import inside the budget", () => {
    const quiet = treeFindingsOver(DECLARING, READERS)
      .map((finding) => finding.detail)
      .join("\n");
    expect(quiet).not.toContain("sharedHelper");
    // One of a family of peers its reader lists together is not a helper with a home to move to.
    expect(quiet).not.toContain("countVowels");
    expect(quiet).not.toContain("longestRun");
    expect(quiet).not.toContain("splitPairs");
    // A type and a constant have one reader each here, and neither is code that could move.
    expect(quiet).not.toContain("OpeningRow");
    expect(quiet).not.toContain("OPENING_FILE");
    // Three lines is the module's own fact held for one consumer; moving it makes a second owner.
    expect(quiet).not.toContain("briefHelper");
    // The one reader is a skill script, which is not a place repository source can move to.
    expect(quiet).not.toContain("scriptHelper");
    // Its own module calls it, so the export names a unit for the test rather than hiding dead code.
    expect(quiet).not.toContain("probeHelper");
    expect(quiet).not.toContain("verifiedPasses");
    expect(quiet).not.toContain("touch");
    // A fixture names it, which is the whole of what the rule scan asks for.
    expect(quiet).not.toContain("no-covered-shape");
    // One file declares this tag as a member's type, so a typo in the other copy is a build
    // failure and the second spelling has an owner already: the compiler. The union says the same
    // thing about a value a second file assigns with its own constant, so the owner branch must
    // not win over the type one.
    expect(quiet).not.toContain("control-receipt");
    expect(quiet).not.toContain("campaign-level");
    // An `as const` array a type is derived from is the same fact a third way, and the derivation
    // is what makes it one: `as const` alone silenced three names nothing takes a type from.
    expect(quiet).not.toContain("campaign-fixture");
    expect(quiet).not.toContain("campaign-loader");
    expect(quiet).not.toContain("campaign-staged");
    // A short name in two files is a coincidence, one the toolchain names is `bun`'s, and one in
    // a `satisfies readonly Stage[]` array is the compiler's; three files spelling `census.json`
    // is a layout, and a record `satisfies` that says `string[]` checks nothing about the value.
    expect(quiet).not.toContain("battery.json");
    expect(quiet).not.toContain("package.json");
    expect(quiet).not.toContain("campaign-stage");
    // An old tag held by a test fixture is the migration's proof, not a reader of it; the comment
    // and the backticked prose in src/schema-writer.ts are covered by the exact rows above.
    expect(quiet).not.toContain("schema-migration");
    // A member one production file spells is produced, wherever the writer sits.
    expect(quiet).not.toContain("kickoff");
    // `cell-1` and `cell-2` are produced by a template, and the `${a}-${b}` template produces nothing.
    expect(quiet).not.toContain("cell-");
    // resolved-child.ts is read by one `import.meta.resolve` call spelled without a suffix.
    expect(quiet).not.toContain("resolved-child");
    expect(quiet).not.toContain("no-feedback");
    expect(quiet).not.toContain("campaign-level");
  });

  it("reports a same-prefix peer its reader imports for a use of its own", () => {
    // The family fixture's three peers again, with a reader that imports all three and uses each
    // in its own statement. Nothing lists them together, so each is a helper with one reader, and
    // `longestRun([1])` shows the bracket in an argument does not read as a list.
    const peers = [...DECLARING].filter(([path]) => path.startsWith("src/scan-"));
    const reader = `import { countVowels } from "./scan-a.ts";
import { longestRun } from "./scan-b.ts";
import { splitPairs } from "./scan-c.ts";
export const vowels = countVowels(".");
export const run = longestRun([1]);
export const pairs = [splitPairs(".").size, 2];
`;
    const found = treeFindingsOver(new Map(peers), new Map([...peers, ["src/separate.ts", reader]]))
      .filter((finding) => finding.kind === "single-reader-export")
      .map((finding) => finding.path);
    expect(found).toStrictEqual(["src/scan-a.ts", "src/scan-b.ts", "src/scan-c.ts"]);
  });

  /**
   * Literals are normalised, so a copy that differs only in the words it prints is still one copy,
   * and what the copies say decides whether they are one owner. Two renderers that differ in their
   * label are reported. The typebox enum and the switch are the two shapes normalisation would
   * otherwise fold into one: the enum is a single statement, under the two-statement floor, and the
   * switch pairs carry eight different words, which is a table and not a routine — each copy says
   * something the other does not, so there is no body a shared owner could hold.
   */
  it("reports a repeat that differs in one string literal, and not a list of distinct ones", () => {
    const near = (kind: string): string => `export function render${kind}(row: string): string {
  const cleaned = row.trim();
  if (cleaned.length === 0) return "${kind.toLowerCase()}: empty";
  const head = cleaned.slice(0, 8);
  const tail = cleaned.slice(8);
  return "${kind.toLowerCase()}: " + head + tail;
}
`;
    const vocabulary = (names: readonly string[]): string =>
      `const Params = Type.Object({\n  action: Type.Union([\n${names
        .map((name) => `    Type.Literal("${name}"),`)
        .join("\n")}\n  ]),\n});\n`;
    const mapping = (name: string, pairs: readonly (readonly [string, string])[]): string =>
      `function ${name}(code: string): string {\n  switch (code) {\n${pairs
        .map(([from, to]) => `    case "${from}":\n      return "${to}";`)
        .join("\n")}\n  }\n  return "unknown";\n}\n`;
    const files = new Map([
      ["src/near-a.ts", near("Opening")],
      ["src/near-b.ts", near("Terminal")],
      ["src/vocab-a.ts", vocabulary(["readiness", "summary", "task", "tools", "typecheck", "inventory"])],
      ["src/vocab-b.ts", vocabulary(["inspect", "read", "write", "run", "export", "trial"])],
      [
        "src/map-a.ts",
        mapping("solveKind", [
          ["timeout", "tool-timeout"],
          ["crash", "tool-crash"],
          ["protocol", "tool-protocol"],
          ["sandbox", "tool-sandbox"],
        ]),
      ],
      [
        "src/map-b.ts",
        mapping("judgeKind", [
          ["transport", "provider-transport"],
          ["refusal", "provider-refusal"],
          ["budget", "provider-budget"],
          ["catalogue", "provider-catalogue"],
        ]),
      ],
    ]);
    const found = treeFindingsOver(files, files).filter((finding) => finding.kind === "copied-block");
    // Line 2, not 1: the two signatures differ by an identifier, which is not normalised, so what
    // matches is the body they share.
    expect(found.map((finding) => `${finding.path}:${finding.line} ${finding.detail}`)).toStrictEqual([
      "src/near-a.ts:2 5 statements, 69 tokens, lines 2\u20136 in `renderOpening`; also src/near-b.ts:2 in `renderTerminal`",
    ]);
  });

  /**
   * Two copies inside one file. The earlier run scan skipped that pair until 2026-09-20 — it read
   * the corpus as a set of file pairs and a file is not a pair with itself — so the shape went
   * unreported exactly where a reader is most likely to have written it twice. Dropping the skip
   * over this tree found three, of which two were real and are now one function each: the two
   * `context.report` blocks in `ana/no-hand-rolled-error-render`, and the resolution-id validation
   * written once for a block of rows and once for a single row in the prediction ledger script.
   *
   * The second half is the guard: four statements repeated three times match themselves four lines
   * down, and a scan without a non-overlap test reports two ranges over one block, which is the one
   * thing growing the match was meant to stop.
   */
  /**
   * A file saying on its first line that it is vendored is kept as its upstream wrote it, as a
   * vendor directory is: `truncateHead` and `truncateTail` in the pi-mono truncate utility share
   * their opening, and the matching upstream test is copied beside them. A first line that only
   * mentions something vendored is the copy the scan exists for.
   */
  it("skips a copy in a file whose first line says where it was vendored from, and only that", () => {
    const read = (text: string): string[] =>
      treeFindingsOver(new Map([["src/twice.ts", text]]), new Map([["src/twice.ts", text]]))
        .filter((finding) => finding.kind === "copied-block")
        .map((finding) => `${finding.path}:${finding.line}`);
    expect(read(`// Vendored from upstream packages/core/src/twice.ts at 0123abc.\n${TWICE}`)).toStrictEqual(
      [],
    );
    expect(read(`// Reads rows the way the vendored bundle does.\n${TWICE}`)).toStrictEqual([
      "src/twice.ts:3",
    ]);
  });

  it("reads two copies of a run in one file, and not a run matching a shift of itself", () => {
    const read = (path: string, text: string): string[] =>
      treeFindingsOver(new Map([[path, text]]), new Map([[path, text]]))
        .filter((finding) => finding.kind === "copied-block")
        .map((finding) => `${finding.path}:${finding.line} ${finding.detail}`);
    const body = ["  alpha();", "  bravo();", "  charlie();", "  delta();"];
    expect(read("src/twice.ts", TWICE)).toStrictEqual([
      "src/twice.ts:2 4 statements, 85 tokens, lines 2\u20137 in `alpha`; also src/twice.ts:11 in `beta`",
    ]);
    expect(
      read(
        "src/periodic.ts",
        `export function run(): void {\n${[...body, ...body, ...body].join("\n")}\n}\n`,
      ),
    ).toStrictEqual([]);
  });

  /**
   * A property's name is a field, not a binding, even where a local shares its spelling. Four
   * reads of one object's fields into locals named after them are not a copy of four reads of
   * another object's other fields, which is what `readRequest` and `recordedTaskContent` in the UI
   * server were reported as on 2026-09-22. The other side is the copy that reading hid: two
   * blocks slicing one vector list into prototypes, identical but for whether the key `vectors:`
   * shared its spelling with a local.
   */
  it("reads a property name as spelled, whatever the locals are called", () => {
    const read = (text: string): string[] =>
      treeFindingsOver(new Map([["src/fields.ts", text]]), new Map([["src/fields.ts", text]]))
        .filter((finding) => finding.kind === "copied-block")
        .map((finding) => `${finding.path}:${finding.line}`);
    const fields = (host: string, from: string, names: readonly string[]): string =>
      `export function ${host}(${from}: Record<string, unknown>): string[] {\n${names
        .map((name) => `  const ${name} = String(${from}?.${name});`)
        .join("\n")}\n  return [${names.join(", ")}];\n}\n`;
    const request = fields("request", "runtime", ["version", "name", "platform", "arch"]);
    const content = fields("content", "snapshot", ["id", "agentHash", "modelHash", "taskHash"]);
    expect(read(`${request}\n${content}`)).toStrictEqual([]);
    const prototypes = (host: string, vectors: string): string =>
      `export async function ${host}(run: Embed, anchors: Anchors): Promise<Prototype[]> {
  const classes = Object.entries(anchors);
  const ${vectors} = await run(classes.flatMap(([, texts]) => texts));
  let offset = 0;
  const prototypes = classes.map(([name, texts]) => ({
    name,
    vectors: ${vectors}.slice(offset, (offset += texts.length)),
  }));
  return prototypes;
}
`;
    expect(
      read(`${prototypes("classify", "vectors")}\n${prototypes("tier", "anchorVectors")}`),
    ).toStrictEqual(["src/fields.ts:2"]);
  });

  /**
   * Where a copy sits decides whether anyone can own it. A copy in a test, an example, a fixture
   * or vendored code is written to stand alone, and two separately published packages do not import
   * each other, so a block in each has no owner both could call. Inside one package the same pair
   * is reported. The package is the nearest `package.json` above the file; without one, the whole
   * tree is one package.
   */
  it("reports a copy one package can own, and not one in a test, an example or two packages", () => {
    const alpha = TWICE.slice(0, TWICE.indexOf("\n\n") + 1);
    const read = (paths: readonly string[], manifests: readonly string[] = []): string[] => {
      const files = new Map([
        ...paths.map((path): [string, string] => [path, alpha]),
        ...manifests.map((path): [string, string] => [path, "{}"]),
      ]);
      return treeFindingsOver(files, files)
        .filter((finding) => finding.kind === "copied-block")
        .map((finding) => `${finding.path}:${finding.line}`);
    };
    expect(read(["src/a.ts", "src/b.ts"])).toStrictEqual(["src/a.ts:2"]);
    expect(read(["src/a.ts", "src/a_test.ts"])).toStrictEqual([]);
    expect(read(["src/a.ts", "src/examples/a.ts"])).toStrictEqual([]);
    expect(read(["src/a.ts", "src/fixtures/a.ts"])).toStrictEqual([]);
    expect(read(["src/a.ts", "src/vendor/a.ts"])).toStrictEqual([]);
    expect(
      read(["src/one/a.ts", "src/two/a.ts"], ["src/one/package.json", "src/two/package.json"]),
    ).toStrictEqual([]);
    expect(
      read(
        ["src/one/a.ts", "src/one/b.ts", "src/two/a.ts"],
        ["src/one/package.json", "src/two/package.json"],
      ),
    ).toStrictEqual(["src/one/a.ts:2"]);
  });

  /**
   * A site's id hashes the text of every place it spans. The copy scan compares literals as one
   * token whatever they spell, so an edited literal in the second copy is still reported at the
   * same places — and the id that once hashed the first place alone kept its answer for it.
   */
  it("names a copied block by the text of both copies, wherever the file puts them", () => {
    const id = (text: string): string => {
      const files = new Map([["src/twice.ts", text]]);
      const site = treeFindingsOver(files, files).find((finding) => finding.kind === "copied-block");
      if (site === undefined) throw new Error("the fixture holds one copy");
      return siteId("tree/copied-block", sitePlaces(site, files));
    };
    const at = TWICE.lastIndexOf('"#"');
    const secondEdited = `${TWICE.slice(0, at)}"//"${TWICE.slice(at + 3)}`;
    expect(id(`\n\n\n${TWICE}`)).toBe(id(TWICE));
    expect(id(secondEdited)).not.toBe(id(TWICE));
    expect(id(TWICE.replace('"#"', '"//"'))).not.toBe(id(TWICE));
  });

  afterAll(cleanupScratch);

  it("leaves a dot-directory out of the corpus both whole-tree scans read", async () => {
    const root = scratchDir("ana-corpus-dotdir-");
    await Bun.write(join(root, "authored.ts"), "export const kept = 1;\n");
    await Bun.write(join(root, ".falsifier-scratch-x", "generated.ts"), "export const staged = 2;\n");
    // Three dozen test files stage a bundle inside the checkout so its `@ana/*` imports resolve
    // through the root node_modules, and `test` is one of the roots this scan reads. Their bytes
    // entered the census as authored shapes for as long as the suite ran, and the read could lose
    // its race with the removal: a gate died on 2026-09-20 with `ENOENT` on an `intent.json` that
    // had existed when the walk listed it.
    expect([...corpus([root], [".ts"]).keys()]).toStrictEqual([join(root, "authored.ts")]);
  });

  it("reads this repository's own corpus, and every shape it finds is declared and on disk", () => {
    const found = treeFindings();
    expect(found.length).toBeGreaterThan(0);
    const undeclared = [...new Set(found.map((finding) => finding.kind))].filter(
      (name) => !(name in TREE_FINDING_ARGUMENTS),
    );
    expect(undeclared).toStrictEqual([]);
    const absent = [...new Set(found.map((finding) => finding.path))].filter(
      (path) => !existsSync(resolve(repoRoot, path)),
    );
    expect(absent).toStrictEqual([]);
  });
});
