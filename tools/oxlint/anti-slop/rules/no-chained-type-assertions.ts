import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

type TypeAssertionExpression = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

function isTypeAssertionExpression(node: ESTree.Node): node is TypeAssertionExpression {
  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
}

function unwrapParenthesizedExpression(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

function isConstAssertion(node: TypeAssertionExpression): boolean {
  const { typeAnnotation } = node;
  return (
    typeAnnotation.type === "TSTypeReference" &&
    typeAnnotation.typeName.type === "Identifier" &&
    typeAnnotation.typeName.name === "const"
  );
}

function isOutermostAssertionInChain(node: TypeAssertionExpression): boolean {
  let current: ESTree.Expression = node;
  let { parent } = node;

  while (parent.type === "ParenthesizedExpression" && parent.expression === current) {
    current = parent;
    parent = parent.parent;
  }

  return !isTypeAssertionExpression(parent) || parent.expression !== current;
}

function isForbiddenAssertionChain(node: TypeAssertionExpression): boolean {
  let assertionCount = 0;
  let hasNonConstAssertion = false;
  let current: ESTree.Expression = node;

  while (isTypeAssertionExpression(current)) {
    assertionCount += 1;
    hasNonConstAssertion ||= !isConstAssertion(current);
    current = unwrapParenthesizedExpression(current.expression);
  }

  return assertionCount > 1 && hasNonConstAssertion;
}

/**
 * Two or more type assertions stacked on one expression: `value as unknown as Row`, or the same
 * thing spelled with angle brackets or hidden behind parentheses.
 *
 * One assertion says the author knows something the checker does not. Two say the first one was
 * not accepted either, and the usual second one is `as unknown`, whose entire job is to widen far
 * enough that the assertion after it stops being an error. What reaches the reader is a value
 * carrying a name and no evidence, and the type it started from — the one piece of real
 * information in the expression — has been discarded on the way.
 *
 * A chain of nothing but `as const` is admitted, because `as const` narrows rather than widens
 * and adds evidence rather than replacing it. `isForbiddenAssertionChain` therefore counts the
 * assertions and separately asks whether any one of them is something other than `const`, so the
 * chain has to be both long and lossy before it is reported. The report also fires once per
 * chain: `isOutermostAssertionInChain` walks out through parentheses and stays silent unless
 * nothing above is another assertion, so a three-deep chain is one finding at the top rather than
 * three findings at the same expression.
 *
 * There is no fix: the repair is the one assertion that is true, or the validation that removes
 * both, and a chain exists precisely because neither was obvious.
 */
export const noChainedTypeAssertionsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow chained TypeScript as and angle-bracket assertions, including parenthesized chains.",
      examples: [
        {
          before: "const event = capturedJsonParse(line) as unknown as LogEvent;",
          after: "const event = parseEvent(capturedJsonParse(line));",
        },
        {
          before: "function taskOf(entry: Entry): Task {\n  return entry.payload as unknown as Task;\n}",
          after: "function taskOf(entry: Entry): Task {\n  return parseTask(entry.payload);\n}",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      chained:
        "This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.",
    },
  },
  createOnce(context) {
    const checkTypeAssertion = (node: TypeAssertionExpression) => {
      if (!isOutermostAssertionInChain(node) || !isForbiddenAssertionChain(node)) return;
      context.report({ node, messageId: "chained" });
    };

    return {
      TSAsExpression: checkTypeAssertion,
      TSTypeAssertion: checkTypeAssertion,
    };
  },
});
