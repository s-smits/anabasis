import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { asRecord, isBoolean, isNumber, type JsonValue } from "#src/meta/json-shape.ts";
import { flagBinding, isFlagType } from "../../ana/shared/flags.ts";
import { identifierName, literalValue } from "../../ana/shared/statements.ts";
import { calleeName, isTestPath } from "../../implicit-state/shared/syntax.ts";

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
 * Read as Clippy reads a struct: an interface, an object type literal or a class with more than
 * `max` boolean members (2 here, where Clippy's default is 3) is reported. A member counts when it is required and
 * its annotation is `boolean`, or `true` or `false`, with `undefined` or `null` allowed beside
 * them, or, on a class, when it has a `true` or `false` initialiser. An optional member does not
 * count: a record of optional flags is a set of settings a caller may leave out one by one (a
 * build's `minify?`, `sourcemap?`), a product of independent choices rather than one state, and on
 * foreign repositories such options records were most of what a count of every flag reported.
 * The TypeScript port adds the one record Rust does not have: the boolean `useState` cells of one
 * function, which in a React component are that component's state record (`isLoading`,
 * `isError`, `isSuccess`, `isIdle`).
 *
 * The function half counts a declaration's boolean parameters and reports more than `params`
 * (Clippy's default, 3). A repository that already reports every boolean parameter on its own
 * passes `params: null` and keeps one owner for that fact.
 *
 * The count is a stance rather than a shape. Scored against the implicit-state corpus, a record or
 * parameter list of three or more flags was a state spelled as flags in 4 of 8 labelled hits on
 * this repository, 3 of 5 on vite and 3 of 9 on excalidraw, since most records of flags elsewhere
 * hold independent options; at Clippy's four or more it was 1 of 5 here. So `max` defaults to 2.
 * The shapes (flags a class's methods move, a flag derived from two others) are `flags-as-state`.
 *
 * A member typed as one literal (`procedure: true`, `declare isNamespace: true`) is a brand or a
 * discriminant, and a `readonly` field given a literal (`readonly isCluster = false`) is a constant,
 * so neither counts. A `readonly` field the constructor computes (`this.isNamespace = name === "*"`)
 * still does: two such projections of one value are the shape the count is for.
 *
 * Test files and declaration files (`.d.ts`, another package's interface described) are not read:
 * a fixture lists its flags beside each other on purpose.
 *
 * There is no fix: which states the flags stand for is the whole change.
 */
const MAX_FIELDS = 2;
const MAX_PARAMS = 3;
const DECLARATION = /\.d\.[cm]?ts$/u;

type FunctionLike = ESTree.Function | ESTree.ArrowFunctionExpression | ESTree.TSMethodSignature;

/** The name a member declares, for the message. */
function memberName(key: ESTree.Node): string {
  return identifierName(key) ?? "member";
}

/** Whether an annotation is a flag that can change: a brand or discriminant (`ready: true`) is not. */
const changingFlag = (type: ESTree.TSType | undefined): boolean =>
  type?.type !== "TSLiteralType" && isFlagType(type);

/** The boolean members of an interface or a type literal, by name. */
function booleanSignatures(members: readonly ESTree.TSSignature[]): string[] {
  return members.flatMap((member) =>
    member.type === "TSPropertySignature" &&
    !member.optional &&
    changingFlag(member.typeAnnotation?.typeAnnotation)
      ? [memberName(member.key)]
      : [],
  );
}

/** The boolean fields of a class body: annotated `boolean`, or initialised to a boolean literal. */
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

/** Whether a call is a `useState` cell holding a boolean: a boolean literal, or `<boolean>`. */
function booleanCell(call: ESTree.CallExpression): boolean {
  if (calleeName(call) !== "useState") {
    return false;
  }
  const [initial] = call.arguments;
  const typed = call.typeArguments?.params[0];
  return isBoolean(literalValue(initial)) || isFlagType(typed);
}

/** The name a `const [x, setX] = useState(…)` binds, or a placeholder. */
function cellName(call: ESTree.CallExpression): string {
  const declarator = call.parent;
  if (declarator?.type !== "VariableDeclarator" || declarator.id.type !== "ArrayPattern") {
    return "state";
  }
  const [first] = declarator.id.elements;
  return identifierName(first) ?? "state";
}

/** A threshold option: a number, or null to leave that half to another rule. */
function threshold(option: JsonValue | undefined, fallback: number): number | null {
  if (option === null) {
    return null;
  }
  return isNumber(option) ? option : fallback;
}

export const flagCountRule = defineRule({
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

    return {
      TSInterfaceDeclaration: (node) =>
        record(node, `\`${node.id.name}\``, booleanSignatures(node.body.body)),
      TSTypeLiteral: (node) => record(node, "this object type", booleanSignatures(node.members)),
      ClassBody: (node) => record(node, "this class", booleanFields(node)),
      CallExpression: (node) => {
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
