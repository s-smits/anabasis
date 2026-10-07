import { defineRule, type ESTree } from "@oxlint/plugins";
import { holdsProse, withoutProse } from "../shared/masked.ts";
import { everyStatementList, onlyStatement } from "../shared/statements.ts";

/**
 * A `let` declared with one value and immediately overwritten in one branch is a `const` and a
 * conditional expression:
 *
 *     let width = DEFAULT_WIDTH;
 *     if (options.width !== undefined) width = options.width;
 *
 *     const width = options.width ?? DEFAULT_WIDTH;
 *
 * Two things are wrong with the first spelling, and neither is style. The binding is mutable
 * for the rest of the function, so a reader arriving at the tenth line below cannot tell from
 * the declaration whether it still holds what it was given; and the decision is spread over two
 * statements, so a third branch can be added later without anyone noticing that the name now
 * means three things.
 *
 * The commit lane found this in `23086a056` and `7a4387da1`, and `no-useless-assignment` — now
 * on, five sites — catches the neighbouring case where the first value is never read at all.
 * This one is the case where it *is* read: the initialiser is the default.
 *
 * The second spelling is the same decision with no default to start from:
 *
 *     let profile: string;
 *     if (support.platform === "linux") profile = LINUX_PROFILE;
 *     else profile = seatbeltProfile(reads, writes);
 *
 *     const profile = support.platform === "linux" ? LINUX_PROFILE : seatbeltProfile(reads, writes);
 *
 * This one was left to `ana/no-arms-differing-in-one-term` when the rule was written, and that
 * was wrong: it reads two arms that differ in *one term*, and two arms that share nothing are
 * exactly the case it passes over. `unicorn/prefer-ternary` found the gap in one site on
 * 2026-09-20 and was refused for the other three it found, where both arms are `await` statements
 * and the ternary reads worse. The shape with an owner is the declaration, so it went here.
 *
 * The shape is read strictly. The `if` must be the statement immediately after the declaration,
 * and its whole body must be one assignment to that same name with `=`. A declaration with a
 * default needs one arm and no `else`, because the `if` supplies the other; one with no value
 * needs both arms, since a single `if` would leave the name undefined on the other path and that
 * is a different program. A declaration with a default *and* an `else` is a dead initialiser,
 * which `no-useless-assignment` already owns. A declaration of two bindings is skipped, because
 * moving one of them changes where the other is declared, and a compound assignment is an
 * accumulation, not a decision.
 *
 * Two more exemptions came from the rule's own census (2026-09-20), where two of its three sites
 * were not this shape. A name a later statement assigns again is a cascade, not a decision:
 * `harness-trial.ts` opens `status` on the accepted submit and then overrides it four times, and
 * one `const` holding those five cases is a worse sentence than the five lines. And an assignment
 * that reads the name it is assigning is a refinement of the value, not a choice between two:
 * `review-sources.ts` takes a slice and then drops a trailing lone surrogate from it, which as one
 * expression needs the slice twice or a second name.
 *
 * It fixes the two-arm shape and reports the other. With a default, `c ? b : a` and `a ?? b`
 * are different programs when the default is falsy, and which one the site wants is not
 * readable from the assignment. With both arms written out there is nothing to choose: the
 * condition and both values are already on the page, so the rewrite is the same program with
 * one statement instead of three. The annotation travels with it, because dropping `let
 * handler: (a: string) => void` would leave the arms' parameters contextually untyped, and the
 * fix edits the two statements separately rather than replacing the span between them, so a
 * comment written on the declaration's line or between the two survives the rewrite.
 */
/**
 * Expressions binding looser than a conditional, whose text needs parentheses as a test.
 *
 * This is the whole grammar, not a sample: a conditional's test accepts a short-circuit
 * expression, so the five forms that bind looser are assignment, arrow, yield, sequence and a
 * conditional itself. The last one is the one that bites, because `?:` is right-associative —
 * `a ? b : c` dropped unparenthesised into the test of `? p : q` reads as `a ? b : (c ? p : q)`,
 * which is a different program that still compiles.
 */
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
    docs: { description: "A let the next if decides is a const and a conditional." },
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
      if (node?.type !== "ExpressionStatement") return null;
      const { expression } = node;
      if (expression.type !== "AssignmentExpression" || expression.operator !== "=") return null;
      if (expression.left.type !== "Identifier") return null;
      return { name: expression.left.name, right: expression.right };
    }

    /**
     * The right-hand sides the `if` decides `name` with, or null when it decides something else.
     *
     * The arm count is what the declaration asks for: a default needs one and refuses an `else`,
     * no value needs both. An `else if` returns null here, because `onlyStatement` hands back the
     * nested `if` and that assigns nothing.
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
