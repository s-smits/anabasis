import { sha256OfFile } from "../meta/digest.ts";
import {
  chmodSync,
  cloneFile,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { isNumber, isRecord, isString } from "../meta/json-shape.ts";
import { join, relative, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { runtimeProcess } from "../meta/process.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";

export const EXAMINER_HOMES = "examiner-homes";

const OBJECTS = "objects";
const HASH = /^[0-9a-f]{64}$/u;
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
  | { readonly path: string; readonly kind: "file"; readonly sha256: string; readonly mode: number };

interface HomeManifest {
  readonly session: string;
  readonly entries: readonly HomeEntry[];
}

function copyBlob(source: string, destination: string): void {
  try {
    cloneFile(source, destination);
  } catch {
    copyFileSync(source, destination);
  }
}

function storeBlob(objectsDir: string, source: string): string {
  const digest = sha256OfFile(source);
  const blob = join(objectsDir, digest);
  if (existsSync(blob)) return digest;
  const temp = `${blob}.${String(runtimeProcess.pid)}.tmp`;
  try {
    copyBlob(source, temp);
    renameSync(temp, blob);
  } finally {
    rmSync(temp, { force: true });
  }
  return digest;
}

function walkHome(root: string, prefix: string, objectsDir: string, out: HomeEntry[]): void {
  const names = readdirSync(join(root, prefix)).toSorted(compareCodeUnits);
  for (const name of names) {
    if (isPrivateName(name)) continue;
    const rel = join(prefix, name);
    const full = join(root, rel);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) {
      out.push({ path: rel, kind: "symlink", target: readlinkSync(full) });
    } else if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      out.push({ path: rel, kind: "dir" });
      walkHome(root, rel, objectsDir, out);
    } else if (stat.isFile()) {
      out.push({
        path: rel,
        kind: "file",
        sha256: storeBlob(objectsDir, full),
        mode: stat.mode & 0o777,
      });
    }
  }
}

function manifestPath(storeDir: string, sessionId: string): string {
  if (!isSafePathSegment(sessionId)) throw new Error(`unsafe examiner home snapshot id: ${sessionId}`);
  return join(storeDir, `${sessionId}.json`);
}

export function snapshotHome(sourceDir: string, storeDir: string, sessionId: string): void {
  const manifest = manifestPath(storeDir, sessionId);
  if (!existsSync(sourceDir)) return;
  const objectsDir = join(storeDir, OBJECTS);
  mkdirSync(objectsDir, { recursive: true });
  const entries: HomeEntry[] = [];
  walkHome(sourceDir, "", objectsDir, entries);
  const temp = `${manifest}.${String(runtimeProcess.pid)}.tmp`;
  writeFileSync(temp, `${capturedJsonStringify({ session: sessionId, entries })}\n`);
  renameSync(temp, manifest);
}

export function hasHomeSnapshot(storeDir: string, sessionId: string): boolean {
  return isSafePathSegment(sessionId) && existsSync(manifestPath(storeDir, sessionId));
}

function validEntry(entry: unknown): HomeEntry {
  const row = isRecord(entry) ? entry : {};
  const { path } = row;
  if (!isString(path)) throw new Error("invalid examiner home snapshot entry");
  if (row.kind === "dir") return { path, kind: "dir" };
  if (row.kind === "symlink" && isString(row.target)) return { path, kind: "symlink", target: row.target };
  if (row.kind === "file" && isString(row.sha256) && HASH.test(row.sha256) && isNumber(row.mode)) {
    return { path, kind: "file", sha256: row.sha256, mode: row.mode & 0o777 };
  }
  throw new Error(`invalid examiner home snapshot entry for ${path}`);
}

function traversesSymlink(path: string, symlinks: ReadonlySet<string>): boolean {
  let prefix = "";
  for (const part of path.split("/")) {
    prefix = prefix === "" ? part : `${prefix}/${part}`;
    if (symlinks.has(prefix)) return true;
  }
  return false;
}

export function restoreHome(storeDir: string, sessionId: string, targetDir: string): void {
  const raw = parseJsonAs<HomeManifest>(readFileSync(manifestPath(storeDir, sessionId), "utf8"));
  if (!Array.isArray(raw.entries)) throw new Error(`${sessionId}: invalid examiner home manifest`);
  const objectsDir = join(storeDir, OBJECTS);
  const root = resolve(targetDir);
  mkdirSync(root);
  const symlinks = new Set<string>();
  for (const item of raw.entries) {
    const entry = validEntry(item);
    const dest = resolve(root, entry.path);
    if (!containsPath(dest, root) || dest === root) {
      throw new Error(`${sessionId}: examiner home entry escapes target: ${entry.path}`);
    }
    const rel = relative(root, dest);
    if (traversesSymlink(rel, symlinks)) {
      throw new Error(`${sessionId}: examiner home entry traverses symlink: ${entry.path}`);
    }
    if (entry.kind === "dir") {
      mkdirSync(dest);
    } else if (entry.kind === "symlink") {
      symlinkSync(entry.target, dest);
      symlinks.add(rel);
    } else {
      const blob = join(objectsDir, entry.sha256);
      if (!existsSync(blob)) throw new Error(`${sessionId}: missing examiner home blob ${entry.sha256}`);
      copyBlob(blob, dest);
      chmodSync(dest, entry.mode);
    }
  }
}
