import * as ts from "typescript5";
import manifest from "../../package.json" with { type: "json" };
import { dirname, join } from "../../src/meta/path.ts";

export type Callable = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

export interface TopCallable {
  readonly name: string;
  readonly node: Callable;
  readonly exported: boolean;
  readonly line: number;
}

interface ImportedBinding {
  readonly home: string;
  readonly name: string;
}

export interface ImportGraph {
  readonly prodReaders: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  readonly testReaders: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  readonly reexported: ReadonlyMap<string, ReadonlySet<string>>;
  readonly starProd: ReadonlySet<string>;
  readonly starTest: ReadonlySet<string>;
}

interface MutableImportGraph {
  readonly prodReaders: Map<string, Map<string, Set<string>>>;
  readonly testReaders: Map<string, Map<string, Set<string>>>;
  readonly reexported: Map<string, Set<string>>;
  readonly starProd: Set<string>;
  readonly starTest: Set<string>;
}

const K = ts.SyntaxKind;

export const TEST_PATH =
  /(?:^|\/)(?:test|tests|__tests__|__mocks__|fixtures?)\/|\.(?:test|spec|bun-tests)\.|test-support\./u;

export const OPTED_OUT =
  /@ts-nocheck|@generated\b|\bauto-?generated\b|\bdo not edit\b|^\/\/\s*vendored from\s+\S/iu;

const DECLARATION_FILE = /\.d\.[cm]?ts$/u;

const ALIASES: readonly (readonly [string, string])[] = Object.entries(manifest.imports).map(
  ([key, target]) => [key.slice(0, -1), target.slice(2, -1)] as const,
);

const WRAPPER_KINDS = new Set([
  K.ParenthesizedExpression,
  K.AsExpression,
  K.SatisfiesExpression,
  K.NonNullExpression,
  K.TypeAssertionExpression,
]);

const AWAIT_WRAPPER_KINDS = new Set([...WRAPPER_KINDS, K.AwaitExpression]);
const DECL_KINDS = new Set([K.VariableDeclaration, K.Parameter, K.BindingElement]);
const NAMED_KINDS = new Set([K.FunctionDeclaration, K.ClassDeclaration]);
const INLINE_FROM = /\bfrom\s*["'][^"'\n]*?((?:src|tools|packages|studies)\/[\w./-]+\.(?:ts|tsx|mts))["']/gu;

export const isTestPath = (path: string): boolean => TEST_PATH.test(path);

export const lineOf = (file: ts.SourceFile, node: ts.Node): number =>
  file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

export const endLineOf = (file: ts.SourceFile, node: ts.Node): number =>
  file.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

export const isFunctionValue = (
  node: ts.Node | undefined,
): node is ts.ArrowFunction | ts.FunctionExpression =>
  node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

export const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((one) => one.kind === K.ExportKeyword);

export function bare(node: ts.Expression, mode: "syntax" | "unwrap-await" = "syntax"): ts.Expression {
  const kinds = mode === "unwrap-await" ? AWAIT_WRAPPER_KINDS : WRAPPER_KINDS;
  let at = node;
  while (kinds.has(at.kind)) {
    // SAFETY: every kind in `WRAPPER_KINDS` and `AwaitExpression` carries `.expression: ts.Expression`.
    at = (at as ts.ParenthesizedExpression).expression;
  }
  return at;
}

export function parsedSources(files: ReadonlyMap<string, string>): Map<string, ts.SourceFile> {
  const out = new Map<string, ts.SourceFile>();
  for (const [path, text] of files) {
    if (DECLARATION_FILE.test(path)) continue;
    const kind = path.endsWith("x")
      ? ts.ScriptKind.TSX
      : /\.[cm]?js$/u.test(path)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
    out.set(path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind));
  }
  return out;
}

export function resolveImport(
  from: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | undefined {
  const alias = ALIASES.find(([key]) => specifier.startsWith(key));
  const base = alias
    ? alias[1] + specifier.slice(alias[0].length)
    : specifier.startsWith(".")
      ? join(dirname(from), specifier)
      : undefined;
  if (base === undefined) return undefined;
  const stem = base.replace(/\.m?js$/u, "");
  return [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${base}/index.ts`, `${base}/index.tsx`].find(
    (one) => files.has(one),
  );
}

export function importsOf(
  path: string,
  file: ts.SourceFile,
  files: ReadonlySet<string>,
): Map<string, ImportedBinding> {
  const bound = new Map<string, ImportedBinding>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const home = resolveImport(path, statement.moduleSpecifier.text, files);
    const clause = statement.importClause;
    if (home === undefined || clause === undefined) continue;
    if (clause.name !== undefined) bound.set(clause.name.text, { home, name: "default" });
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) bound.set(bindings.name.text, { home, name: "*" });
    else {
      for (const element of bindings.elements) {
        bound.set(element.name.text, { home, name: (element.propertyName ?? element.name).text });
      }
    }
  }
  return bound;
}

export function namedExportsOf(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
      }
    }
  }
  return names;
}

export function topLevelCallables(file: ts.SourceFile): TopCallable[] {
  const listed = namedExportsOf(file);
  const out: TopCallable[] = [];
  for (const statement of file.statements) {
    const modExported = isExported(statement);
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && statement.body !== undefined) {
      const name = statement.name.text;
      out.push({
        name,
        node: statement,
        exported: modExported || listed.has(name),
        line: lineOf(file, statement),
      });
    } else if (ts.isVariableStatement(statement)) {
      for (const one of statement.declarationList.declarations) {
        if (!ts.isIdentifier(one.name) || one.initializer === undefined) continue;
        const value = bare(one.initializer);
        if (!isFunctionValue(value)) continue;
        const name = one.name.text;
        out.push({ name, node: value, exported: modExported || listed.has(name), line: lineOf(file, one) });
      }
    }
  }
  return out;
}

export function boundNames(fn: ts.FunctionLikeDeclaration): Set<string> {
  const names = new Set<string>();
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
  };
  const walk = (node: ts.Node): void => {
    if (DECL_KINDS.has(node.kind)) {
      // SAFETY: `DECL_KINDS` enumerates the three declarations carrying `.name: ts.BindingName`.
      bind((node as ts.VariableDeclaration).name);
    } else if (NAMED_KINDS.has(node.kind)) {
      // SAFETY: `NAMED_KINDS` enumerates `FunctionDeclaration` and `ClassDeclaration`.
      const name = (node as ts.FunctionDeclaration).name;
      if (name !== undefined) names.add(name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      bind(node.variableDeclaration.name);
    }
    ts.forEachChild(node, walk);
  };
  for (const parameter of fn.parameters) bind(parameter.name);
  if (fn.body !== undefined) walk(fn.body);
  return names;
}

function recordEdge(graph: MutableImportGraph, from: string, home: string, name: string): void {
  if (from === home) return;
  const test = isTestPath(from);
  if (name === "*") {
    (test ? graph.starTest : graph.starProd).add(home);
    return;
  }
  const map = test ? graph.testReaders : graph.prodReaders;
  let byName = map.get(home);
  if (byName === undefined) {
    byName = new Map();
    map.set(home, byName);
  }
  let set = byName.get(name);
  if (set === undefined) {
    set = new Set();
    byName.set(name, set);
  }
  set.add(from);
}

function recordImportDecl(node: ts.ImportDeclaration, add: (specifier: string, name: string) => void): void {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return;
  const specifier = node.moduleSpecifier.text;
  const clause = node.importClause;
  if (clause?.name !== undefined) add(specifier, "default");
  const bindings = clause?.namedBindings;
  if (bindings === undefined) return;
  if (ts.isNamespaceImport(bindings)) {
    add(specifier, "*");
    return;
  }
  for (const el of bindings.elements) add(specifier, (el.propertyName ?? el.name).text);
}

function recordExportDecl(node: ts.ExportDeclaration, add: (specifier: string, name: string) => void): void {
  if (node.moduleSpecifier === undefined || !ts.isStringLiteral(node.moduleSpecifier)) return;
  const specifier = node.moduleSpecifier.text;
  if (node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
    for (const el of node.exportClause.elements) add(specifier, (el.propertyName ?? el.name).text);
    return;
  }
  add(specifier, "*");
}

function recordDynamicEdge(node: ts.Node, add: (specifier: string, name: string) => void): void {
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteral(node.argument.literal)
  ) {
    add(node.argument.literal.text, "*");
  } else if (
    ts.isCallExpression(node) &&
    node.expression.kind === K.ImportKeyword &&
    node.arguments[0] !== undefined &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    add(node.arguments[0].text, "*");
  }
}

function recordReexport(graph: MutableImportGraph, home: string, name: string): void {
  let forwarded = graph.reexported.get(home);
  if (forwarded === undefined) {
    forwarded = new Set();
    graph.reexported.set(home, forwarded);
  }
  forwarded.add(name);
}

function recordTestStringImport(node: ts.Node, paths: ReadonlySet<string>, starTest: Set<string>): void {
  if (
    !ts.isStringLiteralLike(node) ||
    ts.isImportDeclaration(node.parent) ||
    ts.isExportDeclaration(node.parent)
  ) {
    return;
  }
  for (const [, target = ""] of node.text.matchAll(INLINE_FROM)) {
    if (paths.has(target)) starTest.add(target);
  }
}

export function buildImportGraph(parsed: ReadonlyMap<string, ts.SourceFile>): ImportGraph {
  const paths = new Set(parsed.keys());
  const graph: MutableImportGraph = {
    prodReaders: new Map(),
    testReaders: new Map(),
    reexported: new Map(),
    starProd: new Set(),
    starTest: new Set(),
  };
  for (const [path, file] of parsed) {
    const addImport = (specifier: string, name: string): void => {
      const home = resolveImport(path, specifier, paths);
      if (home !== undefined) recordEdge(graph, path, home, name);
    };
    const addReexport = (specifier: string, name: string): void => {
      const home = resolveImport(path, specifier, paths);
      if (home === undefined) return;
      recordEdge(graph, path, home, name);
      recordReexport(graph, home, name);
    };
    const testFile = isTestPath(path);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) recordImportDecl(node, addImport);
      else if (ts.isExportDeclaration(node)) recordExportDecl(node, addReexport);
      else {
        recordDynamicEdge(node, addImport);
        if (testFile) recordTestStringImport(node, paths, graph.starTest);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return graph;
}
