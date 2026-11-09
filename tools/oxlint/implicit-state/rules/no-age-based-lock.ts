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
 * Reported: a relational comparison (`<`, `<=`, `>`, `>=`) one of whose operands is a difference
 * whose subtrahend reads a file time (`.mtimeMs`, `.ctimeMs`, `.mtime.getTime()`, `+stat.mtime`,
 * `Number(stat.mtime)`), or which compares a file time with a difference (`stat.mtimeMs < now -
 * STALE`), in a function that takes something over on the strength of it: it deletes, renames or
 * signals (`rm`, `unlink`, `rmdir`, `remove`, `rename`, `kill`, each in its sync form too, by any
 * receiver), directly or through a function of this file whose body does. Platform forms only:
 * `fs.Stats` and `Bun.file().lastModified` name the field.
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
/** Calls that take over what an old file guards: delete it, move it aside, or signal its holder. */
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
/** A name in the convention for a module constant, `STALE_MS`, or a member of one, `LIMITS.wall`. */
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/u;
/** The words a holder goes by, whole words of a name (`lockPath`, `PART_MS`) or of a literal
 *  (`"pass.lock"`, `/\.tmp\.\d+\./`): where none is near an age, what it deletes has no holder. */
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

/** Whether an expression reads a file's modification or change time. */
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
 * Whether an expression is fixed when the code is written: a number, a constant's name, or
 * arithmetic over those. A threshold a caller passes (`days * DAY_MS`) is a question the caller
 * asks, a window rather than a guess at a holder, and is not read.
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

/** An age: a difference whose subtrahend is a file time. */
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
    /** Module constants bound to a number, whatever their names. */
    const constants = new Set<string>();
    /** Each function (or the module, as null) with the names it calls, and the ages it compares. */
    const calls = new Map<ESTree.Node | null, Set<string>>();
    const ages = new Map<ESTree.Node | null, ESTree.Node[]>();
    /** The functions of this file by the name they are bound to. */
    const named = new Map<string, ESTree.Node>();
    /** Each function (or the module) whose own names or literals name a holder (`HOLDER_WORDS`). */
    const holders = new Set<ESTree.Node | null>();
    /** Note `node`'s function where the lowercase words of `text` (`tempDirPath`: temp, dir and
     *  path) name a holder. */
    const note = (node: ESTree.Node, text: string): void => {
      const words = text
        .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
        .toLowerCase()
        .split(/[^a-z]+/u);
      if (words.some((word) => HOLDER_WORDS.has(word))) holders.add(enclosingFunction(node));
    };
    /** Whether a holder is named in `fn` or a function around it, or in the module for an age outside
     *  every function. */
    const nearHolder = (fn: ESTree.Node | null): boolean => {
      if (fn === null) return holders.has(null);
      for (let at: ESTree.Node | null = fn; at !== null; at = enclosingFunction(at)) {
        if (holders.has(at)) return true;
      }
      return false;
    };
    /** Whether a function takes over: it calls a takeover, or a function of this file that does. */
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
