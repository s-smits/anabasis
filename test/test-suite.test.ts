/**
 * The suite's wrapper under `ANA_TEST_BAIL`, as every proof of the pre-push hook and `bun run land`
 * runs it: a failure stops the run, and a failure the machine is blamed for runs alone and then the
 * whole request, so a test that fails once under load neither stops a landing nor skips the files
 * after it. The host's load is pinned through `ANA_TEST_HOST_LOAD`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const suite = join(import.meta.dir, "..", "tools", "runtime", "test-suite.ts");
const fixture = mkdtempSync(join(tmpdir(), "ana-suite-bail-"));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

/** Runs a flaky file, which fails its first run only, and a file after it, at the given load. */
function bailAt(load: string) {
  const work = mkdtempSync(join(fixture, "run-"));
  const marker = join(work, "marker");
  const after = join(work, "after");
  writeFileSync(
    join(work, "a-flaky.test.ts"),
    `import { expect, it } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
it("fails its first run only", () => {
  const seen = existsSync(${JSON.stringify(marker)});
  writeFileSync(${JSON.stringify(marker)}, "");
  expect(seen).toBe(true);
});
`,
  );
  writeFileSync(
    join(work, "b-after.test.ts"),
    `import { it } from "bun:test";
import { appendFileSync } from "node:fs";
it("runs after the flaky file", () => appendFileSync(${JSON.stringify(after)}, "ran\\n"));
`,
  );
  const result = spawnTextSync(
    capturedExecPath,
    [suite, "--cwd", work, "./a-flaky.test.ts", "./b-after.test.ts"],
    {
      env: { ...Bun.env, ANA_TEST_BAIL: "1", ANA_TEST_WORKERS: "1", ANA_TEST_HOST_LOAD: load },
      timeout: 120_000,
    },
  );
  return {
    status: result.status,
    ran: existsSync(after) ? readFileSync(after, "utf8").split("\n").length - 1 : 0,
  };
}

describe("the suite under ANA_TEST_BAIL", () => {
  it("runs a failure on a crowded host alone and then the whole request, which decides", () => {
    expect(bailAt("999")).toEqual({ status: 0, ran: 1 });
  });

  it("stops at a failure on a quiet host, and never runs the files after it", () => {
    expect(bailAt("0")).toEqual({ status: 1, ran: 0 });
  });
});
