import { defineRule, type ESTree } from "@oxlint/plugins";

/**
 * `export function resolveRunTarget(folder, explicitRun = null)` in a `.mjs` file does not declare
 * a nullable parameter. It declares `null`, the type with one value, because a default is the only
 * type information an unchecked JavaScript file carries and there is no annotation to say
 * otherwise. Everything downstream follows from that: a caller passing a run id passes a value the
 * parameter does not admit and nothing says so, `explicitRun !== null` is a comparison the checker
 * can only answer one way, and every type-aware rule that asks about the value is told about
 * `null`.
 *
 * That is not a hypothesis. Three `.mjs` sites — `archive-shape.mjs`, `manifest-compose.mjs` and
 * `zip-run.mjs` — took a `RegExp` on a parameter defaulted to `null`, and the branch that used it
 * was unreachable for the whole of the checker's reading; the strict-boolean pass found them
 * because a condition over that parameter had become constant. One `@param` restored each. This
 * rule is that reading made cheap, and it needs no types of its own to do it: the defect is
 * visible in the syntax, which is why it can run where the type-aware rules are least useful.
 *
 * An object literal held in a variable has the same shape. `const values = { campaigns: null };`
 * followed by `values.campaigns = value` types the property as `null` and makes the assignment
 * invisible, so `values.campaigns === null` is again a comparison with one answer. Only a property
 * the same file assigns is reported: a record whose `null` is the value it keeps is exactly typed
 * already. Either declaration answers it — a `@type` over the whole literal, or a cast on the one
 * value. The cast is the form that scales: for a settings record of twelve properties of which
 * five are `null`, annotating the object would mean restating the seven the author never had to
 * write down.
 *
 * A TypeScript file is not reported. It can annotate, and the two `.ts` parameters that looked
 * like this shape — `toolTree = null` in `built-bash.ts` and `publicArtifactSchema = null` in
 * `built-starter.ts` — are destructured out of an annotated options type, which is where their
 * types come from.
 *
 * The JSDoc test is deliberately loose: a block that opens a `@param {` or `@type {` and mentions
 * the name counts as typed. A tighter reading would have to parse nested brace types to admit
 * `@param {{terminal: Terminal|null}} [options]`, and an author who names the parameter inside a
 * type tag has answered the question this rule asks.
 *
 * There is no fix: the missing annotation is the finding. A fixer could only write `null`, which
 * is what the initialiser already says.
 */
const UNCHECKED_SUFFIXES = [".js", ".mjs", ".cjs"];

/** The statement a JSDoc block would sit before. `export`, `const add = (…) =>` and an object
 *  property each put the function one or more levels inside the statement a reader comments. */
const WRAPPERS = new Set([
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "VariableDeclarator",
  "VariableDeclaration",
  "Property",
  "PropertyDefinition",
  "MethodDefinition",
  "ExpressionStatement",
  "AssignmentExpression",
]);

/** A default that admits no value other than itself. `undefined` arrives as an identifier. */
function admitsNothingElse(right: ESTree.Node): boolean {
  if (right.type === "Identifier") return right.name === "undefined";
  return right.type === "Literal" && right.raw === "null";
}

/** The properties of an object literal whose declared value is the one-value type, by name. */
function nullProperties(literal: ESTree.ObjectExpression): Map<string, ESTree.ObjectProperty> {
  const found = new Map<string, ESTree.ObjectProperty>();
  for (const property of literal.properties) {
    if (property.type !== "Property" || property.computed || property.key.type !== "Identifier") continue;
    if (admitsNothingElse(property.value)) found.set(property.key.name, property);
  }
  return found;
}

/** The property a write to the object names: `values.campaign = value` gives `campaign`, and a
 *  read, a computed key or any other use of the binding gives nothing. */
function assignedName(identifier: ESTree.Node): string | null {
  const member = identifier.parent;
  if (member?.type !== "MemberExpression" || member.computed) return null;
  if (member.parent.type !== "AssignmentExpression" || member.parent.left !== member) return null;
  return member.property.type === "Identifier" ? member.property.name : null;
}

export const requireTypeForNullDefaultRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Declare the type of a JavaScript binding whose only type is a `null` default." },
    messages: {
      onlyNull:
        "`{{name}} = {{value}}` is the only type information this parameter has, so the checker reads its type as `{{value}}` and every other value a caller passes is invisible. Declare it with a JSDoc `@param`.",
      onlyNullProperty:
        "`{{name}}: {{value}}` is the only type information this property has, and this file assigns it something else, which the checker cannot see. Declare it: a JSDoc `@type` on the object, or a cast on this value.",
    },
  },
  createOnce(context) {
    /** Whether a cast sits on the property's own value, which is the local way to declare one
     *  property of a literal without restating its siblings. */
    function cast(property: ESTree.Node): boolean {
      return context.sourceCode.getCommentsInside(property).some((c) => /@type\s*\{/u.test(c.value));
    }

    /** Whether a JSDoc block before the declaration puts this name inside a type tag. */
    function documented(node: ESTree.Node, name: string): boolean {
      let outer: ESTree.Node = node;
      while (outer.parent != null && WRAPPERS.has(outer.parent.type)) outer = outer.parent;
      const comments = [
        ...context.sourceCode.getCommentsBefore(node),
        ...(outer === node ? [] : context.sourceCode.getCommentsBefore(outer)),
      ];
      return comments.some(
        (comment) => /@(?:param|type)\s*\{/u.test(comment.value) && comment.value.includes(name),
      );
    }

    /** Every binding a parameter list introduces that carries a default, including the ones a
     *  destructuring pattern introduces: `function campaign({ terminal = null } = {})`. */
    function defaulted(pattern: ESTree.Node): ESTree.Node[] {
      if (pattern.type === "AssignmentPattern") return [pattern, ...defaulted(pattern.left)];
      if (pattern.type === "ObjectPattern") {
        return pattern.properties.flatMap((property) => defaulted(property));
      }
      if (pattern.type === "ArrayPattern") {
        return pattern.elements.flatMap((element) => (element === null ? [] : defaulted(element)));
      }
      if (pattern.type === "Property") return defaulted(pattern.value);
      if (pattern.type === "RestElement") return defaulted(pattern.argument);
      return [];
    }

    function reportParameters(node: { params: readonly ESTree.Node[] } & ESTree.Node): void {
      for (const parameter of node.params) {
        for (const assignment of defaulted(parameter)) {
          if (assignment.type !== "AssignmentPattern") continue;
          if (assignment.left.type !== "Identifier") continue;
          if (!admitsNothingElse(assignment.right)) continue;
          const name = assignment.left.name;
          if (documented(node, name)) continue;
          context.report({
            node: assignment,
            messageId: "onlyNull",
            data: { name, value: context.sourceCode.getText(assignment.right) },
          });
        }
      }
    }

    return {
      before: () => UNCHECKED_SUFFIXES.some((suffix) => context.filename.endsWith(suffix)),

      FunctionDeclaration: reportParameters,
      FunctionExpression: reportParameters,
      ArrowFunctionExpression: reportParameters,

      // `const values = { campaigns: null }` beside `values.campaigns = value`, which the checker
      // reads as an assignment of `string` to `null` and, in an unchecked file, says nothing about.
      VariableDeclarator: (node) => {
        if (node.init?.type !== "ObjectExpression" || node.id.type !== "Identifier") return;
        const nulls = nullProperties(node.init);
        if (nulls.size === 0) return;
        const binding = node.id.name;
        const declared = context.sourceCode
          .getDeclaredVariables(node)
          .find((variable) => variable.name === binding);
        for (const reference of declared?.references ?? []) {
          const written = assignedName(reference.identifier);
          if (written === null) continue;
          const property = nulls.get(written);
          if (property === undefined || documented(node, written) || cast(property)) continue;
          nulls.delete(written);
          context.report({
            node: property,
            messageId: "onlyNullProperty",
            data: { name: written, value: context.sourceCode.getText(property.value) },
          });
        }
      },
    };
  },
});
