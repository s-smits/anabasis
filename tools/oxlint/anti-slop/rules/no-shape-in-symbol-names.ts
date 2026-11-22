import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

/** The word as a noun or its participle, which is how a name says "structure" in place of a role. */
const FORBIDDEN_WORDS = new Set(["shape", "shapes", "shaped"]);

/** Word boundaries inside one name: `_`, `$` and digits, a lower-to-upper step, and the end of a
 *  capital run before a capitalised word (`JSONShape` is `JSON`, `Shape`). */
const WORD_BREAK = /[_$\d]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/u;

/** Return whether an identifier names a statically accessed member owned by another value or namespace. */
function isBorrowedMemberName(node: ESTree.Node): boolean {
  const { parent } = node;
  if (parent?.type === "MemberExpression") return parent.property === node && !parent.computed;
  if (parent?.type === "TSQualifiedName") return parent.right === node;
  return parent?.type === "JSXMemberExpression" && parent.property === node;
}

/**
 * Return whether an identifier is the written key of an object-literal entry holding a literal:
 * `{ shape: "object {joints}" }`, `{ shape: 2 }`. Such a key spells a field of a recorded format or
 * a label in a table of data, and the value beside it says what it holds; the name is not one this
 * code chose for a value it computed. A key holding anything else still names a value here. The key
 * of a shorthand entry is passed over too, since its value is the same name and reports once.
 */
function isPassedOverKey(node: ESTree.Node): boolean {
  const { parent } = node;
  if (parent?.type !== "Property" || parent.key !== node || parent.computed) return false;
  if (parent.shorthand) return true;
  if (parent.parent.type !== "ObjectExpression") return false;
  const { value } = parent;
  return value.type === "Literal" || (value.type === "TemplateLiteral" && value.expressions.length === 0);
}

/**
 * The word "shape" in a symbol name (`taskShape`, `ShapeOf`, `SHAPE_KEYS`, `jsonShaped`) read
 * off every identifier, every `#private` name and every JSX name in the file.
 *
 * There is no fix: renaming a symbol reaches every file that names it, and the new name is the
 * point of the finding.
 */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: 'Disallow the word "shape" in JavaScript, TypeScript, private, and JSX symbol names.',
      examples: [
        {
          before: "const taskShape = parseTask(line);",
          after: "const heldTask = parseTask(line);",
        },
        {
          before: "interface ReportShape {\n  readonly tally: Tally;\n}",
          after: "interface ComparisonReport {\n  readonly tally: Tally;\n}",
        },
      ] satisfies RuleExample[],
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
      if (isBorrowedMemberName(node) || isPassedOverKey(node)) return;
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
