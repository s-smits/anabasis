// Copied from pi-mono packages/coding-agent/test/file-mutation-queue.test.ts at 086c32e74 (main,
// 2026-08-15). Only the withFileMutationQueue block is kept: the second describe drives pi's own
// edit and write tools, which this repository did not vendor. The import path is repointed and the
// helpers that only the dropped block used are removed; the three cases are otherwise upstream's.

import { mkdtempSync, rmSync, symlinkSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { withFileMutationQueue } from "../src/builder/pi-coding/file-mutation-queue.ts";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "pi-file-mutation-queue-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) rmSync(dir, { recursive: true, force: true });
});

describe("withFileMutationQueue", () => {
  it("serializes operations for the same file", async () => {
    const order: string[] = [];
    const path = "/tmp/file-mutation-queue-same";

    const first = withFileMutationQueue(path, async () => {
      order.push("first:start");
      await Bun.sleep(30);
      order.push("first:end");
    });
    const second = withFileMutationQueue(path, async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("allows different files to proceed in parallel", async () => {
    const order: string[] = [];

    await Promise.all([
      withFileMutationQueue("/tmp/file-mutation-queue-a", async () => {
        order.push("a:start");
        await Bun.sleep(30);
        order.push("a:end");
      }),
      withFileMutationQueue("/tmp/file-mutation-queue-b", async () => {
        order.push("b:start");
        await Bun.sleep(30);
        order.push("b:end");
      }),
    ]);

    expect(order.indexOf("a:start")).toBeLessThan(order.indexOf("a:end"));
    expect(order.indexOf("b:start")).toBeLessThan(order.indexOf("b:end"));
    expect(order.indexOf("b:start")).toBeLessThan(order.indexOf("a:end"));
  });

  it("uses the same queue for symlink aliases", async () => {
    const dir = await createTempDir();
    const targetPath = join(dir, "target.txt");
    const symlinkPath = join(dir, "alias.txt");
    await Bun.write(targetPath, "hello\n");
    symlinkSync(targetPath, symlinkPath);

    const order: string[] = [];
    await Promise.all([
      withFileMutationQueue(targetPath, async () => {
        order.push("target:start");
        await Bun.sleep(30);
        order.push("target:end");
      }),
      withFileMutationQueue(symlinkPath, async () => {
        order.push("alias:start");
        order.push("alias:end");
      }),
    ]);

    expect(order).toEqual(["target:start", "target:end", "alias:start", "alias:end"]);
  });
});
