import { defineRule, type ESTree } from "@oxlint/plugins";

import { isOneOf, isTestFile, isUnder } from "../shared/file-role.ts";
import { argumentOf, calleeName, forwardingTracker } from "../shared/forwarding.ts";

const OWNER = ".claude/skills/main/cli.ts";

/** The three names a skill script reads its process arguments through. */
const ARGV_OWNERS = new Set(["Bun", "process", "runtimeProcess"]);

/** The module whose exports are the parser. Matched on the tail so the `#skills/…` alias and a
 *  relative spelling both count. */
const LIBRARY = /(?:^|\/)main\/cli(?:\.ts)?$/u;

/** `Bun.argv`, `process.argv` or `runtimeProcess.argv`. */
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

/** The `argv.slice(…)` call this read is the object of, or null for any other read. */
function sliceCall(argv: ESTree.MemberExpression): ESTree.CallExpression | null {
  const member = argv.parent;
  if (member.type !== "MemberExpression" || member.object !== argv || member.computed) return null;
  if (member.property.type !== "Identifier" || member.property.name !== "slice") return null;
  const call = member.parent;
  return call.type === "CallExpression" && call.callee === member ? call : null;
}

/**
 * A skill script's arguments are parsed once, by `.claude/skills/main/cli.ts`, and a script that
 * reads them itself has written a second parser. The library's header names what the second one
 * gets wrong: `argv.indexOf("--run")` turns `--rnu abc` into a run with no `--run`, and the token
 * after a flag taken as its value turns `--out --json` into an output path called `--json`. The
 * duplicate-block scans catch a parser copied line for line; they cannot catch the same reading
 * spelled a different way, which is how every one of these arrived.
 *
 * Two reads are not a parse. `Bun.argv[0]` is the runtime's own executable, which a script uses to
 * spawn Bun again. And `Bun.argv.slice(2)` handed straight to the library — `parseOrDie`,
 * `parseCommandOrDie`, `parseCliArgs` or `runCommand` — is the library doing the reading, including
 * behind `import.meta.main ? … : []`. A script that keeps a testable `main(argv)` passes too, when
 * that function hands its parameter to the library, directly or through another function the file
 * declares; the parameter is followed by name and position, not guessed at.
 *
 * Everything else reports: an index past zero, a destructure, `.length`, `.includes`, a loop, and a
 * slice held in a `const` first, because once the value has a name the rule cannot see every use
 * of it, and nothing needs the name — the library parsers default their `argv` to exactly that slice.
 *
 * There is no fix. The repair is a `runCommand` spec — which options are values, which are flags,
 * which are absolute paths, how many positionals — and that is the script's contract to write,
 * not something the expression holds.
 */
export const noHandReadArgvRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Parse a skill script's arguments through .claude/skills/main/cli.ts." },
    messages: {
      handRead:
        "`{{read}}` reads the process arguments by hand. Declare them in a runCommand spec, or pass the slice straight to parseOrDie / parseCommandOrDie from .claude/skills/main/cli.ts, so a misspelled flag refuses instead of being ignored.",
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
          if (statement.type !== "ImportDeclaration" || !LIBRARY.test(String(statement.source.value))) {
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
            argv.parent.type === "MemberExpression" && argv.parent.computed ? argv.parent : argv;
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
