/**
 * `partial-mapping` (generic): a lookup `Map` keyed by most members of a declared set, read with a
 * key the code does not spell, and held by no type to that set. `const EXAMINED = new Map([
 * ["finished", …], ["supplied", …], ["crashed", …], ["killed", …]])`, read as
 * `EXAMINED.get(ended)`, maps four of the eight ways an Examiner session ends: a session that ended
 * `stopped` reads as nothing, or as whatever default the reader supplies, and nobody is told. A
 * `Map`'s `get` takes any key, so the compiler holds every member only where the table says which
 * set it maps (`satisfies Record<Ending, string>` on the object its entries come from). An object
 * literal read with a typed key needs no such word: a key it lacks is already a type error.
 *
 * A table is a `new Map` of `[literal, value]` pairs, or of `Object.entries` of a plain object
 * literal, with at least two keys, bound to a name with no annotation, read somewhere as
 * `TABLE.get(key)` with a computed key and never changed (`set`, `delete`, `clear`: an accumulator
 * is no table). Its set is the smallest exported set (`tree-implicit-state.ts` gathers them:
 * unions, `as const` lists, string enums, `Set`s of literals and discriminated unions) that holds
 * every key. Reported: a table that maps at least half of its set and leaves the rest out, unless
 * its keys are exactly another set its own file declares, which it then maps whole; and a table
 * that maps its whole set, since nothing holds it there once the set grows. A table that maps fewer
 * than half is a selection (which of these are special), whose reader expects a miss.
 *
 * `@typescript-eslint/switch-exhaustiveness-check` (typescript-eslint, `src/rules/
 * switch-exhaustiveness-check.ts`) already holds a `switch` over a union to every member, and the
 * repository runs it as an error, so a switch is not read here. No upstream rule reads a lookup
 * table against a declared set; this one is written here.
 */
import * as ts from "typescript5";
import type { TreeFinding } from "./tree-findings.ts";

/** A declared set of values, as the literal census finds it. */
interface KnownSet {
  name: string;
  values: ReadonlySet<string>;
  path: string;
}

/** A lookup table: its name, its keys and where it is declared. */
interface Table {
  name: string;
  keys: ReadonlySet<string>;
  line: number;
  end: number;
}

/** The fewest keys a table holds. */
const KEYS_FLOOR = 2;
/** Methods that change a `Map`: a table changed after it is built is an accumulator. */
const WRITES = new Set(["set", "delete", "clear"]);

/** The keys a `new Map` spells: literal pairs, or `Object.entries` of a plain object literal. */
function tableKeys(value: ts.Expression): string[] | null {
  if (!ts.isNewExpression(value) || value.expression.getText() !== "Map") return null;
  const [items] = value.arguments ?? [];
  if (items !== undefined && ts.isCallExpression(items) && items.expression.getText() === "Object.entries") {
    const [object] = items.arguments;
    if (object === undefined || !ts.isObjectLiteralExpression(object)) return null;
    const keys = object.properties.map((one) =>
      ts.isPropertyAssignment(one) && (ts.isIdentifier(one.name) || ts.isStringLiteral(one.name))
        ? one.name.text
        : null,
    );
    return keys.every((one) => one !== null) ? keys : null;
  }
  if (items === undefined || !ts.isArrayLiteralExpression(items)) return null;
  const keys = items.elements.map((pair) => {
    const first = ts.isArrayLiteralExpression(pair) ? pair.elements[0] : undefined;
    return first !== undefined && ts.isStringLiteralLike(first) ? first.text : null;
  });
  return keys.every((one) => one !== null) ? keys : null;
}

/** Every unannotated table one file declares. */
function tablesIn(file: ts.SourceFile): Table[] {
  const lineOf = (position: number): number => file.getLineAndCharacterOfPosition(position).line + 1;
  const found: Table[] = [];
  const visit = (node: ts.Node): void => {
    ts.forEachChild(node, visit);
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.type !== undefined) return;
    const keys = node.initializer === undefined ? null : tableKeys(node.initializer);
    if (keys === null || new Set(keys).size < KEYS_FLOOR) return;
    const at = { line: lineOf(node.getStart(file)), end: lineOf(node.getEnd()) };
    found.push({ name: node.name.text, keys: new Set(keys), ...at });
  };
  visit(file);
  return found;
}

/** The names some file calls `name.get(key)` on with a computed key, and the names it changes. */
function accessed(sources: ReadonlyMap<string, ts.SourceFile>): { read: Set<string>; written: Set<string> } {
  const read = new Set<string>();
  const written = new Set<string>();
  const visit = (node: ts.Node): void => {
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
            kind: "partial-mapping",
            path,
            line: table.line,
            detail: `\`${table.name}\` ${said}; say which set it maps (\`satisfies Record<…>\` on its entries)`,
            places: [{ path, line: table.line, end: table.end }],
          } satisfies TreeFinding,
        ];
      }),
  );
}
