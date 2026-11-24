/**
 * The records lint keeps beside its rules: the plugin map every list of rules reads
 * (`tools/oxlint/plugins.ts`), the two configs, the fixer declarations, the ledger of core rules
 * left off and the not-slop ledger. A drifted entry in any of them configures, exempts or answers
 * nothing, and lint stays green, so each case names what drifted.
 */
import { describe, expect, it } from "bun:test";
import config from "../.oxlintrc.json" with { type: "json" };
import staged from "../tools/oxlint/staged-rules.json" with { type: "json" };
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import {
  type Answer,
  formatLedger,
  NOT_SLOP_LEDGER,
  readLedger,
  siteId,
  TREE_RULE_PREFIX,
  unanswerable,
} from "../tools/oxlint/not-slop-ledger.ts";
import {
  COMMENT_RATCHET_FILE,
  formatCommentRatchet,
  readCommentRatchet,
} from "../tools/oxlint/comment-ratchet.ts";
import { PLUGINS } from "../tools/oxlint/plugins.ts";
import { TREE_FINDING_ARGUMENTS } from "../tools/oxlint/tree-findings.ts";
import { type Diagnostic, lintSite, OXLINT_BINARY } from "../tools/runtime/lint.ts";
import { present } from "./helpers/matchers.ts";

/** How every rule and scan kind is named, and what its prefix makes it (HABITS 12.13). */
const RULE_NAME = /^(?:no|prefer|require|max)-[a-z]+(?:-[a-z]+)*$/u;
/** The documents that list rules by name, prefixed or in a table. */
const DOCUMENTS = [
  "tools/oxlint/HABITS.md",
  "tools/oxlint/FIXER-DECISIONS.md",
  "tools/oxlint/rules-off.tsv",
  ".claude/skills/simplify/SKILL.md",
];
/** `ana/no-deep-nesting` or `tree/no-unused-export` spelled in prose. */
const PREFIXED =
  /(?<![\w./-])(?:ana|anti-slop|implicit-state|implicit-state-opinionated|tree)\/[a-z][a-z0-9-]*[a-z0-9](?![\w/.-])/gu;
/** A backticked name in the fixer record, which names plugin rules alone. */
const BACKTICKED = /`((?:no|prefer|require|max)-[a-z-]+)`/gu;
const FIXABLE = /fixable: "code"/u;
const TOP: Readonly<Record<string, JsonValue>> = config.rules;
const HEADER = "id\trule\tpath\tanswered\treason\texcerpt";

const REPO = resolve(import.meta.dirname, "..");
const OXLINT = join(REPO, "tools/oxlint");
const read = (path: string): string => readFileSync(join(REPO, path), "utf8");

const RULES = [...PLUGINS].flatMap(([plugin, { rules }]) =>
  Object.keys(rules).map((rule) => `${plugin}/${rule}`),
);
const KINDS = Object.keys(TREE_FINDING_ARGUMENTS).map((kind) => `${TREE_RULE_PREFIX}${kind}`);
const KNOWN = new Set([...RULES, ...KINDS]);
const nameOf = (id: string): string => id.slice(id.indexOf("/") + 1);

/** Every rule's source, by its plugin and name. */
const SOURCES = [...PLUGINS.keys()].flatMap((plugin) =>
  readdirSync(join(OXLINT, plugin, "rules"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({
      id: `${plugin}/${file.slice(0, -3)}`,
      source: read(`tools/oxlint/${plugin}/rules/${file}`),
    })),
);

describe("the rule registry", () => {
  it("names every rule and scan for what it rejects or asks for, by no-, prefer-, require- or max-", () => {
    expect([...KNOWN].filter((id) => !RULE_NAME.test(nameOf(id)))).toStrictEqual([]);
  });

  it("registers each rule file under its own name, in the plugin its folder names", () => {
    const folders = readdirSync(OXLINT).filter((name) => existsSync(join(OXLINT, name, "index.ts")));
    expect(folders.toSorted()).toStrictEqual([...PLUGINS.keys()].toSorted());
    expect(SOURCES.map(({ id }) => id).toSorted()).toStrictEqual(RULES.toSorted());
  });

  it("runs every rule from one of the two configs, and configures none that does not exist", () => {
    const configured = [
      ...Object.keys(config.rules),
      ...config.overrides.flatMap((override) => Object.keys(override.rules)),
      ...Object.keys(staged.rules),
    ].filter((id) => PLUGINS.has(id.split("/")[0] ?? ""));
    expect(configured.filter((id) => !KNOWN.has(id))).toStrictEqual([]);
    expect(RULES.filter((id) => !configured.includes(id))).toStrictEqual([]);
  });

  it("spells no rule or scan that does not exist in the documents and the ledger that name them", () => {
    const spelled = DOCUMENTS.flatMap((path) => [...read(path).matchAll(PREFIXED)].map(([id]) => id));
    const { answers, unread } = readLedger(read(NOT_SLOP_LEDGER));
    expect(unread).toStrictEqual([]);
    expect(
      [...spelled, ...answers.map((answer) => answer.rule)].filter((id) => !KNOWN.has(id)),
    ).toStrictEqual([]);
    const names = new Set(RULES.map(nameOf));
    const fixers = [...read("tools/oxlint/FIXER-DECISIONS.md").matchAll(BACKTICKED)].map(
      ([, name = ""]) => name,
    );
    expect(fixers.filter((name) => !names.has(name))).toStrictEqual([]);
  });
});

describe("the fixer declarations", () => {
  const decisions = read("tools/oxlint/FIXER-DECISIONS.md");

  it("makes every rule declare a fixer or write 'no fix', and appear in the record of why", () => {
    expect(SOURCES.filter(({ source }) => !FIXABLE.test(source) && !/no fix/iu.test(source))).toStrictEqual(
      [],
    );
    expect(SOURCES.filter(({ id }) => !decisions.includes(nameOf(id))).map(({ id }) => id)).toStrictEqual([]);
  });

  it("keeps the declaration and the fix agreeing, because oxlint drops a fix from an undeclared rule", () => {
    const disagree = SOURCES.filter(({ source }) => FIXABLE.test(source) !== /\bfix: \(fixer/u.test(source));
    expect(disagree.map(({ id }) => id)).toStrictEqual([]);
  });
});

/** One row of `tools/oxlint/rules-off.tsv`: a core rule, the files it is off for (`*` for all), and why. */
const OFF = read("tools/oxlint/rules-off.tsv")
  .trimEnd()
  .split("\n")
  .slice(1)
  .map((line) => {
    const [rule = "", files = "", sites = "", status = "", reason = ""] = line.split("\t");
    return { rule, files, sites, status, reason };
  });
const isOff = (severity: unknown): boolean =>
  severity === "off" || (Array.isArray(severity) && severity[0] === "off");

describe("the core rules left off", () => {
  it("names a file that exists in every override entry that is not a glob, and only turns rules off there", () => {
    const listing = config.overrides.filter((override) =>
      override.files.every((entry) => !entry.includes("*")),
    );
    expect(
      listing.flatMap((override) => override.files.filter((entry) => !existsSync(join(REPO, entry)))),
    ).toEqual([]);
    expect(
      listing.flatMap((override) => Object.entries(override.rules).filter(([, level]) => level !== "off")),
    ).toEqual([]);
  });

  it("turns no rule off at the top level, and one off for some files only beside its row", () => {
    expect(Object.keys(TOP).filter((rule) => isOff(TOP[rule]))).toEqual([]);
    const unrecorded = config.overrides.flatMap((override) =>
      Object.entries(override.rules)
        .filter(([, severity]) => isOff(severity))
        .map(([rule]) => `${rule} ${override.files.join(",")}`)
        .filter((entry) => !OFF.some((row) => `${row.rule} ${row.files}` === entry)),
    );
    expect(unrecorded).toEqual([]);
    const malformed = OFF.filter(
      (row) => !/^\d+$/u.test(row.sites) || !["off", "staged"].includes(row.status) || row.reason === "",
    );
    expect(malformed).toEqual([]);
  });

  it("decides every rule Oxlint offers in scope: configured, or a row with its sentence", () => {
    // To a file instead of a pipe: under Bun on Linux a piped listing is cut short with exit 0.
    const folder = mkdtempSync(join(tmpdir(), "ana-oxlint-rules-"));
    const listing = join(folder, "rules.json");
    const listed = Bun.spawnSync({
      cmd: [capturedExecPath, OXLINT_BINARY, "--rules", "-f", "json"],
      cwd: REPO,
      stdout: Bun.file(listing),
      timeout: 30_000,
    });
    expect(listed.exitCode).toBe(0);
    const text = readFileSync(listing, "utf8");
    rmSync(folder, { recursive: true });
    const scopes = new Set(["eslint", "import", "node", "oxc", "promise", "typescript", "unicorn"]);
    const categories = new Set(["correctness", "suspicious", "perf", "pedantic", "style", "restriction"]);
    const offered = parseJsonAs<{ scope: string; value: string; category: string }[]>(text)
      .filter(({ scope, category }) => scopes.has(scope) && categories.has(category))
      .map(({ scope, value }) => `${scope}/${value}`);
    const everywhere = new Set(OFF.filter((row) => row.files === "*").map((row) => row.rule));
    expect(offered.filter((rule) => TOP[rule] === undefined && !everywhere.has(rule))).toEqual([]);
    expect([...everywhere].filter((rule) => TOP[rule] !== undefined || !offered.includes(rule))).toEqual([]);
  });
});

const row = (overrides: Partial<Answer>): Answer => ({
  id: "0123456789ab",
  rule: "anti-slop/no-runtime-typeof",
  path: "src/meta/json-shape.ts",
  answered: "2026-09-21",
  reason: "the one typeof behind isString",
  excerpt: 'return typeof value === "string";',
  ...overrides,
});

/** A finding at `line`, spanning `head` from its first character, over `source`. */
function finding(source: string, line: number, head: string): Diagnostic {
  const lines = source.split("\n");
  const offset =
    new TextEncoder().encode(lines.slice(0, line - 1).join("\n")).length +
    (line > 1 ? 1 : 0) +
    present(lines[line - 1]).indexOf(head);
  return {
    message: "m",
    code: "anti-slop(no-runtime-typeof)",
    severity: "error",
    filename: "src/example.ts",
    labels: [{ span: { offset, length: new TextEncoder().encode(head).length, line, column: 1 } }],
  };
}

describe("the not-slop ledger", () => {
  it("ids a site by every place it spans, ignoring order and spacing", () => {
    const first = { path: "src/a.ts", text: "const kept = rows.filter(Boolean);" };
    const second = { path: "src/b.ts", text: first.text };
    const id = siteId("tree/no-duplicate-block", [first, second]);
    expect(siteId("tree/no-duplicate-block", [second, { ...first, text: `  ${first.text}\n` }])).toBe(id);
    expect(
      siteId("tree/no-duplicate-block", [first, { ...second, text: "rows.filter(isString);" }]),
    ).not.toBe(id);
  });

  it("keeps a lint site's id when lines arrive above it, and loses it when its line changes", () => {
    const source = 'export function isString(value: unknown) {\n  return typeof value === "string";\n}\n';
    const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
    const site = lintSite(finding(source, 2, "typeof value"), bytes(source));
    const moved = `// a note\n\n${source}`;
    const edited = source.replace('"string"', '"number"');
    expect(site).not.toBeNull();
    expect(lintSite(finding(moved, 4, "typeof value"), bytes(moved))?.id).toBe(site?.id);
    expect(lintSite(finding(edited, 2, "typeof value"), bytes(edited))?.id).not.toBe(site?.id);
  });

  it("refuses a short reason, a bad id, a bad date, an unknown header, and rules it cannot answer", () => {
    const rows = [row({ reason: "not slop" }), row({ id: "b468e7f2" }), row({ answered: "yesterday" })];
    const ledger = readLedger([HEADER, ...rows.map((one) => Object.values(one).join("\t"))].join("\n"));
    expect([ledger.answers, ledger.unread.length]).toStrictEqual([[], 3]);
    expect(readLedger("id shape path why\n").unread).toHaveLength(1);
    for (const [rule, refused] of [
      ["eslint/no-shadow", true],
      ["anti-slop/prefer-subpath-import", true],
      ["ana/no-such-rule", true],
      ["ana/no-inline-slop-answer", true],
      ["ana/no-comments", true],
      ["anti-slop/no-runtime-typeof", false],
      ["tree/no-duplicate-block", false],
    ] as const) {
      expect([rule, unanswerable(rule) !== null]).toStrictEqual([rule, refused]);
    }
  });

  it("writes one row per id, sorted, with the later of two answers to one site", () => {
    const text = formatLedger([
      row({ id: "bbbbbbbbbbbb", path: "src/z.ts" }),
      row({ id: "aaaaaaaaaaaa", reason: "the first answer, since replaced" }),
      row({ id: "aaaaaaaaaaaa", reason: "the answer a union merge kept last" }),
    ]);
    const { answers } = readLedger(text);
    expect(answers.map((answer) => [answer.id, answer.reason])).toStrictEqual([
      ["aaaaaaaaaaaa", "the answer a union merge kept last"],
      ["bbbbbbbbbbbb", "the one typeof behind isString"],
    ]);
  });
});

describe("the comment ratchet", () => {
  it("keeps tools/oxlint/comment-ratchet.tsv valid, sorted, positive, and pointing at existing files", () => {
    const text = read(COMMENT_RATCHET_FILE);
    const { entries, unread } = readCommentRatchet(text);
    expect(unread).toStrictEqual([]);
    expect(text).toBe(formatCommentRatchet(entries));
    const missing = [...entries.keys()].filter((path) => !existsSync(join(REPO, path)));
    expect(missing).toStrictEqual([]);
  });

  it("rejects malformed, zero, or duplicate ratchet rows and drops zero counts when formatting", () => {
    const bad = readCommentRatchet("path\tcount\nsrc/a.ts\t0\nsrc/b.ts\t2\nsrc/b.ts\t1\nnot-a-row\n");
    expect(bad.unread).toHaveLength(3);
    expect(
      formatCommentRatchet(
        new Map([
          ["src/b.ts", 2],
          ["src/a.ts", 0],
        ]),
      ),
    ).toBe("path\tcount\nsrc/b.ts\t2\n");
  });
});
