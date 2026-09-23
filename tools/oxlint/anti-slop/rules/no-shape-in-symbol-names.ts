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
 * The word "shape" in a symbol name — `taskShape`, `ShapeOf`, `SHAPE_KEYS`, `jsonShaped` — read
 * off every identifier, every `#private` name and every JSX name in the file.
 *
 * A name is where a value says what it is for, and "shape" says only that it has fields. It reads
 * as a description and is really a gap: `taskShape` is whichever of a task's several
 * representations this one happens to hold, and its reader has to go and find out which. Whatever
 * that answer turns out to be is the name, and that is what the message is asking for when it asks
 * for the domain role rather than the structure.
 *
 * The word is matched whole, not as a substring. Until 2026-09-22 the rule matched the letters
 * anywhere, so `reshaped`, the result of reshaping a list, had to be renamed; the rename chosen,
 * `newQuestions`, named the value no better. A verb built on the word names an operation, not
 * a structure standing in for a role. `WORD_BREAK` is what makes whole-word matching work inside
 * a single identifier, splitting on underscores, digits and case steps so that `jsonShaped` is
 * three words and `reshaped` is one.
 *
 * A property read off another value is exempt, through `isBorrowedMemberName`. `parsed.shape` is
 * not this file naming anything — the name belongs to whatever declared it, the rename would have
 * to happen there, and reporting it here would report the same name once per reader. A computed
 * read is not exempt, because it is an expression rather than a borrowed name.
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
