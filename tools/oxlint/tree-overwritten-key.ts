import * as ts from "typescript5";
import { bare, lineOf, resolveImport, topLevelCallables } from "./tree-ast.ts";
import type { TreeFinding } from "./tree-findings.ts";

interface Wrapper {
  readonly path: string;
  readonly name: string;
  readonly index: number;
  readonly parameter: string;
  readonly keys: ReadonlyMap<string, number>;
}

function handedObjects(node: ts.Expression | undefined): ts.ObjectLiteralExpression[] {
  if (node === undefined) return [];
  const inner = bare(node, "unwrap-await");
  if (ts.isObjectLiteralExpression(inner)) return [inner];
  if (ts.isCallExpression(inner) || ts.isNewExpression(inner)) {
    return [...(inner.arguments ?? [])].flatMap(handedObjects);
  }
  return [];
}

function returnsWithin(node: ts.Node): boolean {
  if (ts.isReturnStatement(node)) return true;
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
  return ts.forEachChild(node, returnsWithin) === true;
}

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

function keysAfterSpread(
  object: ts.ObjectLiteralExpression,
  parameter: string,
  file: ts.SourceFile,
): Map<string, number> | null {
  const last = object.properties.findLastIndex((property) => {
    if (!ts.isSpreadAssignment(property)) return false;
    const inner = bare(property.expression, "unwrap-await");
    return ts.isIdentifier(inner) && inner.text === parameter;
  });
  if (last === -1) return null;
  const keys = new Map<string, number>();
  for (const property of object.properties.slice(last + 1)) {
    const key = keyOf(property);
    if (key !== undefined) keys.set(key, lineOf(file, property));
  }
  return keys;
}

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
      } else if (
        !(ts.isPropertyAssignment(parent) && parent.name === node) &&
        !(ts.isSpreadAssignment(parent) && built.includes(parent.parent))
      ) {
        escapes = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  const [first, ...rest] = spreadSets;
  if (escapes || first === undefined) return null;
  return new Map([...first].filter(([key]) => !read.has(key) && rest.every((keys) => keys.has(key))));
}

function wrappersOf(path: string, file: ts.SourceFile): Wrapper[] {
  return topLevelCallables(file).flatMap(({ name, node }) =>
    node.parameters.flatMap((one, index): Wrapper[] => {
      if (!ts.isIdentifier(one.name)) return [];
      const keys = deadKeys(node, one.name.text, file);
      return keys === null || keys.size === 0 ? [] : [{ path, name, index, parameter: one.name.text, keys }];
    }),
  );
}

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
    const home = resolveImport(path, statement.moduleSpecifier.text, files);
    if (home === undefined || bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const exported = (element.propertyName ?? element.name).text;
      const wrappers = (byFile.get(home) ?? []).filter((one) => one.name === exported);
      if (wrappers.length > 0) named.set(element.name.text, wrappers);
    }
  }
  return named;
}

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
          const object = bare(given, "unwrap-await");
          if (!ts.isObjectLiteralExpression(object)) continue;
          for (const property of object.properties) {
            const key = keyOf(property);
            const set = key === undefined ? undefined : wrapper.keys.get(key);
            if (set === undefined) continue;
            rows.push({
              kind: "no-overwritten-key",
              path,
              line: lineOf(file, property),
              detail: `\`${key}\` is set again by \`${wrapper.name}\` (${wrapper.path}:${String(set)}) after it spreads \`${wrapper.parameter}\`, so this value is never read`,
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
