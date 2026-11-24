import * as ts from "typescript5";
import manifest from "../../package.json" with { type: "json" };
import { ownedElsewhere } from "./ana/shared/literal-owner.ts";
import { isExported, lineOf } from "./tree-ast.ts";
import type { TreeFinding } from "./tree-findings.ts";

interface Spelling {
  readonly value: string;
  readonly path: string;
  readonly line: number;
  readonly owner: string | null;
  readonly exported: boolean;
  readonly typed: boolean;
}

const LENGTH_FLOOR = 15;
const FILE_FLOOR = 2;
const SHORT_FILE_FLOOR = 3;
const FILE_NAME =
  /^[A-Za-z][\w-]*(?:[/.][\w-]+)*\.(?:json|jsonl|ts|tsx|mts|js|mjs|md|sh|tsv|py|txt|log|ya?ml|toml|html|css)$/u;
const VERSION_TAG = /^[a-z][a-z0-9-]*\/v\d+$/u;
const DEEP_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){2,}$/u;
const NOT_A_NAME = ["${", "=", ":"];

const ALIASES = Object.entries(manifest.imports).map(
  ([key, target]) => [key.slice(0, -1), target.slice(2, -1)] as const,
);

function isIdentity(value: string): boolean {
  if (/\s/u.test(value) || NOT_A_NAME.some((mark) => value.includes(mark)) || ownedElsewhere(value)) {
    return false;
  }
  return (
    FILE_NAME.test(value) ||
    VERSION_TAG.test(value) ||
    (value.length >= LENGTH_FLOOR && DEEP_PATH.test(value))
  );
}

function isTypedContext(node: ts.Node, file: ts.SourceFile): boolean {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isTypeNode(at) || ts.isImportDeclaration(at) || ts.isExportDeclaration(at)) return true;
    if (
      ts.isCallExpression(at) &&
      ts.isPropertyAccessExpression(at.expression) &&
      at.expression.name.text === "Literal"
    ) {
      return true;
    }
    if (ts.isSatisfiesExpression(at) && !/\bstring\b/u.test(at.type.getText(file))) return true;
    if (
      ts.isAsExpression(at) &&
      at.type.getText(file) === "const" &&
      ts.isVariableDeclaration(at.parent) &&
      ts.isIdentifier(at.parent.name) &&
      file.text.includes(`typeof ${at.parent.name.text}`)
    ) {
      return true;
    }
  }
  return false;
}

function ownerOf(node: ts.StringLiteral): { owner: string | null; exported: boolean } {
  const parent = node.parent;
  if (!ts.isVariableDeclaration(parent) || parent.initializer !== node || !ts.isIdentifier(parent.name)) {
    return { owner: null, exported: false };
  }
  return { owner: parent.name.text, exported: isExported(parent.parent.parent) };
}

function loadedSpecifiers(file: ts.SourceFile): Set<string> {
  const specifiers = new Set<string>();
  const add = (value: string): void => {
    specifiers.add(value);
    for (const [key, tree] of ALIASES) {
      if (value.startsWith(key)) specifiers.add(tree + value.slice(key.length));
    }
  };
  const walk = (node: ts.Node): void => {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      add(node.arguments[0].text);
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return specifiers;
}

function spellingsIn(path: string, file: ts.SourceFile): Spelling[] {
  const specifiers = loadedSpecifiers(file);
  const loaded = (value: string): boolean =>
    [...specifiers].some((one) => one === value || one.endsWith(`/${value}`));
  const found: Spelling[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "pathToFileURL"
    ) {
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "join") {
      let run: string[] = [];
      const flush = (): void => {
        if (run.length >= 2) {
          const joined = run.join("/");
          if (isIdentity(joined) && !loaded(joined)) {
            found.push({
              value: joined,
              path,
              line: lineOf(file, node),
              owner: null,
              exported: false,
              typed: false,
            });
          }
        }
        run = [];
      };
      for (const arg of node.arguments) {
        if (ts.isStringLiteral(arg)) run.push(arg.text);
        else flush();
      }
      flush();
    } else if (ts.isStringLiteral(node) && isIdentity(node.text) && !loaded(node.text)) {
      const { owner, exported } = ownerOf(node);
      found.push({
        value: node.text,
        path,
        line: lineOf(file, node),
        owner,
        exported,
        typed: isTypedContext(node, file),
      });
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return found;
}

function ownerClause(owner: Spelling | undefined, value: string): string {
  if (owner === undefined) return "and no file names it";
  const where = `\`${owner.owner ?? ""}\` in ${owner.path}`;
  const names = owner.value === value ? "names it" : `names it as \`${owner.value}\``;
  return owner.exported ? `and ${where} already ${names}` : `and ${where} ${names} but does not export it`;
}

export function identitiesWithoutOwner(parsed: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const spellings = Map.groupBy(
    [...parsed].flatMap(([path, file]) => spellingsIn(path, file)),
    (one) => one.value,
  );
  const owners = [...spellings.values()].flat().filter((one) => one.owner !== null);
  return [...spellings].flatMap(([value, found]): TreeFinding[] => {
    const count = new Set(found.map((one) => one.path)).size;
    const anchor = found.find((one) => one.owner === null) ?? found[0];
    const floor = value.length < LENGTH_FLOOR ? SHORT_FILE_FLOOR : FILE_FLOOR;
    if (count < floor || anchor === undefined || found.some((one) => one.typed)) return [];
    const owner =
      found.find((one) => one.owner !== null) ?? owners.find((one) => one.value.endsWith(`/${value}`));
    const detail = `\`${value}\` is spelled in ${String(count)} files ${ownerClause(owner, value)}`;
    return [{ kind: "no-unowned-identity", path: anchor.path, line: anchor.line, detail }];
  });
}
