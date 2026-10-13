import { defineRule, type ESTree } from "@oxlint/plugins";

import { isOneOf, isTestFile, isUnder } from "../shared/file-role.ts";

/**
 * Where a git subprocess may be spelled, per tree. A skill script asks `.claude/skills/main/git.ts`,
 * which resolves the executable through `hostTool("git")` and bounds the capture. Production code
 * cannot import a skill module, and `src` has no git owner of its own: on 10 October it spawns no
 * git at all. The first site that needs one writes the owner in `src/meta`, beside `host-tool.ts`,
 * and adds it to the `src` scope's owners here, so that the rule stops reporting that one file.
 */
const SCOPES = [
  {
    tree: ".claude/skills",
    owners: [".claude/skills/main/git.ts"],
    messageId: "spelled",
  },
  {
    tree: "src",
    owners: [],
    messageId: "unowned",
  },
] as const;

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
 * A git subprocess spelled by hand in a tree that has an owner for it, or that should have one.
 * `.claude/skills/main/git.ts` records why the owner exists: the local helpers it replaced had
 * drifted in the two places a helper that small can, some paying the Darwin xcrun shim on every
 * call by spelling bare `git` where `hostTool` skips it, and some leaving the capture unbounded so
 * that a runaway listing ended as a short read instead of a refusal. A copied helper is caught by
 * the duplicate-block scans; one written again in a different spelling is caught here.
 *
 * Four spellings report: `hostTool("git")` anywhere, since resolving the executable is the first
 * line of every hand-written call; a command array whose first element is `"git"` in a position
 * that reaches a process; `spawnSync("git", …)` and its siblings; and Bun's `` $`git …` ``. The
 * string a guard builds with `["git", "reset"].join(" ")` is not a subprocess and passes.
 *
 * `src` is in the scope with no owner yet, and the message says where the owner belongs: a site
 * there is the first git subprocess of production code, and the answer to it is the owner in
 * `src/meta`, not the site. `tools/` is outside the scope. Its commands spell git at a few sites,
 * it has no owner of its own, and whether it should import a skill module is a layering decision
 * this rule would be making by the back door. Tests are outside it too: a fixture builds the
 * repository it then reads.
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
        "This spells a git subprocess by hand. Ask gitOutput, gitText or gitMaybe from .claude/skills/main/git.ts, which resolves the executable through hostTool and bounds the capture.",
      unowned:
        'This spells a git subprocess by hand, and src has no git owner yet. Write one in src/meta beside host-tool.ts, on hostTool("git") and a bounded capture as .claude/skills/main/git.ts is, and ask it here.',
    },
  },
  createOnce(context) {
    let messageId: (typeof SCOPES)[number]["messageId"] = "spelled";

    function report(node: ESTree.Node): void {
      context.report({ node, messageId });
    }

    return {
      before: () => {
        if (isTestFile(context.filename)) return false;
        const scope = SCOPES.find(({ tree }) => isUnder(context.filename, tree));
        if (scope === undefined || isOneOf(context.filename, scope.owners)) return false;
        messageId = scope.messageId;
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
