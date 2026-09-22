import { defineRule, type ESTree } from "@oxlint/plugins";

import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

/**
 * Whether the call is a Proxy `get` trap handing on its own three parameters, in order:
 * `get(target, property, receiver) { return Reflect.get(target, property, receiver); }`. A
 * property whose value is a function belongs to an object literal, since a pattern's value is a
 * pattern.
 */
function forwardsGetTrap(node: ESTree.CallExpression): boolean {
  let trap: ESTree.Node = node.parent;
  while (trap.type !== "FunctionExpression" && trap.type !== "ArrowFunctionExpression") {
    if (trap.type === "Program" || trap.type === "FunctionDeclaration") return false;
    trap = trap.parent;
  }
  const member = trap.parent;
  if (member.type !== "Property" || member.kind !== "init" || member.computed) return false;
  if (member.key.type !== "Identifier" || member.key.name !== "get") return false;
  const received = trap.params.map((parameter) => (parameter.type === "Identifier" ? parameter.name : null));
  return (
    received.length === 3 &&
    node.arguments.length === 3 &&
    node.arguments.every(
      (argument, index) => argument.type === "Identifier" && argument.name === received[index],
    )
  );
}

/**
 * Ban Reflect.get, which bypasses ordinary property access and useful type evidence.
 *
 * There is no fix: the repair is typed access, or a parse of the dynamic input into a domain
 * type, and which one applies is the question the reflection dodged.
 *
 * A Proxy `get` trap forwarding its own three parameters is admitted. It must pass the receiver
 * so that getters see the proxy as `this`, and ordinary property access has no way to pass one.
 * Until 2026-09-22 the one such trap, in `src/solve/task-access-trace.ts`, carried a ledger row
 * that said so. The first form of this admission took any three-argument call, which let
 * `Reflect.get(source, "value", source)` anywhere through.
 */
export const noReflectGetRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Reflect.get; use typed property access or parse dynamic input into a domain type.",
    },
    messages: {
      reflectGet:
        "Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "get") && !forwardsGetTrap(node)) {
          context.report({ node, messageId: "reflectGet" });
        }
      },
    };
  },
});
