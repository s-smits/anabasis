import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

import { isOneOf, isTestFile, isUnder } from "../shared/file-role.ts";
import { argumentOf, calleeName, forwardingTracker } from "../shared/forwarding.ts";
import { identifierName, isNamedMember } from "../shared/statements.ts";

const OWNER = ".claude/skills/main/cli.ts";

const ARGV_OWNERS = new Set(["Bun", "process", "runtimeProcess"]);

/** Matched on the tail so the `#skills/…` alias and a relative spelling both count. */
const LIBRARY = /(?:^|\/)main\/cli(?:\.ts)?$/u;

function isArgv(node: ESTree.MemberExpression): boolean {
  return (
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "argv" &&
    node.object.type === "Identifier" &&
    ARGV_OWNERS.has(node.object.name)
  );
}

/** `argv[0]` is the runtime's own executable, which a script re-spawns with; it is no argument. */
function isExecutable(argv: ESTree.MemberExpression): boolean {
  const parent = argv.parent;
  return (
    parent.type === "MemberExpression" &&
    parent.object === argv &&
    parent.computed &&
    parent.property.type === "Literal" &&
    parent.property.value === 0
  );
}

function sliceCall(argv: ESTree.MemberExpression): ESTree.CallExpression | null {
  const member = argv.parent;
  if (!isNamedMember(member) || member.object !== argv) return null;
  if (identifierName(member.property) !== "slice") return null;
  const call = member.parent;
  return call.type === "CallExpression" && call.callee === member ? call : null;
}

/**
 * Requires skill scripts under `.claude/skills` (outside `.claude/skills/main/cli.ts` and tests)
 * to parse process arguments via `runCommand` or `parseCliArgs` from `.claude/skills/main/cli.ts`.
 * `Bun.argv[0]` and `argv.slice(2)` passed directly to the CLI parser are exempt. There is no fix.
 */
export const noHandReadArgvRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Parse a skill script's arguments through .claude/skills/main/cli.ts.",
      examples: [
        {
          before: "const [campaign] = Bun.argv.slice(2);\nprintStatus(campaign);",
          after:
            'import { runCommand } from "#skills/main/cli.ts";\n\nconst spec = { name: "status", usage: "status <campaign>", positionals: 1 };\nif (import.meta.main) await runCommand(spec, ({ positionals }) => printStatus(positionals[0]));',
          path: ".claude/skills/run-management/scripts/status.ts",
        },
        {
          before: 'const json = Bun.argv.includes("--json");',
          after:
            'import { runCommand } from "#skills/main/cli.ts";\n\nconst spec = { name: "status", usage: "status [--json]", options: { json: "flag" } } as const;\nif (import.meta.main) await runCommand(spec, ({ flag }) => printStatus(flag("json")));',
          path: ".claude/skills/run-management/scripts/status.ts",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      handRead:
        "`{{read}}` reads the process arguments by hand. Declare them in a runCommand spec from .claude/skills/main/cli.ts, so a misspelled flag refuses instead of being ignored.",
    },
  },
  createOnce(context) {
    let library = new Set<string>();
    let reads: ESTree.MemberExpression[] = [];
    const local = forwardingTracker();
    const isLibrary = (name: string): boolean => library.has(name);

    function handedToLibrary(argv: ESTree.MemberExpression): boolean {
      const slice = sliceCall(argv);
      const target = slice === null ? null : argumentOf(slice);
      const callee = target === null ? null : calleeName(target.call);
      return target !== null && callee !== null && local.reaches(callee, target.index, isLibrary);
    }

    return {
      before: () =>
        isUnder(context.filename, ".claude/skills") &&
        !isTestFile(context.filename) &&
        !isOneOf(context.filename, [OWNER]),
      Program(program) {
        library = new Set();
        for (const statement of program.body) {
          if (statement.type !== "ImportDeclaration" || !LIBRARY.test(statement.source.value)) {
            continue;
          }
          for (const specifier of statement.specifiers) library.add(specifier.local.name);
        }
        local.reset();
        reads = [];
      },
      FunctionDeclaration: (node) => local.declareFunction(node),
      VariableDeclarator: (node) => local.declareBinding(node),
      CallExpression: (node) => local.call(node),
      MemberExpression(node) {
        if (isArgv(node) && !isExecutable(node)) reads.push(node);
      },
      "Program:exit": () => {
        for (const argv of reads) {
          if (handedToLibrary(argv)) continue;
          const indexed =
            argv.parent.type === "MemberExpression" && !isNamedMember(argv.parent) ? argv.parent : argv;
          const whole = sliceCall(argv) ?? indexed;
          context.report({
            node: argv,
            messageId: "handRead",
            data: { read: context.sourceCode.getText(whole) },
          });
        }
      },
    };
  },
});
