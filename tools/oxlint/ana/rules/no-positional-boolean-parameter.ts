import { defineRule, type ESTree } from "@oxlint/plugins";
import { isTestFile } from "../shared/file-role.ts";

/** `name()`, alone or as the one statement returned, run or held in a block. */
function callsOnly(node: ESTree.Node, name: string): boolean {
  if (node.type === "BlockStatement") {
    const [only] = node.body;
    return node.body.length === 1 && only !== undefined && callsOnly(only, name);
  }
  if (node.type === "ReturnStatement") return node.argument !== null && callsOnly(node.argument, name);
  if (node.type === "ExpressionStatement") return callsOnly(node.expression, name);
  return node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === name;
}

/** Whether this read of the boolean is the test of a conditional whose consequent calls `name`. */
function guardsCallOf(read: ESTree.Node, name: string): boolean {
  const { parent } = read;
  if (parent?.type !== "ConditionalExpression" && parent?.type !== "IfStatement") return false;
  return parent.test === read && callsOnly(parent.consequent, name);
}

/**
 * `closeVerifierLifetime(lifetime, true)` does not say what is true. The declaration says
 * `failed: boolean`, so the reader has to open it, and the two call sites that pass the wrong way
 * round read exactly like the two that pass it right.
 *
 * A union of two string literals fixes that at the call site without moving anything:
 * `closeVerifierLifetime(lifetime, "failed")` against `"clean"`. The compiler still rejects every
 * other value, the argument still costs nothing, and `if (outcome === "failed")` reads as the
 * sentence it is. An options object would do the same job, which is why other languages reach for
 * keyword arguments here, but `anti-slop/no-object-parameters` refuses one and is right to: a bag
 * of optional fields hides the same question one level further in.
 *
 * Only a declaration is reported. A callback's parameter type is written by whoever declared the
 * signature it satisfies, and renaming it there changes nothing for a reader.
 *
 * An assertion or guard keeps its boolean. `judgeIntegrity(condition: boolean): asserts condition`
 * needs that parameter to be the thing TypeScript narrows on, so the union the message asks for
 * would not compile, and the call site reads as the condition it just evaluated rather than as a
 * bare `true`.
 *
 * A parameter whose every call passes its own name keeps its boolean, whether that name arrives
 * bare, as a no-argument call of it, or as a property of that name on some value:
 * `missTail(difficulty, "above", everyBattery)`, `completedOutcome(…, submitted(), …)` and
 * `scoredFields(outcome, solvedCase.acceptedSubmit)` each state at the call site exactly what the
 * declaration states, and the reader needs no jump; three of the five reports in `src/run` were
 * that shape, threaded through one file. The exemption needs the call sites in view, so it applies to a module-local function
 * only: an exported one has callers this rule never sees, and one of them will pass `true`.
 *
 * A boolean that gates the function passed next to it keeps its boolean too:
 * `keysIf(this.files.size > 0, () => ({ files: … }))` reads at every call site as the condition
 * and what it guards, which is an `if` written as a call. The union would read `keysIf("present",
 * …)` and lose the condition. `src/meta/optional-key.ts` held a ledger row saying so until
 * 2026-09-22. The body has to show it: every read of the boolean is the test of a conditional
 * whose consequent calls that function. A flag that merely precedes a callback, such as
 * `run(verbose: boolean, done: () => void)` logging on `verbose` and calling `done` regardless,
 * is still reported; the first form of this admission read only the parameter list and let it by.
 *
 * There is no fix. Which two words name the states is the whole point of the change.
 */
export const noPositionalBooleanParameterRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Name the two states with a string-literal union instead of a boolean parameter." },
    messages: {
      opaqueAtCallSite:
        "`{{fn}}({{name}}: boolean)` reads as `{{fn}}(…, true)` at the call site, which names neither the parameter nor the state. Take a union of two string literals that say what the two states are.",
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

    /** Whether the parameter after this boolean takes a function, and every read of the boolean in
     *  `owner` is the condition that function runs under. */
    function gatesNextFunction(owner: ESTree.Function, name: string, next: ESTree.Node | undefined) {
      if (next?.type !== "Identifier") return false;
      if (next.typeAnnotation?.typeAnnotation.type !== "TSFunctionType") return false;
      const variable = context.sourceCode
        .getDeclaredVariables(owner)
        .find((declared) => declared.name === name);
      const reads = variable?.references.filter((reference) => reference.isRead()) ?? [];
      return reads.length > 0 && reads.every((reference) => guardsCallOf(reference.identifier, next.name));
    }

    function report(declaring: ESTree.Node | null, fn: string, owner: ESTree.Function): void {
      const parameters = owner.params;
      const returns = owner.returnType ?? null;
      // `asserts x` and `x is T` name a parameter TypeScript narrows on; it has to stay boolean.
      if (returns?.type === "TSTypeAnnotation" && returns.typeAnnotation.type === "TSTypePredicate") return;
      for (const [index, parameter] of parameters.entries()) {
        // A destructured or defaulted parameter is a different shape; only a plain annotated
        // binding is the one that turns into a bare `true` at the call site.
        if (parameter.type !== "Identifier") continue;
        const annotation = parameter.typeAnnotation?.typeAnnotation;
        if (annotation?.type !== "TSBooleanKeyword") continue;
        if (gatesNextFunction(owner, parameter.name, parameters[index + 1])) continue;
        if (declaring !== null && namedAtEveryCall(declaring, fn, index, parameter.name)) continue;
        context.report({
          node: parameter,
          messageId: "opaqueAtCallSite",
          data: { fn, name: parameter.name },
        });
      }
    }

    return {
      // A test states both arguments beside each other and reads them together; the opacity this
      // rule is about is a caller in another file.
      before: () => !isTestFile(context.filename),

      // An exported declaration arrives wrapped, so its own node is not the module-scope statement
      // and its callers are in other files: it never takes the call-site exemption.
      FunctionDeclaration: (node) =>
        report(
          node.parent.type === "Program" ? node : null,
          node.id === null ? "this function" : node.id.name,
          node,
        ),
      // A method is reached through a value, not a name this rule can resolve.
      MethodDefinition: (node) => {
        if (node.key.type !== "Identifier") return;
        report(null, node.key.name, node.value);
      },
    };
  },
});
