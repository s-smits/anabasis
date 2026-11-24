import * as ts from "typescript5";
import { crossings } from "./ana/shared/crossed.ts";
import { importsOf, isFunctionValue, lineOf } from "./tree-ast.ts";
import type { TreeFinding } from "./tree-findings.ts";

interface Declared {
  readonly path: string;
  readonly line: number;
  readonly params: (string | null)[];
}

function argumentName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) ? node.name.text : null;
}

function methodsOf(
  object: string,
  literal: ts.ObjectLiteralExpression,
): [string, ts.SignatureDeclarationBase][] {
  return literal.properties.flatMap((property): [string, ts.SignatureDeclarationBase][] => {
    const name = property.name;
    if (name === undefined || !ts.isIdentifier(name)) return [];
    const key = `${object}.${name.text}`;
    if (ts.isMethodDeclaration(property)) return [[key, property]];
    if (ts.isPropertyAssignment(property) && isFunctionValue(property.initializer)) {
      return [[key, property.initializer]];
    }
    return [];
  });
}

function signaturesOf(file: ts.SourceFile): [string, ts.SignatureDeclarationBase][] {
  return file.statements.flatMap((statement): [string, ts.SignatureDeclarationBase][] => {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      return [[statement.name.text, statement]];
    }
    if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      const built = statement.members.find(ts.isConstructorDeclaration);
      return built === undefined ? [] : [[`new ${statement.name.text}`, built]];
    }
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.flatMap((one): [string, ts.SignatureDeclarationBase][] => {
      if (!ts.isIdentifier(one.name) || one.initializer === undefined) return [];
      if (isFunctionValue(one.initializer)) return [[one.name.text, one.initializer]];
      if (ts.isObjectLiteralExpression(one.initializer)) return methodsOf(one.name.text, one.initializer);
      return [];
    });
  });
}

function declaredIn(path: string, file: ts.SourceFile): Map<string, Declared> {
  const declared = new Map<string, Declared>();
  for (const [name, list] of Map.groupBy(signaturesOf(file), ([each]) => each)) {
    const [only] = list;
    if (list.length > 1 || only === undefined) continue;
    const fn = only[1];
    declared.set(name, {
      path,
      line: lineOf(file, fn),
      params: fn.parameters.map((one) => (ts.isIdentifier(one.name) ? one.name.text : null)),
    });
  }
  return declared;
}

function reachOf(node: ts.CallExpression | ts.NewExpression): { local: string; rest: string } | null {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return { local: callee.text, rest: "" };
  if (ts.isNewExpression(node) || !ts.isPropertyAccessExpression(callee)) return null;
  return ts.isIdentifier(callee.expression)
    ? { local: callee.expression.text, rest: callee.name.text }
    : null;
}

export function crossedArguments(parsed: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const paths = new Set(parsed.keys());
  const byFile = new Map([...parsed].map(([path, file]) => [path, declaredIn(path, file)]));
  const rows: TreeFinding[] = [];
  for (const [path, file] of parsed) {
    const bound = importsOf(path, file, paths);
    if (bound.size === 0) continue;
    const lookUp = (node: ts.CallExpression | ts.NewExpression): Declared | undefined => {
      const reach = reachOf(node);
      if (reach === null) return undefined;
      const from = bound.get(reach.local);
      if (from === undefined) return undefined;
      const prefix = ts.isNewExpression(node) ? "new " : "";
      const name = from.name === "*" ? reach.rest : [from.name, reach.rest].filter(Boolean).join(".");
      return name === "" ? undefined : byFile.get(from.home)?.get(`${prefix}${name}`);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const args = node.arguments ?? ts.factory.createNodeArray();
        const declared = args.some(ts.isSpreadElement) ? undefined : lookUp(node);
        if (declared !== undefined) {
          const names = args.map(argumentName);
          for (const crossing of crossings(names, declared.params)) {
            const given = crossing.map((i) => `\`${names[i] ?? ""}\` at \`${declared.params[i] ?? ""}\``);
            rows.push({
              kind: "no-transposed-argument",
              path,
              line: lineOf(file, node),
              detail: `\`${node.expression.getText(file)}\` (${declared.path}:${String(declared.line)}) receives ${given.join(", ")}: each argument is named for the parameter of another`,
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
