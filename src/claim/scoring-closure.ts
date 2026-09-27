/** The scoring program's content address: the package bytes the host verifier runs or reads to reach
 *  a verdict, apart from the battery. That is brief.json, which declares the checks, and evaluator.ts
 *  with every file it reaches through relative imports. The evaluator bundle admits nothing else from
 *  the package (`evaluator-process-bundle.ts`), so a reference solve or a test the evaluator never
 *  imports can change with the battery without moving what scores it.
 *
 *  correctnessModelHash stays the byte identity of the whole package, and candidate identity and
 *  snapshot integrity need that: a reference-only repair is a new candidate even when it scores
 *  nothing differently. This hash answers the narrower question every task-only reading asks.
 *
 *  The walk is static, and static is the whole closure, because the bundle refuses builtins and
 *  every runtime loader (`import()`, `Bun`, `require`, `eval`, through
 *  `assertGeneratedSourceLoaders`). A module's name decides nothing: a test the evaluator imports
 *  is scoring. The walk errs towards movement — a type-only import is erased and skipped, while an
 *  unused, side-effect or re-export import keeps its file inside — so the reading can over-report a
 *  change but never hide an executed byte.
 *
 *  Bun also compiles each module under the nearest tsconfig.json or jsconfig.json, following its
 *  `extends`, and the nearest package.json: `useDefineForClassFields`, `experimentalDecorators` or
 *  a `.js` file's `type` change the bundle while every walked byte stays put. A package carrying
 *  any such file is therefore read whole. A file above the package is outside this hash and
 *  correctnessModelHash alike.
 *
 *  The same walk, `runtimeClosure`, names the code the capability-escape scan reads
 *  (`verifierSourceFiles`), from the reference solve's entry as well as the evaluator's. */
import { existsSync, readFileSync, readdirSync, realpathSync } from "../meta/filesystem.ts";
import { basename, dirname, extname, join, relative } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { EVALUATOR_FILE } from "../meta/bundle-layout.ts";

/** What a package's program modules reach at run time from their entries. */
interface RuntimeClosure {
  /** Every file reached through relative imports, entries included, relative to the package root. */
  files: string[];
  /** Whether the walk followed every import it met. */
  complete: boolean;
}

/** Controller packages the evaluator may import. The evaluator bundle resolves them from the
 *  controller whatever the candidate's configuration says, so their bytes are never the
 *  candidate's and the closure stops at them. */
export const VERIFIER_PUBLIC_PACKAGES: ReadonlySet<string> = new Set([
  "@ana/correctness-model-bundle",
  "@ana/correctness-model-prims",
  "typebox",
]);

const BUILD_CONFIGURATION = new Set(["tsconfig.json", "jsconfig.json", "package.json"]);

const LOADERS = new Map<string, "ts" | "tsx" | "js" | "jsx">([
  [".ts", "ts"],
  [".mts", "ts"],
  [".cts", "ts"],
  [".tsx", "tsx"],
  [".js", "js"],
  [".mjs", "js"],
  [".cjs", "js"],
  [".jsx", "jsx"],
]);

/** The files one program module imports at run time, resolved, with null for each import the walk
 *  does not follow: one that leaves the package, names any other package or does not resolve, all of
 *  which the evaluator bundle refuses too. A module that cannot be scanned is one such import. */
function runtimeImports(root: string, file: string, source: Uint8Array): Array<string | null> {
  const loader = LOADERS.get(extname(file));
  if (loader === undefined) return [];
  let imports: Bun.Import[];
  try {
    imports = new Bun.Transpiler({ loader }).scanImports(source);
  } catch {
    return [null];
  }
  return imports.flatMap(({ path }) =>
    VERIFIER_PUBLIC_PACKAGES.has(path)
      ? []
      : [path.startsWith(".") ? resolvedInside(root, path, dirname(file)) : null],
  );
}

function resolvedInside(root: string, path: string, from: string): string | null {
  try {
    const resolved = Bun.resolveSync(path, from);
    return containsPath(resolved, root) ? resolved : null;
  } catch {
    return null;
  }
}

/** The runtime closure of `entries`, given relative to `root`; an entry that does not exist is
 *  skipped. */
export function runtimeClosure(root: string, entries: readonly string[]): RuntimeClosure {
  const files = new Set<string>();
  let complete = true;
  const pending = entries.flatMap((entry) => (existsSync(join(root, entry)) ? [join(root, entry)] : []));
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    const name = relative(root, file);
    if (files.has(name)) continue;
    files.add(name);
    for (const imported of runtimeImports(root, file, readFileSync(file))) {
      if (imported === null) complete = false;
      else pending.push(imported);
    }
  }
  return { files: [...files], complete };
}

/** Null when the closure cannot be read; callers then compare the whole package's bytes. */
export function scoringClosureHash(correctnessModelDir: string): string | null {
  try {
    const root = realpathSync(correctnessModelDir);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" });
    if (files.some((path) => BUILD_CONFIGURATION.has(basename(path)))) return null;
    const closure = runtimeClosure(root, [basename(EVALUATOR_FILE)]);
    if (!closure.complete) return null;
    const digests: Record<string, string> = {};
    const brief = join(root, "brief.json");
    if (existsSync(brief)) digests["brief.json"] = sha256(readFileSync(brief));
    for (const name of closure.files) digests[name] = sha256(readFileSync(join(root, name)));
    return sha256(canonicalJson(digests));
  } catch {
    return null;
  }
}
