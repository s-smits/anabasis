import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { stableJson } from "../src/meta/stable-json.ts";

/** The repository-relative script that runs this module and writes the install marker it checks.
 *  Skill scripts that prepare or run a worktree join it onto their checkout root. */
export const WORKTREE_SCRIPT = "scripts/worktree.sh";

const INSTALL_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "workspaces",
  "overrides",
  "resolutions",
  "trustedDependencies",
  "patchedDependencies",
  "catalog",
  "catalogs",
] as const;

export function dependencyIdentityFromBytes(lock: Uint8Array, manifestText: string): string {
  const manifest = parseJsonAs<Record<string, JsonValue>>(manifestText);
  const installManifest: Record<string, JsonValue> = {};
  for (const field of INSTALL_FIELDS) {
    const value = manifest[field];
    if (value !== undefined) installManifest[field] = value;
  }
  const lockDigest = new Bun.CryptoHasher("sha256").update(lock).digest("hex");
  return new Bun.CryptoHasher("sha256").update(`${lockDigest}\n${stableJson(installManifest)}`).digest("hex");
}

/** The lock plus only package.json fields which can change the installed dependencies. */
export async function dependencyIdentity(root: string): Promise<string> {
  const [lock, manifest] = await Promise.all([
    Bun.file(`${root}/bun.lock`).arrayBuffer(),
    Bun.file(`${root}/package.json`).text(),
  ]);
  return dependencyIdentityFromBytes(new Uint8Array(lock), manifest);
}

if (import.meta.main) {
  const root = Bun.argv[2];
  if (root === undefined) throw new Error("usage: bun tools/dependency-identity.ts <repository-root>");
  console.log(await dependencyIdentity(root));
}
