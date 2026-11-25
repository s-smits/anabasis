/**
 * A folder in the host's per-user temporary directory named as `mktemp` names one. The Darwin
 * command wall closes that directory but for toolchain folders of that shape (`userTempRules`,
 * `src/wall/policy.ts`), so a fixture a walled command must reach without a policy naming it is
 * made here; elsewhere it is the suite's root.
 */
import { mkdirSync, realpathSync } from "../../src/meta/filesystem.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";
import { userTempRules } from "../../src/wall/policy.ts";

export function toolchainTemp(prefix: string): string {
  const name = Array.from({ length: 10 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  const dir = join(userTempRules().roots[0] ?? tmpdir(), `${prefix}.${name}`);
  mkdirSync(dir);
  return realpathSync.native(dir);
}
