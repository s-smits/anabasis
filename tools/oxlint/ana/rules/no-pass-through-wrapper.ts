import { defineRule, type ESTree } from "@oxlint/plugins";

/** Oxlint's `Function` covers the three declaration forms alone, so an arrow needs its own arm. */
type AnyFunction = ESTree.Function | ESTree.ArrowFunctionExpression;

/**
 * A function whose whole body is one call forwarding its own parameters unchanged is a second
 * name for the function it calls:
 *
 *     function readOpening(dir: string): Opening { return loadOpening(dir); }
 *
 * The working contract asks for exactly this cut — "inline rule-free one-caller wrappers" — and
 * the word that carries it is rule-free. A wrapper earns its place when it *does* something on
 * the way past: a default, a narrowing, a reordering, a fixed argument that the callers should
 * not have to know. This rule reads only the case where it does none of those, so the two names
 * are the same function and a reader has to visit both to learn that.
 *
 * The forwarding must be exact: same count, same order, each argument the bare parameter name.
 * Adding an argument, dropping one, reordering them, or passing `options.limit` where the
 * parameter was `options` all keep the wrapper, because each of those is a decision the wrapper
 * is making.
 *
 * Six shapes stay out, four of them measured on 2026-09-20 over 25 sites.
 *
 * A function with no parameters forwards nothing, so the finding does not apply to it. What a
 * zero-parameter body names is either a computation — `nodeRuntimeReadRoots().map(…).sort()` —
 * or a receiver binding: `const atExit = () => this.closeAtExit()` is the only spelling that
 * survives being handed to `process.on`, because `this.closeAtExit` alone loses its receiver.
 * Five sites.
 *
 * The callee has to be a name a caller could write: a bare identifier or a dotted path of them.
 * `new TextDecoder().decode`, `/^[\dA-Za-z_$]/u.test` and `readdirSync(root).filter(…).sort` are
 * not names, and "call that at the sites" is not advice a reader can take. A body holding a
 * construction or a chain is doing work, which is the job the wrapper was asked for. Five sites.
 *
 * A member callee whose receiver this file names is a wrapper supplying a fixed argument, which
 * the list above already admits as a job. `VERDICT_WORD_SET.has` and `directories.delete` read a
 * module-private collection no other file can reach, so there is one name and one implementation
 * detail rather than two names; `PROMPT.indexOf` fixes the haystack. A global receiver is not
 * the file's to fix, so `Bun.sleep` and `String` are still reported. Four sites.
 *
 * A return type predicate — `value is JsonSchema` — is the narrowing, stated. One site.
 *
 * An `async` wrapper of a sync call is changing the contract and is skipped. And a wrapper whose
 * return annotation merely differs from its callee's is still reported: the plugin cannot see
 * types, and the report is a question, not a verdict.
 *
 * The ten sites those exemptions left were all deleted: `candidateDir` for `productVersionDir`,
 * `errMsg` for `errorMessage`, `present` for `existsSync`, `delay` for `Bun.sleep`, two digest
 * names for `hashJsonBytes` and four serialiser names for `capturedJsonStringify` and `String`.
 *
 * There is no fix. Deleting the name means editing every caller, which is the
 * whole point of the finding and not something a per-file fixer can do.
 */
export const noPassThroughWrapperRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A function whose body only forwards its parameters is a second name." },
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
      if (node.type !== "MemberExpression" || node.computed) return null;
      return calleeRoot(node.object);
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
        check(node, declarator.id.type === "Identifier" ? declarator.id.name : null);
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
