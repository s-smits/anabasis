import { defineRule, type ESTree } from "@oxlint/plugins";
import { isOneOf, isTestFile } from "../shared/file-role.ts";

/**
 * Process lifetime has two owners in this repository: `spawnCollected` for an isolated Builder
 * command and `stageCommandIsolation` for every Built shell launch. A file that spawns a child
 * and then kills it has written a third one.
 *
 * The simplify skill records why this is a rule rather than a preference. On 2026-09-15 an
 * `AbortSignal` threaded into the Builder's command runner was refused twice — "why do we even
 * need to kill", then "one layer higher" — because the spawner already killed the group on
 * timeout and in `finally`, and the leak was the controller recording its terminal before its
 * session had stopped. The repair that landed (`c4bd09b88`) put `reapGroupOnExit` inside
 * `stageCommandIsolation`, on the Darwin launch only, at a net cost of −1 production line.
 *
 * Every hand-rolled kill pays the same three costs. It races the owner's own teardown, so two
 * signals arrive and the second one's failure means nothing. It kills the process and not its
 * group, so a shell's children outlive the call and the leak looks fixed. And it makes a
 * successful `kill` syscall read as proof the child is gone, which the working contract says
 * plainly that it is not.
 *
 * The rule reads the file, not the call: a spawn and a `.kill(` in one module. That is the
 * shape, because the cost is the second owner existing, not any one line of it. The two owners
 * themselves are exempt by path, as is `src/meta/subprocess.ts`, which is the reader they both
 * use. Tests are exempt: a test that starts a process has to be able to stop it.
 *
 * A signal sent through the process object is not that shape. `process.kill(pid, signal)` ends
 * an identity the file was handed, which is what `src/meta/subprocess.ts` itself does and what
 * the test runner does to the descendants a group kill could not reach — they left their session,
 * so the runner finds them in `ps` and signals each one. A second launch owner is a file that
 * kills the child it holds, and that is written `child.kill()`.
 *
 * The two sites this left on 2026-09-20 were one of each. `generated-tool-worker-process.ts`
 * spawned a worker and ran its own SIGTERM, wait, SIGKILL, wait ladder over `child.kill`, which
 * is the owner's `terminateAndReapProcessGroup` rewritten one signal narrower: it reached the
 * worker and not its group, so a generated tool's own children outlived the close. Routing the
 * two signals through `killProcessGroup` fixed that and left the file with no kill of its own.
 *
 * There is no fix. Moving a kill to its owner changes two files and usually deletes
 * more than it moves.
 */

/** A signal sent to a pid the file was handed, rather than to the child it holds. The suite
 *  runner reads descendants out of `ps` and ends the ones a group kill could not reach; that
 *  is a signal to an identity someone else launched, and no second launch owner. */
const BY_PID = /^(?:runtimeProcess|process)\.kill$/u;

/** The three modules that are allowed to end a process: the two launch owners and their reader. */
const LIFETIME_OWNERS = [
  "src/builder/candidate-isolation-runtime.ts",
  "src/verify/solve-command-isolation.ts",
  "src/meta/subprocess.ts",
];

/** Whether the call is a liveness probe, `kill(pid, 0)`, rather than a signal that ends anything. */
function zeroSignal(node: ESTree.CallExpression): boolean {
  const signal = node.arguments[1];
  return signal?.type === "Literal" && signal.value === 0;
}

export const noLifetimeOutsideOwnerRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Process lifetime belongs to its launch owner, not to each caller." },
    messages: {
      thirdOwner:
        "This file spawns a child and kills it, which makes it a third owner of process lifetime beside `spawnCollected` and `stageCommandIsolation`. Settle the teardown there: a kill here races the owner's own, signals one process rather than its group, and reads as proof the child is gone.",
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
        // An owner and a test both end processes as their job; only a third owner is a finding.
        return !isTestFile(context.filename) && !isOneOf(context.filename, LIFETIME_OWNERS);
      },

      CallExpression(node) {
        const text = context.sourceCode.getText(node.callee);
        if (/\b(?:Bun\.spawn|Bun\.spawnSync|spawnSync|execFile|execFileSync)\b/u.test(text)) {
          spawn ??= node;
        }
        // `kill(pid, 0)` sends no signal: it asks whether the process still exists, which is a
        // read and not a second owner. `campaign-lock.ts` uses it to decide whether a recorded
        // lock holder is alive, and the test runner uses it before reaping a stray.
        if (text.endsWith(".kill") && !zeroSignal(node) && !BY_PID.test(text)) kills = true;
      },

      "Program:exit": () => {
        if (spawn === null || !kills) return;
        context.report({ node: spawn, messageId: "thirdOwner" });
      },
    };
  },
});
