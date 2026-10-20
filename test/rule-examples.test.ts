/**
 * The before-and-after pairs every rule and tree scan shows once after its findings
 * (`tools/oxlint/rule-examples.ts`).
 *
 * A pair is advice an agent copies, so each is linted rather than trusted. A `before` has to be
 * a shape its own rule reports, or the pair teaches nothing about the rule. An `after` has to
 * pass every rule of both plugins, under the options `.oxlintrc.json` gives them, or the pair
 * hands the reader a repair another rule then refuses. Both are linted in one oxlint run each,
 * every pair a file of its own under a folder that is its package root, so a pair's `path` climbs
 * to the root as it would in the tree, and the whole set costs two runs.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import config from "../.oxlintrc.json" with { type: "json" };
import manifest from "../package.json" with { type: "json" };
import { mkdirSync, mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join, resolve } from "../src/meta/path.ts";
import { examplesFor } from "../tools/runtime/lint.ts";
import { type RuleExample, ruleExamples } from "../tools/oxlint/rule-examples.ts";
import { TREE_FINDING_EXAMPLES } from "../tools/oxlint/tree-findings.ts";

const REPO = resolve(import.meta.dirname, "..");
const PLUGINS = ["ana", "anti-slop"];
/** Where a pair is linted when it names no place of its own. */
const DEFAULT_PATH = "src/example.ts";
/** A pair is a glance, not a fixture. */
const MOST_LINES = 6;

const RULES = ruleExamples();
const TREES = Object.entries(TREE_FINDING_EXAMPLES).map(([kind, pairs]) => [`tree/${kind}`, pairs] as const);

/** One `file:line:col: message [Error/plugin(rule)]` row of oxlint's unix format. */
const ROW = /^(?<file>.+?):\d+:\d+: .* \[\w+\/(?<plugin>[\w-]+)\((?<rule>[\w-]+)\)\]$/u;

/** The plugin rules every file is linted under, as the repository's own config sets them. */
const LEVELS = Object.fromEntries(
  Object.entries(config.rules).filter(([rule]) => PLUGINS.some((plugin) => rule.startsWith(`${plugin}/`))),
);

/**
 * Each snippet written to a file of its own in one fresh tree, linted in one run; for each file,
 * the plugin rules that reported in it.
 */
async function reportsIn(texts: ReadonlyMap<string, string>): Promise<Map<string, Set<string>>> {
  const directory = mkdtempSync(join(tmpdir(), "ana-examples-"));
  const configPath = join(directory, "oxlintrc.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      jsPlugins: PLUGINS.map((name) => ({ name, specifier: join(REPO, `tools/oxlint/${name}/index.ts`) })),
      rules: LEVELS,
    }),
  );
  const files = [...texts].map(([path, text]) => {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${text}\n`);
    // Each pair's folder is a package root of its own, so a `path` climbs as it would in the tree.
    const root = join(directory, ...path.split("/").slice(0, 3));
    writeFileSync(join(root, "package.json"), JSON.stringify({ imports: manifest.imports }));
    return file;
  });
  const child = Bun.spawn(
    [
      Bun.argv[0] ?? "bun",
      "--no-env-file",
      "node_modules/oxlint/bin/oxlint",
      "-c",
      configPath,
      "--format=unix",
      ...files,
    ],
    { cwd: REPO, env: Bun.env, stdout: "pipe", stderr: "pipe", timeout: 60_000 },
  );
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0 && code !== 1) throw new Error(`oxlint ended with ${String(code)}`);
  const reported = new Map<string, Set<string>>();
  for (const line of stdout.split("\n")) {
    const { file, plugin, rule } = ROW.exec(line)?.groups ?? {};
    if (file === undefined || !PLUGINS.includes(plugin ?? "")) continue;
    const path = file.slice(directory.length + 1);
    reported.set(path, (reported.get(path) ?? new Set()).add(`${plugin ?? ""}/${rule ?? ""}`));
  }
  return reported;
}

/** Every pair's snippet, under a numbered folder so two pairs naming one path stay apart. */
function snippets(
  owners: readonly (readonly [string, readonly RuleExample[]])[],
  side: "before" | "after",
): Map<string, string> {
  return new Map(
    owners.flatMap(([owner, pairs]) =>
      pairs.map((pair, index) => [`${owner}/${index}/${pair.path ?? DEFAULT_PATH}`, pair[side]] as const),
    ),
  );
}

let before = new Map<string, Set<string>>();
let after = new Map<string, Set<string>>();
beforeAll(async () => {
  [before, after] = await Promise.all([
    reportsIn(snippets([...RULES], "before")),
    reportsIn(snippets([...RULES, ...TREES], "after")),
  ]);
}, 120_000);

describe("each rule's examples", () => {
  for (const [rule, pairs] of RULES) {
    it(`${rule} shows a shape it reports and a repair every rule passes`, () => {
      expect(pairs.length).toBeGreaterThan(0);
      for (const [index, pair] of pairs.entries()) {
        const at = `${rule}/${index}/${pair.path ?? DEFAULT_PATH}`;
        expect([at, pair.before.split("\n").length <= MOST_LINES]).toStrictEqual([at, true]);
        expect([at, pair.after.split("\n").length <= MOST_LINES]).toStrictEqual([at, true]);
        expect([at, before.get(at)?.has(rule) === true]).toStrictEqual([at, true]);
        expect([at, [...(after.get(at) ?? [])]]).toStrictEqual([at, []]);
      }
    });
  }
});

describe("each tree scan's examples", () => {
  for (const [kind, pairs] of TREES) {
    it(`${kind} shows a repair every rule passes`, () => {
      expect(pairs.length).toBeGreaterThan(0);
      for (const [index, pair] of pairs.entries()) {
        const at = `${kind}/${index}/${pair.path ?? DEFAULT_PATH}`;
        expect([at, [...(after.get(at) ?? [])]]).toStrictEqual([at, []]);
      }
    });
  }
});

describe("the lint run", () => {
  it("prints a rule's examples once, after its findings, and nothing for a rule that keeps none", () => {
    const finding = (code: string) => ({ message: "", code, severity: "error", filename: "src/a.ts" });
    const lines = examplesFor([
      finding("ana(no-deep-nesting)"),
      finding("ana(no-deep-nesting)"),
      finding("eslint(no-console)"),
    ]);
    expect(lines.filter((line) => line.includes("ana/no-deep-nesting, for example:"))).toHaveLength(1);
    expect(lines.some((line) => line.includes("no-console"))).toBe(false);
    expect(examplesFor([finding("eslint(no-console)")])).toStrictEqual([]);
  });
});
