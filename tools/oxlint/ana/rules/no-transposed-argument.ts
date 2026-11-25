import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { crossings } from "../shared/crossed.ts";
import { bindingName, identifierName, propertyName } from "../shared/statements.ts";

/**
 * Flags calls to functions, methods, or constructors declared in the same file whose argument names
 * form a closed transposition cycle against the callee's parameter names (`crossings`,
 * `tools/oxlint/ana/shared/crossed.ts`; cross-file calls are checked by
 * `tree/no-transposed-argument` in `tools/oxlint/tree-crossed-argument.ts`). There is no fix.
 */
type Callable = ESTree.Function | ESTree.ArrowFunctionExpression;

function isCallable(node: ESTree.Node | null | undefined): node is Callable {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression"
  );
}

function keyName(key: ESTree.Node, computed: boolean): string | null {
  return !computed && key.type === "Identifier" ? key.name : null;
}

function constructorOf(body: ESTree.ClassBody): Callable | null {
  for (const member of body.body) {
    if (member.type === "MethodDefinition" && member.kind === "constructor") return member.value;
  }
  return null;
}

/** A plain parameter, one with a default, or a constructor's parameter property. */
function parameterName(param: Callable["params"][number]): string | null {
  return bindingName(param.type === "TSParameterProperty" ? param.parameter : param);
}

function methodOfClass(node: ESTree.Node, name: string): Callable | null {
  let up: ESTree.Node | null = node.parent;
  while (up !== null && up.type !== "ClassBody") up = up.parent;
  for (const member of up?.body ?? []) {
    if (member.type !== "MethodDefinition" && member.type !== "PropertyDefinition") continue;
    if (keyName(member.key, member.computed) === name && isCallable(member.value)) return member.value;
  }
  return null;
}

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
    function definitionOf(id: ESTree.Node) {
      return context.sourceCode.getScope(id).references.find((reference) => reference.identifier === id)
        ?.resolved?.defs[0];
    }

    function boundFunction(id: ESTree.Node): Callable | null {
      const def = definitionOf(id);
      if (def?.type === "FunctionName" && def.node.type === "FunctionDeclaration") return def.node;
      if (def?.type !== "Variable" || def.node.type !== "VariableDeclarator") return null;
      return isCallable(def.node.init) ? def.node.init : null;
    }

    function boundConstructor(id: ESTree.Node): Callable | null {
      const def = definitionOf(id);
      if (def?.type === "ClassName" && def.node.type === "ClassDeclaration") {
        return constructorOf(def.node.body);
      }
      if (def?.type !== "Variable" || def.node.type !== "VariableDeclarator") return null;
      return def.node.init?.type === "ClassExpression" ? constructorOf(def.node.init.body) : null;
    }

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
