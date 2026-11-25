import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { importTracker } from "../shared/import-fix.ts";
import { withoutProse } from "../shared/masked.ts";
import {
  everyStatementList,
  identifierName,
  onlyStatement,
  plainAssignment,
  singleConst,
} from "../shared/statements.ts";

/**
 * Flags a `const` object literal immediately followed by `if (x !== undefined) o.k = x;` (or `!=
 * null` / `!== null`) guards, folding them into the literal via `...keyIfDefined("k", x)` or
 * `...keyIfNotNull("k", x)` from `src/meta/optional-key.ts`. A strict `!== null` guard is reported
 * without a fix, because folding also omits `undefined`.
 */
const OWNER = "src/meta/optional-key.ts";

type Helper = "keyIfDefined" | "keyIfNotNull";

interface Fold {
  readonly key: string;
  readonly value: string;
  readonly helper: Helper;
  readonly nullOnly: boolean;
}

function isRead(node: ESTree.Expression): boolean {
  if (node.type === "Identifier" || node.type === "ThisExpression") return true;
  if (node.type === "MemberExpression") {
    return (!node.computed || node.property.type === "Literal") && isRead(node.object);
  }
  if (node.type === "ChainExpression") {
    return node.expression.type === "MemberExpression" && isRead(node.expression);
  }
  if (node.type === "TSNonNullExpression" || node.type === "TSAsExpression") return isRead(node.expression);
  return false;
}

function guardTest(
  test: ESTree.Expression,
): { helper: Helper; guarded: ESTree.Expression; nullOnly: boolean } | null {
  if (test.type !== "BinaryExpression") return null;
  if (test.operator !== "!==" && test.operator !== "!=") return null;
  for (const [absent, guarded] of [
    [test.right, test.left],
    [test.left, test.right],
  ] as const) {
    const isUndefined = identifierName(absent) === "undefined";
    const isNull = absent.type === "Literal" && absent.value === null;
    if (!isUndefined && !isNull) continue;
    const helper = isUndefined && test.operator === "!==" ? "keyIfDefined" : "keyIfNotNull";
    return { helper, guarded, nullOnly: isNull && test.operator === "!==" };
  }
  return null;
}

export const preferKeyIfDefinedRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "A guard assigning one key after an object literal is keyIfDefined inside it.",
      examples: [
        {
          before:
            'const spawnOptions: SpawnOptions = { stdout: "pipe", stderr: "pipe" };\nif (options.cwd !== undefined) spawnOptions.cwd = options.cwd;\nspawn(command, spawnOptions);',
          after:
            'import { keyIfDefined } from "./meta/optional-key.ts";\nconst spawnOptions: SpawnOptions = { stdout: "pipe", stderr: "pipe", ...keyIfDefined("cwd", options.cwd) };\nspawn(command, spawnOptions);',
        },
        {
          before:
            "const row: Row = { task: task.id };\nif (solve.billed != null) row.billed = solve.billed;\nrows.push(row);",
          after:
            'import { keyIfNotNull } from "./meta/optional-key.ts";\nconst row: Row = { task: task.id, ...keyIfNotNull("billed", solve.billed) };\nrows.push(row);',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      guardedAfterLiteral:
        '`{{name}}` is built and then given {{count}} key{{plural}} under a guard, so its shape is decided over several statements. `...keyIfDefined("k", value)` in the literal makes the same decision where the object is built; `src/meta/optional-key.ts` owns it.',
    },
  },
  createOnce(context) {
    const imports = importTracker("optional-key.ts", OWNER);
    const reads = (name: string, source: string): boolean =>
      new RegExp(String.raw`(?<![.\w$])${name}(?![\w$])`, "u").test(withoutProse(source));

    function foldOf(node: ESTree.Statement, name: string): Fold | null {
      if (node.type !== "IfStatement" || node.alternate !== null) return null;
      const test = guardTest(node.test);
      if (test === null || !isRead(test.guarded)) return null;
      const expression = plainAssignment(onlyStatement(node.consequent));
      if (expression === null) return null;
      if (context.sourceCode.getCommentsInside(node).length > 0) return null;
      const { left, right } = expression;
      if (left.type !== "MemberExpression" || left.computed || left.object.type !== "Identifier") return null;
      if (left.object.name !== name || left.property.type !== "Identifier") return null;
      const guarded = context.sourceCode.getText(test.guarded);
      if (reads(name, guarded)) return null;
      // The value may carry a cast the test did not need; the cast travels into the spread.
      const bare =
        right.type === "TSAsExpression" || right.type === "TSNonNullExpression" ? right.expression : right;
      if (context.sourceCode.getText(bare) !== guarded) return null;
      return {
        key: left.property.name,
        value: context.sourceCode.getText(right),
        helper: test.helper,
        nullOnly: test.nullOnly,
      };
    }

    function wholeLine(node: ESTree.Node): [number, number] {
      const { text } = context.sourceCode;
      const lineStart = text.lastIndexOf("\n", node.start - 1) + 1;
      const lineEnd = text.indexOf("\n", node.end);
      const start = text.slice(lineStart, node.start).trim() === "" ? lineStart : node.start;
      const end = lineEnd !== -1 && text.slice(node.end, lineEnd).trim() === "" ? lineEnd + 1 : node.end;
      return [start, end];
    }

    /** Stops at the first statement that is neither a folding guard nor an inlined const. */
    function runBelow(body: readonly ESTree.Statement[], index: number, name: string) {
      const folds: Fold[] = [];
      const removed: ESTree.Statement[] = [];
      const inlined = new Map<string, string>();
      const below = body.slice(index + 1);
      for (const [at, statement] of below.entries()) {
        const fold = foldOf(statement, name);
        if (fold !== null) {
          const value = inlined.get(fold.value);
          folds.push(value === undefined ? fold : { ...fold, value });
          removed.push(statement);
          continue;
        }
        const local = singleConst(statement);
        const init = local?.declared.init;
        const next = below[at + 1];
        if (local === null || init == null || next === undefined) break;
        if (reads(name, context.sourceCode.getText(init))) break;
        // The const is folded only when the guard directly below it is its one reader.
        const guard = foldOf(next, name);
        if (guard === null || guard.value !== local.name) break;
        const rest = below
          .slice(at + 2)
          .map((one) => context.sourceCode.getText(one))
          .join("\n");
        if (reads(local.name, rest)) break;
        inlined.set(local.name, context.sourceCode.getText(init));
        removed.push(statement);
      }
      return { folds, removed };
    }

    function scan(body: readonly ESTree.Statement[]): void {
      for (const [index, statement] of body.entries()) {
        const target = singleConst(statement);
        const literal = target?.declared.init;
        if (target === null || literal?.type !== "ObjectExpression") continue;
        const { folds, removed } = runBelow(body, index, target.name);
        if (folds.length === 0) continue;
        const spreads = folds.map((fold) => `...${fold.helper}("${fold.key}", ${fold.value})`);
        const last = literal.properties.at(-1);
        const helpers = [...new Set(folds.map((fold) => fold.helper))];
        context.report({
          node: statement,
          messageId: "guardedAfterLiteral",
          data: { name: target.name, count: String(folds.length), plural: folds.length === 1 ? "" : "s" },
          fix: (fixer) =>
            folds.some((fold) => fold.nullOnly)
              ? null
              : [
                  last === undefined
                    ? fixer.replaceText(literal, `{ ${spreads.join(", ")} }`)
                    : fixer.insertTextAfter(last, spreads.map((spread) => `, ${spread}`).join("")),
                  ...removed.map((node) => fixer.replaceTextRange(wholeLine(node), "")),
                  imports.fix(fixer, helpers, context.filename),
                ],
        });
      }
    }

    const lists = everyStatementList(scan);
    return {
      ...lists,
      Program(node) {
        imports.read(node);
        lists.Program(node);
      },
    };
  },
});
