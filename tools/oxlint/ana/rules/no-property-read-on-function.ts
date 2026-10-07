import { defineRule, type ESTree } from "@oxlint/plugins";

/** Properties every function has. Reading one of these is a real read, not a mistake. */
const FUNCTION_OWN = new Set([
  "name",
  "length",
  "call",
  "apply",
  "bind",
  "prototype",
  "constructor",
  "toString",
]);

/**
 * A property read off a function this file declares:
 *
 *     function identity(tier) { … }
 *     …
 *     for (const key of KEYS) if (typeof identity[key] !== "string") return `${key} must be a string`;
 *
 * A function carries no data, so every one of those reads is `undefined` and the loop it guards
 * decides nothing. No type checker sees it in an untyped file, and in a typed one `noImplicitAny`
 * reports the computed form but not the dotted one.
 *
 * The shape has one cause, and it is not someone believing a function is a record. It is a rename
 * applied to a declaration and to some of its uses. On 2026-09-20 `archive-shape.mjs` renamed an
 * inner `identity` to `tierIdentity` and left two `identity[key]` reads behind; with the shadow
 * gone, both resolved outward to the module's own exported `identity` function, and the validator
 * refused every well-formed safeguard reconciliation — 23 failing assertions, in a file whose
 * tests had passed on the commit before. The sibling half of the same edit, a use left pointing at
 * a name nothing declares, is `eslint/no-undef`'s. This rule is for the half that still resolves,
 * which is the one that stays quiet.
 *
 * References come from scope analysis, so a shadow is not a false positive: an inner `identity`
 * is its own variable and its reads never reach this one. That is also why the rule would have
 * been silent on the commit before the rename, when the code was right.
 *
 * A module that attaches a property to its own function — `handler.schema = …` — is using it as a
 * namespace, and every read of it is then a real read. One assignment anywhere in the file exempts
 * that function entirely, because the rule cannot tell which reads the assignment was for.
 *
 * There is no fix: the read is `undefined`, so the repair is either the value's new home or the
 * deletion of the use, and neither is on the page. A fixer deleting the read would be deleting
 * the evidence that a rename went wrong.
 */
export const noPropertyReadOnFunctionRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A property read off a locally declared function is undefined." },
    messages: {
      read: "`{{name}}` is a function this file declares, so `{{read}}` is `undefined`. If a rename moved the value this once read, the use moved with it; if not, the name is wrong.",
    },
  },
  create(context) {
    /** The member expression this identifier is the object of, or null. */
    function readOff(identifier: ESTree.Node): ESTree.MemberExpression | null {
      const parent: ESTree.Node | null = identifier.parent;
      if (parent?.type !== "MemberExpression" || parent.object !== identifier) return null;
      if (
        !parent.computed &&
        parent.property.type === "Identifier" &&
        FUNCTION_OWN.has(parent.property.name)
      ) {
        return null;
      }
      return parent;
    }

    /** A namespace assignment: `fn.key = …` or `fn[key] = …`, which makes every read of `fn` real. */
    function assigns(member: ESTree.MemberExpression): boolean {
      const parent: ESTree.Node | null = member.parent;
      return parent.type === "AssignmentExpression" && parent.left === member;
    }

    function check(declaring: ESTree.Node, name: string): void {
      const declared = context.sourceCode
        .getDeclaredVariables(declaring)
        .find((variable) => variable.name === name);
      if (declared === undefined) return;
      const reads = declared.references
        .filter((reference) => reference.isRead())
        .map((reference) => readOff(reference.identifier))
        .filter((member): member is ESTree.MemberExpression => member !== null);
      if (reads.some(assigns)) return;
      for (const member of reads) {
        context.report({
          node: member,
          messageId: "read",
          data: { name, read: context.sourceCode.getText(member).replace(/\s+/gu, " ") },
        });
      }
    }

    function checkStatement(statement: ESTree.Node): void {
      if (statement.type === "FunctionDeclaration") {
        if (statement.id !== null) check(statement, statement.id.name);
        return;
      }
      if (statement.type !== "VariableDeclaration") return;
      for (const declarator of statement.declarations) {
        const init = declarator.init;
        if (init === null) continue;
        if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") continue;
        if (declarator.id.type === "Identifier") check(statement, declarator.id.name);
      }
    }

    return {
      Program(node) {
        for (const statement of node.body) {
          const declared = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
          if (declared !== null) checkStatement(declared);
        }
      },
    };
  },
});
