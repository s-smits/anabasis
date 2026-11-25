#!/usr/bin/env bun
/** Reports production imports that cross into helper or test code: `direction.ts [--file <path>]...`. */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { gitText } from "#src/meta/git.ts";
import { join } from "#src/meta/path.ts";
import { breaches, PRODUCTION_ROOTS, production } from "#tools/loc/source-policy.ts";
import { importsOf, lines } from "#tools/runtime/gate.ts";

const USAGE = `usage: direction.ts [--file <path>]...

Every import from production (src, vendor, packages, tools) into helper code (.claude, tools/wri,
studies) or a test, by the CI gate's import reader. Exits 1 on any.`;
const REPO = join(import.meta.dir, "..", "..", "..", "..");

if (import.meta.main) {
  await runCommand({ name: "direction", usage: USAGE, options: { file: "list" } }, (args: CommandArgs) => {
    const named = args.list("file");
    const files = named.length > 0 ? named : lines(gitText(REPO, "ls-files", ...PRODUCTION_ROOTS));
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
