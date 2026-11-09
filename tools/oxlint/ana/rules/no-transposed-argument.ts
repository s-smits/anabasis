import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { crossings } from "../shared/crossed.ts";
import { identifierName, propertyName } from "../shared/statements.ts";

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
 * A call is reported where its arguments cross: each of two arguments named for the other's
 * parameter, or three or more rotated so that each is named for the next one's (`crossings`,
 * `tools/oxlint/ana/shared/crossed.ts`, which says when a name names a parameter). A name is a
 * bare identifier or the property ending a member read (`row.to`), and it names a parameter when
 * its words begin or end with the parameter's (`sourcePath` names `source`). The declared types are
 * not compared: a crossing that compiles has types the compiler takes among the positions, which
 * is the case the rule exists for. The callee is a function this file declares, a `const` bound to
 * a function, a method of the enclosing class called on `this`, a method of an object literal
 * bound to a `const`, or the constructor of a class this file declares, reached by `new`.
 *
 * An oxlint rule sees one file, and its plugin API offers no other module's declarations, so a
 * call into another file is read by the whole-tree scan `tree/no-transposed-argument`
 * (`tools/oxlint/tree-crossed-argument.ts`) with the same reading. On 8 November that scan resolved
 * 9,989 calls into other files, with 7,742 argument pairs, and found no crossing.
 *
 * One argument that carries another parameter's name is a coincidence, and the rule does not
 * report it. Measured on 8 November across today's tree and seven trees from 12 October to 5
 * November, that shape gave 6 to 10 findings a tree, every one a correct call (`flag("name",
 * name)`, `addUsage(turn.usage, usage)`); requiring the caller to hold the displaced parameter's
 * name as well left only calls inside the callee itself. A chain of such pointers that never
 * closes is the same coincidence twice. The crossed shape, with every widening above, reported
 * nothing on any of the eight trees: the defect is rare, and the rule is the fence that keeps it
 * so.
 *
 * The callee is resolved through scope analysis, because a parameter list is needed to compare
 * against. A parameter that holds a function (`verify` in `decided(verify, task, answer)`) is not
 * resolved to the function that declares it.
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

/** The constructor of a class, where it declares one. */
function constructorOf(body: ESTree.ClassBody): Callable | null {
  for (const member of body.body) {
    if (member.type === "MethodDefinition" && member.kind === "constructor") return member.value;
  }
  return null;
}

/** A parameter's name: a plain one, one with a default, or a constructor's parameter property. */
function parameterName(param: Callable["params"][number]): string | null {
  const inner = param.type === "TSParameterProperty" ? param.parameter : param;
  const target = inner.type === "AssignmentPattern" ? inner.left : inner;
  return target.type === "Identifier" ? target.name : null;
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
      description: "Disallow a call whose arguments carry one another's parameter names.",
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
        "`{{fn}}` receives {{given}}: each of these arguments is named for the parameter of another in the list. The compiler accepts the crossing because the types are assignable among them.",
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

    /** The constructor a `new` reaches, where this file declares the class. */
    function boundConstructor(id: ESTree.Node): Callable | null {
      const def = definitionOf(id);
      if (def?.type === "ClassName" && def.node.type === "ClassDeclaration") {
        return constructorOf(def.node.body);
      }
      if (def?.type !== "Variable" || def.node.type !== "VariableDeclarator") return null;
      return def.node.init?.type === "ClassExpression" ? constructorOf(def.node.init.body) : null;
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

    function check(node: ESTree.CallExpression | ESTree.NewExpression, callable: Callable | null): void {
      if (callable === null || node.arguments.some((arg) => arg.type === "SpreadElement")) return;
      const names = node.arguments.map((arg) => identifierName(arg) ?? propertyName(arg));
      const params = callable.params.map(parameterName);
      for (const crossing of crossings(names, params)) {
        const given = crossing.map((i) => `\`${names[i] ?? ""}\` at \`${params[i] ?? ""}\``).join(", ");
        context.report({
          node,
          messageId: "transposed",
          data: { fn: context.sourceCode.getText(node.callee), given },
        });
      }
    }

    return {
      CallExpression(node) {
        check(node, calleeOf(node.callee));
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier") check(node, boundConstructor(node.callee));
      },
    };
  },
});
