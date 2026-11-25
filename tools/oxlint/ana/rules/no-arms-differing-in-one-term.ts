import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { blockBody, onlyStatement } from "../shared/statements.ts";

/**
 * Rung 5 of the simplify ladder: two branch arms of equal token length that differ at exactly one
 * value token (not in dispatch position, strings/templates, operators, commented arms, arms under
 * three word tokens, or arms over 200 characters) should be written once with the conditional at
 * the differing token. There is no fix.
 */

/** A token: an identifier/keyword, number, string/template, or single punctuation character. */
const TOKEN = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[A-Za-z_$][\w$]*|\d[\w.]*|\S/gu;

/** The longest arm this rule will ask to merge; beyond it the one expression needs wrapping. */
const ARM_LIMIT = 200;

/** Minimum word tokens per arm before a single-token difference is reported. */
const ARM_WORD_FLOOR = 3;

/** Tokens before the differing one that put it in dispatch position, and those after it. */
const DISPATCHED_AFTER = new Set([".", "new", "<"]);
const DISPATCHES_BEFORE = new Set(["(", ".", "["]);

function isWord(token: string): boolean {
  return /^[\dA-Za-z_$"'`]/u.test(token);
}

/** A token that states a value rather than naming an outcome: no string, template or operator. */
function isName(token: string): boolean {
  return /^[\dA-Za-z_$]/u.test(token);
}

function assignedAt(tokens: readonly string[], index: number): boolean {
  const next = tokens[index + 1] ?? "";
  const after = tokens[index + 2];
  if (next === "=") return after !== "=";
  return next.length === 1 && "+-*/%&|^".includes(next) && (after === "=" || after === next);
}

function dispatchedAt(tokens: readonly string[], index: number): boolean {
  if (DISPATCHED_AFTER.has(tokens[index - 1] ?? "")) return true;
  if (DISPATCHES_BEFORE.has(tokens[index + 1] ?? "")) return true;
  return assignedAt(tokens, index);
}

export const noArmsDifferingInOneTermRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Two branches differing in one token are one branch with a conditional at that token.",
      examples: [
        {
          before:
            'function wallFor(platform: string, command: string[]) {\n  if (platform === "linux") return spawnUnder(bwrapProfile, command);\n  return spawnUnder(seatbeltProfile, command);\n}',
          after:
            'function wallFor(platform: string, command: string[]) {\n  return spawnUnder(platform === "linux" ? bwrapProfile : seatbeltProfile, command);\n}',
        },
        {
          before: "const reserve = promoted ? priceOf(setting, newReference) : priceOf(setting, reference);",
          after: "const reserve = priceOf(setting, promoted ? newReference : reference);",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      oneTerm:
        "These two arms are the same text apart from `{{left}}` against `{{right}}`. Write the arm once with the condition at that word: a reader should not have to compare two arms to find the one term that moved.",
    },
  },
  createOnce(context) {
    function singleDifference(left: string, right: string): { left: string; right: string } | null {
      const a = left.match(TOKEN) ?? [];
      const b = right.match(TOKEN) ?? [];
      if (a.length !== b.length || a.filter(isWord).length < ARM_WORD_FLOOR) return null;
      let at = -1;
      for (const [index, token] of a.entries()) {
        if (token === (b[index] ?? "")) continue;
        if (at >= 0) return null;
        at = index;
      }
      const found = a[at];
      if (found === undefined || !isName(found) || dispatchedAt(a, at) || dispatchedAt(b, at)) return null;
      return { left: found, right: b[at] ?? "" };
    }

    function falling(node: ESTree.IfStatement): ESTree.Statement | null {
      const consequent = onlyStatement(node.consequent);
      if (consequent?.type !== "ReturnStatement") return null;
      const body = blockBody(node);
      if (body === null) return null;
      const next = body[body.indexOf(node) + 1];
      return next?.type === "ReturnStatement" ? next : null;
    }

    function compare(node: ESTree.Node, left: ESTree.Node, right: ESTree.Node): void {
      if (context.sourceCode.getCommentsInside(left).length > 0) return;
      if (context.sourceCode.getCommentsInside(right).length > 0) return;
      const leftText = context.sourceCode.getText(left);
      const rightText = context.sourceCode.getText(right);
      if (leftText.length > ARM_LIMIT || rightText.length > ARM_LIMIT) return;
      const differing = singleDifference(leftText, rightText);
      if (differing === null) return;
      context.report({ node, messageId: "oneTerm", data: differing });
    }

    return {
      IfStatement(node) {
        // An `else if` chain is three arms or more, and merging one pair of them says nothing.
        if (node.alternate?.type === "IfStatement") return;
        const consequent = onlyStatement(node.consequent);
        const alternate = node.alternate === null ? falling(node) : onlyStatement(node.alternate);
        if (consequent === null || alternate === null) return;
        compare(node, consequent, alternate);
      },

      ConditionalExpression(node) {
        if (
          node.consequent.type === "ConditionalExpression" ||
          node.alternate.type === "ConditionalExpression"
        ) {
          return;
        }
        compare(node, node.consequent, node.alternate);
      },
    };
  },
});
