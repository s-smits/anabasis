/**
 * The override blocks in `.oxlintrc.json` are a debt ledger, and `tools/oxlint/BASELINE.md`
 * states its one rule: the lists only shrink. Two things can quietly break that, and both are
 * silent, because an entry matching nothing simply exempts nothing.
 *
 * An entry that names no file is the first. Regenerating the single-caller list from
 * `oxlint --format=unix` output put `94` and `problems` in it, because that format ends with a
 * `94 problems` summary line and the generator read every line as a path. Neither matched
 * anything, so lint stayed green and the ledger quietly claimed two more files than it held.
 *
 * A stale entry is the second: once the file it names is deleted or renamed, the line records
 * debt nobody owes and the count stops meaning anything.
 */
import { describe, expect, it } from "bun:test";
import oxlintrc from "../.oxlintrc.json" with { type: "json" };
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { OXLINT_BINARY } from "../tools/runtime/lint.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const topRules: Readonly<Record<string, JsonValue>> = oxlintrc.rules;

/**
 * The rules whose every member is decided, as of the whole-tree count of 5 November 2026: each
 * one Oxlint offers in these categories and plugins is configured at the top level of
 * `.oxlintrc.json`, or is a row of `tools/oxlint/rules-off.tsv` with the one sentence that keeps
 * it off. Nursery rules are outside, and so are the repository's own plugins, which are all on.
 */
const CATEGORIES = new Set(["correctness", "suspicious", "perf", "pedantic", "style", "restriction"]);
const PLUGINS = new Set(["eslint", "import", "node", "oxc", "promise", "typescript", "unicorn"]);

/** One rule as `oxlint --rules -f json` lists it. */
interface OfferedRule {
  readonly scope: string;
  readonly value: string;
  readonly category: string;
}

/** One row of the ledger: a rule, the files it is off for (`*` for every file), and why. */
interface Row {
  readonly rule: string;
  readonly files: string;
  readonly sites: string;
  readonly status: string;
  readonly reason: string;
}

const rows: Row[] = readFileSync(resolve(repoRoot, "tools/oxlint/rules-off.tsv"), "utf8")
  .trimEnd()
  .split("\n")
  .slice(1)
  .map((line) => {
    const [rule = "", files = "", sites = "", status = "", reason = ""] = line.split("\t");
    return { rule, files, sites, status, reason };
  });

function isOff(severity: unknown): boolean {
  return severity === "off" || (Array.isArray(severity) && severity[0] === "off");
}

describe("the .oxlintrc.json debt ledger", () => {
  it("names a file that exists for every entry that is not a glob", () => {
    const missing = oxlintrc.overrides.flatMap((override) =>
      override.files.filter((entry) => !entry.includes("*") && !existsSync(resolve(repoRoot, entry))),
    );
    expect(missing).toEqual([]);
  });

  it("only ever exempts from a block that lists files, so debt cannot arrive as configuration", () => {
    // A block whose files are globs is policy for an area — `test/**` where Bun's matcher types
    // make a rule wrong, or the vendored bridge checkout. A block listing
    // concrete paths is the debt ledger, and a ledger entry that set a severity other than
    // "off" would be turning a rule on for those files alone, which is not what it is for.
    const enabling = oxlintrc.overrides
      .filter((override) => override.files.every((entry) => !entry.includes("*")))
      .flatMap((override) => Object.entries(override.rules).filter(([, severity]) => severity !== "off"));
    expect(enabling).toEqual([]);
  });
});

describe("the ledger of rules left off", () => {
  it("turns no rule off at the top level, and turns one off for some files only beside its row", () => {
    expect(Object.keys(topRules).filter((rule) => isOff(topRules[rule]))).toEqual([]);
    const unrecorded = oxlintrc.overrides.flatMap((override) =>
      Object.entries(override.rules)
        .filter(([, severity]) => isOff(severity))
        .map(([rule]) => `${rule} ${override.files.join(",")}`)
        .filter((entry) => !rows.some((row) => `${row.rule} ${row.files}` === entry)),
    );
    expect(unrecorded).toEqual([]);
  });

  it("decides every rule Oxlint offers in scope: configured, or a row with its sentence", () => {
    // To a file instead of a pipe: under Bun on Linux the listing leaves through the pipe cut short,
    // with exit 0, in 4 of 5 tries on the Linux runner, and whole through a file in 5 of 5.
    const folder = mkdtempSync(join(tmpdir(), "ana-oxlint-rules-"));
    const listing = join(folder, "rules.json");
    const listed = Bun.spawnSync({
      cmd: [capturedExecPath, OXLINT_BINARY, "--rules", "-f", "json"],
      cwd: repoRoot,
      stdout: Bun.file(listing),
      timeout: 30_000,
    });
    expect(listed.exitCode).toBe(0);
    const text = readFileSync(listing, "utf8");
    rmSync(folder, { recursive: true });
    const offered = parseJsonAs<OfferedRule[]>(text)
      .filter(({ scope, category }) => PLUGINS.has(scope) && CATEGORIES.has(category))
      .map(({ scope, value }) => `${scope}/${value}`);
    const everywhere = new Set(rows.filter((row) => row.files === "*").map((row) => row.rule));
    expect(offered.filter((rule) => topRules[rule] === undefined && !everywhere.has(rule))).toEqual([]);
    // A row for a rule that is now on, or that Oxlint no longer offers, records a decision nobody holds.
    expect([...everywhere].filter((rule) => topRules[rule] !== undefined || !offered.includes(rule))).toEqual(
      [],
    );
  });

  it("gives every row a count, a status and one sentence", () => {
    const malformed = rows.filter(
      (row) =>
        !/^\d+$/u.test(row.sites) || !["off", "staged"].includes(row.status) || !/^\S.*\.$/u.test(row.reason),
    );
    expect(malformed).toEqual([]);
  });
});
