import { defineRule, type ESTree, type Fix, type Fixer } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { holdsProse } from "../shared/masked.ts";
import { asSubject, identifierName, onlyStatement, statementBelow } from "../shared/statements.ts";

/**
 * Rung 4 of the simplify ladder: flags a `for...of` loop over an array (excluding `string`, `Set`,
 * `Map`, and `Iterable` bindings) whose sole body statement is `if (test) return <element | true | false | void>`
 * when the fallthrough statement returns the matching default (`undefined`, `false`, or `true`).
 * Auto-fixes into `.find()`, `.some()`, `.every()`, or `if (xs.some(...)) return;`.
 */
/** What a loop that is a search hands back, and everything the rewrite needs to replace it. */
interface Search {
  readonly node: ESTree.ForOfStatement;
  readonly subject: string;
  readonly method: string;
  readonly element: string;
  readonly test: ESTree.Expression;
  readonly answer: ESTree.Expression | null;
}

/** Node types whose body falling through to its end yields `undefined`, as `find` does. */
const FUNCTION_BODIES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** What a binding may be annotated as and still be walked by `for…of` with no `find` to call. */
const UNSEARCHABLE = new Set([
  "string",
  "Set",
  "ReadonlySet",
  "Map",
  "ReadonlyMap",
  "Iterable",
  "IterableIterator",
]);

/** Whether the statement the loop falls through to already says what the method returns there. */
function agrees(method: string, next: ESTree.Statement): boolean {
  if (next.type !== "ReturnStatement") return false;
  const { argument } = next;
  if (method !== "find") {
    const wanted = method !== "some";
    return argument?.type === "Literal" && argument.value === wanted;
  }
  if (argument === undefined || argument === null) return true;
  return identifierName(argument) === "undefined";
}

/**
 * What a binding's own annotation says it holds, read without types: `string`, or the name of the
 * type reference it is annotated with (`ReadonlySet`, `MapIterator`), or null for anything else.
 */
function annotatedKind(node: ESTree.BindingIdentifier): string | null {
  const type = node.typeAnnotation?.typeAnnotation;
  if (type === undefined) return null;
  if (type.type === "TSStringKeyword") return "string";
  if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return null;
  return type.typeName.name;
}

export const preferFindOverLoopRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "A loop whose whole body is one conditional return is find, some or every.",
      examples: [
        {
          before:
            "function runOf(rows: readonly Row[], runId: string): Row | undefined {\n  for (const row of rows) if (row.runId === runId) return row;\n}",
          after:
            "function runOf(rows: readonly Row[], runId: string): Row | undefined {\n  return rows.find((row) => row.runId === runId);\n}",
        },
        {
          before:
            "function allSettled(rows: readonly Row[]): boolean {\n  for (const row of rows) if (!row.settled) return false;\n  return true;\n}",
          after:
            "function allSettled(rows: readonly Row[]): boolean {\n  return rows.every((row) => row.settled);\n}",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      writtenOut:
        "This loop is `{{subject}}.{{method}}(…)` written out. The platform owns the search; the loop only spells the predicate over three lines instead of one.",
      guard:
        "This loop is `if ({{subject}}.some(…)) return;` written out. The platform owns the search; the loop only spells the predicate over three lines instead of one.",
    },
  },
  createOnce(context) {
    /** Names this file shows to be a keyed collection, which has no `find`. */
    let keyed = new Set<string>();
    /** Loops that are a search, held until the whole file has been read for keyed names. */
    let found: Search[] = [];

    /** Which array method the returned value names, read off the return alone. */
    function method(argument: ESTree.Expression | null): string {
      if (argument === null) return "some";
      if (argument.type === "Literal" && argument.value === true) return "some";
      if (argument.type === "Literal" && argument.value === false) return "every";
      return "find";
    }

    /**
     * Whether the loop hands back the element itself or a plain yes or no, which is the whole of
     * what `find`, `some` and `every` return. Anything else needs the method and a statement.
     */
    function handsBack(argument: ESTree.Expression | null, element: string): boolean {
      if (argument === null) return true;
      if (argument.type === "Literal" && (argument.value === true || argument.value === false)) return true;
      return argument.type === "Identifier" && argument.name === element;
    }

    /**
     * The edits that put the method where the loop stands, or null where the two would differ.
     */
    function rewrite(fixer: Fixer, search: Search): Fix[] | null {
      // The loop's own body becomes an arrow, and a sentence written inside it would have to be
      // placed in that expression. That is a layout decision, so the rule reports and stops.
      if (holdsProse(context.sourceCode.getAllComments(), search.node.start, search.node.end)) return null;
      const test = context.sourceCode.getText(search.test);
      const reversed =
        search.test.type === "UnaryExpression" && search.test.operator === "!"
          ? context.sourceCode.getText(search.test.argument)
          : `!(${test})`;
      const call = `${search.subject}.${search.method}((${search.element}) => ${search.method === "every" ? reversed : test})`;
      if (search.answer === null) return [fixer.replaceText(search.node, `if (${call}) return;`)];

      const next = statementBelow(search.node);
      if (next === null) {
        const holder = search.node.parent?.parent ?? null;
        const ends = holder !== null && FUNCTION_BODIES.has(holder.type);
        return ends && search.method === "find" ? [fixer.replaceText(search.node, `return ${call};`)] : null;
      }
      if (!agrees(search.method, next)) return null;
      // Two edits rather than one span, so a comment written between them stays where it is.
      return [fixer.replaceText(search.node, `return ${call};`), fixer.remove(next)];
    }

    return {
      before: () => {
        keyed = new Set<string>();
        found = [];
        return true;
      },

      NewExpression(node) {
        if (node.callee.type !== "Identifier" || (node.callee.name !== "Set" && node.callee.name !== "Map")) {
          return;
        }
        const declarator = node.parent;
        if (declarator.type !== "VariableDeclarator" || declarator.id.type !== "Identifier") return;
        keyed.add(declarator.id.name);
      },

      Identifier(node) {
        const kind = annotatedKind(node);
        if (kind !== null && UNSEARCHABLE.has(kind)) keyed.add(node.name);
      },

      MemberExpression(node) {
        if (node.computed || node.object.type !== "Identifier") return;
        if (node.property.type === "Identifier" && node.property.name === "has") keyed.add(node.object.name);
      },

      ForOfStatement(node) {
        // The predicate takes the element, so a loop that destructures an entry pair or walks an
        // index has already done work `find` would have to undo.
        if (node.left.type !== "VariableDeclaration") return;
        const [binding] = node.left.declarations;
        if (binding?.id.type !== "Identifier") return;

        const body = onlyStatement(node.body);
        if (body?.type !== "IfStatement" || body.alternate !== null) return;
        const consequent = onlyStatement(body.consequent);
        if (consequent?.type !== "ReturnStatement") return;
        if (!handsBack(consequent.argument ?? null, binding.id.name)) return;

        // `find` takes no async predicate, and awaiting inside one is a different program.
        if (/\bawait\b/u.test(context.sourceCode.getText(node))) return;

        found.push({
          node,
          subject: asSubject(node.right, context.sourceCode.getText(node.right)),
          method: method(consequent.argument ?? null),
          element: context.sourceCode.getText(binding.id),
          test: body.test,
          answer: consequent.argument ?? null,
        });
      },

      "Program:exit": () => {
        for (const search of found) {
          if (keyed.has(search.subject)) continue;
          context.report({
            node: search.node,
            messageId: search.answer === null ? "guard" : "writtenOut",
            data: { subject: search.subject, method: search.method },
            fix: (fixer) => rewrite(fixer, search),
          });
        }
      },
    };
  },
});
