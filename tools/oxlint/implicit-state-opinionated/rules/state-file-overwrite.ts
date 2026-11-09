import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { identifierName, literalValue } from "../../ana/shared/statements.ts";
import { calleeName, innermost, isTestPath } from "../../implicit-state/shared/syntax.ts";

/**
 * Tier: opinionated. The stance: state that outlives a process lives in an append-only log and is
 * read as a fold over it, never in a file each writer replaces. A file rewritten whole holds only
 * the latest writer's view: two writers lose one update, a crash mid-write leaves half a record, and
 * how the state got there is gone, so a reader that disagrees with it has nothing to check against.
 *
 * Opinionated because a settings file, a cache, a lock file's contents and an exported report are
 * all rewritten whole on purpose in most codebases, and an append-only log is a design choice that
 * costs a fold on every read. A codebase that holds itself to "one log, every state a fold" wants
 * each such write named: either it becomes an event, or it is a derived view the log can rebuild.
 *
 * Reported: a call that replaces a file's contents (`writeFileSync`, `writeFile`, `outputFile`,
 * `outputJson`, `writeJson`, `writeJSONSync` and the like by any receiver, or `Bun.write`) whose data
 * is serialised structure: a `JSON.stringify(...)` call, or any call whose name ends in `stringify`,
 * directly or inside a template or concatenation, or the `*Json` writers themselves.
 *
 * Not reported: an append (`appendFileSync`, or a write with `flag: "a"`), a write of text that is
 * not serialised structure, and tests. There is no fix: whether the state becomes an event or a
 * derived view is the change.
 */
const WRITES = new Set(["writeFileSync", "writeFile", "outputFile", "outputFileSync", "write"]);
const JSON_WRITES = new Set([
  "writeJson",
  "writeJsonSync",
  "writeJSON",
  "writeJSONSync",
  "outputJson",
  "outputJsonSync",
]);

/** Whether an expression holds serialised structure at its top, through a template or `+`. */
function serialised(node: ESTree.Node): boolean {
  const bare = innermost(node);
  if (bare.type === "CallExpression") {
    return /stringify$/iu.test(calleeName(bare) ?? "");
  }
  if (bare.type === "TemplateLiteral") {
    return bare.expressions.some(serialised);
  }
  return (
    bare.type === "BinaryExpression" &&
    bare.operator === "+" &&
    (serialised(bare.left) || serialised(bare.right))
  );
}

/** Whether a write's options ask for an append: `{ flag: "a" }` or `"a"` itself. */
function appends(options: ESTree.Node | undefined): boolean {
  if (options === undefined) {
    return false;
  }
  const bare = innermost(options);
  const flag = literalValue(bare);
  if (flag !== undefined) {
    return flag === "a" || flag === "a+";
  }
  if (bare.type !== "ObjectExpression") {
    return false;
  }
  return bare.properties.some(
    (property) =>
      property.type === "Property" &&
      identifierName(property.key) === "flag" &&
      String(literalValue(property.value)).startsWith("a"),
  );
}

/** Whether `Bun.write` or a file-system write is called, rather than a stream's `write`. */
function replacesFile(call: ESTree.CallExpression, name: string): boolean {
  if (name !== "write") {
    return true;
  }
  const callee = call.callee;
  return callee.type === "MemberExpression" && identifierName(callee.object) === "Bun";
}

export const stateFileOverwriteRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "State rewritten whole into a file keeps only the last writer's view; append an event and fold it.",
      examples: [
        {
          before:
            'export function finish(job: Job): void {\n  writeFileSync(job.path, JSON.stringify({ ...job, state: "done" }));\n}',
          after:
            'export function finish(job: Job): void {\n  appendFileSync(job.log, eventLine({ kind: "finished", at: Date.now() }));\n}',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      overwrite:
        "This write replaces a file of serialised state, so it keeps only the last writer's view and loses how the state got there. Append an event to a log and read the state as a fold, or name the file a view the log rebuilds.",
    },
  },
  createOnce(context) {
    return {
      before: () => !isTestPath(context.filename),
      CallExpression: (node) => {
        const name = calleeName(node);
        if (name === null) {
          return;
        }
        if (JSON_WRITES.has(name)) {
          context.report({ node, messageId: "overwrite" });
          return;
        }
        if (!WRITES.has(name) || !replacesFile(node, name)) {
          return;
        }
        const [, data, options] = node.arguments;
        if (data !== undefined && serialised(data) && !appends(options)) {
          context.report({ node, messageId: "overwrite" });
        }
      },
    };
  },
});
