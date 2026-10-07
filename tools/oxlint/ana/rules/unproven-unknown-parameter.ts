import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import { isString } from "#src/meta/json-shape.ts";
import { isNode, type KeyedNode as AnyNode, nodeFields } from "../../anti-slop/shared/ast-node.ts";
import { containsUnknownType } from "../shared/unknown-type.ts";

/**
 * An `unknown` parameter the function never proves anything about.
 *
 * Upstream anti-slop ships `no-unknown-parameters`, which reports every `unknown` parameter and
 * exempts one name, `cause`. That is right for most code and wrong for the layer this repository
 * cannot avoid: the functions whose whole job is to check the type of arbitrary input. Typing
 * their input would make them assert the thing they exist to prove, so seventeen files sat in a
 * config exemption list, and a new unproven parameter added to any of them was reported by
 * nobody. `THIRD_PARTY_NOTICES.md` records that upstream rule as one of the three left out of the
 * copy, and this is what replaces it.
 *
 * This rule keeps the report and moves the exemption from the file to the evidence. An `unknown`
 * parameter is admitted when the function proves it: a type predicate, a narrowing guard, a value
 * handed to another prover, or one derived into a local that is itself proved. A function that
 * takes `unknown` and passes it straight on proves nothing and is still reported.
 *
 * Example: `stableJson(value: unknown)` opens with `isPlainFiniteJson(value, "allowed")` and is
 * admitted; `writeCompleted(path, value: unknown)` handed its value to `JSON.stringify` and was
 * reported until it declared `JsonValue`.
 *
 * A signature with no body — `TSFunctionType`, `TSMethodSignature`, an overload — can prove
 * nothing and is reported exactly as the upstream rule reports it. The one exception is a return
 * type that is itself the proof: `(value: unknown) => value is T` narrows the parameter it names,
 * which is the same evidence the body form is admitted for, so the two spellings of one contract
 * read alike.
 *
 * There is no fix: the repair is a predicate, a guard or a hand to another prover, and all three
 * are code nobody has written yet.
 */

type Parameter = ESTree.ParamPattern;

/** Recognised validation names: `asRecord`, `isString`, `parseJsonAs`, `requireJsonValue`. */
const PROVING_NAME = /^(is|as|has|assert|ensure|require|validate|parse)[A-Z0-9]/u;

/** Repository owners whose names do not match the pattern above. Two properties admit a name
 *  here, and nothing else does. `trustedJson` throws on a value it cannot admit, so reaching the
 *  next line is the proof. `errorMessage` and `errorCode` in `src/meta/runtime-values.ts` are
 *  total on `unknown`: they are the one place a caught value is turned into text or a code, and
 *  handing the parameter to that owner is the whole treatment it needs. A call that merely
 *  consumes the value without either property — `String(value)`, `JSON.stringify(value)` — is
 *  the slop this rule exists to report and must not be added. */
const PROVING_CALLS = new Set(["trustedJson", "errorMessage", "errorCode"]);

const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"]);

/** What one function body says about the names in it. */
type BodyEvidence = {
  /** Names a guard in this body narrowed outright. */
  proved: Set<string>;
  /** `const to = f(from)`: proving `to` proves `from`. */
  aliases: Array<{ from: string; to: string }>;
  /** `f(x)` at argument `index`: proving `f`'s parameter there proves `x`. */
  calls: Array<{ argument: string; callee: string; index: number }>;
};

/** An `unknown` parameter, keeping the position it holds in the real parameter list: a call edge
 *  arrives by argument position, and a filtered list would answer for the wrong parameter. */
type UnknownParameter = { index: number; name: string | null; annotation: ESTree.TSTypeAnnotation };

/** One function with a body, plus the name its callers use. */
type Analysed = {
  callableAs: string | null;
  parameters: UnknownParameter[];
  predicateOn: string | null;
  evidence: BodyEvidence;
};

/** Whether a node's property holds a string. The rule reads `name`, `value` and `operator` this
 *  way, and this is the only place that has to ask what a value is. */
function stringProperty(node: AnyNode, key: string): string | null {
  const value = node[key];
  return isString(value) ? value : null;
}

/** Every node under `root`, stopping at a nested function: that function is analysed on its own,
 *  and descending would let a guard on its shadowed parameter name read as a proof out here. */
function walkOwnBody(root: AnyNode, visit: (node: AnyNode) => void): void {
  visit(root);
  for (const [key, child] of Object.entries(root)) {
    if (key === "parent") continue;
    const children = Array.isArray(child) ? child : [child];
    for (const item of children) {
      if (!isNode(item) || FUNCTION_TYPES.has(item.type)) continue;
      walkOwnBody(item, visit);
    }
  }
}

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") return parameterAnnotation(parameter.parameter);
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}

function parameterName(parameter: Parameter): string | null {
  if (parameter.type === "TSParameterProperty") return parameterName(parameter.parameter);
  if (parameter.type === "AssignmentPattern") return parameterName(parameter.left);
  if (parameter.type === "RestElement") return parameterName(parameter.argument);
  return parameter.type === "Identifier" ? parameter.name : null;
}

/** The called function's name, whether `isString(x)` or `Array.isArray(x)`. */
function calleeName(node: AnyNode): string | null {
  const callee = node["callee"];
  if (!isNode(callee)) return null;
  if (callee.type === "Identifier") return stringProperty(callee, "name");
  if (callee.type !== "MemberExpression" || callee["computed"] === true) return null;
  const property = callee["property"];
  return isNode(property) ? stringProperty(property, "name") : null;
}

function identifierName(value: unknown): string | null {
  return isNode(value) && value.type === "Identifier" ? stringProperty(value, "name") : null;
}

function isNullish(value: unknown): boolean {
  if (!isNode(value)) return false;
  if (value.type === "Literal") return value["value"] === null;
  return value.type === "Identifier" && value["name"] === "undefined";
}

/** `instanceof`, `in` and a comparison against null or undefined each prove one operand. */
function readBinary(node: AnyNode, evidence: BodyEvidence): void {
  const operator = node["operator"];
  const left = identifierName(node["left"]);
  const right = identifierName(node["right"]);
  if (operator === "instanceof" && left !== null) evidence.proved.add(left);
  if (operator === "in" && right !== null) evidence.proved.add(right);
  const comparison = operator === "===" || operator === "!==" || operator === "==" || operator === "!=";
  if (comparison && left !== null && isNullish(node["right"])) evidence.proved.add(left);
  if (comparison && right !== null && isNullish(node["left"])) evidence.proved.add(right);
}

/** A proving callee proves every identifier argument; any other call records a call edge. */
function readCall(node: AnyNode, evidence: BodyEvidence): void {
  const callee = calleeName(node);
  if (callee === null) return;
  const proves = PROVING_NAME.test(callee) || PROVING_CALLS.has(callee);
  const args = Array.isArray(node["arguments"]) ? node["arguments"] : [];
  args.forEach((argument, index) => {
    const name = identifierName(argument);
    if (name === null) return;
    if (proves) evidence.proved.add(name);
    else evidence.calls.push({ argument: name, callee, index });
  });
}

function readBody(body: AnyNode): BodyEvidence {
  const evidence: BodyEvidence = { proved: new Set(), aliases: [], calls: [] };
  walkOwnBody(body, (node) => {
    if (node.type === "UnaryExpression" && node["operator"] === "typeof") {
      const name = identifierName(node["argument"]);
      if (name !== null) evidence.proved.add(name);
      return;
    }
    if (node.type === "BinaryExpression") {
      readBinary(node, evidence);
      return;
    }
    if (node.type === "CallExpression") {
      readCall(node, evidence);
      return;
    }
    if (node.type === "VariableDeclarator") {
      const to = identifierName(node["id"]);
      const init = node["init"];
      if (to === null || !isNode(init)) return;
      walkOwnBody(init, (inner) => {
        const from = identifierName(inner);
        if (from !== null && from !== to) evidence.aliases.push({ from, to });
      });
    }
  });
  return evidence;
}

function typePredicateName(node: AnyNode): string | null {
  const returnType = node["returnType"];
  if (!isNode(returnType)) return null;
  const annotation = returnType["typeAnnotation"];
  if (!isNode(annotation) || annotation.type !== "TSTypePredicate") return null;
  return identifierName(annotation["parameterName"]);
}

export const unprovenUnknownParameterRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `unknown` parameters except where the function proves the value: a type predicate, a narrowing guard, or a value handed to another prover.",
    },
    messages: {
      unproven:
        "Parameter `{{parameter}}` arrives as `unknown` and this function never proves it. Declare the type it already has, or guard the value here so the `unknown` states a real question.",
    },
  },
  createOnce(context) {
    const analysed: Analysed[] = [];
    const byName = new Map<string, Analysed>();
    /** Signatures with no body: nothing can prove them, so they report as upstream reports them. */
    const bodiless: UnknownParameter[] = [];
    /** Source offset of a function expression -> the const or let it is assigned to. */
    const named = new Map<number, string>();

    const nameOf = (node: ESTree.Function | ESTree.ArrowFunctionExpression): string | null =>
      named.get(node.start) ?? null;

    const unknownParameters = (params: readonly Parameter[]): UnknownParameter[] =>
      params.flatMap((parameter, index) => {
        const annotation = parameterAnnotation(parameter);
        if (
          annotation === null ||
          annotation === undefined ||
          !containsUnknownType(annotation.typeAnnotation)
        ) {
          return [];
        }
        const name = parameterName(parameter);
        return name === "cause" ? [] : [{ index, name, annotation }];
      });

    const collect = (node: AnyNode, callableAs: string | null) => {
      const parameters = unknownParameters(
        /* SAFETY: every node type routed here carries an ESTree parameter list. */ node[
          "params"
        ] as Parameter[],
      );
      if (parameters.length === 0) return;
      const body = node["body"];
      if (!isNode(body)) {
        pushBodiless(node, parameters);
        return;
      }
      const entry: Analysed = {
        callableAs,
        parameters,
        predicateOn: typePredicateName(node),
        evidence: readBody(body),
      };
      analysed.push(entry);
      if (callableAs !== null) byName.set(callableAs, entry);
    };

    /** A signature with no body, minus any parameter its own return type narrows. */
    const pushBodiless = (node: AnyNode, parameters: UnknownParameter[]): void => {
      const predicateOn = typePredicateName(node);
      for (const parameter of parameters) {
        if (parameter.name !== null && parameter.name === predicateOn) continue;
        bodiless.push(parameter);
      }
    };

    const provedIndex = (entry: Analysed, index: number): boolean => {
      const parameter = entry.parameters.find((candidate) => candidate.index === index);
      // The callee declared a type at this position, so handing it an `unknown` is already the
      // proof: the compiler refuses the call unless the value has been narrowed first.
      if (parameter === undefined) return true;
      return parameter.name !== null && entry.evidence.proved.has(parameter.name);
    };

    return {
      // `createOnce` builds this state once for the whole run, so each file has to clear it. Left
      // shared, one file's proofs admit another file's parameters and reports land on nodes the
      // reporting file does not contain.
      Program: () => {
        analysed.length = 0;
        bodiless.length = 0;
        byName.clear();
        named.clear();
      },
      // Every callable with a body arrives at exactly one of these three, and each collects it
      // once. A visitor for the node that *holds* a callable beside one for the callable itself
      // reaches the same function twice and reports each unproven parameter twice: a
      // MethodDefinition visitor did that to every class method, and collecting from
      // VariableDeclarator did it to every `const f = (value: unknown) => …`. So the declarator
      // contributes the binding name the sink fixpoint travels along, and nothing else.
      VariableDeclarator: (node: ESTree.VariableDeclarator) => {
        const { init } = node;
        if (node.id.type !== "Identifier" || init === null) return;
        if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") return;
        // The declarator is visited before its own initialiser, so the name is waiting when the
        // function below asks for it.
        named.set(init.start, node.id.name);
      },
      ArrowFunctionExpression: (node: ESTree.ArrowFunctionExpression) =>
        collect(nodeFields(node), nameOf(node)),
      // This reaches a class method and a constructor too: their value is a FunctionExpression.
      FunctionExpression: (node: ESTree.Function) => collect(nodeFields(node), nameOf(node)),
      FunctionDeclaration: (node: ESTree.Function) =>
        collect(nodeFields(node), node.id === null ? null : node.id.name),
      TSCallSignatureDeclaration: (node: ESTree.TSCallSignatureDeclaration) =>
        pushBodiless(nodeFields(node), unknownParameters(node.params)),
      TSConstructSignatureDeclaration: (node: ESTree.TSConstructSignatureDeclaration) =>
        pushBodiless(nodeFields(node), unknownParameters(node.params)),
      TSConstructorType: (node: ESTree.TSConstructorType) =>
        pushBodiless(nodeFields(node), unknownParameters(node.params)),
      TSDeclareFunction: (node: ESTree.Function) =>
        pushBodiless(nodeFields(node), unknownParameters(node.params)),
      TSEmptyBodyFunctionExpression: (node: ESTree.Function) =>
        pushBodiless(nodeFields(node), unknownParameters(node.params)),
      TSFunctionType: (node: ESTree.TSFunctionType) =>
        pushBodiless(nodeFields(node), unknownParameters(node.params)),
      TSMethodSignature: (node: ESTree.TSMethodSignature) =>
        pushBodiless(nodeFields(node), unknownParameters(node.params)),

      "Program:exit": () => {
        // A proof travels: through a local alias, and into a function this file declares. Repeat
        // until nothing moves, so `hashJsonValue -> stableJson -> isPlainFiniteJson` resolves in
        // whichever order the three appear in the file.
        for (let pass = 0; pass < analysed.length + 1; pass += 1) {
          let moved = false;
          for (const entry of analysed) {
            const { proved, aliases, calls } = entry.evidence;
            for (const { from, to } of aliases) {
              if (!proved.has(to) || proved.has(from)) continue;
              proved.add(from);
              moved = true;
            }
            for (const { argument, callee, index } of calls) {
              const target = byName.get(callee);
              if (target === undefined || proved.has(argument)) continue;
              if (!provedIndex(target, index)) continue;
              proved.add(argument);
              moved = true;
            }
          }
          if (!moved) break;
        }

        const report = (name: string | null, annotation: ESTree.TSTypeAnnotation) =>
          context.report({
            node: annotation.typeAnnotation,
            messageId: "unproven",
            data: { parameter: name ?? "(destructured)" },
          });

        for (const { name, annotation } of bodiless) report(name, annotation);
        for (const entry of analysed) {
          for (const { name, annotation } of entry.parameters) {
            if (name !== null && entry.predicateOn === name) continue;
            if (name !== null && entry.evidence.proved.has(name)) continue;
            report(name, annotation);
          }
        }
      },
    };
  },
});
