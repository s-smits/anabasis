import type { ESTree, Fix, Fixer } from "@oxlint/plugins";
import config from "../../../../.oxlintrc.json" with { type: "json" };
import { subpathAlias } from "../../anti-slop/shared/subpath-alias.ts";
import { repoRelative } from "./file-role.ts";

/**
 * The trees `anti-slop/prefer-subpath-import` leaves relative here, read off the option the lint
 * config passes it, so a fix and the rule never disagree about where an alias belongs.
 *
 * `src`, `starters` and `tools/harness` are copied by `src/run/bundle-export.ts` under a manifest
 * it writes without `imports`, and candidate isolation resolves their specifiers as paths.
 * `vendor` holds three packages with a manifest of their own, which the rule's nearest-manifest
 * reading already leaves alone, and three without one, which would otherwise read the root's.
 */
const RELATIVE_ONLY = config.rules["anti-slop/prefer-subpath-import"].flatMap((entry) =>
  entry instanceof Object ? entry.relativeOnly : [],
);

/**
 * How a file at `filename` spells a repository-relative `target` it does not import yet.
 *
 * Every rule that writes an import needs this and none can ask the module system for it, so the
 * arithmetic lives here rather than once per rule: the depth is the caller's own path, which is
 * the one fact a plugin rule reading one file does have. A spelling that climbs far enough for
 * `anti-slop/prefer-subpath-import` to report it comes back as the alias, so no fix writes a line
 * another rule then rewrites.
 */
export function importSpecifier(filename: string, target: string): string {
  const from = repoRelative(filename).split("/").slice(0, -1);
  const to = target.split("/");
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  const up = "../".repeat(from.length - shared);
  const relative = (up === "" ? "./" : up) + to.slice(shared).join("/");
  return subpathAlias(filename, relative, RELATIVE_ONLY) ?? relative;
}

/**
 * A rule that fixes a call by renaming it to an imported binding has to import that binding too,
 * and a file with eight such calls still needs exactly one import.
 *
 * oxlint drops a fix that overlaps one it already applied and lints again, so every diagnostic
 * carries the import edit rather than only the first: if the first diagnostic's edit lands, the
 * others see the binding present on the next pass and emit the rename alone; if it is the one
 * dropped, another diagnostic's copy lands instead. Suppressing the duplicates inside a pass is
 * what would lose the import, because the surviving diagnostic would be the one that no longer
 * asks for it.
 */
export function importTracker(module: string, target: string) {
  let existing: ESTree.ImportDeclaration | null = null;
  let bound = new Set<string>();
  let first: ESTree.Node | null = null;

  return {
    /** Read the file's imports before any report. Call this from a `Program` visitor. */
    read(program: ESTree.Program): void {
      existing = null;
      bound = new Set();
      first = program.body[0] ?? null;
      for (const statement of program.body) {
        if (statement.type !== "ImportDeclaration") continue;
        // The specifier is relative or an alias, so it differs per file; the module is its tail.
        if (!statement.source.value.endsWith(module)) continue;
        existing = statement;
        for (const spec of statement.specifiers) {
          if (spec.type === "ImportSpecifier") bound.add(spec.local.name);
        }
      }
    },

    /** The one edit that makes every name in `names` available here, or null when they all are. */
    fix(fixer: Fixer, names: string | readonly string[], filename: string): Fix | null {
      const missing = [names].flat().filter((name) => !bound.has(name));
      if (missing.length === 0) return null;
      const list = missing.join(", ");
      if (existing !== null) {
        const last = existing.specifiers.at(-1);
        // A bare `import "./x.ts"` has no specifier to extend, so leave it and add a second import.
        if (last !== undefined) return fixer.insertTextAfter(last, `, ${list}`);
      }
      if (first === null) return null;
      return fixer.insertTextBefore(
        first,
        `import { ${list} } from "${importSpecifier(filename, target)}";\n`,
      );
    },
  };
}
