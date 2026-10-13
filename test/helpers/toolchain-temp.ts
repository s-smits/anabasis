/**
 * A folder directly in the host's per-user temporary directory named as `mktemp` names one: a
 * prefix, a dot and ten letters or digits. The Darwin command wall closes that directory but for
 * what a toolchain makes there in that shape (`userTempRules`, `src/verify/wall-policy.ts`), and a
 * suite's own temporary root lies inside it under another name, so a fixture a test means a walled
 * command to reach without a policy naming it is made here. Elsewhere it is the suite's root.
 */
import { mkdirSync, realpathSync } from "../../src/meta/filesystem.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";
import { userTempRules } from "../../src/verify/wall-policy.ts";

export function toolchainTemp(prefix: string): string {
  const name = Array.from({ length: 10 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  const dir = join(userTempRules().roots[0] ?? tmpdir(), `${prefix}.${name}`);
  mkdirSync(dir);
  return realpathSync.native(dir);
}
