import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

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
 * Only a crossed pair is reported: the argument at each of two positions carries the name of the
 * other position's parameter and not its own. A name is a bare identifier or the property ending
 * a member read (`row.to`), and it matches a parameter when its words begin or end with the
 * parameter's words (`sourcePath` matches `source`), provided neither parameter's name matches
 * the other's. The declared types are not compared: a crossed pair that compiles has types the
 * compiler takes either way, which is the case the rule exists for. The callee is a function this
 * file declares, a `const` bound to a function, a method of the enclosing class called on `this`,
 * or a method of an object literal bound to a `const`.
 *
 * One argument that carries another parameter's name is a coincidence, and the rule does not
 * report it. Measured on 8 November across today's tree and seven trees from 12 October to 5
 * November, that shape gave 6 to 10 findings a tree, every one a correct call (`flag("name",
 * name)`, `addUsage(turn.usage, usage)`); requiring the caller to hold the displaced parameter's
 * name as well left only calls inside the callee itself. The crossed shape, with every widening
 * above, reported nothing on any of the eight trees: the defect is rare, and the rule is the
 * fence that keeps it so.
 *
 * The callee is resolved through scope analysis, because a parameter list is needed to compare
 * against and an imported one is not in view. A parameter that holds a function (`verify` in
 * `decided(verify, task, answer)`) is not resolved to the function that declares it.
 *
 * There is no fix. Swapping the two arguments back is mechanically available and wrong to apply:
 * the call may be right and the caller's two bindings misnamed, or the declaration's order may be
 * the thing to change. Writing either one silently changes what the program computes.
 */
type Callable = ESTree.Function | ESTree.ArrowFunctionExpression;

function isCallable(node: ESTree.Node | null | undefined): node is Callable {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression"
  );
}

/** The written name of a property or method key, or null for a computed or literal one. */
function keyName(key: ESTree.Node, computed: boolean): string | null {
  return !computed && key.type === "Identifier" ? key.name : null;
}

/** The name an argument carries: a bare identifier, or the property that ends a member read. */
function argumentName(arg: ESTree.Node): string | null {
  if (arg.type === "Identifier") return arg.name;
  if (arg.type === "MemberExpression" && !arg.computed && arg.property.type === "Identifier") {
    return arg.property.name;
  }
  return null;
}

/** The lower-case words of a camel-case or snake-case name. */
function wordsOf(name: string): string[] {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()
    .split(" ")
    .filter((word) => word !== "");
}

/** Whether a name's words begin or end with a parameter's words: `sourcePath` fits `source`. */
function fits(name: string, parameter: string): boolean {
  const have = wordsOf(name);
  const want = wordsOf(parameter);
  if (want.length === 0 || want.length > have.length) return false;
  const offset = have.length - want.length;
  return want.every((word, k) => have[k] === word) || want.every((word, k) => have[offset + k] === word);
}

/** Whether two arguments named `first` and `second` cross parameters named `left` and `right`. */
function crossed(first: string, second: string, left: string, right: string): boolean {
  if (fits(left, right) || fits(right, left)) return false;
  return fits(first, right) && !fits(first, left) && fits(second, left) && !fits(second, right);
}

/** The method `name` of the class whose body encloses `node`. */
function methodOfClass(node: ESTree.Node, name: string): Callable | null {
  let up: ESTree.Node | null = node.parent;
  while (up !== null && up.type !== "ClassBody") up = up.parent;
  for (const member of up?.body ?? []) {
    if (member.type !== "MethodDefinition" && member.type !== "PropertyDefinition") continue;
    if (keyName(member.key, member.computed) === name && isCallable(member.value)) return member.value;
  }
  return null;
}

/** The method `name` of an object literal. */
function methodOfObject(object: ESTree.ObjectExpression, name: string): Callable | null {
  for (const property of object.properties) {
    if (property.type !== "Property" || keyName(property.key, property.computed) !== name) continue;
    if (isCallable(property.value)) return property.value;
  }
  return null;
}

export const noTransposedArgumentRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow a call whose two arguments carry each other's parameter names.",
      examples: [
        {
          before:
            'export function roundDir(campaign: string, round: string) {\n  return join(".ana/d2", campaign, "rounds", round);\n}\nexport function logOf(campaign: string, round: string) {\n  return join(roundDir(round, campaign), "trail.jsonl");\n}',
          after:
            'export function roundDir(campaign: string, round: string) {\n  return join(".ana/d2", campaign, "rounds", round);\n}\nexport function logOf(campaign: string, round: string) {\n  return join(roundDir(campaign, round), "trail.jsonl");\n}',
        },
        {
          before:
            "export const marginOf = (wins: number, losses: number) => wins - losses;\nexport const report = (tally: { wins: number; losses: number }) =>\n  `margin ${String(marginOf(tally.losses, tally.wins))}`;",
          after:
            "export const marginOf = (wins: number, losses: number) => wins - losses;\nexport const report = (tally: { wins: number; losses: number }) =>\n  `margin ${String(marginOf(tally.wins, tally.losses))}`;",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      transposed:
        "`{{fn}}` receives `{{first}}` at its parameter `{{left}}` and `{{second}}` at `{{right}}`: each argument is named for the other parameter. The compiler accepts the swap because the two types are assignable either way.",
    },
  },
  createOnce(context) {
    /** The first definition of the variable an identifier reads, where scope analysis resolves it. */
    function definitionOf(id: ESTree.Node) {
      return context.sourceCode.getScope(id).references.find((reference) => reference.identifier === id)
        ?.resolved?.defs[0];
    }

    /** The function a variable reference names, where this file binds it to one. */
    function boundFunction(id: ESTree.Node): Callable | null {
      const def = definitionOf(id);
      if (def?.type === "FunctionName" && def.node.type === "FunctionDeclaration") return def.node;
      if (def?.type !== "Variable" || def.node.type !== "VariableDeclarator") return null;
      return isCallable(def.node.init) ? def.node.init : null;
    }

    /** The function a call reaches, where this file declares it, or null. */
    function calleeOf(callee: ESTree.Node): Callable | null {
      if (callee.type === "Identifier") return boundFunction(callee);
      if (callee.type !== "MemberExpression") return null;
      const name = keyName(callee.property, callee.computed);
      if (name === null) return null;
      if (callee.object.type === "ThisExpression") return methodOfClass(callee, name);
      if (callee.object.type !== "Identifier") return null;
      const def = definitionOf(callee.object);
      if (def?.type !== "Variable" || def.node.type !== "VariableDeclarator") return null;
      return def.node.init?.type === "ObjectExpression" ? methodOfObject(def.node.init, name) : null;
    }

    return {
      CallExpression(node) {
        if (node.arguments.some((arg) => arg.type === "SpreadElement")) return;
        const callable = calleeOf(node.callee);
        if (callable === null) return;
        const params = callable.params.map((param) => {
          const target = param.type === "AssignmentPattern" ? param.left : param;
          return target.type === "Identifier" ? target.name : null;
        });
        const names = node.arguments.map(argumentName);
        for (let i = 0; i < names.length; i += 1) {
          for (let j = i + 1; j < names.length; j += 1) {
            const [first, second, left, right] = [names[i], names[j], params[i], params[j]];
            if (first == null || second == null || left == null || right == null) continue;
            if (!crossed(first, second, left, right)) continue;
            const fn = context.sourceCode.getText(node.callee);
            context.report({ node, messageId: "transposed", data: { fn, first, second, left, right } });
          }
        }
      },
    };
  },
});
