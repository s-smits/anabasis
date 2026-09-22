import { defineRule, type ESTree } from "@oxlint/plugins";

/**
 * A call that passes two arguments the wrong way round, where the compiler cannot say so.
 *
 * `eslint/max-params` is registered at 5 as a proxy for this: a long parameter list is easy to
 * pass wrongly. It is the wrong instrument, and the tree says so — the transposable shape, two
 * parameters of one function declaring one type, stands at 963 pairs, of which 274 are in
 * two-parameter functions, 298 in three, 262 in four and 129 in five. A parameter ceiling moves a
 * function between those buckets; it removes nothing. What can be decided is the call itself.
 *
 * The evidence is the caller's own names. `writeRound(runId, campaignId)` against
 * `writeRound(campaignId: string, runId: string)` states the mistake twice — the argument names
 * are the parameter names, in the other order — and the compiler accepts it because both are
 * `string`. Nothing else in the tree reports it: the types match, both bindings are read, and a
 * test written from the same misreading passes.
 *
 * Only an exact swap is reported, and only where the two parameters declare the same type text.
 * One argument that happens to carry another parameter's name is a coincidence at a call site;
 * two, crossed, is the defect. A different type would not compile, so it needs no rule.
 *
 * The callee is resolved through scope analysis to a function this file declares, because a
 * parameter list is needed to compare against and an imported one is not in view.
 *
 * There is no fix. Swapping the two arguments back is mechanically available and wrong to apply:
 * the call may be right and the caller's two bindings misnamed, or the declaration's order may be
 * the thing to change. Writing either one silently changes what the program computes.
 */
export const noTransposedArgumentRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow a call that passes two same-typed arguments in swapped order." },
    messages: {
      transposed:
        "`{{fn}}({{first}}, …, {{second}})` passes `{{first}}` where `{{fn}}` declares `{{second}}` and `{{second}}` where it declares `{{first}}`. Both are `{{type}}`, so the compiler accepts the swap.",
    },
  },
  createOnce(context) {
    /** The parameter names and declared type text of a function this file declares, in order. */
    function parametersOf(
      callee: ESTree.IdentifierReference,
    ): ({ name: string; text: string } | null)[] | null {
      const resolved = context.sourceCode
        .getScope(callee)
        .references.find((reference) => reference.identifier === callee)?.resolved;
      const declaration = resolved?.defs[0];
      if (declaration === undefined) return null;
      const node =
        declaration.node.type === "FunctionDeclaration"
          ? declaration.node
          : declaration.node.type === "VariableDeclarator" &&
              (declaration.node.init?.type === "ArrowFunctionExpression" ||
                declaration.node.init?.type === "FunctionExpression")
            ? declaration.node.init
            : null;
      if (node === null) return null;
      return node.params.map((param) => {
        if (param.type !== "Identifier") return null;
        const annotation = param.typeAnnotation ?? null;
        if (annotation === null) return null;
        return { name: param.name, text: context.sourceCode.getText(annotation.typeAnnotation) };
      });
    }

    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        const params = parametersOf(node.callee);
        if (params === null) return;
        for (let i = 0; i < node.arguments.length; i += 1) {
          for (let j = i + 1; j < node.arguments.length; j += 1) {
            const first = node.arguments[i];
            const second = node.arguments[j];
            const left = params[i] ?? null;
            const right = params[j] ?? null;
            if (first?.type !== "Identifier" || second?.type !== "Identifier") continue;
            if (left === null || right === null || left.text !== right.text) continue;
            if (first.name !== right.name || second.name !== left.name) continue;
            context.report({
              node,
              messageId: "transposed",
              data: {
                fn: node.callee.name,
                first: first.name,
                second: second.name,
                type: left.text.replaceAll("\n", " "),
              },
            });
          }
        }
      },
    };
  },
});
