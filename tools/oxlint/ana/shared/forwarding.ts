import type { ESTree } from "@oxlint/plugins";

/**
 * Whether a value handed to a function the file declares ends up at a named destination.
 *
 * Two ownership rules ask this. A script that keeps a testable `main(argv)` hands the process
 * arguments to the library parser through it, and a script with a local `readOptional(path)` hands a
 * path to a JSON reader through it. Trusting the local name would admit a hand parser called
 * `parse`; ignoring local functions would report the testable shape the library's own callers use.
 * So the parameter is followed by name and position into every call inside that function's body,
 * through as many local functions as it passes, and the answer is whatever the chain reaches.
 */
type Callable = ESTree.Function | ESTree.ArrowFunctionExpression;

/** One call in the file: the name it calls, which arguments are bare identifiers, and every
 *  function it sits inside. */
type CallSite = {
  node: ESTree.CallExpression;
  callee: string;
  identifiers: ReadonlyMap<number, string>;
  within: readonly Callable[];
};

export function isCallable(node: ESTree.Node): node is Callable {
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
  const index = call.arguments.findIndex((argument) => argument === at);
  return index === -1 ? null : { call, index };
}

function parameterName(parameter: ESTree.Node | undefined): string | null {
  if (parameter?.type === "AssignmentPattern") return parameterName(parameter.left);
  return parameter?.type === "Identifier" ? parameter.name : null;
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
    const parameter = parameterName(fn?.params[index]);
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
      if (node.id.type === "Identifier" && node.init !== null && isCallable(node.init)) {
        functions.set(node.id.name, node.init);
      }
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
    /** Whether argument `index` of a call to `name` arrives at a call `target` accepts. */
    reaches: (name: string, index: number, target: (name: string) => boolean): boolean =>
      reaches(name, index, target, new Set()),
    /** Every recorded call passing the identifier `name`, with the position it is passed at. */
    passing(name: string): Array<{ node: ESTree.CallExpression; index: number }> {
      return calls.flatMap((site) =>
        [...site.identifiers].flatMap(([index, argument]) =>
          argument === name ? [{ node: site.node, index }] : [],
        ),
      );
    },
  };
}
