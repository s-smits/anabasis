import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { asRecord, isBoolean, isNumber, type JsonValue } from "#src/meta/json-shape.ts";
import { flagBinding, isFlagType } from "../../ana/shared/flags.ts";
import { identifierName, isNamedMember, literalValue, propertyName } from "../../ana/shared/statements.ts";
import { isNode } from "../../anti-slop/shared/ast-node.ts";
import { calleeName, isTestPath, objectValues } from "../../implicit-state/shared/syntax.ts";

/**
 * Tier: opinionated. Ported from Clippy's `struct_excessive_bools` and `fn_params_excessive_bools`
 * (rust-lang/rust-clippy, `clippy_lints/src/excessive_bools.rs`, at 146674fd), which began as
 * Armin Ronacher's `rust-excessive-bools-lint` (at 0f95d162); `THIRD_PARTY_NOTICES.md` records both.
 *
 * Several booleans on one record are often one state spelled as flags: `isPending`,
 * `isProcessing` and `isFinished` admit eight combinations of which three mean anything, and every
 * reader has to know which five never happen. One union, or a discriminated union where each
 * state carries its own data, makes the impossible combinations unspellable.
 *
 * There is no fix: which states the flags stand for is the whole change.
 */
const MAX_FIELDS = 3;
const MAX_PARAMS = 3;
const DECLARATION = /\.d\.[cm]?ts$/u;
const PARSE = /parse/iu;

type FunctionLike = ESTree.Function | ESTree.ArrowFunctionExpression | ESTree.TSMethodSignature;

interface Candidate {
  readonly node: ESTree.Node;
  readonly what: string;
  readonly name: string | null;
  readonly flags: readonly string[];
}

function memberName(key: ESTree.Node): string {
  return identifierName(key) ?? "member";
}

/** Whether an annotation is a flag that can change: a brand or discriminant (`ready: true`) is not. */
const changingFlag = (type: ESTree.TSType | undefined): boolean =>
  type?.type !== "TSLiteralType" && isFlagType(type);

function booleanSignatures(members: readonly ESTree.TSSignature[]): string[] {
  return members.flatMap((member) =>
    member.type === "TSPropertySignature" &&
    !member.optional &&
    changingFlag(member.typeAnnotation?.typeAnnotation)
      ? [memberName(member.key)]
      : [],
  );
}

function booleanFields(body: ESTree.ClassBody): string[] {
  return body.body.flatMap((member) => {
    if (member.type !== "PropertyDefinition" || member.static || member.optional === true) {
      return [];
    }
    const literal = isBoolean(literalValue(member.value));
    if (member.readonly === true && literal) {
      return [];
    }
    return changingFlag(member.typeAnnotation?.typeAnnotation) || literal ? [memberName(member.key)] : [];
  });
}

function booleanCell(call: ESTree.CallExpression): boolean {
  if (calleeName(call) !== "useState") {
    return false;
  }
  const [initial] = call.arguments;
  const typed = call.typeArguments?.params[0];
  return isBoolean(literalValue(initial)) || isFlagType(typed);
}

function cellName(call: ESTree.CallExpression): string {
  const declarator = call.parent;
  if (declarator?.type !== "VariableDeclarator" || declarator.id.type !== "ArrayPattern") {
    return "state";
  }
  const [first] = declarator.id.elements;
  return identifierName(first) ?? "state";
}

const membership = (node: ESTree.Node): boolean =>
  node.type === "CallExpression" &&
  propertyName(node.callee) === "has" &&
  node.arguments.length === 1 &&
  literalValue(node.arguments[0]) !== undefined;

/** A membership reads no names, since one key's membership tells nothing of another's. */
function namesRead(node: ESTree.Node, into: Set<string>): Set<string> {
  if (membership(node)) return into;
  if (node.type === "Identifier") {
    if (node.name !== "undefined") into.add(node.name);
    return into;
  }
  if (isNamedMember(node)) return namesRead(node.object, into);
  for (const [key, child] of Object.entries(node)) {
    if (key === "parent") continue;
    for (const item of Array.isArray(child) ? child : [child]) {
      if (isNode(item)) namesRead(item, into);
    }
  }
  return into;
}

/** A literal of constants shows nothing, and two flags that read one name may be one state. */
function separate(values: ReadonlyMap<string, ESTree.Node>, flags: readonly string[]): boolean {
  const built = flags.flatMap((flag) => values.get(flag) ?? []);
  const reads = built.map((value) => [...namesRead(value, new Set())]);
  const read = reads.flat();
  return (
    built.length === flags.length &&
    built.every((value, at) => (reads[at]?.length ?? 0) > 0 || membership(value)) &&
    new Set(read).size === read.length
  );
}

function parsedType(node: ESTree.CallExpression): string | null {
  if (!PARSE.test(calleeName(node) ?? "")) return null;
  const [argument] = node.typeArguments?.params ?? [];
  const cast = node.parent?.type === "TSAsExpression" ? node.parent.typeAnnotation : undefined;
  const type = argument ?? cast;
  return type?.type === "TSTypeReference" ? identifierName(type.typeName) : null;
}

/** A threshold option: a number, or null to leave that half to another rule. */
function threshold(option: JsonValue | undefined, fallback: number): number | null {
  if (option === null) {
    return null;
  }
  return isNumber(option) ? option : fallback;
}

export const maxBooleanFieldsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Several booleans on one record are one state spelled as flags; name the states.",
      examples: [
        {
          before:
            "export interface Job {\n  queued: boolean;\n  running: boolean;\n  done: boolean;\n  failed: boolean;\n}",
          after: 'export interface Job {\n  state: "queued" | "running" | "done" | "failed";\n}',
        },
      ] satisfies RuleExample[],
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "number" }, params: { type: ["number", "null"] } },
        additionalProperties: false,
      },
    ],
    messages: {
      record:
        "{{what}} holds {{count}} booleans ({{names}}), more than {{max}}. Flags admit every combination; a union of named states admits only the ones that happen.",
      parameters:
        "`{{fn}}` takes {{count}} boolean parameters, more than {{max}}. Name the modes with string-literal unions, or split the operation.",
    },
  },
  create(context) {
    if (isTestPath(context.filename) || DECLARATION.test(context.filename)) {
      return {};
    }
    const option = asRecord(context.options[0]) ?? {};
    const max = threshold(option.max, MAX_FIELDS) ?? MAX_FIELDS;
    const params = threshold(option.params, MAX_PARAMS);
    const cells = new Map<ESTree.Node, string[]>();
    const candidates: Candidate[] = [];
    const parsed = new Set<string>();
    const literals: ReadonlyMap<string, ESTree.Node>[] = [];

    function record(node: ESTree.Node, what: string, names: readonly string[]): void {
      if (names.length <= max) {
        return;
      }
      const data = { what, count: String(names.length), names: names.join(", "), max: String(max) };
      context.report({ node, messageId: "record", data });
    }

    function parameters(node: FunctionLike, fn: string): void {
      if (params === null) {
        return;
      }
      const flags = node.params.filter((parameter) => flagBinding(parameter) !== null);
      if (flags.length <= params) {
        return;
      }
      context.report({
        node,
        messageId: "parameters",
        data: { fn, count: String(flags.length), max: String(params) },
      });
    }

    const named = (node: { id?: ESTree.Node | null }): string => identifierName(node.id) ?? "this function";

    function independent({ name, flags }: Candidate): boolean {
      if (name !== null && parsed.has(name)) return true;
      const building = literals.filter((values) => flags.every((flag) => values.has(flag)));
      return building.length > 0 && building.every((values) => separate(values, flags));
    }

    return {
      TSInterfaceDeclaration: (node) =>
        candidates.push({
          node,
          what: `\`${node.id.name}\``,
          name: node.id.name,
          flags: booleanSignatures(node.body.body),
        }),
      TSTypeLiteral: (node) =>
        candidates.push({
          node,
          what: "this object type",
          name: node.parent?.type === "TSTypeAliasDeclaration" ? node.parent.id.name : null,
          flags: booleanSignatures(node.members),
        }),
      ObjectExpression: (node) => literals.push(objectValues(node)),
      ClassBody: (node) => record(node, "this class", booleanFields(node)),
      CallExpression: (node) => {
        const type = parsedType(node);
        if (type !== null) parsed.add(type);
        if (!booleanCell(node)) {
          return;
        }
        let owner: ESTree.Node | null = node.parent;
        while (
          owner !== null &&
          owner.type !== "FunctionDeclaration" &&
          owner.type !== "ArrowFunctionExpression" &&
          owner.type !== "FunctionExpression"
        ) {
          owner = owner.parent;
        }
        if (owner !== null) {
          cells.set(owner, [...(cells.get(owner) ?? []), cellName(node)]);
        }
      },
      "Program:exit": () => {
        for (const candidate of candidates) {
          if (candidate.flags.length > max && !independent(candidate)) {
            record(candidate.node, candidate.what, candidate.flags);
          }
        }
        for (const [owner, names] of cells) {
          record(owner, "this function's `useState` record", names);
        }
      },
      FunctionDeclaration: (node) => parameters(node, named(node)),
      TSDeclareFunction: (node) => parameters(node, named(node)),
      FunctionExpression: (node) => parameters(node, named(node)),
      ArrowFunctionExpression: (node) => {
        const holder = node.parent;
        const fn =
          holder?.type === "VariableDeclarator" && holder.id.type === "Identifier"
            ? holder.id.name
            : "this function";
        parameters(node, fn);
      },
      TSMethodSignature: (node) => parameters(node, memberName(node.key)),
    };
  },
});
