import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

/** The word as a noun or its participle, which is how a name says "structure" in place of a role. */
const FORBIDDEN_WORDS = new Set(["shape", "shapes", "shaped"]);

/** Word boundaries inside one name: `_`, `$` and digits, a lower-to-upper step, and the end of a
 *  capital run before a capitalised word (`JSONShape` is `JSON`, `Shape`). */
const WORD_BREAK = /[_$\d]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/u;

/** Return whether an identifier names a statically accessed member owned by another value. */
function isBorrowedMemberName(node: ESTree.Node): boolean {
  const { parent } = node;
  if (parent?.type !== "MemberExpression") return false;
  return parent.property === node && parent.computed === false;
}

/**
 * Ban the word "shape" in every JavaScript and TypeScript symbol name: `taskShape`, `ShapeOf`,
 * `SHAPE_KEYS`, `jsonShaped`.
 *
 * The word is matched whole, not as a substring. Until 2026-09-22 the rule matched the letters
 * anywhere, so `reshaped`, the result of reshaping a list, had to be renamed; the rename chosen,
 * `newQuestions`, named the value no better. A verb built on the word names an operation, not
 * a structure standing in for a role.
 *
 * There is no fix: renaming a symbol reaches every file that names it, and the new name is the
 * point of the finding.
 */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: 'Disallow the word "shape" in JavaScript, TypeScript, private, and JSX symbol names.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) => {
      const words = node.name.split(WORD_BREAK);
      if (!words.some((word) => FORBIDDEN_WORDS.has(word.toLowerCase()))) return;
      if (isBorrowedMemberName(node)) return;
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name: node.name },
      });
    };

    return {
      Identifier: reportForbiddenSymbolName,
      PrivateIdentifier: reportForbiddenSymbolName,
      JSXIdentifier: reportForbiddenSymbolName,
    };
  },
});
