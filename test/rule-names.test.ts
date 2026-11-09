/**
 * The names of the lint rules and whole-tree scans, and every place that lists them
 * (`tools/oxlint/plugins.ts`).
 *
 * A rule's file, its folder and its plugin's map are the one record of it; every other list of
 * rules either reads that record or is held to it here. Adding `flag-count` once took eight hand
 * edits, each a second spelling of one name that nothing checked against the first, so a renamed
 * or deleted rule could leave a config entry that silently configures nothing, or a ledger row
 * that answers nothing. Each case names what drifted.
 */
import { describe, expect, it } from "bun:test";
import config from "../.oxlintrc.json" with { type: "json" };
import staged from "../tools/oxlint/staged-rules.json" with { type: "json" };
import { existsSync, readdirSync, readFileSync } from "../src/meta/filesystem.ts";
import { join, resolve } from "../src/meta/path.ts";
import { NOT_SLOP_LEDGER, readLedger, TREE_RULE_PREFIX } from "../tools/oxlint/not-slop-ledger.ts";
import { PLUGINS } from "../tools/oxlint/plugins.ts";
import { TREE_FINDING_ARGUMENTS } from "../tools/oxlint/tree-findings.ts";

const REPO = resolve(import.meta.dirname, "..");
const OXLINT = join(REPO, "tools/oxlint");
/** How every rule and scan kind is named, and what its prefix makes it (HABITS 12.13). */
const RULE_NAME = /^(?<kind>no|prefer|require|max)-(?<subject>[a-z]+(?:-[a-z]+)*)$/u;

/** Names two other lanes are still editing, renamed in the commit that lands them: delete each as
 *  it goes, and this list with the last. */
const PENDING = new Set([
  "implicit-state/co-assigned-flags",
  "implicit-state/files-as-phase",
  "implicit-state/mtime-as-lock",
  "implicit-state-opinionated/flag-count",
  "implicit-state-opinionated/flags-as-state",
  "implicit-state-opinionated/name-encoded-state",
  "tree/enumeration-literal-spread",
  "tree/partial-mapping",
  "tree/repeated-external-read",
  "tree/second-reader",
  "tree/state-literal-spread",
  "tree/unowned-state-literal",
]);

/** The documents that list rules by name, prefixed or in a table. */
const DOCUMENTS = [
  "tools/oxlint/HABITS.md",
  "tools/oxlint/FIXER-DECISIONS.md",
  "tools/oxlint/rules-off.tsv",
  ".claude/skills/simplify/SKILL.md",
];
/** `ana/no-deep-nesting` or `tree/no-unowned-fact` spelled in prose. */
const PREFIXED =
  /(?<![\w./-])(?:ana|anti-slop|implicit-state|implicit-state-opinionated|tree)\/[a-z][a-z0-9-]*[a-z0-9](?![\w/.-])/gu;
/** A backticked name in the fixer record, which names plugin rules alone. */
const BACKTICKED = /`((?:no|prefer|require|max)-[a-z-]+)`/gu;

/** Every rule as a finding names it, and every scan kind as the ledger does. */
const RULES = [...PLUGINS].flatMap(([plugin, { rules }]) =>
  Object.keys(rules).map((rule) => `${plugin}/${rule}`),
);
const KINDS = Object.keys(TREE_FINDING_ARGUMENTS).map((kind) => `${TREE_RULE_PREFIX}${kind}`);
const KNOWN = new Set([...RULES, ...KINDS]);
const nameOf = (id: string): string => id.slice(id.indexOf("/") + 1);
const read = (path: string): string => readFileSync(join(REPO, path), "utf8");

describe("the names of the lint rules", () => {
  it("names every rule and scan for what it rejects or asks for, by no-, prefer-, require- or max-", () => {
    expect([...KNOWN].filter((id) => !RULE_NAME.test(nameOf(id)) && !PENDING.has(id))).toStrictEqual([]);
    expect([...PENDING].filter((id) => !KNOWN.has(id) || RULE_NAME.test(nameOf(id)))).toStrictEqual([]);
  });

  it("registers each rule file under its own name, in the plugin its folder names", () => {
    const folders = readdirSync(OXLINT).filter((name) => existsSync(join(OXLINT, name, "index.ts")));
    expect(folders.toSorted()).toStrictEqual([...PLUGINS.keys()].toSorted());
    for (const [plugin, { rules }] of PLUGINS) {
      const files = readdirSync(join(OXLINT, plugin, "rules"))
        .filter((file) => file.endsWith(".ts"))
        .map((file) => file.slice(0, -".ts".length));
      expect([plugin, files.toSorted()]).toStrictEqual([plugin, Object.keys(rules).toSorted()]);
    }
  });

  it("gives every rule a test that names it", () => {
    const tests = readdirSync(join(REPO, "test"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => read(`test/${file}`))
      .join("\n");
    expect(RULES.filter((id) => !tests.includes(nameOf(id)))).toStrictEqual([]);
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

  it("answers no site in the not-slop ledger under a rule or scan that does not exist", () => {
    const { answers, unread } = readLedger(read(NOT_SLOP_LEDGER));
    expect(unread).toStrictEqual([]);
    expect(answers.map((answer) => answer.rule).filter((rule) => !KNOWN.has(rule))).toStrictEqual([]);
  });

  it("spells no rule or scan that does not exist in the documents that list them", () => {
    const spelled = DOCUMENTS.flatMap((path) =>
      [...read(path).matchAll(PREFIXED)].map(([id]) => `${path}: ${id}`),
    );
    expect(spelled.filter((entry) => !KNOWN.has(entry.slice(entry.indexOf(": ") + 2)))).toStrictEqual([]);
    const names = new Set(RULES.map(nameOf));
    const fixers = [...read("tools/oxlint/FIXER-DECISIONS.md").matchAll(BACKTICKED)].map(
      ([, name = ""]) => name,
    );
    expect(fixers.filter((name) => !names.has(name))).toStrictEqual([]);
  });
});
