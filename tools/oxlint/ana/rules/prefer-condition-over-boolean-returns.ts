import { defineRule, type ESTree } from "@oxlint/plugins";
import { blockBody } from "../shared/statements.ts";

/**
 * A branch that returns one boolean and then the other is the condition, written out:
 *
 *     if (row.verified && row.pass !== null) return true;
 *     return false;
 *
 *     return row.verified && row.pass !== null;
 *
 * The cost is not the extra line. It is that the condition and the answer are in two places, so
 * a later hand can negate one and not the other, and the function's meaning now needs both
 * statements read together. Written as one expression there is nothing to keep in step.
 *
 * Both orders are read, and only one of them is fixed. `true` then `false` is the condition
 * itself, so the rewrite has nothing to decide: the test is lifted out of the `if` and returned
 * as it was written. `false` then `true` is its negation and has to add a `!`, and where the
 * parentheses go around a condition ending in `??`, or mixing `&&` with `||`, is a reading
 * decision the author should make. That half is reported and left.
 *
 * Only a literal `true`/`false` pair counts. Returning `row.pass` and then `false` is a
 * different finding with a different answer, because the first return may be `null`.
 *
 * The rewrite also has to leave the function returning a boolean, and two separate things can
 * say that it does. `if (row.name) return true; return false;` becomes `return row.name;`, which
 * answers `string | undefined`; where the return type is inferred, nothing anywhere says so, and
 * a caller comparing `=== true` reads false for a name the old function called true.
 *
 * So the fix wants one of two witnesses. Either the test is a boolean by its spelling — a
 * comparison, a `!`, a literal, or a `&&`/`||` of those — or the enclosing function declares
 * `: boolean`, in which case a widened return is a type error at the line the fix wrote. That is
 * the whole of condition 2, and it is why the common shape `function ok(row: Row): boolean { if
 * (row.pass) … }` is still rewritten while the same body under an inferred return type is not.
 *
 * `eslint/no-else-return` and `unicorn/prefer-ternary` are both on in this tree and neither
 * reads this shape: the first wants an `else` to remove, the second wants two assignments.
 */
/** Operators whose result is a boolean whatever their operands hold. */
const BOOLEAN_OPERATORS = new Set(["===", "!==", "==", "!=", "<", ">", "<=", ">=", "instanceof", "in"]);

/**
 * Whether this test answers with a boolean by its spelling alone, with no type in view.
 *
 * `&&` and `||` are the one recursive case and they need both sides, because each yields one of
 * its operands rather than a boolean: `a === b || fallback` answers `fallback`.
 */
function spelledBoolean(node: ESTree.Node): boolean {
  if (node.type === "ParenthesizedExpression") return spelledBoolean(node.expression);
  if (node.type === "Literal") return node.raw === "true" || node.raw === "false";
  if (node.type === "UnaryExpression") return node.operator === "!";
  if (node.type === "BinaryExpression") return BOOLEAN_OPERATORS.has(node.operator);
  if (node.type !== "LogicalExpression" || node.operator === "??") return false;
  return spelledBoolean(node.left) && spelledBoolean(node.right);
}

/**
 * Whether the function around this statement declares that it returns a boolean.
 *
 * The second witness, and the one that catches the ordinary shape. `Promise<boolean>` is not it:
 * the annotation has to be the keyword, so an `async` function keeps its report and loses its fix.
 */
function declaresBoolean(node: ESTree.Node): boolean {
  for (let at: ESTree.Node | null = node.parent; at !== null; at = at.parent) {
    if (!("returnType" in at) || !("params" in at)) continue;
    return at.returnType?.typeAnnotation.type === "TSBooleanKeyword";
  }
  return false;
}

export const preferConditionOverBooleanReturnsRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "Returning true then false spells out the condition; return it." },
    messages: {
      spelledOut:
        "This branch returns `{{first}}` and then `{{second}}`, which is `{{form}}` written over two statements. Returning the condition keeps the test and the answer in one place, where they cannot be negated apart.",
    },
  },
  createOnce(context) {
    /** The boolean a statement returns outright, or null when it returns anything else. */
    function returnedBoolean(node: ESTree.Statement | undefined): boolean | null {
      if (node === undefined) return null;
      const statement = node.type === "BlockStatement" && node.body.length === 1 ? node.body[0] : node;
      if (statement?.type !== "ReturnStatement") return null;
      const { argument } = statement;
      if (argument === null) return null;
      // Every literal node carries `type: "Literal"`, so the only thing separating `true` from
      // `0` is what it holds. `raw` says that in the source's own terms: a boolean is spelled
      // two ways and nothing else is spelled either of them.
      if (argument.type !== "Literal") return null;
      if (argument.raw === "true") return true;
      return argument.raw === "false" ? false : null;
    }

    /** The statement that runs when the branch does not: its `else`, or the next statement. */
    function otherwise(node: ESTree.IfStatement): ESTree.Statement | undefined {
      if (node.alternate !== null) return node.alternate;
      const body = blockBody(node);
      if (body === null) return undefined;
      const index = body.indexOf(node);
      return index === -1 ? undefined : body[index + 1];
    }

    /** What the guard before this one answers, or null when the statement above is not a guard. */
    function guardAbove(node: ESTree.IfStatement): boolean | null {
      const body = blockBody(node);
      if (body === null) return null;
      // A value computed between two guards does not end the run: `tools/outcome/query.ts` names
      // the projection it is about to search halfway down its four refusals.
      for (let at = body.indexOf(node) - 1; at >= 0; at -= 1) {
        const above = body[at];
        if (above?.type === "VariableDeclaration") continue;
        return above?.type === "IfStatement" ? returnedBoolean(above.consequent) : null;
      }
      return null;
    }

    return {
      IfStatement(node) {
        const first = returnedBoolean(node.consequent);
        if (first === null) return;
        const alternative = otherwise(node);
        const second = returnedBoolean(alternative);
        if (second === null || first === second) return;
        // The last of a run of guards is not the whole condition. `tools/outcome/query.ts` refuses
        // a row over four separate tests and then returns true; folding only the fourth into
        // `return !(…)` leaves three guards above it answering the same question a different way.
        if (guardAbove(node) === first) return;
        context.report({
          node,
          messageId: "spelledOut",
          data: {
            first: String(first),
            second: String(second),
            form: first ? "return <condition>" : "return !<condition>",
          },
          // An `else` keeps both returns inside the `if`; without one the second is the statement
          // below, and the replacement has to reach past the end of it or leave `return false;`
          // stranded under the answer that now precedes it.
          //
          // Reaching that far swallows whatever sits between the two returns, and in this tree
          // that is usually the sentence saying why the guard is there. Losing it compiles, and
          // every test still passes, so nothing would say the prose had gone. One comment is
          // carried onto the answer. Two would have to be stacked and indented, and a line
          // comment cannot lead a line that still carries code, so both are reported and left.
          fix: (fixer) => {
            if (!first || !(spelledBoolean(node.test) || declaresBoolean(node))) return null;
            const last = node.alternate === null ? (alternative?.end ?? node.end) : node.end;
            const text = context.sourceCode.text;
            const inside = context.sourceCode
              .getAllComments()
              .filter((one) => one.start >= node.start && one.end <= last);
            const [note] = inside;
            if (inside.length > 1) return null;
            const lineEnd = text.indexOf("\n", last);
            const after = text.slice(last, lineEnd === -1 ? text.length : lineEnd);
            if (note?.type === "Line" && /\S/u.test(after)) return null;
            return fixer.replaceTextRange(
              [node.start, last],
              `return ${context.sourceCode.getText(node.test)};${note === undefined ? "" : ` ${text.slice(note.start, note.end)}`}`,
            );
          },
        });
      },
    };
  },
});
