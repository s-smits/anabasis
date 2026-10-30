#!/usr/bin/env bun
/**
 * Report production imports that cross into helper or test code.
 *
 *   bun .claude/skills/repository-practice/scripts/direction.ts [--file <path>]...
 *
 * AGENTS.md section 12 allows helpers to wrap production readers and forbids the reverse
 * dependency. Production includes src, vendor, packages and tools, excluding tools/wri. Helpers
 * include .claude, tools/wri and studies; tests are also excluded from production dependencies.
 *
 * Use the gate's importsOf resolver, including aliases, to inspect all tracked production source
 * files or the repeated --file selections. Report each import into a protected helper or test root
 * and exit 1 when any is found. The script reads no campaign logs.
 *
 * Written on 30 October because existing file-role lint distinguished tests from source without
 * checking this dependency direction. The initial tracked-tree scan reported no breach.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { gitText } from "#src/meta/git.ts";
import { join } from "#src/meta/path.ts";
import { importsOf, lines } from "#tools/runtime/gate.ts";

const USAGE = `usage: direction.ts [--file <path>]...

Every import from production (src, vendor, packages, tools) into helper code (.claude, tools/wri,
studies) or a test, by the CI gate's import reader. Exits 1 on any.`;
const REPO = join(import.meta.dir, "..", "..", "..", "..");
/** The roots production may not import from (section 12), the test tree among them. */
const HELPERS = [".claude/", "tools/wri/", "studies/", "test/"] as const;
/** The production roots, and the helper root inside one of them. */
const PRODUCTION = ["src/", "vendor/", "packages/", "tools/"] as const;
const SOURCE = /\.[cm]?[jt]sx?$/u;

/** The helper root `path` lies under, or null where it is production or elsewhere. */
const helperOf = (path: string): string | null => HELPERS.find((root) => path.startsWith(root)) ?? null;

/** Whether `path` is a production source file. */
export const production = (path: string): boolean =>
  SOURCE.test(path) && PRODUCTION.some((root) => path.startsWith(root)) && helperOf(path) === null;

/** Each import of `files` from production into a helper root, by `graph`. */
export function breaches(files: readonly string[], graph: (file: string) => readonly string[]) {
  return files.filter(production).flatMap((file) =>
    graph(file).flatMap((imported) => {
      const root = helperOf(imported);
      return root === null ? [] : [{ file, imported, root }];
    }),
  );
}

if (import.meta.main) {
  await runCommand({ name: "direction", usage: USAGE, options: { file: "list" } }, (args: CommandArgs) => {
    const named = args.list("file");
    const files = named.length > 0 ? named : lines(gitText(REPO, "ls-files", ...PRODUCTION));
    const found = breaches(files, (file) => importsOf(REPO, file));
    const read = files.filter(production).length;
    if (found.length === 0) {
      console.log(`${String(read)} production files read: none imports helper code or a test`);
      return;
    }
    for (const { file, imported, root } of found) console.log(`${file} imports ${imported} (${root})`);
    throw new CommandFailure(
      `${String(found.length)} imports into helper code across ${String(read)} production files`,
    );
  });
}
