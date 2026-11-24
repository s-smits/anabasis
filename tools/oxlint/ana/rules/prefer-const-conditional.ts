import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { holdsProse, withoutProse } from "../shared/masked.ts";
import { everyStatementList, onlyStatement, plainAssignment } from "../shared/statements.ts";

/**
 * Flags a `let` declaration immediately followed by an `if` (or `if`/`else` when declared without
 * an initialiser) whose body is a single `=` assignment to that same binding, provided no later
 * statement reassigns it and the assignment does not read the binding itself. Auto-fixes the
 * two-arm (`if`/`else`) form into a `const` ternary and reports the single-arm default form.
 */
/** Expressions binding looser than a conditional, whose text needs parentheses as a test. */
const LOOSER_THAN_CONDITIONAL = new Set([
  "ArrowFunctionExpression",
  "AssignmentExpression",
  "ConditionalExpression",
  "SequenceExpression",
  "YieldExpression",
]);

export const preferConstConditionalRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "A let the next if decides is a const and a conditional.",
      examples: [
        {
          before:
            "let width = DEFAULT_WIDTH;\nif (options.width !== undefined) width = options.width;\ndraw(width, options.height);",
          after: "const width = options.width ?? DEFAULT_WIDTH;\ndraw(width, options.height);",
        },
        {
          before:
            'let profile: string;\nif (support.platform === "linux") profile = LINUX_PROFILE;\nelse profile = seatbeltProfile(reads, writes);\nlaunch(profile, command);',
          after:
            'const profile: string = support.platform === "linux" ? LINUX_PROFILE : seatbeltProfile(reads, writes);\nlaunch(profile, command);',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      twoStatements:
        "`{{name}}` is declared with a default and decided on the next line, so it stays mutable for the rest of the scope. One `const` with the condition in the expression makes the decision once and says the name will not move again.",
      twoArms:
        "`{{name}}` is declared with no value and assigned in both arms of the next `if`, so its type is wider than the name ever holds and it stays mutable for the rest of the scope. `const {{name}} = condition ? a : b` decides it where it is declared.",
    },
  },
  createOnce(context) {
    /** The plain `=` assignment a statement is, or null when it assigns nothing. */
    function assignment(node: ESTree.Statement | null): { name: string; right: ESTree.Expression } | null {
      const expression = plainAssignment(node);
      if (expression?.left.type !== "Identifier") return null;
      return { name: expression.left.name, right: expression.right };
    }

    /**
     * The right-hand sides the `if` decides `name` with, or null when it decides something else.
     */
    function decidedValues(
      next: ESTree.IfStatement,
      name: string,
      init: ESTree.Expression | null | undefined,
    ): ESTree.Expression[] | null {
      const consequent = assignment(onlyStatement(next.consequent));
      if (consequent?.name !== name) return null;
      const hasDefault = init !== null && init !== undefined;
      if (next.alternate === null) {
        return hasDefault ? [consequent.right] : null;
      }
      const alternate = assignment(onlyStatement(next.alternate));
      if (hasDefault || alternate?.name !== name) return null;
      return [consequent.right, alternate.right];
    }

    /** Whether a later sibling, or a later sibling's single-statement branch, writes the name too. */
    function assignedAgain(body: readonly ESTree.Statement[], from: number, name: string): boolean {
      for (const statement of body.slice(from)) {
        if (assignment(statement)?.name === name) return true;
        if (
          statement.type === "IfStatement" &&
          assignment(onlyStatement(statement.consequent))?.name === name
        ) {
          return true;
        }
      }
      return false;
    }

    /** The `if` test as it will read in the conditional's first position. */
    function asTest(node: ESTree.Expression): string {
      const text = context.sourceCode.getText(node);
      return LOOSER_THAN_CONDITIONAL.has(node.type) ? `(${text})` : text;
    }

    /** Every statement list this file holds, so each declaration can see what follows it. */
    function scan(body: readonly ESTree.Statement[]): void {
      for (const [index, statement] of body.entries()) {
        if (statement.type !== "VariableDeclaration" || statement.kind !== "let") continue;
        const [declared] = statement.declarations;
        if (statement.declarations.length !== 1 || declared === undefined) continue;
        if (declared.id.type !== "Identifier") continue;

        const next = body[index + 1];
        if (next?.type !== "IfStatement") continue;
        const { name } = declared.id;
        const decided = decidedValues(next, name, declared.init);
        if (decided === null) continue;
        // A value built from the name it replaces is a refinement; one expression would need the
        // first value twice or a second binding, so the two statements are the smaller form.
        const reads = new RegExp(String.raw`(?<![.\w$])${name}(?![\w$])`, "u");
        const code = (right: ESTree.Expression): string => withoutProse(context.sourceCode.getText(right));
        // The test joins the values here. It moves into the declaration's own initialiser, so a
        // test reading the name would be reading the binding it is initialising: a temporal dead
        // zone error at runtime, from a rewrite the compiler accepts.
        if ([...decided, next.test].some((right) => reads.test(code(right)))) continue;
        if (assignedAgain(body, index + 2, name)) continue;
        const [whenTrue, whenFalse] = decided;
        context.report({
          node: statement,
          messageId: decided.length === 1 ? "twoStatements" : "twoArms",
          data: { name },
          // The `if` goes whole, so a line written inside an arm goes with it. The comment
          // above the `if` sits outside both edits and stays where its author put it.
          fix: (fixer) =>
            whenFalse === undefined ||
            whenTrue === undefined ||
            holdsProse(context.sourceCode.getAllComments(), next.start, next.end)
              ? null
              : [
                  fixer.replaceText(
                    statement,
                    `const ${context.sourceCode.getText(declared.id)} = ${asTest(next.test)} ? ${context.sourceCode.getText(whenTrue)} : ${context.sourceCode.getText(whenFalse)};`,
                  ),
                  fixer.remove(next),
                ],
        });
      }
    }

    return everyStatementList(scan);
  },
});
