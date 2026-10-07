import { defineRule, type ESTree } from "@oxlint/plugins";

/**
 * Four levels of nesting inside one function means the reader has to hold four conditions at
 * once to know why the innermost line runs. The count is not a style preference: each level is
 * a fact that stays true for everything below it, and the working contract's own habit —
 * `if (…) continue;`, `if (…) return null;` — exists because holding one fact is cheaper than
 * holding four.
 *
 * The three answers, in the order to try them. A guard that ends the iteration or the call
 * flattens the rest of the body by one level and costs a line. A body that does two separable
 * things is two functions, and the inner one usually wants the loop, not the branch. A loop
 * inside a loop inside a branch is often one `.flatMap()` or one `Map` lookup that the shape
 * is spelling out by hand.
 *
 * This is deliberately not the complexity gate. `tools/loc/complexity-policy.ts` counts decision
 * points and refuses at 22, which a long flat `switch` reaches while staying readable and which
 * a four-deep pyramid can sit well under. Depth and branch count measure different costs, and a
 * function can pass one while failing the other.
 *
 * A `catch` counts and a `try` block does not. Entering a `try` is unconditional: every
 * statement in it runs on the same path as the statement above the `try`, so the reader holds
 * no extra fact about why the line runs, only where control goes if it fails — one fact for the
 * whole function rather than one per level. A `catch` is the other way round: a reader is there
 * because something threw. Counting the `try` block reported four shapes that are the
 * repository's ordinary "do the work, clean up on failure" body: `cleanStaleTempRootScratch`
 * opens a directory inside a `try` inside a `try` and is then two levels deep, and
 * `rememberReadRootListing` spends two of its four on a `try` whose `catch` is `return`.
 * `finally` does not count either, for the same reason as `try`: it runs on every path.
 *
 * A `switch` counts once for the statement, not once more for each case, since the cases are
 * alternatives rather than accumulated conditions. A nested function resets the count: its body
 * is read on its own.
 *
 * A guard is not a level. It is the first answer this rule offers, and counting it reported the
 * remedy as the defect: control leaves, so nothing below it is inside it and the next line is one
 * level shallower rather than deeper. `caseGroundingClauses` was reported on
 * `if (executedTriples.has(…)) continue;` and `openWorkshopCell` on
 * `if (canary.status === 255) throw unavailable(…);` — both of them the shape a reader wants.
 * Nine of 14 sites.
 *
 * A guard has no `else`, ends in `return`, `continue`, `break` or `throw`, holds at most three
 * statements and branches in none of them. The three statements are what the recorded shape
 * needs: `safeguardUsageReport` counts a malformed line and continues, which is a guard with a
 * side effect and not a branch. The no-branching clause is what keeps
 * `authoringContractFiles` reported, where the `continue` sits under a nested `if` that decides
 * whether the type-only edge still joins the contract — that body is doing two things, which is
 * the second answer this rule offers.
 *
 * There is no fix. Which of the three answers a site wants is the whole decision.
 */

/** Levels of nesting a function body may hold before the innermost line has too many reasons. */
const DEPTH_LIMIT = 4;

/** Statements that leave, so an `if` ending in one of them encloses nothing below it. */
const JUMPS = new Set(["ReturnStatement", "ContinueStatement", "BreakStatement", "ThrowStatement"]);

/** Statements that open a level of their own, so a body holding one is a branch, not a guard. */
const BRANCHES = new Set([
  "IfStatement",
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "TryStatement",
]);

/** How much a guard may do beside leaving before it is a branch that happens to end in a jump. */
const GUARD_STATEMENTS = 3;

/** Whether this `if` opens a level: it is not an `else if`, and it is not a guard. */
function counts(node: ESTree.IfStatement): boolean {
  // `else if` is an alternative to the branch above it, not a level inside it.
  if (node.parent.type === "IfStatement" && node.parent.alternate === node) return false;
  if (node.alternate !== null) return true;
  const body = node.consequent.type === "BlockStatement" ? node.consequent.body : [node.consequent];
  if (body.length > GUARD_STATEMENTS || !JUMPS.has(body.at(-1)?.type ?? "")) return true;
  return body.some((statement) => BRANCHES.has(statement.type));
}

export const noDeepNestingRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A statement nested four deep asks the reader to hold four conditions." },
    messages: {
      tooDeep:
        "This statement sits {{depth}} levels inside its function, so reaching it means holding {{depth}} conditions at once. A guard that returns or continues removes one level for a line; a body doing two things is two functions; a loop inside a loop is often one `.flatMap()`.",
    },
  },
  createOnce(context) {
    /** Nesting levels open at this point, innermost last. Reset at every function boundary. */
    const open: ESTree.Node[] = [];
    /**
     * One frame per function being read, the file itself first.
     *
     * `base` is where this function's own counting starts, so a callback nested three deep
     * reads its body from zero. `reported` belongs to the frame rather than to the rule: with
     * one shared flag, a callback returning restored it, and the second pyramid in a function
     * that contains a callback was reported as though the first had not been.
     */
    const frames: { base: number; reported: boolean }[] = [{ base: 0, reported: false }];

    function enterFunction(): void {
      frames.push({ base: open.length, reported: false });
    }

    function exitFunction(): void {
      const frame = frames.pop();
      if (frame !== undefined) open.length = frame.base;
    }

    function enter(node: ESTree.Node): void {
      open.push(node);
      const frame = frames.at(-1);
      if (frame === undefined) return;
      const depth = open.length - frame.base;
      if (frame.reported || depth < DEPTH_LIMIT) return;
      frame.reported = true;
      context.report({ node, messageId: "tooDeep", data: { depth: String(depth) } });
    }

    function exit(): void {
      open.pop();
    }

    return {
      before: () => {
        open.length = 0;
        frames.length = 0;
        frames.push({ base: 0, reported: false });
        return true;
      },

      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,

      IfStatement: (node) => {
        if (!counts(node)) return;
        enter(node);
      },
      "IfStatement:exit": (node) => {
        if (!counts(node)) return;
        exit();
      },
      ForStatement: enter,
      "ForStatement:exit": exit,
      ForOfStatement: enter,
      "ForOfStatement:exit": exit,
      ForInStatement: enter,
      "ForInStatement:exit": exit,
      WhileStatement: enter,
      "WhileStatement:exit": exit,
      DoWhileStatement: enter,
      "DoWhileStatement:exit": exit,
      SwitchStatement: enter,
      "SwitchStatement:exit": exit,
      CatchClause: enter,
      "CatchClause:exit": exit,
    };
  },
});
