/**
 * A key a caller passes to a function that spreads what it was given and then sets the same key
 * itself, so the caller's value is never read.
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

const BARE_KINDS = new Set([
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.AwaitExpression,
  ts.SyntaxKind.TypeAssertionExpression,
]);

/** The expression beneath parentheses, `await`, `as`, `satisfies` and `!`. */
function bare(node: ts.Expression): ts.Expression {
  let at = node;
  while (BARE_KINDS.has(at.kind)) {
    // SAFETY: every kind in `BARE_KINDS` is a unary wrapper carrying `.expression: ts.Expression`.
    at = (at as ts.ParenthesizedExpression).expression;
  }
  return at;
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
  const last = object.properties.findLastIndex((property) => {
    if (!ts.isSpreadAssignment(property)) return false;
    const inner = bare(property.expression);
    return ts.isIdentifier(inner) && inner.text === parameter;
  });
  if (last === -1) return null;
  const keys = new Map<string, number>();
  for (const property of object.properties.slice(last + 1)) {
    const key = keyOf(property);
    if (key === undefined) continue;
    keys.set(key, file.getLineAndCharacterOfPosition(property.getStart(file)).line + 1);
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
      if (ts.isPropertyAccessExpression(parent)) {
        if (parent.expression === node) read.add(parent.name.text);
      } else if (ts.isElementAccessExpression(parent) && ts.isStringLiteral(parent.argumentExpression)) {
        read.add(parent.argumentExpression.text);
      } else if (ts.isPropertyAssignment(parent) && parent.name === node) {
        // a key spelled like the parameter, not a use of it
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
      if (!ts.isIdentifier(one.name) || one.initializer === undefined) return [];
      const value = bare(one.initializer);
      return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? [[one.name.text, value]] : [];
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
export function resolved(from: string, specifier: string, files: ReadonlySet<string>): string | undefined {
  const alias = ALIASES.find(([key]) => specifier.startsWith(key));
  const base = alias
    ? alias[1] + specifier.slice(alias[0].length)
    : specifier.startsWith(".")
      ? join(dirname(from), specifier)
      : undefined;
  if (base === undefined) return undefined;
  const stem = base.replace(/\.m?js$/u, "");
  return [base, `${stem}.ts`, `${stem}.tsx`, `${base}/index.ts`].find((one) => files.has(one));
}

/** What each name a file calls by resolves to: its own top-level functions and its named imports. */
function namesIn(
  path: string,
  file: ts.SourceFile,
  byFile: ReadonlyMap<string, Wrapper[]>,
  files: ReadonlySet<string>,
): Map<string, Wrapper[]> {
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

/** Every file but a declaration file, parsed (with parent links unless `links` is `"flat"`). */
export function parsedSources(
  files: ReadonlyMap<string, string>,
  links: "parents" | "flat" = "parents",
): Map<string, ts.SourceFile> {
  const out = new Map<string, ts.SourceFile>();
  const setParents = links === "parents";
  for (const [path, text] of files) {
    if (/\.d\.m?ts$/u.test(path)) continue;
    const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    out.set(path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, setParents, kind));
  }
  return out;
}

/** Every key a call hands a wrapper that the wrapper then sets over it. */
export function overwrittenKeys(parsed: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const byFile = new Map([...parsed].map(([path, file]) => [path, wrappersOf(path, file)]));
  const files = new Set(byFile.keys());
  const rows: TreeFinding[] = [];
  for (const [path, file] of parsed) {
    const named = namesIn(path, file, byFile, files);
    if (named.size === 0) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        for (const wrapper of named.get(node.expression.text) ?? []) {
          const given = node.arguments[wrapper.index];
          if (given === undefined) continue;
          const object = bare(given);
          if (!ts.isObjectLiteralExpression(object)) continue;
          for (const property of object.properties) {
            const key = keyOf(property);
            const set = key === undefined ? undefined : wrapper.keys.get(key);
            if (set === undefined) continue;
            rows.push({
              kind: "no-overwritten-key",
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
