import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isString } from "#src/meta/json-shape.ts";
import { isNode, type KeyedNode as AnyNode, nodeFields } from "../../anti-slop/shared/ast-node.ts";
import { containsUnknownType } from "../shared/unknown-type.ts";

/**
 * Flags an `unknown` parameter that the function never narrows or proves (via a type predicate,
 * a narrowing guard, a call to a recognised validator matching `PROVING_NAME` or `PROVING_CALLS`,
 * or an alias that is itself proved). Signatures without a body (`TSFunctionType`,
 * `TSMethodSignature`, overloads) are reported unless their return type is a type predicate on
 * that parameter. There is no fix.
 */

type Parameter = ESTree.ParamPattern;

const PROVING_NAME = /^(is|as|has|assert|ensure|require|validate|parse)[A-Z0-9]/u;

/** Owners whose names miss the pattern above: `errorMessage` and `errorCode`
 *  (`src/meta/runtime-values.ts`) are total on `unknown`, the one place a caught value becomes text
 *  or a code. A call that only consumes the value, `String(value)` or `JSON.stringify(value)`, is
 *  what this rule reports and must not be added. */
const PROVING_CALLS = new Set(["errorMessage", "errorCode"]);

const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"]);

interface BodyEvidence {
  proved: Set<string>;
  /** `const to = f(from)`: proving `to` proves `from`. */
  aliases: { from: string; to: string }[];
  calls: { argument: string; callee: string; index: number }[];
}

/** Keeps its position in the real parameter list: a call edge arrives by argument position. */
interface UnknownParameter {
  index: number;
  name: string | null;
  annotation: ESTree.TSTypeAnnotation;
}

interface Analysed {
  callableAs: string | null;
  parameters: UnknownParameter[];
  predicateOn: string | null;
  evidence: BodyEvidence;
}

function stringProperty(node: AnyNode, key: string): string | null {
  const value = node[key];
  return isString(value) ? value : null;
}

/** Every node under `root`, stopping at a nested function: that one is analysed on its own, so a guard
 *  on its shadowed parameter name proves nothing out here. */
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
  return identifierName(parameter);
}

function calleeName(node: AnyNode): string | null {
  const callee = node.callee;
  if (!isNode(callee)) return null;
  if (callee.type === "Identifier") return stringProperty(callee, "name");
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  const property = callee.property;
  return isNode(property) ? stringProperty(property, "name") : null;
}

function identifierName(value: unknown): string | null {
  return isNode(value) && value.type === "Identifier" ? stringProperty(value, "name") : null;
}

function isNullish(value: unknown): boolean {
  if (!isNode(value)) return false;
  if (value.type === "Literal") return value.value === null;
  return identifierName(value) === "undefined";
}

function readBinary(node: AnyNode, evidence: BodyEvidence): void {
  const operator = node.operator;
  const left = identifierName(node.left);
  const right = identifierName(node.right);
  if (operator === "instanceof" && left !== null) evidence.proved.add(left);
  if (operator === "in" && right !== null) evidence.proved.add(right);
  const comparison = operator === "===" || operator === "!==" || operator === "==" || operator === "!=";
  if (comparison && left !== null && isNullish(node.right)) evidence.proved.add(left);
  if (comparison && right !== null && isNullish(node.left)) evidence.proved.add(right);
}

function readCall(node: AnyNode, evidence: BodyEvidence): void {
  const callee = calleeName(node);
  if (callee === null) return;
  const proves = PROVING_NAME.test(callee) || PROVING_CALLS.has(callee);
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  for (const [index, argument] of args.entries()) {
    const name = identifierName(argument);
    if (name === null) continue;
    if (proves) evidence.proved.add(name);
    else evidence.calls.push({ argument: name, callee, index });
  }
}

function readBody(body: AnyNode): BodyEvidence {
  const evidence: BodyEvidence = { proved: new Set(), aliases: [], calls: [] };
  walkOwnBody(body, (node) => {
    if (node.type === "UnaryExpression" && node.operator === "typeof") {
      const name = identifierName(node.argument);
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
      const to = identifierName(node.id);
      const init = node.init;
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
  const returnType = node.returnType;
  if (!isNode(returnType)) return null;
  const annotation = returnType.typeAnnotation;
  if (!isNode(annotation) || annotation.type !== "TSTypePredicate") return null;
  return identifierName(annotation.parameterName);
}

export const noUnprovenUnknownParameterRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `unknown` parameters except where the function proves the value: a type predicate, a narrowing guard, or a value handed to another prover.",
      examples: [
        {
          before:
            "function appendCompleted(path: string, value: unknown): void {\n  appendFileSync(path, capturedJsonStringify(value));\n}",
          after:
            "function appendCompleted(path: string, value: JsonValue): void {\n  appendFileSync(path, capturedJsonStringify(value));\n}",
        },
        {
          before: "function taskIdOf(value: unknown): string {\n  return (value as Task).id;\n}",
          after:
            "function taskIdOf(value: unknown): string | null {\n  return isRecord(value) && isString(value.id) ? value.id : null;\n}",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      unproven:
        "Parameter `{{parameter}}` arrives as `unknown` and this function never proves it. Declare the type it already has, or guard the value here so the `unknown` states a real question.",
    },
  },
  createOnce(context) {
    const analysed: Analysed[] = [];
    const byName = new Map<string, Analysed>();
    const bodiless: UnknownParameter[] = [];
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
        /* SAFETY: every node type routed here carries an ESTree parameter list. */ node.params as Parameter[],
      );
      if (parameters.length === 0) return;
      const body = node.body;
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

    const pushBodiless = (node: AnyNode, parameters: UnknownParameter[]): void => {
      const predicateOn = typePredicateName(node);
      for (const parameter of parameters) {
        if (parameter.name !== null && parameter.name === predicateOn) continue;
        bodiless.push(parameter);
      }
    };

    const provedIndex = (entry: Analysed, index: number): boolean => {
      const parameter = entry.parameters.find((candidate) => candidate.index === index);
      // The callee declared a type at this position, so the compiler already refuses an unnarrowed
      // `unknown`.
      if (parameter === undefined) return true;
      return parameter.name !== null && entry.evidence.proved.has(parameter.name);
    };

    return {
      // `createOnce` builds this state once a run; uncleared, one file's proofs admit another's parameters.
      Program: () => {
        analysed.length = 0;
        bodiless.length = 0;
        byName.clear();
        named.clear();
      },
      // Every callable with a body arrives at exactly one of these three. The declarator, visited before
      // its initialiser, only supplies the binding name: collecting there too reports each parameter twice.
      VariableDeclarator: (node: ESTree.VariableDeclarator) => {
        const { init } = node;
        if (node.id.type !== "Identifier" || init === null) return;
        if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") return;
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
        // A proof travels through a local alias and into a function this file declares; repeat
        // until nothing moves, so the order in the file does not matter.
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
