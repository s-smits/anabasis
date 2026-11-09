import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { asRecord, isBoolean, isNumber, type JsonValue } from "#src/meta/json-shape.ts";
import {
  everyStatementList,
  identifierName,
  literalValue,
  memberObject,
  plainAssignment,
  propertyName,
} from "../../ana/shared/statements.ts";
import { innermost, isTestPath, objectValues, outermost, setterState } from "../shared/syntax.ts";

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
 * a named value by spreading it (`{ ...state, … }`; a spread of a fresh object, `...(c ? { k } :
 * {})`, updates nothing), or a run of statements that assigns fields of one
 * object (`tool.isResizing = true; tool.isRotating = false;`) or calls a function's `useState`
 * setters one after another. A field is set when it is written anything but `false`, `null` or
 * `undefined`. Fields of one state form a cluster when each pair of them is written together at
 * least `writes` times and each is set in some co-write that clears the other, and the cluster is
 * reported once, at its first write, when it holds at least `fields` fields and at most one of them
 * is set in a share `exclusive` of the co-writes that touch it.
 *
 * Two shapes show a mode without that count. Two fields of one object computed by comparisons that
 * cannot both hold (`isResizing: tool !== "rotation"` beside `isRotating: tool === "rotation"`, or
 * `kind === "file"` beside `kind === "dir"`) are exclusive by construction, reported at that
 * object. And two fields written as opposite literals in objects of one file (`{ imported: true,
 * frozen: false }` and `{ imported: false, frozen: true }`) and never both `true` are reported at
 * the first such object, where neither object is handed straight to a call.
 *
 * Not reported: an object created whole and passed on (a config, whose options are independent
 * choices), fields set together (`{ x, y }`), comparisons of two different subjects, and a reset
 * that clears every field, which on its own shows no mode. Test files are not read.
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

/** One comparison a condition makes: its subject, the value it is held to, and whether equal. */
interface Comparison {
  subject: string;
  against: string;
  equal: boolean;
}

/** An object created whole, with the fields it writes as `true` or `false`. */
interface FlagRecord {
  node: ESTree.Node;
  flags: Map<string, boolean>;
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

/** The comparisons a condition joins with `&&`: `t && t !== "r"` makes one, `t !== "r"`. */
function comparisonsOf(node: ESTree.Node, text: (node: ESTree.Node) => string): Comparison[] {
  const bare = innermost(node);
  if (bare.type === "LogicalExpression" && bare.operator === "&&") {
    return [...comparisonsOf(bare.left, text), ...comparisonsOf(bare.right, text)];
  }
  const equal = bare.type === "BinaryExpression" && (bare.operator === "===" || bare.operator === "==");
  const differ = bare.type === "BinaryExpression" && (bare.operator === "!==" || bare.operator === "!=");
  if (bare.type !== "BinaryExpression" || !(equal || differ)) {
    return [];
  }
  const [subject, against] = bare.left.type === "Literal" ? [bare.right, bare.left] : [bare.left, bare.right];
  return [{ subject: text(subject), against: text(against), equal }];
}

/** The first pair of fields whose values cannot both hold, with the subject they compare. */
function exclusivePair(
  values: ReadonlyMap<string, ESTree.Node>,
  text: (node: ESTree.Node) => string,
): [string, string, string] | null {
  const tests = [...values].map(([name, value]) => [name, comparisonsOf(value, text)] as const);
  for (const [index, [a, ofA]] of tests.entries()) {
    for (const [b, ofB] of tests.slice(index + 1)) {
      // Two comparisons of one subject exclude each other: `x === k` and `x !== k`, or `x === a`
      // and `x === b` for two literals.
      const clash = ofA.find((one) =>
        ofB.some(
          (other) =>
            one.subject === other.subject &&
            (one.against === other.against ? one.equal !== other.equal : one.equal && other.equal),
        ),
      );
      if (clash !== undefined) {
        return [a, b, clash.subject];
      }
    }
  }
  return null;
}

/** Each pair of flags written as opposite literals in two records and never both `true`, at the
 *  first record that sets one: `{ imported: true, frozen: false }` beside the reverse. */
function oppositePairs(records: readonly FlagRecord[]): [ESTree.Node, string, string, number][] {
  const found: [ESTree.Node, string, string, number][] = [];
  const names = [...new Set(records.flatMap((record) => [...record.flags.keys()]))];
  for (const [index, a] of names.entries()) {
    for (const b of names.slice(index + 1)) {
      const both = records.filter((record) => record.flags.has(a) && record.flags.has(b));
      const only = (x: string, y: string): FlagRecord[] =>
        both.filter((record) => record.flags.get(x) === true && record.flags.get(y) === false);
      const clash = both.some((record) => record.flags.get(a) === true && record.flags.get(b) === true);
      const [first] = [...only(a, b), ...only(b, a)].toSorted((p, q) => p.node.start - q.node.start);
      const reported = found.some(([node]) => node === first?.node);
      if (first !== undefined && only(a, b).length > 0 && only(b, a).length > 0 && !clash && !reported) {
        found.push([first.node, a, b, both.length]);
      }
    }
  }
  return found;
}

/** Whether an object is handed straight to a call or `new`, as an options argument is. */
function passed(object: ESTree.Node): boolean {
  const at = outermost(object);
  const parent = at.parent;
  return (
    (parent?.type === "CallExpression" || parent?.type === "NewExpression") &&
    parent.arguments.some((argument) => argument === at)
  );
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

/** A suggested union of named states: `mode: "loading" | "error"`. */
const suggestOf = (states: readonly string[]): string =>
  `mode: ${states.map((one) => `"${one}"`).join(" | ")}`;

/** Whether each written value sets its field or clears it. */
const settings = (values: ReadonlyMap<string, ESTree.Node>): Map<string, Value> =>
  new Map([...values].map(([name, value]) => [name, valueOf(value)]));

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
      exclusive:
        "`{{a}}` and `{{b}}` are computed from `{{subject}}` so that both cannot hold. They are one mode with no name: hold it in one field, such as `{{suggest}}`.",
      opposite:
        "`{{a}}` and `{{b}}` are written as opposite literals in {{count}} objects of this file and never both `true`. They are one mode with no name: hold it in one field, such as `{{suggest}}`.",
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
    const records: FlagRecord[] = [];
    const text = (node: ESTree.Node): string => context.sourceCode.getText(node).replaceAll(/\s+/gu, "");

    /** One statement's write: a field of an object assigned, or a `useState` setter called. */
    function statementWrite(statement: ESTree.Statement): [string, string, ESTree.Node, ESTree.Node] | null {
      const assigned = plainAssignment(statement);
      if (assigned !== null) {
        const field = propertyName(assigned.left);
        const object = memberObject(assigned.left);
        return field !== null && object !== null ? [text(object), field, assigned.right, statement] : null;
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
      return [component(statement), field, argument, statement];
    }

    /** Report the first pair of fields whose comparisons cannot both hold. */
    function exclusiveAt(values: ReadonlyMap<string, ESTree.Node>, node: ESTree.Node): void {
      const pair = exclusivePair(values, text);
      if (pair !== null) {
        const [a, b, subject] = pair;
        const suggest = suggestOf([a, b].map(stateName));
        context.report({ node, messageId: "exclusive", data: { a, b, subject, suggest } });
      }
    }

    /** The co-writes of each run of consecutive writing statements, one per state written. */
    function runs(body: readonly ESTree.Statement[]): void {
      let run: [string, string, ESTree.Node, ESTree.Node][] = [];
      const close = (): void => {
        for (const [state, under] of Map.groupBy(run, ([owner]) => owner)) {
          const [first] = under;
          if (first !== undefined && under.length >= 2) {
            const values = new Map(under.map(([, field, value]) => [field, value]));
            writes.push({ state, fields: settings(values), node: first[3] });
            exclusiveAt(values, first[3]);
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
        const named =
          spread !== undefined &&
          ["Identifier", "MemberExpression"].includes(innermost(spread.argument).type);
        const state = setterOf(node) ?? (named ? text(spread.argument) : null);
        const values = objectValues(node);
        if (state !== null && values.size >= 2) {
          writes.push({ state, fields: settings(values), node });
        }
        exclusiveAt(values, node);
        const flags = new Map(
          [...values].flatMap(([name, value]) => {
            const literal = literalValue(value);
            return isBoolean(literal) ? [[name, literal] as const] : [];
          }),
        );
        if (state === null && !passed(node) && flags.size >= 2) {
          records.push({ node, flags });
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
                suggest: suggestOf(states),
              },
            });
          }
        }
        for (const [node, a, b, count] of oppositePairs(records)) {
          const suggest = suggestOf([...[a, b].map(stateName), "idle"]);
          context.report({ node, messageId: "opposite", data: { a, b, count: String(count), suggest } });
        }
      },
    };
  },
});
