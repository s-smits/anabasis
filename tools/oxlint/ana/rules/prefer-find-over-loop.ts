import { defineRule, type ESTree, type Fix, type Fixer } from "@oxlint/plugins";
import { holdsProse } from "../shared/masked.ts";
import { asSubject, onlyStatement, statementBelow } from "../shared/statements.ts";

/**
 * Rung 4 of the simplify skill's ladder: the platform already owns this. A `for … of` whose
 * whole body is one conditional `return` of the element, or of a plain yes or no, is `find`,
 * `some` or `every` with the predicate written out long-hand around it.
 *
 *     for (const row of rows) if (row.runId === runId) return row;      // rows.find(…)
 *     for (const row of rows) if (!row.settled) return false;           // rows.every(…)
 *
 * The commit lane found four of the recorded simplify passes making this cut — `10cff319e`,
 * `9d05d17d0`, `7a4387da1` and `44213a5ff`, the last of which also turned `filter(p).at(-1)`
 * into `findLast`. `unicorn/prefer-array-find` is on the built-in list and reports a different
 * slice, `xs.filter(p)[0]`; it has nothing to say about a written-out loop.
 *
 * Five shapes keep their loop, each because the array method cannot express it. A body holding
 * `await` keeps it, because `find` takes no async predicate and `Promise.all` over the whole
 * array is a different program. A loop over an index or an entry pair keeps it, because the
 * predicate would have to reconstruct what the destructuring already gave it. A loop whose `if`
 * has an `else`, or whose body holds anything beside the conditional, is doing a second thing
 * the method has no room for.
 *
 * The last two came from the census the rule itself produced, where six of its eight sites were
 * asking for a spelling that does not exist (2026-09-20). A loop that returns something built
 * from the element keeps it: `case-record.ts` walks a key list and returns
 * `` `${key} must be a non-empty string` ``, so the rewrite is a `find` *and* a second statement,
 * which is not shorter and is not what the message promised. And a `Set` or a `Map` has no
 * `find` at all: `feedback-routing.ts` walks `BUILDER_OWNED`, which two lines above answers
 * `.has(owner)`. The rule reads both from the file — a name declared `new Set(…)` or `new Map(…)`,
 * or asked `.has(…)` anywhere in the same module, is not an array — so that the admission test
 * holds at every site it reports: the method is legal where the loop was, it is shorter, and no
 * other rule in this tree asks for a loop.
 *
 * It fixes what it reports, and the reason it once did not — "a fixer that guesses `find` where
 * the author wanted `some` would be rewriting the return type" — was never true of this rule:
 * `method` reads the answer off the `return`, and a loop returning the element cannot be `some`.
 *
 * What the fix does have to read is the statement the loop falls through to, because that is
 * where the two programs can part. `find` yields `undefined` on no match, `some` yields `false`
 * and `every` yields `true`, so each rewrite stands only where the line below already says the
 * same thing — or, for `find` alone, where the loop ends a function body and falling off it
 * yields `undefined` anyway. Anything else below the loop keeps it, since a rewrite there would
 * change what the function returns on no match.
 *
 * A loop whose match returns nothing is the exception, and it is also the shape the old message
 * described worst: `for (const row of rows) if (p(row)) return;` is not `rows.some(…)`, it is
 * `if (rows.some(…)) return;`, which is exact with nothing below it to check. It has its own
 * message for that reason.
 *
 * The loop and the line below it are edited separately rather than as one span, so a comment
 * between them survives; and `every` takes the test with its sense reversed, which is the `!`
 * dropped where the author wrote one and added around the whole test where they did not.
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

/** Whether the statement the loop falls through to already says what the method returns there. */
function agrees(method: string, next: ESTree.Statement): boolean {
  if (next.type !== "ReturnStatement") return false;
  const { argument } = next;
  if (method !== "find") {
    const wanted = method !== "some";
    return argument?.type === "Literal" && argument.value === wanted;
  }
  if (argument === undefined || argument === null) return true;
  return argument.type === "Identifier" && argument.name === "undefined";
}

export const preferFindOverLoopRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "A loop whose whole body is one conditional return is find, some or every." },
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
     *
     * Everything the method returns on no match is decided by the statement below, so that is
     * what this reads: a `find` needs `undefined` there or a function body ending, a `some`
     * needs `false` and an `every` needs `true`. The one shape with nothing to check is the
     * loop that returns nothing, which is a guard and is exact on its own.
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
