/**
 * The implicit-state shapes that need every file at once: a state whose values are compared by
 * hand in many files. Run on any folder as
 * `bun tools/oxlint/tree-implicit-state.ts <root> [--json] [--readers <n>]`.
 */
import * as ts from "typescript5";
import { readdirSync, readFileSync } from "../../src/meta/filesystem.ts";
import { join, relative } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { repeatedExternalReads } from "./tree-external-read.ts";
import type { TreeFinding } from "./tree-findings.ts";
import { parsedSources } from "./tree-overwritten-key.ts";
import { partialMappings } from "./tree-partial-mapping.ts";
import { secondReaders } from "./tree-second-reader.ts";
import { type LiteralSet, statefulSets } from "./tree-state-role.ts";

interface Declared {
  name: string;
  values: ReadonlySet<string>;
  path: string;
  line: number;
  property?: string;
}

interface Variants {
  name: string;
  members: readonly ts.TypeNode[];
  path: string;
  line: number;
}

interface Grouping {
  subject: string;
  values: readonly string[];
  path: string;
  line: number;
  switchCovers?: ReadonlySet<string>;
}

interface Found {
  row: TreeFinding;
  set: LiteralSet;
}

interface Census {
  typed: Set<string>;
  tagged: Map<string, ReadonlyMap<string, string>>;
  variants: Variants[];
  local: Pick<Declared, "values" | "path">[];
}

const K = ts.SyntaxKind;
const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|__mocks__|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const SKIPPED_DIRECTORY =
  /^(?:node_modules|dist|build|out|coverage|vendor|vendored|third[-_]party|generated)$|^\./u;
const SOURCE = /\.(?:ts|tsx|mts|cts)$/u;
const DECLARATION = /\.d\.[cm]?ts$/u;
const READER_FLOOR = 2;
const INLINE = "(inline)";
const WORD = /^[A-Za-z][\w-]*$/u;
const NAMED_DECL_KINDS = new Set([K.TypeAliasDeclaration, K.InterfaceDeclaration, K.EnumDeclaration]);
const ALIAS_OR_ENUM = new Set([K.TypeAliasDeclaration, K.EnumDeclaration]);
const PROP_OR_VAR = new Set([K.PropertySignature, K.PropertyDeclaration, K.VariableDeclaration]);
const CLASS_OR_IFACE = new Set([K.InterfaceDeclaration, K.ClassDeclaration]);
const UNWRAP_CONST = new Set([K.AsExpression, K.SatisfiesExpression]);
const VARIANT_MEMBER = new Set([K.TypeLiteral, K.TypeReference]);
const EQ_OPS = new Set([K.EqualsEqualsEqualsToken, K.EqualsEqualsToken]);
const NEQ_OPS = new Set([K.ExclamationEqualsEqualsToken, K.ExclamationEqualsToken]);
const CHAIN_OPS = new Set([K.BarBarToken, K.AmpersandAmpersandToken]);

const lineOf = (file: ts.SourceFile, node: ts.Node): number =>
  file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
const textOf = (file: ts.SourceFile, node: ts.Node): string => node.getText(file).replaceAll(/\s+/gu, "");

function tagsOf(members: readonly ts.TypeElement[]): Map<string, string> {
  const tags = new Map<string, string>();
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
    const { type } = member;
    if (type !== undefined && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
      tags.set(member.name.text, type.literal.text);
    }
  }
  return tags;
}

function namedExportsOf(file: ts.SourceFile): Set<string> {
  return new Set(
    file.statements.flatMap((one) =>
      ts.isExportDeclaration(one) &&
      one.moduleSpecifier === undefined &&
      one.exportClause !== undefined &&
      ts.isNamedExports(one.exportClause)
        ? one.exportClause.elements.map((element) => (element.propertyName ?? element.name).text)
        : [],
    ),
  );
}

function exported(node: ts.Node, file: ts.SourceFile, named: ReadonlySet<string>): boolean {
  let top = node;
  while (top.parent !== undefined && !ts.isSourceFile(top.parent)) {
    if (ts.isFunctionLike(top) || top.kind === K.Block) return false;
    top = top.parent;
  }
  const modifiers = ts.canHaveModifiers(top) ? (ts.getModifiers(top) ?? []) : [];
  if (modifiers.some((one) => one.kind === K.ExportKeyword)) return true;
  if (named.size === 0) return false;
  if (ts.isVariableStatement(top)) {
    return top.declarationList.declarations.some((one) => named.has(one.name.getText(file)));
  }
  // SAFETY: `NAMED_DECL_KINDS` enumerates `TypeAliasDeclaration`, `InterfaceDeclaration`, and `EnumDeclaration`.
  return NAMED_DECL_KINDS.has(top.kind) && named.has((top as ts.TypeAliasDeclaration).name.text);
}

function discriminated(variants: Variants, tagged: Census["tagged"]): Declared[] {
  const resolved = variants.members.map((one) =>
    ts.isTypeLiteralNode(one)
      ? tagsOf(one.members)
      : tagged.get(ts.isTypeReferenceNode(one) ? one.typeName.getText() : ""),
  );
  const maps = resolved.filter((tags): tags is Map<string, string> => tags !== undefined);
  const [first] = maps;
  if (first === undefined || maps.length !== resolved.length || maps.length < 2) return [];
  const { name, path, line } = variants;
  return [...first.keys()].flatMap((property) => {
    const values = new Set(maps.map((tags) => tags.get(property)));
    if (values.has(undefined) || values.size < 2) return [];
    const states = new Set([...values].filter((value) => value !== undefined));
    return [{ name: `${name}.${property}`, values: states, path, line, property }];
  });
}

function unionValues(node: ts.TypeNode, lists: ReadonlyMap<string, readonly string[]>): string[] | null {
  if (!ts.isUnionTypeNode(node)) return null;
  const values: string[] = [];
  for (const member of node.types) {
    if (ts.isLiteralTypeNode(member)) {
      if (ts.isStringLiteral(member.literal)) values.push(member.literal.text);
      else if (member.literal.kind !== K.NullKeyword) return null;
    } else if (ts.isIndexedAccessTypeNode(member) && ts.isParenthesizedTypeNode(member.objectType)) {
      const listed = lists.get(member.objectType.type.getText().replace(/^typeof /u, ""));
      if (listed === undefined) return null;
      values.push(...listed);
    } else if (member.kind !== K.UndefinedKeyword) return null;
  }
  return values;
}

function constValues(node: ts.Node): string[] | null {
  const asConst = ts.isAsExpression(node) && node.type.getText() === "const";
  // SAFETY: `UNWRAP_CONST` enumerates `AsExpression` and `SatisfiesExpression`, both having `.expression`.
  const inner = UNWRAP_CONST.has(node.kind) ? (node as ts.AsExpression).expression : node;
  if (ts.isNewExpression(inner) && inner.expression.getText() === "Set") {
    const [items] = inner.arguments ?? [];
    return items !== undefined && ts.isArrayLiteralExpression(items) ? literalsOf(items.elements) : null;
  }
  if (!asConst) return null;
  if (ts.isArrayLiteralExpression(inner)) return literalsOf(inner.elements);
  if (!ts.isObjectLiteralExpression(inner)) return null;
  return literalsOf(
    inner.properties.flatMap((one) => (ts.isPropertyAssignment(one) ? [one.initializer] : [])),
  );
}

function literalsOf(nodes: readonly ts.Node[]): string[] | null {
  const values = nodes.flatMap((one) => (ts.isStringLiteralLike(one) ? [one.text] : []));
  return values.length === nodes.length ? values : null;
}

function nameOf(node: ts.Node, file: ts.SourceFile): string {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ALIAS_OR_ENUM.has(at.kind)) {
      // SAFETY: `ALIAS_OR_ENUM` enumerates `TypeAliasDeclaration` and `EnumDeclaration`.
      const name = (at as ts.TypeAliasDeclaration).name;
      if (ts.isIdentifier(name)) return name.text;
    }
    if (at.kind === K.Parameter || ts.isFunctionLike(at)) return INLINE;
    if (PROP_OR_VAR.has(at.kind)) {
      const owner = at.parent;
      // SAFETY: `CLASS_OR_IFACE` enumerates `InterfaceDeclaration` and `ClassDeclaration`.
      const prefix = CLASS_OR_IFACE.has(owner.kind) ? `${(owner as ts.InterfaceDeclaration).name.text}.` : "";
      // SAFETY: `PROP_OR_VAR` enumerates nodes carrying `.name`.
      return `${prefix}${(at as ts.PropertySignature).name.getText(file)}`;
    }
  }
  return INLINE;
}

function declaredIn(path: string, file: ts.SourceFile, census: Census): Declared[] {
  const found: Declared[] = [];
  const named = namedExportsOf(file);
  const lists = new Map(
    file.statements.flatMap((one) =>
      ts.isVariableStatement(one)
        ? one.declarationList.declarations.flatMap((declared) => {
            const values = declared.initializer === undefined ? null : constValues(declared.initializer);
            return values === null ? [] : [[declared.name.getText(file), values] as const];
          })
        : [],
    ),
  );
  const add = (node: ts.Node, values: readonly string[] | null): void => {
    for (const value of values ?? []) census.typed.add(value);
    if (values === null) return;
    const unique = new Set(values);
    if (unique.size < 2) return;
    const name = nameOf(node, file);
    const set = { name, values: unique, path, line: lineOf(file, node) };
    if (name !== INLINE && exported(node, file, named)) found.push(set);
    else census.local.push(set);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) census.typed.add(node.literal.text);
    else if (ts.isUnionTypeNode(node) && node.parent.kind !== K.UnionType) {
      add(node, unionValues(node, lists));
    } else if (ts.isInterfaceDeclaration(node)) census.tagged.set(node.name.text, tagsOf(node.members));
    else if (ts.isTypeAliasDeclaration(node)) {
      const { type } = node;
      if (ts.isTypeLiteralNode(type)) census.tagged.set(node.name.text, tagsOf(type.members));
      else if (
        ts.isUnionTypeNode(type) &&
        type.types.every((one) => VARIANT_MEMBER.has(one.kind)) &&
        exported(node, file, named)
      ) {
        census.variants.push({ name: node.name.text, members: type.types, path, line: lineOf(file, node) });
      }
    } else if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      add(node.initializer, constValues(node.initializer));
    } else if (ts.isEnumDeclaration(node)) {
      const inits = node.members.flatMap((one) => (one.initializer === undefined ? [] : [one.initializer]));
      add(node.members[0] ?? node, literalsOf(inits));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function compared(
  node: ts.Expression,
  file: ts.SourceFile,
  operators: ReadonlySet<ts.SyntaxKind>,
): [string, string] | null {
  if (!ts.isBinaryExpression(node) || !operators.has(node.operatorToken.kind)) return null;
  const [subject, literal] = ts.isStringLiteralLike(node.right)
    ? [node.left, node.right]
    : [node.right, node.left];
  if (!ts.isStringLiteralLike(literal) || ts.isTypeOfExpression(subject) || ts.isStringLiteralLike(subject)) {
    return null;
  }
  return [textOf(file, subject), literal.text];
}

function chain(node: ts.Expression, operator: ts.SyntaxKind): ts.Expression[] {
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === operator) {
    return [...chain(inner.left, operator), ...chain(inner.right, operator)];
  }
  return [inner];
}

function chainGroupings(node: ts.BinaryExpression, file: ts.SourceFile, path: string): Grouping[] {
  const operator = node.operatorToken.kind;
  if (!CHAIN_OPS.has(operator)) return [];
  const parent = ts.isParenthesizedExpression(node.parent) ? node.parent.parent : node.parent;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === operator) return [];
  const operators = operator === K.BarBarToken ? EQ_OPS : NEQ_OPS;
  const pairs = chain(node, operator).flatMap((one) => {
    const pair = compared(one, file, operators);
    return pair === null ? [] : [pair];
  });
  return [...Map.groupBy(pairs, ([subject]) => subject)].flatMap(([subject, under]) => {
    const values = [...new Set(under.map(([, value]) => value))];
    return values.length < 2 ? [] : [{ subject, values, path, line: lineOf(file, node) }];
  });
}

function membershipGrouping(node: ts.CallExpression, file: ts.SourceFile, path: string): Grouping | null {
  const callee = node.expression;
  const [subject] = node.arguments;
  if (!ts.isPropertyAccessExpression(callee) || subject === undefined) return null;
  const method = callee.name.text;
  const values =
    method === "includes" && ts.isArrayLiteralExpression(callee.expression)
      ? literalsOf(callee.expression.elements)
      : method === "has"
        ? constValues(callee.expression)
        : null;
  return values === null || values.length < 2
    ? null
    : { subject: textOf(file, subject), values, path, line: lineOf(file, node) };
}

function switchGroupings(node: ts.SwitchStatement, file: ts.SourceFile, path: string): Grouping[] {
  const covers = new Set<string>();
  const groups: string[][] = [[]];
  for (const clause of node.caseBlock.clauses) {
    if (ts.isCaseClause(clause) && ts.isStringLiteralLike(clause.expression)) {
      covers.add(clause.expression.text);
      groups.at(-1)?.push(clause.expression.text);
    }
    if (clause.statements.length > 0) groups.push([]);
  }
  const subject = textOf(file, node.expression);
  return groups
    .filter((values) => values.length >= 2)
    .map((values) => ({ subject, values, path, line: lineOf(file, node), switchCovers: covers }));
}

function groupingsIn(path: string, file: ts.SourceFile): Grouping[] {
  const found: Grouping[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) found.push(...chainGroupings(node, file, path));
    else if (ts.isCallExpression(node)) {
      const membership = membershipGrouping(node, file, path);
      if (membership !== null) found.push(membership);
    } else if (ts.isSwitchStatement(node)) found.push(...switchGroupings(node, file, path));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const quoted = (values: Iterable<string>): string => [...values].map((value) => `"${value}"`).join(" | ");

function unownedLiterals(
  groupings: readonly Grouping[],
  typed: ReadonlySet<string>,
  readers: number,
): Found[] {
  const unowned = groupings.filter(
    ({ values }) => values.every((value) => WORD.test(value)) && !values.some((value) => typed.has(value)),
  );
  return [...Map.groupBy(unowned, (one) => quoted(one.values.toSorted()))].flatMap(([values, under]) => {
    const readerFiles = new Set(under.map((one) => one.path));
    const [first] = under;
    if (first === undefined || readerFiles.size < readers) return [];
    const row: TreeFinding = {
      kind: "no-unowned-state-literals",
      path: first.path,
      line: first.line,
      detail: `${values} is compared by hand in ${readerFiles.size} files and no type, \`as const\`, enum or \`Set\` declares those states`,
      places: under.map((one) => ({ path: one.path, line: one.line, end: one.line })),
    };
    return [{ row, set: { values: new Set(first.values), subjects: under.map((one) => one.subject) } }];
  });
}

function censusOf(parsed: ReadonlyMap<string, ts.SourceFile>) {
  const census: Census = { typed: new Set(), tagged: new Map(), variants: [], local: [] };
  const declared = [...parsed].flatMap(([path, file]) => declaredIn(path, file, census));
  declared.push(...census.variants.flatMap((one) => discriminated(one, census.tagged)));
  return { declared, typed: census.typed, local: census.local };
}

function stateLiterals(
  sources: ReadonlyMap<string, ts.SourceFile>,
  { declared, typed }: ReturnType<typeof censusOf>,
  readers: number,
): TreeFinding[] {
  const groupings = [...sources].flatMap(([path, file]) => groupingsIn(path, file));
  const owned = new Map<Declared, Grouping[]>();
  for (const grouping of groupings) {
    const owner = declared
      .filter(
        (one) =>
          one.path !== grouping.path &&
          grouping.values.every((value) => one.values.has(value)) &&
          (one.property === undefined ||
            grouping.subject === one.property ||
            grouping.subject.endsWith(`.${one.property}`)),
      )
      .toSorted(
        (a, b) =>
          Number(b.property !== undefined) - Number(a.property !== undefined) ||
          a.values.size - b.values.size,
      )[0];
    if (owner === undefined) continue;
    const covers = grouping.switchCovers;
    if (covers !== undefined && [...owner.values].every((value) => covers.has(value))) continue;
    const list = owned.get(owner);
    if (list === undefined) owned.set(owner, [grouping]);
    else list.push(grouping);
  }
  const found: Found[] = [];
  for (const [owner, groupedBy] of owned) {
    const readerFiles = new Set(groupedBy.map((one) => one.path));
    if (readerFiles.size < readers) continue;
    const sets = new Set(groupedBy.map((one) => quoted(one.values.toSorted())));
    found.push({
      row: {
        kind: "no-scattered-state-literals",
        path: owner.path,
        line: owner.line,
        detail: `\`${owner.name}\` (${quoted(owner.values)}) is grouped by hand in ${readerFiles.size} other files, as ${[...sets].join("; ")}: give each grouping a name in the owner and call it`,
        places: [owner, ...groupedBy].map((one) => ({ path: one.path, line: one.line, end: one.line })),
      },
      set: { values: owner.values, subjects: groupedBy.map((one) => one.subject) },
    });
  }
  found.push(...unownedLiterals(groupings, typed, readers));
  const stateful = statefulSets(
    sources,
    found.map((one) => one.set),
  );
  return found.map(({ row }, index) =>
    stateful[index] === true
      ? row
      : {
          ...row,
          kind: "no-scattered-enum-literals",
          detail: `an enumeration rather than a state, since no literal of it is written where a value changes: ${row.detail}`,
        },
  );
}

/** Every implicit-state finding of the tree scans over one set of files, parsed once. */
export function implicitStateFindings(
  parsed: ReadonlyMap<string, ts.SourceFile>,
  readers = READER_FLOOR,
): TreeFinding[] {
  const owned = new Map([...parsed].filter(([path]) => !TEST_PATH.test(path)));
  const sets = censusOf(owned);
  return [
    ...stateLiterals(owned, sets, readers),
    ...repeatedExternalReads(parsed),
    ...secondReaders(owned),
    ...partialMappings(owned, sets.declared, sets.local),
  ];
}

function sourcesUnder(root: string, at = root, files = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRECTORY.test(entry.name)) sourcesUnder(root, path, files);
    else if (entry.isFile() && SOURCE.test(entry.name) && !DECLARATION.test(entry.name)) {
      files.set(relative(root, path), readFileSync(path, "utf8"));
    }
  }
  return files;
}

if (import.meta.main) {
  const argv = runtimeProcess.argv.slice(2);
  const at = argv.indexOf("--readers");
  const readers = at === -1 ? READER_FLOOR : Number(argv[at + 1]);
  const root =
    argv.find((argument, index) => !argument.startsWith("--") && (at === -1 || index !== at + 1)) ?? ".";
  const files = sourcesUnder(root);
  const rows = implicitStateFindings(parsedSources(files), readers);
  if (argv.includes("--json")) {
    const found = rows.map(({ kind: rule, path: file, line, detail: message }) => ({
      rule,
      file,
      line,
      message,
    }));
    await Bun.write(Bun.stdout, `${JSON.stringify(found)}\n`);
    runtimeProcess.exit(0);
  }
  const lines = [...Map.groupBy(rows, (row) => row.kind)].flatMap(([kind, under]) => [
    "",
    `${kind} (${under.length})`,
    ...under.map((row) => `  ${row.path}:${row.line}  ${row.detail}`),
  ]);
  await Bun.write(Bun.stdout, `${files.size} files read under ${root}\n${lines.join("\n")}\n`);
}
