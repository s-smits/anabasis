import { defineRule, type ESTree } from "@oxlint/plugins";
import { importTracker } from "../shared/import-fix.ts";
import { withoutProse } from "../shared/masked.ts";
import { everyStatementList, onlyStatement, singleConst } from "../shared/statements.ts";

/**
 * An object literal followed by `if (x !== undefined) o.k = x;` is one literal with the key
 * folded in:
 *
 *     const spawnOptions: SpawnOptions = { stdout: "pipe", stderr: "pipe" };
 *     if (options.cwd !== undefined) spawnOptions.cwd = options.cwd;
 *     if (options.env !== undefined) spawnOptions.env = options.env;
 *
 *     const spawnOptions: SpawnOptions = {
 *       stdout: "pipe",
 *       stderr: "pipe",
 *       ...keyIfDefined("cwd", options.cwd),
 *       ...keyIfDefined("env", options.env),
 *     };
 *
 * The guard exists because `exactOptionalPropertyTypes` refuses `cwd: options.cwd` when the
 * value may be undefined, and `src/meta/optional-key.ts` is the owner of that refusal: it holds
 * the two helpers, `keyIfDefined` and `keyIfNotNull`, and 290 call sites already spell the fold
 * through them. The guarded assignment is the same decision made after the literal instead of in
 * it, with the object's shape spread over as many statements as it has optional keys. Two
 * simplify passes made exactly this fold by hand, `743608504` and `421533e8f`, and the tree held
 * 26 more of them on 2026-09-20.
 *
 * The shape is read strictly, because the fold moves an evaluation. A run of guards directly
 * below a `const` whose initialiser is an object literal; each guard has no `else`, tests one
 * expression against `undefined` or `null`, and assigns that same expression to one static key
 * of that same `const`. The expression must be a read — a name, a member chain, `this.x`, a
 * non-null or `as` over one of those — so that evaluating it inside the literal rather than after
 * it changes nothing, and it must not read the object it is folded into, since the binding is
 * not initialised yet inside its own literal. A `const x = …;` between the literal and a guard
 * over `x` is inlined when nothing else reads `x`; the literal's own properties have already
 * been evaluated when the appended spread runs, so the call keeps its place in the order. Any
 * other statement, and a guard whose block carries a comment, ends the run.
 *
 * Which helper is which: `!== undefined` is `keyIfDefined`, which omits undefined alone; `!==
 * null`, `!= null` and `!= undefined` are `keyIfNotNull`, which omits both. A `!== null` guard
 * over a value that may also be undefined would have assigned that undefined, and the fold does
 * not; under `exactOptionalPropertyTypes` that assignment is the compile error the guard was
 * avoiding, so the difference is a program that did not compile.
 *
 * It fixes. The rewrite is the owner's own spelling, the import edit rides with it, and every
 * removed statement is a whole line.
 */
const OWNER = "src/meta/optional-key.ts";

type Helper = "keyIfDefined" | "keyIfNotNull";

/** One folded guard: the key it wrote, the value expression as source, and the helper that omits it. */
interface Fold {
  readonly key: string;
  readonly value: string;
  readonly helper: Helper;
}

/** Whether `node` only reads: a name, a member chain, `this`, or a cast over one of those. */
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

/** The helper a `!== undefined` / `!= null` test names, and the side it guards; null otherwise. */
function guardTest(test: ESTree.Expression): { helper: Helper; guarded: ESTree.Expression } | null {
  if (test.type !== "BinaryExpression") return null;
  if (test.operator !== "!==" && test.operator !== "!=") return null;
  for (const [absent, guarded] of [
    [test.right, test.left],
    [test.left, test.right],
  ] as const) {
    const isUndefined = absent.type === "Identifier" && absent.name === "undefined";
    const isNull = absent.type === "Literal" && absent.value === null;
    if (!isUndefined && !isNull) continue;
    const helper = isUndefined && test.operator === "!==" ? "keyIfDefined" : "keyIfNotNull";
    return { helper, guarded };
  }
  return null;
}

export const preferKeyIfDefinedRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "A guard assigning one key after an object literal is keyIfDefined inside it." },
    messages: {
      guardedAfterLiteral:
        '`{{name}}` is built and then given {{count}} key{{plural}} under a guard, so its shape is decided over several statements. `...keyIfDefined("k", value)` in the literal makes the same decision where the object is built; `src/meta/optional-key.ts` owns it.',
    },
  },
  createOnce(context) {
    const imports = importTracker("optional-key.ts", OWNER);
    const reads = (name: string, source: string): boolean =>
      new RegExp(String.raw`(?<![.\w$])${name}(?![\w$])`, "u").test(withoutProse(source));

    /** The fold an `if` over `name.k` is, or null when the statement is anything else. */
    function foldOf(node: ESTree.Statement, name: string): Fold | null {
      if (node.type !== "IfStatement" || node.alternate !== null) return null;
      const test = guardTest(node.test);
      if (test === null || !isRead(test.guarded)) return null;
      const statement = onlyStatement(node.consequent);
      if (statement?.type !== "ExpressionStatement") return null;
      if (context.sourceCode.getCommentsInside(node).length > 0) return null;
      const { expression } = statement;
      if (expression.type !== "AssignmentExpression" || expression.operator !== "=") return null;
      const { left, right } = expression;
      if (left.type !== "MemberExpression" || left.computed || left.object.type !== "Identifier") return null;
      if (left.object.name !== name || left.property.type !== "Identifier") return null;
      const guarded = context.sourceCode.getText(test.guarded);
      if (reads(name, guarded)) return null;
      // The value may carry a cast the test did not need; the cast travels into the spread.
      const bare =
        right.type === "TSAsExpression" || right.type === "TSNonNullExpression" ? right.expression : right;
      if (context.sourceCode.getText(bare) !== guarded) return null;
      return { key: left.property.name, value: context.sourceCode.getText(right), helper: test.helper };
    }

    /** The start of `node`'s line through its newline, when the line holds nothing else. */
    function wholeLine(node: ESTree.Node): [number, number] {
      const { text } = context.sourceCode;
      const lineStart = text.lastIndexOf("\n", node.start - 1) + 1;
      const lineEnd = text.indexOf("\n", node.end);
      const start = text.slice(lineStart, node.start).trim() === "" ? lineStart : node.start;
      const end = lineEnd !== -1 && text.slice(node.end, lineEnd).trim() === "" ? lineEnd + 1 : node.end;
      return [start, end];
    }

    /**
     * The guards below `body[index]` that fold into its literal, with the inlined consts among
     * them. Stops at the first statement that is neither.
     */
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
          fix: (fixer) => [
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
