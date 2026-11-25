#!/usr/bin/env bun
/**
 * The open stacks as their edges, and each one's top: `stack.ts [--branch <branch>]`. Each stack is
 * a chain of pull requests whose bottom is based on `main` and which lands alone; its top is the
 * end of its chain, not the highest number, so a side branch off the middle is listed apart.
 * `--branch` gives one branch's parent and what is stacked on it, which decides whether it may
 * still be rewritten. Each line ends in the importance label (`I0` to `I3`), or `unranked` where it
 * carries none or several; under them it names each pull request whose head holds another's without
 * standing on it (`doubled.ts`); `land` refuses both. The lines are production's
 * (`formatStackSummary`, `offMain`, `tools/runtime/pulls.ts`), read from GitHub at this moment.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { doubledLines } from "#tools/runtime/doubled.ts";
import { formatStackSummary, offMain, openPulls, trunkOf } from "#tools/runtime/pulls.ts";

if (import.meta.main) {
  await runCommand(
    { name: "stack", usage: "stack.ts [--branch <branch>]", options: { branch: "text" } },
    (args: CommandArgs) => {
      const root = runtimeProcess.cwd();
      const open = openPulls(root);
      const repeating = doubledLines(root, open);
      console.log(formatStackSummary(open, args.value("branch")).join("\n"));
      for (const line of offMain(root, open, trunkOf(root))) console.log(line);
      if (repeating.length > 0) console.log(["repeating another's commits:", ...repeating].join("\n  "));
    },
  );
}
