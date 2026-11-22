import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { identifierName, isNamedMember } from "../shared/statements.ts";

/** Oxlint's `Function` covers the three declaration forms alone, so an arrow needs its own arm. */
type AnyFunction = ESTree.Function | ESTree.ArrowFunctionExpression;

/**
 * Flags a function or arrow whose body is a single call forwarding its own parameters in the same
 * order to a named callee without defaults, fixed arguments, module-owned receiver binding,
 * `async` wrapping, or a return type predicate. Zero-parameter functions are exempt. There is no fix.
 */
export const noPassThroughWrapperRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A function whose body only forwards its parameters is a second name.",
      examples: [
        {
          before:
            "function readOpening(dir: string) {\n  return loadOpening(dir);\n}\nexport const opening = readOpening(campaignDir);",
          after: "export const opening = loadOpening(campaignDir);",
        },
        {
          before:
            "const textOf = (count: number) => String(count);\nexport const label = `${textOf(wins)} of ${textOf(untied)}`;",
          after: "export const label = `${String(wins)} of ${String(untied)}`;",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      secondName:
        "`{{name}}` forwards its parameters to `{{callee}}` and does nothing else, so the two names are one function and a reader has to open both. Call `{{callee}}` at the sites, or give this one a job — a default, a narrowing, a fixed argument.",
    },
  },
  createOnce(context) {
    /** Every name this file declares or imports, so a receiver it owns reads as a fixed argument. */
    const named = new Set<string>(["this"]);
    /** Candidates held until the whole file is read, because a receiver may be declared below. */
    const found: { node: AnyFunction; name: string; callee: string; root: string }[] = [];

    /** The single expression a function body returns, or null when it is anything else. */
    function returned(node: AnyFunction): ESTree.Expression | null {
      const { body } = node;
      // A `declare function` has no body at all; nothing is forwarded through nothing.
      if (body === null) return null;
      if (body.type !== "BlockStatement") return body;
      const [only] = body.body;
      if (body.body.length !== 1 || only === undefined) return null;
      if (only.type === "ReturnStatement") return only.argument ?? null;
      if (only.type === "ExpressionStatement") return only.expression;
      return null;
    }

    /** The root identifier of a callee that is a name a caller could write, else null. */
    function calleeRoot(node: ESTree.Node): string | null {
      if (node.type === "Identifier") return node.name;
      if (node.type === "ThisExpression") return "this";
      return isNamedMember(node) ? calleeRoot(node.object) : null;
    }

    /** Whether a call's arguments are exactly these parameter names, in order. */
    function forwards(call: ESTree.CallExpression, parameters: readonly ESTree.ParamPattern[]): boolean {
      // A function with no parameters forwards nothing; its body names a computation or a receiver.
      if (parameters.length === 0 || call.arguments.length !== parameters.length) return false;
      return parameters.every((parameter, index) => {
        const argument = call.arguments[index];
        if (parameter.type !== "Identifier" || argument === undefined) return false;
        return argument.type === "Identifier" && argument.name === parameter.name;
      });
    }

    function check(node: AnyFunction, name: string | null): void {
      if (name === null || node.async || node.generator) return;
      // `value is JsonSchema` is the narrowing this rule asks a wrapper for, written down.
      const annotation = node.returnType;
      if (
        annotation !== null &&
        annotation !== undefined &&
        /\bis\s/u.test(context.sourceCode.getText(annotation))
      ) {
        return;
      }
      const expression = returned(node);
      if (expression === null) return;

      const call = expression.type === "AwaitExpression" ? expression.argument : expression;
      if (call.type !== "CallExpression" || !forwards(call, node.params)) return;

      const root = calleeRoot(call.callee);
      const callee = context.sourceCode.getText(call.callee);
      if (root === null || callee === name) return;
      found.push({ node, name, callee, root });
    }

    return {
      before: () => {
        named.clear();
        named.add("this");
        found.length = 0;
        return true;
      },
      ImportSpecifier: (node) => named.add(node.local.name),
      ImportDefaultSpecifier: (node) => named.add(node.local.name),
      ImportNamespaceSpecifier: (node) => named.add(node.local.name),
      VariableDeclarator: (node) => {
        if (node.id.type === "Identifier") named.add(node.id.name);
      },
      FunctionDeclaration: (node) => {
        if (node.id !== null) named.add(node.id.name);
        check(node, node.id === null ? null : node.id.name);
      },
      ClassDeclaration: (node) => {
        if (node.id !== null) named.add(node.id.name);
      },
      ArrowFunctionExpression: (node) => {
        const declarator = node.parent;
        if (declarator.type !== "VariableDeclarator") return;
        check(node, identifierName(declarator.id));
      },
      "Program:exit": () => {
        for (const row of found) {
          // A receiver this file names is a fixed argument the wrapper supplies; a global is not.
          if (row.callee !== row.root && named.has(row.root)) continue;
          context.report({
            node: row.node,
            messageId: "secondName",
            data: { name: row.name, callee: row.callee },
          });
        }
      },
    };
  },
});
