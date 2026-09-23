import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { isRepresentationOwner, REPRESENTATION_OWNER } from "../shared/representation-owner.ts";

/** The keyword a type predicate names for what each `typeof` answer establishes by itself. */
const ESTABLISHED = new Map([
  ["string", "TSStringKeyword"],
  ["number", "TSNumberKeyword"],
  ["boolean", "TSBooleanKeyword"],
  ["object", "TSObjectKeyword"],
]);

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isRuntimeFunction(node: ESTree.Node): node is RuntimeFunction {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression"
  );
}

function isInsideTypeGuard(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (isRuntimeFunction(current)) {
      return current.returnType?.typeAnnotation.type === "TSTypePredicate";
    }
    current = current.parent;
  }
  return false;
}

/** Return whether typeof safely probes for the existence of a possibly absent binding. */
function isExistenceProbe(node: ESTree.UnaryExpression): boolean {
  const { parent } = node;
  if (parent.type !== "BinaryExpression") return false;
  if (!["===", "!==", "==", "!="].includes(parent.operator)) return false;
  const other = parent.left === node ? parent.right : parent.left;
  return other.type === "Literal" && other.value === "undefined";
}

/** The function declaration whose whole body is `return <expression>;`, or null. */
function wholeBodyOf(expression: ESTree.Node): ESTree.Function | null {
  const statement = expression.parent;
  if (statement?.type !== "ReturnStatement") return null;
  const block = statement.parent;
  if (block.type !== "BlockStatement" || block.body.length !== 1) return null;
  return block.parent.type === "FunctionDeclaration" ? block.parent : null;
}

/** `<tested> && name !== null`, the one addition `object` needs because `typeof null` is `"object"`. */
function excludesNull(returned: ESTree.Node, tested: ESTree.Node, name: string): boolean {
  if (returned.type !== "LogicalExpression" || returned.left !== tested) return false;
  const { operator, right } = returned;
  return (
    operator === "&&" &&
    right.type === "BinaryExpression" &&
    right.operator === "!==" &&
    right.left.type === "Identifier" &&
    right.left.name === name &&
    right.right.type === "Literal" &&
    right.right.value === null
  );
}

/** A function type written in place, or the name of one this file declares as an alias. */
function namesFunctionType(type: ESTree.TSType, program: ESTree.Program): boolean {
  if (type.type === "TSFunctionType") return true;
  if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return false;
  const { name } = type.typeName;
  return program.body.some((statement) => {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    return (
      declaration?.type === "TSTypeAliasDeclaration" &&
      declaration.id.name === name &&
      declaration.typeAnnotation.type === "TSFunctionType"
    );
  });
}

/** Whether `fn` takes one `unknown` parameter called `name` and declares `name is <what answer establishes>`. */
function predicatesAnswer(
  fn: ESTree.Function,
  name: string,
  answer: string,
  program: ESTree.Program,
): boolean {
  const [parameter, ...rest] = fn.params;
  if (rest.length > 0 || parameter?.type !== "Identifier" || parameter.name !== name) return false;
  if (parameter.typeAnnotation?.typeAnnotation.type !== "TSUnknownKeyword") return false;
  const predicate = fn.returnType?.typeAnnotation;
  if (predicate?.type !== "TSTypePredicate" || predicate.asserts) return false;
  if (predicate.parameterName.type !== "Identifier" || predicate.parameterName.name !== name) return false;
  const named = predicate.typeAnnotation?.typeAnnotation;
  if (named === undefined) return false;
  return answer === "function" ? namesFunctionType(named, program) : ESTABLISHED.get(answer) === named.type;
}

/**
 * Whether this `typeof` is the whole of a primitive predicate in the representation owner, such as
 * `function isString(value: unknown): value is string { return typeof value === "string"; }`.
 *
 * The predicate must name exactly the type the answer establishes, so `value is number` over
 * `"string"` is still reported, and `"object"` must also exclude null. A decoder is built from
 * these leaves; the owner holds them once, and a copy in any other file is still reported.
 */
function isOwnedPrimitivePredicate(
  node: ESTree.UnaryExpression,
  filename: string,
  program: ESTree.Program,
): boolean {
  if (!isRepresentationOwner(filename) || node.argument.type !== "Identifier") return false;
  const comparison = node.parent;
  if (comparison.type !== "BinaryExpression" || comparison.left !== node) return false;
  const answer =
    comparison.operator === "===" && comparison.right.type === "Literal" ? comparison.right.value : null;
  if (!isString(answer)) return false;
  const { name } = node.argument;
  const returned = answer === "object" ? comparison.parent : comparison;
  if (answer === "object" && !excludesNull(returned, comparison, name)) return false;
  const fn = wholeBodyOf(returned);
  return fn !== null && predicatesAnswer(fn, name, answer, program);
}

/**
 * A `typeof` in running code, which narrows a value by asking what it happens to be rather than
 * by parsing it into something the rest of the program can rely on.
 *
 * The narrowing works, and that is what makes it attractive: `typeof value === "string"` hands
 * the branch below a `string` and the compiler agrees. What it does not do is establish anything
 * about the value as a domain object, so the same question gets asked again at the next reader,
 * and each caller ends up with its own idea of which shapes the input can take. A decoder at the
 * boundary asks once and gives everyone downstream a type with a name.
 *
 * Three things are admitted. A `typeof x === "undefined"` comparison is an existence probe, and
 * it is the only expression in the language that can ask about a binding that may not exist at
 * all, so `isExistenceProbe` passes it. The primitive predicates a decoder is built out of are
 * admitted in the module that owns them and nowhere else, by `isOwnedPrimitivePredicate`, which
 * requires the whole function body to be the check and the declared predicate to name exactly
 * what the answer establishes — `value is number` over a `"string"` test is still reported, and
 * `"object"` must exclude null as well, since `typeof null` is `"object"`. The message names that
 * owning module, so a report tells the reader where the check they wanted already lives.
 *
 * The third is `allowInTypeGuards`, an option that would admit any `typeof` inside a function
 * declaring a type predicate. Nothing in this repository sets it: it appears in this file's
 * schema, its default and its one read, and nowhere else, so every run here has it false.
 * `.oxlintrc.json` instead turns the whole rule off for `.js` and `.mjs` files, which carry no
 * annotations to decode into.
 *
 * There is no fix: the repair is a decoder at the I/O boundary, which is a new function and a new
 * type.
 */
export const noRuntimeTypeofRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
    },
    messages: {
      runtimeTypeof:
        "A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary with the predicates {{owner}} owns, then branch on the domain value.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowInTypeGuards: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowInTypeGuards: false }],
  },
  createOnce(context) {
    return {
      UnaryExpression(node) {
        const allowInTypeGuards = asRecord(context.options?.[0])?.["allowInTypeGuards"] === true;
        if (
          node.operator === "typeof" &&
          !isExistenceProbe(node) &&
          (!allowInTypeGuards || !isInsideTypeGuard(node)) &&
          !isOwnedPrimitivePredicate(node, context.filename, context.sourceCode.ast)
        ) {
          context.report({ node, messageId: "runtimeTypeof", data: { owner: REPRESENTATION_OWNER } });
        }
      },
    };
  },
});
