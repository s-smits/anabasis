import { defineRule, type ESTree } from "@oxlint/plugins";

/**
 * A fold written with its reducer inline and a block body is a loop with the accumulator hidden
 * in the signature. The reader has to hold "what `best` is so far" in their head while reading
 * statements that could have said it directly.
 *
 *     const best = rows.reduce<Row | undefined>((best, row) => {
 *       if (best === undefined) return row;
 *       return row.score > best.score ? row : best;
 *     }, undefined);
 *
 *     let best: Row | undefined;
 *     for (const row of rows) if (best === undefined || row.score > best.score) best = row;
 *
 * The loop is shorter, needs no type argument to tell TypeScript what the seed is, and the
 * accumulator is a name in the enclosing scope where every other local lives.
 *
 * A reducer that is a *name* — `rows.reduce(addTurnUsage)`, `iterations.reduce(countUnchanged,
 * seed)` — is not read here. There the fold is one word and the step has its own doc comment,
 * which is the readable form of the same operation; `unicorn/no-array-reduce` condemns both and
 * is off in this repository for that reason. An expression-bodied arrow is not read here either:
 * `(total, row) => total + row.count` is an operator, not a procedure.
 *
 * There is no fix. The rewrite has to choose the accumulator's declared type and
 * where it lives, and a reducer that returns early in three places is not one loop body.
 *
 * Read again on 2026-09-20, because a rule that gates at zero has to say why it is still here.
 * The tree performs this operation 105 times across `src`, `tools`, `test` and `.claude` — 98
 * expression-bodied arrows and 6 named reducers, both of which this rule exempts, and 0 block
 * bodies outside its own example and fixture. So the gate is at zero because the spelling is
 * absent, not because the operation is: `.claude` alone folds 52 times and is the tree most
 * likely to grow the next one in a hurry. That is the case for keeping a silent rule, and it is
 * the case a rule silent over an operation nobody performs cannot make.
 */

/** Whether the call is `<something>.reduce(...)`, with or without an explicit type argument. */
function reduceCall(node: ESTree.CallExpression): boolean {
  const { callee } = node;
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  return callee.property.type === "Identifier" && callee.property.name === "reduce";
}

export const noInlineBlockReducerRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A reduce whose reducer is written inline with a block body is a loop." },
    messages: {
      hiddenLoop:
        "This `reduce` carries its whole step inline as a block, which is a loop with the accumulator hidden in the callback signature. Write the `for…of` and let the accumulator be an ordinary local, or lift the step out under a name.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (!reduceCall(node)) return;
        const [reducer] = node.arguments;
        if (reducer === undefined) return;
        if (reducer.type !== "ArrowFunctionExpression" && reducer.type !== "FunctionExpression") return;
        const { body } = reducer;
        if (body?.type !== "BlockStatement") return;
        context.report({ node, messageId: "hiddenLoop" });
      },
    };
  },
});
