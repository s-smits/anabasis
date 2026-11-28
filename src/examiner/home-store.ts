import { sha256OfFile } from "../meta/digest.ts";
import {
  chmodSync,
  cloneFile,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { runtimeProcess } from "../meta/process.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";

export const EXAMINER_HOMES = "examiner-homes";

const OBJECTS = "objects";
const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".bundle-snapshots",
  "__pycache__",
  ".git",
  ".cache",
  ".cargo",
  ".local",
  ".matplotlib",
  "Library",
]);

const isPrivateName = (name: string): boolean =>
  name === ".env" || name.startsWith(".env.") || name.endsWith(".env") || name === "auth.json";

type HomeEntry =
  | { readonly path: string; readonly kind: "dir" }
  | { readonly path: string; readonly kind: "symlink"; readonly target: string }
  | {
      readonly path: string;
      readonly kind: "file";
      readonly sha256: string;
      readonly mode: number;
    };

function writeAtomic(path: string, write: (temp: string) => void): void {
  const temp = `${path}.${String(runtimeProcess.pid)}.tmp`;
  write(temp);
  renameSync(temp, path);
}

function walkHome(root: string, prefix: string, objects: string, out: HomeEntry[]): void {
  for (const name of readdirSync(join(root, prefix)).toSorted(compareCodeUnits)) {
    if (isPrivateName(name)) continue;
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const full = join(root, path);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) out.push({ path, kind: "symlink", target: readlinkSync(full) });
    else if (stat.isDirectory() && !SKIP_DIRS.has(name)) {
      out.push({ path, kind: "dir" });
      walkHome(root, path, objects, out);
    } else if (stat.isFile()) {
      const sha256 = sha256OfFile(full);
      const blob = join(objects, sha256);
      if (!existsSync(blob)) writeAtomic(blob, (temp) => cloneFile(full, temp));
      out.push({ path, kind: "file", sha256, mode: stat.mode & 0o777 });
    }
  }
}

function manifestPath(store: string, session: string): string {
  if (!isSafePathSegment(session)) throw new Error(`unsafe examiner home snapshot id: ${session}`);
  return join(store, `${session}.json`);
}

export function snapshotHome(home: string, store: string, session: string): void {
  const manifest = manifestPath(store, session);
  if (!existsSync(home)) return;
  const objects = join(store, OBJECTS);
  mkdirSync(objects, { recursive: true });
  const entries: HomeEntry[] = [];
  walkHome(home, "", objects, entries);
  writeAtomic(manifest, (temp) => writeFileSync(temp, `${capturedJsonStringify({ session, entries })}\n`));
}

export function restoreHome(store: string, session: string, target: string): boolean {
  const manifest = manifestPath(store, session);
  if (!existsSync(manifest)) return false;
  const { entries } = parseJsonAs<{ readonly entries: readonly HomeEntry[] }>(readFileSync(manifest, "utf8"));
  mkdirSync(target, { recursive: true });
  for (const entry of entries) {
    const dest = join(target, entry.path);
    if (entry.kind === "dir") mkdirSync(dest, { recursive: true });
    else if (entry.kind === "symlink") symlinkSync(entry.target, dest);
    else {
      cloneFile(join(store, OBJECTS, entry.sha256), dest);
      chmodSync(dest, entry.mode);
    }
  }
  return true;
}
