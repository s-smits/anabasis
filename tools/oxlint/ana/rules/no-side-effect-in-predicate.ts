import { defineRule } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { identifierName, inlineFunctionArgument, isNamedMember } from "../shared/statements.ts";

/**
 * Flags inline callbacks passed to `filter`, `find`, `findLast`, `findIndex`, `some`, or `every`
 * whose body calls a collection-mutating method (`add`, `set`, `delete`, `push`, `unshift`,
 * `clear`). There is no fix.
 */

/** The six array methods whose argument is a predicate: a question, asked once per element. */
const PREDICATE_METHODS = new Set(["filter", "find", "findLast", "findIndex", "some", "every"]);

/** Methods whose receiver is changed by the call, so a predicate holding one has an effect. */
const MUTATIONS = new Set(["add", "set", "delete", "push", "unshift", "clear"]);

export const noSideEffectInPredicateRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A predicate that mutates a collection is a loop wearing an array method's name.",
      examples: [
        {
          before: "const unique = tasks.filter((task) => !seen.has(task.id) && seen.add(task.id));",
          after: "const unique = [...new Map(tasks.map((task) => [task.id, task])).values()];",
        },
        {
          before:
            'const passed = solves.filter((solve) => {\n  if (solve.ending !== "pass") failed.push(solve);\n  return solve.ending === "pass";\n});',
          after: "const { pass = [], fail = [] } = Object.groupBy(solves, (solve) => solve.ending);",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      mutates:
        "This `.{{method}}()` predicate calls `.{{mutation}}()`, so the walk builds state while it answers. Deduplication is `new Map(xs.map((x) => [key, x]))`; a walk that really does two things is a loop.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (!isNamedMember(callee) || !PREDICATE_METHODS.has(identifierName(callee.property) ?? "")) return;
        const predicate = inlineFunctionArgument(node);
        if (predicate === null) return;
        const body = context.sourceCode.getText(predicate.body);
        const found = [...MUTATIONS].find((name) => new RegExp(String.raw`\.${name}\s*\(`, "u").test(body));
        if (found === undefined) return;
        context.report({
          node: callee.property,
          messageId: "mutates",
          data: { method: callee.property.name, mutation: found },
        });
      },
    };
  },
});
