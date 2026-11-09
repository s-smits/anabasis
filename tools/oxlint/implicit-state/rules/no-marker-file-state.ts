import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { bindsName, declaredBy, identifierName, propertyName } from "../../ana/shared/statements.ts";
import {
  calleeName,
  decides,
  enclosingFunction,
  innermost,
  isTestPath,
  outermost,
} from "../shared/syntax.ts";

/**
 * Tier: generic. One function decides which phase a process is in by which files exist in one
 * folder: `started.json` but no `done.json` reads as running, both as finished, a `lock` as held.
 * The phase is then the set of files on disk, which a crash between two writes leaves in a
 * combination no branch expects, and every other reader re-derives it its own way. One record of
 * the phase (a state field written once per transition, or an append-only log folded to the
 * latest state) gives the phase one owner.
 *
 * Reported: a function in which two or more existence checks of distinct files in one folder each
 * decide something (an `if`, a loop or ternary test, a comparison, a return, or a `const` holding
 * the answer). An existence check is a platform form: `existsSync`, `pathExists` and
 * `pathExistsSync` by any receiver, `Bun.file(p).exists()`, or a function of this file whose body
 * only returns one of those of its parameter. The folder is read from the path: `join(dir, "a")`
 * or `resolve(dir, "a")`, a template `${dir}/a`, `dir + "/a"`, a property of one object
 * (`paths.lock`, `paths.report`), or a `const` this file binds to one of those.
 *
 * Not reported: a single guard (`if (!existsSync(dir)) mkdirSync(dir)`), checks of files in two
 * different folders, one file checked twice, and files this module never writes, copies, makes or
 * removes (a call naming one of them), which are input it probes, such as which lockfile a project
 * has or which candidate source resolves, rather than a phase it records. A check that only creates what is missing (`if
 * (!existsSync(readme)) copyFileSync(template, readme)`) does not count towards the two, since a
 * rerun converges and the file's presence decides no phase. Tests are not read. There is no fix:
 * which record owns the phase is the change.
 */
const EXISTS = new Set(["existsSync", "pathExists", "pathExistsSync"]);
const JOINS = new Set(["join", "resolve"]);
/** Calls that bring a path into being: a write, a copy, a link or a folder made. */
const MAKES = "writeFile|copyFile|cp|mkdir|symlink|link|outputFile|outputJson|writeJson|ensureDir|ensureFile";
const CREATES = new RegExp(String.raw`\b(?:${MAKES})(?:Sync)?\(`, "u");
/** Calls that change which paths exist: those, a removal, a rename, or any `write…` (`Bun.write`, a
 *  module's own `writeCompleted`). */
const CHANGES = new RegExp(`^(?:${MAKES}|rm|rmdir|unlink|rename|remove|move)(?:Sync)?$|^write`, "u");

/** A folder and the file named in it, read off a path expression. */
interface Place {
  folder: string;
  file: string;
}

export const noMarkerFileStateRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A phase read from which files exist in one folder has no owner; record the phase once.",
      examples: [
        {
          before:
            'export const finish = (dir: string) => [writeFileSync(join(dir, "done.json"), ""), rmSync(join(dir, "lock"))];\nexport function phaseOf(dir: string) {\n  if (existsSync(join(dir, "done.json"))) return "done";\n  return existsSync(join(dir, "lock")) ? "running" : "idle";\n}',
          after:
            'export function phaseOf(dir: string): Phase {\n  return readState(join(dir, "state.json")).phase;\n}',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      phase:
        "This function reads a phase from which files exist in `{{folder}}` ({{files}}). A crash between two writes leaves a combination no branch expects; record the phase once and read that record.",
    },
  },
  createOnce(context) {
    const wrappers = new Set<string>();
    const bindings = new Map<string, ESTree.Expression>();
    const found = new Map<ESTree.Node, Map<string, { files: Set<string>; at: ESTree.Node }>>();
    const changes: string[] = [];

    const text = (node: ESTree.Node): string => context.sourceCode.getText(node).replaceAll(/\s+/gu, "");

    /** Whether a call asks the platform whether a path exists, directly or through a local wrapper. */
    function existence(call: ESTree.CallExpression): ESTree.Node | null {
      const name = calleeName(call);
      if (name !== null && (EXISTS.has(name) || wrappers.has(name))) {
        return call.arguments[0] ?? null;
      }
      if (name !== "exists" || call.callee.type !== "MemberExpression") {
        return null;
      }
      const file = innermost(call.callee.object);
      if (file.type !== "CallExpression" || calleeName(file) !== "file") {
        return null;
      }
      return file.arguments[0] ?? null;
    }

    /** The folder and file a path expression names, or null where it names neither. */
    function placeOf(path: ESTree.Node, depth = 0): Place | null {
      const bare = innermost(path);
      if (bare.type === "Identifier") {
        const bound = bindings.get(bare.name);
        return bound === undefined || depth > 0 ? null : placeOf(bound, depth + 1);
      }
      const file = propertyName(bare);
      if (bare.type === "MemberExpression" && file !== null) {
        return { folder: text(bare.object), file };
      }
      if (bare.type === "CallExpression" && JOINS.has(calleeName(bare) ?? "") && bare.arguments.length >= 2) {
        const last = bare.arguments.at(-1);
        if (last === undefined) {
          return null;
        }
        return { folder: bare.arguments.slice(0, -1).map(text).join(","), file: text(last) };
      }
      if (bare.type === "BinaryExpression" && bare.operator === "+") {
        return { folder: text(bare.left), file: text(bare.right) };
      }
      if (bare.type !== "TemplateLiteral") {
        return null;
      }
      // `${dir}/a` names the folder `dir`, as `join(dir, "a")` does.
      const whole = text(bare).slice(1, -1);
      const cut = whole.lastIndexOf("/");
      const folder = whole.slice(0, cut).replace(/^\$\{([^{}]*)\}$/u, "$1");
      return cut <= 0 ? null : { folder, file: whole.slice(cut + 1) };
    }

    /** A function of this file whose body only returns an existence check of its first parameter. */
    function noteWrapper(name: string, fn: ESTree.Function | ESTree.ArrowFunctionExpression): void {
      const [parameter] = fn.params;
      const body = fn.body;
      if (parameter?.type !== "Identifier" || body === null) {
        return;
      }
      const [only] = body.type === "BlockStatement" ? body.body : [];
      const statement = only?.type === "ReturnStatement" ? only.argument : null;
      const returned = body.type === "BlockStatement" ? statement : body;
      const call = returned === null || returned === undefined ? null : innermost(returned);
      if (call?.type !== "CallExpression") {
        return;
      }
      const name0 = calleeName(call);
      const first = call.arguments[0];
      if (
        name0 !== null &&
        EXISTS.has(name0) &&
        first?.type === "Identifier" &&
        first.name === parameter.name
      ) {
        wrappers.add(name);
      }
    }

    /**
     * Whether the condition the check sits in hands the same path to another call: `if
     * (existsSync(p)) copy(p)` and `existsSync(p) ? read(p) : null` read an optional file, which is
     * no phase. Read on the text, where the check itself is one argument list holding the path.
     */
    function guardsItsOwnUse(call: ESTree.CallExpression, argument: ESTree.Node): boolean {
      let region: ESTree.Node = call;
      while (region.parent !== null && region.parent !== undefined) {
        const parent: ESTree.Node = region.parent;
        if (parent.type === "IfStatement" || parent.type === "ConditionalExpression") {
          region = parent;
          break;
        }
        if (
          parent.type !== "UnaryExpression" &&
          parent.type !== "LogicalExpression" &&
          parent.type !== "ParenthesizedExpression"
        ) {
          break;
        }
        region = parent;
      }
      const path = text(argument).replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
      return (text(region).match(new RegExp(`[(,]${path}[),]`, "gu")) ?? []).length > 1;
    }

    /**
     * Whether the check is `if (!exists(p)) create(p)`: a negated test with no `else` whose arm
     * writes, copies or makes a path in the same folder under the same name. Run again, it
     * converges, so the file's presence is no phase. Read on the text, as `guardsItsOwnUse` is,
     * since the arm may spell the path with another join (`join` against `resolve`).
     */
    function createsIfMissing(call: ESTree.CallExpression, place: Place): boolean {
      const negation = outermost(call).parent;
      const test =
        negation?.type === "UnaryExpression" && negation.operator === "!" ? outermost(negation) : null;
      const guard = test?.parent;
      if (test === null || guard?.type !== "IfStatement" || guard.test !== test || guard.alternate !== null) {
        return false;
      }
      const arm = text(guard.consequent);
      return CREATES.test(arm) && arm.includes(place.file) && arm.includes(place.folder);
    }

    function record(call: ESTree.CallExpression, argument: ESTree.Node): void {
      if (guardsItsOwnUse(call, argument)) {
        return;
      }
      const decided = decides(call) || call.parent?.type === "VariableDeclarator";
      const place = decided ? placeOf(argument) : null;
      if (place === null || createsIfMissing(call, place)) {
        return;
      }
      const owner = enclosingFunction(call) ?? context.sourceCode.ast;
      const folders = found.get(owner) ?? new Map<string, { files: Set<string>; at: ESTree.Node }>();
      const entry = folders.get(place.folder) ?? { files: new Set<string>(), at: call };
      // A file is named bare however it is spelled: `"a"`, `"/a"` or the tail of a template.
      entry.files.add(place.file.replaceAll(/^["'`]\/?|["'`]$/gu, ""));
      if (entry.files.size === 2) {
        entry.at = call;
      }
      folders.set(place.folder, entry);
      found.set(owner, folders);
    }

    return {
      before: () => {
        wrappers.clear();
        bindings.clear();
        found.clear();
        changes.length = 0;
        return !isTestPath(context.filename);
      },
      // A wrapper may be declared below its first caller, so they are all read before any call.
      Program: (program) => {
        for (const statement of program.body) {
          const declared = declaredBy(statement);
          if (declared.type === "FunctionDeclaration" && declared.id !== null) {
            noteWrapper(declared.id.name, declared);
          }
          if (declared.type !== "VariableDeclaration") {
            continue;
          }
          for (const { id, init } of declared.declarations) {
            const fn =
              init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression" ? init : null;
            if (id.type === "Identifier" && fn !== null) {
              noteWrapper(id.name, fn);
            }
          }
        }
      },
      VariableDeclarator: (node) => {
        if (bindsName(node)) bindings.set(node.id.name, node.init);
      },
      "CallExpression:exit": (node) => {
        if (CHANGES.test(calleeName(node) ?? "")) {
          // A path bound a line above (`const path = join(dir, NAME)`) is read through its binding.
          const bound = node.arguments.map((one) => bindings.get(identifierName(one) ?? ""));
          changes.push([node, ...bound].map((one) => (one === undefined ? "" : text(one))).join(" "));
        }
        const argument = existence(node);
        if (argument !== null) {
          record(node, argument);
        }
      },
      "Program:exit": () => {
        for (const folders of found.values()) {
          for (const [folder, { files, at }] of folders) {
            // A phase is recorded by the process that reads it: files this module never writes or
            // removes are its input (a lockfile format, a candidate source), probed and not kept.
            const kept = [...files].some((file) => changes.some((call) => call.includes(file)));
            if (files.size < 2 || !kept) {
              continue;
            }
            const data = { folder, files: [...files].map((file) => `\`${file}\``).join(", ") };
            context.report({ node: at, messageId: "phase", data });
          }
        }
      },
    };
  },
});
