import { defineRule } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { identifierName, inlineFunctionArgument, isNamedMember } from "../shared/statements.ts";

/**
 * A predicate that mutates is not a predicate. The shape the simplify skill kept finding is a
 * `Set` used for deduplication from inside a `.filter()`:
 *
 *     const first = rows.filter((row) => !seen.has(row.id) && seen.add(row.id));
 *
 * The answer is the platform's own: `new Map(rows.map((row) => [row.id, row])).values()` keeps the
 * last of each key, and `[...new Map(...)].values()` reversed keeps the first. Either way one data
 * structure does the job the closure was doing by side effect, and the array method goes back to
 * answering a question rather than building state while it walks.
 *
 * The rule reads the six positions that take a predicate — `filter`, `find`, `findLast`,
 * `findIndex`, `some` and `every` — and reports a callback whose body calls one of six mutating
 * methods. Each changes a receiver that outlives the walk, which is what makes the number of walks
 * observable, and a call that merely reads is invisible here. Reading the text rather than the tree
 * keeps it to one line per name: the dot is required, so a free `add(x)` says nothing about a
 * collection. An assignment to an outer `let` also makes the count observable, and is not
 * reported, because the text cannot tell it from a `const` declared inside the predicate.
 *
 * `forEach`, `map` and `reduce` are outside it on purpose. `forEach` exists to have an effect,
 * a `map` that also records what it saw is a different finding with a different answer, and
 * `reduce` carries its accumulator by contract.
 *
 * There is no fix: which structure replaces the set — a `Map` by key, a
 * `Object.groupBy`, or a plain loop when the walk really does build two things — is the decision
 * the author has to make, and it is not readable off the predicate.
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
