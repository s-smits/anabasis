#!/usr/bin/env bun
/**
 * The open stacks as their edges, and each one's top.
 *
 *   bun .claude/skills/stack-pr/scripts/stack.ts [--branch <branch>]
 *
 * Several stacks may be open, each a chain of pull requests whose bottom is based on the trunk (`main`) and
 * which lands alone (operator, 27 October). A stack's top is the end of its chain, not the highest
 * number: a side branch off the middle carries a higher one, and is listed apart, since it cannot
 * land without the pull requests beneath it. `--branch` says where one branch sits: its parent, and
 * what is stacked on it, which decides whether it may still be rewritten. The reading is GitHub's at
 * this moment and the stack moves, so run it again before a branch, a pull request and a push.
 * Each line ends in the pull request's importance label (`I0` to `I3`), or `unranked` where it
 * carries none or several, which `bun run land` refuses. Under them it names each pull request whose
 * head holds another's without standing on it (`doubled.ts`), which `land` refuses as well. The
 * lines are production's (`stackTold`, `offMain`, `tools/runtime/pulls.ts`); this prints them.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { doubledLines } from "#tools/runtime/doubled.ts";
import { offMain, openPulls, stackTold, trunkOf } from "#tools/runtime/pulls.ts";

if (import.meta.main) {
  await runCommand(
    { name: "stack", usage: "stack.ts [--branch <branch>]", options: { branch: "text" } },
    (args: CommandArgs) => {
      const root = runtimeProcess.cwd();
      const open = openPulls(root);
      const repeating = doubledLines(root, open);
      console.log(stackTold(open, args.value("branch")).join("\n"));
      for (const line of offMain(root, open, trunkOf(root))) console.log(line);
      if (repeating.length > 0) console.log(["repeating another's commits:", ...repeating].join("\n  "));
    },
  );
}
