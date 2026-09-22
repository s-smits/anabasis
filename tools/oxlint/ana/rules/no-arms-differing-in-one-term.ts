import { defineRule, type ESTree } from "@oxlint/plugins";
import { blockBody, onlyStatement } from "../shared/statements.ts";

/**
 * Rung 5 of the simplify skill's ladder: "two arms differing in one clause are one arm". It is
 * the most mechanical judgement the skill makes and among the ones it makes most often, so it is
 * worth a catcher. The skill is invoked by hand; this reports the same shape on every run.
 *
 * Both spellings of the shape are read, because the skill treats them as one finding:
 *
 *     if (linux) return spawnUnder(bwrapProfile, command);
 *     return spawnUnder(seatbeltProfile, command);
 *
 *     const wall = linux ? spawnUnder("bwrap", command) : spawnUnder("seatbelt", command);
 *
 * A reader has to compare the two arms character by character to find the one word that moved.
 * Written once, with the condition at the word, there is nothing to compare.
 *
 * The comparison is over tokens rather than characters or an AST shape, and it is deliberately
 * strict: the two arms must produce the same token sequence at the same length and differ at
 * exactly one position. A difference of two tokens is two decisions, and merging those reads
 * worse than the branch. That strictness is the admission test — at every site this reports,
 * one conditional expression at the differing token is legal and shorter, so the catcher never
 * asks for something another rule or ceiling refuses.
 *
 * The differing token has to be a value the expression consumes, not a name it dispatches on.
 * This was measured on 2026-09-20 over 24 sites and owned 16 of them. A name in callee, member,
 * receiver, constructor, element or assignment-target position is what the line *does*, and
 * hoisting it costs a computed member or an indirect call:
 *
 *     result[value instanceof Error ? "reject" : "resolve"](value)
 *     budget.aggregate[budget.phase === "content" ? "entries" : "metadataEntries"] += 1
 *     (kind === "hardlink" ? fs.linkSync : fs.symlinkSync)(alias, selected)
 *
 * Each of those reads worse than the two arms it replaces, and the second loses the static
 * property access a rename can follow. The `labelled` case below already states this for a
 * string — two named outcomes are not one outcome with a hole — and a name in dispatch position
 * is the same thing spelled in code. So `linkSync` against `symlinkSync` is two system calls,
 * `reject` against `resolve` is two outcomes, and `completed += 1` against `open += 1` is two
 * counters.
 *
 * Five more things keep their branch. Arms naming fewer than three things keep theirs, because a
 * choice between two short expressions is what a conditional is for and there is nothing to scan:
 * `verify ? args[1] : args[0]` names two. Punctuation keeps its branch, because `===` against
 * `!==` is two relations and `(a === b) === wanted` is not the shorter spelling. A template
 * literal keeps it for the same reason a quoted string does: two messages differing in their
 * text are two messages, which is four of the sites in `edit-core.ts` and `full-run.ts`. An arm
 * carrying a comment keeps it, because the comment is about that branch and has nowhere to go in
 * a merged expression. An arm over 200 characters keeps it, because the merged line would need
 * wrapping and the saving disappears. And a `default:`-less switch is not a branch pair, so this
 * says nothing about one.
 *
 * With those, the shape had no site left in this tree: what the token comparison alone was
 * finding was dispatch, not a hole in one arm.
 *
 * There is no fix: the conditional goes where the token was, and only a reader can
 * place it well. It gates, because the class where the merged form is the worse spelling — two
 * named outcomes rather than one outcome with a hole — is exactly what the exemptions above now
 * hold back.
 */

/** A token, for comparison: an identifier or keyword, a number, a whole string or template, or
 *  one punctuation character. Comments are not tokens here; an arm holding one is not compared. */
const TOKEN = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[A-Za-z_$][\w$]*|\d[\w.]*|\S/gu;

/** The longest arm this catcher will ask to merge. Beyond it the one expression needs wrapping. */
const ARM_LIMIT = 200;

/** Things an arm has to name before "one term moved" is a finding rather than the shape of a
 *  choice. `linux ? bwrap : seatbelt` names one a side and `args[1]` names two, which is what a
 *  conditional is for; there is no second spelling and nothing to compare. The saving starts
 *  where the arms are expressions a reader has to scan to find the word that differs, and
 *  `spawnUnder(bwrapProfile, command)` — the shape this rule is named for — names three. */
const ARM_WORD_FLOOR = 3;

/** Tokens before the differing one that put it in dispatch position, and those after it. */
const DISPATCHED_AFTER = new Set([".", "new", "<"]);
const DISPATCHES_BEFORE = new Set(["(", ".", "["]);

/** A word: an identifier, a keyword, a number, a string or a template. The rest is punctuation. */
function isWord(token: string): boolean {
  return /^[\dA-Za-z_$"'`]/u.test(token);
}

/** A token that states a value rather than naming an outcome: no string, template or operator. */
function isName(token: string): boolean {
  return /^[\dA-Za-z_$]/u.test(token);
}

/** Whether the token at `index` is written to: `x = 1`, `x += 1`, `x++`. `x === y` is not. */
function assignedAt(tokens: readonly string[], index: number): boolean {
  const next = tokens[index + 1] ?? "";
  const after = tokens[index + 2];
  if (next === "=") return after !== "=";
  return next.length === 1 && "+-*/%&|^".includes(next) && (after === "=" || after === next);
}

/** Whether the differing token names what the line does rather than what it does it to. */
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
    },
    messages: {
      oneTerm:
        "These two arms are the same text apart from `{{left}}` against `{{right}}`. Write the arm once with the condition at that word: a reader should not have to compare two arms to find the one term that moved.",
    },
  },
  createOnce(context) {
    /** The one differing token pair, or null when the arms differ anywhere else than one token. */
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

    /**
     * The second arm of a guard written without an `else`.
     *
     * `if (linux) return a; return b;` is the two-arm shape with the `else` left out, and it is
     * the spelling this tree prefers, so reading only `if`/`else` would miss most of the sites.
     * Both statements have to be returns: a guard that returns while the rest of the function
     * continues is one arm and a body, which is a different thing.
     */
    function falling(node: ESTree.IfStatement): ESTree.Statement | null {
      const consequent = onlyStatement(node.consequent);
      if (consequent?.type !== "ReturnStatement") return null;
      const body = blockBody(node);
      if (body === null) return null;
      const next = body[body.indexOf(node) + 1];
      return next?.type === "ReturnStatement" ? next : null;
    }

    /** Report the pair when the two arms hold no comment, fit the limit and differ once. */
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
        // A nested ternary is the same three-arm case as an `else if` chain.
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
