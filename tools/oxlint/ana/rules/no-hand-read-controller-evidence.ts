import { defineRule, type ESTree } from "@oxlint/plugins";

import { isString } from "#src/meta/json-shape.ts";

import { isOneOf, isTestFile, isUnder } from "../shared/file-role.ts";
import { argumentOf, calleeName, forwardingTracker } from "../shared/forwarding.ts";

const OWNER = ".claude/skills/main/run.ts";

/** The two controller files, and the names `src/run/controller-lineage.ts` exports for them. */
const FILES = new Set(["terminal.json", "opening.json"]);
const EXPORTED = new Map([
  ["TERMINAL_FILE", "terminal.json"],
  ["OPENING_FILE", "opening.json"],
]);

/** A reader whose result is parsed JSON: `readJson`, `readJsonFileOrNull`, `JSON.parse` and kin. */
const isJsonReader = (name: string): boolean => /json/iu.test(name);

/** The literal's text when it is exactly one of the two file names. */
function fileLiteral(node: ESTree.Node): string | null {
  if (node.type === "Literal" && isString(node.value) && FILES.has(node.value)) return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    const text = node.quasis[0]?.value.cooked ?? "";
    return FILES.has(text) ? text : null;
  }
  return null;
}

/**
 * Reading a run's `opening.json` or `terminal.json` by hand, in a skill script.
 *
 * The controller has a strict reader for both, `readControllerEvidence` in
 * `src/run/controller-evidence.ts`, and `.claude/skills/main/run.ts` reaches it for a skill through
 * `openRecordedRun`. A script that opens the file itself re-derives what that reader already states,
 * and the fields it re-derives are the ones whose type it guesses: the shipped defect was
 * `runtimeNonResult === true` tested against a field that holds a reason string, so the test was
 * false on every run that had one. The duplicate-block scans cannot see that shape, because each
 * script spelled its reading differently.
 *
 * What reports is the path to one of those files reaching a JSON read: the literal, a local
 * `const OPENING = "opening.json"`, or the imported `OPENING_FILE` and `TERMINAL_FILE`, joined by
 * hand and handed to `readJson`, `readJsonFileOrNull`, `JSON.parse(readFileSync(…))`,
 * `Bun.file(…).json()`, or a local function that forwards its parameter to one of those. A path
 * bound to a name first is followed to every call that name is passed to.
 *
 * The same name is not a read everywhere else it appears. An archive that copies the file as bytes
 * parses no field of it; a scan for `terminal.json.tmp-*` orphans matches a damaged file's prefix;
 * `existsSync` on the path is discovery; and a label passed to an error message names a file for a
 * reader. All four pass, because nothing in them states a fact the strict reader owns.
 *
 * There is no fix. `openRecordedRun` takes the folder and selects the run, so the repair replaces
 * the script's own run selection too, and which of its reads the strict record already carries is
 * the reading only the author can do.
 */
export const noHandReadControllerEvidenceRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Read a run's opening and terminal through openRecordedRun, not by hand." },
    messages: {
      handRead:
        "This parses {{file}} by hand. Reach the run through openRecordedRun in .claude/skills/main/run.ts, whose reading is readControllerEvidence in src/run/controller-evidence.ts, instead of re-deriving what that strict reader already states.",
    },
  },
  createOnce(context) {
    const local = forwardingTracker();
    /** Local names that spell one of the two files, from an import or a `const`. */
    let names = new Map<string, string>();
    let paths: Array<{ node: ESTree.Node; file: string }> = [];
    /** Identifiers passed as an argument, resolved once every name in the file is known. */
    let passed: Array<{ node: ESTree.Node; name: string }> = [];

    /** A call whose result is parsed JSON: a reader by name or by forwarding, or `.json()` on it. */
    function parsesJson(call: ESTree.CallExpression, index: number): boolean {
      const callee = calleeName(call);
      if (callee !== null && local.reaches(callee, index, isJsonReader)) return true;
      const outer = argumentOf(call);
      const outerCallee = outer === null ? null : calleeName(outer.call);
      if (outer !== null && outerCallee !== null && isJsonReader(outerCallee)) return true;
      const member = call.parent;
      return (
        member?.type === "MemberExpression" &&
        member.object === call &&
        member.property.type === "Identifier" &&
        member.property.name === "json"
      );
    }

    function feedsJson(path: ESTree.Node): boolean {
      const direct = argumentOf(path);
      if (direct !== null && parsesJson(direct.call, direct.index)) return true;
      const bound = path.parent;
      if (bound?.type !== "VariableDeclarator" || bound.init !== path || bound.id.type !== "Identifier") {
        return false;
      }
      return local.passing(bound.id.name).some(({ node, index }) => parsesJson(node, index));
    }

    /** The joined path when this file name is a segment of `join` or `resolve`, else the name. */
    function pathOf(node: ESTree.Node): ESTree.Node {
      const parent = node.parent;
      const joined =
        parent?.type === "CallExpression" &&
        parent.arguments.some((argument) => argument === node) &&
        ["join", "resolve", "path.join", "path.resolve"].includes(calleeName(parent) ?? "");
      return joined ? parent : node;
    }

    return {
      before: () =>
        isUnder(context.filename, ".claude/skills") &&
        !isTestFile(context.filename) &&
        !isOneOf(context.filename, [OWNER]),
      Program(program) {
        local.reset();
        paths = [];
        passed = [];
        names = new Map();
        for (const specifier of program.body.flatMap((statement) =>
          statement.type === "ImportDeclaration" ? statement.specifiers : [],
        )) {
          const imported = specifier.type === "ImportSpecifier" ? specifier.imported : null;
          const file = imported?.type === "Identifier" ? EXPORTED.get(imported.name) : undefined;
          if (file !== undefined) names.set(specifier.local.name, file);
        }
      },
      FunctionDeclaration: (node) => local.declareFunction(node),
      VariableDeclarator(node) {
        local.declareBinding(node);
        const file = node.init === null ? null : fileLiteral(node.init);
        if (node.id.type === "Identifier" && file !== null) names.set(node.id.name, file);
      },
      CallExpression: (node) => local.call(node),
      Literal(node) {
        const file = fileLiteral(node);
        // `const OPENING = "opening.json"` names the file; its uses are where a read happens.
        const naming = node.parent?.type === "VariableDeclarator" && node.parent.init === node;
        if (file !== null && !naming) paths.push({ node: pathOf(node), file });
      },
      TemplateLiteral(node) {
        const file = fileLiteral(node);
        const naming = node.parent?.type === "VariableDeclarator" && node.parent.init === node;
        if (file !== null && !naming) paths.push({ node: pathOf(node), file });
      },
      Identifier(node) {
        const parent = node.parent;
        if (parent?.type === "CallExpression" && parent.arguments.some((argument) => argument === node)) {
          passed.push({ node, name: node.name });
        }
      },
      "Program:exit": () => {
        for (const { node, name } of passed) {
          const file = names.get(name);
          if (file !== undefined) paths.push({ node: pathOf(node), file });
        }
        for (const { node, file } of paths) {
          if (feedsJson(node)) context.report({ node, messageId: "handRead", data: { file } });
        }
      },
    };
  },
});
