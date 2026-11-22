import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isTestFile } from "../shared/file-role.ts";

/** The fewest properties a repeated literal must carry before naming it is worth a function. */
const PROPERTY_FLOOR = 3;

/** The fewest spellings that make an owner, in source and in a test. */
const SPELLING_FLOOR = { source: 3, test: 5 };

/**
 * Rung 5 of the simplify ladder: an object literal of at least three properties spelled three or
 * more times in a source file (five in a test file) should be extracted into a single small
 * function. Pure boolean/null/empty flag bags (`valueless`) and literals inside `expect(...)`
 * assertions (`asserted`) are exempt. There is no fix.
 */

/** Whether a property value is a pure flag constant (`true`, `false`, `null`, `undefined`, `[]`, `{}`). */
function valueless(value: ESTree.Node): boolean {
  if (value.type === "Literal") return value.value === true || value.value === false || value.value === null;
  if (value.type === "Identifier") return value.name === "undefined";
  if (value.type === "ArrayExpression") return value.elements.length === 0;
  return value.type === "ObjectExpression" && value.properties.length === 0;
}

/** Whether an expression is rooted at `expect`, through any chain of members and calls. */
function assertionRoot(node: ESTree.Node): boolean {
  if (node.type === "Identifier") return node.name === "expect";
  if (node.type === "MemberExpression") return assertionRoot(node.object);
  return node.type === "CallExpression" && assertionRoot(node.callee);
}

/** Whether the literal sits inside an `expect(...)` assertion, where inlining keeps the test readable. */
function asserted(node: ESTree.ObjectExpression): boolean {
  // Only the Program has no parent, and it answers `null`, so one spelling ends the walk.
  for (let at: ESTree.Node | null = node.parent; at !== null; at = at.parent) {
    if (at.type === "CallExpression" && assertionRoot(at.callee)) return true;
  }
  return false;
}

export const noThriceSpelledObjectRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "One object literal spelled three times in a file is one function with three callers.",
      examples: [
        {
          before:
            'export const started = () => emit({ kind: "comparison.started", level: 0.02, solves: 4 });\nexport const resumed = () => emit({ kind: "comparison.started", level: 0.02, solves: 4 });\nexport const repeated = () => emit({ kind: "comparison.started", level: 0.02, solves: 4 });',
          after:
            'const terms = () => ({ kind: "comparison.started", level: 0.02, solves: 4 });\nexport const started = () => emit(terms());\nexport const resumed = () => emit(terms());\nexport const repeated = () => emit(terms());',
        },
        {
          before:
            'run(["bun", "install"], { cwd: root, stdout: "pipe", stderr: "pipe" });\nrun(["bun", "test"], { cwd: root, stdout: "pipe", stderr: "pipe" });\nrun(["bun", "run", "lint"], { cwd: root, stdout: "pipe", stderr: "pipe" });',
          after:
            'const piped = (cwd: string) => ({ cwd, stdout: "pipe", stderr: "pipe" });\nrun(["bun", "install"], piped(root));\nrun(["bun", "test"], piped(root));\nrun(["bun", "run", "lint"], piped(root));',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      thrice:
        "This literal is spelled {{count}} times in this file (also at {{lines}}). Three spellings of one object are one small function: today, changing what the shape means is {{count}} edits.",
    },
  },
  createOnce(context) {
    /** Every literal seen in this file, by its text with runs of whitespace collapsed to one. */
    const spellings = new Map<string, ESTree.ObjectExpression[]>();

    return {
      before: () => {
        spellings.clear();
        return true;
      },

      ObjectExpression(node) {
        const named = node.properties.filter((property) => property.type === "Property");
        if (named.length < PROPERTY_FLOOR || named.length !== node.properties.length) return;
        if (named.every((property) => valueless(property.value)) || asserted(node)) return;
        const key = context.sourceCode.getText(node).replaceAll(/\s+/gu, " ");
        const found = spellings.get(key);
        if (found === undefined) spellings.set(key, [node]);
        else found.push(node);
      },

      "Program:exit": () => {
        const floor = isTestFile(context.filename) ? SPELLING_FLOOR.test : SPELLING_FLOOR.source;
        for (const group of spellings.values()) {
          const [first, ...rest] = group;
          if (first === undefined || group.length < floor) continue;
          const lines = rest.map((node) => context.sourceCode.getLoc(node).start.line).join(", ");
          context.report({ node: first, messageId: "thrice", data: { count: String(group.length), lines } });
        }
      },
    };
  },
});
