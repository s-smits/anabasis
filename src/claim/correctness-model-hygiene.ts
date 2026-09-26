/**
 * Reject direct process loading and ambient-environment forwarding in authored verifier source
 * before bundling. External execution belongs to the verifier host; the confined evaluator
 * process remains a separate runtime boundary.
 */
import * as ts from "typescript5";
import type { BundleFile } from "./bundle-hash.ts";
import { specifiersIn } from "./bundle-validation.ts";

type GeneratedCorrectnessModelCapabilityEscapeKind = "child-process" | "ambient-environment-spread";

interface GeneratedCorrectnessModelCapabilityEscape {
  kind: GeneratedCorrectnessModelCapabilityEscapeKind;
  token: string;
  position: number;
}

const CODE_EXTENSION = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

function unwrapParentheses(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** The member name (null when computed) and target of `a.b` or `a["b"]`. */
function memberAccess(node: ts.Expression): { name: string | null; target: ts.Expression } | null {
  const expression = unwrapParentheses(node);
  if (ts.isPropertyAccessExpression(expression)) {
    return { name: expression.name.text, target: expression.expression };
  }
  if (!ts.isElementAccessExpression(expression)) return null;
  const argument = expression.argumentExpression;
  return { name: ts.isStringLiteralLike(argument) ? argument.text : null, target: expression.expression };
}

function bindsProcess(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return name.text === "process";
  return name.elements.some((element) => !ts.isOmittedExpression(element) && bindsProcess(element.name));
}

function listBindsProcess(list: ts.VariableDeclarationList): boolean {
  return list.declarations.some((declaration) => bindsProcess(declaration.name));
}

function statementDeclaresProcess(statement: ts.Statement): boolean {
  if (ts.isVariableStatement(statement)) return listBindsProcess(statement.declarationList);
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    const names =
      bindings === undefined
        ? []
        : ts.isNamespaceImport(bindings)
          ? [bindings.name]
          : bindings.elements.map((element) => element.name);
    return [clause?.name, ...names].some((name) => name?.text === "process");
  }
  const named =
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement);
  return named && statement.name?.text === "process";
}

/** Whether this node opens a scope that declares its own `process` value. */
function scopeDeclaresProcess(node: ts.Node): boolean {
  if (ts.isSourceFile(node) || ts.isBlock(node)) return node.statements.some(statementDeclaresProcess);
  if (ts.isFunctionLike(node)) {
    return (
      node.parameters.some((parameter) => bindsProcess(parameter.name)) ||
      (ts.isFunctionExpression(node) && node.name?.text === "process")
    );
  }
  if (ts.isCatchClause(node)) {
    return node.variableDeclaration !== undefined && bindsProcess(node.variableDeclaration.name);
  }
  const initializer =
    ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
      ? node.initializer
      : undefined;
  return (
    initializer !== undefined && ts.isVariableDeclarationList(initializer) && listBindsProcess(initializer)
  );
}

function isGlobalProcess(node: ts.Expression): boolean {
  const expression = unwrapParentheses(node);
  if (ts.isIdentifier(expression)) {
    for (let scope: ts.Node | undefined = expression.parent; scope !== undefined; scope = scope.parent) {
      if (scopeDeclaresProcess(scope)) return false;
    }
    return expression.text === "process";
  }
  const access = memberAccess(expression);
  const target = access === null ? null : unwrapParentheses(access.target);
  return (
    access?.name === "process" &&
    target !== null &&
    ts.isIdentifier(target) &&
    ["globalThis", "global"].includes(target.text)
  );
}

function isProcessEnvironment(node: ts.Expression): boolean {
  const access = memberAccess(node);
  return access?.name === "env" && isGlobalProcess(access.target);
}

/** Find direct child-process imports and process.env spreads in generated correctness-model code. */
export function generatedCorrectnessModelCapabilityEscapes(
  sourceFile: ts.SourceFile,
): GeneratedCorrectnessModelCapabilityEscape[] {
  const candidates: GeneratedCorrectnessModelCapabilityEscape[] = [];
  for (const load of specifiersIn(sourceFile).loads.filter(({ text }) =>
    ["child_process", "node:child_process"].includes(text),
  )) {
    candidates.push({ kind: "child-process", token: load.text, position: load.getStart(sourceFile) });
  }
  const visit = (node: ts.Node): void => {
    if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && isProcessEnvironment(node.expression)) {
      candidates.push({
        kind: "ambient-environment-spread",
        token: sourceFile.text.slice(node.getStart(sourceFile), node.end),
        position: node.getStart(sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  candidates.sort((left, right) => left.position - right.position);
  return candidates;
}

/** Correctness-model files this scan reads: authored modules, never the Builder's own tests, which
 *  sit outside the verifier's runtime closure. */
export function scannableBundleSource(file: BundleFile): boolean {
  return CODE_EXTENSION.test(file.path) && !TEST_FILE.test(file.path);
}
