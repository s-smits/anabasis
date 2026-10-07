import { defineRule, type ESTree } from "@oxlint/plugins";

import { isOneOf, isTestFile, isUnder } from "../shared/file-role.ts";

/**
 * Where a git subprocess may be spelled, per tree. A skill script asks `.claude/skills/main/git.ts`,
 * and `main/run.ts`, which checks out a recorded source and takes its git as an injected function,
 * is the other skill owner. Production code cannot import a skill module, so `src` has its own two:
 * the Builder workspace's committing `git` in `domain-repo.ts`, which pins the author identity, and
 * the read-only capture in `source-identity.ts`, which runs without optional locks. Those differ on
 * purpose, and a third site in `src` belongs in whichever of them it is.
 */
const SCOPES = [
  {
    tree: ".claude/skills",
    owners: [".claude/skills/main/git.ts", ".claude/skills/main/run.ts"],
    ask: "gitOutput, gitText or gitMaybe from .claude/skills/main/git.ts",
  },
  {
    tree: "src",
    owners: ["src/author/domain-repo.ts", "src/run/source-identity.ts"],
    ask: "the git helper in src/run/source-identity.ts (read-only) or src/author/domain-repo.ts (the workspace that commits)",
  },
];

/** The spawners a bare `"git"` executable name can be handed to as their first argument. */
const SPAWNERS = new Set(["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]);

function isGitLiteral(node: ESTree.Node | null | undefined): boolean {
  return node?.type === "Literal" && node.value === "git";
}

/** `hostTool("git")`, the resolved executable. */
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
 * binding that is then passed on. An array that is the object of a member call — `[…].join(" ")` —
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
 * A git subprocess spelled by hand in a file that has an owner for it. `.claude/skills/main/git.ts`
 * records why the owner exists: the local helpers it replaced had drifted in the two places a
 * helper that small can, some paying the Darwin xcrun shim on every call by spelling bare `git`
 * where `hostTool` skips it, and some leaving the capture unbounded so that a runaway listing ended
 * as a short read instead of a refusal. A copied helper is caught by the duplicate-block scans; one
 * written again in a different spelling is caught here.
 *
 * Four spellings report: `hostTool("git")` anywhere, since resolving the executable is the first
 * line of every hand-written call; a command array whose first element is `"git"` in a position
 * that reaches a process; `spawnSync("git", …)` and its siblings; and Bun's `` $`git …` ``. The
 * string a guard builds with `["git", "reset"].join(" ")` is not a subprocess and passes.
 *
 * `tools/` is outside the scope. Its reporters and gates spell git at seven sites in six files, it
 * has no owner of its own, and whether it should import a skill module is a layering decision this
 * rule would be making by the back door. Tests are outside it too: a fixture builds the repository
 * it then reads.
 *
 * There is no fix. The owner offers three answers — exact bytes, trimmed text, or null where "no"
 * is an answer — and a call that also reads the exit status or passes `cwd` instead of `-C` needs a
 * reading of what it wanted.
 */
export const noHandSpelledGitRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Run git through the tree's owner, not a hand-spelled subprocess." },
    messages: {
      spelled:
        "This spells a git subprocess by hand. Ask {{ask}}, which resolves the executable through hostTool and bounds the capture.",
    },
  },
  createOnce(context) {
    let ask = "";

    function report(node: ESTree.Node): void {
      context.report({ node, messageId: "spelled", data: { ask } });
    }

    return {
      before: () => {
        if (isTestFile(context.filename)) return false;
        const scope = SCOPES.find(({ tree }) => isUnder(context.filename, tree));
        if (scope === undefined || isOneOf(context.filename, scope.owners)) return false;
        ask = scope.ask;
        return true;
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
