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
 * A call to the global `Reflect.get`.
 *
 * `row.verified` is a read the compiler takes part in: it knows whether the property is declared
 * and what it holds, and it objects when the answer is neither. `Reflect.get(row, key)` is the
 * same read with the property arriving as a value, so nothing is checked on the way in and what
 * comes back carries whatever type the reflection is declared to return rather than the one the
 * property has. It is reached for where the property is not known statically, which is the case
 * in which that check was worth the most.
 *
 * A Proxy `get` trap forwarding its own three parameters is admitted. It must pass the receiver
 * so that getters see the proxy as `this`, and ordinary property access has no way to pass one.
 * The repository's one such trap is in `src/solve/task-access-trace.ts`, which carried a ledger row
 * until this admission replaced it. The first form of it took any three-argument call, which let
 * `Reflect.get(source, "value", source)` anywhere through, so `forwardsGetTrap` below requires
 * the call to sit in a plain `get` property of an object literal and to hand on that function's
 * own three parameters, in order.
 *
 * There is no fix: the repair is typed access, or a parse of the dynamic input into a domain
 * type, and which one applies is the question the reflection dodged.
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
