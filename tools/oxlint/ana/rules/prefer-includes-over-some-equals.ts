import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { annotatedKind } from "../shared/annotated-kind.ts";
import { holdsProse } from "../shared/masked.ts";

/**
 * `segments.some((segment) => segment === "")` is `segments.includes("")` with a closure around
 * it. The closure adds a parameter name, a scope and an arrow for the reader to step over, and
 * says the same thing.
 *
 * The rule reports only a string or boolean literal on the other side, and that limit is the
 * whole of it: the first version reported every equality closure, and its thirteen sites were
 * mostly not the pattern at all.
 *
 * Eight were narrowing predicates — `BACKEND_KINDS.some((known) => known === value)` with
 * `value: string` against a readonly tuple of literals. `Array<BackendKind>.includes` demands a
 * `BackendKind`, where the closure only needed the comparison to be allowed, so `.some` is how
 * that is written in TypeScript rather than a closure someone forgot to remove. Converting one
 * stopped the tree compiling. A plugin rule sees no types, so it cannot tell that site from a
 * real one, and reporting both asks the author to go and read an element type to find out
 * whether the rule was talking to them. `includes` also matches with SameValueZero, so
 * `[NaN].includes(NaN)` is true where the closure is false, and `null` is a literal that
 * `Array<string>.includes` still refuses.
 *
 * A string or boolean literal settles all of that at once: the value is not NaN, it is not null,
 * and an array compared against it already has that type among its elements. So every site this
 * reports it also fixes, and the ones it cannot prove it leaves alone. It found three; it now
 * holds the line at zero.
 *
 * An iterator has `some` and no `includes`, so `map.values().some((v) => v === "x")` was fixed
 * into a call that did not compile (20 October). The rule leaves a receiver whose chain holds a
 * `.values()`, `.keys()` or `.entries()` call or an `Iterator.from(…)`, and a name annotated as
 * one of the iterator types.
 */
/** Annotations whose values have `some` and no `includes`. */
const ITERATORS = new Set(["IteratorObject", "Generator", "MapIterator", "SetIterator", "ArrayIterator"]);

/** Calls that turn a collection into an iterator: `.values()` with no argument, or `Iterator.from`. */
const ITERATOR_CALLS = new Set(["values", "keys", "entries"]);

/** Whether a receiver is an iterator by its own chain: some call along it makes one. */
function iterated(receiver: ESTree.Node, iterators: ReadonlySet<string>): boolean {
  if (receiver.type === "Identifier") return iterators.has(receiver.name);
  if (receiver.type === "MemberExpression") return iterated(receiver.object, iterators);
  if (receiver.type !== "CallExpression" || receiver.callee.type !== "MemberExpression") return false;
  const { object, property } = receiver.callee;
  const name = property.type === "Identifier" ? property.name : "";
  const makes =
    (ITERATOR_CALLS.has(name) && receiver.arguments.length === 0) ||
    (name === "from" && object.type === "Identifier" && object.name === "Iterator");
  return makes || iterated(object, iterators);
}

export const preferIncludesOverSomeEqualsRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "Ask an array whether it includes a literal instead of wrapping the comparison in a closure.",
      examples: [
        {
          before: 'const blank = segments.some((segment) => segment === "");',
          after: 'const blank = segments.includes("");',
        },
        {
          before: 'if (argv.some((argument) => argument === "--dry-run")) printPlan(argv);',
          after: 'if (argv.includes("--dry-run")) printPlan(argv);',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      closureAroundEquals:
        "`.some(({{param}}) => {{param}} === {{value}})` is `.includes({{value}})` with a closure around it. Ask the array directly.",
    },
  },
  createOnce(context) {
    /** Names this file annotates as an iterator. */
    let iterators = new Set<string>();

    /**
     * The parameter and the literal of an `xs.some((p) => p === "value")` closure, or null when
     * the call is not that shape or the literal is not one the rule can settle. A string or a
     * boolean settles every question at once: not NaN, not null, and already the element type.
     */
    function comparison(node: ESTree.CallExpression): { parameter: string; value: string } | null {
      const [only] = node.arguments;
      if (node.arguments.length !== 1 || only?.type !== "ArrowFunctionExpression") return null;
      const [parameter] = only.params;
      if (only.params.length !== 1 || parameter?.type !== "Identifier") return null;
      const { body } = only;
      if (body.type !== "BinaryExpression" || body.operator !== "===") return null;

      // Either side may hold the parameter; the other side is what the array is asked about.
      const left = body.left.type === "Identifier" && body.left.name === parameter.name;
      const right = body.right.type === "Identifier" && body.right.name === parameter.name;
      if (left === right) return null;
      const operand = left ? body.right : body.left;
      if (operand.type !== "Literal") return null;

      // Read off the source text the fix will move, rather than through a runtime check on the
      // parsed value: a quoted string, or one of the two boolean words.
      const value = context.sourceCode.getText(operand);
      const quoted = value.startsWith('"') || value.startsWith("'");
      return quoted || value === "true" || value === "false" ? { parameter: parameter.name, value } : null;
    }

    return {
      before: () => {
        iterators = new Set<string>();
        return true;
      },

      Identifier(node) {
        const kind = annotatedKind(node);
        if (kind !== null && ITERATORS.has(kind)) iterators.add(node.name);
      },

      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "some") return;
        if (iterated(callee.object, iterators)) return;
        const [predicate] = node.arguments;
        const found = comparison(node);
        if (found === null || predicate === undefined) return;
        context.report({
          node: callee.property,
          messageId: "closureAroundEquals",
          data: { param: found.parameter, value: found.value },
          // The whole closure becomes the literal it compared against, so a sentence written
          // inside it has nowhere left to sit. One written between `.some(` and the closure is
          // outside both edits and stays where it is.
          fix: (fixer) =>
            holdsProse(context.sourceCode.getAllComments(), predicate.start, predicate.end)
              ? null
              : [fixer.replaceText(callee.property, "includes"), fixer.replaceText(predicate, found.value)],
        });
      },
    };
  },
});
