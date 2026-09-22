import { basename, extname, relative } from "../meta/path.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";

export function surveyVerifierSource(stdout: string, root: string, captureTruncated = false) {
  const byExtension: Record<string, number> = {};
  const entryPoints: string[] = [];
  const names = new Set(
    "README.md README.rst pyproject.toml package.json Cargo.toml setup.py cli.py main.py __main__.py".split(
      " ",
    ),
  );
  const allPaths = stdout.split("\n").filter(Boolean);
  const paths = allPaths.slice(0, 8_000);
  const truncated = captureTruncated || allPaths.length > paths.length;
  for (const path of paths) {
    const extension = extname(path) || "(none)";
    byExtension[extension] = (byExtension[extension] ?? 0) + 1;
    if (names.has(basename(path))) entryPoints.push(relative(root, path));
  }
  return {
    files: allPaths.length,
    filesCaptured: allPaths.length,
    surveyed: paths.length,
    inventoryComplete: !truncated,
    truncated,
    pathDigest: hashJsonBytes(allPaths.map((path) => relative(root, path)).sort()),
    byExtension,
    entryPoints: entryPoints.slice(0, 40),
  };
}
