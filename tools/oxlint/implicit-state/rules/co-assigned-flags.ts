import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { asRecord, isNumber, type JsonValue } from "#src/meta/json-shape.ts";
import {
  everyStatementList,
  identifierName,
  literalValue,
  memberObject,
  plainAssignment,
  propertyName,
} from "../../ana/shared/statements.ts";
import { isTestPath, setterState } from "../shared/syntax.ts";

/**
 * Tier: generic. Fields of one state that are written together, where each write sets at most one
 * of them, are one mode with no name. `isLoading`, `isError` and `isSuccess` set as `true, false,
 * false`, then `false, false, true`, then `false, true, false` are a request's phase spelled three
 * times over: nothing stops a later write from setting two, and every reader has to know which
 * combinations the writers keep to. The same holds for a drawing tool's `isResizing`, `isRotating`
 * and `editingElement`, where the element is set only while neither flag is. One discriminated
 * field (`phase: "loading" | "error" | "success" | "idle"`) makes the other combinations
 * unspellable.
 *
 * A co-write is the fields of one state written in one place: an object handed to a setter
 * (`setState({ … })`, `this.setState({ … })`, or an updater returning one), an object that updates
 * another by spreading it (`{ ...state, … }`), or a run of statements that assigns fields of one
 * object (`tool.isResizing = true; tool.isRotating = false;`) or calls a function's `useState`
 * setters one after another. A field is set when it is written anything but `false`, `null` or
 * `undefined`. Fields of one state form a cluster when each pair of them is written together at
 * least `writes` times and each is set in some co-write that clears the other, and the cluster is
 * reported once, at its first write, when it holds at least `fields` fields and at most one of them
 * is set in a share `exclusive` of the co-writes that touch it.
 *
 * Not reported: an object created whole and passed on (a config, whose options are independent
 * choices), fields set together (`{ x, y }`), and a reset that clears every field, which on its own
 * shows no mode. Test files are not read.
 *
 * There is no fix: what the mode is called and what each state carries is the change.
 */
const FIELDS = 2;
const WRITES = 3;
const EXCLUSIVE = 0.9;

/** A field's value in one co-write: set to something, or cleared. */
type Value = "set" | "clear";

/** The fields of one state written in one place. */
interface CoWrite {
  state: string;
  fields: Map<string, Value>;
  node: ESTree.Node;
}

/** The state a call's setter sets, by its name or its method's name. */
const setterOfCall = (callee: ESTree.Node): string | null =>
  setterState(identifierName(callee) ?? propertyName(callee));

/** Whether a written value clears the field: `false`, `null`, `undefined` or `void 0`. */
function valueOf(node: ESTree.Node): Value {
  const literal = literalValue(node);
  const cleared =
    literal === false ||
    literal === null ||
    identifierName(node) === "undefined" ||
    (node.type === "UnaryExpression" && node.operator === "void");
  return cleared ? "clear" : "set";
}

/** The fields an object literal writes, by name; a spread or a computed key writes none. */
function objectFields(object: ESTree.ObjectExpression): Map<string, Value> {
  const fields = new Map<string, Value>();
  for (const property of object.properties) {
    const name = property.type === "Property" && !property.computed ? identifierName(property.key) : null;
    if (property.type === "Property" && name !== null) {
      fields.set(name, valueOf(property.value));
    }
  }
  return fields;
}

/** The setter an object reaches as its argument, or as what an updater passed to it returns:
 *  `setState({ … })`, `setState((prev) => ({ … }))` or `setState((prev) => { return { … }; })`. */
function setterOf(object: ESTree.ObjectExpression): string | null {
  let at: ESTree.Node = object;
  for (let up: ESTree.Node | null = at.parent; up !== null; up = up.parent) {
    if (up.type === "CallExpression") {
      return up.arguments.some((argument) => argument === at) ? setterOfCall(up.callee) : null;
    }
    const through =
      up.type === "ParenthesizedExpression" ||
      up.type === "ReturnStatement" ||
      up.type === "ArrowFunctionExpression" ||
      (up.type === "BlockStatement" && up.body.length === 1);
    if (!through) {
      return null;
    }
    at = up;
  }
  return null;
}

/** The state a function's `useState` setters belong to: its outermost enclosing function. */
function component(node: ESTree.Node): string {
  let found = "useState";
  for (let at = node.parent; at !== null && at !== undefined; at = at.parent) {
    if (at.type === "FunctionDeclaration" || at.type === "FunctionExpression") {
      found = `useState of ${identifierName(at.id) ?? "a function"}`;
    } else if (at.type === "ArrowFunctionExpression") {
      found = "useState of an arrow";
    }
  }
  return found;
}

/** A threshold option, or its default where the option is not a number. */
const numberOr = (option: JsonValue | undefined, fallback: number): number =>
  isNumber(option) ? option : fallback;

/** The name a state takes in the suggested union: `loading` for `isLoading`. */
const stateName = (field: string): string => {
  const word = /^(?:is|has)([A-Z]\w*)$/u.exec(field)?.[1];
  return word === undefined ? field : `${word.charAt(0).toLowerCase()}${word.slice(1)}`;
};

/** The clusters of one state's co-writes: fields linked pairwise, joined into components. */
function clusters(writes: readonly CoWrite[], minWrites: number): string[][] {
  const names = [...new Set(writes.flatMap((write) => [...write.fields.keys()]))];
  const parent = new Map(names.map((name) => [name, name]));
  const root = (name: string): string => {
    const up = parent.get(name) ?? name;
    return up === name ? name : root(up);
  };
  for (const [index, a] of names.entries()) {
    for (const b of names.slice(index + 1)) {
      const both = writes.filter((write) => write.fields.has(a) && write.fields.has(b));
      const only = (x: string, y: string): boolean =>
        both.some((write) => write.fields.get(x) === "set" && write.fields.get(y) === "clear");
      if (both.length >= minWrites && only(a, b) && only(b, a)) {
        parent.set(root(a), root(b));
      }
    }
  }
  return [...Map.groupBy(names, root).values()];
}

export const coAssignedFlagsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Fields written together where each write sets at most one are an unnamed mode; name it.",
      examples: [
        {
          before:
            "setState({ isLoading: true, isError: false, isSuccess: false });\nsetState({ isLoading: false, isError: false, isSuccess: true });\nsetState({ isLoading: false, isError: true, isSuccess: false });",
          after:
            'setState({ phase: "loading" });\nsetState({ phase: "success" });\nsetState({ phase: "error" });',
        },
      ] satisfies RuleExample[],
    },
    schema: [
      {
        type: "object",
        properties: { fields: { type: "number" }, writes: { type: "number" }, exclusive: { type: "number" } },
        additionalProperties: false,
      },
    ],
    messages: {
      mode: "{{names}} of `{{state}}` are written together {{count}} times and at most one is set in each; the combinations seen are {{seen}}. They are one mode with no name: hold it in one field, such as `{{suggest}}`.",
    },
  },
  create(context) {
    if (isTestPath(context.filename)) {
      return {};
    }
    const option = asRecord(context.options[0]) ?? {};
    const minFields = numberOr(option.fields, FIELDS);
    const minWrites = numberOr(option.writes, WRITES);
    const share = numberOr(option.exclusive, EXCLUSIVE);
    const writes: CoWrite[] = [];
    const text = (node: ESTree.Node): string => context.sourceCode.getText(node).replaceAll(/\s+/gu, "");

    /** One statement's write: a field of an object assigned, or a `useState` setter called. */
    function statementWrite(statement: ESTree.Statement): [string, string, Value, ESTree.Node] | null {
      const assigned = plainAssignment(statement);
      if (assigned !== null) {
        const field = propertyName(assigned.left);
        const object = memberObject(assigned.left);
        return field !== null && object !== null
          ? [text(object), field, valueOf(assigned.right), statement]
          : null;
      }
      const expression = statement.type === "ExpressionStatement" ? statement.expression : null;
      const [argument] = expression?.type === "CallExpression" ? expression.arguments : [];
      const field =
        expression?.type === "CallExpression" && expression.callee.type === "Identifier"
          ? setterOfCall(expression.callee)
          : null;
      if (field === null || argument === undefined || argument.type === "SpreadElement") {
        return null;
      }
      return [component(statement), field, valueOf(argument), statement];
    }

    /** The co-writes of each run of consecutive writing statements, one per state written. */
    function runs(body: readonly ESTree.Statement[]): void {
      let run: [string, string, Value, ESTree.Node][] = [];
      const close = (): void => {
        for (const [state, under] of Map.groupBy(run, ([owner]) => owner)) {
          const [first] = under;
          if (first !== undefined && under.length >= 2) {
            writes.push({
              state,
              fields: new Map(under.map(([, field, value]) => [field, value])),
              node: first[3],
            });
          }
        }
        run = [];
      };
      for (const statement of body) {
        const write = statementWrite(statement);
        if (write === null) {
          close();
        } else {
          run.push(write);
        }
      }
      close();
    }

    return {
      ...everyStatementList(runs),
      ObjectExpression: (node) => {
        const spread = node.properties.find((property) => property.type === "SpreadElement");
        const state = setterOf(node) ?? (spread === undefined ? null : text(spread.argument));
        const fields = objectFields(node);
        if (state !== null && fields.size >= 2) {
          writes.push({ state, fields, node });
        }
      },
      "Program:exit": () => {
        for (const [state, under] of Map.groupBy(writes, (write) => write.state)) {
          for (const names of clusters(under, minWrites)) {
            const touching = under.filter(
              (write) => names.filter((name) => write.fields.has(name)).length >= 2,
            );
            const setIn = (write: CoWrite): string[] =>
              names.filter((name) => write.fields.get(name) === "set");
            const exclusive = touching.filter((write) => setIn(write).length <= 1).length;
            const [first] = touching.toSorted((a, b) => a.node.start - b.node.start);
            if (
              names.length < minFields ||
              touching.length < minWrites ||
              first === undefined ||
              exclusive < share * touching.length
            ) {
              continue;
            }
            const seen = new Set(touching.map((write) => setIn(write).join(" + ") || "none"));
            const states = [...names.map(stateName), ...(seen.has("none") ? ["idle"] : [])];
            context.report({
              node: first.node,
              messageId: "mode",
              data: {
                names: names.map((name) => `\`${name}\``).join(", "),
                state,
                count: String(touching.length),
                seen: [...seen].map((one) => `{${one}}`).join(", "),
                suggest: `mode: ${states.map((one) => `"${one}"`).join(" | ")}`,
              },
            });
          }
        }
      },
    };
  },
});
