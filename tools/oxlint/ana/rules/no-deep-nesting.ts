import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

/**
 * Flags statements nested four or more levels deep (`DEPTH_LIMIT = 4`) inside a function body.
 * `try` and `finally` blocks, `else if` chains, `switch` cases (counted once at the `switch`),
 * and non-branching guard `if`s ending in `return`/`continue`/`break`/`throw` within
 * `GUARD_STATEMENTS` (3) statements do not add a nesting level. Nested functions reset the count.
 * There is no fix.
 */

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
    docs: {
      description: "A statement nested four deep asks the reader to hold four conditions.",
      examples: [
        {
          before:
            "function saveDirty(rows: Row[]) {\n  for (const row of rows)\n    if (row.open)\n      for (const cell of row.cells)\n        if (cell.dirty) save(cell);\n}",
          after:
            "function saveDirty(rows: Row[]) {\n  const cells = rows.filter((row) => row.open).flatMap((row) => row.cells);\n  for (const cell of cells) if (cell.dirty) save(cell);\n}",
        },
        {
          before:
            "function settle(run: Run) {\n  if (run.ended)\n    if (run.report !== null)\n      for (const row of run.report.rows)\n        if (row.failed) retry(row);\n}",
          after:
            "function settle(run: Run) {\n  if (!run.ended || run.report === null) return;\n  for (const row of run.report.rows) if (row.failed) retry(row);\n}",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      tooDeep:
        "This statement sits {{depth}} levels inside its function, so reaching it means holding {{depth}} conditions at once. A guard that returns or continues removes one level for a line; a body doing two things is two functions; a loop inside a loop is often one `.flatMap()`.",
    },
  },
  createOnce(context) {
    /** Nesting levels open at this point, innermost last; each function counts from its frame's `base`. */
    const open: ESTree.Node[] = [];
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
