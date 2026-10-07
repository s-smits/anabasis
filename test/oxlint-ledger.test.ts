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
import { existsSync } from "../src/meta/filesystem.ts";
import { resolve } from "../src/meta/path.ts";

const repoRoot = resolve(import.meta.dirname, "..");

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
