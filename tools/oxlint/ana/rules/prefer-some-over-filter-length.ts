import { defineRule, type ESTree } from "@oxlint/plugins";
import { holdsProse } from "../shared/masked.ts";
import { calls, writes } from "../shared/predicate-effect.ts";
import { asSubject, methodCall } from "../shared/statements.ts";

/**
 * `rows.filter(isFailed).length > 0` builds an array to answer a question about the first
 * element. `rows.some(isFailed)` asks the question, stops at the first match, and says in its
 * name what the line is for.
 *
 * Three variants, one answer each. Compared against zero with `>` or `!==` the line means
 * "any", which is `.some(p)`. Compared with `=== 0` it means "none", which is `!xs.some(p)`.
 * Compared with `===` against the array's own length it means "all", which is `.every(p)`, and
 * that last one is not read here because the length it compares against is rarely in view.
 *
 * The array built and thrown away is the smaller half of the cost. The larger half is that
 * `.length > 0` makes the reader work out what the count was for, and a later edit that wants
 * the count as well as the question has no reason not to keep both spellings.
 *
 * `unicorn/explicit-length-check` is already on in this tree and reads the neighbouring shape —
 * a bare `.length` used as a boolean — but it has nothing to say about a `.filter()` in front
 * of it, because the array it measures might be anyone's.
 *
 * It fixes the sites it can prove. `.some()` short-circuits, so a predicate with an effect in
 * it runs a different number of times after the change — but that is a property of the closure,
 * not of the shape, and `shared/predicate-effect.ts` already decides it for the sibling rule
 * that reports those closures. A predicate written out here with none of the six mutations in it
 * can be asked fewer times without anyone noticing, so the rewrite is safe and the rule makes
 * it. A predicate passed by name is left alone: `rows.filter(isFailed)` says nothing about what
 * `isFailed` does, and the rewrite would be a guess.
 */
export const preferSomeOverFilterLengthRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "A filtered length compared with zero is .some() or !.some()." },
    messages: {
      countedForNothing:
        "`.filter(…).length {{operator}} 0` builds an array to answer `{{answer}}`. `{{replacement}}` asks it directly and stops at the first match.",
    },
  },
  createOnce(context) {
    /** The subject and predicate of the `<subject>.filter(<predicate>)` this `.length` measures. */
    function filteredLength(
      node: ESTree.Node,
    ): { readonly subject: string; readonly predicate: ESTree.Node } | null {
      if (node.type !== "MemberExpression" || node.computed) return null;
      if (node.property.type !== "Identifier" || node.property.name !== "length") return null;
      const call = methodCall(node.object, "filter");
      if (call === null) return null;
      const { receiver, argument } = call;
      return { subject: asSubject(receiver, context.sourceCode.getText(receiver)), predicate: argument };
    }

    return {
      BinaryExpression(node) {
        const { operator, left, right } = node;
        const found = filteredLength(left);
        if (found === null) return;
        if (right.type !== "Literal" || right.value !== 0) return;

        const any = operator === ">" || operator === "!==" || operator === "!=";
        const none = operator === "===" || operator === "==";
        if (!any && !none) return;

        const carried = found.predicate;
        const text = context.sourceCode.getText(carried);
        const asked = `${any ? "" : "!"}${found.subject}.some(${text})`;
        // `.some` stops at the first match, so a predicate whose count is observable may not be
        // rewritten. An assignment to anything outliving the walk is one way, and `writes`
        // refuses the whole class rather than trying to tell them apart. A call is the other, and
        // it cannot be told apart at all: `(row) => recordVisit(row)` names no mutating method
        // and writes nothing here, and what it does is in another file. A blacklist of mutating
        // spellings read that as pure until 2026-09-20; `calls` refuses every call instead.
        // The predicate travels as its own source, so a sentence inside it survives. The rest of
        // the expression is rebuilt from `subject` and the operator, and a line written there —
        // beside a `.filter(…)` in a wrapped chain, most often — would be rebuilt away.
        const body =
          carried.type === "ArrowFunctionExpression" || carried.type === "FunctionExpression"
            ? context.sourceCode.getText(carried.body)
            : null;
        const comments = context.sourceCode.getAllComments();
        const around =
          holdsProse(comments, node.start, carried.start) || holdsProse(comments, carried.end, node.end);
        const clean = body !== null && !around && !calls(body) && !writes(text);
        context.report({
          node,
          messageId: "countedForNothing",
          data: { operator, answer: any ? "is there one?" : "is there none?", replacement: asked },
          fix: (fixer) => (clean ? fixer.replaceText(node, asked) : null),
        });
      },
    };
  },
});
