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
 *  correctnessModelHash alike. */
import { existsSync, readFileSync, readdirSync, realpathSync } from "../meta/filesystem.ts";
import { basename, dirname, extname, join, relative } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";

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

/** The files one program module imports at run time, resolved; null when one leaves the package or
 *  does not resolve, which the evaluator bundle refuses too. */
function runtimeImports(root: string, file: string, source: Uint8Array): string[] | null {
  const loader = LOADERS.get(extname(file));
  if (loader === undefined) return [];
  const found: string[] = [];
  for (const { path } of new Bun.Transpiler({ loader }).scanImports(source)) {
    if (VERIFIER_PUBLIC_PACKAGES.has(path)) continue;
    if (!path.startsWith(".")) return null;
    const resolved = Bun.resolveSync(path, dirname(file));
    if (!containsPath(resolved, root)) return null;
    found.push(resolved);
  }
  return found;
}

/** Null when the closure cannot be read; callers then compare the whole package's bytes. */
export function scoringClosureHash(correctnessModelDir: string): string | null {
  try {
    const root = realpathSync(correctnessModelDir);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" });
    if (files.some((path) => BUILD_CONFIGURATION.has(basename(path)))) return null;
    const digests: Record<string, string> = {};
    const brief = join(root, "brief.json");
    if (existsSync(brief)) digests["brief.json"] = sha256(readFileSync(brief));
    const entry = join(root, "evaluator.ts");
    const pending = existsSync(entry) ? [entry] : [];
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      const name = relative(root, file);
      if (name in digests) continue;
      const bytes = readFileSync(file);
      digests[name] = sha256(bytes);
      const imports = runtimeImports(root, file, bytes);
      if (imports === null) return null;
      pending.push(...imports);
    }
    return sha256(canonicalJson(digests));
  } catch {
    return null;
  }
}
