import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { dirname, join, resolve } from "../../src/meta/path.ts";
import { expectedLines } from "./oxlint-rule-fixture.ts";
import { capturedExecPath } from "../../src/meta/process.ts";

type RuleCase = readonly [rule: string, fixture: string, reports: number, at?: string];

/** Run a rule table once, keeping each fixture's physical scope and complete line oracle. */
export async function lintRules(plugin: string, cases: readonly RuleCase[]): Promise<string> {
  const repo = resolve(import.meta.dirname, "../..");
  const directory = mkdtempSync(join(tmpdir(), "ana-rule-table-"));
  const staged = cases.map(([rule, fixture, reports, at = "fixture.ts"], index) => {
    const path = `case-${String(index)}/${at}`;
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, fixture);
    return { rule, fixture, reports, path, file };
  });
  const config = join(directory, "oxlintrc.json");
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: plugin, specifier: join(repo, `tools/oxlint/${plugin}/index.ts`) }],
      overrides: staged.map(({ rule, path }) => ({
        files: [path],
        rules: { [`${plugin}/${rule}`]: "error" },
      })),
    }),
  );
  const child = Bun.spawn(
    [
      capturedExecPath,
      "--no-env-file",
      "node_modules/oxlint/bin/oxlint",
      "-c",
      config,
      "--format=unix",
      ...staged.map(({ file }) => file),
    ],
    { cwd: repo, env: Bun.env, stdout: "pipe", stderr: "pipe", timeout: 30_000 },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && code !== 1) {
    throw new Error(`oxlint ${plugin} ended with ${String(child.signalCode ?? code)}: ${stderr.trimEnd()}`);
  }
  const lines = stdout.split("\n");
  for (const { rule, fixture, reports, path, file } of staged) {
    const expected = reports === 0 ? [] : expectedLines(fixture);
    expect(expected, `${rule} marker count`).toHaveLength(reports);
    const actual = lines
      .filter((line) => line.startsWith(`${file}:`) && line.endsWith(`(${rule})]`))
      .map((line) => Number(line.slice(file.length + 1).split(":")[0]))
      .sort((a, b) => a - b);
    expect(actual, `${plugin}/${rule} at ${path}`).toStrictEqual(expected);
  }
  return stdout;
}
