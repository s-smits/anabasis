import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { declaredBy, memberObject } from "../../ana/shared/statements.ts";
import { calleeName, innermost, isTestPath } from "../shared/syntax.ts";

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
 * STALE`). Platform forms only: `fs.Stats` and `Bun.file().lastModified` name the field.
 *
 * Not reported: a file time compared with another timestamp and no difference (`stat.mtimeMs >
 * lastRun`, which asks "newer than", a cache question), an age printed rather than compared, and
 * an elapsed time that reads no file (`Date.now() - started > limit`). Tests are not read. There is
 * no fix: the owner of the holder's state is a design choice.
 */
const FILE_TIMES = new Set(["mtimeMs", "ctimeMs", "mtime", "ctime", "lastModified"]);
const RELATIONS = new Set(["<", "<=", ">", ">="]);
/** A name in the convention for a module constant, `STALE_MS`, or a member of one, `LIMITS.wall`. */
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/u;

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

export const mtimeAsLockRule = defineRule({
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
    return {
      before: () => {
        constants.clear();
        return !isTestPath(context.filename);
      },
      Program: (program) => {
        for (const statement of program.body) {
          const declared = declaredBy(statement);
          if (declared.type !== "VariableDeclaration" || declared.kind !== "const") {
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
        const ages = (age(left) && fixed(right, constants)) || (age(right) && fixed(left, constants));
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
        if (ages || against) {
          context.report({ node, messageId: "age" });
        }
      },
    };
  },
});
