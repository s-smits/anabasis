import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { isTestFile } from "../shared/file-role.ts";
import { flagBinding } from "../shared/flags.ts";
import { identifierName } from "../shared/statements.ts";

/** The function a parameter list belongs to: a declaration, an expression or an arrow. */
type Owner = ESTree.Function | ESTree.ArrowFunctionExpression;

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
 * sentence it is. An options object with one named field would do the same job, which is why other
 * languages reach for keyword arguments here; the union is asked for because it costs the caller
 * nothing and a bag of optional fields hides the same question one level further in.
 *
 * Only a declaration is reported. A callback's parameter type is written by whoever declared the
 * signature it satisfies, and renaming it there changes nothing for a reader. A callback under a
 * name is the same callback: `const counted = (confirmed: boolean | null) => …` whose one use is
 * `[true, false, null].map(counted)` is called with the data, and no line of the file spells
 * `counted(true)`. So a function this file never calls and never exports, and only hands on as an
 * argument, keeps its boolean; one direct call, or an export, and its call sites are judged again.
 * On 11 November 2026 that was one of the two sites the widened reading still held.
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
 * declaration states, and the reader needs no jump; three of the five reports in `5bc9988:src/run` were
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
 * `widen` reaches what Foxglove's `no-boolean-parameters` reads and this rule did not (the
 * notice is in `THIRD_PARTY_NOTICES.md`). `"flags"` counts a flag spelled `true | false` or beside
 * `undefined`, `null` or `void`, and a parameter defaulted to `true` or `false`, which reads as a
 * bare `true` at the call site as surely as an annotated one. `"bindings"` reads a `const` bound
 * to an arrow or a function expression, a `declare` function or overload, and an abstract method,
 * each a declaration a caller in another file reads. Both are off by default, so the gate holds at
 * what it held, and `tools/oxlint/staged-rules.json` reports their sites until none stands.
 * Foxglove's `allowLoneParameter` is not taken, since the default reading reports a lone boolean
 * as well. A formatter whose one argument is the data (`yesNo(value: boolean)`) reads well at its
 * call sites, and a reader answers it through `bun run not-slop` rather than an option.
 *
 * There is no fix. Which two words name the states is the whole point of the change.
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
    schema: [
      {
        type: "object",
        properties: { widen: { type: "array", items: { enum: ["flags", "bindings"] } } },
        additionalProperties: false,
      },
    ],
    messages: {
      opaqueAtCallSite:
        "`{{fn}}({{name}}: boolean)` reads as `{{fn}}({{call}})` at the call site, which names neither the parameter nor the state. Take a union of two string literals that say what the two states are.",
    },
  },
  createOnce(context) {
    let widen: ReadonlySet<string> = new Set();

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

    /** Whether the parameter after this boolean takes a function, and every read of the boolean in
     *  `owner` is the condition that function runs under. */
    function gatesNextFunction(owner: Owner, name: string, next: ESTree.Node | undefined) {
      if (next?.type !== "Identifier") return false;
      if (next.typeAnnotation?.typeAnnotation.type !== "TSFunctionType") return false;
      const variable = context.sourceCode
        .getDeclaredVariables(owner)
        .find((declared) => declared.name === name);
      const reads = variable?.references.filter((reference) => reference.isRead()) ?? [];
      return reads.length > 0 && reads.every((reference) => guardsCallOf(reference.identifier, next.name));
    }

    function report(declaring: ESTree.Node | null, fn: string, owner: Owner): void {
      const parameters = owner.params;
      const returns = owner.returnType ?? null;
      // `asserts x` and `x is T` name a parameter TypeScript narrows on; it has to stay boolean.
      if (returns?.type === "TSTypeAnnotation" && returns.typeAnnotation.type === "TSTypePredicate") return;
      for (const [index, parameter] of parameters.entries()) {
        // A destructured parameter is a different shape. By default only a binding annotated
        // `boolean` is read; `widen: ["flags"]` reads every flag Foxglove's rule reads.
        const plain =
          parameter.type === "Identifier" &&
          parameter.typeAnnotation?.typeAnnotation.type === "TSBooleanKeyword"
            ? parameter
            : null;
        const binding = widen.has("flags") ? flagBinding(parameter) : plain;
        if (binding === null) continue;
        if (gatesNextFunction(owner, binding.name, parameters[index + 1])) continue;
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
      before: () => {
        const option = asRecord(context.options[0])?.widen;
        widen = new Set(Array.isArray(option) ? option.filter(isString) : []);
        return !isTestFile(context.filename);
      },

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
        if (!widen.has("bindings") || id.type !== "Identifier" || !callable) return;
        const exported = node.parent.parent?.type.startsWith("Export") === true;
        if (!exported && handedOnOnly(node, id.name)) return;
        report(node.parent.parent?.type === "Program" ? node : null, id.name, init);
      },
      TSDeclareFunction: (node) => {
        if (widen.has("bindings")) {
          report(null, identifierName(node.id) ?? "this function", node);
        }
      },
      TSAbstractMethodDefinition: (node) => {
        if (widen.has("bindings")) {
          report(null, identifierName(node.key) ?? "this method", node.value);
        }
      },
    };
  },
});
