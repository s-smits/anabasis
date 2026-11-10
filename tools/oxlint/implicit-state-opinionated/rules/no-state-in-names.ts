import { defineRule, type ESTree } from "@oxlint/plugins";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import type { RuleExample } from "../../rule-examples.ts";
import { bindingName, identifierName, literalValue, propertyName } from "../../ana/shared/statements.ts";
import {
  calleeName,
  enclosingFunction,
  innermost,
  isTestPath,
  outermost,
} from "../../implicit-state/shared/syntax.ts";

/**
 * Tier: opinionated. The stance: no meaning is parsed out of a name. A preview deployment called
 * `preview-pr712-2` carries its pull request in its name, and `/pr(\d+)/.exec(name)` reads it
 * back; the fact then has two owners, whoever chose the name and whatever parses it, and a rename,
 * a second number in the name or a name written before the convention silently changes the
 * answer. The fact belongs in a field of the record the name labels, written once.
 *
 * Opinionated because elsewhere parsing a name is often the only interface there is (a branch
 * naming convention a CI system enforces, a file name a tool emits), and a codebase that owns no
 * record beside the name cannot follow the advice. Where every named thing has a record beside its
 * name, a parse is a second owner.
 *
 * Reported: a regular expression literal with a capturing group, applied by `exec` or `match` (a
 * global `match` captures nothing) to a name, when a captured group is read: by index (`m[1]`,
 * `m?.[1]`), through `.groups`, or by destructuring. A name is an identifier or property whose
 * last word (`runName`, `run_name`, `run.name`, a plural) is one of the `subjects` option (by
 * default name, branch, ref, label, slug, title, dir or path), or a `basename()` or `dirname()`
 * call. `file`, `id`, `key` and `tag` are left out by default: on foreign repositories they were
 * mostly path arithmetic, module ids carrying a query and markup tags, protocol text rather than
 * names (scored against the implicit-state corpus, `file` read 1 true hit to 4 false). A regular
 * expression bound to a `const` of the same file counts as the literal.
 *
 * Not reported: a capture of a file's extension (`/\.(png|svg)$/`), which is the file system's
 * own field rather than a fact someone wrote into a name; a capture of a path's leading folders
 * (`/^(.*\/)?[^/]+\.(dist-info|libs)\//`), with at most a group of fixed words beside it, which is
 * path arithmetic over a tool's fixed layout; a segment destructured from a `split()`
 * (`const [, name] = task.split("/")`), which takes apart an identifier the record already holds
 * whole rather than labelling one; a pattern that reads a URL query
 * (`/\?worker&index=(\d+)/`, a literal `?` or a class holding one), since a query is a protocol
 * one program hands another, written to be parsed; a test of a name with no capture
 * (`/^seed-/.test(name)`, a predicate on the name's form), a capture over text that is not a name (a log line, a command's output), and
 * tests. There is no fix: which record holds the fact is the change.
 */
const SUBJECTS = ["name", "branch", "ref", "label", "slug", "title", "dir", "path"];
const NAME_CALLS = new Set(["basename", "dirname"]);
/** A pattern whose one capture is the extension at the end of a file name. */
const EXTENSION = /^[^(]*\\\.\((?!\?)[^()]*\)\$$/u;
/** A pattern that matches a URL query: an escaped `?`, or a character class holding one. */
const QUERY = /\\\?|\[[^\]]*\?[^\]]*\]/u;
/** A pattern's leading capture of a path's folders, `^(.*\/)` with or without a `?`. */
const FOLDER = /^\^\(\.\*\\?\/\)\??/u;
/** A group of fixed alternative words, such as `(dist-info|libs)`. */
const WORDS = /\((?:[-\w]+\|)+[-\w]+\)/gu;

/** Whether a pattern captures only a path's leading folders, beside at most fixed words. */
const isFolder = (pattern: string): boolean =>
  FOLDER.test(pattern) && !captures(pattern.replace(FOLDER, "").replaceAll(WORDS, ""));

/** Whether a pattern holds a capturing group: `(` unescaped, outside a class, and not `(?:`,
 *  a lookaround or `(?<=`; a named group `(?<x>` captures. */
function captures(pattern: string): boolean {
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "[") {
      inClass = true;
    } else if (char === "]") {
      inClass = false;
    } else if (char === "(" && !inClass) {
      const next = pattern.slice(index + 1, index + 4);
      if (!next.startsWith("?") || (next.startsWith("?<") && next[2] !== "=" && next[2] !== "!")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The last word of a subject expression, singular and in lower case: `run.name` and `runNames` give
 * `name`, `branch_ref` gives `ref`, `said` gives `said`; `branchOf(x)` names no subject.
 */
function subjectWord(node: ESTree.Node): string | null {
  const bare = innermost(node);
  const word = identifierName(bare) ?? propertyName(bare);
  const last = word
    ?.split(/_|(?=[A-Z])/u)
    .at(-1)
    ?.toLowerCase();
  return last === undefined ? null : last.replace(/s$/u, "");
}

/** Whether the result of a match call is read for a captured group. */
function readsCapture(call: ESTree.Node, bindings: ReadonlyMap<string, readonly ESTree.Node[]>): boolean {
  const top = outermost(call);
  const parent = top.parent;
  if (parent?.type === "MemberExpression" && parent.object === top) {
    const key = parent.property;
    const index = literalValue(key);
    return parent.computed
      ? index !== undefined && index !== 0 && index !== "0"
      : identifierName(key) === "groups";
  }
  if (parent?.type === "LogicalExpression" && parent.right.type === "ArrayExpression") {
    return readsCapture(parent, bindings);
  }
  if (parent?.type !== "VariableDeclarator") {
    return false;
  }
  if (parent.id.type === "ArrayPattern") {
    return parent.id.elements.slice(1).some((element) => element !== null);
  }
  if (parent.id.type === "ObjectPattern") {
    return true;
  }
  if (parent.id.type !== "Identifier") {
    return false;
  }
  return (bindings.get(parent.id.name) ?? []).some((read) => readsCapture(read, new Map()));
}

export const noStateInNamesRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "A fact parsed out of a name has two owners; keep it in a field of the record the name labels.",
      examples: [
        {
          before:
            "export function pullOf(run: Run): number | null {\n  const pull = /pr(\\d+)/u.exec(run.name)?.[1];\n  return pull === undefined ? null : Number(pull);\n}",
          after: "export function pullOf(run: Run): number | null {\n  return run.pull ?? null;\n}",
        },
      ] satisfies RuleExample[],
    },
    schema: [
      {
        type: "object",
        properties: { subjects: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      parsed:
        "`{{subject}}` is parsed for a captured part, so the name and the parse both own that fact, and a rename changes it silently. Keep the fact in a field of the record the name labels.",
    },
  },
  createOnce(context) {
    let subjects = new Set(SUBJECTS);
    const patterns = new Map<string, ESTree.RegExpLiteral>();
    const reads = new Map<string, ESTree.Node[]>();
    /** Each name a `split()` was destructured into, with the functions that bound it so. */
    const segments = new Map<string, (ESTree.Node | null)[]>();
    const calls: { call: ESTree.CallExpression; subject: ESTree.Node; pattern: ESTree.Node }[] = [];

    /** The regular expression literal an argument or receiver is, directly or through a `const`. */
    function literalOf(node: ESTree.Node): ESTree.RegExpLiteral | null {
      const bare = innermost(node);
      if (bare.type === "Literal" && "regex" in bare) {
        return bare;
      }
      const name = identifierName(bare);
      return name === null ? null : (patterns.get(name) ?? null);
    }

    function isName(subject: ESTree.Node): boolean {
      const bare = innermost(subject);
      const segment = identifierName(bare);
      if (segment !== null && (segments.get(segment) ?? []).includes(enclosingFunction(bare))) {
        return false;
      }
      if (bare.type === "CallExpression") {
        return NAME_CALLS.has(calleeName(bare) ?? "");
      }
      const word = subjectWord(bare);
      return word !== null && subjects.has(word);
    }

    return {
      before: () => {
        const option = asRecord(context.options[0])?.subjects;
        subjects = new Set(Array.isArray(option) ? option.filter(isString) : SUBJECTS);
        patterns.clear();
        reads.clear();
        segments.clear();
        calls.length = 0;
        return !isTestPath(context.filename);
      },
      VariableDeclarator: (node) => {
        const init = node.init === null ? null : innermost(node.init);
        if (node.id.type === "Identifier" && init?.type === "Literal" && "regex" in init) {
          patterns.set(node.id.name, init);
        }
        if (
          node.id.type === "ArrayPattern" &&
          init?.type === "CallExpression" &&
          calleeName(init) === "split"
        ) {
          const bound = node.id.elements.flatMap((element) => bindingName(element) ?? []);
          for (const name of bound) {
            segments.set(name, [...(segments.get(name) ?? []), enclosingFunction(node)]);
          }
        }
      },
      Identifier: (node) => {
        const parent = node.parent;
        if (parent?.type === "VariableDeclarator" && parent.id === node) {
          return;
        }
        reads.set(node.name, [...(reads.get(node.name) ?? []), node]);
      },
      CallExpression: (node) => {
        const name = calleeName(node);
        if (node.callee.type !== "MemberExpression" || (name !== "exec" && name !== "match")) {
          return;
        }
        const [argument] = node.arguments;
        if (argument === undefined) {
          return;
        }
        const pattern = name === "exec" ? node.callee.object : argument;
        const subject = name === "exec" ? argument : node.callee.object;
        calls.push({ call: node, subject, pattern });
      },
      "Program:exit": () => {
        for (const { call, subject, pattern } of calls) {
          const literal = literalOf(pattern);
          const source = literal?.regex.pattern ?? "";
          if (
            literal === null ||
            !captures(source) ||
            EXTENSION.test(source) ||
            QUERY.test(source) ||
            isFolder(source)
          ) {
            continue;
          }
          if (calleeName(call) === "match" && literal.regex.flags.includes("g")) {
            continue;
          }
          if (!isName(subject) || !readsCapture(call, reads)) {
            continue;
          }
          context.report({
            node: call,
            messageId: "parsed",
            data: { subject: context.sourceCode.getText(subject) },
          });
        }
      },
    };
  },
});
