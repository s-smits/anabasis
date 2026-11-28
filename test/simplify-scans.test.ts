import { afterAll, describe, expect, it } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { buildImportGraph, parsedSources } from "../tools/oxlint/tree-ast.ts";
import { identitiesWithoutOwner } from "../tools/oxlint/tree-identity.ts";
import {
  constantParameters,
  deadExports,
  duplicateFunctions,
  duplicateTypes,
  unusedFields,
  unusedReexports,
} from "../tools/oxlint/tree-structure.ts";
import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";

function parsed(entries: Record<string, string>) {
  return parsedSources(new Map(Object.entries(entries)));
}

describe("AST structural simplify scans", () => {
  it("distinguishes unused, aliased, default, live, and test-only exports through the import graph", () => {
    const files = parsed({
      "src/a.ts": [
        "export function live(x: number) { return x + 1; }",
        "export function unused(x: number) { return x + 2; }",
        "export function onlyTested(x: number) { return x + 3; }",
        "export function selfAndTested(x: number) { return x + 4; }",
        "export const usesSelf = () => selfAndTested(1);",
        "function localFn(x: number) { return x + 5; }",
        "function aliasedTestOnly(x: number) { return x + 6; }",
        "export { localFn as aliasedLive, aliasedTestOnly as testAlias };",
        "export default function mainEntry() { return 0; }",
      ].join("\n"),
      "src/b.ts":
        'import mainEntry, { aliasedLive, live, usesSelf } from "./a.ts";\nconsole.log(mainEntry(), live(1), aliasedLive(2), usesSelf());\n',
      "test/a.test.ts":
        'import { onlyTested, selfAndTested, testAlias } from "../src/a.ts";\nconsole.log(onlyTested(1), selfAndTested(2), testAlias(3));\n',
    });
    const owned = new Map([...files].filter(([path]) => path.startsWith("src/")));
    const findings = deadExports(owned, buildImportGraph(files)).map(
      ({ kind, detail }) => [kind, detail] as const,
    );
    expect(findings).toHaveLength(3);
    expect(
      findings.some(([kind, detail]) => kind === "no-unused-export" && detail.includes("`unused`")),
    ).toBe(true);
    expect(
      findings.some(([kind, detail]) => kind === "no-test-only-export" && detail.includes("`onlyTested`")),
    ).toBe(true);
    expect(
      findings.some(([kind, detail]) => kind === "no-test-only-export" && detail.includes("`testAlias`")),
    ).toBe(true);
  });

  it("flags unused re-exports while ignoring live forwards and node: re-exports", () => {
    const files = parsed({
      "src/owner.ts": "export const a = 1;\nexport const b = 2;\n",
      "src/fwd.ts": 'export { a, b } from "./owner.ts";\nexport { readFileSync } from "node:fs";\n',
      "src/use.ts": 'import { a } from "./fwd.ts";\nconsole.log(a);\n',
    });
    const graph = buildImportGraph(files);
    const findings = unusedReexports(files, graph, new Set(files.keys()));
    expect(findings.map((one) => one.detail)).toEqual([
      "`b` is re-exported here and no file imports it from this module",
    ]);
  });

  it("flags never-passed optional and always-constant literal parameters unless escaped or re-exported", () => {
    const files = parsed({
      "src/lib.ts": [
        'export function opt(x: number, flag = "auto") { return `${String(x)}:${flag}`; }',
        "export function fixed(x: number, tag: string) { return `${String(x)}:${tag}`; }",
        "export function escaped(x: number, tag = 'a') { return `${String(x)}:${tag}`; }",
        "export function forwarded(x: number, tag: string) { return `${String(x)}:${tag}`; }",
      ].join("\n"),
      "src/fwd.ts": 'export { forwarded } from "./lib.ts";\n',
      "src/use.ts": [
        'import { escaped, fixed, forwarded, opt } from "./lib.ts";',
        'export const r = [opt(1), opt(2), fixed(1, "land"), fixed(2, "land"), fixed(3, "land")];',
        'export const f = [forwarded(1, "land"), forwarded(2, "land"), forwarded(3, "land")];',
        "export const cb = [1, 2].map((n) => escaped(n));",
        "export const ref = escaped;",
      ].join("\n"),
    });
    const findings = constantParameters(files, files, buildImportGraph(files));
    expect(findings.map((one) => one.detail).toSorted()).toEqual([
      '`fixed` parameter `tag` is always "land" across 3 calls; inline it',
      "`opt` parameter `flag` is never passed across 2 calls; drop it",
    ]);
  });

  it("detects identical types and functions while distinguishing types, regexes, unaries, and parameter patterns", () => {
    const files = parsed({
      "src/one.ts": [
        "interface Alpha { ok: boolean; reason: string | null; path: string; digest: string | null; }",
        "interface SameNamesA { a: string; b: number; c: boolean; d: string; }",
        "const fmtA = ({ wins, losses, ties }: { wins: number; losses: number; ties: number }) =>",
        "  `${String(wins)} won, ${String(losses)} lost, ${String(ties)} tied`;",
        "const fmtDiffDestructureA = ({ wins, losses, ties }: { wins: number; losses: number; ties: number }) =>",
        "  `${String(wins)}-${String(losses)}-${String(ties)}`;",
        "const regexA = (text: string) => text.split(/,/u).map((part) => part.trim()).filter(Boolean);",
        "const unaryA = (values: number[]) => values.map((n) => -n).filter((n) => n !== 0);",
        'const defaultA = (parts: string[], sep = ",") => parts.map((p) => p.trim()).join(sep);',
      ].join("\n"),
      "src/two.ts": [
        "interface Beta { digest: string | null; path: string; ok: boolean; reason: string | null; }",
        "interface SameNamesB { a: number; b?: string; c: boolean; d: string; }",
        "const fmtB = ({ wins, losses, ties }: { wins: number; losses: number; ties: number }) =>",
        "  `${String(wins)} won, ${String(losses)} lost, ${String(ties)} tied`;",
        "const fmtDiffDestructureB = ({ left, right, mid }: { left: number; right: number; mid: number }) =>",
        "  `${String(left)}-${String(right)}-${String(mid)}`;",
        "const regexB = (text: string) => text.split(/;+/u).map((part) => part.trim()).filter(Boolean);",
        "const unaryB = (values: number[]) => values.map((n) => +n).filter((n) => n !== 0);",
        'const defaultB = (parts: string[], sep = ";") => parts.map((p) => p.trim()).join(sep);',
      ].join("\n"),
    });
    expect(duplicateTypes(files)).toHaveLength(1);
    const dupFns = duplicateFunctions(files);
    expect(dupFns).toHaveLength(1);
    expect(dupFns[0]?.detail).toContain("`fmtA`");
  });

  it("finds unread AST fields of four or more characters and skips model IDs in identitiesWithoutOwner", () => {
    const files = parsed({
      "src/a.ts": [
        "export interface Rec { readonly id: string; readonly live: number; readonly orphanField: boolean; }",
        'export const model = "claude/claude-opus-5-5";',
        'export const file = "bundle/verdicts.jsonl";',
      ].join("\n"),
      "src/b.ts": [
        'export const other = "claude/claude-opus-5-5";',
        'export const same = "bundle/verdicts.jsonl";',
        "export const live = 1;",
      ].join("\n"),
    });
    const counts = new Map<string, number>();
    for (const file of files.values()) {
      for (const word of file.text.match(/[A-Za-z_$][\w$]*/gu) ?? []) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
    expect(unusedFields(files, counts).map((one) => one.detail)).toEqual([
      "`orphanField` is declared and never spelled again",
    ]);
    expect(identitiesWithoutOwner(files).map((one) => one.detail)).toEqual([
      "`bundle/verdicts.jsonl` is spelled in 2 files and `file` in src/a.ts already names it",
    ]);
  });
});

const STAGED_SLOP = join(import.meta.dir, "..", "tools/oxlint/staged-slop.ts");
const BLOCK = [
  "  const text = await Bun.file(path).text();",
  String.raw`  const rows = text.split("\n").filter(Boolean);`,
  "  const trimmed = rows.map((row) => row.trim());",
  '  return trimmed.filter((row) => row !== "#");',
];
const SLOP_FILES = {
  "tools/a.ts": [
    'import { readRows } from "./b.ts";',
    "console.log(readRows);",
    "export function lonely(): number {",
    "  return 2;",
    "}",
  ],
  "tools/b.ts": ["export async function readRows(path: string): Promise<string[]> {", ...BLOCK, "}"],
  "tools/c.ts": [
    'import { readRows } from "./b.ts";',
    "export async function other(path: string): Promise<string[]> {",
    "  console.log(readRows);",
    ...BLOCK,
    "}",
  ],
};
const slopRoot = mkdtempSync(join(tmpdir(), "ana-staged-slop-"));
const slopTemplate = join(slopRoot, "template");
const gitAt = (cwd: string, ...args: string[]): string => execTextSync("git", args, { cwd }).trim();
mkdirSync(join(slopTemplate, "tools"), { recursive: true });
for (const [path, lines] of Object.entries(SLOP_FILES)) {
  writeFileSync(join(slopTemplate, path), `${lines.join("\n")}\n`);
}
gitAt(slopTemplate, "init", "-q");
gitAt(slopTemplate, "config", "user.email", "fixture@localhost");
gitAt(slopTemplate, "config", "user.name", "fixture");
gitAt(slopTemplate, "add", "-A");
gitAt(slopTemplate, "commit", "-qm", "base");
afterAll(() => rmSync(slopRoot, { recursive: true, force: true }));

type Place = readonly [path: string, line: number];
interface Change {
  staged?: readonly Place[];
  unstaged?: readonly Place[];
  added?: string;
}

function touch(root: string, [path, line]: Place): void {
  const lines = readFileSync(join(root, path), "utf8").split("\n");
  lines[line - 1] = `${lines[line - 1]} `;
  writeFileSync(join(root, path), lines.join("\n"));
}

function stagedSlop({ staged = [], unstaged = [], added }: Change) {
  const root = mkdtempSync(join(slopRoot, "case-"));
  cpSync(slopTemplate, root, { recursive: true });
  for (const place of staged) touch(root, place);
  if (added !== undefined) writeFileSync(join(root, added), "console.log(1);\n");
  gitAt(root, "add", "-A");
  for (const place of unstaged) touch(root, place);
  const { status, stderr } = spawnTextSync(capturedExecPath, [STAGED_SLOP], { cwd: root });
  const report = join(gitAt(root, "rev-parse", "--absolute-git-dir"), "ana", "slop-report.md");
  return {
    status,
    sites: [...stderr.matchAll(/^ {2}\d+\. (\S+) (\S+) \[/gmu)].map(([, kind, where]) => `${kind} ${where}`),
    tally: existsSync(report) ? readFileSync(report, "utf8").split("\n")[2] : null,
  };
}

const tallyOf = (elsewhere: number): string =>
  `1 sites touch the lines this commit changes; ${elsewhere} more sit elsewhere in the files it stages.`;
const CLEAN = { status: 0, sites: [], tally: null };
const EXPORT_LINE = { status: 1, sites: ["no-unused-export tools/a.ts:3"], tally: tallyOf(1) };
const BLOCK_PLACE = { status: 1, sites: ["no-duplicate-block tools/b.ts:2"], tally: tallyOf(2) };

describe("the pre-commit slop gate over a fixture repository's staged lines", () => {
  it.each([
    ["nothing staged", {}, CLEAN],
    ["an unused export's own line", { staged: [["tools/a.ts", 3]] }, EXPORT_LINE],
    ["only the line after it", { staged: [["tools/a.ts", 4]] }, CLEAN],
    ["the export's line changed but unstaged", { unstaged: [["tools/a.ts", 3]] }, CLEAN],
    [
      "a staged file judged on disk",
      { staged: [["tools/a.ts", 4]], unstaged: [["tools/a.ts", 3]] },
      EXPORT_LINE,
    ],
    ["the line before a duplicate's second place", { staged: [["tools/c.ts", 3]] }, CLEAN],
    ["that place's first line", { staged: [["tools/c.ts", 4]] }, BLOCK_PLACE],
    ["that place's last line", { staged: [["tools/c.ts", 7]] }, BLOCK_PLACE],
    ["the line after that place", { staged: [["tools/c.ts", 8]] }, CLEAN],
    [
      "a new file nothing imports",
      { added: "tools/d.ts" },
      { status: 1, sites: ["no-unused-module tools/d.ts"], tally: tallyOf(0) },
    ],
  ] satisfies [string, Change, ReturnType<typeof stagedSlop>][])("%s", (_name, change, expected) => {
    expect(stagedSlop(change)).toEqual(expected);
  });
});
