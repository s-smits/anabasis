import type { ESTree } from "@oxlint/plugins";
import { bindingName, bindsName } from "./statements.ts";

/**
 * Whether a value handed to a function the file declares ends up at a named destination: a script
 * that keeps a testable `main(argv)` hands the process arguments to the library parser through it.
 * The parameter is followed by name and position into every call in that function's body, through
 * as many local functions as it passes, so neither a hand parser called `parse` nor the testable
 * shape is misread.
 */
type Callable = ESTree.Function | ESTree.ArrowFunctionExpression;

interface CallSite {
  node: ESTree.CallExpression;
  callee: string;
  identifiers: ReadonlyMap<number, string>;
  within: readonly Callable[];
}

function isCallable(node: ESTree.Node): node is Callable {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

/** `name(…)` as `name`, and `Object.name(…)` as `Object.name`; anything else has no name to follow. */
export function calleeName(call: ESTree.CallExpression): string | null {
  const { callee } = call;
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.property.type === "Identifier"
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return null;
}

/** The call and position a value is an argument at, looking through `c ? value : []` and `??`. */
export function argumentOf(value: ESTree.Node): { call: ESTree.CallExpression; index: number } | null {
  let at: ESTree.Node = value;
  for (let parent = at.parent; parent !== null; parent = at.parent) {
    const through =
      (parent.type === "ConditionalExpression" && parent.test !== at) || parent.type === "LogicalExpression";
    if (!through) break;
    at = parent;
  }
  const call = at.parent;
  if (call?.type !== "CallExpression") return null;
  const passed: readonly ESTree.Node[] = call.arguments;
  const index = passed.indexOf(at);
  return index === -1 ? null : { call, index };
}

/** Feed it every function declaration, declarator and call; ask it after the file has been read. */
export function forwardingTracker() {
  const functions = new Map<string, Callable>();
  const calls: CallSite[] = [];

  function reaches(
    name: string,
    index: number,
    target: (name: string) => boolean,
    seen: Set<string>,
  ): boolean {
    if (target(name)) return true;
    const fn = functions.get(name);
    const parameter = bindingName(fn?.params[index]);
    if (fn === undefined || parameter === null || seen.has(name)) return false;
    seen.add(name);
    return calls.some(
      (site) =>
        site.within.includes(fn) &&
        [...site.identifiers].some(
          ([at, argument]) => argument === parameter && reaches(site.callee, at, target, seen),
        ),
    );
  }

  return {
    reset(): void {
      functions.clear();
      calls.length = 0;
    },
    declareFunction(node: ESTree.Function): void {
      if (node.id !== null) functions.set(node.id.name, node);
    },
    declareBinding(node: ESTree.VariableDeclarator): void {
      if (bindsName(node) && isCallable(node.init)) functions.set(node.id.name, node.init);
    },
    call(node: ESTree.CallExpression): void {
      const callee = calleeName(node);
      if (callee === null) return;
      const identifiers = new Map<number, string>();
      for (const [at, argument] of node.arguments.entries()) {
        if (argument.type === "Identifier") identifiers.set(at, argument.name);
      }
      const within: Callable[] = [];
      for (let at: ESTree.Node | null = node.parent; at !== null; at = at.parent) {
        if (isCallable(at)) within.push(at);
      }
      calls.push({ node, callee, identifiers, within });
    },
    reaches: (name: string, index: number, target: (name: string) => boolean): boolean =>
      reaches(name, index, target, new Set()),
    passing(name: string): { node: ESTree.CallExpression; index: number }[] {
      return calls.flatMap((site) =>
        [...site.identifiers].flatMap(([index, argument]) =>
          argument === name ? [{ node: site.node, index }] : [],
        ),
      );
    },
  };
}
