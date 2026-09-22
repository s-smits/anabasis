/** The scoring program's content address: the package bytes the host verifier runs or reads to reach
 *  a verdict, apart from the battery: brief.json, and evaluator.ts with every file it reaches through
 *  relative imports. A reference solve or test the evaluator never imports can change without moving
 *  this hash; correctnessModelHash still covers the whole package.
 *
 *  A static walk is the whole closure, because the evaluator bundle refuses builtins and every
 *  runtime loader. It errs towards movement: only type-only imports are skipped, so it may
 *  over-report a change but never hides an executed byte.
 *
 *  A package carrying a tsconfig.json, jsconfig.json or package.json is read whole, since those
 *  change how Bun compiles the walked files. */
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
