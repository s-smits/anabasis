import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isOneOf, isTestFile } from "../shared/file-role.ts";

/**
 * Process lifetime has one launch owner (`stageCommandIsolation`, `src/wall/isolation.ts`) and one
 * reader (`killProcessGroup` and `terminateAndReapProcessGroupId`, `src/meta/subprocess.ts`). A
 * module outside those two and test files that both spawns a child (`Bun.spawn`, `capturedSpawn`)
 * and calls `.kill(` on a held reference introduces a second lifetime owner that races the
 * owner's teardown and signals a single process instead of its group. Signals by PID
 * (`process.kill(pid, signal)`) and liveness probes (`kill(pid, 0)`) are exempt. There is no fix.
 */

/** A signal sent to a pid the file was handed, rather than to the child it holds. The suite
 *  runner reads descendants out of `ps` and ends the ones a group kill could not reach; that
 *  is a signal to an identity someone else launched, and no second launch owner. */
const BY_PID = /^(?:runtimeProcess|process)\.kill$/u;

/** The two modules that are allowed to end a process: the launch owner and its reader. */
const LIFETIME_OWNERS = ["src/wall/isolation.ts", "src/meta/subprocess.ts"];

/** Whether the call is a liveness probe, `kill(pid, 0)`, rather than a signal that ends anything. */
function zeroSignal(node: ESTree.CallExpression): boolean {
  const signal = node.arguments[1];
  return signal?.type === "Literal" && signal.value === 0;
}

export const noLifetimeOutsideOwnerRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Process lifetime belongs to its launch owner, not to each caller.",
      examples: [
        {
          before:
            'const child = Bun.spawn(["bun", "tools/demo/worker.ts"]);\nsetTimeout(() => child.kill(), 60_000);',
          after:
            'import { killProcessGroup } from "#src/meta/subprocess.ts";\n\nconst child = Bun.spawn(["bun", "tools/demo/worker.ts"], { detached: true });\nsetTimeout(() => killProcessGroup(child, "SIGTERM"), 60_000);',
        },
        {
          before:
            'const child = Bun.spawn(["bun", "tools/demo/worker.ts"], { detached: true });\nif (await stopAsked()) child.kill("SIGKILL");',
          after:
            'import { terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";\n\nconst child = Bun.spawn(["bun", "tools/demo/worker.ts"], { detached: true });\nif (await stopAsked()) await terminateAndReapProcessGroupId(child.pid);',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      secondOwner:
        "This file spawns a child and kills it, which makes it a second owner of process lifetime beside `stageCommandIsolation` (src/wall/isolation.ts). Settle the teardown there, or signal the group through `killProcessGroup` or `terminateAndReapProcessGroupId` (src/meta/subprocess.ts): a kill here races the owner's own, signals one process rather than its group, and reads as proof the child is gone.",
    },
  },
  createOnce(context) {
    /** The first spawn in the file, reported only once a kill proves the file owns a lifetime. */
    let spawn: ESTree.CallExpression | null = null;
    /** Whether this file ends a process itself. A kill may be written above its own spawn. */
    let kills = false;

    return {
      before: () => {
        spawn = null;
        kills = false;
        // The owner, its reader and a test all end processes as their job; a second owner is the finding.
        return !isTestFile(context.filename) && !isOneOf(context.filename, LIFETIME_OWNERS);
      },

      CallExpression(node) {
        const text = context.sourceCode.getText(node.callee);
        if (/\b(?:Bun\.spawn|Bun\.spawnSync|capturedSpawn|spawnSync|execFile|execFileSync)\b/u.test(text)) {
          spawn ??= node;
        }
        // `kill(pid, 0)` sends no signal: it asks whether the process still exists, which is a
        // read and not a second owner. `campaign-lock.ts` uses it to decide whether a recorded
        // lock holder is alive, and the test runner uses it before reaping a stray.
        if (text.endsWith(".kill") && !zeroSignal(node) && !BY_PID.test(text)) kills = true;
      },

      "Program:exit": () => {
        if (spawn === null || !kills) return;
        context.report({ node: spawn, messageId: "secondOwner" });
      },
    };
  },
});
