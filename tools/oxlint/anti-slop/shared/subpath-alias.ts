import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { dirname, join, relative, sep } from "#src/meta/path.ts";

/** One wildcard in a manifest's `imports`: `#src/` names what `src/` below the package root names. */
interface Alias {
  readonly prefix: string;
  readonly tree: string;
}

/** A package: the directory its manifest sits in, and the aliases that manifest declares. */
interface Scope {
  readonly root: string;
  readonly aliases: readonly Alias[];
}

/** `#src/*`, and `./src/*` beside it: one trailing wildcard over one directory, the shape read here. */
const KEY = /^(#[^*]*)\*$/u;
const TARGET = /^\.\/([^*]*)\*$/u;

/** Two levels up is still a neighbour; the third `../` is where a reader starts counting. */
const CLIMB = /^(?:\.\.\/){3,}/u;

/** Every directory asked about, and the package it belongs to. One lint run reads each manifest once. */
const scopes = new Map<string, Scope | null>();

/**
 * The wildcard aliases a manifest declares, the most specific tree first.
 *
 * A conditional target (`{ "types": …, "default": … }`), a fallback array and a key that is not
 * one trailing wildcard are skipped rather than guessed at: which file they reach depends on the
 * resolver's conditions, and a rewrite that is right under one condition is wrong under another.
 */
function aliasesOf(manifestText: string): Alias[] {
  const manifest: unknown = JSON.parse(manifestText);
  if (!(manifest instanceof Object) || !("imports" in manifest)) return [];
  const { imports } = manifest;
  if (!(imports instanceof Object)) return [];
  return Object.entries(imports)
    .flatMap(([key, target]) => {
      const prefix = KEY.exec(key)?.[1];
      const tree = target instanceof Object ? undefined : TARGET.exec(String(target))?.[1];
      return prefix === undefined || tree === undefined ? [] : [{ prefix, tree }];
    })
    .toSorted((a, b) => b.tree.length - a.tree.length);
}

/**
 * The package a directory belongs to: the nearest `package.json` at or above it.
 *
 * That is where Node, Bun and TypeScript all resolve a `#` specifier, so an alias the root manifest
 * declares does not reach a file inside a package with a manifest of its own, however deep.
 */
function scopeOf(directory: string): Scope | null {
  const known = scopes.get(directory);
  if (known !== undefined) return known;
  const manifest = join(directory, "package.json");
  const parent = dirname(directory);
  let scope: Scope | null = null;
  if (existsSync(manifest)) scope = { root: directory, aliases: aliasesOf(readFileSync(manifest, "utf8")) };
  else if (parent !== directory) scope = scopeOf(parent);
  scopes.set(directory, scope);
  return scope;
}

/**
 * The alias a file at `filename` spells `specifier` as, or null where the relative form stays.
 *
 * Null for a specifier that climbs fewer than three levels, one that climbs out of the package
 * (a subpath import resolves inside its own package only), one that lands in no aliased tree, and
 * any file under a `relativeOnly` tree — a directory, relative to the package root, whose files
 * are also resolved some other way the alias would not survive.
 */
export function subpathAlias(
  filename: string,
  specifier: string,
  relativeOnly: readonly string[] = [],
): string | null {
  if (!CLIMB.test(specifier)) return null;
  const scope = scopeOf(dirname(filename));
  if (scope === null || scope.aliases.length === 0) return null;
  const from = relative(scope.root, filename).split(sep).join("/");
  if (relativeOnly.some((tree) => from.startsWith(tree.endsWith("/") ? tree : `${tree}/`))) return null;
  const target = from.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "..") {
      if (target.pop() === undefined) return null;
    } else if (segment !== ".") target.push(segment);
  }
  const path = target.join("/");
  const alias = scope.aliases.find(({ tree }) => path.startsWith(tree));
  return alias === undefined ? null : alias.prefix + path.slice(alias.tree.length);
}
