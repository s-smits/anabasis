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
 * The shapes (flags a class's methods move, a flag derived from two others) are `prefer-state-union`.
 *
 * A member typed as one literal (`procedure: true`, `declare isNamespace: true`) is a brand or a
 * discriminant, and a `readonly` field given a literal (`readonly isCluster = false`) is a constant,
 * so neither counts. A `readonly` field the constructor computes (`this.isNamespace = name === "*"`)
 * still does: two such projections of one value are the shape the count is for.
 *
 * Two interfaces are read as independent flags rather than one state. One that a parse call is
 * typed with (`parseJsonAs<StoredSolve>(text)`, `JSON.parse(text) as StoredSolve`) describes bytes
 * another writer laid down, which the reader spells as they are, as a declaration file describes
 * another package. And one whose every object literal in the file builds each flag from names no
 * other flag reads (`wallEnded: deadline.aborted`, `moved: stamp() !== before`) records separate
 * observations, as a membership `marks.has("blind")` beside `marks.has("alone")` records separate
 * tags: two flags compared from one value (`kind === "using"`, `kind === "const"`) still count, and
 * so does a literal of constants (`{ open: false, closed: false }`), which shows nothing. On this
 * repository, 9 November 2026, these were three of the four interfaces the count reported in
 * `tools/` and `src/`; the fourth held projections of one run state and became that state.
 *
 * Test files and declaration files (`.d.ts`, another package's interface described) are not read:
 * a fixture lists its flags beside each other on purpose.
 *
 * There is no fix: which states the flags stand for is the whole change.
 */
const MAX_FIELDS = 2;
const MAX_PARAMS = 3;
const DECLARATION = /\.d\.[cm]?ts$/u;
const PARSE = /parse/iu;

type FunctionLike = ESTree.Function | ESTree.ArrowFunctionExpression | ESTree.TSMethodSignature;

/** A record the count reported, held until the file's parse calls and object literals are read. */
interface Candidate {
  readonly node: ESTree.Node;
  readonly what: string;
  /** The interface's or type alias's name; null for a type literal written in place. */
  readonly name: string | null;
  readonly flags: readonly string[];
}

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

/** Whether `node` asks a set for one literal key: `marks.has("blind")`. */
const membership = (node: ESTree.Node): boolean =>
  node.type === "CallExpression" &&
  propertyName(node.callee) === "has" &&
  node.arguments.length === 1 &&
  literalValue(node.arguments[0]) !== undefined;

/** The names a flag's value reads: each identifier not reached through a member, `undefined` aside,
 *  and none for a membership, since one key's membership tells nothing of another's. */
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

/** Whether an object literal builds each of `flags` from what no other of them reads, with no flag
 *  a constant: a literal of constants shows nothing, and two flags that read one name may be one state. */
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

/** The type a parse call is typed with, by its type argument or an `as` around it. */
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

    /** Whether a record's flags are separate facts: the shape of a parsed file, or built apart. */
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
