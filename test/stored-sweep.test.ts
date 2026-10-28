// A bundle's check program staged for regrading: it leaves the battery behind, and a copy cut short
// leaves nothing where the program would stand.
import { afterAll, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { checkProgram } from "../tools/m0/stored-sweep.ts";

const root = mkdtempSync(join(tmpdir(), "ana-sweep-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

it("copies a bundle's check program without its battery, and nothing of a copy cut short", () => {
  const model = join(root, "bundle", "correctness-model");
  mkdirSync(join(model, "reference"), { recursive: true });
  for (const file of ["evaluator.ts", "brief.json", "tasks.json", "controls.json", "reference/model.ts"]) {
    writeFileSync(join(model, file), "{}");
  }
  const checks = checkProgram(join(root, "bundle"), join(root, "checks"));
  expect(
    ["evaluator.ts", "brief.json", "reference/model.ts", "tasks.json", "controls.json"].map((file) =>
      existsSync(join(checks, file)),
    ),
  ).toEqual([true, true, true, false, false]);
  // A FIFO stops the copy part of the way through, whoever runs the suite: a file of mode 0 does
  // not stop root, which the Linux job and a container run as.
  runTextSyncOrThrow(["mkfifo", join(model, "zz-pipe.ts")]);
  const to = join(root, "cut-checks");
  expect(() => checkProgram(join(root, "bundle"), to)).toThrow();
  expect(existsSync(to)).toBe(false);
});
