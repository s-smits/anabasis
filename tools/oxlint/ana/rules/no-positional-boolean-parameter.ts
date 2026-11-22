import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isTestFile } from "../shared/file-role.ts";
import { flagBinding } from "../shared/flags.ts";
import { identifierName } from "../shared/statements.ts";

/** The function a parameter list belongs to: a declaration, an expression or an arrow. */
type Owner = ESTree.Function | ESTree.ArrowFunctionExpression;

/** `[]`, `{}`, `null` or `undefined`: an arm that yields nothing. */
function yieldsNothing(node: ESTree.Node): boolean {
  if (node.type === "ArrayExpression") return node.elements.length === 0;
  if (node.type === "ObjectExpression") return node.properties.length === 0;
  if (node.type === "Literal") return node.value === null;
  return node.type === "Identifier" && node.name === "undefined";
}

/** Whether this read of the boolean is the test of a conditional one of whose arms yields nothing. */
function gatesYield(read: ESTree.Node): boolean {
  const { parent } = read;
  if (parent?.type !== "ConditionalExpression" || parent.test !== read) return false;
  return yieldsNothing(parent.consequent) || yieldsNothing(parent.alternate);
}

/**
 * Flags boolean parameters (`boolean`, `true | false`, or defaulted to `true`/`false`) on
 * functions, methods, and declarations, preferring a two-element string-literal union at the call
 * site. Uncalled non-exported callbacks, `asserts` type guards, module-local functions whose callers
 * always pass an identifier/member matching the parameter name, and parameters that only gate
 * whether a conditional yields a value vs nothing (`gatesYield`) are exempt. There is no fix.
 */
export const noPositionalBooleanParameterRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Name the two states with a string-literal union instead of a boolean parameter.",
      examples: [
        {
          before:
            'export function closeLifetime(lifetime: Lifetime, failed: boolean) {\n  lifetime.close(failed ? "failed" : "clean");\n}',
          after:
            'export function closeLifetime(lifetime: Lifetime, outcome: "failed" | "clean") {\n  lifetime.close(outcome);\n}',
        },
        {
          before:
            "export function writeReport(report: Report, verbose: boolean) {\n  if (verbose) print(report.lines);\n  save(report);\n}",
          after:
            'export function writeReport(report: Report, detail: "verbose" | "quiet") {\n  if (detail === "verbose") print(report.lines);\n  save(report);\n}',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      opaqueAtCallSite:
        "`{{fn}}({{name}}: boolean)` reads as `{{fn}}({{call}})` at the call site, which names neither the parameter nor the state. Take a union of two string literals that say what the two states are.",
    },
  },
  createOnce(context) {
    /**
     * Whether every call this file can see passes an identifier of the parameter's own name at
     * that position, so the call site already reads as the declaration does. Null when the calls
     * are not all in view: a declaration with no visible call, or one reached through anything
     * other than a plain named call, is answered by the caller this rule cannot read.
     */
    function namedAtEveryCall(declaring: ESTree.Node, fn: string, index: number, name: string): boolean {
      const declared = context.sourceCode
        .getDeclaredVariables(declaring)
        .find((variable) => variable.name === fn);
      if (declared === undefined) return false;
      const calls = declared.references
        .filter((reference) => reference.isRead())
        .map((reference) => reference.identifier.parent);
      if (calls.length === 0) return false;
      return calls.every((call) => {
        if (call.type !== "CallExpression") return false;
        const argument = call.arguments[index];
        if (argument === undefined) return false;
        if (argument.type === "Identifier") return argument.name === name;
        // `submitted()` reads at the call site exactly as `submitted` does. A reader of
        // `completedOutcome(…, submitted(), condition)` is told which state is being passed and
        // where it came from, which is the whole of what this rule asks for.
        // `solvedCase.acceptedSubmit` names the state and, one word more than the bare
        // identifier does, where it came from. A computed access names nothing at the call site.
        if (argument.type === "MemberExpression") {
          return (
            !argument.computed && argument.property.type === "Identifier" && argument.property.name === name
          );
        }
        return (
          argument.type === "CallExpression" &&
          argument.arguments.length === 0 &&
          argument.callee.type === "Identifier" &&
          argument.callee.name === name
        );
      });
    }

    /** Whether this file only hands the function on as an argument, so that whatever it is handed
     *  to calls it with the data and no call site here passes a bare `true`. */
    function handedOnOnly(declaring: ESTree.Node, fn: string): boolean {
      const reads = context.sourceCode
        .getDeclaredVariables(declaring)
        .find((variable) => variable.name === fn)
        ?.references.filter((reference) => reference.isRead());
      if (reads === undefined || reads.length === 0) return false;
      return reads.every(({ identifier }) => {
        const { parent } = identifier;
        const called = parent.type === "CallExpression" || parent.type === "NewExpression";
        return called && parent.arguments.some((argument) => argument === identifier);
      });
    }

    /** Whether every read of the boolean in `owner` decides only whether it yields anything. */
    function gatesItsYield(owner: Owner, name: string): boolean {
      const variable = context.sourceCode
        .getDeclaredVariables(owner)
        .find((declared) => declared.name === name);
      const reads = variable?.references.filter((reference) => reference.isRead()) ?? [];
      return reads.length > 0 && reads.every((reference) => gatesYield(reference.identifier));
    }

    function report(declaring: ESTree.Node | null, fn: string, owner: Owner): void {
      const parameters = owner.params;
      const returns = owner.returnType ?? null;
      // `asserts x` and `x is T` name a parameter TypeScript narrows on; it has to stay boolean.
      if (returns?.type === "TSTypeAnnotation" && returns.typeAnnotation.type === "TSTypePredicate") return;
      for (const [index, parameter] of parameters.entries()) {
        // A destructured parameter is a different shape, and reads as none.
        const binding = flagBinding(parameter);
        if (binding === null) continue;
        if (gatesItsYield(owner, binding.name)) continue;
        if (declaring !== null && namedAtEveryCall(declaring, fn, index, binding.name)) continue;
        // The call as a reader meets it: `fn(true)` for a lone parameter, `fn(…, true)` for a last.
        const call = [index > 0 ? "…" : [], "true", index < parameters.length - 1 ? "…" : []].flat();
        context.report({
          node: parameter,
          messageId: "opaqueAtCallSite",
          data: { fn, name: binding.name, call: call.join(", ") },
        });
      }
    }

    return {
      // A test states both arguments beside each other and reads them together; the opacity this
      // rule is about is a caller in another file.
      before: () => !isTestFile(context.filename),

      // An exported declaration arrives wrapped, so its own node is not the module-scope statement
      // and its callers are in other files: it never takes the call-site exemption.
      FunctionDeclaration: (node) => {
        const fn = node.id === null ? "this function" : node.id.name;
        if (!node.parent.type.startsWith("Export") && handedOnOnly(node, fn)) return;
        report(node.parent.type === "Program" ? node : null, fn, node);
      },
      // A method is reached through a value, not a name this rule can resolve.
      MethodDefinition: (node) => {
        if (node.key.type !== "Identifier") return;
        report(null, node.key.name, node.value);
      },
      // `const close = (handle: string, failed: boolean) => …` declares as a function does; one
      // inside an export list or another statement has callers this rule never sees.
      VariableDeclarator: (node) => {
        const { id, init } = node;
        const callable = init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression";
        if (id.type !== "Identifier" || !callable) return;
        const exported = node.parent.parent?.type.startsWith("Export") === true;
        if (!exported && handedOnOnly(node, id.name)) return;
        report(node.parent.parent?.type === "Program" ? node : null, id.name, init);
      },
      TSDeclareFunction: (node) => report(null, identifierName(node.id) ?? "this function", node),
      TSAbstractMethodDefinition: (node) =>
        report(null, identifierName(node.key) ?? "this method", node.value),
    };
  },
});
