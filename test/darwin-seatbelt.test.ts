import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { sha256 } from "../src/meta/digest.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { darwinSeatbeltSupport } from "../src/wall/darwin-seatbelt.ts";

const root = mkdtempSync(join(tmpdir(), "ana-seatbelt-support-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Darwin Seatbelt support", () => {
  it("identifies its wrapper and refuses another platform, a missing wrapper and a surrounding sandbox", () => {
    const executable = join(root, "sandbox-exec");
    writeFileSync(executable, "fixture executable");
    const runtime = { platform: "darwin" as const, sandboxExecPath: executable, outerSandboxed: false };
    expect(darwinSeatbeltSupport(runtime)).toMatchObject({
      ok: true,
      mechanismPath: realpathSync.native(executable),
      mechanismDigest: sha256("fixture executable"),
    });
    for (const override of [
      { platform: "linux" as const },
      { sandboxExecPath: join(root, "absent") },
      { outerSandboxed: true },
    ]) {
      expect(darwinSeatbeltSupport({ ...runtime, ...override })).toMatchObject({
        ok: false,
        mechanismDigest: null,
      });
    }
  });
});
