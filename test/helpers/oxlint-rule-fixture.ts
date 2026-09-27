import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import type { JsonValue } from "../../src/meta/json-shape.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { dirname, join, resolve } from "../../src/meta/path.ts";

/** Long enough for oxlint and its plugin to load on a crowded host, short of the per-test wall. */
const RUN_TIMEOUT_MS = 30_000;

/**
 * What a fixture needs besides its own text: other files in the temporary tree, such as the
 * `package.json` a rule reads, keyed by their path there, and the options the rule is given.
 */
export interface Staging {
  readonly files?: ReadonlyMap<string, string>;
  readonly options?: readonly JsonValue[];
}

/**
 * Run one plugin rule over a fixture and read back what it reported, or what it rewrote.
 *
 * A fixture labels every declaration `// REPORT <why>` or `// ADMITTED <why>`, and
 * `expectedLines` reads the verdicts out of that same text. Writing the expectation
 * once catches both halves of a broken rule: one that reports nothing fails on the
 * REPORT lines, and one that reports everything fails on the ADMITTED ones.
 *
 * `at` places the fixture inside the temporary tree, because several rules speak to one part of
 * the repository only and decide that from the path. A rule scoped to `src` sees nothing in a
 * file called `fixture.ts`, so its test would pass while reporting nothing at all.
 */
export function expectedLines(fixture: string): number[] {
  return fixture.split("\n").flatMap((line, index) => (line.includes("// REPORT") ? [index + 1] : []));
}

/** The fixture written into a fresh temporary tree, with the oxlint config that runs one rule. */
function stage(plugin: string, rule: string, fixtureText: string, at: string, staging: Staging) {
  const repoRoot = resolve(import.meta.dirname, "../..");
  const directory = mkdtempSync(join(tmpdir(), "ana-rule-"));
  const fixture = join(directory, at);
  const config = join(directory, "oxlintrc.json");
  for (const [path, text] of new Map([...(staging.files ?? []), [at, fixtureText]])) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  }
  const level = staging.options === undefined ? "error" : ["error", ...staging.options];
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: plugin, specifier: join(repoRoot, `tools/oxlint/${plugin}/index.ts`) }],
      rules: { [`${plugin}/${rule}`]: level },
    }),
  );
  // oxlint exits 1 once it reports, which is the expected path here, so read its output whatever
  // it returns short of a crash. The spawn is asynchronous: a synchronous one inside a test worker
  // is where Bun 1.4 leaves the worker spinning over an exited child, and it holds every test the
  // worker runs concurrently until the idle wall ends the suite.
  const run = async (...extra: string[]): Promise<string> => {
    const child = Bun.spawn(
      [
        Bun.argv[0]!,
        "--no-env-file",
        "node_modules/oxlint/bin/oxlint",
        "-c",
        config,
        ...extra,
        "--format=unix",
        fixture,
      ],
      { cwd: repoRoot, env: Bun.env, stdout: "pipe", stderr: "pipe", timeout: RUN_TIMEOUT_MS },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0 && code !== 1) {
      throw new Error(
        `oxlint ${plugin}/${rule} ended with ${String(child.signalCode ?? code)}: ${stderr.trimEnd()}`,
      );
    }
    return stdout;
  };
  return { fixture, run };
}

/** One `<line>:<column>: <message>` row per report, in the order oxlint printed them. */
async function runRule(
  plugin: string,
  rule: string,
  fixtureText: string,
  at: string,
  staging: Staging,
): Promise<string[]> {
  const { fixture, run } = stage(plugin, rule, fixtureText, at, staging);
  // oxlint's own built-ins report over the fixture too — `eslint(no-unused-vars)` fires on
  // nearly every parameter a rule fixture declares — so keep only rows this rule tagged.
  //
  // The path comes from the file that was staged rather than a pattern for it. The pattern here
  // was `[^/:]+\.tsx?:`, which matched no row at all once `at` named a `.mjs` file — and `.claude`
  // joined the lint scope on 2026-09-20 carrying a whole tree of them. A test placing its fixture
  // there read back an empty list and passed, having asked the rule nothing.
  const escaped = fixture.replace(/[.*+?^\\${}()|[\]]/gu, String.raw`\$&`);
  const tagged = new RegExp(`${escaped}:(?<row>\\d+:\\d+: .*\\(${rule}\\)\\])`, "gu");
  return [...(await run()).matchAll(tagged)].map(([, row]) => row ?? "");
}

/** Lines `plugin/rule` reported over `fixtureText`, ascending. */
export async function reportedLines(
  plugin: string,
  rule: string,
  fixtureText: string,
  at = "fixture.ts",
  staging: Staging = {},
): Promise<number[]> {
  return (await runRule(plugin, rule, fixtureText, at, staging))
    .map((row) => Number(row.split(":")[0]))
    .sort((a, b) => a - b);
}

/** The message text `plugin/rule` reported over `fixtureText`, in report order. */
export async function reportedMessages(
  plugin: string,
  rule: string,
  fixtureText: string,
  at = "fixture.ts",
): Promise<string[]> {
  return (await runRule(plugin, rule, fixtureText, at, {})).map((row) => row.split(": ").slice(1).join(": "));
}

/**
 * The fixture text after the rule's own fixer has run to convergence.
 *
 * oxlint applies non-overlapping fixes in one pass and drops the rest, so one pass is not the
 * result a developer running `--fix` sees; the sweep that settled 185 call sites took three. The
 * loop runs until the bytes stop moving, which is what the shared import edit needs: every
 * diagnostic offers it, so whichever copy survives the overlap check lands.
 */
export async function fixedSource(
  plugin: string,
  rule: string,
  fixtureText: string,
  at = "fixture.ts",
  staging: Staging = {},
): Promise<string> {
  const { fixture, run } = stage(plugin, rule, fixtureText, at, staging);
  let before = fixtureText;
  for (let pass = 0; pass < 10; pass += 1) {
    await run("--fix");
    const after = readFileSync(fixture, "utf8");
    if (after === before) return after;
    before = after;
  }
  return before;
}
