import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

import { isOneOf, isTestFile, isUnder } from "../shared/file-role.ts";

/**
 * The trees where a git subprocess is asked of its owner, `src/meta/git.ts`. The landing and gate
 * commands of `tools/runtime`, `tools/secrets` and `tools/oxlint` are outside: they read git's exit
 * status, feed it input and pass `cwd`, which the owner's three answers do not.
 */
const TREES = [".claude/skills", "src", "tools/runs", "tools/d2"];
const OWNER = "src/meta/git.ts";

const SPAWNERS = new Set(["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]);

function isGitLiteral(node: ESTree.Node | null | undefined): boolean {
  return node?.type === "Literal" && node.value === "git";
}

function isHostGit(node: ESTree.Node | null | undefined): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "hostTool" &&
    isGitLiteral(node.arguments[0])
  );
}

function calleeName(call: ESTree.CallExpression): string | null {
  if (call.callee.type === "Identifier") return call.callee.name;
  const { callee } = call;
  return callee.type === "MemberExpression" && callee.property.type === "Identifier"
    ? callee.property.name
    : null;
}

/**
 * A command array reaches a process from a call argument, an options property such as `cmd:`, or a
 * binding that is then passed on. An array that is the object of a member call, `[…].join(" ")`,
 * is a string being built, which is how a guard spells the command it refuses.
 */
function isCommandPosition(array: ESTree.ArrayExpression): boolean {
  const parent = array.parent;
  if (parent === null) return false;
  if (parent.type === "CallExpression") return parent.arguments.some((argument) => argument === array);
  return (
    (parent.type === "Property" && parent.value === array) ||
    (parent.type === "VariableDeclarator" && parent.init === array)
  );
}

/**
 * Requires `.claude/skills`, `src`, `tools/runs`, and `tools/campaign` modules (outside `src/meta/git.ts`
 * and tests) to run git subprocesses through `gitOutput`, `gitText`, or `gitMaybe` in
 * `src/meta/git.ts`, which resolves the binary via `hostTool("git")` and bounds output capture.
 * There is no fix.
 */
export const noHandSpelledGitRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Run git through the tree's owner, not a hand-spelled subprocess.",
      examples: [
        {
          before:
            'const head = Bun.spawnSync(["git", "-C", repo, "rev-parse", "HEAD"]).stdout.toString().trim();',
          after:
            'import { gitText } from "#src/meta/git.ts";\n\nconst head = gitText(repo, "rev-parse", "HEAD");',
        },
        {
          before: 'const dirty = (await $`git -C ${repo} status --porcelain`.text()) !== "";',
          after:
            'import { gitText } from "#src/meta/git.ts";\n\nconst dirty = gitText(repo, "status", "--porcelain") !== "";',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      spelled:
        "This spells a git subprocess by hand. Ask gitOutput, gitText or gitMaybe from src/meta/git.ts, which resolves the executable through hostTool and bounds the capture.",
    },
  },
  createOnce(context) {
    function report(node: ESTree.Node): void {
      context.report({ node, messageId: "spelled" });
    }

    return {
      before: () => {
        if (isTestFile(context.filename) || isOneOf(context.filename, [OWNER])) return false;
        return TREES.some((tree) => isUnder(context.filename, tree));
      },
      CallExpression(node) {
        if (isHostGit(node)) {
          report(node);
          return;
        }
        const name = calleeName(node);
        if (name !== null && SPAWNERS.has(name) && isGitLiteral(node.arguments[0])) report(node);
      },
      ArrayExpression(node) {
        if (isGitLiteral(node.elements[0]) && isCommandPosition(node)) report(node);
      },
      TaggedTemplateExpression(node) {
        const head = node.quasi.quasis[0]?.value.cooked ?? "";
        if (node.tag.type === "Identifier" && node.tag.name === "$" && /^\s*git(?:\s|$)/u.test(head)) {
          report(node);
        }
      },
    };
  },
});
