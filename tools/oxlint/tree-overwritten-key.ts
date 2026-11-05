/**
 * A key a caller passes to a function that spreads what it was given and then sets the same key
 * itself, so the caller's value is never read.
 *
 * The recorded case: `tool()` in `src/tools/answer.ts` returns `defineTool({ ...definition,
 * executionMode: "sequential", ... })`, and 20 callers in 10 files passed `executionMode:
 * "sequential"` inside the `tool({ ... })` they wrote. Commits 073acaa7c and 4c1209737 deleted
 * those lines on 5 November 2026. No per-file rule could see it, since the wrapper and most of its
 * callers sit in different files.
 *
 * The scan is syntactic and leans to silence. A wrapper is a top-level function (a declaration, or
 * a `const` holding an arrow or function expression) with a plain parameter it spreads into an
 * object it returns or hands straight to a call, in a statement no earlier `return` can skip. A key
 * written after the last spread of that parameter is set over the caller's, unless the function
 * reads the key from the parameter anywhere (`definition.execute` keeps the caller's `execute`
 * alive). A parameter used any other way (passed on whole, destructured, spread a second time
 * into another object, reassigned) may carry the caller's key elsewhere, so it is not read at all.
 * A key set before the spread is the caller's to override, and a key set inside a conditional
 * spread is not always set, so neither counts. A caller is a call by the wrapper's own name, in its
 * file or through a named import that resolves to it, with an object literal at that position.
 */
import * as ts from "typescript5";
import { dirname, join } from "../../src/meta/path.ts";
import type { TreeFinding } from "./tree-findings.ts";

/** One parameter of one wrapper, and the keys it always sets over it, with their lines. */
interface Wrapper {
  path: string;
  name: string;
  index: number;
  parameter: string;
  keys: ReadonlyMap<string, number>;
}

const ALIASES: readonly [string, string][] = [
  ["#src/", "src/"],
  ["#tools/", "tools/"],
  ["#skills/", ".claude/skills/"],
];

/** The expression beneath parentheses, `await`, `as`, `satisfies` and `!`. */
function bare(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return bare(node.expression);
  }
  return node;
}

/** The object literals an expression yields itself or hands straight to a call. */
function handedObjects(node: ts.Expression | undefined): ts.ObjectLiteralExpression[] {
  if (node === undefined) return [];
  const inner = bare(node);
  if (ts.isObjectLiteralExpression(inner)) return [inner];
  if (ts.isCallExpression(inner) || ts.isNewExpression(inner)) {
    return [...(inner.arguments ?? [])].flatMap(handedObjects);
  }
  return [];
}

/** Whether a statement holds a `return` of its own function, outside any nested function. */
function returnsWithin(node: ts.Node): boolean {
  if (ts.isReturnStatement(node)) return true;
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
  return ts.forEachChild(node, returnsWithin) === true;
}

/** The objects a function returns or forwards on every path that reaches them. */
function builtObjects(fn: ts.FunctionLikeDeclaration): ts.ObjectLiteralExpression[] {
  const body = fn.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return handedObjects(body);
  const built: ts.ObjectLiteralExpression[] = [];
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) || ts.isExpressionStatement(statement)) {
      built.push(...handedObjects(statement.expression));
    } else if (ts.isVariableStatement(statement)) {
      built.push(...statement.declarationList.declarations.flatMap((one) => handedObjects(one.initializer)));
    }
    if (returnsWithin(statement)) break;
  }
  return built;
}

function keyOf(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isSpreadAssignment(property)) return undefined;
  const name = property.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** The keys an object sets after its last spread of `parameter`, or null where it spreads none. */
function keysAfterSpread(
  object: ts.ObjectLiteralExpression,
  parameter: string,
  file: ts.SourceFile,
): Map<string, number> | null {
  const spreads = (property: ts.ObjectLiteralElementLike): boolean =>
    ts.isSpreadAssignment(property) &&
    ts.isIdentifier(bare(property.expression)) &&
    bare(property.expression).getText(file) === parameter;
  const last = object.properties.findLastIndex(spreads);
  if (last === -1) return null;
  const keys = new Map<string, number>();
  for (const property of object.properties.slice(last + 1)) {
    const key = keyOf(property);
    const line = file.getLineAndCharacterOfPosition(property.getStart(file)).line + 1;
    if (key !== undefined) keys.set(key, line);
  }
  return keys;
}

/**
 * The keys a parameter's every use leaves dead: each use is a spread into one of the built objects
 * or a read of a named member. Null where any other use lets the caller's object out.
 */
function deadKeys(
  fn: ts.FunctionLikeDeclaration,
  parameter: string,
  file: ts.SourceFile,
): Map<string, number> | null {
  const built = builtObjects(fn);
  const spreadSets = built.flatMap((object) => keysAfterSpread(object, parameter, file) ?? []);
  const read = new Set<string>();
  let escapes = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === parameter) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) read.add(parent.name.text);
      else if (ts.isElementAccessExpression(parent) && ts.isStringLiteral(parent.argumentExpression)) {
        read.add(parent.argumentExpression.text);
      } else if (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node)
      ) {
        // a member or a key spelled like the parameter, not a use of it
      } else if (!(ts.isSpreadAssignment(parent) && built.includes(parent.parent))) escapes = true;
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  const [first, ...rest] = spreadSets;
  if (escapes || first === undefined) return null;
  return new Map([...first].filter(([key]) => !read.has(key) && rest.every((keys) => keys.has(key))));
}

/** The top-level functions of a file, by name. */
function functionsOf(file: ts.SourceFile): [string, ts.FunctionLikeDeclaration][] {
  return file.statements.flatMap((statement): [string, ts.FunctionLikeDeclaration][] => {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      return [[statement.name.text, statement]];
    }
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.flatMap((one): [string, ts.FunctionLikeDeclaration][] => {
      const value = one.initializer === undefined ? undefined : bare(one.initializer);
      const isFunction = value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
      return isFunction && ts.isIdentifier(one.name) ? [[one.name.text, value]] : [];
    });
  });
}

function wrappersOf(path: string, file: ts.SourceFile): Wrapper[] {
  return functionsOf(file).flatMap(([name, fn]) =>
    fn.parameters.flatMap((one, index): Wrapper[] => {
      if (!ts.isIdentifier(one.name)) return [];
      const keys = deadKeys(fn, one.name.text, file);
      return keys === null || keys.size === 0 ? [] : [{ path, name, index, parameter: one.name.text, keys }];
    }),
  );
}

/** The file a specifier names, among the files read. */
function resolved(from: string, specifier: string, files: ReadonlySet<string>): string | undefined {
  const alias = ALIASES.find(([key]) => specifier.startsWith(key));
  let base: string | undefined;
  if (alias !== undefined) base = alias[1] + specifier.slice(alias[0].length);
  else if (specifier.startsWith(".")) base = join(dirname(from), specifier);
  if (base === undefined) return undefined;
  const stem = base.replace(/\.m?js$/u, "");
  return [base, `${stem}.ts`, `${stem}.tsx`, `${base}/index.ts`].find((one) => files.has(one));
}

/** What each name a file calls by resolves to: its own top-level functions and its named imports. */
function namesIn(
  path: string,
  file: ts.SourceFile,
  byFile: ReadonlyMap<string, Wrapper[]>,
): Map<string, Wrapper[]> {
  const files = new Set(byFile.keys());
  const named = Map.groupBy(byFile.get(path) ?? [], (one) => one.name);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const home = resolved(path, statement.moduleSpecifier.text, files);
    if (home === undefined || bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const exported = (element.propertyName ?? element.name).text;
      const wrappers = (byFile.get(home) ?? []).filter((one) => one.name === exported);
      if (wrappers.length > 0) named.set(element.name.text, wrappers);
    }
  }
  return named;
}

/** Every key a call hands a wrapper that the wrapper then sets over it. */
export function overwrittenKeys(files: ReadonlyMap<string, string>): TreeFinding[] {
  const parsed = new Map(
    [...files]
      .filter(([path]) => !/\.d\.m?ts$/u.test(path))
      .map(([path, text]) => [
        path,
        ts.createSourceFile(
          path,
          text,
          ts.ScriptTarget.Latest,
          true,
          path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        ),
      ]),
  );
  const byFile = new Map([...parsed].map(([path, file]) => [path, wrappersOf(path, file)]));
  const rows: TreeFinding[] = [];
  for (const [path, file] of parsed) {
    const named = namesIn(path, file, byFile);
    if (named.size === 0) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        for (const wrapper of named.get(node.expression.text) ?? []) {
          const given = node.arguments[wrapper.index];
          const object = given === undefined ? undefined : bare(given);
          if (object === undefined || !ts.isObjectLiteralExpression(object)) continue;
          for (const property of object.properties) {
            const key = keyOf(property);
            const set = key === undefined ? undefined : wrapper.keys.get(key);
            if (set === undefined) continue;
            rows.push({
              kind: "overwritten-key",
              path,
              line: file.getLineAndCharacterOfPosition(property.getStart(file)).line + 1,
              detail: `\`${key}\` is set again by \`${wrapper.name}\` (${wrapper.path}:${set}) after it spreads \`${wrapper.parameter}\`, so this value is never read`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return rows;
}
