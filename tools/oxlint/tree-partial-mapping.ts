/**
 * `require-exhaustive-mapping` (generic): a lookup `Map` keyed by most members of a declared set,
 * read with a computed key, and held by no type to that set.
 */
import * as ts from "typescript5";
import type { TreeFinding } from "./tree-findings.ts";

interface KnownSet {
  name: string;
  values: ReadonlySet<string>;
  path: string;
}

interface Table {
  name: string;
  keys: ReadonlySet<string>;
  line: number;
  end: number;
}

const KEYS_FLOOR = 2;
const WRITES = new Set(["set", "delete", "clear"]);
const NAME_KINDS = new Set([ts.SyntaxKind.Identifier, ts.SyntaxKind.StringLiteral]);

function tableKeys(value: ts.Expression): string[] | null {
  if (!ts.isNewExpression(value) || value.expression.getText() !== "Map") return null;
  const [items] = value.arguments ?? [];
  if (items === undefined) return null;
  if (ts.isCallExpression(items) && items.expression.getText() === "Object.entries") {
    const [object] = items.arguments;
    if (object === undefined || !ts.isObjectLiteralExpression(object)) return null;
    const keys = object.properties.map((one) => {
      if (!ts.isPropertyAssignment(one) || !NAME_KINDS.has(one.name.kind)) return null;
      // SAFETY: `NAME_KINDS` enumerates `Identifier` and `StringLiteral`, both having `.text`.
      return (one.name as ts.Identifier).text;
    });
    return keys.every((one) => one !== null) ? keys : null;
  }
  if (!ts.isArrayLiteralExpression(items)) return null;
  const keys = items.elements.map((pair) => {
    const first = ts.isArrayLiteralExpression(pair) ? pair.elements[0] : undefined;
    return first !== undefined && ts.isStringLiteralLike(first) ? first.text : null;
  });
  return keys.every((one) => one !== null) ? keys : null;
}

function tablesIn(file: ts.SourceFile): Table[] {
  const lineOf = (position: number): number => file.getLineAndCharacterOfPosition(position).line + 1;
  const found: Table[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    ts.forEachChild(node, visit);
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.type !== undefined) return;
    if (node.initializer === undefined) return;
    const keys = tableKeys(node.initializer);
    if (keys === null) return;
    const unique = new Set(keys);
    if (unique.size < KEYS_FLOOR) return;
    found.push({
      name: node.name.text,
      keys: unique,
      line: lineOf(node.getStart(file)),
      end: lineOf(node.getEnd()),
    });
  };
  visit(file);
  return found;
}

function accessed(sources: ReadonlyMap<string, ts.SourceFile>) {
  const read = new Set<string>();
  const written = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    ts.forEachChild(node, visit);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const { expression: owner, name } = node.expression;
    if (!ts.isIdentifier(owner)) return;
    if (WRITES.has(name.text)) written.add(owner.text);
    const [key] = node.arguments;
    if (name.text === "get" && key !== undefined && !ts.isStringLiteralLike(key)) read.add(owner.text);
  };
  for (const file of sources.values()) visit(file);
  return { read, written };
}

/** Each table that leaves part of its set out, or maps it whole with nothing holding it there. */
export function partialMappings(
  sources: ReadonlyMap<string, ts.SourceFile>,
  sets: readonly KnownSet[],
  local: readonly Pick<KnownSet, "values" | "path">[],
): TreeFinding[] {
  const { read, written } = accessed(sources);
  const holds = (values: ReadonlySet<string>, keys: ReadonlySet<string>): boolean =>
    values.size >= keys.size && [...keys].every((key) => values.has(key));
  return [...sources].flatMap(([path, file]) =>
    tablesIn(file)
      .filter((table) => read.has(table.name) && !written.has(table.name))
      .flatMap((table) => {
        const set = sets
          .filter(({ values }) => holds(values, table.keys))
          .toSorted((a, b) => a.values.size - b.values.size)[0];
        if (set === undefined) return [];
        const missing = [...set.values].filter((value) => !table.keys.has(value));
        const exact = local.some(
          (one) => one.path === path && one.values.size === table.keys.size && holds(one.values, table.keys),
        );
        if (missing.length > table.keys.size || (missing.length > 0 && exact)) return [];
        const said =
          missing.length > 0
            ? `maps ${String(table.keys.size)} of the ${String(set.values.size)} values of \`${set.name}\` (${set.path}) and leaves out ${String(missing.length)}: ${missing.map((one) => `"${one}"`).join(", ")}`
            : `maps all ${String(set.values.size)} values of \`${set.name}\` (${set.path}) and leaves out 0, but no type holds it there, so a value added to the set reads as nothing`;
        return [
          {
            kind: "require-exhaustive-mapping",
            path,
            line: table.line,
            detail: `\`${table.name}\` ${said}; say which set it maps (\`satisfies Record<…>\` on its entries)`,
            places: [{ path, line: table.line, end: table.end }],
          } satisfies TreeFinding,
        ];
      }),
  );
}
