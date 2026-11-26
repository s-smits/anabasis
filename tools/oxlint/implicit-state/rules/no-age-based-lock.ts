import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { declaredBy, isConstDeclaration, memberObject } from "../../ana/shared/statements.ts";
import { calleeName, enclosingFunction, innermost, isTestPath } from "../shared/syntax.ts";

/**
 * Tier: generic. A file's age compared with a constant decides whether its holder is alive:
 * `Date.now() - statSync(lock).mtimeMs > STALE` reads "the writer died" from "the writer has not
 * touched the file for a while". The holder's state (running, stalled, dead) lives in no owner; it
 * is inferred from a clock and a threshold, so a slow writer reads as a dead one and a second
 * process takes the lock, and a dead writer holds it until the threshold passes. The state belongs
 * with the holder: a pid that can be asked whether it is alive, a lease the holder renews and
 * releases, or an exclusive open (`wx`) released on exit.
 *
 * Not reported: an age that only selects what a report shows or a cache keeps (`files.filter((f)
 * => now - statSync(f).mtimeMs < RECENT)`), since no holder loses anything by it; a deletion by age
 * of data nothing holds, in a function (and the functions around it) that names no holder: no
 * lock, lease, holder, pid, reaper or temporary or part file in a name or a literal (`for (const
 * dir of old) if (Date.now() - statSync(dir).mtimeMs > WEEK_MS) rmSync(dir)` is retention, as the
 * pulse's week-old result folders are); a file time
 * compared with another timestamp and no difference (`stat.mtimeMs > lastRun`, which asks "newer
 * than", a cache question); an age printed rather than compared; and an elapsed time that reads no
 * file (`Date.now() - started > limit`). Tests are not read. There is no fix: the owner of the
 * holder's state is a design choice.
 */
const FILE_TIMES = new Set(["mtimeMs", "ctimeMs", "mtime", "ctime", "lastModified"]);
const TAKEOVERS = new Set([
  "rm",
  "rmSync",
  "unlink",
  "unlinkSync",
  "rmdir",
  "rmdirSync",
  "remove",
  "removeSync",
  "rename",
  "renameSync",
  "kill",
]);
const RELATIONS = new Set(["<", "<=", ">", ">="]);
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/u;
/** Whole words of a name (`lockPath`, `PART_MS`) or a literal (`"pass.lock"`): where none is near
 *  an age, what it deletes has no holder. */
const HOLDER_WORDS = new Set([
  "lock",
  "locks",
  "lockfile",
  "lease",
  "holder",
  "pid",
  "reaper",
  "mutex",
  "tmp",
  "temp",
  "part",
  "parts",
]);

function fileTime(node: ESTree.Node): boolean {
  const bare = innermost(node);
  if (bare.type === "MemberExpression") {
    return !bare.computed && bare.property.type === "Identifier" && FILE_TIMES.has(bare.property.name);
  }
  if (bare.type === "UnaryExpression" && bare.operator === "+") {
    return fileTime(bare.argument);
  }
  if (bare.type !== "CallExpression") {
    return false;
  }
  const name = calleeName(bare);
  if (name === "Number" && bare.arguments[0] !== undefined) {
    return fileTime(bare.arguments[0]);
  }
  const object = memberObject(bare.callee);
  return name === "getTime" && object !== null && fileTime(object);
}

/**
 * A threshold a caller passes (`days * DAY_MS`) is a window the caller asks for, not a guess at a
 * holder, and is not read.
 */
function fixed(node: ESTree.Node, constants: ReadonlySet<string>): boolean {
  const bare = innermost(node);
  if (bare.type === "Literal") {
    return true;
  }
  if (bare.type === "Identifier") {
    return CONSTANT_NAME.test(bare.name) || constants.has(bare.name);
  }
  if (bare.type === "MemberExpression") {
    return fixed(bare.object, constants);
  }
  if (bare.type === "BinaryExpression") {
    return fixed(bare.left, constants) && fixed(bare.right, constants);
  }
  return bare.type === "UnaryExpression" && fixed(bare.argument, constants);
}

function age(node: ESTree.Node): boolean {
  const bare = innermost(node);
  return bare.type === "BinaryExpression" && bare.operator === "-" && fileTime(bare.right);
}

export const noAgeBasedLockRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A file's age against a constant is a guess at its holder's state; ask the holder.",
      examples: [
        {
          before:
            'const stale = Date.now() - statSync(lock).mtimeMs > STALE_MS;\nif (stale) rmSync(lock);\nwriteFileSync(lock, String(pid), { flag: "wx" });',
          after:
            'const holder = Number(readFileSync(lock, "utf8"));\nif (!alive(holder)) rmSync(lock);\nwriteFileSync(lock, String(pid), { flag: "wx" });',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      age: "A file's age compared with a constant decides whether its holder is alive, so a slow holder reads as a dead one. Keep the state with the holder: a pid to ask, a lease it renews, or an exclusive open released on exit.",
    },
  },
  createOnce(context) {
    const constants = new Set<string>();
    const calls = new Map<ESTree.Node | null, Set<string>>();
    const ages = new Map<ESTree.Node | null, ESTree.Node[]>();
    const named = new Map<string, ESTree.Node>();
    const holders = new Set<ESTree.Node | null>();
    const note = (node: ESTree.Node, text: string): void => {
      const words = text
        .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
        .toLowerCase()
        .split(/[^a-z]+/u);
      if (words.some((word) => HOLDER_WORDS.has(word))) holders.add(enclosingFunction(node));
    };
    const nearHolder = (fn: ESTree.Node | null): boolean => {
      if (fn === null) return holders.has(null);
      for (let at: ESTree.Node | null = fn; at !== null; at = enclosingFunction(at)) {
        if (holders.has(at)) return true;
      }
      return false;
    };
    const takesOver = (fn: ESTree.Node | null, seen = new Set<ESTree.Node | null>()): boolean => {
      seen.add(fn);
      return [...(calls.get(fn) ?? [])].some((name) => {
        const local = named.get(name);
        return TAKEOVERS.has(name) || (local !== undefined && !seen.has(local) && takesOver(local, seen));
      });
    };
    return {
      before: () => {
        constants.clear();
        calls.clear();
        ages.clear();
        named.clear();
        holders.clear();
        return !isTestPath(context.filename);
      },
      Identifier: (node) => {
        note(node, node.name);
      },
      Literal: (node) => {
        note(node, "regex" in node ? node.regex.pattern : String(node.value));
      },
      TemplateElement: (node) => {
        note(node, node.value.raw);
      },
      FunctionDeclaration: (node) => {
        if (node.id !== null) named.set(node.id.name, node);
      },
      VariableDeclarator: (node) => {
        const init = node.init;
        const fn = init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression";
        if (node.id.type === "Identifier" && init !== null && fn) named.set(node.id.name, init);
      },
      CallExpression: (node) => {
        const name = calleeName(node);
        if (name === null) return;
        const owner = enclosingFunction(node);
        calls.set(owner, (calls.get(owner) ?? new Set<string>()).add(name));
      },
      "Program:exit": () => {
        for (const [owner, found] of ages) {
          if (!takesOver(owner) || !nearHolder(owner)) continue;
          for (const node of found) context.report({ node, messageId: "age" });
        }
      },
      Program: (program) => {
        for (const statement of program.body) {
          const declared = declaredBy(statement);
          if (!isConstDeclaration(declared)) {
            continue;
          }
          for (const { id, init } of declared.declarations) {
            if (id.type === "Identifier" && init !== null && fixed(init, constants)) {
              constants.add(id.name);
            }
          }
        }
      },
      BinaryExpression(node) {
        if (!RELATIONS.has(node.operator)) {
          return;
        }
        const { left, right } = node;
        const aged = (age(left) && fixed(right, constants)) || (age(right) && fixed(left, constants));
        const window = (time: ESTree.Node, other: ESTree.Node): boolean => {
          const span = innermost(other);
          return (
            fileTime(time) &&
            span.type === "BinaryExpression" &&
            span.operator === "-" &&
            fixed(span.right, constants)
          );
        };
        const against = window(left, right) || window(right, left);
        if (aged || against) {
          const owner = enclosingFunction(node);
          ages.set(owner, [...(ages.get(owner) ?? []), node]);
        }
      },
    };
  },
});
