#!/usr/bin/env bun
/** Reports forbidden production-to-helper/test and skill-main-to-helper/test imports: `direction.ts [--file <path>]...`. */
import { type CommandArgs, CommandFailure, runCommand, SKILL_REPO } from "#skills/main/cli.ts";
import { gitText } from "#src/meta/git.ts";
import { breaches, directionChecked, PRODUCTION_ROOTS, SKILL_MAIN_ROOT } from "#tools/loc/source-policy.ts";
import { importsOf, lines } from "#tools/runtime/gate.ts";

const USAGE = `usage: direction.ts [--file <path>]...

Every forbidden import from production (src, vendor, packages, tools) into helper code (.claude,
tools/wri, studies) or a test, or from .claude/skills/main into other helper trees (.claude outside
main, tools/wri, studies) or tests, by the CI gate's import reader. Exits 1 on any.`;

if (import.meta.main) {
  await runCommand({ name: "direction", usage: USAGE, options: { file: "list" } }, (args: CommandArgs) => {
    const named = args.list("file");
    const files =
      named.length > 0 ? named : lines(gitText(SKILL_REPO, "ls-files", ...PRODUCTION_ROOTS, SKILL_MAIN_ROOT));
    const found = breaches(files, (file) => importsOf(SKILL_REPO, file));
    const read = files.filter(directionChecked).length;
    if (found.length === 0) {
      console.log(`${String(read)} checked files read: no forbidden import`);
      return;
    }
    for (const { file, imported, root } of found) console.log(`${file} imports ${imported} (${root})`);
    throw new CommandFailure(
      `${String(found.length)} forbidden imports across ${String(read)} checked files`,
    );
  });
}
