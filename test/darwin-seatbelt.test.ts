import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { darwinSeatbeltSupport } from "../src/wall/darwin-seatbelt.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A host that is Darwin and unsandboxed, its wrapper a file of known bytes. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ana-seatbelt-support-"));
  dirs.push(root);
  const executable = join(root, "sandbox-exec");
  writeFileSync(executable, "fixture executable");
  return {
    root,
    executable,
    runtime: { platform: "darwin" as const, sandboxExecPath: executable, outerSandboxed: false },
  };
}

describe("Darwin Seatbelt support", () => {
  it("refuses another platform, a missing wrapper and a surrounding sandbox", () => {
    const f = fixture();
    expect(darwinSeatbeltSupport({ ...f.runtime, platform: "linux" }).ok).toBe(false);
    const missing = darwinSeatbeltSupport({ ...f.runtime, sandboxExecPath: join(f.root, "absent") });
    expect(missing).toMatchObject({ ok: false, mechanismDigest: null });
    expect(darwinSeatbeltSupport({ ...f.runtime, outerSandboxed: true }).reason).toMatch(
      /surrounding sandbox/,
    );
  });
});
